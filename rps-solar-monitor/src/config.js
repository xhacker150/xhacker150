'use strict';

require('dotenv').config();
const { analyserFuseau } = require('./temps');

// Clé publique RSA publiée dans la documentation fSolar (endpoint /openApi/sec/login).
const CLE_PUBLIQUE_FSOLAR_DEFAUT =
  'MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAK0GDivaRzIKeTmQnAxAYh2LChuHWDp0yHZ0zIvm+Eoi7J+rx7phqR7EtkBDO3HWqAXVkNDeeQaU32P5w1Q4FVUCAwEAAQ==';

function entier(nom, defaut) {
  const brut = process.env[nom];
  if (brut === undefined || brut === '') return defaut;
  const n = parseInt(brut, 10);
  if (Number.isNaN(n)) throw new Error(`Variable ${nom} invalide : "${brut}" n'est pas un entier.`);
  return n;
}

function fuseau(nom, defaut) {
  const brut = process.env[nom] || defaut;
  const minutes = analyserFuseau(brut);
  if (minutes === null) throw new Error(`Variable ${nom} invalide : "${brut}" (exemple : +01:00).`);
  return minutes;
}

const config = {
  port: entier('PORT', 3100),
  env: process.env.NODE_ENV || 'development',
  // À activer derrière un reverse proxy (nginx, Traefik) pour avoir la vraie IP client
  trustProxy: process.env.TRUST_PROXY === 'true',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: entier('DB_PORT', 5432),
    database: process.env.DB_NAME || 'rps_solaire',
    user: process.env.DB_USER || 'rps_solaire',
    password: process.env.DB_PASSWORD || 'change_me_in_prod',
  },

  // Fuseau des stations quand fSolar n'en donne pas (Niger : UTC+1, sans heure d'été)
  fuseauDefautMinutes: fuseau('FUSEAU_DEFAUT', '+01:00'),

  jwtSecret: process.env.JWT_SECRET || '',
  sessionHeures: entier('SESSION_HEURES', 12),
  // Cookie de session en HTTPS uniquement (désactiver seulement en local sans HTTPS)
  cookieSecurise: (process.env.COOKIE_SECURE || (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',

  fsolar: {
    baseUrl: (process.env.FSOLAR_BASE_URL || 'https://open-api.felicitysolar.com').replace(/\/+$/, ''),
    utilisateur: process.env.FSOLAR_USERNAME || '',
    motDePasse: process.env.FSOLAR_PASSWORD || '',
    clePublique: process.env.FSOLAR_PUBLIC_KEY || CLE_PUBLIQUE_FSOLAR_DEFAUT,
    langue: process.env.FSOLAR_LANG || 'en_US',
    // La doc fSolar place les paramètres des GET dans un corps form-data.
    // "both" les envoie dans l'URL ET dans le corps ; "query" ou "body" pour forcer.
    modeParametresGet: process.env.FSOLAR_GET_PARAMS || 'both',
    timeoutMs: entier('FSOLAR_TIMEOUT_MS', 30000),
  },

  collecte: {
    active: (process.env.COLLECTE_ACTIVE || 'true') !== 'false',
    // Intervalles en secondes
    inventaireSec: entier('COLLECTE_INVENTAIRE_SEC', 3600),
    mesuresSec: entier('COLLECTE_MESURES_SEC', 300),
    energieSec: entier('COLLECTE_ENERGIE_SEC', 1800),
    evenementsSec: entier('COLLECTE_EVENEMENTS_SEC', 900),
    verificationSec: entier('COLLECTE_VERIFICATION_SEC', 60),
    // Une mesure plus vieille que ce délai => onduleur considéré hors ligne
    horsLigneMinutes: entier('HORS_LIGNE_MINUTES', 20),
  },

  reglages: {
    // Délai avant relecture des réglages pour vérifier qu'une commande a été appliquée
    delaiVerificationSec: entier('REGLAGES_DELAI_VERIFICATION_SEC', 120),
    // Abandon de la vérification après ce délai (statut "non_verifiee")
    delaiAbandonMinutes: entier('REGLAGES_DELAI_ABANDON_MIN', 30),
  },
};

function verifierConfigServeur() {
  const manquants = [];
  if (!config.jwtSecret || config.jwtSecret.length < 32) manquants.push('JWT_SECRET (32 caractères minimum)');
  if (config.collecte.active) {
    if (!config.fsolar.utilisateur) manquants.push('FSOLAR_USERNAME');
    if (!config.fsolar.motDePasse) manquants.push('FSOLAR_PASSWORD');
  }
  if (!['both', 'query', 'body'].includes(config.fsolar.modeParametresGet)) {
    manquants.push('FSOLAR_GET_PARAMS (both | query | body)');
  }
  if (manquants.length) {
    throw new Error(`Configuration incomplète : ${manquants.join(', ')}. Voir .env.example.`);
  }
}

module.exports = { config, verifierConfigServeur };
