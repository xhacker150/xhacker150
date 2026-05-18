'use strict';

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// ── POST /api/v1/rapports/cloture ─────────────────────────────────────────────
router.post('/cloture', async (req, res) => {
  const { stationId, gerantId, date } = req.body;

  if (!stationId || !gerantId || !date) {
    return res.status(400).json({ success: false, error: 'stationId, gerantId et date sont requis.' });
  }

  // Valide le format de date (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'Format de date invalide. Utilisez YYYY-MM-DD.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Vérifie que le gérant existe et est bien gérant ou admin
    const gerantRes = await client.query(
      `SELECT id, profil, station_id FROM utilisateurs WHERE id = $1 AND actif = true`,
      [gerantId]
    );

    if (gerantRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Gérant non trouvé.' });
    }

    const gerant = gerantRes.rows[0];
    if (gerant.profil !== 'gerant' && gerant.profil !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, error: 'Seuls les gérants et admins peuvent clôturer.' });
    }

    // Vérifie que la station existe
    const stationRes = await client.query(
      `SELECT id, nom FROM stations WHERE id = $1`,
      [stationId]
    );

    if (stationRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Station non trouvée.' });
    }

    // Agrège les transactions du jour
    const debutJour = new Date(date + 'T00:00:00.000Z');
    const finJour = new Date(date + 'T23:59:59.999Z');

    const aggRes = await client.query(
      `SELECT
         COUNT(*) AS nb_transactions,
         COALESCE(SUM(CASE WHEN type='carte' THEN montant ELSE 0 END), 0) AS total_cartes,
         COALESCE(SUM(CASE WHEN type='bon'   THEN montant ELSE 0 END), 0) AS total_bons,
         COALESCE(SUM(montant), 0) AS total_general
       FROM transactions
       WHERE station_id = $1
         AND statut = 'validee'
         AND cree_le >= $2
         AND cree_le <= $3`,
      [stationId, debutJour, finJour]
    );

    const agg = aggRes.rows[0];
    const nbTx = parseInt(agg.nb_transactions, 10);
    const totalCartes = parseFloat(agg.total_cartes);
    const totalBons = parseFloat(agg.total_bons);
    const totalGeneral = parseFloat(agg.total_general);

    // Insère ou met à jour la clôture (idempotent via ON CONFLICT)
    const clotRes = await client.query(
      `INSERT INTO clotures (station_id, gerant_id, date_cloture, nb_transactions, total_cartes, total_bons, total_general)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (station_id, date_cloture)
       DO UPDATE SET
         gerant_id      = EXCLUDED.gerant_id,
         nb_transactions = EXCLUDED.nb_transactions,
         total_cartes   = EXCLUDED.total_cartes,
         total_bons     = EXCLUDED.total_bons,
         total_general  = EXCLUDED.total_general
       RETURNING id, cree_le`,
      [stationId, gerantId, date, nbTx, totalCartes, totalBons, totalGeneral]
    );

    // Log audit
    await client.query(
      `INSERT INTO journal_audit (utilisateur_id, action, details)
       VALUES ($1, 'CLOTURE_CAISSE', $2)`,
      [
        gerantId,
        JSON.stringify({
          clotureId: clotRes.rows[0].id,
          stationId,
          date,
          nbTransactions: nbTx,
          totalGeneral,
        }),
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      cloture: {
        id: clotRes.rows[0].id,
        station_id: stationId,
        station_nom: stationRes.rows[0].nom,
        date_cloture: date,
        nb_transactions: nbTx,
        total_cartes: totalCartes,
        total_bons: totalBons,
        total_general: totalGeneral,
        cree_le: clotRes.rows[0].cree_le,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[rapports/cloture POST]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

// ── GET /api/v1/rapports/cloture/:stationId/:date ────────────────────────────
router.get('/cloture/:stationId/:date', async (req, res) => {
  const { stationId, date } = req.params;

  const client = await pool.connect();
  try {
    const clotRes = await client.query(
      `SELECT c.id, c.station_id, c.gerant_id, c.date_cloture,
              c.nb_transactions, c.total_cartes, c.total_bons, c.total_general, c.cree_le,
              s.nom AS station_nom,
              u.telephone AS gerant_telephone
       FROM clotures c
       JOIN stations s ON s.id = c.station_id
       JOIN utilisateurs u ON u.id = c.gerant_id
       WHERE c.station_id = $1 AND c.date_cloture = $2`,
      [stationId, date]
    );

    if (clotRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Clôture non trouvée pour cette date.' });
    }

    const c = clotRes.rows[0];

    return res.json({
      success: true,
      cloture: {
        id: c.id,
        station_nom: c.station_nom,
        gerant_telephone: c.gerant_telephone,
        date_cloture: c.date_cloture,
        nb_transactions: c.nb_transactions,
        total_cartes: parseFloat(c.total_cartes),
        total_bons: parseFloat(c.total_bons),
        total_general: parseFloat(c.total_general),
        cree_le: c.cree_le,
      },
    });
  } catch (err) {
    console.error('[rapports/cloture GET]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

module.exports = router;
