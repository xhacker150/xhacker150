'use strict';

/**
 * Test de bout en bout : faux serveur fSolar → collecte → PostgreSQL → API web.
 * Nécessite TEST_DATABASE_URL (un rôle autorisé à créer des bases), par exemple :
 *   TEST_DATABASE_URL=postgres://rps_test:rps_test@localhost:5432/postgres npm test
 * Une base temporaire est créée puis supprimée.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { creerPool, appliquerSchema } = require('../src/db/pool');
const { FsolarClient } = require('../src/fsolar/client');
const { creerApp } = require('../src/app');
const { executerTache } = require('../src/collecteur');
const sync = require('../src/collecteur/synchronisation');
const { jourLocal } = require('../src/temps');
const { creerFauxFsolar, PLANT_A, SN_TREX, SN_TREX_2, SN_IVEM } = require('./fauxFsolar');

const URL_ADMIN = process.env.TEST_DATABASE_URL;

test('bout en bout : collecte, tableau de bord, rapports et réglages', { skip: !URL_ADMIN && 'TEST_DATABASE_URL non défini' }, async (t) => {
  // ── Base temporaire ────────────────────────────────────────────────────
  const nomBase = `rps_solaire_test_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nomBase}`);
  const urlBase = new URL(URL_ADMIN);
  urlBase.pathname = `/${nomBase}`;
  const pool = creerPool({ connectionString: urlBase.toString() });

  const faux = creerFauxFsolar();
  const baseUrl = await faux.demarrer();

  let serveur;
  t.after(async () => {
    if (serveur) await new Promise((r) => serveur.close(r));
    await pool.end();
    await faux.arreter();
    await admin.query(`DROP DATABASE IF EXISTS ${nomBase}`);
    await admin.end();
  });

  await appliquerSchema(pool);
  await appliquerSchema(pool); // idempotent

  const config = {
    jwtSecret: 'x'.repeat(40),
    sessionHeures: 1,
    cookieSecurise: false,
    fuseauDefautMinutes: 60,
    collecte: { horsLigneMinutes: 20 },
    reglages: { delaiVerificationSec: 0, delaiAbandonMinutes: 30 },
  };
  const client = new FsolarClient({
    baseUrl, utilisateur: faux.utilisateur, motDePasse: faux.motDePasse, clePublique: faux.clePublique,
  });
  const ctx = { client, pool, config };

  // ── Collecte ───────────────────────────────────────────────────────────
  await t.test('collecte', async () => {
    for (const [nom, fn] of [
      ['inventaire', sync.synchroniserInventaire],
      ['mesures', sync.synchroniserMesures],
      ['energie', (c) => sync.synchroniserEnergie(c)],
      ['evenements', sync.synchroniserEvenements],
    ]) {
      const r = await executerTache(ctx, nom, fn);
      assert.equal(r.succes, true, `${nom} : ${r.erreur}`);
    }
    const { rows: centrales } = await pool.query('SELECT plant_id FROM centrales ORDER BY plant_id');
    assert.ok(centrales.some((c) => c.plant_id === PLANT_A), 'identifiant > 2^53 conservé exactement');
    const { rows: ond } = await pool.query('SELECT device_sn, modele, plant_id FROM onduleurs ORDER BY device_sn');
    assert.equal(ond.length, 3);
    assert.equal(ond.find((o) => o.device_sn === SN_TREX).modele, 'T-REX-10KLP3G01');
    const { rows: [{ n: nbMesures }] } = await pool.query('SELECT COUNT(*)::int AS n FROM mesures');
    assert.equal(nbMesures, 2);
    const { rows: [{ n: nbEnergie }] } = await pool.query('SELECT COUNT(*)::int AS n FROM energie_jour');
    assert.ok(nbEnergie >= 9);
    // Deuxième passage : pas de doublons
    await sync.synchroniserMesures(ctx);
    await sync.synchroniserEvenements(ctx);
    const { rows: [{ n: nbMesures2 }] } = await pool.query('SELECT COUNT(*)::int AS n FROM mesures');
    assert.equal(nbMesures2, 2);
    const { rows: [{ n: nbEv }] } = await pool.query('SELECT COUNT(*)::int AS n FROM evenements');
    assert.equal(nbEv, 1);
  });

  // ── Utilisateurs et serveur web ────────────────────────────────────────
  const hash = await bcrypt.hash('mot-de-passe-solide', 4);
  for (const [id, role] of [['lecteur', 'lecteur'], ['operateur', 'operateur'], ['admin', 'admin']]) {
    await pool.query('INSERT INTO utilisateurs (identifiant, mot_de_passe_hash, role) VALUES ($1, $2, $3)', [id, hash, role]);
  }
  const app = creerApp({ pool, client, config });
  const urlApp = await new Promise((r) => {
    serveur = app.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${serveur.address().port}`));
  });

  async function connecter(identifiant) {
    const res = await fetch(`${urlApp}/api/auth/connexion`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiant, motDePasse: 'mot-de-passe-solide' }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    return async (chemin, { methode = 'GET', corps, type = 'application/json' } = {}) => {
      const r = await fetch(`${urlApp}${chemin}`, {
        method: methode,
        headers: { Cookie: cookie, ...(corps !== undefined ? { 'Content-Type': type } : {}) },
        body: corps === undefined ? undefined : type === 'application/json' ? JSON.stringify(corps) : corps,
      });
      const texte = await r.text();
      let json = null;
      try { json = JSON.parse(texte); } catch { /* CSV */ }
      return { statut: r.status, json, texte, entetes: r.headers };
    };
  }

  await t.test('authentification et droits', async () => {
    assert.equal((await fetch(`${urlApp}/api/apercu`)).status, 401);
    const mauvais = await fetch(`${urlApp}/api/auth/connexion`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiant: 'lecteur', motDePasse: 'faux' }),
    });
    assert.equal(mauvais.status, 401);
    const lecteur = await connecter('lecteur');
    assert.equal((await lecteur('/api/auth/moi')).json.data.role, 'lecteur');
    assert.equal((await lecteur('/api/stations', { methode: 'POST', corps: { code: 'X', nom: 'X' } })).statut, 403);
    // Écriture non JSON refusée (protection CSRF)
    const admin = await connecter('admin');
    assert.equal((await admin('/api/stations', { methode: 'POST', corps: 'code=X&nom=X', type: 'application/x-www-form-urlencoded' })).statut, 415);
    assert.equal((await fetch(`${urlApp}/health`)).status, 200);
    const page = await fetch(`${urlApp}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await fetch(`${urlApp}/vendor/chart.umd.js`)).status, 200);
  });

  let stationId;
  await t.test('administration : station et rattachement de centrale', async () => {
    const admin = await connecter('admin');
    const cree = await admin('/api/stations', { methode: 'POST', corps: { code: 'nia01', nom: 'Niamey Centre', ville: 'Niamey' } });
    assert.equal(cree.statut, 201);
    assert.equal(cree.json.data.code, 'NIA01');
    stationId = cree.json.data.id;
    assert.equal((await admin('/api/stations', { methode: 'POST', corps: { code: 'NIA01', nom: 'Doublon' } })).statut, 409);
    const rattache = await admin(`/api/centrales/${PLANT_A}/station`, { methode: 'PUT', corps: { stationId } });
    assert.equal(rattache.statut, 200);
    assert.equal(rattache.json.data.plant_id, PLANT_A);
  });

  await t.test('aperçu et détail de station', async () => {
    const lecteur = await connecter('lecteur');
    const { json } = await lecteur('/api/apercu');
    const st = json.data.stations.find((s) => s.id === stationId);
    assert.equal(st.resume.nbOnduleurs, 2);
    assert.equal(st.resume.nbEnLigne, 1, 'SN_TREX_2 a une mesure ancienne : hors ligne');
    assert.equal(st.etat, 'hors_ligne');
    assert.equal(st.resume.pvW, 5200);
    assert.equal(st.resume.chargeW, 4000);
    assert.equal(st.resume.alarmes24h, 1);
    const nonAffectee = json.data.stations.find((s) => s.id === null);
    assert.deepEqual(nonAffectee.onduleurs.map((o) => o.deviceSn), [SN_IVEM]);
    assert.equal(json.data.collecte.length, 4);

    const detail = await lecteur(`/api/stations/${stationId}`);
    assert.equal(detail.statut, 200);
    assert.equal(detail.json.data.onduleurs.length, 2);
    assert.ok(detail.json.data.historique.length >= 3);
    assert.equal(detail.json.data.evenements[0].nom, 'PV2 Low voltage');
    assert.equal((await lecteur('/api/stations/9999')).statut, 404);
  });

  await t.test('rapports de production (JSON et CSV)', async () => {
    const lecteur = await connecter('lecteur');
    const debut = `${jourLocal(new Date(), 60).slice(0, 7)}-01`;
    const fin = `${debut.slice(0, 8)}28`;
    const { statut, json } = await lecteur(`/api/rapports/production?debut=${debut}&fin=${fin}&grouper=jour&station=${stationId}`);
    assert.equal(statut, 200);
    assert.deepEqual(json.data.lignes.map((l) => l.productionKwh), [42, 44, 46]);
    const total = json.data.totaux[0];
    assert.equal(total.productionKwh, 132);
    assert.equal(total.consommationKwh, 120);
    assert.equal(total.reseauImportKwh, 30);
    assert.equal(total.autonomiePct, 75);

    const mois = await lecteur(`/api/rapports/production?debut=${debut}&fin=${fin}&grouper=mois`);
    assert.equal(mois.json.data.lignes.length, 2, 'une ligne par station, dont "Non affectée"');

    const csv = await lecteur(`/api/rapports/production?debut=${debut}&fin=${fin}&grouper=jour&station=${stationId}&format=csv`);
    assert.match(csv.entetes.get('content-type'), /text\/csv/);
    const lignes = csv.texte.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lignes.length, 4);
    assert.match(lignes[0], /^Station;Code;Période;Onduleurs;Production \(kWh\)/);
    assert.match(lignes[1], /^Niamey Centre;NIA01;/);

    assert.equal((await lecteur('/api/rapports/production?debut=2026-02-30&fin=2026-03-01')).statut, 400);
    assert.equal((await lecteur('/api/rapports/production?debut=2020-01-01&fin=2026-01-01')).statut, 400);
  });

  await t.test('réglages : liste blanche, journal et vérification par relecture', async () => {
    const lecteur = await connecter('lecteur');
    const op = await connecter('operateur');

    assert.equal((await lecteur(`/api/onduleurs/${SN_TREX}/reglages`)).statut, 403);
    assert.equal((await lecteur(`/api/onduleurs/${SN_TREX}/reglages`, { methode: 'POST', corps: { reglages: { buzzerEnable: 0 }, motif: 'essai' } })).statut, 403);

    const lecture = await op(`/api/onduleurs/${SN_TREX}/reglages`);
    assert.equal(lecture.json.data.prisEnCharge, true);
    assert.equal(lecture.json.data.valeurs.operatedMode, 0);
    assert.equal(lecture.json.data.valeurs.deviceSn, undefined, 'seules les valeurs de la liste blanche sont renvoyées');
    assert.equal((await op(`/api/onduleurs/${SN_IVEM}/reglages`)).json.data.prisEnCharge, false);

    const sansMotif = await op(`/api/onduleurs/${SN_TREX}/reglages`, { methode: 'POST', corps: { reglages: { operatedMode: 2 } } });
    assert.equal(sansMotif.statut, 400);
    const interdit = await op(`/api/onduleurs/${SN_TREX}/reglages`, { methode: 'POST', corps: { reglages: { factoryReset: 1 }, motif: 'Essai interdit' } });
    assert.equal(interdit.statut, 400);
    assert.match(interdit.json.details[0], /non autorisé/);
    const ivem = await op(`/api/onduleurs/${SN_IVEM}/reglages`, { methode: 'POST', corps: { reglages: { buzzerEnable: 0 }, motif: 'Essai IVEM' } });
    assert.equal(ivem.statut, 400);
    const nbAvant = (await pool.query('SELECT COUNT(*)::int AS n FROM commandes')).rows[0].n;
    assert.equal(nbAvant, 0, 'aucune commande refusée ne doit être journalisée comme envoyée');

    const envoi = await op(`/api/onduleurs/${SN_TREX}/reglages`, {
      methode: 'POST', corps: { reglages: { operatedMode: 2 }, motif: 'Passage en mode ECO' },
    });
    assert.equal(envoi.statut, 202, JSON.stringify(envoi.json));
    assert.equal(envoi.json.data.statut, 'envoyee');
    assert.equal(envoi.json.data.id_commande_fsolar, '9797479076789696123');
    const post = faux.etat.appels.filter((a) => a.chemin === '/openApi/cmd/deviceSetting');
    assert.deepEqual(JSON.parse(post[0].corps), { deviceSn: SN_TREX, content: { operatedMode: 2 } });

    const doublon = await op(`/api/onduleurs/${SN_TREX}/reglages`, { methode: 'POST', corps: { reglages: { buzzerEnable: 0 }, motif: 'Deuxième envoi' } });
    assert.equal(doublon.statut, 409);

    await sync.verifierCommandes(ctx);
    const { rows: [cmd] } = await pool.query('SELECT statut, valeurs_avant FROM commandes WHERE id = $1', [envoi.json.data.id]);
    assert.equal(cmd.statut, 'verifiee');
    assert.equal(cmd.valeurs_avant.operatedMode, 0);

    // Onduleur qui n'applique pas la commande → écart après le délai d'abandon
    faux.etat.ignorerReglages = true;
    const envoi2 = await op(`/api/onduleurs/${SN_TREX_2}/reglages`, { methode: 'POST', corps: { reglages: { operatedMode: 2 }, motif: 'Essai écart' } });
    assert.equal(envoi2.statut, 202);
    await sync.verifierCommandes(ctx);
    assert.equal((await pool.query('SELECT statut FROM commandes WHERE id = $1', [envoi2.json.data.id])).rows[0].statut, 'envoyee',
      "avant le délai d'abandon, on attend que l'onduleur applique");
    config.reglages.delaiAbandonMinutes = 0;
    await sync.verifierCommandes(ctx);
    const { rows: [cmd2] } = await pool.query('SELECT statut, erreur FROM commandes WHERE id = $1', [envoi2.json.data.id]);
    assert.equal(cmd2.statut, 'ecart');
    assert.match(cmd2.erreur, /operatedMode/);

    const journal = await lecteur('/api/commandes');
    assert.equal(journal.json.data.length, 2);
    assert.equal(journal.json.data[1].utilisateur, 'operateur');
    assert.equal(journal.json.data[1].station_nom, 'Niamey Centre');
  });
});
