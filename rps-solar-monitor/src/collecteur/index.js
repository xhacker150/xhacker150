'use strict';

const sync = require('./synchronisation');

/** Exécute une tâche et l'inscrit dans journal_collecte. */
async function executerTache(ctx, nom, fn) {
  const debut = new Date();
  let succes = false;
  let nb = null;
  let erreur = null;
  try {
    const res = (await fn(ctx)) || {};
    nb = res.nb ?? null;
    erreur = res.erreur || null;
    succes = !erreur;
  } catch (err) {
    erreur = err.message;
  }
  try {
    await ctx.pool.query(
      `INSERT INTO journal_collecte (tache, debut, fin, succes, nb_elements, erreur) VALUES ($1, $2, now(), $3, $4, $5)`,
      [nom, debut, succes, nb, erreur]
    );
  } catch (err) {
    console.error(`[COLLECTE] Impossible d'écrire le journal (${nom}) :`, err.message);
  }
  const duree = ((Date.now() - debut.getTime()) / 1000).toFixed(1);
  if (erreur) console.warn(`[COLLECTE] ${nom} : ${erreur} (${duree} s)`);
  else if (nb) console.log(`[COLLECTE] ${nom} : ${nb} élément(s) en ${duree} s`);
  return { succes, nb, erreur };
}

const RETENTION_JOURNAL_JOURS = 30;

async function inventaireEtPurge(ctx) {
  await ctx.pool.query(
    `DELETE FROM journal_collecte WHERE debut < now() - ($1 || ' days')::interval`,
    [String(RETENTION_JOURNAL_JOURS)]
  );
  return sync.synchroniserInventaire(ctx);
}

const TACHES = [
  { nom: 'inventaire', fn: inventaireEtPurge, intervalle: (c) => c.inventaireSec },
  { nom: 'mesures', fn: sync.synchroniserMesures, intervalle: (c) => c.mesuresSec },
  { nom: 'energie', fn: (ctx) => sync.synchroniserEnergie(ctx), intervalle: (c) => c.energieSec },
  { nom: 'evenements', fn: sync.synchroniserEvenements, intervalle: (c) => c.evenementsSec },
  { nom: 'verification_commandes', fn: sync.verifierCommandes, intervalle: (c) => c.verificationSec },
];

/**
 * Lance la collecte périodique. L'inventaire passe en premier pour que les
 * autres tâches connaissent les onduleurs. Une tâche ne se chevauche jamais
 * avec elle-même. Renvoie une fonction d'arrêt.
 */
function demarrerCollecte(ctx) {
  const minuteurs = [];
  const enCours = new Set();
  let arrete = false;

  const lancer = async (tache) => {
    if (arrete || enCours.has(tache.nom)) return;
    enCours.add(tache.nom);
    try {
      await executerTache(ctx, tache.nom, tache.fn);
    } finally {
      enCours.delete(tache.nom);
    }
  };

  (async () => {
    await lancer(TACHES[0]);
    for (const tache of TACHES) {
      if (arrete) return;
      if (tache !== TACHES[0]) await lancer(tache);
      const t = setInterval(() => lancer(tache), tache.intervalle(ctx.config.collecte) * 1000);
      t.unref();
      minuteurs.push(t);
    }
  })().catch((err) => console.error('[COLLECTE] Démarrage interrompu :', err.message));

  return () => {
    arrete = true;
    minuteurs.forEach(clearInterval);
  };
}

module.exports = { demarrerCollecte, executerTache, TACHES };
