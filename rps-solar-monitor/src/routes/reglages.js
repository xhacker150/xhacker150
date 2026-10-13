'use strict';

const express = require('express');
const {
  validerReglages,
  descriptionChamps,
  extraireValeursAutorisees,
  modelePrisEnCharge,
} = require('../reglages/listeBlanche');

const MOTIF_MIN = 5;

function creerRouteurReglages({ pool, client, config, exigerRole }) {
  const router = express.Router();
  const pilotes = exigerRole('operateur', 'admin');

  async function chargerOnduleur(sn) {
    const { rows } = await pool.query(
      `SELECT o.device_sn, o.modele, o.puissance_nominale, c.station_id
         FROM onduleurs o LEFT JOIN centrales c ON c.plant_id = o.plant_id
        WHERE o.device_sn = $1`,
      [sn]
    );
    return rows[0] || null;
  }

  // ── GET /api/reglages/description ────────────────────────────────────────
  router.get('/reglages/description', (_req, res) => {
    res.json({ success: true, data: descriptionChamps() });
  });

  // ── GET /api/onduleurs/:sn/reglages : lecture en direct sur l'onduleur ───
  router.get('/onduleurs/:sn/reglages', pilotes, async (req, res, next) => {
    try {
      const o = await chargerOnduleur(req.params.sn);
      if (!o) return res.status(404).json({ success: false, error: 'Onduleur inconnu.' });
      if (!modelePrisEnCharge(o.modele)) {
        return res.json({ success: true, data: { deviceSn: o.device_sn, modele: o.modele, prisEnCharge: false, valeurs: {} } });
      }
      const relues = await client.lireReglages(o.device_sn);
      res.json({
        success: true,
        data: { deviceSn: o.device_sn, modele: o.modele, prisEnCharge: true, valeurs: extraireValeursAutorisees(relues) },
      });
    } catch (err) {
      if (err.name === 'FsolarError') {
        return res.status(502).json({ success: false, error: `Lecture impossible sur fSolar : ${err.message}` });
      }
      next(err);
    }
  });

  // ── POST /api/onduleurs/:sn/reglages : envoi d'une commande ──────────────
  // Corps : { reglages: { ... }, motif: "..." }
  router.post('/onduleurs/:sn/reglages', pilotes, async (req, res, next) => {
    const { reglages, motif } = req.body || {};
    if (typeof motif !== 'string' || motif.trim().length < MOTIF_MIN) {
      return res.status(400).json({ success: false, error: `Un motif d'au moins ${MOTIF_MIN} caractères est requis.` });
    }
    let idCommande = null;
    try {
      const o = await chargerOnduleur(req.params.sn);
      if (!o) return res.status(404).json({ success: false, error: 'Onduleur inconnu.' });

      const verif = validerReglages(reglages, { modele: o.modele, puissanceNominale: o.puissance_nominale });
      if (!verif.ok) return res.status(400).json({ success: false, error: 'Réglages refusés.', details: verif.erreurs });

      // Une seule commande en cours par onduleur
      const { rows: enCours } = await pool.query(
        `SELECT id FROM commandes
          WHERE device_sn = $1 AND statut IN ('en_attente', 'envoyee')
            AND cree_le > now() - ($2 || ' minutes')::interval
          LIMIT 1`,
        [o.device_sn, String(config.reglages.delaiAbandonMinutes)]
      );
      if (enCours.length) {
        return res.status(409).json({
          success: false,
          error: `La commande n°${enCours[0].id} est encore en cours de vérification sur cet onduleur.`,
        });
      }

      // Valeurs avant modification, pour le journal (non bloquant)
      let valeursAvant = null;
      try {
        valeursAvant = extraireValeursAutorisees(await client.lireReglages(o.device_sn));
      } catch {
        valeursAvant = null;
      }

      const { rows } = await pool.query(
        `INSERT INTO commandes (device_sn, utilisateur_id, contenu, valeurs_avant, motif)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [o.device_sn, req.utilisateur.id, verif.contenu, valeursAvant, motif.trim()]
      );
      idCommande = rows[0].id;

      const reponse = await client.envoyerReglages(o.device_sn, verif.contenu);
      const { rows: maj } = await pool.query(
        `UPDATE commandes SET statut = 'envoyee', envoyee_le = now(), id_commande_fsolar = $2
          WHERE id = $1 RETURNING id, device_sn, contenu, statut, id_commande_fsolar, cree_le, envoyee_le`,
        [idCommande, reponse?.id != null ? String(reponse.id) : null]
      );
      console.log(`[REGLAGES] Commande ${idCommande} envoyée à ${o.device_sn} par ${req.utilisateur.identifiant}`);
      res.status(202).json({ success: true, data: maj[0] });
    } catch (err) {
      if (idCommande) {
        await pool
          .query(`UPDATE commandes SET statut = 'echec', erreur = $2 WHERE id = $1`, [idCommande, err.message])
          .catch(() => {});
      }
      if (err.name === 'FsolarError') {
        return res.status(502).json({ success: false, error: `Envoi refusé par fSolar : ${err.message}`, commandeId: idCommande });
      }
      next(err);
    }
  });

  // ── GET /api/commandes ───────────────────────────────────────────────────
  router.get('/commandes', async (req, res, next) => {
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 50, 1), 500);
    try {
      const { rows } = await pool.query(
        `SELECT c.id, c.device_sn, c.contenu, c.valeurs_avant, c.valeurs_relues, c.statut, c.id_commande_fsolar,
                c.erreur, c.motif, c.cree_le, c.envoyee_le, c.verifiee_le,
                u.identifiant AS utilisateur, s.nom AS station_nom
           FROM commandes c
           JOIN utilisateurs u ON u.id = c.utilisateur_id
           LEFT JOIN onduleurs o ON o.device_sn = c.device_sn
           LEFT JOIN centrales ce ON ce.plant_id = o.plant_id
           LEFT JOIN stations s ON s.id = ce.station_id
          WHERE ($1::text IS NULL OR c.device_sn = $1)
          ORDER BY c.id DESC LIMIT $2`,
        [req.query.deviceSn || null, limite]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = creerRouteurReglages;
