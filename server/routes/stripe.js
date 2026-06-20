'use strict';
const express  = require('express');
const Stripe   = require('stripe');
const { getFirestore } = require('../firebase-admin');
const { verifyToken }  = require('../middleware/auth');

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  [process.env.STRIPE_PRICE_PLUS]: 'plus',
  [process.env.STRIPE_PRICE_PRO]:  'pro',
};

const PLAN_LIMITS = { free: 200, plus: Infinity, pro: Infinity };

/* ── helpers ── */
async function upsertUser(uid, email, data) {
  const db   = getFirestore();
  const ref  = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid, email,
      plan: 'free', receiptCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...data,
    });
  } else {
    await ref.update({ updatedAt: new Date().toISOString(), ...data });
  }
}

/* ─────────────────────────────────────────────────
   POST /api/stripe/create-checkout
   Body: { priceId }
   Returns: { url } — Stripe Checkout URL
───────────────────────────────────────────────── */
router.post('/create-checkout', verifyToken, async (req, res) => {
  const { priceId } = req.body;
  if (!priceId) return res.status(400).json({ error: 'priceId is required.' });
  if (![process.env.STRIPE_PRICE_PLUS, process.env.STRIPE_PRICE_PRO].includes(priceId)) {
    return res.status(400).json({ error: 'Invalid price ID.' });
  }

  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5500';

  try {
    // Look up or create Stripe customer
    const db   = getFirestore();
    const snap = await db.collection('users').doc(req.uid).get();
    let customerId = snap.exists ? snap.data().stripeCustomerId : null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    req.userEmail,
        metadata: { firebaseUid: req.uid },
      });
      customerId = customer.id;
      await upsertUser(req.uid, req.userEmail, { stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${clientOrigin}/client/billing.html?session_id={CHECKOUT_SESSION_ID}&status=success`,
      cancel_url:  `${clientOrigin}/client/pricing.html?status=cancelled`,
      subscription_data: {
        metadata: { firebaseUid: req.uid },
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe] create-checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────
   POST /api/stripe/customer-portal
   Returns: { url } — Stripe Customer Portal URL
───────────────────────────────────────────────── */
router.post('/customer-portal', verifyToken, async (req, res) => {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5500';
  try {
    const db   = getFirestore();
    const snap = await db.collection('users').doc(req.uid).get();
    const customerId = snap.exists ? snap.data().stripeCustomerId : null;
    if (!customerId) return res.status(400).json({ error: 'No Stripe customer found. Subscribe first.' });

    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${clientOrigin}/client/billing.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe] customer-portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────
   GET /api/stripe/subscription
   Returns: { plan, status, currentPeriodEnd, cancelAtPeriodEnd, receiptLimit }
───────────────────────────────────────────────── */
router.get('/subscription', verifyToken, async (req, res) => {
  try {
    const db   = getFirestore();
    const snap = await db.collection('users').doc(req.uid).get();
    if (!snap.exists) {
      await upsertUser(req.uid, req.userEmail, {});
      return res.json({ plan: 'free', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, receiptLimit: 200 });
    }
    const d = snap.data();
    const plan = d.plan || 'free';
    res.json({
      plan,
      status:             d.subscriptionStatus || 'active',
      currentPeriodEnd:   d.currentPeriodEnd   || null,
      cancelAtPeriodEnd:  d.cancelAtPeriodEnd  || false,
      receiptLimit:       PLAN_LIMITS[plan] === Infinity ? null : PLAN_LIMITS[plan],
      stripeCustomerId:   d.stripeCustomerId   || null,
    });
  } catch (err) {
    console.error('[Stripe] subscription GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────
   POST /api/stripe/webhook
   Raw body required — configured in server.js
───────────────────────────────────────────────── */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getFirestore();
  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.subscription_data?.metadata?.firebaseUid
          || session.metadata?.firebaseUid;
        if (!uid) { console.warn('[Webhook] No firebaseUid in checkout.session.completed'); break; }

        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = sub.items.data[0]?.price?.id;
        const plan    = PLANS[priceId] || 'free';

        await db.collection('users').doc(uid).set({
          plan,
          stripeCustomerId:    session.customer,
          stripeSubscriptionId: session.subscription,
          subscriptionStatus:  sub.status,
          currentPeriodEnd:    new Date(sub.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd:   sub.cancel_at_period_end,
          updatedAt:           new Date().toISOString(),
        }, { merge: true });

        console.log(`[Webhook] checkout.session.completed → uid=${uid} plan=${plan}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub  = event.data.object;
        const uid  = sub.metadata?.firebaseUid;
        const snap = uid ? null : await db.collection('users')
          .where('stripeSubscriptionId', '==', sub.id).limit(1).get();
        const docId = uid || (snap && !snap.empty ? snap.docs[0].id : null);
        if (!docId) { console.warn('[Webhook] Could not find user for subscription.updated'); break; }

        const priceId = sub.items.data[0]?.price?.id;
        const plan    = PLANS[priceId] || 'free';
        await db.collection('users').doc(docId).update({
          plan,
          subscriptionStatus: sub.status,
          currentPeriodEnd:   new Date(sub.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd:  sub.cancel_at_period_end,
          updatedAt:          new Date().toISOString(),
        });
        console.log(`[Webhook] subscription.updated → ${docId} plan=${plan} status=${sub.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub  = event.data.object;
        const snap = await db.collection('users')
          .where('stripeSubscriptionId', '==', sub.id).limit(1).get();
        if (snap.empty) { console.warn('[Webhook] No user found for subscription.deleted'); break; }
        const docId = snap.docs[0].id;
        await db.collection('users').doc(docId).update({
          plan: 'free', subscriptionStatus: 'canceled',
          stripeSubscriptionId: null, cancelAtPeriodEnd: false,
          updatedAt: new Date().toISOString(),
        });
        console.log(`[Webhook] subscription.deleted → ${docId} downgraded to free`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const snap    = await db.collection('users')
          .where('stripeCustomerId', '==', invoice.customer).limit(1).get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({ subscriptionStatus: 'past_due', updatedAt: new Date().toISOString() });
          console.log(`[Webhook] invoice.payment_failed → ${snap.docs[0].id}`);
        }
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error('[Webhook] Handler error:', err.message);
    return res.status(500).send('Webhook handler error');
  }

  res.json({ received: true });
});

module.exports = router;
