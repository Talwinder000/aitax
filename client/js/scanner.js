/**
 * ReceiptVault AI — CamScanner-Style Image Processor
 * ────────────────────────────────────────────────────
 * Uses OpenCV.js (loaded from CDN) to:
 *  1. Detect receipt/document edges (findContours + approxPolyDP)
 *  2. Show detected corner overlay on a canvas
 *  3. Allow user to drag corners manually for correction
 *  4. Apply perspective transform (warpPerspective)
 *  5. Convert to grayscale
 *  6. Improve contrast (CLAHE — adaptive histogram equalisation)
 *  7. Remove shadows (divide by blurred background)
 *  8. Sharpen text (Laplacian unsharp mask)
 *  9. Export clean base64 JPEG suitable for Gemini Vision OCR
 *
 * Exported to window.RVScanner.*
 * All public methods are Promise-based.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════ */
  let _cv        = null;   // OpenCV instance (set after cv['onRuntimeInitialized'])
  let _cvReady   = false;
  let _cvPending = [];     // callbacks waiting for cv ready

  let _origCanvas  = null; // canvas holding original image
  let _overlayCanvas = null; // corner-drag overlay
  let _origImg     = null; // HTMLImageElement

  // Four corners as {x,y} in ORIGINAL image coordinates
  // Order: TL, TR, BR, BL
  let _corners = [];
  let _dragging = -1;      // index of corner being dragged
  let _enhancedB64 = null; // result of last enhancement
  let _originalB64 = null; // original image b64 (for "Use Original" fallback)

  const HANDLE_R = 18;     // px radius of drag handle

  /* ══════════════════════════════════════════════════
     OPENCV INIT
  ══════════════════════════════════════════════════ */
  function waitForCV() {
    return new Promise(resolve => {
      if (_cvReady) { resolve(_cv); return; }
      _cvPending.push(resolve);
    });
  }

  // Called by OpenCV.js after it initialises
  window.onOpenCvReady = function () {
    _cv = window.cv;
    _cvReady = true;
    _cvPending.forEach(cb => cb(_cv));
    _cvPending = [];
    console.log('[Scanner] OpenCV.js ready — version:', _cv.getBuildInformation().split('\n')[0]);
  };

  /* ══════════════════════════════════════════════════
     EDGE DETECTION — finds the four corners of a
     document/receipt in the image
  ══════════════════════════════════════════════════ */
  function detectCorners(imgEl) {
    const cv = _cv;
    const src = cv.imread(imgEl);
    const W = src.cols, H = src.rows;

    // ── Pre-process for contour detection ──
    const gray   = new cv.Mat();
    const blur   = new cv.Mat();
    const edges  = new cv.Mat();
    const kernel = cv.Mat.ones(5, 5, cv.CV_8U);

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 50, 150);
    cv.dilate(edges, edges, kernel);

    // ── Find contours ──
    const contours  = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // ── Pick largest quadrilateral ──
    let best  = null;
    let bestA = 0;

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

      if (approx.rows === 4) {
        const area = Math.abs(cv.contourArea(approx));
        if (area > bestA) {
          bestA = area;
          best = approx;
        } else {
          approx.delete();
        }
      } else {
        approx.delete();
      }
      cnt.delete();
    }

    // ── Extract / order corners ──
    let corners;
    if (best && bestA > (W * H * 0.1)) {
      // We found a decent quadrilateral
      const raw = [];
      for (let i = 0; i < 4; i++) {
        raw.push({ x: best.data32S[i * 2], y: best.data32S[i * 2 + 1] });
      }
      corners = orderCorners(raw);
      best.delete();
    } else {
      // Fallback: use 5% inset rectangle
      if (best) best.delete();
      const m = Math.min(W, H) * 0.05;
      corners = [
        { x: m,     y: m },
        { x: W - m, y: m },
        { x: W - m, y: H - m },
        { x: m,     y: H - m },
      ];
    }

    // Cleanup
    [src, gray, blur, edges, kernel, contours, hierarchy].forEach(m => { try { m.delete(); } catch {} });

    return corners;
  }

  /** Order four points: TL, TR, BR, BL */
  function orderCorners(pts) {
    // Sort by y to split top/bottom pairs
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const top    = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bot    = sorted.slice(2).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bot[1], bot[0]]; // TL, TR, BR, BL
  }

  /* ══════════════════════════════════════════════════
     PERSPECTIVE + ENHANCE PIPELINE
  ══════════════════════════════════════════════════ */
  function perspectiveCorrect(imgEl, corners) {
    const cv = _cv;
    const src = cv.imread(imgEl);

    // ── Compute output size ──
    const [tl, tr, br, bl] = corners;
    const wTop  = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const wBot  = Math.hypot(br.x - bl.x, br.y - bl.y);
    const hLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const hRight= Math.hypot(br.x - tr.x, br.y - tr.y);
    const W = Math.round(Math.max(wTop, wBot));
    const H = Math.round(Math.max(hLeft, hRight));

    // ── Perspective warp ──
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y,
    ]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, W, 0, W, H, 0, H,
    ]);
    const M   = cv.getPerspectiveTransform(srcPts, dstPts);
    const dst = new cv.Mat();
    const dsize = new cv.Size(W, H);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // ── Grayscale ──
    const gray = new cv.Mat();
    cv.cvtColor(dst, gray, cv.COLOR_RGBA2GRAY);

    // ── Shadow removal: divide by blurred background ──
    const bg       = new cv.Mat();
    const noShadow = new cv.Mat();
    cv.GaussianBlur(gray, bg, new cv.Size(51, 51), 0);

    // Divide: pixel = (gray / bg) * 255, clamped
    const grayF = new cv.Mat();
    const bgF   = new cv.Mat();
    gray.convertTo(grayF, cv.CV_32F);
    bg.convertTo(bgF, cv.CV_32F);
    cv.divide(grayF, bgF, noShadow, 255.0);
    noShadow.convertTo(noShadow, cv.CV_8U);

    // ── CLAHE contrast enhancement ──
    const clahe    = new cv.CLAHE(2.0, new cv.Size(8, 8));
    const enhanced = new cv.Mat();
    clahe.apply(noShadow, enhanced);

    // ── Unsharp mask (sharpening) ──
    const blurred = new cv.Mat();
    const sharp   = new cv.Mat();
    cv.GaussianBlur(enhanced, blurred, new cv.Size(0, 0), 2);
    cv.addWeighted(enhanced, 1.8, blurred, -0.8, 0, sharp);

    // ── Output to canvas → base64 ──
    const outCanvas = document.createElement('canvas');
    cv.imshow(outCanvas, sharp);

    // Cleanup
    [src, dst, gray, bg, noShadow, grayF, bgF, enhanced, blurred, sharp,
      srcPts, dstPts, M].forEach(m => { try { m.delete(); } catch {} });

    return outCanvas;
  }

  /* ══════════════════════════════════════════════════
     OVERLAY UI — draggable corner handles
  ══════════════════════════════════════════════════ */
  function drawOverlay() {
    if (!_overlayCanvas || !_corners.length) return;
    const ctx = _overlayCanvas.getContext('2d');
    const W   = _overlayCanvas.width;
    const H   = _overlayCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // Scale corners from image coords to canvas display coords
    const scaleX = W / _origImg.naturalWidth;
    const scaleY = H / _origImg.naturalHeight;
    const pts = _corners.map(c => ({ x: c.x * scaleX, y: c.y * scaleY }));

    // Shaded polygon outside document
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Border
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth   = 2.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();

    // Corner handles
    const labels = ['TL', 'TR', 'BR', 'BL'];
    const colors  = ['#38BDF8', '#10B981', '#F59E0B', '#A78BFA'];
    pts.forEach((p, i) => {
      // Outer ring
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle   = colors[i] + '33';
      ctx.strokeStyle = colors[i];
      ctx.lineWidth   = 2.5;
      ctx.fill();
      ctx.stroke();
      // Inner dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = colors[i];
      ctx.fill();
      // Label
      ctx.font      = 'bold 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], p.x, p.y - HANDLE_R - 8);
    });
  }

  function getCanvasPoint(e, canvas) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    };
  }

  function hitTest(cx, cy) {
    const scaleX = _overlayCanvas.width  / _origImg.naturalWidth;
    const scaleY = _overlayCanvas.height / _origImg.naturalHeight;
    for (let i = 0; i < _corners.length; i++) {
      const px = _corners[i].x * scaleX;
      const py = _corners[i].y * scaleY;
      if (Math.hypot(cx - px, cy - py) < HANDLE_R + 8) return i;
    }
    return -1;
  }

  function bindDrag(canvas) {
    function start(e) {
      e.preventDefault();
      const p = getCanvasPoint(e, canvas);
      _dragging = hitTest(p.x, p.y);
    }
    function move(e) {
      if (_dragging < 0) return;
      e.preventDefault();
      const p = getCanvasPoint(e, canvas);
      const scaleX = canvas.width  / _origImg.naturalWidth;
      const scaleY = canvas.height / _origImg.naturalHeight;
      _corners[_dragging] = {
        x: Math.max(0, Math.min(_origImg.naturalWidth,  p.x / scaleX)),
        y: Math.max(0, Math.min(_origImg.naturalHeight, p.y / scaleY)),
      };
      drawOverlay();
    }
    function end() { _dragging = -1; }

    canvas.addEventListener('mousedown',  start, { passive: false });
    canvas.addEventListener('mousemove',  move,  { passive: false });
    canvas.addEventListener('mouseup',    end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end);
  }

  /* ══════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════ */

  /**
   * Initialise the scanner with the container element that will hold
   * the preview canvases and control buttons.
   *
   * @param {string} containerId  — id of the wrapper div in the DOM
   * @param {string} b64          — base64 image data (no prefix)
   * @param {string} mime         — e.g. 'image/jpeg'
   * @param {Function} onEnhanced — callback(enhancedB64, originalB64)
   * @param {Function} onOriginal — callback(originalB64) — "use original"
   */
  async function init(containerId, b64, mime, onEnhanced, onOriginal) {
    const container = document.getElementById(containerId);
    if (!container) return;

    _originalB64 = b64;
    _enhancedB64 = null;

    // Show loading state immediately
    container.innerHTML = `
      <div class="scanner-loading" id="scannerLoading">
        <div class="scan-spinner"></div>
        <p>Loading image processor…</p>
      </div>`;

    // Load the image
    _origImg = new Image();
    await new Promise((res, rej) => {
      _origImg.onload  = res;
      _origImg.onerror = rej;
      _origImg.src     = `data:${mime};base64,${b64}`;
    });

    // Wait for OpenCV
    await waitForCV();

    // ── Detect corners ──
    container.querySelector('#scannerLoading').querySelector('p').textContent =
      'Detecting document edges…';
    // Small delay lets browser paint the loading state
    await new Promise(r => setTimeout(r, 60));
    _corners = detectCorners(_origImg);

    // ── Build UI ──
    const maxW  = Math.min(_origImg.naturalWidth,  1200);
    const ratio = _origImg.naturalHeight / _origImg.naturalWidth;
    const dispH = Math.round(maxW * ratio);

    container.innerHTML = `
      <div class="scanner-preview-wrap" id="scannerWrap">
        <canvas id="scannerOrigCanvas" width="${maxW}" height="${dispH}" style="display:block;width:100%;border-radius:var(--r)"></canvas>
        <canvas id="scannerOverlay"    width="${maxW}" height="${dispH}" style="position:absolute;inset:0;width:100%;cursor:crosshair;touch-action:none;border-radius:var(--r)"></canvas>
        <div class="scanner-badge">Drag corners to adjust</div>
      </div>
      <div class="scanner-hint">
        <i class="fas fa-info-circle"></i>
        Blue corners mark the detected receipt edges. Drag to correct if needed, then click <strong>Enhance Receipt</strong>.
      </div>
      <div class="scanner-actions">
        <button class="btn btn-primary" id="scanEnhanceBtn" onclick="RVScanner.enhance()">
          <i class="fas fa-magic"></i>Enhance Receipt
        </button>
        <button class="btn" id="scanOrigBtn" onclick="RVScanner.useOriginal()">
          <i class="fas fa-image"></i>Use Original
        </button>
        <button class="btn btn-sm" id="scanRedetectBtn" onclick="RVScanner.redetect()">
          <i class="fas fa-search"></i>Re-detect Edges
        </button>
      </div>
      <div id="scannerResultWrap" style="display:none">
        <div class="scanner-compare">
          <div class="scan-side">
            <div class="scan-side-label">Original</div>
            <img id="scannerOrigThumb" alt="Original" style="width:100%;border-radius:var(--r)">
          </div>
          <div class="scan-side">
            <div class="scan-side-label enhanced-label">✨ Enhanced</div>
            <img id="scannerEnhThumb" alt="Enhanced" style="width:100%;border-radius:var(--r)">
          </div>
        </div>
        <div class="scanner-actions" style="margin-top:12px">
          <button class="btn btn-primary" onclick="RVScanner.confirmEnhanced()">
            <i class="fas fa-check"></i>Use Enhanced for OCR
          </button>
          <button class="btn" onclick="RVScanner.useOriginal()">
            <i class="fas fa-image"></i>Use Original Instead
          </button>
          <button class="btn btn-sm" onclick="RVScanner.redo()">
            <i class="fas fa-redo"></i>Redo Enhancement
          </button>
        </div>
      </div>`;

    // Draw original image onto backing canvas
    _origCanvas    = document.getElementById('scannerOrigCanvas');
    _overlayCanvas = document.getElementById('scannerOverlay');
    const ctx = _origCanvas.getContext('2d');
    ctx.drawImage(_origImg, 0, 0, maxW, dispH);

    // Draw corner overlay
    drawOverlay();

    // Bind drag events
    bindDrag(_overlayCanvas);

    // Store callbacks
    _enhancedCb = onEnhanced;
    _originalCb = onOriginal;
  }

  let _enhancedCb = null;
  let _originalCb = null;

  /**
   * Run the full enhance pipeline using current corners.
   * Shows before/after compare and two action buttons.
   */
  async function enhance() {
    const btn = document.getElementById('scanEnhanceBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="scan-btn-spin"></span>Enhancing…'; }

    await new Promise(r => setTimeout(r, 30)); // let UI update

    let outCanvas;
    try {
      outCanvas = perspectiveCorrect(_origImg, _corners);
    } catch (err) {
      console.error('[Scanner] Enhancement failed:', err);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i>Enhance Receipt'; }
      window.RV?.toast?.('Enhancement failed: ' + err.message + '. Using original.', 'warning');
      useOriginal();
      return;
    }

    // Get enhanced base64
    _enhancedB64 = outCanvas.toDataURL('image/jpeg', 0.92).split(',')[1];

    // Show result compare
    const rw = document.getElementById('scannerResultWrap');
    const ot = document.getElementById('scannerOrigThumb');
    const et = document.getElementById('scannerEnhThumb');
    if (rw) rw.style.display = 'block';
    if (ot) ot.src = `data:image/jpeg;base64,${_originalB64}`;
    if (et) et.src = `data:image/jpeg;base64,${_enhancedB64}`;

    // Hide the corner editor
    const wrap = document.getElementById('scannerWrap');
    if (wrap) wrap.style.display = 'none';

    const actions = document.querySelector('.scanner-actions');
    if (actions) actions.style.display = 'none';

    const hint = document.querySelector('.scanner-hint');
    if (hint) hint.style.display = 'none';
  }

  /** Accept enhanced image — fires onEnhanced callback */
  function confirmEnhanced() {
    if (!_enhancedB64) return;
    _enhancedCb && _enhancedCb(_enhancedB64, _originalB64);
  }

  /** Skip enhancement — fires onOriginal callback */
  function useOriginal() {
    _originalCb && _originalCb(_originalB64);
  }

  /** Go back to corner editing */
  function redo() {
    const rw = document.getElementById('scannerResultWrap');
    if (rw) rw.style.display = 'none';
    const wrap = document.getElementById('scannerWrap');
    if (wrap) wrap.style.display = '';
    const actions = document.querySelector('.scanner-actions');
    if (actions) { actions.style.display = ''; }
    const hint = document.querySelector('.scanner-hint');
    if (hint) hint.style.display = '';
    const btn = document.getElementById('scanEnhanceBtn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i>Enhance Receipt'; }
    _enhancedB64 = null;
  }

  /** Re-run automatic edge detection */
  async function redetect() {
    const btn = document.getElementById('scanRedetectBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="scan-btn-spin"></span>Detecting…'; }
    await new Promise(r => setTimeout(r, 30));
    try {
      _corners = detectCorners(_origImg);
      drawOverlay();
    } catch (err) {
      window.RV?.toast?.('Edge detection failed: ' + err.message, 'warning');
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i>Re-detect Edges'; }
  }

  /* ══════════════════════════════════════════════════
     EXPORT
  ══════════════════════════════════════════════════ */
  window.RVScanner = {
    init,
    enhance,
    confirmEnhanced,
    useOriginal,
    redo,
    redetect,
  };

})();
