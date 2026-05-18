'use strict';

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// ── GET /api/v1/transactions/:code ────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  const { code } = req.params;

  const client = await pool.connect();
  try {
    const txRes = await client.query(
      `SELECT t.id, t.code_confirmation, t.type, t.reference_id, t.montant,
              t.station_id, t.operateur_id, t.statut, t.canal,
              t.prix_litre, t.litres,
              t.annulee_le, t.annulee_par, t.cree_le,
              s.nom AS station_nom,
              u.telephone AS operateur_telephone, u.profil AS operateur_profil
       FROM transactions t
       JOIN stations s ON s.id = t.station_id
       JOIN utilisateurs u ON u.id = t.operateur_id
       WHERE t.code_confirmation = $1`,
      [code]
    );

    if (txRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Transaction non trouvée.' });
    }

    const tx = txRes.rows[0];

    return res.json({
      success: true,
      transaction: {
        id: tx.id,
        code_confirmation: tx.code_confirmation,
        type: tx.type,
        reference_id: tx.reference_id,
        montant: parseFloat(tx.montant),
        station_nom: tx.station_nom,
        operateur_telephone: tx.operateur_telephone,
        operateur_profil: tx.operateur_profil,
        statut: tx.statut,
        canal: tx.canal,
        prix_litre: tx.prix_litre ? parseFloat(tx.prix_litre) : null,
        litres: tx.litres ? parseFloat(tx.litres) : null,
        annulee_le: tx.annulee_le,
        cree_le: tx.cree_le,
      },
    });
  } catch (err) {
    console.error('[transactions/GET]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

// ── POST /api/v1/transactions/:code/annuler ───────────────────────────────────
router.post('/:code/annuler', async (req, res) => {
  const { code } = req.params;
  const { operateurId, stationId } = req.body;

  if (!operateurId || !stationId) {
    return res.status(400).json({ success: false, error: 'operateurId et stationId sont requis.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verrouille la transaction
    const txRes = await client.query(
      `SELECT t.id, t.type, t.reference_id, t.montant, t.statut,
              t.operateur_id, t.station_id, t.cree_le,
              u.profil AS operateur_profil
       FROM transactions t
       JOIN utilisateurs u ON u.id = t.operateur_id
       WHERE t.code_confirmation = $1 FOR UPDATE`,
      [code]
    );

    if (txRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Transaction non trouvée.' });
    }

    const tx = txRes.rows[0];

    if (tx.statut === 'annulee') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Transaction déjà annulée.' });
    }

    // Récupère le profil de l'opérateur demandant l'annulation
    const operRes = await client.query(
      `SELECT profil FROM utilisateurs WHERE id = $1`,
      [operateurId]
    );

    if (operRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Opérateur non trouvé.' });
    }

    const profilAnnuleur = operRes.rows[0].profil;
    const estGerant = profilAnnuleur === 'gerant' || profilAnnuleur === 'admin';

    // Fenêtre de 15 minutes seulement pour les pompistes
    if (!estGerant) {
      const ageMs = Date.now() - new Date(tx.cree_le).getTime();
      if (ageMs > 15 * 60 * 1000) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, error: 'Fenêtre d\'annulation de 15 minutes dépassée.' });
      }

      // Un pompiste ne peut annuler que sa propre transaction
      if (tx.operateur_id !== operateurId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, error: 'Vous ne pouvez annuler que vos propres transactions.' });
      }
    }

    // Annule la transaction
    await client.query(
      `UPDATE transactions SET statut='annulee', annulee_le=now(), annulee_par=$1 WHERE id=$2`,
      [operateurId, tx.id]
    );

    // Recrédite ou rétablit selon le type
    if (tx.type === 'carte') {
      await client.query(
        `UPDATE cartes SET solde = solde + $1 WHERE id = $2`,
        [tx.montant, tx.reference_id]
      );
    } else if (tx.type === 'bon') {
      // Remet le bon en statut actif
      await client.query(
        `UPDATE bons SET statut='actif', consomme_le=NULL WHERE id=$1`,
        [tx.reference_id]
      );
    }

    // Log audit
    await client.query(
      `INSERT INTO journal_audit (utilisateur_id, action, details)
       VALUES ($1, 'ANNULATION_TRANSACTION', $2)`,
      [
        operateurId,
        JSON.stringify({
          transactionId: tx.id,
          code,
          type: tx.type,
          montant: parseFloat(tx.montant),
          stationId,
          annulePar: operateurId,
        }),
      ]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Transaction annulée avec succès.',
      transactionId: tx.id,
      montantRestitue: parseFloat(tx.montant),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[transactions/annuler]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

module.exports = router;
