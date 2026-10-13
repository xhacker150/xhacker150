'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FsolarClient, FsolarError } = require('../src/fsolar/client');
const { creerFauxFsolar, PLANT_A, SN_TREX } = require('./fauxFsolar');

async function preparer(options = {}) {
  const faux = creerFauxFsolar();
  const baseUrl = await faux.demarrer();
  const client = new FsolarClient({
    baseUrl,
    utilisateur: faux.utilisateur,
    motDePasse: options.motDePasse ?? faux.motDePasse,
    clePublique: faux.clePublique,
    modeParametresGet: options.modeParametresGet ?? 'both',
  });
  return { faux, client };
}

test('connexion : mot de passe chiffré en RSA PKCS#1 v1.5, jeton envoyé tel quel', async (t) => {
  const { faux, client } = await preparer();
  t.after(() => faux.arreter());

  await client.listerCentrales();
  assert.equal(faux.etat.connexions, 1);
  const appel = faux.etat.appels.find((a) => a.chemin === '/openApi/plants/list');
  assert.match(appel.authorization, /^Bearer_acces\./, 'le jeton "Bearer_…" doit être envoyé sans préfixe ajouté');
  assert.equal(appel.lang, 'en_US');

  // Le jeton est réutilisé
  await client.listerOnduleurs();
  assert.equal(faux.etat.connexions, 1);
});

test('connexion : mauvais mot de passe → FsolarError avec le code fSolar', async (t) => {
  const { faux, client } = await preparer({ motDePasse: 'faux' });
  t.after(() => faux.arreter());

  await assert.rejects(client.listerCentrales(), (err) => {
    assert.ok(err instanceof FsolarError);
    assert.equal(err.code, 1002006);
    return true;
  });
});

test('jeton expiré (code 998 en HTTP 200) → rafraîchissement puis nouvelle tentative', async (t) => {
  const { faux, client } = await preparer();
  t.after(() => faux.arreter());

  await client.listerCentrales();
  faux.etat.forcerExpiration = true;
  const centrales = await client.listerCentrales();
  assert.equal(centrales.length, 2);
  assert.equal(faux.etat.rafraichissements, 1);
  assert.equal(faux.etat.connexions, 1);
});

test('jeton refusé (999) → reconnexion complète', async (t) => {
  const { faux, client } = await preparer();
  t.after(() => faux.arreter());

  await client.listerCentrales();
  faux.etat.jetonsValides.clear(); // le serveur a tout invalidé
  await client.listerCentrales();
  assert.equal(faux.etat.connexions, 2);
});

test('les identifiants > 2^53 restent des chaînes exactes', async (t) => {
  const { faux, client } = await preparer();
  t.after(() => faux.arreter());

  const centrales = await client.listerCentrales();
  assert.equal(centrales[0].plantId, PLANT_A);
  const reponse = await client.envoyerReglages(SN_TREX, { buzzerEnable: 0 });
  assert.equal(reponse.id, '9797479076789696123');
});

test('paramètres GET : URL et corps form-data selon le mode', async (t) => {
  for (const mode of ['both', 'query', 'body']) {
    const { faux, client } = await preparer({ modeParametresGet: mode });
    t.after(() => faux.arreter());
    await client.energieOnduleur(SN_TREX, 'month', '2026-10-01 00:00:00');
    const appel = faux.etat.appels.find((a) => a.chemin === '/openApi/data/deviceDataEnergy');
    assert.equal(appel.params.timeDimension, 'month', `mode ${mode}`);
    assert.equal(appel.query.timeDimension === 'month', mode !== 'body', `query en mode ${mode}`);
    assert.equal(appel.corps.includes('timeDimension=month'), mode !== 'query', `corps en mode ${mode}`);
  }
});

test('dernières mesures : lots de 50 numéros de série maximum', async (t) => {
  const { faux, client } = await preparer();
  t.after(() => faux.arreter());

  const sns = Array.from({ length: 120 }, (_, i) => `SN${i}`);
  await client.dernieresMesures(sns);
  const lots = faux.etat.appels.filter((a) => a.chemin === '/openApi/data/devicesDataHistory');
  assert.deepEqual(lots.map((a) => a.params.deviceSnList.split(',').length), [50, 50, 20]);
  assert.ok(lots.every((a) => a.params.queryType === '0'));
});
