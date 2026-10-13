'use strict';

const express = require('express');

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const JOURS_MAX = { jour: 366, mois: 366 * 5 };

const COLONNES = [
  ['productionKwh', 'Production (kWh)'],
  ['pvKwh', 'PV (kWh)'],
  ['consommationKwh', 'Consommation (kWh)'],
  ['reseauImportKwh', 'Import réseau (kWh)'],
  ['reseauExportKwh', 'Export réseau (kWh)'],
  ['batterieChargeKwh', 'Charge batterie (kWh)'],
  ['batterieDechargeKwh', 'Décharge batterie (kWh)'],
  ['groupeKwh', 'Groupe électrogène (kWh)'],
];

function dateValide(s) {
  if (typeof s !== 'string' || !FORMAT_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function arrondi(v) {
  return v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100;
}

/** Part de la consommation non couverte par le réseau (0–100 %). */
function autonomie(consommation, importReseau) {
  if (!consommation || consommation <= 0 || importReseau === null) return null;
  return Math.max(0, Math.min(100, Math.round((1 - importReseau / consommation) * 1000) / 10));
}

function celluleCsv(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ','); // Excel en français
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function creerRouteurRapports({ pool }) {
  const router = express.Router();

  // ── GET /api/rapports/production ─────────────────────────────────────────
  // ?debut=YYYY-MM-DD&fin=YYYY-MM-DD&grouper=jour|mois&station=<id>&format=json|csv
  router.get('/production', async (req, res, next) => {
    const { debut, fin, grouper = 'jour', station, format = 'json' } = req.query;
    if (!dateValide(debut) || !dateValide(fin)) {
      return res.status(400).json({ success: false, error: 'debut et fin sont requis au format YYYY-MM-DD.' });
    }
    if (!['jour', 'mois'].includes(grouper)) {
      return res.status(400).json({ success: false, error: 'grouper doit valoir "jour" ou "mois".' });
    }
    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ success: false, error: 'format doit valoir "json" ou "csv".' });
    }
    const ecartJours = (new Date(fin) - new Date(debut)) / 86400000;
    if (ecartJours < 0) return res.status(400).json({ success: false, error: 'fin doit être après debut.' });
    if (ecartJours > JOURS_MAX[grouper]) {
      return res.status(400).json({
        success: false,
        error: `Période trop longue pour un regroupement par ${grouper} (${JOURS_MAX[grouper]} jours max).`,
      });
    }
    let stationId = null;
    if (station !== undefined && station !== '') {
      stationId = parseInt(station, 10);
      if (!Number.isInteger(stationId)) return res.status(400).json({ success: false, error: 'station invalide.' });
    }

    try {
      const { rows } = await pool.query(
        `SELECT s.id AS station_id, COALESCE(s.code, '-') AS station_code, COALESCE(s.nom, 'Non affectée') AS station_nom,
                to_char(date_trunc($3, e.jour), $4) AS periode,
                COUNT(DISTINCT e.device_sn)::int AS nb_onduleurs,
                SUM(e.production_kwh) AS production_kwh, SUM(e.pv_kwh) AS pv_kwh,
                SUM(e.consommation_kwh) AS consommation_kwh,
                SUM(e.reseau_import_kwh) AS reseau_import_kwh, SUM(e.reseau_export_kwh) AS reseau_export_kwh,
                SUM(e.batterie_charge_kwh) AS batterie_charge_kwh, SUM(e.batterie_decharge_kwh) AS batterie_decharge_kwh,
                SUM(e.groupe_kwh) AS groupe_kwh
           FROM energie_jour e
           JOIN onduleurs o ON o.device_sn = e.device_sn
           LEFT JOIN centrales c ON c.plant_id = o.plant_id
           LEFT JOIN stations s ON s.id = c.station_id
          WHERE e.jour BETWEEN $1::date AND $2::date
            AND ($5::int IS NULL OR s.id = $5::int)
          GROUP BY s.id, s.code, s.nom, periode
          ORDER BY station_nom, periode`,
        [debut, fin, grouper === 'mois' ? 'month' : 'day', grouper === 'mois' ? 'YYYY-MM' : 'YYYY-MM-DD', stationId]
      );

      const lignes = rows.map((r) => {
        const l = {
          stationId: r.station_id,
          stationCode: r.station_code,
          stationNom: r.station_nom,
          periode: r.periode,
          nbOnduleurs: r.nb_onduleurs,
          productionKwh: arrondi(r.production_kwh),
          pvKwh: arrondi(r.pv_kwh),
          consommationKwh: arrondi(r.consommation_kwh),
          reseauImportKwh: arrondi(r.reseau_import_kwh),
          reseauExportKwh: arrondi(r.reseau_export_kwh),
          batterieChargeKwh: arrondi(r.batterie_charge_kwh),
          batterieDechargeKwh: arrondi(r.batterie_decharge_kwh),
          groupeKwh: arrondi(r.groupe_kwh),
        };
        l.autonomiePct = autonomie(l.consommationKwh, l.reseauImportKwh);
        return l;
      });

      // Totaux par station sur la période
      const totaux = new Map();
      for (const l of lignes) {
        const cle = l.stationId ?? 'non_affectee';
        if (!totaux.has(cle)) {
          totaux.set(cle, { stationId: l.stationId, stationCode: l.stationCode, stationNom: l.stationNom });
        }
        const t = totaux.get(cle);
        for (const [champ] of COLONNES) {
          if (l[champ] !== null) t[champ] = arrondi((t[champ] ?? 0) + l[champ]);
          else if (!(champ in t)) t[champ] = null;
        }
      }
      const totauxStations = [...totaux.values()].map((t) => ({
        ...t,
        autonomiePct: autonomie(t.consommationKwh, t.reseauImportKwh),
      }));

      if (format === 'csv') {
        const entete = ['Station', 'Code', 'Période', 'Onduleurs', ...COLONNES.map(([, lib]) => lib), 'Autonomie (%)'];
        const corps = lignes.map((l) =>
          [l.stationNom, l.stationCode, l.periode, l.nbOnduleurs, ...COLONNES.map(([c]) => l[c]), l.autonomiePct]
            .map(celluleCsv)
            .join(';')
        );
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="production_${debut}_${fin}.csv"`);
        return res.send('﻿' + [entete.map(celluleCsv).join(';'), ...corps].join('\r\n') + '\r\n');
      }

      res.json({ success: true, data: { debut, fin, grouper, lignes, totaux: totauxStations } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = creerRouteurRapports;
