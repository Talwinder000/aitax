/**
 * ReceiptVault AI — Main Application (dashboard pages)
 * Requires: config.js, utils.js, idb.js, auth.js, scanner.js, Chart.js
 * All receipt operations, charts, reports, settings, export/import
 */
(function () {
  'use strict';

  const R = window.RV; // shorthand

  /* ── Constants ── */
  const CATS = ['Fuel','Meals','Travel','Office Supplies','Inventory','Advertising',
    'Utilities','Software','Vehicle','Insurance','Rent','Other'];
  const PMTS = ['Credit Card','Debit Card','Cash','Bank Transfer','Check','Other'];
  const PER  = 15;

  /* ── State ── */
  let receipts = [];
  let settings = { apiKey:'', model:'gemini-2.5-flash' };
  let sortCol  = 'date', sortDir = 'desc', curPage = 1;
  let charts   = {};
  let navHistory   = ['dashboard'];
  let curPageName  = 'dashboard';
  let pkShown = false;

  // Upload state — curB64 is the IMAGE THAT WILL BE OCR'd
  // (may be enhanced or original depending on user choice)
  let curFile     = null;
  let curB64      = null;   // b64 used for OCR + thumbnail
  let curOrigB64  = null;   // always the raw original
  let curMime     = null;
  let curEnhanced = false;  // true when we're using the enhanced version

  const PAGE_TITLES = {
    dashboard:'Dashboard', upload:'Upload Receipt', receipts:'All Receipts',
    analytics:'Analytics', reports:'Reports', settings:'Settings',
  };
  const settKey  = () => `rv_sett_${window._fbUser?.uid||'anon'}`;
  const themeKey = () => `rv_theme_${window._fbUser?.uid||'anon'}`;

  /* ══════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════ */
  document.addEventListener('rv:authReady', async ({ detail: { user } }) => {
    if (!user) { window.location.replace('../index.html'); return; }
    await R.idb.open();
    await R.idb.migrateFromLS(user.uid);
    try { receipts = await R.idb.getAll(user.uid); } catch { receipts = []; }
    loadSettings();
    R.loadTheme(user.uid);
    renderUserChip(user);
    updatePlanUI();
    updateStat();
    if (!window._appBooted) { window._appBooted = true; bindAll(); }
    nav('dashboard', true);
    setTimeout(() => R.passkey.promptSetup(user.uid), 2000);
  }, { once: true });

  /* ── Settings ── */
  function loadSettings() {
    settings = { apiKey:'', model:'gemini-2.5-flash' };
    try { Object.assign(settings, JSON.parse(localStorage.getItem(settKey())||'{}')); } catch {}
  }
  function saveSett() { localStorage.setItem(settKey(), JSON.stringify(settings)); }

  /* ── User chip ── */
  function renderUserChip(u) {
    const name = u.displayName||(u.email?u.email.split('@')[0]:'User');
    const av = R.el('tbAv'); if (av) { if(u.photoURL)av.innerHTML=`<img src="${R.esc(u.photoURL)}" alt="">`;else av.textContent=name.charAt(0).toUpperCase(); }
    const nm = R.el('tbNm'); if (nm) { nm.textContent=name; nm.title=u.email||''; }
  }

  /* ── Stat update ── */
  function updateStat() {
    const plan  = window._userPlan || 'free';
    const lim   = plan==='free'?200:Infinity;
    const cnt   = receipts.length;
    const pct   = lim===Infinity?Math.min(100,(cnt/200)*100):Math.min(100,(cnt/lim)*100);
    const ba    = R.el('recBadge'); if(ba)ba.textContent=cnt;
    const sa    = R.el('sbStorAmt'); if(sa)sa.textContent=`${cnt} receipts`;
    const fill  = R.el('sbBarFill'); if(fill)fill.style.width=pct+'%';
    const ss    = R.el('settStorage'); if(ss)ss.textContent=`${cnt} receipts in IndexedDB`;
  }

  function updatePlanUI() {
    const plan = window._userPlan || 'free';
    const meta = window.RV_CONFIG?.plans?.[plan] || { name:'Free' };
    const pb   = R.el('planBadge'); if(pb){pb.textContent=meta.name;pb.className=`plan-badge ${plan}`;}
    const lb = R.el('limitBanner');
    if (lb) {
      if (plan==='free' && receipts.length >= 180) {
        const pct = Math.round((receipts.length/200)*100);
        lb.innerHTML=`<div class="lim-banner"><i class="fas fa-exclamation-triangle"></i><div class="lb-txt"><strong>${receipts.length}/200 receipts used (${pct}%)</strong><span>Approaching the Free plan limit. Upgrade to Plus for unlimited receipts.</span></div><button class="btn btn-primary btn-sm" onclick="location.href='pricing.html'"><i class="fas fa-rocket"></i>Upgrade</button></div>`;
      } else lb.innerHTML='';
    }
  }
  window.addEventListener('rv:authReady', updatePlanUI);

  /* ══════════════════════════════════════════════════
     BIND ALL EVENTS
  ══════════════════════════════════════════════════ */
  function bindAll() {
    R.el('mobMenuBtn')?.addEventListener('click', R.openSidebar);
    R.el('sbOverlay')?.addEventListener('click', R.closeSidebar);
    R.el('collapseBtn')?.addEventListener('click', R.toggleSidebar);
    R.el('themeBtn')?.addEventListener('click', R.toggleTheme);
    R.el('logoutBtn')?.addEventListener('click', () => {
      R.confirm2('Log Out','Are you sure you want to log out?', async()=>{
        await RV.signOut();
        window.location.replace('../index.html');
      });
    });
    R.qsa('.nav-item[data-page]').forEach(b=>b.addEventListener('click',()=>{ nav(b.dataset.page); R.closeSidebar(); }));
    const uz=R.el('uploadZone');
    if(uz){
      uz.addEventListener('click',()=>R.el('fileInp')?.click());
      uz.addEventListener('dragover',e=>{e.preventDefault();uz.classList.add('drag');});
      uz.addEventListener('dragleave',()=>uz.classList.remove('drag'));
      uz.addEventListener('drop',e=>{e.preventDefault();uz.classList.remove('drag');handleFiles(e.dataTransfer.files);});
    }
    R.el('fileInp')?.addEventListener('change',e=>handleFiles(e.target.files));
    R.el('globalSearch')?.addEventListener('input',()=>{curPage=1;renderTable();});
    let sx=0;
    document.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;},{passive:true});
    document.addEventListener('touchend',e=>{if(e.changedTouches[0].clientX-sx<-50)R.closeSidebar();},{passive:true});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){R.closeSidebar();R.qsa('.modal-bg.open').forEach(m=>m.classList.remove('open'));}});
  }

  /* ══════════════════════════════════════════════════
     NAVIGATION
  ══════════════════════════════════════════════════ */
  function nav(page, fromHist) {
    R.qsa('.page').forEach(p=>p.classList.remove('active'));
    R.qsa('.nav-item[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    R.el('page-'+page)?.classList.add('active');
    const pt=R.el('pageTtl'); if(pt)pt.textContent=PAGE_TITLES[page]||page;
    R.el('bodyScroll')?.scrollTo(0,0);
    if(!fromHist&&page!==curPageName){navHistory.push(page);if(navHistory.length>40)navHistory.shift();}
    curPageName=page; updateNavBtns(); renderPage(page);
  }
  window.goBack=()=>{if(navHistory.length<=1)return;navHistory.pop();nav(navHistory[navHistory.length-1]||'dashboard',true);};
  window.goHome=()=>{navHistory=['dashboard'];nav('dashboard',true);};
  function updateNavBtns(){const bb=R.el('navBack'),hb=R.el('navHome');if(bb)bb.disabled=navHistory.length<=1;if(hb)hb.disabled=curPageName==='dashboard';}
  function renderPage(p){if(p==='dashboard')renderDash();if(p==='receipts'){populateFilters();renderTable();}if(p==='analytics')renderAnalytics();if(p==='reports'){populateRptYrs();renderReports();}if(p==='settings')renderSettings();}
  window.nav=nav;

  /* ══════════════════════════════════════════════════
     UPLOAD — entry point
  ══════════════════════════════════════════════════ */
  function handleFiles(files){
    if(!files||!files.length)return;
    if(!canAddReceipt()){R.showUpgradeModal();return;}
    const f=files[0];
    if(!['image/jpeg','image/png','image/jpg','application/pdf'].includes(f.type)){
      R.toast('Use JPG, PNG, or PDF files.','error');return;
    }
    curFile=f; curEnhanced=false;
    const rdr=new FileReader();
    rdr.onload=ev=>{
      const du=ev.target.result;
      curOrigB64=du.split(',')[1]; curB64=curOrigB64; curMime=f.type;
      showProcPanel(du,f);
      clearFields();
      // For PDFs skip scanner UI, go straight to Gemini
      if(f.type==='application/pdf'){
        const k=R.el('apiKeyInp')?.value||settings.apiKey;
        if(!k){setSt('idle','No API key — fill fields manually');enableSave();return;}
        runGemini();
      } else {
        // Show scanner UI — user must click Enhance or Use Original before OCR runs
        showScannerUI(curOrigB64, curMime);
      }
    };
    rdr.readAsDataURL(f);
  }

  function canAddReceipt(){
    const plan=window._userPlan||'free';
    const lim=plan==='free'?200:Infinity;
    return receipts.length<lim;
  }

  /* ── Show the processing panel ── */
  function showProcPanel(du,f){
    const pp=R.el('procPanel');if(pp)pp.style.display='block';
    const pt=R.el('procThumb');
    if(pt)pt.innerHTML=f.type==='application/pdf'
      ?`<div class="proc-pdf"><i class="fas fa-file-pdf" style="font-size:32px;color:var(--red)"></i><span style="font-size:11px;color:var(--tx3);text-align:center;padding:0 4px">${R.esc(f.name)}</span></div>`
      :`<div class="proc-thumb-wrap"><img class="proc-thumb" src="${du}" alt="Receipt" loading="lazy" id="procThumbImg"><div class="proc-enhanced-tag" id="procEnhTag" style="display:none">✨ ENHANCED</div></div>`;
    const dw=R.el('dupWarn');if(dw)dw.style.display='none';
    const ip=R.el('insPanel');if(ip)ip.style.display='none';
    const sb=R.el('saveBtn');if(sb)sb.disabled=true;
    setProg(0);setSt('idle','Ready');
    // Hide scanner wrap if re-using
    const sw=R.el('scannerWrap');if(sw)sw.innerHTML='';
  }

  /* ── Show the CamScanner-style UI ── */
  function showScannerUI(b64, mime){
    const sw=R.el('scannerWrap');
    if(!sw)return;
    sw.style.display='block';
    setSt('idle','Adjust corners then click Enhance Receipt');

    window.RVScanner.init(
      'scannerWrap',
      b64,
      mime,
      /* onEnhanced */ (enhB64, origB64) => {
        // User confirmed enhanced image
        curB64 = enhB64;
        curOrigB64 = origB64;
        curEnhanced = true;
        sw.style.display='none';
        updateProcThumb(enhB64, mime, true);
        showQualityBadge(true);
        setSt('idle','Image enhanced — running OCR…');
        const k=R.el('apiKeyInp')?.value||settings.apiKey;
        if(!k){setSt('idle','Image enhanced. Set API key, then click Re-scan.');enableSave();return;}
        runGemini();
      },
      /* onOriginal */ (origB64) => {
        // User chose original
        curB64 = origB64;
        curOrigB64 = origB64;
        curEnhanced = false;
        sw.style.display='none';
        updateProcThumb(origB64, mime, false);
        showQualityBadge(false);
        setSt('idle','Using original image — running OCR…');
        const k=R.el('apiKeyInp')?.value||settings.apiKey;
        if(!k){setSt('idle','Using original. Set API key, then click Re-scan.');enableSave();return;}
        runGemini();
      }
    );
  }

  /* Update the small thumbnail in proc panel header */
  function updateProcThumb(b64, mime, enhanced){
    const img=R.el('procThumbImg');
    if(img)img.src=`data:${mime};base64,${b64}`;
    const tag=R.el('procEnhTag');
    if(tag)tag.style.display=enhanced?'block':'none';
  }

  function showQualityBadge(enhanced){
    const qb=R.el('qualityBadge');
    if(!qb)return;
    qb.className='scan-quality-badge '+(enhanced?'sqb-enhanced':'sqb-original');
    qb.innerHTML=enhanced
      ?'<i class="fas fa-wand-magic-sparkles"></i> Enhanced image — better OCR accuracy'
      :'<i class="fas fa-image"></i> Original image';
    qb.style.display='inline-flex';
  }

  window.clearUpload=function(){
    curFile=null;curB64=null;curOrigB64=null;curMime=null;curEnhanced=false;
    const pp=R.el('procPanel');if(pp)pp.style.display='none';
    const fi=R.el('fileInp');if(fi)fi.value='';
    const sw=R.el('scannerWrap');if(sw){sw.innerHTML='';sw.style.display='none';}
    clearFields();setSt('idle','Ready');
  };

  function clearFields(){
    ['fVend','fDate','fSub','fTax','fTotal','fNotes','fRnum'].forEach(id=>{const e=R.el(id);if(e)e.value='';});
    const fc=R.el('fCat');if(fc)fc.value='Other';const fp=R.el('fPay');if(fp)fp.value='Credit Card';
    const cc=R.el('catConf');if(cc)cc.innerHTML='';const sb=R.el('saveBtn');if(sb)sb.disabled=true;
    const qb=R.el('qualityBadge');if(qb)qb.style.display='none';
  }
  window.enableSave=function(){const sb=R.el('saveBtn');if(sb)sb.disabled=false;};
  function setSt(type,txt){const d=R.el('sDot');if(d)d.className='s-dot '+type;const t=R.el('sTxt');if(t)t.textContent=txt;}
  function setProg(p){const f=R.el('pFill');if(f)f.style.width=p+'%';}

  /* ══════════════════════════════════════════════════
     GEMINI VISION
  ══════════════════════════════════════════════════ */
  window.runGemini=async function(){
    const key=settings.apiKey;
    if(!key){R.toast('Set your Gemini API key in Settings.','warning');setSt('idle','No API key');window.enableSave();return;}
    if(!curB64){R.toast('No image loaded.','warning');return;}
    setSt('scan','Sending to Gemini Vision…');setProg(20);const sb=R.el('saveBtn');if(sb)sb.disabled=true;

    const PROMPT=`You are an expert accountant. Analyse this receipt. Return ONLY valid JSON with no markdown or explanation:
{"vendor":"","date":"","subtotal":0,"tax":0,"total":0,"category":"","paymentMethod":"","notes":"","receiptNumber":""}
Rules: date=YYYY-MM-DD; category MUST be one of: Fuel,Meals,Travel,Office Supplies,Inventory,Advertising,Utilities,Software,Vehicle,Insurance,Rent,Other; paymentMethod=Credit Card|Debit Card|Cash|Bank Transfer|Check|Other; notes≤80 chars; use 0 for unknown numbers,"" for unknown strings.`;
    const model=settings.model||'gemini-2.5-flash';
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const body={contents:[{parts:[{text:PROMPT},{inline_data:{mime_type:curMime==='application/pdf'?'application/pdf':curMime,data:curB64}}]}],generationConfig:{temperature:.1,maxOutputTokens:512,responseMimeType:'application/json'}};
    try{
      setProg(40);
      const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      setProg(70);
      if(!res.ok){const e=await res.json().catch(()=>({error:{message:res.statusText}}));const m=e?.error?.message||res.statusText;throw new Error(res.status===400&&m.includes('API_KEY')?'Invalid API key. Check Settings.':'Gemini error: '+m);}
      const data=await res.json();setProg(90);
      if(data?.promptFeedback?.blockReason)throw new Error('Gemini blocked this image: '+data.promptFeedback.blockReason);
      if(!data?.candidates?.length)throw new Error('Gemini returned no result. Try re-scanning.');
      const raw=data.candidates[0]?.content?.parts?.[0]?.text||'';
      if(!raw.trim())throw new Error('Gemini returned empty response.');
      let parsed;
      try{parsed=JSON.parse(raw.replace(/```json/g,'').replace(/```/g,'').trim());}
      catch(_){const m=raw.match(/\{[\s\S]*\}/);if(m)parsed=JSON.parse(m[0]);else throw new Error('Unreadable response from Gemini.');}
      fillFields(parsed);checkDup(parsed);genInsight(parsed);
      setProg(100);setSt('done','Extracted ✓');window.enableSave();
      R.toast('Receipt scanned!','success');
    }catch(e){
      console.error('[Gemini]',e);setSt('err',e.message||'Scan failed');setProg(0);
      R.toast(e.message||'Scan failed','error');window.enableSave();
    }
  };

  function fillFields(d){
    const g=id=>R.el(id);
    if(g('fVend'))g('fVend').value=d.vendor||'';
    if(g('fDate'))g('fDate').value=d.date||R.todayISO();
    if(g('fSub'))g('fSub').value=d.subtotal>0?d.subtotal:'';
    if(g('fTax'))g('fTax').value=d.tax>0?d.tax:'';
    if(g('fTotal'))g('fTotal').value=d.total>0?d.total:'';
    if(g('fNotes'))g('fNotes').value=d.notes||'';
    if(g('fRnum'))g('fRnum').value=d.receiptNumber||'';
    const fc=g('fCat');if(fc)fc.value=CATS.includes(d.category)?d.category:'Other';
    const fp=g('fPay');if(fp)fp.value=PMTS.includes(d.paymentMethod)?d.paymentMethod:'Other';
    const cc=g('catConf');if(cc)cc.innerHTML=`<span class="conf-tag conf-${d.total>0&&d.vendor?'h':d.total>0||d.vendor?'m':'l'}">${d.total>0&&d.vendor?'high':d.total>0||d.vendor?'med':'low'}</span>`;
  }
  function checkDup(d){
    if(!d.total||!d.vendor)return;
    const dup=receipts.find(r=>r.vendor?.toLowerCase()===String(d.vendor).toLowerCase()&&Math.abs(r.total-Number(d.total))<.01&&r.date===d.date);
    const dw=R.el('dupWarn'),dm=R.el('dupMsg');
    if(dup&&dw&&dm){dw.style.display='flex';dm.textContent=`Possible duplicate: "${dup.vendor}" on ${dup.date} for $${dup.total.toFixed(2)}`;}
    else if(dw)dw.style.display='none';
  }
  function genInsight(d){
    const tips={Fuel:'Keep mileage logs.',Meals:'Note attendees and business purpose.',Travel:'Track per diem vs actuals.','Office Supplies':'Fully deductible.',Inventory:'Match stock records.',Advertising:'Tag campaigns.',Utilities:'Home-office may be deductible.',Software:'Typically 100% deductible.',Vehicle:'Log business vs personal use.',Insurance:'Keep policy docs.',Rent:'Keep lease on file.',Other:'Review and recategorise.'};
    const ip=R.el('insPanel'),it=R.el('insTxt');
    if(ip&&it){it.textContent=`${d.category||'Receipt'} from ${d.vendor||'vendor'} for $${R.n(d.total).toFixed(2)}. ${tips[d.category]||tips.Other}`;ip.style.display='block';}
  }

  /* ══════════════════════════════════════════════════
     SAVE RECEIPT — stores BOTH original and enhanced images
  ══════════════════════════════════════════════════ */
  window.saveReceipt=async function(){
    if(!canAddReceipt()){R.showUpgradeModal();return;}
    const uid=window._fbUser?.uid||'anon';
    const total=parseFloat(R.el('fTotal')?.value)||0;
    const vend=R.el('fVend')?.value.trim()||'';
    if(!vend&&total===0){R.toast('Enter vendor or total amount.','warning');return;}
    R.showLoad('Saving receipt…');

    // Thumbnail: prefer enhanced (cleaner for display), fallback to original
    let img='', imgOriginal='';
    if(curB64&&curMime&&curMime!=='application/pdf'){
      // The "display" image is always the enhanced one if available
      img = await R.resizeImg(curB64, curMime, 1400);
      // Also save original separately if we enhanced
      if(curEnhanced && curOrigB64){
        try{ imgOriginal = await R.resizeImg(curOrigB64, curMime, 800); }catch(_){}
      }
    }

    const rec=R.idb.normalizeRec({
      id:R.genId(),vendor:vend||'Unknown',date:R.el('fDate')?.value||R.todayISO(),
      subtotal:parseFloat(R.el('fSub')?.value)||0,tax:parseFloat(R.el('fTax')?.value)||0,total,
      category:R.el('fCat')?.value||'Other',paymentMethod:R.el('fPay')?.value||'Other',
      receiptNumber:R.el('fRnum')?.value.trim()||'',notes:R.el('fNotes')?.value.trim()||'',
      image:img,           // enhanced (or original if not enhanced)
      imageOriginal: imgOriginal, // raw original (only set when enhanced)
      enhanced: curEnhanced,
      savedAt:new Date().toISOString(),
    },uid);
    try{await R.idb.put(rec);receipts.unshift(rec);updateStat();updatePlanUI();R.hideLoad();window.clearUpload();R.toast(`"${rec.vendor}" saved!`,'success');nav('dashboard');}
    catch(e){R.hideLoad();R.toast('Save failed: '+e.message,'error');}
  };

  /* ══════════════════════════════════════════════════
     DASHBOARD
  ══════════════════════════════════════════════════ */
  function renderDash(){renderDashStats();renderDashCharts();renderRecent();updatePlanUI();}
  function renderDashStats(){
    const tot=receipts.length,tA=receipts.reduce((s,r)=>s+R.n(r.total),0),tT=receipts.reduce((s,r)=>s+R.n(r.tax),0);
    const now=new Date(),mK=`${now.getFullYear()}-${R.pad(now.getMonth()+1)}`;
    const mR=receipts.filter(r=>r.date?.startsWith(mK)),mA=mR.reduce((s,r)=>s+R.n(r.total),0);
    const cats=R.groupBy(receipts,'category',r=>R.n(r.total)),top=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
    const ds=R.el('dashStats');if(!ds)return;
    ds.innerHTML=`
      <div class="stat-card"><div class="st-top"><div class="st-lbl">Total Receipts</div><div class="st-ico si-b"><i class="fas fa-receipt"></i></div></div><div class="st-val">${tot}</div><div class="st-sub">all time</div></div>
      <div class="stat-card"><div class="st-top"><div class="st-lbl">Total Expenses</div><div class="st-ico si-g"><i class="fas fa-dollar-sign"></i></div></div><div class="st-val">${R.fmt(tA)}</div><div class="st-sub">all time</div></div>
      <div class="stat-card"><div class="st-top"><div class="st-lbl">This Month</div><div class="st-ico si-a"><i class="fas fa-calendar-alt"></i></div></div><div class="st-val">${R.fmt(mA)}</div><div class="st-sub">${mR.length} receipts</div></div>
      <div class="stat-card"><div class="st-top"><div class="st-lbl">Tax Paid</div><div class="st-ico si-p"><i class="fas fa-percentage"></i></div></div><div class="st-val">${R.fmt(tT)}</div><div class="st-sub">recorded</div></div>
      <div class="stat-card"><div class="st-top"><div class="st-lbl">Top Category</div><div class="st-ico si-t"><i class="fas fa-tag"></i></div></div><div class="st-val" style="font-size:17px;margin-top:5px">${top?top[0]:'—'}</div><div class="st-sub">${top?R.fmt(top[1]):''}</div></div>`;
  }
  function renderRecent(){
    const rl=R.el('recentList');if(!rl)return;
    const src=receipts.slice(0,7);
    if(!src.length){rl.innerHTML='<div class="empty"><i class="fas fa-inbox"></i><h3>No receipts yet</h3><p>Upload your first receipt to get started</p></div>';return;}
    rl.innerHTML=src.map(r=>`
      <div onclick="viewReceipt('${r.id}')" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--bdr);cursor:pointer;border-radius:var(--r);padding-left:6px;transition:background .15s" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
        ${r.image?`<div style="position:relative;flex-shrink:0"><img src="data:image/jpeg;base64,${r.image}" style="width:40px;height:40px;object-fit:cover;border-radius:var(--r);border:1px solid var(--bdr)" loading="lazy">${r.enhanced?'<div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;background:var(--sec);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid var(--surf)"><i class="fas fa-wand-magic-sparkles" style="font-size:6px;color:#fff"></i></div>':''}</div>`:`<div style="width:40px;height:40px;border-radius:var(--r);background:var(--bg2);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-receipt" style="color:var(--tx3)"></i></div>`}
        <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${R.esc(r.vendor)}</div><div style="font-size:11px;color:var(--tx3)">${R.fmtDate(r.date)} · <span class="badge ${R.badgeClass(r.category)}">${r.category||'Other'}</span></div></div>
        <div style="font-weight:700;color:var(--acc);white-space:nowrap">${R.fmt(r.total)}</div>
      </div>`).join('');
    if(!pkShown){pkShown=true;R.passkey.promptSetup(window._fbUser?.uid);}
  }

  /* ══════════════════════════════════════════════════
     CHARTS
  ══════════════════════════════════════════════════ */
  const CC=['#2563EB','#10B981','#F59E0B','#EF4444','#7C3AED','#0891B2','#DB2777','#EA580C','#0284C7','#16A34A','#9333EA','#CA8A04'];
  function gC(){return{txt:R.isDark()?'#94A3B8':'#475569',grid:R.isDark()?'#1E293B':'#E2E8F0',bg:R.isDark()?'#0F172A':'#fff'};}
  function killCharts(){Object.values(charts).forEach(c=>{try{c.destroy();}catch{}});charts={};}
  function mkBar(id,lbls,data,lbl){
    if(charts[id])try{charts[id].destroy();}catch{}
    const cv=R.el(id);if(!cv)return;const g=gC();
    charts[id]=new Chart(cv.getContext('2d'),{type:'bar',data:{labels:lbls,datasets:[{label:lbl,data,backgroundColor:CC[0]+'cc',borderRadius:6}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+R.fmt(c.raw)},backgroundColor:g.bg,titleColor:R.isDark()?'#F8FAFC':'#1E293B',bodyColor:g.txt,borderColor:g.grid,borderWidth:1}},
      scales:{x:{ticks:{color:g.txt,font:{size:10}},grid:{color:g.grid}},y:{ticks:{color:g.txt,font:{size:10},callback:v=>'$'+v.toLocaleString()},grid:{color:g.grid}}}}});
  }
  function mkDoughnut(id,lbls,data){
    if(charts[id])try{charts[id].destroy();}catch{}
    const cv=R.el(id);if(!cv)return;const g=gC();
    charts[id]=new Chart(cv.getContext('2d'),{type:'doughnut',data:{labels:lbls,datasets:[{data,backgroundColor:CC.slice(0,lbls.length),borderWidth:2,borderColor:g.bg}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'right',labels:{color:g.txt,font:{size:11},padding:10,boxWidth:10,boxHeight:10,borderRadius:3}},
      tooltip:{callbacks:{label:c=>` ${R.fmt(c.raw)}`},backgroundColor:g.bg,titleColor:R.isDark()?'#F8FAFC':'#1E293B',bodyColor:g.txt,borderColor:g.grid,borderWidth:1}}}});
  }
  function mkLine(id,lbls,data,lbl){
    if(charts[id])try{charts[id].destroy();}catch{}
    const cv=R.el(id);if(!cv)return;const g=gC();
    charts[id]=new Chart(cv.getContext('2d'),{type:'line',data:{labels:lbls,datasets:[{label:lbl,data,borderColor:CC[0],backgroundColor:CC[0]+'20',fill:true,tension:.4,pointRadius:4,pointBackgroundColor:CC[0]}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+R.fmt(c.raw)},backgroundColor:g.bg,titleColor:R.isDark()?'#F8FAFC':'#1E293B',bodyColor:g.txt,borderColor:g.grid,borderWidth:1}},
      scales:{x:{ticks:{color:g.txt,font:{size:10}},grid:{color:g.grid}},y:{ticks:{color:g.txt,font:{size:10},callback:v=>'$'+v.toLocaleString()},grid:{color:g.grid}}}}});
  }
  function mkHBar(id,lbls,data){
    if(charts[id])try{charts[id].destroy();}catch{}
    const cv=R.el(id);if(!cv)return;const g=gC();
    charts[id]=new Chart(cv.getContext('2d'),{type:'bar',data:{labels:lbls,datasets:[{data,backgroundColor:CC.map(c=>c+'cc'),borderRadius:5}]},
      options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+R.fmt(c.raw)},backgroundColor:g.bg,titleColor:R.isDark()?'#F8FAFC':'#1E293B',bodyColor:g.txt,borderColor:g.grid,borderWidth:1}},
      scales:{x:{ticks:{color:g.txt,font:{size:10},callback:v=>'$'+v.toLocaleString()},grid:{color:g.grid}},y:{ticks:{color:g.txt,font:{size:10}},grid:{color:g.grid}}}}});
  }
  function monData(m=12){const now=new Date(),res=[];for(let i=m-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const k=`${d.getFullYear()}-${R.pad(d.getMonth()+1)}`;res.push({l:d.toLocaleDateString('en',{month:'short',year:'2-digit'}),a:receipts.filter(r=>r.date?.startsWith(k)).reduce((s,r)=>s+R.n(r.total),0)});}return res;}
  function catData(){const t={};receipts.forEach(r=>{const c=r.category||'Other';t[c]=(t[c]||0)+R.n(r.total);});return Object.entries(t).sort((a,b)=>b[1]-a[1]);}
  function vendData(x=8){const t={};receipts.forEach(r=>{const v=r.vendor||'Unknown';t[v]=(t[v]||0)+R.n(r.total);});return Object.entries(t).sort((a,b)=>b[1]-a[1]).slice(0,x);}
  function renderDashCharts(){const m=monData(12);mkBar('cMonth',m.map(x=>x.l),m.map(x=>x.a),'Expenses');const c=catData();mkDoughnut('cCat',c.map(x=>x[0]),c.map(x=>x[1]));const v=vendData();mkHBar('cVend',v.map(x=>x[0]),v.map(x=>x[1]));}
  window.killCharts=killCharts;
  window.RV.rerender=()=>renderPage(curPageName);

  /* ══════════════════════════════════════════════════
     RECEIPTS TABLE
  ══════════════════════════════════════════════════ */
  function populateFilters(){
    const cats=[...new Set(receipts.map(r=>r.category).filter(Boolean))].sort();
    const mons=[...new Set(receipts.map(r=>r.date?.slice(0,7)).filter(Boolean))].sort().reverse();
    const yrs=[...new Set(receipts.map(r=>r.date?.slice(0,4)).filter(Boolean))].sort().reverse();
    const vnds=[...new Set(receipts.map(r=>r.vendor).filter(Boolean))].sort();
    fillSel('fCat','All Categories',cats);fillSel('fMon','All Months',mons,v=>v,v=>R.fmtYM(v));fillSel('fYr','All Years',yrs);fillSel('fVnd','All Vendors',vnds);
  }
  function fillSel(id,def,items,val=(v=>v),lbl=(v=>v)){
    const s=R.el(id);if(!s)return;const cur=s.value;
    s.innerHTML=`<option value="">${def}</option>`+items.map(i=>`<option value="${R.esc(val(i))}">${R.esc(lbl(i))}</option>`).join('');
    if(cur)s.value=cur;
  }
  function getFiltered(){
    let d=[...receipts];
    const fc=R.el('fCat')?.value,fm=R.el('fMon')?.value,fy=R.el('fYr')?.value,fv=R.el('fVnd')?.value;
    const gs=R.el('globalSearch')?.value?.toLowerCase()||'';
    if(fc)d=d.filter(r=>r.category===fc);if(fm)d=d.filter(r=>r.date?.startsWith(fm));
    if(fy)d=d.filter(r=>r.date?.startsWith(fy));if(fv)d=d.filter(r=>r.vendor===fv);
    if(gs)d=d.filter(r=>(r.vendor||'').toLowerCase().includes(gs)||(r.category||'').toLowerCase().includes(gs)||String(r.total||'').includes(gs)||(r.date||'').includes(gs));
    d.sort((a,b)=>{let av=a[sortCol]||'',bv=b[sortCol]||'';if(['total','subtotal','tax'].includes(sortCol)){av=R.n(av);bv=R.n(bv);}if(av<bv)return sortDir==='asc'?-1:1;if(av>bv)return sortDir==='asc'?1:-1;return 0;});
    return d;
  }
  function renderTable(){
    const d=getFiltered(),pages=Math.max(1,Math.ceil(d.length/PER));
    if(curPage>pages)curPage=1;const sl=d.slice((curPage-1)*PER,curPage*PER);
    const cnt=R.el('tblCnt');if(cnt)cnt.textContent=`${d.length} receipt${d.length!==1?'s':''}`;
    const tb=R.el('rTbody');
    if(tb)tb.innerHTML=!sl.length?`<tr><td colspan="8"><div class="empty"><i class="fas fa-search"></i><h3>No receipts</h3><p>Adjust your filters</p></div></td></tr>`:
      sl.map(r=>`<tr>
        <td>${r.image?`<div style="position:relative;width:38px;height:38px"><img class="t-thumb" src="data:image/jpeg;base64,${r.image}" loading="lazy" onclick="viewReceipt('${r.id}')" alt="">${r.enhanced?`<div style="position:absolute;bottom:-2px;right:-2px;width:13px;height:13px;background:var(--sec);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid var(--surf)"><i class='fas fa-wand-magic-sparkles' style='font-size:5px;color:#fff'></i></div>`:''}</div>`:`<div class="t-nothumb"><i class="fas fa-receipt"></i></div>`}</td>
        <td class="t-vend" title="${R.esc(r.vendor)}">${R.esc(r.vendor||'—')}</td>
        <td style="white-space:nowrap;color:var(--tx2)">${R.fmtDate(r.date)}</td>
        <td><span class="badge ${R.badgeClass(r.category)}">${r.category||'Other'}</span></td>
        <td class="t-amt">${R.fmt(r.total)}</td><td style="color:var(--tx2)">${r.tax?R.fmt(r.tax):'—'}</td>
        <td style="color:var(--tx2);font-size:12px">${R.esc(r.paymentMethod||'—')}</td>
        <td><div class="t-acts">
          <button class="t-btn v" onclick="viewReceipt('${r.id}')"><i class="fas fa-eye"></i></button>
          <button class="t-btn e" onclick="editReceipt('${r.id}')"><i class="fas fa-pen"></i></button>
          <button class="t-btn d" onclick="deleteReceipt('${r.id}')"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`).join('');
    const rc=R.el('rCards');
    if(rc)rc.innerHTML=!sl.length?`<div class="empty"><i class="fas fa-search"></i><h3>No receipts</h3><p>Adjust filters</p></div>`:
      sl.map(r=>`<div class="r-card">
        ${r.image?`<div style="position:relative;flex-shrink:0;width:46px;height:46px"><img class="r-card-img" src="data:image/jpeg;base64,${r.image}" loading="lazy" onclick="viewReceipt('${r.id}')" alt="">${r.enhanced?`<div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;background:var(--sec);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid var(--surf)"><i class='fas fa-wand-magic-sparkles' style='font-size:6px;color:#fff'></i></div>`:''}</div>`:`<div class="r-card-nth"><i class="fas fa-receipt"></i></div>`}
        <div class="r-card-body">
          <div class="r-card-top"><span class="r-card-vnd">${R.esc(r.vendor||'—')}</span><span class="r-card-amt">${R.fmt(r.total)}</span></div>
          <div class="r-card-meta"><span>${R.fmtDate(r.date)}</span><span class="badge ${R.badgeClass(r.category)}">${r.category||'Other'}</span></div>
          <div class="r-card-acts">
            <button class="t-btn v" onclick="viewReceipt('${r.id}')"><i class="fas fa-eye"></i></button>
            <button class="t-btn e" onclick="editReceipt('${r.id}')"><i class="fas fa-pen"></i></button>
            <button class="t-btn d" onclick="deleteReceipt('${r.id}')"><i class="fas fa-trash"></i></button>
          </div>
        </div></div>`).join('');
    R.qsa('.data-tbl th[data-sort]').forEach(th=>{th.className=sortCol===th.dataset.sort?'s'+sortDir:'';th.onclick=()=>{sortCol===th.dataset.sort?sortDir=sortDir==='asc'?'desc':'asc':(sortCol=th.dataset.sort,sortDir='asc');curPage=1;renderTable();};});
    const pw=R.el('pgWrap');if(!pw)return;
    if(pages<=1){pw.innerHTML='';return;}
    let h='';if(curPage>1)h+=`<button class="pg-btn" onclick="goPg(${curPage-1})"><i class="fas fa-chevron-left"></i></button>`;
    const s=Math.max(1,curPage-2),e=Math.min(pages,s+4);for(let i=s;i<=e;i++)h+=`<button class="pg-btn${i===curPage?' on':''}" onclick="goPg(${i})">${i}</button>`;
    if(curPage<pages)h+=`<button class="pg-btn" onclick="goPg(${curPage+1})"><i class="fas fa-chevron-right"></i></button>`;
    h+=`<span class="pg-info">Page ${curPage} of ${pages}</span>`;pw.innerHTML=h;
  }
  window.goPg=p=>{curPage=p;renderTable();};
  window.renderTable=renderTable;

  /* ══════════════════════════════════════════════════
     VIEW — shows both enhanced + original if available
  ══════════════════════════════════════════════════ */
  window.viewReceipt=function(id){
    const r=receipts.find(x=>x.id===id);if(!r)return;
    const tips={Fuel:'Keep mileage logs.',Meals:'Note attendees and business purpose.',Travel:'Track per diem vs actuals.','Office Supplies':'Fully deductible.',Inventory:'Match stock records.',Advertising:'Tag campaigns.',Utilities:'Home-office may be deductible.',Software:'Typically 100% deductible.',Vehicle:'Log business vs personal use.',Insurance:'Keep policy docs.',Rent:'Keep lease on file.',Other:'Review and recategorise.'};
    const imgSection = r.image
      ? (r.imageOriginal && r.enhanced
        ? `<div class="scanner-compare" style="margin-bottom:14px">
             <div class="scan-side"><div class="scan-side-label enhanced-label">✨ Enhanced</div><img style="width:100%;border-radius:var(--r);border:1px solid var(--bdr)" src="data:image/jpeg;base64,${r.image}" alt="Enhanced" loading="lazy"></div>
             <div class="scan-side"><div class="scan-side-label">Original</div><img style="width:100%;border-radius:var(--r);border:1px solid var(--bdr)" src="data:image/jpeg;base64,${r.imageOriginal}" alt="Original" loading="lazy"></div>
           </div>`
        : `<img style="width:100%;border-radius:var(--rl);margin-bottom:14px;max-height:300px;object-fit:contain" src="data:image/jpeg;base64,${r.image}" alt="" loading="lazy">`)
      : `<div style="height:180px;background:var(--bg2);border-radius:var(--rl);display:flex;align-items:center;justify-content:center;font-size:36px;color:var(--tx3);margin-bottom:14px"><i class="fas fa-receipt"></i></div>`;
    R.el('mViewBody').innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1.35fr;gap:18px">
        <div>${imgSection}
          <div class="ins-panel" style="display:block"><div class="ih"><i class="fas fa-lightbulb"></i>Accounting Note</div><p>${tips[r.category||'Other']||tips.Other}</p></div>
          ${r.enhanced?'<div style="margin-top:8px"><span class="scan-quality-badge sqb-enhanced"><i class="fas fa-wand-magic-sparkles"></i> Enhanced image used for OCR</span></div>':''}
        </div>
        <div>
          <div class="det-row"><span class="dr-l">Vendor</span><strong class="dr-v">${R.esc(r.vendor)}</strong></div>
          <div class="det-row"><span class="dr-l">Date</span><span class="dr-v">${R.fmtDate(r.date)}</span></div>
          <div class="det-row"><span class="dr-l">Category</span><span class="badge ${R.badgeClass(r.category)}">${r.category||'Other'}</span></div>
          <div class="det-row"><span class="dr-l">Payment</span><span class="dr-v">${R.esc(r.paymentMethod||'—')}</span></div>
          <div class="det-row"><span class="dr-l">Subtotal</span><span class="dr-v">${r.subtotal?R.fmt(r.subtotal):'—'}</span></div>
          <div class="det-row"><span class="dr-l">Tax</span><span class="dr-v">${r.tax?R.fmt(r.tax):'—'}</span></div>
          <div class="det-row"><span class="dr-l">Total</span><strong class="dr-v" style="font-size:20px;color:var(--acc)">${R.fmt(r.total)}</strong></div>
          ${r.receiptNumber?`<div class="det-row"><span class="dr-l">Receipt #</span><span class="dr-v">${R.esc(r.receiptNumber)}</span></div>`:''}
          ${r.notes?`<div class="det-row"><span class="dr-l">Notes</span><span class="dr-v" style="font-size:12px;color:var(--tx2)">${R.esc(r.notes)}</span></div>`:''}
          <div class="det-row"><span class="dr-l">Saved</span><span class="dr-v" style="font-size:11px;color:var(--tx3)">${r.savedAt?new Date(r.savedAt).toLocaleString():'—'}</span></div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            <button class="btn btn-sm" onclick="editReceipt('${r.id}');R.closeM('mView')"><i class="fas fa-pen"></i>Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteReceipt('${r.id}');R.closeM('mView')"><i class="fas fa-trash"></i>Delete</button>
          </div>
        </div>
      </div>`;
    R.openM('mView');
  };

  window.editReceipt=function(id){
    const r=receipts.find(x=>x.id===id);if(!r)return;
    R.el('mEditBody').innerHTML=`<div style="display:flex;flex-direction:column;gap:0">
      <div class="field"><label>Vendor</label><input type="text" id="ev" value="${R.esc(r.vendor||'')}"></div>
      <div class="field"><label>Date</label><input type="date" id="ed" value="${r.date||''}"></div>
      <div class="field"><label>Subtotal ($)</label><input type="number" id="es" value="${r.subtotal||''}" step="0.01"></div>
      <div class="field"><label>Tax ($)</label><input type="number" id="et" value="${r.tax||''}" step="0.01"></div>
      <div class="field"><label>Total ($)</label><input type="number" id="eto" value="${r.total||''}" step="0.01"></div>
      <div class="field"><label>Category</label><select id="ec">${CATS.map(c=>`<option${c===r.category?' selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Payment</label><select id="ep">${PMTS.map(p=>`<option${p===r.paymentMethod?' selected':''}>${p}</option>`).join('')}</select></div>
      <div class="field"><label>Receipt #</label><input type="text" id="er" value="${R.esc(r.receiptNumber||'')}"></div>
      <div class="field"><label>Notes</label><input type="text" id="en" value="${R.esc(r.notes||'')}"></div>
      <button class="btn btn-primary" style="margin-top:4px" onclick="saveEdit('${id}')"><i class="fas fa-save"></i>Save Changes</button>
    </div>`;
    R.openM('mEdit');
  };
  window.saveEdit=async function(id){
    const i=receipts.findIndex(x=>x.id===id);if(i<0)return;
    const r=receipts[i];
    r.vendor=R.el('ev')?.value.trim()||'Unknown';r.date=R.el('ed')?.value||R.todayISO();
    r.subtotal=parseFloat(R.el('es')?.value)||0;r.tax=parseFloat(R.el('et')?.value)||0;
    r.total=parseFloat(R.el('eto')?.value)||0;r.category=R.el('ec')?.value||'Other';
    r.paymentMethod=R.el('ep')?.value||'Other';r.receiptNumber=R.el('er')?.value.trim()||'';
    r.notes=R.el('en')?.value.trim()||'';r.uid=window._fbUser?.uid||'anon';
    try{await R.idb.put(r);receipts[i]=r;R.closeM('mEdit');renderTable();R.toast('Updated','success');}
    catch(e){R.toast('Update failed: '+e.message,'error');}
  };
  window.deleteReceipt=function(id){
    R.confirm2('Delete Receipt','Permanently delete this receipt? This cannot be undone.',async()=>{
      try{await R.idb.del(id);receipts=receipts.filter(r=>r.id!==id);updateStat();updatePlanUI();renderTable();R.toast('Deleted','success');}
      catch(e){R.toast('Delete failed: '+e.message,'error');}
    });
  };

  /* ══════════════════════════════════════════════════
     ANALYTICS
  ══════════════════════════════════════════════════ */
  function renderAnalytics(){
    const tot=receipts.length,tA=receipts.reduce((s,r)=>s+R.n(r.total),0),tT=receipts.reduce((s,r)=>s+R.n(r.tax),0),avg=tot?tA/tot:0;
    const hi=tot?receipts.reduce((m,r)=>R.n(r.total)>R.n(m.total)?r:m,receipts[0]):null;
    const cd=catData(),top=cd[0],vd=vendData(1);
    const md=monData(3),tr=md[2]?.a>md[0]?.a?'↑ up':md[2]?.a<md[0]?.a?'↓ down':'→ flat';
    const ig=R.el('insGrid');if(!ig)return;
    ig.innerHTML=`
      <div class="ins-card"><h4>Largest Expense</h4><div class="ic-v">${hi?R.fmt(hi.total):'—'}</div><div class="ic-s">${hi?R.esc(hi.vendor):'No data'}</div></div>
      <div class="ins-card" style="border-left-color:var(--acc)"><h4>Top Category</h4><div class="ic-v">${top?top[0]:'—'}</div><div class="ic-s">${top?R.fmt(top[1]):''}</div></div>
      <div class="ins-card" style="border-left-color:var(--warn)"><h4>Avg Receipt</h4><div class="ic-v">${R.fmt(avg)}</div><div class="ic-s">across ${tot} receipts</div></div>
      <div class="ins-card" style="border-left-color:var(--sky)"><h4>Tax Paid</h4><div class="ic-v">${R.fmt(tT)}</div><div class="ic-s">total recorded</div></div>
      <div class="ins-card" style="border-left-color:var(--pur)"><h4>Monthly Trend</h4><div class="ic-v">${tr}</div><div class="ic-s">vs 3 months ago</div></div>
      <div class="ins-card" style="border-left-color:var(--pink)"><h4>Top Vendor</h4><div class="ic-v" style="font-size:14px">${vd.length?R.esc(vd[0][0]):'—'}</div><div class="ic-s">${vd.length?R.fmt(vd[0][1]):''}</div></div>`;
    const c=catData();mkDoughnut('cCatB',c.map(x=>x[0]),c.map(x=>x[1]));
    const m=monData(12);mkLine('cTrend',m.map(x=>x.l),m.map(x=>x.a),'Spend');
    const v=vendData(10);mkHBar('cVendB',v.map(x=>x[0]),v.map(x=>x[1]));
  }
  window.renderAnalytics=renderAnalytics;

  /* ══════════════════════════════════════════════════
     REPORTS
  ══════════════════════════════════════════════════ */
  function populateRptYrs(){const yrs=[...new Set(receipts.map(r=>r.date?.slice(0,4)).filter(Boolean))].sort().reverse();fillSel('rptYr','All Years',yrs);}
  function renderReports(){
    const yr=R.el('rptYr')?.value,mon=R.el('rptMon')?.value;
    let d=[...receipts];if(yr)d=d.filter(r=>r.date?.startsWith(yr));if(mon)d=d.filter(r=>r.date?.slice(5,7)===mon);
    const tA=d.reduce((s,r)=>s+R.n(r.total),0),tT=d.reduce((s,r)=>s+R.n(r.tax),0);
    const byCat={},byMon={},byVend={};
    d.forEach(r=>{const c=r.category||'Other';if(!byCat[c])byCat[c]={a:0,cnt:0,t:0};byCat[c].a+=R.n(r.total);byCat[c].cnt++;byCat[c].t+=R.n(r.tax);
      if(r.date){const m=r.date.slice(0,7);if(!byMon[m])byMon[m]={a:0,cnt:0};byMon[m].a+=R.n(r.total);byMon[m].cnt++;}
      const v=r.vendor||'Unknown';if(!byVend[v])byVend[v]={a:0,cnt:0};byVend[v].a+=R.n(r.total);byVend[v].cnt++;});
    const mL=mon?['','January','February','March','April','May','June','July','August','September','October','November','December'][parseInt(mon)]:null;
    const period=mL?`${yr||'All Years'} — ${mL}`:yr||'All Time';
    const rc=R.el('rptContent');if(!rc)return;
    rc.innerHTML=`
      <div class="rep-sec"><h3>Summary — ${R.esc(period)}</h3>
        <div class="rep-row"><span style="color:var(--tx2)">Total Receipts</span><strong>${d.length}</strong></div>
        <div class="rep-row"><span style="color:var(--tx2)">Total Expenses</span><strong class="rep-tot">${R.fmt(tA)}</strong></div>
        <div class="rep-row"><span style="color:var(--tx2)">Tax</span><strong>${R.fmt(tT)}</strong></div>
        <div class="rep-row"><span style="color:var(--tx2)">Net (before tax)</span><strong>${R.fmt(tA-tT)}</strong></div>
        ${d.length?`<div class="rep-row"><span style="color:var(--tx2)">Avg per Receipt</span><strong>${R.fmt(tA/d.length)}</strong></div>`:''}
      </div>
      <div class="rep-sec"><h3>By Category</h3>
        ${Object.entries(byCat).sort((a,b)=>b[1].a-a[1].a).map(([cat,v])=>`
          <div class="rep-row"><span><span class="badge ${R.badgeClass(cat)}">${cat}</span> <span style="color:var(--tx3);font-size:11px">(${v.cnt})</span></span>
          <div style="text-align:right"><div style="font-weight:600">${R.fmt(v.a)}</div><div style="font-size:11px;color:var(--tx3)">Tax: ${R.fmt(v.t)}</div></div></div>`).join('')||'<p style="color:var(--tx3);padding:8px 0">No data</p>'}
      </div>
      <div class="rep-sec"><h3>Top Vendors</h3>
        ${Object.entries(byVend).sort((a,b)=>b[1].a-a[1].a).slice(0,15).map(([v,dv])=>`
          <div class="rep-row"><span style="font-weight:500">${R.esc(v)}</span>
          <div style="text-align:right"><strong>${R.fmt(dv.a)}</strong><div style="font-size:11px;color:var(--tx3)">${dv.cnt} receipt${dv.cnt!==1?'s':''}</div></div></div>`).join('')||'<p style="color:var(--tx3);padding:8px 0">No data</p>'}
      </div>
      <div class="rep-sec"><h3>Monthly Breakdown</h3>
        ${Object.entries(byMon).sort((a,b)=>b[0].localeCompare(a[0])).map(([m,v])=>`<div class="rep-row"><span>${R.fmtYM(m)} <span style="color:var(--tx3);font-size:11px">(${v.cnt})</span></span><strong>${R.fmt(v.a)}</strong></div>`).join('')||'<p style="color:var(--tx3);padding:8px 0">No data</p>'}
      </div>
      <div class="rep-sec"><h3>All Receipts (${d.length})</h3>
        <div class="tbl-wrap"><table class="data-tbl" style="min-width:500px">
          <thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Payment</th><th>Sub</th><th>Tax</th><th>Total</th></tr></thead>
          <tbody>${d.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(r=>`
            <tr><td>${R.fmtDate(r.date)}</td><td class="t-vend">${R.esc(r.vendor||'—')}</td>
              <td><span class="badge ${R.badgeClass(r.category)}">${r.category||'Other'}</span></td>
              <td style="font-size:12px">${R.esc(r.paymentMethod||'—')}</td>
              <td>${r.subtotal?R.fmt(r.subtotal):'—'}</td><td>${r.tax?R.fmt(r.tax):'—'}</td>
              <td class="t-amt">${R.fmt(r.total)}</td></tr>`).join('')}
          </tbody></table></div>
      </div>`;
  }
  window.renderReports=renderReports;

  /* ══════════════════════════════════════════════════
     SETTINGS
  ══════════════════════════════════════════════════ */
  function renderSettings(){
    const ak=R.el('apiKeyInp');if(ak)ak.value=settings.apiKey||'';
    const ms=R.el('modelSel');if(ms)ms.value=settings.model||'gemini-2.5-flash';
    const as=R.el('apiSt');
    if(as)as.innerHTML=settings.apiKey?`<div class="api-dot" style="background:var(--acc)"></div><span style="color:var(--acc)">API key saved</span>`:`<div class="api-dot" style="background:var(--tx3)"></div><span style="color:var(--tx3)">No API key set</span>`;
    const dt=R.el('darkToggle');if(dt)dt.className='toggle'+(R.isDark()?' on':'');
    const bd=R.el('bioDesc');
    if(bd){if(!R.passkey.isSupported())bd.textContent='Not supported on this browser.';else if(R.passkey.hasLocal(window._fbUser?.uid))bd.textContent='Biometric login is active on this device.';else bd.textContent='Set up Face ID or Fingerprint for quick sign-in.';}
    updateStat();
  }
  window.saveApiKey=function(){const k=R.el('apiKeyInp')?.value.trim();if(!k){R.toast('Enter an API key first','warning');return;}settings.apiKey=k;saveSett();const as=R.el('apiSt');if(as)as.innerHTML=`<div class="api-dot" style="background:var(--acc)"></div><span style="color:var(--acc)">API key saved ✓</span>`;R.toast('API key saved','success');};
  window.saveModel=function(){settings.model=R.el('modelSel')?.value||'gemini-2.5-flash';saveSett();R.toast('Model updated','success');};
  window.toggleKeyVis=function(){const i=R.el('apiKeyInp'),e=R.el('keyEye');if(!i||!e)return;i.type=i.type==='password'?'text':'password';e.className=i.type==='password'?'fas fa-eye':'fas fa-eye-slash';};
  window.testApiKey=async function(){
    const k=R.el('apiKeyInp')?.value.trim()||settings.apiKey;if(!k){R.toast('Enter API key first','warning');return;}
    const as=R.el('apiSt');if(as)as.innerHTML=`<div class="api-dot" style="background:var(--warn)"></div><span style="color:var(--warn)"><i class="fas fa-circle-notch spin-inline"></i> Testing…</span>`;
    const model=R.el('modelSel')?.value||settings.model||'gemini-2.5-flash';
    try{const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${k}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'Reply: OK'}]}],generationConfig:{maxOutputTokens:10}})});const data=await res.json().catch(()=>({}));if(res.ok&&data?.candidates?.length){if(as)as.innerHTML=`<div class="api-dot" style="background:var(--acc)"></div><span style="color:var(--acc)">Connected — ${R.esc(model)} ✓</span>`;R.toast('API key valid!','success');}else throw new Error(data?.error?.message||(res.status===404?`Model not found`:'Invalid key'));}
    catch(e){if(as)as.innerHTML=`<div class="api-dot" style="background:var(--red)"></div><span style="color:var(--red)">${R.esc(e.message)}</span>`;R.toast(e.message,'error');}
  };
  window.clearAll=function(){R.confirm2('Clear All Data','Permanently delete ALL receipts? Cannot be undone.',async()=>{try{for(const r of receipts)await R.idb.del(r.id);receipts=[];updateStat();updatePlanUI();R.toast('All data cleared','success');renderDash();}catch(e){R.toast('Clear failed: '+e.message,'error');}});};
  window.setupPasskey=async function(){const uid=window._fbUser?.uid;if(!uid)return;const ok=await R.passkey.register(uid);if(ok){R.toast('Biometric login enabled!','success');}else R.toast('Passkey setup cancelled.','warning');renderSettings();};
  window.removePasskey=function(){R.passkey.removeLocal();R.toast('Biometric login removed.','success');renderSettings();};
  window.renderSettings=renderSettings;

  /* ══════════════════════════════════════════════════
     EXPORT / IMPORT
  ══════════════════════════════════════════════════ */
  window.exportCSV=function(){
    const rows=[['Date','Vendor','Category','Payment','Subtotal','Tax','Total','Receipt #','Notes'],...receipts.map(r=>[r.date,r.vendor,r.category,r.paymentMethod,r.subtotal||0,r.tax||0,r.total||0,r.receiptNumber||'',r.notes||''])];
    R.dl(rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n'),'receiptvault.csv','text/csv');R.toast('CSV exported','success');
  };
  window.exportExcel=function(){
    const rows=[['Date','Vendor','Category','Payment','Subtotal','Tax','Total'],...receipts.map(r=>[r.date,r.vendor,r.category,r.paymentMethod,r.subtotal||0,r.tax||0,r.total||0])];
    R.dl('\uFEFF'+rows.map(r=>r.join('\t')).join('\r\n'),'receiptvault-excel.csv','text/csv;charset=utf-8');R.toast('Excel CSV exported','success');
  };
  window.exportJSON=function(){
    R.dl(JSON.stringify({app:'ReceiptVault AI',version:5,exportedAt:new Date().toISOString(),count:receipts.length,receipts},null,2),'receiptvault-backup.json','application/json');R.toast('JSON exported','success');
  };
  window.importJSON=async function(ev){
    const f=ev.target.files[0];if(!f)return;
    const uid=window._fbUser?.uid||'anon';
    const rdr=new FileReader();
    rdr.onload=async e=>{
      try{const d=JSON.parse(e.target.result);const recs=d.receipts||(Array.isArray(d)?d:[]);if(!recs.length){R.toast('No receipts in file','warning');return;}
        const ids=new Set(receipts.map(r=>r.id));const toAdd=recs.filter(r=>!ids.has(r.id)).map(r=>R.idb.normalizeRec(r,uid));
        await R.idb.bulkPut(toAdd);receipts.push(...toAdd);updateStat();updatePlanUI();R.toast(`Imported ${toAdd.length} receipts`,'success');renderDash();}
      catch(err){R.toast('Import failed: '+err.message,'error');}
    };rdr.readAsText(f);ev.target.value='';
  };
  window.startCheckout=async function(priceId){try{R.showLoad('Redirecting to Stripe…');const data=await R.apiCall('/api/stripe/create-checkout','POST',{priceId});window.location.href=data.url;}catch(e){R.hideLoad();R.toast('Checkout error: '+e.message,'error');}};
  window.openPortal=async function(){try{R.showLoad('Opening billing portal…');const data=await R.apiCall('/api/stripe/customer-portal','POST');window.location.href=data.url;}catch(e){R.hideLoad();R.toast('Portal error: '+e.message,'error');}};

})();
