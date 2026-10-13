'use strict';

const express = require('express');
const { jourLocal } = require('../temps');

/**
 * Une ligne par onduleur, avec sa dernière mesure, l'énergie du jour et les
 * événements des dernières 24 h. Le regroupement par station se fait en JS.
 */
const SQL_ONDULEURS = `
  WITH derniere AS (
    SELECT DISTINCT ON (device_sn) device_sn, horodatage, pv_w, reseau_w, charge_w, secours_w, batterie_w, soc
      FROM mesures
     WHERE horodatage > now() - interval '3 days'
     ORDER BY device_sn, horodatage DESC
  ),
  alarmes AS (
    SELECT device_sn,
           COUNT(*) FILTER (WHERE type_evenement = 'F') AS defauts,
           COUNT(*) FILTER (WHERE type_evenement IS DISTINCT FROM 'F') AS alarmes
      FROM evenements
     WHERE COALESCE(horodatage, vu_le) > now() - interval '24 hours'
     GROUP BY device_sn
  )
  SELECT o.device_sn, o.modele, o.type_appareil, o.statut, o.puissance_nominale,
         c.plant_id, c.nom AS centrale_nom, s.id AS station_id, s.code AS station_code, s.nom AS station_nom,
         s.ville AS station_ville,
         d.horodatage, d.pv_w, d.reseau_w, d.charge_w, d.secours_w, d.batterie_w, d.soc,
         e.production_kwh AS production_jour_kwh, e.consommation_kwh AS consommation_jour_kwh,
         e.reseau_import_kwh AS import_jour_kwh,
         COALESCE(a.defauts, 0)::int AS defauts_24h, COALESCE(a.alarmes, 0)::int AS alarmes_24h
    FROM onduleurs o
    LEFT JOIN centrales c ON c.plant_id = o.plant_id
    LEFT JOIN stations s ON s.id = c.station_id
    LEFT JOIN derniere d ON d.device_sn = o.device_sn
    LEFT JOIN energie_jour e ON e.device_sn = o.device_sn AND e.jour = $1::date
    LEFT JOIN alarmes a ON a.device_sn = o.device_sn
   WHERE ($2::int IS NULL OR s.id = $2::int)
   ORDER BY s.nom NULLS LAST, c.nom, o.device_sn`;

function nombre(v) {
  return v === null || v === undefined ? null : Number(v);
}

function ajouter(total, v) {
  return v === null ? total : (total ?? 0) + v;
}

function presenterOnduleur(r, horsLigneMs) {
  const ageMs = r.horodatage ? Date.now() - new Date(r.horodatage).getTime() : null;
  const enLigne = ageMs !== null && ageMs <= horsLigneMs;
  return {
    deviceSn: r.device_sn,
    modele: r.modele,
    type: r.type_appareil,
    statutFsolar: r.statut,
    enLigne,
    etat: !enLigne ? 'hors_ligne' : r.defauts_24h > 0 ? 'defaut' : r.alarmes_24h > 0 ? 'alarme' : 'normal',
    derniereMesure: r.horodatage,
    pvW: nombre(r.pv_w),
    reseauW: nombre(r.reseau_w),
    chargeW: nombre(r.charge_w),
    secoursW: nombre(r.secours_w),
    batterieW: nombre(r.batterie_w),
    soc: nombre(r.soc),
    productionJourKwh: nombre(r.production_jour_kwh),
    consommationJourKwh: nombre(r.consommation_jour_kwh),
    importJourKwh: nombre(r.import_jour_kwh),
    defauts24h: r.defauts_24h,
    alarmes24h: r.alarmes_24h,
    centrale: r.plant_id ? { plantId: r.plant_id, nom: r.centrale_nom } : null,
  };
}

