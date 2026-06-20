/**
 * ReceiptVault AI — Authentication & Passkey Module
 * Exports RV.auth (Firebase auth instance), RV.passkey.*, RV.friendlyErr,
 * RV.fetchSubscription, RV.requireAuth, RV.requireGuest
 * Dispatches 'rv:authReady' custom event when auth state is resolved.
 */
(function () {
  'use strict';

  const RV = window.RV = window.RV || {};

  /* ══════════════════════════════════════════════════
     FIREBASE INIT — idempotent, safe to call multiple times
  ══════════════════════════════════════════════════ */
  if (!firebase.apps.length) {
    firebase.initializeApp(window.RV_CONFIG.firebase);
  }

  // ── THIS is the fix: expose auth instance on RV.auth so all pages can use it ──
  const _auth        = firebase.auth();
  RV.auth            = _auth;          // used by index.html inline scripts
  window._fbAuth     = _auth;          // kept for backward compat
  window._fbUser     = null;
  window._userPlan   = 'free';
  window._subData    = {};

  /* ══════════════════════════════════════════════════
     DIRECT AUTH HELPERS — cleaner than calling RV.auth.* directly
  ══════════════════════════════════════════════════ */
  RV.signIn = (email, pass) =>
    _auth.signInWithEmailAndPassword(email, pass);

  RV.signUp = (email, pass) =>
    _auth.createUserWithEmailAndPassword(email, pass);

  RV.googleSignIn = () =>
    _auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());

  RV.signOut = () => _auth.signOut();

  /* ══════════════════════════════════════════════════
     WEBAUTHN / PASSKEYS
     Frontend-only convenience unlock.
     Firebase session is the real auth; passkeys just skip
     typing. Biometric data NEVER leaves the device.
  ══════════════════════════════════════════════════ */
  const PK_UID  = 'rv_passkey_uid';
  const PK_CRED = 'rv_passkey_cred';

  RV.passkey = {};

  RV.passkey.isSupported = () =>
    !!(window.PublicKeyCredential && navigator.credentials?.create);

  const b64ToBuffer = b64url => {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return buf.buffer;
  };

  const bufToB64 = buf => {
    const bytes = new Uint8Array(buf);
    let raw = '';
    bytes.forEach(b => raw += String.fromCharCode(b));
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  RV.passkey.register = async uid => {
    if (!RV.passkey.isSupported()) return false;
    try {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge:       crypto.getRandomValues(new Uint8Array(32)),
          rp:              { name: 'ReceiptVault AI', id: location.hostname },
          user:            {
            id:          new TextEncoder().encode(uid),
            name:        window._fbUser?.email || uid,
            displayName: 'ReceiptVault User',
          },
          pubKeyCredParams: [
            { alg: -7,   type: 'public-key' },
            { alg: -257, type: 'public-key' },
          ],
          authenticatorSelection: {
            userVerification: 'preferred',
            residentKey:      'preferred',
          },
          timeout:     60000,
          attestation: 'none',
        },
      });
      if (!cred) return false;
      localStorage.setItem(PK_UID,  uid);
      localStorage.setItem(PK_CRED, bufToB64(cred.rawId));
      return true;
    } catch (e) {
      console.warn('[Passkey] Register:', e.name, e.message);
      return false;
    }
  };

  RV.passkey.assert = async () => {
    if (!RV.passkey.isSupported())
      throw new Error('WebAuthn not supported on this browser.');
    const credId = localStorage.getItem(PK_CRED);
    if (!credId)
      throw new Error('No passkey registered. Please log in with email or Google first.');
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge:        crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{
            type:       'public-key',
            id:         b64ToBuffer(credId),
            transports: ['internal', 'hybrid'],
          }],
          userVerification: 'preferred',
          timeout:          60000,
        },
      });
      if (!assertion) throw new Error('Biometric verification was cancelled.');
      return true;
    } catch (e) {
      if (e.name === 'NotAllowedError')
        throw new Error('Biometric login was cancelled or timed out.');
      if (e.name === 'SecurityError')
        throw new Error('Passkey security error. Please try again.');
      throw new Error(e.message || 'Biometric authentication failed.');
    }
  };

  RV.passkey.hasLocal = uid =>
    localStorage.getItem(PK_UID) === uid && !!localStorage.getItem(PK_CRED);

  RV.passkey.removeLocal = () => {
    localStorage.removeItem(PK_UID);
    localStorage.removeItem(PK_CRED);
  };

  RV.passkey.promptSetup = async uid => {
    if (!RV.passkey.isSupported() || !uid || RV.passkey.hasLocal(uid)) return;
    const wrap = document.getElementById('passkeyPromptWrap');
    if (!wrap || wrap.dataset.shown === '1') return;
    wrap.dataset.shown = '1';
    wrap.innerHTML = `
      <div class="passkey-prompt">
        <i class="fas fa-fingerprint"></i>
        <div class="pp-text">
          <strong>Enable Face ID / Fingerprint Login?</strong>
          <span>Sign in faster next time — your biometrics never leave this device.</span>
        </div>
        <div class="pp-acts">
          <button class="btn btn-success btn-sm" onclick="RV.passkey.setup('${uid}')">
            <i class="fas fa-check"></i>Enable
          </button>
          <button class="btn btn-sm" onclick="this.closest('.passkey-prompt').remove()">Not now</button>
        </div>
      </div>`;
  };

  RV.passkey.setup = async uid => {
    const ok   = await RV.passkey.register(uid);
    const wrap = document.getElementById('passkeyPromptWrap');
    if (ok) {
      RV.toast?.('Face ID / Fingerprint login enabled!', 'success');
      if (wrap) wrap.innerHTML = '';
    } else {
      RV.toast?.('Passkey setup was cancelled or failed.', 'warning');
    }
  };

  /* ══════════════════════════════════════════════════
     SUBSCRIPTION FETCH — always from backend
  ══════════════════════════════════════════════════ */
  RV.fetchSubscription = async () => {
    try {
      const data = await RV.apiCall('/api/stripe/subscription');
      window._userPlan = data.plan || 'free';
      window._subData  = data;
      return data;
    } catch (e) {
      // Backend not running (local dev without server) — silently default to free
      console.warn('[Auth] Subscription fetch skipped:', e.message);
      window._userPlan = 'free';
      window._subData  = { plan: 'free', status: 'active', receiptLimit: 200 };
      return window._subData;
    }
  };

  /* ══════════════════════════════════════════════════
     FRIENDLY ERROR MESSAGES
  ══════════════════════════════════════════════════ */
  RV.friendlyErr = (code, fallback) => ({
    'auth/wrong-password':             'Incorrect password.',
    'auth/user-not-found':             'No account found with that email.',
    'auth/invalid-credential':         'Incorrect email or password.',
    'auth/invalid-login-credentials':  'Incorrect email or password.',
    'auth/email-already-in-use':       'Email already in use. Try logging in.',
    'auth/weak-password':              'Password must be at least 6 characters.',
    'auth/invalid-email':              'Please enter a valid email address.',
    'auth/too-many-requests':          'Too many attempts. Please wait a moment.',
    'auth/network-request-failed':     'Network error. Check your internet connection.',
    'auth/popup-closed-by-user':       'Google sign-in was cancelled.',
    'auth/cancelled-popup-request':    'Google sign-in was cancelled.',
    'auth/operation-not-allowed':      'This sign-in method is not enabled in Firebase.',
    'auth/unauthorized-domain':        'This domain is not authorised. Add it in Firebase Console → Authentication → Authorized Domains.',
  })[code] || fallback || 'Something went wrong. Please try again.';

  /* ══════════════════════════════════════════════════
     AUTH STATE OBSERVER
     Fires once immediately with current user (null if not logged in),
     then fires again on every login/logout.
  ══════════════════════════════════════════════════ */
  _auth.onAuthStateChanged(async user => {
    window._fbUser = user;

    if (user) {
      RV.loadTheme?.(user.uid);
      await RV.fetchSubscription();
      // Init user doc in Firestore — silently ignore errors (backend may not be running)
      RV.apiCall('/api/auth/init', 'POST').catch(() => {});
    }

    document.dispatchEvent(new CustomEvent('rv:authReady', { detail: { user } }));
  });

  /* ══════════════════════════════════════════════════
     ROUTE GUARDS
  ══════════════════════════════════════════════════ */
  RV.requireAuth = (redirectTo = 'index.html') => {
    document.addEventListener('rv:authReady', e => {
      if (!e.detail.user) window.location.href = redirectTo;
    }, { once: true });
  };

  RV.requireGuest = (redirectTo = 'dashboard.html') => {
    document.addEventListener('rv:authReady', e => {
      if (e.detail.user) window.location.href = redirectTo;
    }, { once: true });
  };

})();
