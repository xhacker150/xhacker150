'use strict';

const { setSession } = require('../session');
const { getBon, consommerBon } = require('../api');
const { buildMainMenu } = require('./main');

/**
 * Formate un nombre en FCFA
 */
function fcfa(n) {
  return Number(n).toLocaleString('fr-FR') + ' FCFA';
}

/**
 * Gère la branche BON du menu USSD.
 *
 * States gérés:
 *   BON_NUM → appel getBon → BON_RECAP
 *   BON_RECAP → 1=consommerBon (END) | 0=MAIN_MENU
 *
 * @param {string} sessionId
 * @param {object} session
 * @param {string} input  - Dernier input
 * @returns {Promise<string>}
 */
async function handleBon(sessionId, session, input) {
  const state = session.state;

  // ── BON_NUM ──────────────────────────────────────────────────────────────
  if (state === 'BON_NUM') {
    const numeroBon = input.trim();

    if (!numeroBon) {
      return 'CON N° bon:';
    }

    try {
      const result = await getBon(numeroBon);

      if (!result.success) {
        return `END ${result.error || 'Bon invalide.'}`;
      }

      const bon = result.bon;
      const montantAffiche = bon.type === 'fixe'
        ? fcfa(bon.montant)
        : `variable (max ${fcfa(bon.montant_max)})`;

      const entrepriseNom = bon.entreprise_nom || 'N/A';
      const recap = `Bon: ${bon.numero}\nEntreprise: ${entrepriseNom}\nMontant: ${montantAffiche}\n1.Confirmer  0.Annuler`;

      const newSession = {
        ...session,
        state: 'BON_RECAP',
        numeroBon,
        bonMontant: bon.montant,
        bonType: bon.type,
        bonMontantMax: bon.montant_max,
        bonEntrepriseNom: entrepriseNom,
      };
      await setSession(sessionId, newSession);

      return 'CON ' + recap;
    } catch (err) {
      const status = err.response && err.response.status;
      const data = err.response && err.response.data;

      if (status === 404) return 'END Bon introuvable.';
      if (data && data.error) return `END ${data.error}`;
      console.error('[bon] getBon error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // ── BON_RECAP ────────────────────────────────────────────────────────────
  if (state === 'BON_RECAP') {
    if (input === '0') {
      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);
      return 'CON ' + buildMainMenu(session.profil);
    }

    if (input !== '1') {
      const montantAffiche = session.bonType === 'fixe'
        ? fcfa(session.bonMontant)
        : `variable (max ${fcfa(session.bonMontantMax)})`;
      const recap = `Bon: ${session.numeroBon}\nEntreprise: ${session.bonEntrepriseNom}\nMontant: ${montantAffiche}\n1.Confirmer  0.Annuler`;
      return 'CON ' + recap;
    }

    // Confirmer : appelle l'API
    try {
      const montantPourVariable = session.bonType === 'variable' ? session.bonMontantMax : null;

      const result = await consommerBon(
        session.numeroBon,
        session.userId,
        session.stationId,
        montantPourVariable
      );

      if (!result.success) {
        return `END Erreur: ${result.error || 'Consommation echouee.'}`;
      }

      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);

      return `END Bon consomme!\nCode: ${result.codeConfirmation}\nMontant: ${fcfa(result.montant)}\nBon: ${result.bon.numero}`;
    } catch (err) {
      const data = err.response && err.response.data;
      if (data && data.error) return `END ${data.error}`;
      console.error('[bon] consommerBon error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // État inconnu → retour menu principal
  const newSession = { ...session, state: 'MAIN_MENU' };
  await setSession(sessionId, newSession);
  return 'CON ' + buildMainMenu(session.profil);
}

module.exports = { handleBon };
