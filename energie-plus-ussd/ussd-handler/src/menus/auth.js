'use strict';

const { verifyPin } = require('../api');
const { setSession } = require('../session');
const { buildMainMenu } = require('./main');

/**
 * Gère l'état AUTH_PIN.
 *
 * Flux :
 *  - text vide  → affiche le prompt PIN
 *  - text non vide → tente l'authentification
 *    - succès   → session créée, retourne le menu principal (CON)
 *    - échec    → END avec message d'erreur
 *
 * @param {string} sessionId
 * @param {string} phoneNumber  - Numéro appelant (utilisé comme identifiant)
 * @param {string} text         - Saisie accumulée
 * @returns {Promise<string>}   - Réponse CON ou END
 */
async function handleAuth(sessionId, phoneNumber, text) {
  // Pas encore de saisie : demande le PIN
  if (!text || text.trim() === '') {
    return 'CON ENERGIE PLUS\nEntrez votre PIN:';
  }

  // Le PIN est le dernier segment saisi
  const parts = text.split('*');
  const pin = parts[parts.length - 1].trim();

  if (!pin) {
    return 'CON ENERGIE PLUS\nEntrez votre PIN:';
  }

  try {
    const result = await verifyPin(phoneNumber, pin);

    if (!result.success) {
      if (result.bloque) {
        return 'END Compte bloque. Contactez votre gerant.';
      }
      return 'END PIN incorrect. Compte bloque apres 3 tentatives.';
    }

    // Authentification réussie : crée la session complète
    const session = {
      state: 'MAIN_MENU',
      userId: result.userId,
      profil: result.profil,
      stationId: result.stationId,
      stationNom: result.stationNom,
      phoneNumber,
    };

    await setSession(sessionId, session);

    return 'CON ' + buildMainMenu(result.profil);
  } catch (err) {
    const data = err.response && err.response.data;
    if (data) {
      if (data.bloque) {
        return 'END Compte bloque. Contactez votre gerant.';
      }
      if (data.tentativesRestantes !== undefined) {
        return `END PIN incorrect. ${data.tentativesRestantes} tentative(s) restante(s).`;
      }
      if (data.error && data.error.toLowerCase().includes('bloque')) {
        return 'END Compte bloque. Contactez votre gerant.';
      }
    }
    if (err.response && err.response.status === 401) {
      return 'END PIN incorrect. Compte bloque apres 3 tentatives.';
    }
    if (err.response && err.response.status === 403) {
      return 'END Compte bloque. Contactez votre gerant.';
    }
    console.error('[auth] Erreur inattendue:', err.message);
    return 'END Service temporairement indisponible. Reessayez.';
  }
}

module.exports = { handleAuth };
