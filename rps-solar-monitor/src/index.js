'use strict';

const { config, verifierConfigServeur } = require('./config');
const { creerPool, appliquerSchema } = require('./db/pool');
const { FsolarClient } = require('./fsolar/client');
const { creerApp } = require('./app');
const { demarrerCollecte } = require('./collecteur');

async function demarrer() {
  verifierConfigServeur();

  const pool = creerPool(config.db);
  await appliquerSchema(pool);
  console.log('[DB] Schéma à jour');

  const client = new FsolarClient(config.fsolar);
  const app = creerApp({ pool, client, config });

  const serveur = app.listen(config.port, () => {
    console.log(`[RPS SOLAIRE] Tableau de bord sur le port ${config.port}`);
  });

  const arreterCollecte = config.collecte.active
    ? demarrerCollecte({ client, pool, config })
    : () => {};
  if (!config.collecte.active) console.log('[COLLECTE] Désactivée (COLLECTE_ACTIVE=false)');

  const arreter = (signal) => {
    console.log(`[RPS SOLAIRE] ${signal} reçu, arrêt…`);
    arreterCollecte();
    serveur.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => arreter('SIGTERM'));
  process.on('SIGINT', () => arreter('SIGINT'));
}

demarrer().catch((err) => {
  console.error('[RPS SOLAIRE] Démarrage impossible :', err.message);
  process.exit(1);
});
