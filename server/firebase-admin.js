'use strict';
const admin = require('firebase-admin');

let app;

function getAdmin() {
  if (app) return app;

  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    // Preferred: single base64-encoded JSON blob
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    credential = admin.credential.cert(JSON.parse(json));
  } else if (process.env.FIREBASE_PROJECT_ID) {
    // Fallback: individual env vars
    credential = admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    });
  } else if (process.env.NODE_ENV !== 'production') {
    // Local dev fallback — try local file
    try {
      const sa = require('../serviceAccount.json');
      credential = admin.credential.cert(sa);
    } catch (_) {
      throw new Error(
        'Firebase Admin: no credentials found. ' +
        'Set FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_PROJECT_ID in .env'
      );
    }
  } else {
    throw new Error('Firebase Admin: FIREBASE_SERVICE_ACCOUNT_BASE64 is required in production.');
  }

  app = admin.initializeApp({ credential });
  return app;
}

// Lazy getters so callers don't have to call initializeApp themselves
const getAuth = () => { getAdmin(); return admin.auth(); };
const getFirestore = () => { getAdmin(); return admin.firestore(); };

module.exports = { getAdmin, getAuth, getFirestore };
