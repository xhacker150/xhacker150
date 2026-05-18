'use strict';

const { setSession } = require('../session');

/**
 * Construit le texte du menu principal selon le profil.
 * Pompistes ne voient pas l'option 4 (Clôture).
 *
 * @param {string} profil - 'pompiste' | 'gerant' | 'admin'
 * @returns {string}
 */
function buildMainMenu(profil) {
  const voitCloture = profil === 'gerant' || profil === 'admin';

  let menu = 'Menu principal\n';
  menu += '1.Carte carburant\n';
  menu += '2.Bon carburant\n';
  menu += '3.Annulation\n';
  if (voitCloture) {
    menu += '4.Cloture\n';
  }
  menu += '5.Mon compte\n';
  menu += '0.Quitter';
  return menu;
}

/**
 * Gère les interactions depuis le MAIN_MENU.
 *
 * @param {string} sessionId
 * @param {object} session   - Session courante
 * @param {string} input     - Dernier input utilisateur
 * @returns {Promise<string>}
 */
async function handleMain(sessionId, session, input) {
  const voitCloture = session.profil === 'gerant' || session.profil === 'admin';

  switch (input) {
    case '1': {
      // Carte carburant
      const newSession = { ...session, state: 'CARTE_MENU' };
      await setSession(sessionId, newSession);
      return 'CON Carte carburant\n1.Valider transaction\n2.Consulter solde\n0.Retour';
    }

    case '2': {
      // Bon carburant
      const newSession = { ...session, state: 'BON_NUM' };
      await setSession(sessionId, newSession);
      return 'CON N° bon:';
    }

    case '3': {
      // Annulation
      const newSession = { ...session, state: 'ANNUL_CODE' };
      await setSession(sessionId, newSession);
      return 'CON Code confirmation\na annuler:';
    }

    case '4': {
      // Clôture (gérant/admin seulement)
      if (!voitCloture) {
        return 'CON Option invalide.\n' + buildMainMenu(session.profil);
      }
      const today = new Date().toISOString().split('T')[0];
      const newSession = { ...session, state: 'CLOTURE_CONFIRM', clotureDate: today };
      await setSession(sessionId, newSession);
      const dateFormatee = formatDate(today);
      return `CON Cloturer la caisse\ndu ${dateFormatee}?\n1.Oui  0.Non`;
    }

    case '5': {
      // Mon compte
      const newSession = { ...session, state: 'COMPTE_MENU' };
      await setSession(sessionId, newSession);
      return 'CON Mon compte\n1.Changer PIN\n0.Retour';
    }

    case '0': {
      // Quitter
      return 'END Merci d\'avoir utilise ENERGIE PLUS. Au revoir!';
    }

    default: {
      return 'CON Option invalide.\n' + buildMainMenu(session.profil);
    }
  }
}

/**
 * Formate une date ISO (YYYY-MM-DD) en DD/MM/YYYY.
 */
function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

module.exports = { buildMainMenu, handleMain, formatDate };
