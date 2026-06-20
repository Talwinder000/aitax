'use strict';
const { getAuth } = require('../firebase-admin');

/**
 * Express middleware — verifies Firebase ID token from Authorization header.
 * Sets req.uid and req.userEmail on success.
 */
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.uid       = decoded.uid;
    req.userEmail = decoded.email || '';
    next();
  } catch (err) {
    console.error('[Auth] Token verify failed:', err.code || err.message);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { verifyToken };
