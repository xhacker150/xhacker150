'use strict';

require('dotenv').config();
const express = require('express');
const apiAuth = require('./middleware/apiAuth');

const authRouter = require('./routes/auth');
const cartesRouter = require('./routes/cartes');
const bonsRouter = require('./routes/bons');
const transactionsRouter = require('./routes/transactions');
const rapportsRouter = require('./routes/rapports');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Middlewares globaux ──────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Health check (pas besoin d'API key) ─────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'energie-plus-backend-api', timestamp: new Date().toISOString() });
});

// ── Auth service-to-service pour toutes les routes /api ─────────────────────
app.use('/api', apiAuth);

// ── Routes ───────────────────────────────────────────────────────────────────
// Routes auth : POST /api/v1/auth/verify-pin
app.use('/api/v1/auth', authRouter);

// PATCH /api/v1/utilisateurs/:id/pin — route définie dans auth.js comme
// PATCH /utilisateurs/:id/pin, donc on la monte directement sur /api/v1
// pour que le chemin complet devienne /api/v1/utilisateurs/:id/pin
app.use('/api/v1', authRouter);

app.use('/api/v1/cartes', cartesRouter);
app.use('/api/v1/bons', bonsRouter);
app.use('/api/v1/transactions', transactionsRouter);
app.use('/api/v1/rapports', rapportsRouter);

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route non trouvée.' });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ success: false, error: 'Erreur interne du serveur.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[BACKEND API] En écoute sur le port ${PORT}`);
});

module.exports = app;
