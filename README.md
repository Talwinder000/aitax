# ReceiptVault AI — Production SaaS

Smart AI Receipt & Expense Manager with Stripe subscriptions, Firebase Auth, WebAuthn passkeys, Gemini Vision OCR, and IndexedDB.

---

## 📁 Project Structure

```
receiptvault-ai/
├── client/                  ← Frontend (vanilla JS, no build step)
│   ├── index.html           ← Login / Sign-up page
│   ├── dashboard.html       ← Main SPA (dashboard, receipts, analytics, reports, settings)
│   ├── pricing.html         ← Pricing page with Stripe checkout
│   ├── billing.html         ← Billing management + Stripe portal
│   ├── css/
│   │   └── app.css          ← Complete design system
│   └── js/
│       ├── config.js        ← Firebase config, Stripe PK, plan metadata
│       ├── utils.js         ← Shared utilities (exported to window.RV.*)
│       ├── idb.js           ← IndexedDB layer with LS migration
│       ├── auth.js          ← Firebase auth, WebAuthn passkeys, subscription fetch
│       └── app.js           ← Main SPA logic (charts, OCR, CRUD, reports)
├── server/
│   ├── server.js            ← Express entry point
│   ├── firebase-admin.js    ← Firebase Admin SDK singleton
│   ├── middleware/
│   │   └── auth.js          ← Bearer token verification
│   └── routes/
│       ├── stripe.js        ← Stripe checkout, portal, webhooks, subscription status
│       └── auth.js          ← User init + /me endpoint
├── package.json
├── .env.example             ← Environment variable template
├── .gitignore
└── README.md
```

---

## 🚀 Quick Start (Local Development)

### 1. Clone and install

```bash
git clone <your-repo>
cd receiptvault-ai
npm install
```

### 2. Copy and fill in environment variables

```bash
cp .env.example .env
# Edit .env with your real values (see sections below)
```

### 3. Start the backend

```bash
npm run dev          # uses nodemon for auto-restart
# OR
npm start            # production
```

Server starts at http://localhost:3001

### 4. Open the frontend

Serve the `client/` folder with any static file server:

```bash
# Option A: VS Code Live Server (recommended for dev)
# Right-click client/index.html → Open with Live Server

# Option B: Python
cd client && python3 -m http.server 5500

# Option C: npx serve
npx serve client -p 5500
```

Open http://localhost:5500

---

## 🔥 Firebase Setup

### Create a Firebase project

1. Go to https://console.firebase.google.com
2. Create a new project
3. Enable **Authentication** → **Sign-in methods**:
   - Email/Password ✓
   - Google ✓

### Add your web app

1. Firebase Console → Project Settings → General → Your apps → Add app (Web)
2. Copy the `firebaseConfig` object
3. Paste it into `client/js/config.js` replacing the placeholder values

### Get Admin SDK credentials

1. Firebase Console → Project Settings → **Service accounts**
2. Click **Generate new private key** → Download JSON
3. Base64-encode it:
   ```bash
   # macOS / Linux
   base64 -i serviceAccount.json | tr -d '\n'
   
   # Windows (PowerShell)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('serviceAccount.json'))
   ```
4. Paste the result as `FIREBASE_SERVICE_ACCOUNT_BASE64` in `.env`

### Authorize your domain (required for Google login)

Firebase Console → Authentication → Settings → **Authorized domains**  
Add your production domain (e.g., `yourapp.com`)  
For GitHub Pages: add `your-username.github.io`

---

## 💳 Stripe Setup

### Create a Stripe account

Sign up at https://stripe.com

### Get your API keys

Stripe Dashboard → Developers → **API keys**:
- `STRIPE_SECRET_KEY` = Secret key (starts with `sk_test_` or `sk_live_`)
- `STRIPE_PUBLISHABLE_KEY` = Publishable key (starts with `pk_test_` or `pk_live_`)

Paste both into `.env` and also paste the publishable key into `client/js/config.js`.

### Create subscription products

Stripe Dashboard → **Products** → Add product:

**Plus Plan**
- Name: ReceiptVault Plus
- Pricing: Recurring · $4.99/month
- Copy the **Price ID** (starts with `price_`) → paste as `STRIPE_PRICE_PLUS` in `.env`
- Also paste as `RV_CONFIG.prices.plus` in `client/js/config.js`

**Pro Plan**
- Name: ReceiptVault Pro
- Pricing: Recurring · $9.99/month
- Copy the **Price ID** → paste as `STRIPE_PRICE_PRO` in `.env`
- Also paste as `RV_CONFIG.prices.pro` in `client/js/config.js`

