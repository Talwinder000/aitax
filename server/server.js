'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const stripeRoutes = require('./routes/stripe');
const authRoutes   = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ── CORS ── */
const allowedOrigins = [
  process.env.CLIENT_ORIGIN || 'http://localhost:5500',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS policy: origin ${origin} not allowed.`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

/* ── Stripe webhook MUST receive raw body — mount BEFORE json() ── */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

/* ── Body parsers ── */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* ── Routes ── */
app.use('/api/stripe', stripeRoutes);
app.use('/api/auth',   authRoutes);

/* ── Health check ── */
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

/* ── Serve frontend static files in production ── */
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client')));
  app.get('*', (_req, res) =>
    res.sendFile(path.join(__dirname, '../client/index.html'))
  );
}

/* ── 404 ── */
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

/* ── Error handler ── */
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 ReceiptVault AI server running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Client origin: ${process.env.CLIENT_ORIGIN || 'http://localhost:5500'}\n`);
});

module.exports = app;
