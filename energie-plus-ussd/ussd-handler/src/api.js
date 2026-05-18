'use strict';

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || '';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
  },
});

// Intercepteur pour logger les erreurs
http.interceptors.response.use(
  (response) => response,
  (error) => {
    const msg = error.response
      ? `${error.response.status} - ${JSON.stringify(error.response.data)}`
      : error.message;
    console.error('[API] Erreur:', msg);
    return Promise.reject(error);
  }
);

/**
 * Vérifie le PIN d'un utilisateur.
 * @param {string} telephone
 * @param {string} pin
 * @returns {Promise<{userId, profil, stationId, stationNom}>}
 */
async function verifyPin(telephone, pin) {
  const res = await http.post('/api/v1/auth/verify-pin', { telephone, pin });
  return res.data;
}

/**
 * Récupère les infos d'une carte (numéro masqué + plafonds + consommations).
 * @param {string} numero
 * @returns {Promise<object>}
 */
async function getCarte(numero) {
  const res = await http.get(`/api/v1/cartes/${encodeURIComponent(numero)}`);
  return res.data;
}

/**
 * Récupère le solde d'une carte et les 3 dernières transactions.
 * @param {string} numero
 * @returns {Promise<object>}
 */
async function getSolde(numero) {
  const res = await http.get(`/api/v1/cartes/${encodeURIComponent(numero)}/solde`);
  return res.data;
}

/**
 * Valide une transaction carte (débit).
 * @param {string} numero
 * @param {number} montant
 * @param {string} operateurId
 * @param {string} stationId
 * @returns {Promise<{codeConfirmation, soldeRestant, litres}>}
 */
async function validerCarte(numero, montant, operateurId, stationId) {
  const res = await http.post(`/api/v1/cartes/${encodeURIComponent(numero)}/transactions`, {
    montant,
    operateurId,
    stationId,
  });
  return res.data;
}

/**
 * Récupère les infos d'un bon.
 * @param {string} numero
 * @returns {Promise<object>}
 */
async function getBon(numero) {
  const res = await http.get(`/api/v1/bons/${encodeURIComponent(numero)}`);
  return res.data;
}

/**
 * Consomme un bon carburant.
 * @param {string} numero
 * @param {string} operateurId
 * @param {string} stationId
 * @param {number|null} montant  - Requis pour les bons variables
 * @returns {Promise<{codeConfirmation, montant}>}
 */
async function consommerBon(numero, operateurId, stationId, montant) {
  const body = { operateurId, stationId };
  if (montant !== undefined && montant !== null) {
    body.montant = montant;
  }
  const res = await http.post(`/api/v1/bons/${encodeURIComponent(numero)}/consommer`, body);
  return res.data;
}

/**
 * Récupère une transaction par son code de confirmation.
 * @param {string} code
 * @returns {Promise<object>}
 */
async function getTransaction(code) {
  const res = await http.get(`/api/v1/transactions/${encodeURIComponent(code)}`);
  return res.data;
}

/**
 * Annule une transaction.
 * @param {string} code
 * @param {string} operateurId
 * @param {string} stationId
 * @returns {Promise<object>}
 */
async function annulerTransaction(code, operateurId, stationId) {
  const res = await http.post(`/api/v1/transactions/${encodeURIComponent(code)}/annuler`, {
    operateurId,
    stationId,
  });
  return res.data;
}

/**
 * Effectue la clôture journalière d'une station.
 * @param {string} stationId
 * @param {string} gerantId
 * @param {string} date  - Format YYYY-MM-DD
 * @returns {Promise<object>}
 */
async function cloturer(stationId, gerantId, date) {
  const res = await http.post('/api/v1/rapports/cloture', { stationId, gerantId, date });
  return res.data;
}

/**
 * Change le PIN d'un utilisateur.
 * @param {string} userId
 * @param {string} nouveauPin
 * @returns {Promise<object>}
 */
async function changerPin(userId, nouveauPin) {
  const res = await http.patch(`/api/v1/utilisateurs/${encodeURIComponent(userId)}/pin`, {
    nouveauPin,
  });
  return res.data;
}

module.exports = {
  verifyPin,
  getCarte,
  getSolde,
  validerCarte,
  getBon,
  consommerBon,
  getTransaction,
  annulerTransaction,
  cloturer,
  changerPin,
};
