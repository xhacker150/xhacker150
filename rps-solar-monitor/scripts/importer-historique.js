#!/usr/bin/env node
'use strict';

/**
 * Importe l'historique d'énergie journalière depuis fSolar.
 *   node scripts/importer-historique.js [nbMois=12] [deviceSn …]
 * Sans numéro de série : tous les onduleurs connus (lancer d'abord une collecte d'inventaire).
 */

const { config } = require('../src/config');
const { creerPool, appliquerSchema } = require('../src/db/pool');
const { FsolarClient } = require('../src/fsolar/client');
const { synchroniserInventaire, importerHistoriqueEnergie } = require('../src/collecteur/synchronisation');

async function main() {
  const [nbMoisArg, ...sns] = process.argv.slice(2);
  const nbMois = parseInt(nbMoisArg || '12', 10);
  if (!Number.isInteger(nbMois) || nbMois < 1 || nbMois > 60) {
    console.error('nbMois doit être un entier entre 1 et 60.');
    process.exit(1);
  }
  const pool = creerPool(config.db);
  const client = new FsolarClient(config.fsolar);
  const ctx = { pool, client, config };
  try {
    await appliquerSchema(pool);
    let liste = sns;
    if (!liste.length) {
      await synchroniserInventaire(ctx);
      liste = (await pool.query('SELECT device_sn FROM onduleurs ORDER BY device_sn')).rows.map((r) => r.device_sn);
    }
    for (const sn of liste) {
      try {
        const nb = await importerHistoriqueEnergie(ctx, sn, nbMois);
        console.log(`${sn} : ${nb} jour(s) importé(s)`);
      } catch (err) {
        console.error(`${sn} : échec — ${err.message}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
