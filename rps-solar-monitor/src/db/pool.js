'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function creerPool(db) {
  const pool = new Pool({
    ...db,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error('[DB] Erreur sur un client inactif :', err.message);
  });
  return pool;
}

/** Applique database/schema.sql (idempotent). */
async function appliquerSchema(pool) {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { creerPool, appliquerSchema };
