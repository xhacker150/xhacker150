'use strict';

/**
 * Middleware d'authentification service-à-service via X-API-Key.
 * Toutes les routes backend-api nécessitent ce header.
 */
function apiAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key manquante. Fournissez le header X-API-Key.',
    });
  }

  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'API key invalide.',
    });
  }

  next();
}

module.exports = apiAuth;
