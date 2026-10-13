'use strict';

const {
  convertirCentrale,
  convertirOnduleur,
  convertirDonneesBase,
  convertirMesure,
  convertirEnergieJour,
  convertirEvenement,
} = require('./conversion');
const { comparerReglages } = require('../reglages/listeBlanche');
const { jourLocal } = require('../temps');

const CONCURRENCE = 4;

/** Exécute fn sur chaque élément avec au plus `limite` appels simultanés. */
async function parLots(elements, limite, fn) {
  const erreurs = [];
  let index = 0;
  const travailleurs = Array.from({ length: Math.min(limite, elements.length) }, async () => {
    while (index < elements.length) {
      const el = elements[index++];
      try {
        await fn(el);
      } catch (err) {
        erreurs.push({ element: el, erreur: err });
      }
    }
  });
  await Promise.all(travailleurs);
  return erreurs;
}

function resumerErreurs(erreurs) {
  if (!erreurs.length) return null;
  const premiers = erreurs.slice(0, 3).map((e) => `${e.element}: ${e.erreur.message}`);
  return `${erreurs.length} erreur(s) — ${premiers.join(' ; ')}`;
}

async function numerosSerie(pool) {
  const { rows } = await pool.query('SELECT device_sn FROM onduleurs ORDER BY device_sn');
  return rows.map((r) => r.device_sn);
}

// ── Inventaire : centrales, onduleurs, infos de base ─────────────────────────

async function synchroniserInventaire({ client, pool }) {
  const centrales = (await client.listerCentrales()).map(convertirCentrale).filter(Boolean);
  for (const c of centrales) {
    await pool.query(
      `INSERT INTO centrales (plant_id, nom, fuseau, adresse, vue_le)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (plant_id) DO UPDATE
         SET nom = EXCLUDED.nom, fuseau = EXCLUDED.fuseau, adresse = EXCLUDED.adresse, vue_le = now()`,
      [c.plantId, c.nom, c.fuseau, c.adresse]
    );
  }

  const idsCentrales = new Set(centrales.map((c) => c.plantId));
  const onduleurs = (await client.listerOnduleurs()).map(convertirOnduleur).filter(Boolean);
  for (const o of onduleurs) {
    const plantId = o.plantId && idsCentrales.has(o.plantId) ? o.plantId : null;
    await pool.query(
      `INSERT INTO onduleurs (device_sn, plant_id, vu_le)
       VALUES ($1, $2, now())
       ON CONFLICT (device_sn) DO UPDATE
         SET plant_id = COALESCE(EXCLUDED.plant_id, onduleurs.plant_id), vu_le = now()`,
      [o.deviceSn, plantId]
    );
  }

  const erreurs = await parLots(
    onduleurs.map((o) => o.deviceSn),
    CONCURRENCE,
    async (sn) => {
      const b = convertirDonneesBase((await client.donneesBase(sn)) || {});
      await pool.query(
        `UPDATE onduleurs
            SET modele = COALESCE($2, modele), type_appareil = COALESCE($3, type_appareil),
                sous_type = COALESCE($4, sous_type), puissance_nominale = COALESCE($5, puissance_nominale),
                statut = $6, version_firmware = COALESCE($7, version_firmware), infos_le = now()
          WHERE device_sn = $1`,
        [sn, b.modele, b.typeAppareil, b.sousType, b.puissanceNominale, b.statut, b.versionFirmware]
      );
    }
  );
  return { nb: centrales.length + onduleurs.length, erreur: resumerErreurs(erreurs) };
}

// ── Mesures temps réel ───────────────────────────────────────────────────────

async function synchroniserMesures({ client, pool, config }) {
  const sns = await numerosSerie(pool);
  if (!sns.length) return { nb: 0 };
  const connus = new Set(sns);
  const brutes = await client.dernieresMesures(sns);
  let nb = 0;
  for (const brute of brutes) {
    const m = convertirMesure(brute, config.fuseauDefautMinutes);
    if (!m || !connus.has(m.deviceSn)) continue;
    const res = await pool.query(
      `INSERT INTO mesures (device_sn, horodatage, pv_w, reseau_w, charge_w, secours_w, batterie_w, soc,
                            temperature_max, mode_travail, brut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (device_sn, horodatage) DO NOTHING`,
      [m.deviceSn, m.horodatage, m.pvW, m.reseauW, m.chargeW, m.secoursW, m.batterieW, m.soc,
        m.temperatureMax, m.modeTravail, m.brut]
    );
    nb += res.rowCount;
  }
  return { nb };
}

// ── Énergie journalière ──────────────────────────────────────────────────────

/** Mois à synchroniser : le mois courant, et le précédent pendant les 2 premiers jours. */
function moisASynchroniser(maintenant, decalageMinutes) {
  const jour = jourLocal(maintenant, decalageMinutes);
  const [a, m, j] = jour.split('-').map(Number);
  const mois = [`${a}-${String(m).padStart(2, '0')}-01 00:00:00`];
  if (j <= 2) {
    const precedent = m === 1 ? [a - 1, 12] : [a, m - 1];
    mois.push(`${precedent[0]}-${String(precedent[1]).padStart(2, '0')}-01 00:00:00`);
  }
  return mois;
}

