'use strict';
const express = require('express');
const { getFirestore } = require('../firebase-admin');
const { verifyToken }  = require('../middleware/auth');

const router = express.Router();

/* GET /api/auth/me — returns Firestore user doc */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const db   = getFirestore();
    const snap = await db.collection('users').doc(req.uid).get();
    if (!snap.exists) {
      // Auto-init new user document
      const data = {
        uid: req.uid, email: req.userEmail,
        plan: 'free', receiptCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.collection('users').doc(req.uid).set(data);
      return res.json(data);
    }
    res.json({ uid: req.uid, ...snap.data() });
  } catch (err) {
    console.error('[Auth] /me error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/auth/init — idempotent user init (called at first login) */
router.post('/init', verifyToken, async (req, res) => {
  try {
    const db  = getFirestore();
    const ref = db.collection('users').doc(req.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        uid: req.uid, email: req.userEmail,
        plan: 'free', receiptCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
