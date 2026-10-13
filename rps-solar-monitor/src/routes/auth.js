'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { NOM_COOKIE } = require('../middleware/auth');

const ESSAIS_MAX = 5;
const FENETRE_ESSAIS_MS = 15 * 60 * 1000;
// Empêche une attaque temporelle révélant les identifiants existants
const HASH_FACTICE = bcrypt.hashSync('mot-de-passe-factice', 10);

function creerRouteurAuth({ pool, config, exigerConnexion }) {
  const router = express.Router();
  const echecs = new Map(); // clé : identifiant|ip → { nb, depuis }

  function bloque(cle) {
    const e = echecs.get(cle);
    if (!e) return false;
    if (Date.now() - e.depuis > FENETRE_ESSAIS_MS) {
      echecs.delete(cle);
      return false;
    }
    return e.nb >= ESSAIS_MAX;
  }

  function noterEchec(cle) {
    if (echecs.size > 5000) {
      for (const [k, v] of echecs) if (Date.now() - v.depuis > FENETRE_ESSAIS_MS) echecs.delete(k);
    }
    const e = echecs.get(cle);
    if (!e || Date.now() - e.depuis > FENETRE_ESSAIS_MS) echecs.set(cle, { nb: 1, depuis: Date.now() });
    else e.nb++;
  }

  // ── POST /api/auth/connexion ─────────────────────────────────────────────
  router.post('/connexion', async (req, res, next) => {
    const { identifiant, motDePasse } = req.body || {};
    if (typeof identifiant !== 'string' || typeof motDePasse !== 'string' || !identifiant || !motDePasse) {
      return res.status(400).json({ success: false, error: 'identifiant et motDePasse sont requis.' });
    }
    const cle = `${identifiant.toLowerCase()}|${req.ip}`;
    if (bloque(cle)) {
      return res.status(429).json({ success: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }
    try {
      const { rows } = await pool.query(
        'SELECT id, identifiant, nom, role, mot_de_passe_hash FROM utilisateurs WHERE lower(identifiant) = lower($1) AND actif = true',
        [identifiant]
      );
      const u = rows[0];
      const ok = await bcrypt.compare(motDePasse, u ? u.mot_de_passe_hash : HASH_FACTICE);
      if (!u || !ok) {
        noterEchec(cle);
        return res.status(401).json({ success: false, error: 'Identifiant ou mot de passe incorrect.' });
      }
      echecs.delete(cle);
      const jeton = jwt.sign({ sub: u.id, role: u.role }, config.jwtSecret, {
        algorithm: 'HS256',
        expiresIn: `${config.sessionHeures}h`,
      });
      res.cookie(NOM_COOKIE, jeton, {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.cookieSecurise,
        maxAge: config.sessionHeures * 3600 * 1000,
        path: '/',
      });
      res.json({ success: true, data: { id: u.id, identifiant: u.identifiant, nom: u.nom, role: u.role } });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/auth/deconnexion ───────────────────────────────────────────
  router.post('/deconnexion', (_req, res) => {
    res.clearCookie(NOM_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSecurise });
    res.json({ success: true });
  });

  // ── GET /api/auth/moi ────────────────────────────────────────────────────
  router.get('/moi', exigerConnexion, (req, res) => {
    res.json({ success: true, data: req.utilisateur });
  });

  return router;
}

module.exports = creerRouteurAuth;
