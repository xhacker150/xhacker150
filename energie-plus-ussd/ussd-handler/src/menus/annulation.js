'use strict';

const { setSession } = require('../session');
const { getTransaction, annulerTransaction } = require('../api');
const { buildMainMenu } = require('./main');

/**
 * Formate un nombre en FCFA
 */
function fcfa(n) {
  return Number(n).toLocaleString('fr-FR') + ' FCFA';
}

/**
 * Formate une date ISO en DD/MM/YYYY HH:MM
 */
function formatDateTime(isoStr) {
  if (!isoStr) return 'N/A';
  const d = new Date(isoStr);
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const yy = d.getFullYear();
  const hh = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

/**
 * Gère la branche ANNULATION du menu USSD.
 *
 * States gérés:
 *   ANNUL_CODE → saisie code → getTransaction → ANNUL_CONFIRM
 *   ANNUL_CONFIRM → 1=annulerTransaction (END) | 0=MAIN_MENU
 *
 * @param {string} sessionId
 * @param {object} session
 * @param {string} input  - Dernier input
 * @returns {Promise<string>}
 */
async function handleAnnulation(sessionId, session, input) {
  const state = session.state;

  // ── ANNUL_CODE ───────────────────────────────────────────────────────────
  if (state === 'ANNUL_CODE') {
    const code = input.trim().toUpperCase();

    if (!code || code.length !== 6) {
      return 'CON Code confirmation invalide (6 chiffres).\nCode confirmation\na annuler:';
    }

    try {
      const result = await getTransaction(code);

      if (!result.success) {
        return 'END Transaction introuvable.';
      }

      const tx = result.transaction;

      if (tx.statut === 'annulee') {
        return 'END Cette transaction est deja annulee.';
      }

      const dateStr = formatDateTime(tx.cree_le);
      const recap = `Annuler transaction\n${fcfa(tx.montant)} - ${dateStr}\n1.Confirmer  0.Annuler`;

      const newSession = {
        ...session,
        state: 'ANNUL_CONFIRM',
        annulCode: code,
        annulMontant: tx.montant,
        annulDate: tx.cree_le,
        annulType: tx.type,
      };
      await setSession(sessionId, newSession);

      return 'CON ' + recap;
    } catch (err) {
      const status = err.response && err.response.status;
      const data = err.response && err.response.data;

      if (status === 404) return 'END Code de confirmation introuvable.';
      if (data && data.error) return `END ${data.error}`;
      console.error('[annulation] getTransaction error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // ── ANNUL_CONFIRM ────────────────────────────────────────────────────────
  if (state === 'ANNUL_CONFIRM') {
    if (input === '0') {
      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);
      return 'CON ' + buildMainMenu(session.profil);
    }

    if (input !== '1') {
      const dateStr = formatDateTime(session.annulDate);
      const recap = `Annuler transaction\n${fcfa(session.annulMontant)} - ${dateStr}\n1.Confirmer  0.Annuler`;
      return 'CON ' + recap;
    }

    // Confirmation : appelle l'API
    try {
      const result = await annulerTransaction(
        session.annulCode,
        session.userId,
        session.stationId
      );

      if (!result.success) {
        return `END Erreur: ${result.error || 'Annulation echouee.'}`;
      }

      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);

      return `END Transaction annulee!\nCode: ${session.annulCode}\nMontant restitue: ${fcfa(result.montantRestitue)}`;
    } catch (err) {
      const data = err.response && err.response.data;
      if (data && data.error) return `END ${data.error}`;
      console.error('[annulation] annulerTransaction error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // État inconnu → retour menu principal
  const newSession = { ...session, state: 'MAIN_MENU' };
  await setSession(sessionId, newSession);
  return 'CON ' + buildMainMenu(session.profil);
}

module.exports = { handleAnnulation };
