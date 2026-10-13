'use strict';

const path = require('path');
const express = require('express');
const { exigerConnexion, exigerRole, exigerJsonPourEcriture } = require('./middleware/auth');
const creerRouteurAuth = require('./routes/auth');
const creerRouteurStations = require('./routes/stations');
const creerRouteurRapports = require('./routes/rapports');
const creerRouteurReglages = require('./routes/reglages');

// chart.js n'exporte pas son build UMD : on le localise à partir du point d'entrée
const CHEMIN_CHART_JS = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function creerApp({ pool, client, config }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  // ── Santé (sans authentification) ────────────────────────────────────────
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'rps-solar-monitor', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'erreur', service: 'rps-solar-monitor', error: 'Base de données injoignable.' });
    }
  });

  // ── API ──────────────────────────────────────────────────────────────────
  const connexion = exigerConnexion({ pool, config });
  const api = express.Router();
  api.use(exigerJsonPourEcriture);
  api.use('/auth', creerRouteurAuth({ pool, config, exigerConnexion: connexion }));
  api.use(connexion);
  api.use(creerRouteurStations({ pool, config, exigerRole }));
  api.use('/rapports', creerRouteurRapports({ pool }));
  api.use(creerRouteurReglages({ pool, client, config, exigerRole }));
  api.use((_req, res) => res.status(404).json({ success: false, error: 'Route non trouvée.' }));
  app.use('/api', api);

  // ── Tableau de bord ──────────────────────────────────────────────────────
  app.get('/vendor/chart.umd.js', (_req, res) => {
    res.sendFile(CHEMIN_CHART_JS);
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  // ── Erreurs ──────────────────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, error: 'JSON invalide.' });
    }
    console.error('[ERREUR]', err.message);
    res.status(500).json({ success: false, error: 'Erreur interne du serveur.' });
  });

  return app;
}

module.exports = { creerApp };
