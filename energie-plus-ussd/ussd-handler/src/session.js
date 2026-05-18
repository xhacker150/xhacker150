'use strict';

require('dotenv').config();
const Redis = require('ioredis');

const SESSION_TTL = 180; // secondes

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: false,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('[REDIS] Erreur de connexion:', err.message);
});

redis.on('connect', () => {
  console.log('[REDIS] Connecté au serveur Redis');
});

/**
 * Récupère une session USSD depuis Redis.
 * @param {string} sessionId
 * @returns {Promise<object|null>} L'objet session ou null si inexistant/expiré
 */
async function getSession(sessionId) {
  try {
    const raw = await redis.get(`ussd:session:${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[SESSION] getSession error:', err.message);
    return null;
  }
}

/**
 * Sauvegarde une session USSD dans Redis avec TTL de 180 secondes.
 * @param {string} sessionId
 * @param {object} data  - Objet session (state, userId, profil, stationId, stationNom, etc.)
 * @returns {Promise<void>}
 */
async function setSession(sessionId, data) {
  try {
    await redis.set(
      `ussd:session:${sessionId}`,
      JSON.stringify(data),
      'EX',
      SESSION_TTL
    );
  } catch (err) {
    console.error('[SESSION] setSession error:', err.message);
    throw err;
  }
}

/**
 * Supprime une session USSD de Redis.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function deleteSession(sessionId) {
  try {
    await redis.del(`ussd:session:${sessionId}`);
  } catch (err) {
    console.error('[SESSION] deleteSession error:', err.message);
  }
}

module.exports = { getSession, setSession, deleteSession };
