'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'energie_plus',
  user: process.env.DB_USER || 'energie_user',
  password: process.env.DB_PASSWORD || 'change_me_in_prod',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

pool.on('connect', () => {
  console.log('[DB] New client connected to PostgreSQL');
});

module.exports = pool;
