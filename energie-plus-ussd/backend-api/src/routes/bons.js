'use strict';

const express = require('express');
const pool = require('../db/pool');
const { sendSms } = require('../services/sms');

const router = express.Router();

/**
 * Génère un code de confirmation à 6 chiffres.
 */
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── GET /api/v1/bons/:numero ──────────────────────────────────────────────────
router.get('/:numero', async (req, res) => {
  const { numero } = req.params;

  const client = await pool.connect();
  try {
    const bonRes = await client.query(
      `SELECT b.id, b.numero, b.entreprise_id, b.montant, b.type, b.montant_max,
              b.statut, b.date_expiration, b.cree_le, b.consomme_le,
              e.nom AS entreprise_nom
       FROM bons b
       LEFT JOIN entreprises e ON e.id = b.entreprise_id
       WHERE b.numero = $1`,
      [numero]
    );

    if (bonRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Bon non trouvé.' });
    }

    const bon = bonRes.rows[0];

    if (bon.statut !== 'actif') {
      return res.status(400).json({ success: false, error: `Bon ${bon.statut}.`, statut: bon.statut });
    }

    if (bon.date_expiration && new Date(bon.date_expiration) < new Date()) {
      return res.status(400).json({ success: false, error: 'Bon expiré.' });
    }

    return res.json({
      success: true,
      bon: {
        id: bon.id,
        numero: bon.numero,
        montant: bon.montant ? parseFloat(bon.montant) : null,
        type: bon.type,
        montant_max: bon.montant_max ? parseFloat(bon.montant_max) : null,
        statut: bon.statut,
        date_expiration: bon.date_expiration,
        entreprise_nom: bon.entreprise_nom,
      },
    });
  } catch (err) {
    console.error('[bons/GET]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

// ── POST /api/v1/bons/:numero/consommer ───────────────────────────────────────
router.post('/:numero/consommer', async (req, res) => {
  const { numero } = req.params;
  const { operateurId, stationId, montant } = req.body;

  if (!operateurId || !stationId) {
    return res.status(400).json({ success: false, error: 'operateurId et stationId sont requis.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verrouille la ligne bon
    const bonRes = await client.query(
      `SELECT b.id, b.numero, b.montant, b.type, b.montant_max, b.statut, b.date_expiration,
              e.nom AS entreprise_nom, e.telephone AS entreprise_telephone
       FROM bons b
       LEFT JOIN entreprises e ON e.id = b.entreprise_id
       WHERE b.numero = $1 FOR UPDATE`,
      [numero]
    );

    if (bonRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Bon non trouvé.' });
    }

    const bon = bonRes.rows[0];

    if (bon.statut !== 'actif') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Bon déjà ${bon.statut}.` });
    }

    if (bon.date_expiration && new Date(bon.date_expiration) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Bon expiré.' });
    }

    // Détermination du montant réel
    let montantFinal;
    if (bon.type === 'fixe') {
      montantFinal = parseFloat(bon.montant);
    } else {
      // variable: montant fourni par l'opérateur, plafonné à montant_max
      if (!montant) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'montant requis pour un bon variable.' });
      }
      montantFinal = parseFloat(montant);
      if (isNaN(montantFinal) || montantFinal <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Montant invalide.' });
      }
      if (bon.montant_max && montantFinal > parseFloat(bon.montant_max)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: `Montant dépasse le plafond du bon (${bon.montant_max} FCFA).` });
      }
    }

    // Génère le code de confirmation (unique)
    let codeConfirmation;
    let tries = 0;
    do {
      codeConfirmation = genCode();
      const existing = await client.query(
        `SELECT id FROM transactions WHERE code_confirmation = $1`,
        [codeConfirmation]
      );
      if (existing.rowCount === 0) break;
      tries++;
    } while (tries < 10);

    // Marque le bon comme consommé
    await client.query(
      `UPDATE bons SET statut = 'consomme', consomme_le = now() WHERE id = $1`,
      [bon.id]
    );

    // Insère la transaction
    const txRes = await client.query(
      `INSERT INTO transactions (code_confirmation, type, reference_id, montant, station_id, operateur_id, canal)
       VALUES ($1, 'bon', $2, $3, $4, $5, 'ussd')
       RETURNING id, cree_le`,
      [codeConfirmation, bon.id, montantFinal, stationId, operateurId]
    );

    // Log audit
    await client.query(
      `INSERT INTO journal_audit (utilisateur_id, action, details)
       VALUES ($1, 'TRANSACTION_BON', $2)`,
      [
        operateurId,
        JSON.stringify({
          transactionId: txRes.rows[0].id,
          bonId: bon.id,
          numerobon: bon.numero,
          montant: montantFinal,
          stationId,
          codeConfirmation,
        }),
      ]
    );

    await client.query('COMMIT');

    // Notification SMS (stub)
    if (bon.entreprise_telephone) {
      sendSms(
        bon.entreprise_telephone,
        `ENERGIE PLUS: Bon ${bon.numero} consomme - ${montantFinal} FCFA. Code: ${codeConfirmation}.`
      ).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      codeConfirmation,
      montant: montantFinal,
      bon: {
        id: bon.id,
        numero: bon.numero,
        entreprise_nom: bon.entreprise_nom,
      },
      cree_le: txRes.rows[0].cree_le,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[bons/consommer]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

module.exports = router;
