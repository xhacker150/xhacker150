'use strict';

const { setSession } = require('../session');
const { changerPin } = require('../api');
const { buildMainMenu } = require('./main');

/**
 * Gère la branche MON COMPTE du menu USSD.
 *
 * States gérés:
 *   COMPTE_MENU → 1=NOUVEAU_PIN | 0=MAIN_MENU
 *   NOUVEAU_PIN → saisie → CONFIRM_PIN
 *   CONFIRM_PIN → si égaux → changerPin (END) | sinon → NOUVEAU_PIN
 *
 * @param {string} sessionId
 * @param {object} session
 * @param {string} input  - Dernier input
 * @returns {Promise<string>}
 */
async function handleCompte(sessionId, session, input) {
  const state = session.state;

  // ── COMPTE_MENU ──────────────────────────────────────────────────────────
  if (state === 'COMPTE_MENU') {
    switch (input) {
      case '1': {
        const newSession = { ...session, state: 'NOUVEAU_PIN' };
        await setSession(sessionId, newSession);
        return 'CON Nouveau PIN (4 chiffres):';
      }
      case '0': {
        const newSession = { ...session, state: 'MAIN_MENU' };
        await setSession(sessionId, newSession);
        return 'CON ' + buildMainMenu(session.profil);
      }
      default:
        return 'CON Option invalide.\nMon compte\n1.Changer PIN\n0.Retour';
    }
  }

  // ── NOUVEAU_PIN ──────────────────────────────────────────────────────────
  if (state === 'NOUVEAU_PIN') {
    const nouveauPin = input.trim();

    if (!/^\d{4}$/.test(nouveauPin)) {
      return 'CON PIN invalide (4 chiffres requis).\nNouveau PIN (4 chiffres):';
    }

    const newSession = { ...session, state: 'CONFIRM_PIN', nouveauPin };
    await setSession(sessionId, newSession);
    return 'CON Confirmer nouveau PIN:';
  }

  // ── CONFIRM_PIN ──────────────────────────────────────────────────────────
  if (state === 'CONFIRM_PIN') {
    const confirmPin = input.trim();

    if (confirmPin !== session.nouveauPin) {
      // PIN non concordants : retour à la saisie
      const newSession = { ...session, state: 'NOUVEAU_PIN', nouveauPin: undefined };
      await setSession(sessionId, newSession);
      return 'CON PIN non concordants.\nNouveau PIN (4 chiffres):';
    }

    // Les deux PIN correspondent : appelle l'API
    try {
      const result = await changerPin(session.userId, session.nouveauPin);

      if (!result.success) {
        return `END Erreur: ${result.error || 'Changement de PIN echoue.'}`;
      }

      // Nettoie le nouveauPin de la session, retour au menu principal
      const newSession = { ...session, state: 'MAIN_MENU', nouveauPin: undefined };
      await setSession(sessionId, newSession);

      return 'END PIN modifie avec succes.';
    } catch (err) {
      const data = err.response && err.response.data;
      if (data && data.error) return `END ${data.error}`;
      console.error('[compte] changerPin error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // État inconnu → retour menu principal
  const newSession = { ...session, state: 'MAIN_MENU' };
  await setSession(sessionId, newSession);
  return 'CON ' + buildMainMenu(session.profil);
}

module.exports = { handleCompte };
