'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const router = express.Router();

/**
 * POST /api/v1/auth/verify-pin
 * Vérifie le PIN d'un utilisateur.
 * Body: { telephone, pin }
 * Retourne: { userId, profil, stationId, stationNom }
 */
router.post('/verify-pin', async (req, res) => {
  const { telephone, pin } = req.body;

  if (!telephone || !pin) {
    return res.status(400).json({ success: false, error: 'telephone et pin sont requis.' });
  }

  const client = await pool.connect();
  try {
    // Récupère l'utilisateur avec les infos de sa station
    const result = await client.query(
      `SELECT u.id, u.telephone, u.pin_hash, u.profil, u.actif, u.bloque,
              u.tentatives_pin, u.station_id,
              s.nom AS station_nom
       FROM utilisateurs u
       LEFT JOIN stations s ON s.id = u.station_id
       WHERE u.telephone = $1`,
      [telephone]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ success: false, error: 'Utilisateur non trouvé.' });
    }

    const user = result.rows[0];

    if (!user.actif) {
      return res.status(403).json({ success: false, error: 'Compte désactivé.' });
    }

    if (user.bloque) {
      return res.status(403).json({ success: false, error: 'Compte bloqué.', bloque: true });
    }

    // Vérification du PIN
    const pinOk = await bcrypt.compare(String(pin), user.pin_hash);

    if (!pinOk) {
      const nouveauTentatives = user.tentatives_pin + 1;
      const bloquer = nouveauTentatives >= 3;

      await client.query(
        `UPDATE utilisateurs
         SET tentatives_pin = $1, bloque = $2, modifie_le = now()
         WHERE id = $3`,
        [nouveauTentatives, bloquer, user.id]
      );

      if (bloquer) {
        return res.status(401).json({
          success: false,
          error: 'PIN incorrect. Compte bloqué après 3 tentatives.',
          bloque: true,
        });
      }

      return res.status(401).json({
        success: false,
        error: `PIN incorrect. ${3 - nouveauTentatives} tentative(s) restante(s).`,
        tentativesRestantes: 3 - nouveauTentatives,
      });
    }

    // PIN correct — réinitialise le compteur
    await client.query(
      `UPDATE utilisateurs
       SET tentatives_pin = 0, modifie_le = now()
       WHERE id = $1`,
      [user.id]
    );

    return res.json({
      success: true,
      userId: user.id,
      profil: user.profil,
      stationId: user.station_id,
      stationNom: user.station_nom,
    });
  } catch (err) {
    console.error('[auth/verify-pin]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/v1/utilisateurs/:id/pin
 * Modifie le PIN d'un utilisateur.
 * Body: { nouveauPin }
 */
router.patch('/utilisateurs/:id/pin', async (req, res) => {
  const { id } = req.params;
  const { nouveauPin } = req.body;

  if (!nouveauPin || String(nouveauPin).length !== 4 || !/^\d{4}$/.test(String(nouveauPin))) {
    return res.status(400).json({ success: false, error: 'Le nouveau PIN doit être 4 chiffres.' });
  }

  const client = await pool.connect();
  try {
    const check = await client.query('SELECT id FROM utilisateurs WHERE id = $1', [id]);
    if (check.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé.' });
    }

    const pinHash = await bcrypt.hash(String(nouveauPin), 10);

    await client.query(
      `UPDATE utilisateurs SET pin_hash = $1, modifie_le = now() WHERE id = $2`,
      [pinHash, id]
    );

    return res.json({ success: true, message: 'PIN modifié avec succès.' });
  } catch (err) {
    console.error('[auth/patch-pin]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

module.exports = router;
