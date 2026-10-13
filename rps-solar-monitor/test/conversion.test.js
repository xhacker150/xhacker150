'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyserFuseau, dateDepuisTexteLocal, jourLocal } = require('../src/temps');
const { convertirMesure, convertirEnergieJour, convertirEvenement } = require('../src/collecteur/conversion');
const { moisASynchroniser } = require('../src/collecteur/synchronisation');

test('fuseaux fSolar', () => {
  assert.equal(analyserFuseau('UTC+01:00'), 60);
  assert.equal(analyserFuseau('UTC+8'), 480);
  assert.equal(analyserFuseau('GMT-05:30'), -330);
  assert.equal(analyserFuseau('+01:00'), 60);
  assert.equal(analyserFuseau('UTC'), 0);
  assert.equal(analyserFuseau('Africa/Niamey'), null);
  assert.equal(analyserFuseau(null), null);
});

test('heures locales → UTC', () => {
  assert.equal(dateDepuisTexteLocal('2026-10-13 08:30:00', 60).toISOString(), '2026-10-13T07:30:00.000Z');
  assert.equal(dateDepuisTexteLocal('2026-10-13', 0).toISOString(), '2026-10-13T00:00:00.000Z');
  assert.equal(dateDepuisTexteLocal('13/10/2026', 60), null);
  assert.equal(jourLocal(new Date('2026-10-12T23:30:00Z'), 60), '2026-10-13');
});

test('mesure temps réel : fuseau de la mesure sinon fuseau par défaut', () => {
  const m = convertirMesure({ deviceSn: 'A', deviceDataTime: '2026-10-13 12:00:00', timeZone: 'UTC+03:00', pvTotalPower: '1500', emsSoc: '' }, 60);
  assert.equal(m.horodatage.toISOString(), '2026-10-13T09:00:00.000Z');
  assert.equal(m.pvW, 1500);
  assert.equal(m.soc, null);
  const sansFuseau = convertirMesure({ deviceSn: 'A', deviceDataTime: '2026-10-13 12:00:00' }, 60);
  assert.equal(sansFuseau.horodatage.toISOString(), '2026-10-13T11:00:00.000Z');
  assert.equal(convertirMesure({ deviceSn: 'A' }, 60), null);
});

test('énergie journalière : sommes et enregistrements non journaliers ignorés', () => {
  const e = convertirEnergieJour({ dataTime: '2026-10-01', generateEnergy: 21, pv1Energy: 11, pv2Energy: 10,
    batCharEnergy: 4, bat2ChartEnergy: 1, offGridEnergy: 2, gridTiedEnergy: 18 }, 'SN');
  assert.equal(e.deviceSn, 'SN');
  assert.equal(e.pvKwh, 21);
  assert.equal(e.batterieChargeKwh, 5);
  assert.equal(e.batterieDechargeKwh, null);
  assert.equal(e.consommationKwh, 20);
  assert.equal(convertirEnergieJour({ dataTime: '2026-10' }, 'SN'), null);
});

test('événements : champs fSolar "warring*"', () => {
  const e = convertirEvenement({ warnCode: 'F03', warringName: 'Bus fault', warringType: 'F', dataTimeStr: '2026-10-13 07:00:00' }, 'SN', 60);
  assert.equal(e.nom, 'Bus fault');
  assert.equal(e.typeEvenement, 'F');
  assert.equal(e.horodatage.toISOString(), '2026-10-13T06:00:00.000Z');
});

test('mois à synchroniser', () => {
  assert.deepEqual(moisASynchroniser(new Date('2026-10-13T10:00:00Z'), 60), ['2026-10-01 00:00:00']);
  assert.deepEqual(moisASynchroniser(new Date('2026-01-01T10:00:00Z'), 60), ['2026-01-01 00:00:00', '2025-12-01 00:00:00']);
});
