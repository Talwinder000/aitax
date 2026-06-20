/**
 * ReceiptVault AI — Central Configuration
 * Replace placeholder values with your own.
 */
window.RV_CONFIG = {

  /* ── Firebase ── */
  firebase: {
    apiKey:            "AIzaSyDpiUJ3AuoKMHNCTXrTrU4q092kVlrW3dE",
    authDomain:        "receiptvault-ai-b8eb9.firebaseapp.com",
    projectId:         "receiptvault-ai-b8eb9",
    storageBucket:     "receiptvault-ai-b8eb9.firebasestorage.app",
    messagingSenderId: "1075841807835",
    appId:             "1:1075841807835:web:7badd8aba6ab993707e3fe",
  },

  /* ── Backend API ── */
  // Local dev:    http://localhost:3001
  // Production:   https://api.yourdomain.com
  apiBase: 'http://localhost:3001',

  /* ── Stripe ── */
  // Get from https://dashboard.stripe.com/apikeys (publishable key)
  stripePublishableKey: 'pk_test_PASTE_YOUR_STRIPE_PUBLISHABLE_KEY_HERE',

  /* ── Stripe Price IDs (must match server .env) ── */
  prices: {
    plus: 'price_PASTE_YOUR_PLUS_PRICE_ID_HERE',
    pro:  'price_PASTE_YOUR_PRO_PRICE_ID_HERE',
  },

  /* ── Plan definitions ── */
  plans: {
    free: {
      name: 'Free', price: 0, period: null,
      receiptLimit: 200,
      features: ['200 Receipts','AI OCR Scanning','Dashboard','Basic Reports','CSV & JSON Export','Dark Mode','Offline Mode'],
    },
    plus: {
      name: 'Plus', price: 4.99, period: 'month',
      receiptLimit: Infinity,
      features: ['Unlimited Receipts','Everything in Free','Cloud Backup','Cloud Sync','Receipt Image Backup','Monthly PDF Reports','Priority Support'],
    },
    pro: {
      name: 'Pro', price: 9.99, period: 'month',
      receiptLimit: Infinity,
      features: ['Everything in Plus','AI Categorization','AI Receipt Insights','Tax Summary Reports','Accountant Sharing','Vehicle Mileage','Invoice Generator','Advanced Analytics','Future AI Features'],
    },
  },
};