async function enregistrerEnergie(pool, e) {
  await pool.query(
    `INSERT INTO energie_jour (device_sn, jour, production_kwh, pv_kwh, reseau_import_kwh, reseau_export_kwh,
                               batterie_charge_kwh, batterie_decharge_kwh, consommation_kwh, groupe_kwh, brut, maj_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (device_sn, jour) DO UPDATE
       SET production_kwh = EXCLUDED.production_kwh, pv_kwh = EXCLUDED.pv_kwh,
           reseau_import_kwh = EXCLUDED.reseau_import_kwh, reseau_export_kwh = EXCLUDED.reseau_export_kwh,
           batterie_charge_kwh = EXCLUDED.batterie_charge_kwh, batterie_decharge_kwh = EXCLUDED.batterie_decharge_kwh,
           consommation_kwh = EXCLUDED.consommation_kwh, groupe_kwh = EXCLUDED.groupe_kwh,
           brut = EXCLUDED.brut, maj_le = now()`,
    [e.deviceSn, e.jour, e.productionKwh, e.pvKwh, e.reseauImportKwh, e.reseauExportKwh,
      e.batterieChargeKwh, e.batterieDechargeKwh, e.consommationKwh, e.groupeKwh, e.brut]
  );
}

/**
 * Hypothèse (à confirmer avec Felicity Solar) : timeDimension=month renvoie un
 * enregistrement par jour du mois, avec dataTime au format "YYYY-MM-DD".
 */
async function synchroniserEnergie({ client, pool, config, maintenant = new Date() }, sns = null) {
  const liste = sns || (await numerosSerie(pool));
  const mois = moisASynchroniser(maintenant, config.fuseauDefautMinutes);
  let nb = 0;
  const erreurs = await parLots(liste, CONCURRENCE, async (sn) => {
    for (const dateStr of mois) {
      const enregistrements = await client.energieOnduleur(sn, 'month', dateStr);
      for (const r of enregistrements) {
        const e = convertirEnergieJour(r, sn);
        if (!e || e.deviceSn !== sn) continue;
        await enregistrerEnergie(pool, e);
        nb++;
      }
    }
  });
  return { nb, erreur: resumerErreurs(erreurs) };
}

/** Rattrapage de l'historique d'un onduleur sur N mois (script d'import). */
async function importerHistoriqueEnergie({ client, pool }, sn, nbMois, maintenant = new Date()) {
  let nb = 0;
  for (let i = 0; i < nbMois; i++) {
    const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1));
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01 00:00:00`;
    for (const r of await client.energieOnduleur(sn, 'month', dateStr)) {
      const e = convertirEnergieJour(r, sn);
      if (!e || e.deviceSn !== sn) continue;
      await enregistrerEnergie(pool, e);
      nb++;
    }
  }
  return nb;
}

// ── Alarmes et défauts ───────────────────────────────────────────────────────

async function synchroniserEvenements({ client, pool, config }) {
  const sns = await numerosSerie(pool);
  let nb = 0;
  const erreurs = await parLots(sns, CONCURRENCE, async (sn) => {
    for (const brut of await client.evenements(sn)) {
      const e = convertirEvenement(brut, sn, config.fuseauDefautMinutes);
      if (!e || e.deviceSn !== sn) continue;
      const res = await pool.query(
        `INSERT INTO evenements (device_sn, horodatage_texte, horodatage, code, nom, type_evenement, fuseau)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (device_sn, horodatage_texte, code) DO NOTHING`,
        [e.deviceSn, e.horodatageTexte, e.horodatage, e.code, e.nom, e.typeEvenement, e.fuseau]
      );
      nb += res.rowCount;
    }
  });
  return { nb, erreur: resumerErreurs(erreurs) };
}

// ── Vérification des commandes de réglage ────────────────────────────────────

/**
 * Relit les réglages des onduleurs pour les commandes envoyées depuis plus de
 * `delaiVerificationSec`, et marque chaque commande vérifiée ou en écart.
 * Les relectures en échec sont retentées jusqu'à `delaiAbandonMinutes`.
 */
async function verifierCommandes({ client, pool, config }) {
  const { delaiVerificationSec, delaiAbandonMinutes } = config.reglages;
  const { rows } = await pool.query(
    `SELECT id, device_sn, contenu, envoyee_le
       FROM commandes
      WHERE statut = 'envoyee' AND envoyee_le <= now() - ($1 || ' seconds')::interval
      ORDER BY id`,
    [String(delaiVerificationSec)]
  );
  let nb = 0;
  for (const cmd of rows) {
    try {
      const relues = (await client.lireReglages(cmd.device_sn)) || {};
      const ecarts = comparerReglages(cmd.contenu, relues);
      const abandon = Date.now() - new Date(cmd.envoyee_le).getTime() > delaiAbandonMinutes * 60000;
      if (ecarts.length && !abandon) continue; // l'onduleur n'a peut-être pas encore appliqué
      await pool.query(
        `UPDATE commandes SET statut = $2, valeurs_relues = $3, erreur = $4, verifiee_le = now() WHERE id = $1`,
        [cmd.id, ecarts.length ? 'ecart' : 'verifiee', relues,
          ecarts.length ? `Valeurs différentes après relecture : ${ecarts.map((e) => e.champ).join(', ')}` : null]
      );
      nb++;
    } catch (err) {
      const abandon = Date.now() - new Date(cmd.envoyee_le).getTime() > delaiAbandonMinutes * 60000;
      if (abandon) {
        await pool.query(
          `UPDATE commandes SET statut = 'non_verifiee', erreur = $2, verifiee_le = now() WHERE id = $1`,
          [cmd.id, `Relecture impossible : ${err.message}`]
        );
        nb++;
      }
    }
  }
  return { nb };
}

module.exports = {
  synchroniserInventaire,
  synchroniserMesures,
  synchroniserEnergie,
  synchroniserEvenements,
  verifierCommandes,
  importerHistoriqueEnergie,
  moisASynchroniser,
};
