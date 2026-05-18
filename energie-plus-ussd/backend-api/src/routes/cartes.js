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

/**
 * Masque le numéro de carte: 4 premiers chiffres + **** + 2 derniers.
 */
function masquerNumero(numero) {
  if (!numero || numero.length < 6) return numero;
  return numero.slice(0, 4) + '****' + numero.slice(-2);
}

// ── GET /api/v1/cartes/:numero ────────────────────────────────────────────────
router.get('/:numero', async (req, res) => {
  const { numero } = req.params;

  const client = await pool.connect();
  try {
    const carteRes = await client.query(
      `SELECT id, numero, titulaire_nom, titulaire_telephone, solde,
              plafond_journalier, plafond_hebdomadaire, plafond_mensuel,
              statut, date_expiration, cree_le
       FROM cartes WHERE numero = $1`,
      [numero]
    );

    if (carteRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Carte non trouvée.' });
    }

    const carte = carteRes.rows[0];
    const now = new Date();

    // Consommation journalière
    const debutJour = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const debutSemaine = new Date(debutJour);
    debutSemaine.setDate(debutJour.getDate() - debutJour.getDay());
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);

    const [journ, hebdo, mens] = await Promise.all([
      client.query(
        `SELECT COALESCE(SUM(montant),0) AS total FROM transactions
         WHERE reference_id=$1 AND type='carte' AND statut='validee' AND cree_le>=$2`,
        [carte.id, debutJour]
      ),
      client.query(
        `SELECT COALESCE(SUM(montant),0) AS total FROM transactions
         WHERE reference_id=$1 AND type='carte' AND statut='validee' AND cree_le>=$2`,
        [carte.id, debutSemaine]
      ),
      client.query(
        `SELECT COALESCE(SUM(montant),0) AS total FROM transactions
         WHERE reference_id=$1 AND type='carte' AND statut='validee' AND cree_le>=$2`,
        [carte.id, debutMois]
      ),
    ]);

    return res.json({
      success: true,
      carte: {
        id: carte.id,
        numero: masquerNumero(carte.numero),
        titulaire_nom: carte.titulaire_nom,
        titulaire_telephone: carte.titulaire_telephone,
        solde: parseFloat(carte.solde),
        plafond_journalier: parseFloat(carte.plafond_journalier),
        plafond_hebdomadaire: parseFloat(carte.plafond_hebdomadaire),
        plafond_mensuel: parseFloat(carte.plafond_mensuel),
        statut: carte.statut,
        date_expiration: carte.date_expiration,
        consommation_journaliere: parseFloat(journ.rows[0].total),
        consommation_hebdomadaire: parseFloat(hebdo.rows[0].total),
        consommation_mensuelle: parseFloat(mens.rows[0].total),
      },
    });
  } catch (err) {
    console.error('[cartes/GET]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

// ── GET /api/v1/cartes/:numero/solde ─────────────────────────────────────────
router.get('/:numero/solde', async (req, res) => {
  const { numero } = req.params;

  const client = await pool.connect();
  try {
    const carteRes = await client.query(
      `SELECT id, numero, titulaire_nom, solde, statut FROM cartes WHERE numero = $1`,
      [numero]
    );

    if (carteRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Carte non trouvée.' });
    }

    const carte = carteRes.rows[0];

    const txRes = await client.query(
      `SELECT t.code_confirmation, t.montant, t.statut, t.cree_le, s.nom AS station_nom
       FROM transactions t
       JOIN stations s ON s.id = t.station_id
       WHERE t.reference_id = $1 AND t.type = 'carte'
       ORDER BY t.cree_le DESC
       LIMIT 3`,
      [carte.id]
    );

    return res.json({
      success: true,
      numero: masquerNumero(carte.numero),
      titulaire_nom: carte.titulaire_nom,
      solde: parseFloat(carte.solde),
      statut: carte.statut,
      dernieres_transactions: txRes.rows.map((t) => ({
        code: t.code_confirmation,
        montant: parseFloat(t.montant),
        statut: t.statut,
        date: t.cree_le,
        station: t.station_nom,
      })),
    });
  } catch (err) {
    console.error('[cartes/solde]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

// ── POST /api/v1/cartes/:numero/transactions ──────────────────────────────────
router.post('/:numero/transactions', async (req, res) => {
  const { numero } = req.params;
  const { montant, operateurId, stationId } = req.body;

  if (!montant || !operateurId || !stationId) {
    return res.status(400).json({ success: false, error: 'montant, operateurId et stationId sont requis.' });
  }

  const montantNum = parseFloat(montant);
  if (isNaN(montantNum) || montantNum <= 0) {
    return res.status(400).json({ success: false, error: 'Montant invalide.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verrouille la ligne carte
    const carteRes = await client.query(
      `SELECT id, numero, titulaire_nom, titulaire_telephone, solde,
              plafond_journalier, plafond_hebdomadaire, plafond_mensuel,
              statut, date_expiration
       FROM cartes WHERE numero = $1 FOR UPDATE`,
      [numero]
    );

    if (carteRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Carte non trouvée.' });
    }

    const carte = carteRes.rows[0];

    if (carte.statut !== 'actif') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Carte ${carte.statut}.` });
    }

    if (carte.date_expiration && new Date(carte.date_expiration) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Carte expirée.' });
    }

    if (parseFloat(carte.solde) < montantNum) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Solde insuffisant.' });
    }

    // Vérification plafonds
    const now = new Date();
    const debutJour = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const debutSemaine = new Date(debutJour);
    debutSemaine.setDate(debutJour.getDate() - debutJour.getDay());
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);

    const [journ, hebdo, mens] = await Promise.all([
      client.query(
        `SELECT COALESCE(SUM(montant),0) AS total FROM transactions
         WHERE reference_id=$1 AND type='carte' AND statut='validee' AND cree_le>=$2`,
        [carte.id, debutJour]
      ),
      client.query(
        `SELECT COALESCE(SUM(montant),0) AS total FROM transactions
         WHERE reference_id=$1 AND type='carte' AND statut='validee' AND cree_le>=$2`,
        [carte.id, debutSemaine]
      ),
      client.query(
        `SELECT COALESCE(SUM(montant),0) AS total FROM transactions
         WHERE reference_id=$1 AND type='carte' AND statut='validee' AND cree_le>=$2`,
        [carte.id, debutMois]
      ),
    ]);

    const consJour = parseFloat(journ.rows[0].total);
    const consHebdo = parseFloat(hebdo.rows[0].total);
    const consMens = parseFloat(mens.rows[0].total);

    if (consJour + montantNum > parseFloat(carte.plafond_journalier)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Plafond journalier dépassé.' });
    }
    if (consHebdo + montantNum > parseFloat(carte.plafond_hebdomadaire)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Plafond hebdomadaire dépassé.' });
    }
    if (consMens + montantNum > parseFloat(carte.plafond_mensuel)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Plafond mensuel dépassé.' });
    }

    // Récupère le prix du carburant le plus récent
    const prixRes = await client.query(
      `SELECT prix_litre FROM prix_carburant ORDER BY effectif_le DESC LIMIT 1`
    );
    const prixLitre = prixRes.rowCount > 0 ? parseFloat(prixRes.rows[0].prix_litre) : null;
    const litres = prixLitre ? montantNum / prixLitre : null;

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

    // Débite la carte
    const nouveauSolde = parseFloat(carte.solde) - montantNum;
    await client.query(
      `UPDATE cartes SET solde = $1 WHERE id = $2`,
      [nouveauSolde, carte.id]
    );

    // Insère la transaction
    const txRes = await client.query(
      `INSERT INTO transactions (code_confirmation, type, reference_id, montant, station_id, operateur_id, canal, prix_litre, litres)
       VALUES ($1, 'carte', $2, $3, $4, $5, 'ussd', $6, $7)
       RETURNING id, cree_le`,
      [codeConfirmation, carte.id, montantNum, stationId, operateurId, prixLitre, litres]
    );

    // Log audit
    await client.query(
      `INSERT INTO journal_audit (utilisateur_id, action, details)
       VALUES ($1, 'TRANSACTION_CARTE', $2)`,
      [
        operateurId,
        JSON.stringify({
          transactionId: txRes.rows[0].id,
          carteId: carte.id,
          montant: montantNum,
          stationId,
          codeConfirmation,
        }),
      ]
    );

    await client.query('COMMIT');

    // Notification SMS (stub)
    if (carte.titulaire_telephone) {
      sendSms(
        carte.titulaire_telephone,
        `ENERGIE PLUS: Transaction de ${montantNum} FCFA effectuee sur carte ${masquerNumero(carte.numero)}. Code: ${codeConfirmation}. Solde restant: ${nouveauSolde} FCFA.`
      ).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      codeConfirmation,
      montant: montantNum,
      soldeRestant: nouveauSolde,
      litres: litres ? parseFloat(litres.toFixed(2)) : null,
      cree_le: txRes.rows[0].cree_le,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[cartes/transactions]', err.message);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

module.exports = router;
