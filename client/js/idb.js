/**
 * ReceiptVault AI — IndexedDB Layer
 * Exports RV.idb.*
 */
(function () {
  'use strict';

  const RV = window.RV = window.RV || {};
  RV.idb = {};

  const IDB_NAME  = 'ReceiptVaultDB';
  const IDB_VER   = 1;
  const IDB_STORE = 'receipts';

  let _db = null;

  RV.idb.open = () => new Promise((res, rej) => {
    if (_db) return res(_db);
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const s = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        s.createIndex('uid',      'uid',         { unique: false });
        s.createIndex('uid_date', ['uid','date'], { unique: false });
      }
    };
    req.onsuccess = e => { _db = e.target.result; res(_db); };
    req.onerror   = e => rej(e.target.error);
  });

  const store = m => _db.transaction(IDB_STORE, m).objectStore(IDB_STORE);

  RV.idb.getAll = uid => new Promise((res, rej) => {
    const r = store('readonly').index('uid').getAll(uid);
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });

  RV.idb.put = rec => new Promise((res, rej) => {
    const r = store('readwrite').put(rec);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });

  RV.idb.del = id => new Promise((res, rej) => {
    const r = store('readwrite').delete(id);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });

  RV.idb.bulkPut = recs => new Promise((res, rej) => {
    if (!recs.length) return res();
    const s = store('readwrite');
    let done = 0;
    recs.forEach(r => {
      const req = s.put(r);
      req.onsuccess = () => { done++; if (done === recs.length) res(); };
      req.onerror   = () => rej(req.error);
    });
  });

  RV.idb.normalizeRec = (r, uid) => ({
    id: r.id || RV.genId(), uid,
    image: r.image || '', vendor: r.vendor || 'Unknown',
    date: r.date || RV.todayISO(), total: RV.n(r.total),
    subtotal: RV.n(r.subtotal), tax: RV.n(r.tax),
    category: r.category || 'Other', paymentMethod: r.paymentMethod || 'Other',
    ocrText: r.ocrText || '', receiptNumber: r.receiptNumber || '',
    notes: r.notes || '', savedAt: r.savedAt || new Date().toISOString(),
  });

  RV.idb.migrateFromLS = async uid => {
    const flag = `rv_migrated_${uid}`;
    if (localStorage.getItem(flag) === '1') return;
    const lsKey = `receiptvault_receipts_${uid}`;
    let old = [];
    try { old = JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch (_) {}
    if (!old.length) { localStorage.setItem(flag, '1'); return; }
    try {
      const existing = await RV.idb.getAll(uid);
      const ids      = new Set(existing.map(r => r.id));
      const toAdd    = old.filter(r => r && !ids.has(r.id)).map(r => RV.idb.normalizeRec(r, uid));
      await RV.idb.bulkPut(toAdd);
      localStorage.setItem(flag, '1');
      if (toAdd.length) RV.toast(`Migrated ${toAdd.length} receipt${toAdd.length !== 1 ? 's' : ''} to IndexedDB`, 'success');
    } catch (e) {
      console.error('IDB migration failed, will retry:', e);
      // Do NOT set migrated flag — retry on next boot
    }
  };

})();