function regrouperParStation(lignes, horsLigneMs) {
  const stations = new Map();
  for (const r of lignes) {
    const cle = r.station_id ?? 'non_affectee';
    if (!stations.has(cle)) {
      stations.set(cle, {
        id: r.station_id,
        code: r.station_code,
        nom: r.station_nom || 'Non affectée',
        ville: r.station_ville,
        onduleurs: [],
      });
    }
    stations.get(cle).onduleurs.push(presenterOnduleur(r, horsLigneMs));
  }
  return [...stations.values()].map((s) => {
    const enLigne = s.onduleurs.filter((o) => o.enLigne);
    const socs = enLigne.map((o) => o.soc).filter((v) => v !== null);
    const resume = {
      nbOnduleurs: s.onduleurs.length,
      nbEnLigne: enLigne.length,
      pvW: null, chargeW: null, reseauW: null, batterieW: null,
      socMoyen: socs.length ? Math.round(socs.reduce((a, b) => a + b, 0) / socs.length) : null,
      productionJourKwh: null,
      defauts24h: 0,
      alarmes24h: 0,
    };
    for (const o of enLigne) {
      resume.pvW = ajouter(resume.pvW, o.pvW);
      resume.chargeW = ajouter(resume.chargeW, ajouter(o.chargeW, o.secoursW));
      resume.reseauW = ajouter(resume.reseauW, o.reseauW);
      resume.batterieW = ajouter(resume.batterieW, o.batterieW);
    }
    for (const o of s.onduleurs) {
      resume.productionJourKwh = ajouter(resume.productionJourKwh, o.productionJourKwh);
      resume.defauts24h += o.defauts24h;
      resume.alarmes24h += o.alarmes24h;
    }
    const etat = !s.onduleurs.length ? 'vide'
      : resume.defauts24h > 0 ? 'defaut'
      : resume.nbEnLigne < resume.nbOnduleurs ? 'hors_ligne'
      : resume.alarmes24h > 0 ? 'alarme' : 'normal';
    return { ...s, etat, resume };
  });
}