### Configure webhooks

#### Local development (Stripe CLI)

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3001/api/stripe/webhook
# Copy the webhook signing secret that appears → paste as STRIPE_WEBHOOK_SECRET in .env
```

#### Production

Stripe Dashboard → Developers → **Webhooks** → Add endpoint:
- URL: `https://your-backend.com/api/stripe/webhook`
- Events to listen to:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Copy the **Signing secret** → paste as `STRIPE_WEBHOOK_SECRET` in `.env`

### Configure Customer Portal

Stripe Dashboard → **Settings** → **Billing** → **Customer portal**:
- Enable the features you want (cancel, download invoices, update card)
- Save settings

---

## 🤖 Gemini API Key

1. Go to https://aistudio.google.com/apikey
2. Create an API key
3. Users paste their own key in Settings inside the app
   (The key is stored in their browser's localStorage, never on your server)

---

## 🌐 Deploying to Production

### Deploy backend to Railway / Render / Fly.io

**Railway** (recommended — free tier available):
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up
```
Set all environment variables in the Railway dashboard.

**Render:**
1. Connect your GitHub repo
2. Set Build Command: `npm install`
3. Set Start Command: `npm start`
4. Add all environment variables in the Render dashboard

### Deploy frontend to Netlify / Vercel / GitHub Pages

The frontend is plain HTML/CSS/JS — no build step required.

**GitHub Pages:**
1. Push the `client/` folder contents to a `gh-pages` branch (or root of a repo)
2. Enable GitHub Pages in repo Settings → Pages
3. Update `CLIENT_ORIGIN` in `.env` to `https://your-username.github.io/repo-name`
4. Update `RV_CONFIG.apiBase` in `client/js/config.js` to your backend URL
5. Add your GitHub Pages domain in Firebase Console → Authorized domains

**Netlify:**
```bash
netlify deploy --dir client --prod
```

---

## 🔐 Face ID / Fingerprint (WebAuthn Passkeys)

Passkeys work automatically with no configuration needed.

**What happens:**
1. User logs in with email/password or Google (Firebase handles authentication)
2. After first login, the app prompts: "Enable Face ID / Fingerprint?"
3. If accepted, a WebAuthn credential is created and stored locally
4. On future visits, user can tap "Login with Face ID / Fingerprint" to skip the form

**Supported devices:**
- iPhone / iPad — Face ID / Touch ID
- Android — Fingerprint / Face Unlock
- Mac — Touch ID
- Windows — Windows Hello (fingerprint, face, PIN)

**Important notes:**
- Biometrics **never leave the device** — WebAuthn is a W3C standard that keeps biometrics local
- The passkey is a convenience unlock for users whose Firebase session is still active
- If the Firebase session expires, the user must re-authenticate with email/Google

---

## 🗄️ Firestore Data Structure

```
users/{uid}
  uid: string
  email: string
  plan: 'free' | 'plus' | 'pro'
  receiptCount: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  subscriptionStatus: 'active' | 'past_due' | 'canceled' | null
  currentPeriodEnd: ISO string | null
  cancelAtPeriodEnd: boolean
  createdAt: ISO string
  updatedAt: ISO string
```

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6) |
| Charts | Chart.js 4.x |
| Icons | Font Awesome 6 |
| Auth | Firebase Authentication |
| Storage | IndexedDB (offline-first) |
| OCR | Google Gemini Vision API |
| Payments | Stripe (Checkout + Customer Portal + Webhooks) |
| Backend | Node.js + Express |
| Database | Firebase Firestore |
| Auth verification | Firebase Admin SDK |

---

## 🔧 Environment Variables Reference

| Variable | Description |
|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Base64-encoded Firebase service account JSON |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (also in `client/js/config.js`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_PRICE_PLUS` | Stripe Price ID for Plus plan |
| `STRIPE_PRICE_PRO` | Stripe Price ID for Pro plan |
| `PORT` | Server port (default: 3001) |
| `CLIENT_ORIGIN` | Frontend URL for CORS (no trailing slash) |

---

## ⚠️ Security Notes

- **Never** commit `.env` to version control
- **Never** verify subscription status on the frontend — always use `/api/stripe/subscription`
- **Never** store card information — Stripe handles all payment data
- Firebase ID tokens expire after 1 hour; the SDK auto-refreshes them
- Always verify tokens using Firebase Admin SDK in backend middleware

---

## 📄 License

MIT — free for personal and commercial use.
