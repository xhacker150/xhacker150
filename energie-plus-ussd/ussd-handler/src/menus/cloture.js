'use strict';

const { setSession } = require('../session');
const { cloturer } = require('../api');
const { buildMainMenu } = require('./main');

/**
 * Formate un nombre en FCFA
 */
function fcfa(n) {
  return Number(n).toLocaleString('fr-FR') + ' FCFA';
}

/**
 * Formate une date ISO (YYYY-MM-DD) en DD/MM/YYYY
 */
function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Gère la branche CLOTURE du menu USSD.
 * Réservée aux gérants et admins.
 *
 * States gérés:
 *   CLOTURE_CONFIRM → 1=cloturer (END avec récap) | 0=MAIN_MENU
 *
 * @param {string} sessionId
 * @param {object} session
 * @param {string} input  - Dernier input
 * @returns {Promise<string>}
 */
async function handleCloture(sessionId, session, input) {
  const state = session.state;

  // Vérification du profil (sécurité côté USSD)
  if (session.profil !== 'gerant' && session.profil !== 'admin') {
    const newSession = { ...session, state: 'MAIN_MENU' };
    await setSession(sessionId, newSession);
    return 'CON Acces refuse.\n' + buildMainMenu(session.profil);
  }

  // ── CLOTURE_CONFIRM ──────────────────────────────────────────────────────
  if (state === 'CLOTURE_CONFIRM') {
    if (input === '0') {
      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);
      return 'CON ' + buildMainMenu(session.profil);
    }

    if (input !== '1') {
      const dateFormatee = formatDate(session.clotureDate);
      return `CON Cloturer la caisse\ndu ${dateFormatee}?\n1.Oui  0.Non`;
    }

    // Confirmer : appelle l'API
    const dateStr = session.clotureDate || new Date().toISOString().split('T')[0];

    try {
      const result = await cloturer(session.stationId, session.userId, dateStr);

      if (!result.success) {
        return `END Erreur: ${result.error || 'Cloture echouee.'}`;
      }

      const c = result.cloture;
      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);

      const msg = [
        `Cloture du ${formatDate(dateStr)}`,
        `Station: ${c.station_nom || session.stationNom}`,
        `Nb transactions: ${c.nb_transactions}`,
        `Total cartes: ${fcfa(c.total_cartes)}`,
        `Total bons: ${fcfa(c.total_bons)}`,
        `TOTAL: ${fcfa(c.total_general)}`,
      ].join('\n');

      return 'END ' + msg;
    } catch (err) {
      const data = err.response && err.response.data;
      if (data && data.error) return `END ${data.error}`;
      console.error('[cloture] cloturer error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // État inconnu → retour menu principal
  const newSession = { ...session, state: 'MAIN_MENU' };
  await setSession(sessionId, newSession);
  return 'CON ' + buildMainMenu(session.profil);
}

module.exports = { handleCloture };