function creerRouteurStations({ pool, config, exigerRole }) {
  const router = express.Router();
  const horsLigneMs = config.collecte.horsLigneMinutes * 60000;
  const aujourdhui = () => jourLocal(new Date(), config.fuseauDefautMinutes);

  // ── GET /api/apercu ──────────────────────────────────────────────────────
  router.get('/apercu', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(SQL_ONDULEURS, [aujourdhui(), null]);
      const stations = regrouperParStation(rows, horsLigneMs);
      const { rows: vides } = await pool.query(
        `SELECT s.id, s.code, s.nom, s.ville FROM stations s
          WHERE s.actif AND NOT EXISTS (
            SELECT 1 FROM centrales c JOIN onduleurs o ON o.plant_id = c.plant_id WHERE c.station_id = s.id)
          ORDER BY s.nom`
      );
      for (const s of vides) stations.push({ ...s, etat: 'vide', onduleurs: [], resume: { nbOnduleurs: 0, nbEnLigne: 0 } });
      const { rows: collecte } = await pool.query(
        `SELECT DISTINCT ON (tache) tache, debut, fin, succes, nb_elements, erreur
           FROM journal_collecte ORDER BY tache, debut DESC`
      );
      res.json({ success: true, data: { jour: aujourdhui(), stations, collecte } });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/stations/:id ────────────────────────────────────────────────
  router.get('/stations/:id', async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Identifiant invalide.' });
    try {
      const { rows: st } = await pool.query('SELECT id, code, nom, ville, actif FROM stations WHERE id = $1', [id]);
      if (!st.length) return res.status(404).json({ success: false, error: 'Station non trouvée.' });
      const { rows } = await pool.query(SQL_ONDULEURS, [aujourdhui(), id]);
      const groupe = regrouperParStation(rows, horsLigneMs)[0];
      const { rows: historique } = await pool.query(
        `SELECT e.jour::text AS jour, SUM(e.production_kwh) AS production_kwh, SUM(e.consommation_kwh) AS consommation_kwh,
                SUM(e.reseau_import_kwh) AS reseau_import_kwh, SUM(e.groupe_kwh) AS groupe_kwh
           FROM energie_jour e
           JOIN onduleurs o ON o.device_sn = e.device_sn
           JOIN centrales c ON c.plant_id = o.plant_id
          WHERE c.station_id = $1 AND e.jour > $2::date - 30
          GROUP BY e.jour ORDER BY e.jour`,
        [id, aujourdhui()]
      );
      const { rows: evenements } = await pool.query(
        `SELECT ev.device_sn, ev.horodatage_texte, ev.code, ev.nom, ev.type_evenement
           FROM evenements ev
           JOIN onduleurs o ON o.device_sn = ev.device_sn
           JOIN centrales c ON c.plant_id = o.plant_id
          WHERE c.station_id = $1
          ORDER BY COALESCE(ev.horodatage, ev.vu_le) DESC LIMIT 50`,
        [id]
      );
      const { rows: centrales } = await pool.query(
        'SELECT plant_id, nom, fuseau, adresse FROM centrales WHERE station_id = $1 ORDER BY nom',
        [id]
      );
      res.json({
        success: true,
        data: {
          ...st[0],
          etat: groupe ? groupe.etat : 'vide',
          resume: groupe ? groupe.resume : { nbOnduleurs: 0, nbEnLigne: 0 },
          onduleurs: groupe ? groupe.onduleurs : [],
          centrales,
          historique: historique.map((h) => ({
            jour: h.jour,
            productionKwh: nombre(h.production_kwh),
            consommationKwh: nombre(h.consommation_kwh),
            reseauImportKwh: nombre(h.reseau_import_kwh),
            groupeKwh: nombre(h.groupe_kwh),
          })),
          evenements,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Administration : stations et rattachement des centrales ──────────────

  router.get('/stations', async (_req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT id, code, nom, ville, actif FROM stations ORDER BY nom');
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/stations', exigerRole('admin'), async (req, res, next) => {
    const { code, nom, ville } = req.body || {};
    if (typeof code !== 'string' || !code.trim() || code.length > 20 || typeof nom !== 'string' || !nom.trim()) {
      return res.status(400).json({ success: false, error: 'code (20 caractères max) et nom sont requis.' });
    }
    try {
      const { rows } = await pool.query(
        'INSERT INTO stations (code, nom, ville) VALUES ($1, $2, $3) RETURNING id, code, nom, ville, actif',
        [code.trim().toUpperCase(), nom.trim(), typeof ville === 'string' ? ville.trim() || null : null]
      );
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ success: false, error: 'Ce code de station existe déjà.' });
      next(err);
    }
  });

  router.put('/stations/:id', exigerRole('admin'), async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { nom, ville, actif } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Identifiant invalide.' });
    if (nom !== undefined && (typeof nom !== 'string' || !nom.trim())) {
      return res.status(400).json({ success: false, error: 'nom invalide.' });
    }
    if (actif !== undefined && typeof actif !== 'boolean') {
      return res.status(400).json({ success: false, error: 'actif doit être un booléen.' });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE stations SET nom = COALESCE($2, nom), ville = COALESCE($3, ville), actif = COALESCE($4, actif)
          WHERE id = $1 RETURNING id, code, nom, ville, actif`,
        [id, nom?.trim() ?? null, typeof ville === 'string' ? ville.trim() : null, actif ?? null]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Station non trouvée.' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  });

  router.get('/centrales', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT c.plant_id, c.nom, c.fuseau, c.adresse, c.station_id, s.nom AS station_nom,
                (SELECT COUNT(*) FROM onduleurs o WHERE o.plant_id = c.plant_id)::int AS nb_onduleurs
           FROM centrales c LEFT JOIN stations s ON s.id = c.station_id
          ORDER BY c.station_id NULLS FIRST, c.nom`
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.put('/centrales/:plantId/station', exigerRole('admin'), async (req, res, next) => {
    const { stationId } = req.body || {};
    if (stationId !== null && !Number.isInteger(stationId)) {
      return res.status(400).json({ success: false, error: 'stationId doit être un entier ou null.' });
    }
    try {
      if (stationId !== null) {
        const { rowCount } = await pool.query('SELECT 1 FROM stations WHERE id = $1', [stationId]);
        if (!rowCount) return res.status(404).json({ success: false, error: 'Station non trouvée.' });
      }
      const { rows } = await pool.query(
        'UPDATE centrales SET station_id = $2 WHERE plant_id = $1 RETURNING plant_id, nom, station_id',
        [req.params.plantId, stationId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Centrale non trouvée.' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = creerRouteurStations;
