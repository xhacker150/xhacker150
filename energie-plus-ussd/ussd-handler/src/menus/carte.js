'use strict';

const { setSession } = require('../session');
const { getCarte, getSolde, validerCarte } = require('../api');
const { buildMainMenu } = require('./main');

/**
 * Formate un nombre en FCFA (ex: 25000 → "25 000 FCFA")
 */
function fcfa(n) {
  return Number(n).toLocaleString('fr-FR') + ' FCFA';
}

/**
 * Gère toute la branche CARTE du menu USSD.
 *
 * States gérés:
 *   CARTE_MENU → CARTE_NUM (valider) ou CARTE_SOLDE_NUM (solde)
 *   CARTE_NUM → CARTE_MONTANT
 *   CARTE_MONTANT → CARTE_RECAP
 *   CARTE_RECAP → valider (END) ou annuler (MAIN_MENU)
 *   CARTE_SOLDE_NUM → appel getSolde → END
 *
 * @param {string} sessionId
 * @param {object} session
 * @param {string} input  - Dernier input
 * @returns {Promise<string>}
 */
async function handleCarte(sessionId, session, input) {
  const state = session.state;

  // ── CARTE_MENU ───────────────────────────────────────────────────────────
  if (state === 'CARTE_MENU') {
    switch (input) {
      case '1': {
        const newSession = { ...session, state: 'CARTE_NUM', carteAction: 'valider' };
        await setSession(sessionId, newSession);
        return 'CON N° carte (10 chiffres):';
      }
      case '2': {
        const newSession = { ...session, state: 'CARTE_SOLDE_NUM', carteAction: 'solde' };
        await setSession(sessionId, newSession);
        return 'CON N° carte:';
      }
      case '0': {
        const newSession = { ...session, state: 'MAIN_MENU' };
        await setSession(sessionId, newSession);
        return 'CON ' + buildMainMenu(session.profil);
      }
      default:
        return 'CON Option invalide.\nCarte carburant\n1.Valider transaction\n2.Consulter solde\n0.Retour';
    }
  }

  // ── CARTE_NUM (pour validation) ──────────────────────────────────────────
  if (state === 'CARTE_NUM') {
    const numeroCarte = input.trim();

    if (!/^\d{10}$/.test(numeroCarte)) {
      return 'CON Numero invalide (10 chiffres).\nN° carte:';
    }

    // Vérifie que la carte existe et est valide
    try {
      const result = await getCarte(numeroCarte);
      if (!result.success) {
        return 'END Carte invalide ou introuvable.';
      }
      const carte = result.carte;
      if (carte.statut !== 'actif') {
        return `END Carte ${carte.statut}. Transaction impossible.`;
      }

      const newSession = {
        ...session,
        state: 'CARTE_MONTANT',
        numeroCarte,
        carteNomMasque: carte.numero, // déjà masqué
        carteNom: carte.titulaire_nom,
        carteSolde: carte.solde,
      };
      await setSession(sessionId, newSession);
      return 'CON Montant en FCFA\n(ou 0 pour saisir en litres):';
    } catch (err) {
      const status = err.response && err.response.status;
      if (status === 404) return 'END Carte introuvable.';
      console.error('[carte] getCarte error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // ── CARTE_SOLDE_NUM ──────────────────────────────────────────────────────
  if (state === 'CARTE_SOLDE_NUM') {
    const numeroCarte = input.trim();

    try {
      const result = await getSolde(numeroCarte);
      if (!result.success) {
        return 'END Carte invalide ou introuvable.';
      }

      let msg = `Carte: ${result.numero}\nTitulaire: ${result.titulaire_nom}\nSolde: ${fcfa(result.solde)}`;

      if (result.dernieres_transactions && result.dernieres_transactions.length > 0) {
        msg += '\n--- Dernieres op. ---';
        result.dernieres_transactions.slice(0, 2).forEach((t) => {
          const d = new Date(t.date);
          const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
          msg += `\n${dateStr}: ${fcfa(t.montant)} [${t.statut}]`;
        });
      }

      // Réinitialise vers menu principal
      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);

      return 'END ' + msg;
    } catch (err) {
      const status = err.response && err.response.status;
      if (status === 404) return 'END Carte introuvable.';
      console.error('[carte] getSolde error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // ── CARTE_MONTANT ────────────────────────────────────────────────────────
  if (state === 'CARTE_MONTANT') {
    const montantSaisi = parseFloat(input.trim());

    if (isNaN(montantSaisi) || montantSaisi < 0) {
      return 'CON Montant invalide.\nMontant en FCFA:';
    }

    // 0 = saisie en litres (non implémenté dans ce flux simplifié — on demande directement FCFA)
    if (montantSaisi === 0) {
      return 'CON Saisie en litres non disponible via USSD.\nEntrez le montant en FCFA:';
    }

    if (montantSaisi > parseFloat(session.carteSolde || 0)) {
      return `CON Solde insuffisant (${fcfa(session.carteSolde)}).\nMontant en FCFA:`;
    }

    const stationNom = session.stationNom || 'Votre station';
    const recap = `Carte: ${session.carteNomMasque}\nMontant: ${fcfa(montantSaisi)}\nStation: ${stationNom}\n1.Confirmer  0.Annuler`;

    const newSession = {
      ...session,
      state: 'CARTE_RECAP',
      carteMontant: montantSaisi,
    };
    await setSession(sessionId, newSession);

    return 'CON ' + recap;
  }

  // ── CARTE_RECAP ──────────────────────────────────────────────────────────
  if (state === 'CARTE_RECAP') {
    if (input === '0') {
      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);
      return 'CON ' + buildMainMenu(session.profil);
    }

    if (input !== '1') {
      const stationNom = session.stationNom || 'Votre station';
      const recap = `Carte: ${session.carteNomMasque}\nMontant: ${fcfa(session.carteMontant)}\nStation: ${stationNom}\n1.Confirmer  0.Annuler`;
      return 'CON ' + recap;
    }

    // Confirmation : appelle l'API
    try {
      const result = await validerCarte(
        session.numeroCarte,
        session.carteMontant,
        session.userId,
        session.stationId
      );

      if (!result.success) {
        return `END Erreur: ${result.error || 'Transaction echouee.'}`;
      }

      const newSession = { ...session, state: 'MAIN_MENU' };
      await setSession(sessionId, newSession);

      let msg = `Transaction validee!\nCode: ${result.codeConfirmation}\nMontant: ${fcfa(result.montant)}\nSolde restant: ${fcfa(result.soldeRestant)}`;
      if (result.litres) {
        msg += `\nLitres: ${result.litres}L`;
      }

      return 'END ' + msg;
    } catch (err) {
      const data = err.response && err.response.data;
      if (data && data.error) {
        return `END ${data.error}`;
      }
      console.error('[carte] validerCarte error:', err.message);
      return 'END Service temporairement indisponible. Reessayez.';
    }
  }

  // État inconnu → retour menu principal
  const newSession = { ...session, state: 'MAIN_MENU' };
  await setSession(sessionId, newSession);
  return 'CON ' + buildMainMenu(session.profil);
}

module.exports = { handleCarte };
