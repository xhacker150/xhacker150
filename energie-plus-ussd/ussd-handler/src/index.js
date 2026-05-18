'use strict';

require('dotenv').config();
const express = require('express');

const { getSession, setSession, deleteSession } = require('./session');
const { handleAuth } = require('./menus/auth');
const { handleMain, buildMainMenu } = require('./menus/main');
const { handleCarte } = require('./menus/carte');
const { handleBon } = require('./menus/bon');
const { handleAnnulation } = require('./menus/annulation');
const { handleCloture } = require('./menus/cloture');
const { handleCompte } = require('./menus/compte');

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'energie-plus-ussd-handler',
    timestamp: new Date().toISOString(),
  });
});

// ── Route principale USSD ─────────────────────────────────────────────────────
app.post('/ussd', async (req, res) => {
  // Extraction des paramètres USSD (compatible Africa's Talking et formats similaires)
  const sessionId   = req.body.sessionId   || req.body.session_id   || '';
  const phoneNumber = req.body.phoneNumber  || req.body.phone_number || req.body.msisdn || '';
  const serviceCode = req.body.serviceCode  || req.body.service_code || '';
  const text        = req.body.text        || '';

  // Réponse en text/plain
  res.setHeader('Content-Type', 'text/plain');

  if (!sessionId || !phoneNumber) {
    return res.send('END Paramètres USSD manquants. Reessayez.');
  }

  // Dernier input = dernier segment du texte accumulé
  const parts = text.split('*');
  const lastInput = text === '' ? '' : parts[parts.length - 1];

  try {
    let session = await getSession(sessionId);

    // ── Cas 1 : Pas de session ET text vide → début de session ──────────────
    if (!session && text === '') {
      const newSession = {
        state: 'AUTH_PIN',
        phoneNumber,
        serviceCode,
      };
      await setSession(sessionId, newSession);
      return res.send('CON ENERGIE PLUS\nEntrez votre PIN:');
    }

    // ── Cas 2 : Pas de session ET text non vide → AUTH_PIN avec le text ─────
    if (!session && text !== '') {
      const tempSession = {
        state: 'AUTH_PIN',
        phoneNumber,
        serviceCode,
      };
      await setSession(sessionId, tempSession);
      const response = await handleAuth(sessionId, phoneNumber, text);
      return res.send(response);
    }

    // ── Cas 3 : Session existante → dispatch selon l'état ────────────────────
    const state = session.state;

    // AUTH_PIN (ne devrait plus arriver si la session est créée, mais sécurité)
    if (state === 'AUTH_PIN') {
      const response = await handleAuth(sessionId, phoneNumber, text);
      return res.send(response);
    }

    // MAIN_MENU
    if (state === 'MAIN_MENU') {
      if (lastInput === '') {
        // Re-affiche le menu principal
        return res.send('CON ' + buildMainMenu(session.profil));
      }
      const response = await handleMain(sessionId, session, lastInput);
      return res.send(response);
    }

    // Branche CARTE
    if (['CARTE_MENU', 'CARTE_NUM', 'CARTE_MONTANT', 'CARTE_RECAP', 'CARTE_SOLDE_NUM'].includes(state)) {
      const response = await handleCarte(sessionId, session, lastInput);
      return res.send(response);
    }

    // Branche BON
    if (['BON_NUM', 'BON_RECAP'].includes(state)) {
      const response = await handleBon(sessionId, session, lastInput);
      return res.send(response);
    }

    // Branche ANNULATION
    if (['ANNUL_CODE', 'ANNUL_CONFIRM'].includes(state)) {
      const response = await handleAnnulation(sessionId, session, lastInput);
      return res.send(response);
    }

    // Branche CLOTURE
    if (state === 'CLOTURE_CONFIRM') {
      const response = await handleCloture(sessionId, session, lastInput);
      return res.send(response);
    }

    // Branche COMPTE
    if (['COMPTE_MENU', 'NOUVEAU_PIN', 'CONFIRM_PIN'].includes(state)) {
      const response = await handleCompte(sessionId, session, lastInput);
      return res.send(response);
    }

    // État inconnu → retour menu principal
    console.warn(`[USSD] État inconnu: ${state} pour session ${sessionId}`);
    session.state = 'MAIN_MENU';
    await setSession(sessionId, session);
    return res.send('CON ' + buildMainMenu(session.profil));

  } catch (err) {
    console.error('[USSD] Erreur globale:', err.message, err.stack);

    // Si c'est une erreur de connexion au backend
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      return res.send('END Service temporairement indisponible. Reessayez.');
    }

    return res.send('END Une erreur est survenue. Reessayez.');
  }
});

// ── Catch-all 404 ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route non trouvée.' });
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[USSD HANDLER] En écoute sur le port ${PORT}`);
});

module.exports = app;
