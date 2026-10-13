'use strict';

const jwt = require('jsonwebtoken');

const NOM_COOKIE = 'rps_session';

function lireCookie(req, nom) {
  const entete = req.headers.cookie;
  if (!entete) return null;
  for (const morceau of entete.split(';')) {
    const i = morceau.indexOf('=');
    if (i === -1) continue;
    if (morceau.slice(0, i).trim() === nom) return decodeURIComponent(morceau.slice(i + 1).trim());
  }
  return null;
}

/**
 * Vérifie la session (cookie JWT) et recharge l'utilisateur depuis la base,
 * pour qu'une désactivation ou un changement de rôle s'applique immédiatement.
 */
function exigerConnexion({ pool, config }) {
  return async (req, res, next) => {
    const jeton = lireCookie(req, NOM_COOKIE);
    if (!jeton) return res.status(401).json({ success: false, error: 'Connexion requise.' });
    let charge;
    try {
      charge = jwt.verify(jeton, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ success: false, error: 'Session expirée ou invalide.' });
    }
    try {
      const { rows } = await pool.query(
        'SELECT id, identifiant, nom, role FROM utilisateurs WHERE id = $1 AND actif = true',
        [charge.sub]
      );
      if (!rows.length) return res.status(401).json({ success: false, error: 'Compte désactivé ou inconnu.' });
      req.utilisateur = rows[0];
      next();
    } catch (err) {
      next(err);
    }
  };
}

function exigerRole(...roles) {
  return (req, res, next) => {
    if (!req.utilisateur || !roles.includes(req.utilisateur.role)) {
      return res.status(403).json({ success: false, error: 'Droits insuffisants pour cette action.' });
    }
    next();
  };
}

/**
 * Protection CSRF : le cookie est SameSite=Strict, et toute requête qui modifie
 * des données doit être en JSON (un formulaire d'un autre site ne peut pas l'envoyer
 * sans requête préalable CORS, que ce serveur n'autorise pas).
 */
function exigerJsonPourEcriture(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ success: false, error: 'Content-Type application/json requis.' });
  }
  next();
}

module.exports = { NOM_COOKIE, exigerConnexion, exigerRole, exigerJsonPourEcriture };
