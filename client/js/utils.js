/**
 * ReceiptVault AI — Shared Utilities
 * All helpers exported to window.RV.*
 */
(function () {
  'use strict';

  const RV = window.RV = window.RV || {};

  /* ── DOM ── */
  RV.el  = id => document.getElementById(id);
  RV.qs  = (s, ctx) => (ctx || document).querySelector(s);
  RV.qsa = (s, ctx) => Array.from((ctx || document).querySelectorAll(s));
  RV.n   = v  => parseFloat(v) || 0;

  /* ── Formatting ── */
  RV.fmt    = v  => '$' + RV.n(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  RV.pad    = v  => String(v).padStart(2, '0');
  RV.esc    = s  => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  RV.genId  = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  RV.todayISO = () => new Date().toISOString().split('T')[0];

  RV.fmtDate = d => {
    if (!d) return '—';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { year:'numeric', month:'short', day:'numeric' }); }
    catch (_) { return d; }
  };
  RV.fmtYM = ym => {
    if (!ym) return '—';
    try { const [y, m] = ym.split('-'); return new Date(y, m - 1, 1).toLocaleDateString('en', { month:'long', year:'numeric' }); }
    catch (_) { return ym; }
  };
  RV.fmtTs = ts => ts ? new Date(ts).toLocaleString() : '—';

  RV.groupBy = (arr, key, fn) => {
    const r = {};
    arr.forEach(item => { const k = item[key] || 'Other'; r[k] = (r[k] || 0) + fn(item); });
    return r;
  };

  /* ── Badge class ── */
  RV.badgeClass = cat => ({
    'Fuel':'b-fuel','Meals':'b-meals','Travel':'b-travel','Office Supplies':'b-office',
    'Inventory':'b-inventory','Advertising':'b-advertising','Utilities':'b-utilities',
    'Software':'b-software','Vehicle':'b-vehicle','Insurance':'b-insurance',
    'Rent':'b-rent','Other':'b-other',
  })[cat] || 'b-other';

  /* ── Image resize ── */
  RV.resizeImg = (b64, mime, maxPx = 1400) => new Promise(ok => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c  = document.createElement('canvas');
      c.width  = Math.round(img.width  * sc);
      c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
    };
    img.src = `data:${mime};base64,${b64}`;
  });

  /* ── Toast ── */
  RV.toast = (msg, type = 'info') => {
    const stack = RV.el('toastStack');
    if (!stack) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<div class="toast-dot"></div><span>${RV.esc(msg)}</span>`;
    stack.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'all .25s';
      t.style.opacity    = '0';
      t.style.transform  = 'translateY(6px)';
      setTimeout(() => t.remove(), 260);
    }, 3500);
  };

  /* ── Loading overlay ── */
  RV.showLoad = (m = 'Processing…') => {
    const ov = RV.el('loadingOverlay');
    const lm = RV.el('loadingMsg');
    if (ov) ov.classList.add('show');
    if (lm) lm.textContent = m;
  };
  RV.hideLoad = () => { const ov = RV.el('loadingOverlay'); if (ov) ov.classList.remove('show'); };

  /* ── Modal ── */
  RV.openM  = id => { const e = RV.el(id); if (e) e.classList.add('open'); };
  RV.closeM = id => { const e = RV.el(id); if (e) e.classList.remove('open'); };
  RV.confirm2 = (title, msg, onOk, onCancel) => {
    const te = RV.el('mConfirmTitle'), me = RV.el('mConfirmMsg'), oe = RV.el('mConfirmOk'), ce = RV.el('mConfirmCancel');
    if (!te) return;
    te.textContent = title; me.textContent = msg;
    oe.onclick = () => { onOk && onOk(); RV.closeM('mConfirm'); };
    if (ce) ce.onclick = () => { onCancel && onCancel(); RV.closeM('mConfirm'); };
    RV.openM('mConfirm');
  };

  /* ── Theme ── */
  RV.applyTheme = dark => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const uid = window._fbUser?.uid || 'anon';
    localStorage.setItem(`rv_theme_${uid}`, dark ? 'dark' : 'light');
    const ico = RV.el('themeIco'); if (ico) ico.className = dark ? 'fas fa-sun' : 'fas fa-moon';
    const tog = RV.el('darkToggle'); if (tog) tog.className = 'toggle' + (dark ? ' on' : '');
  };
  RV.toggleTheme = () => RV.applyTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
  RV.loadTheme   = uid => {
    const t = localStorage.getItem(`rv_theme_${uid || 'anon'}`) || 'light';
    document.documentElement.setAttribute('data-theme', t);
    const ico = RV.el('themeIco'); if (ico) ico.className = t === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    const tog = RV.el('darkToggle'); if (tog) tog.className = 'toggle' + (t === 'dark' ? ' on' : '');
  };
  RV.isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

  /* ── Sidebar ── */
  RV.openSidebar = () => {
    const sb = RV.el('sidebar'), ov = RV.el('sidebarOverlay');
    if (sb) sb.classList.add('open');
    if (ov) ov.classList.add('show');
    document.body.style.overflow = 'hidden';
  };
  RV.closeSidebar = () => {
    const sb = RV.el('sidebar'), ov = RV.el('sidebarOverlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
    document.body.style.overflow = '';
  };
  RV.toggleSidebar = () => {
    if (window.innerWidth > 900) {
      const sb = RV.el('sidebar');
      if (sb) sb.classList.toggle('collapsed');
    } else {
      const sb = RV.el('sidebar');
      sb && sb.classList.contains('open') ? RV.closeSidebar() : RV.openSidebar();
    }
  };

  /* ── Download ── */
  RV.dl = (content, name, mime) => {
    const b = new Blob([content], { type: mime });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = name; a.click();
    URL.revokeObjectURL(u);
  };

  /* ── Authenticated API call ── */
  RV.apiCall = async (path, method = 'GET', body = null) => {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not authenticated');
    const token = await user.getIdToken();
    const opts  = {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch((window.RV_CONFIG?.apiBase || '') + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  /* ── Show upgrade modal ── */
  RV.showUpgradeModal = () => {
    const m = RV.el('upgradeModal');
    if (m) RV.openM('upgradeModal');
    else window.location.href = '/client/pricing.html';
  };

})();
