'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validerReglages, comparerReglages } = require('../src/reglages/listeBlanche');

const TREX = { modele: 'T-REX-10KLP3G01', puissanceNominale: 10000 };

test('accepte des réglages autorisés et les normalise', () => {
  const r = validerReglages({
    operatedMode: '2',
    batteryOnGridDischargeDepthSoc: 30,
    ecoRule1: {
      ruleMode: 1, power: 3000, soc: 90, voltage: 54.5, startTime: '01:00', stopTime: '05:30',
      startDay: '01:01', stopDay: '12:31', daysOfEffectiveWeek: ['FRIDAY', 'MONDAY', 'MONDAY'],
    },
    ecoRule2: { ruleMode: 0 },
  }, TREX);
  assert.equal(r.ok, true, r.erreurs.join('\n'));
  assert.equal(r.contenu.operatedMode, 2);
  assert.deepEqual(r.contenu.ecoRule1.daysOfEffectiveWeek, ['MONDAY', 'FRIDAY']);
  assert.deepEqual(r.contenu.ecoRule2, { ruleMode: 0 });
});

test('refuse les protections réseau, la remise à zéro et les champs inconnus', () => {
  const r = validerReglages({ antiIslandingDetectionEnable: 0, factoryReset: 1, remoteOnOffEnable: 0 }, TREX);
  assert.equal(r.ok, false);
  assert.equal(r.erreurs.length, 3);
  assert.deepEqual(r.contenu, {});
});

test('refuse les modèles non pris en charge ou inconnus', () => {
  assert.equal(validerReglages({ buzzerEnable: 1 }, { modele: 'IVEM-AI5048' }).ok, false);
  assert.equal(validerReglages({ buzzerEnable: 1 }, { modele: null }).ok, false);
});

test('contrôle les plages et les formats', () => {
  const cas = [
    { batteryOnGridDischargeDepthSoc: 5 },
    { batteryOnGridDischargeDepthSoc: 50.5 },
    { batteryOnGridDischargeDepthSoc: '' },
    { batteryOnGridDischargeDepthSoc: true },
    { operatedMode: 3 },
    { ecoRule1: { ruleMode: 1, power: 100, soc: 50, startTime: '24:00', stopTime: '05:00', startDay: '01:01', stopDay: '12:12', daysOfEffectiveWeek: ['MONDAY'] } },
    { ecoRule1: { ruleMode: 1, power: 100, soc: 50, startTime: '01:00', stopTime: '05:00', startDay: '02:30', stopDay: '12:12', daysOfEffectiveWeek: ['MONDAY'] } },
    { ecoRule1: { ruleMode: 1, power: 100, soc: 50, startTime: '01:00', stopTime: '05:00', startDay: '01:01', stopDay: '12:12', daysOfEffectiveWeek: [] } },
    { ecoRule1: { ruleMode: 1, power: 100, soc: 50, voltage: 35, startTime: '01:00', stopTime: '05:00', startDay: '01:01', stopDay: '12:12', daysOfEffectiveWeek: ['MONDAY'] } },
    { ecoRule1: { ruleMode: 2 } },
    { ecoRule1: { ruleMode: 0, inconnu: 1 } },
    { ecoRule5: { ruleMode: 0 } },
  ];
  for (const demande of cas) {
    assert.equal(validerReglages(demande, TREX).ok, false, JSON.stringify(demande));
  }
});

test('la puissance ECO ne dépasse pas la puissance nominale (kW ou W)', () => {
  const regle = { ruleMode: 2, power: 7000, soc: 20, startTime: '18:00', stopTime: '22:00', startDay: '01:01', stopDay: '12:31', daysOfEffectiveWeek: ['MONDAY'] };
  assert.equal(validerReglages({ ecoRule1: regle }, { modele: 'T-REX-6KLP1G01', puissanceNominale: 6 }).ok, false);
  assert.equal(validerReglages({ ecoRule1: regle }, { modele: 'T-REX-10KLP3G01', puissanceNominale: 10 }).ok, true);
});

test('le SOC de reprise hors réseau doit dépasser le SOC mini', () => {
  const r = validerReglages({ batteryOffGridDischargeDepthSoc: 40, batteryOffGridRecoveryDepthSoc: 30 }, TREX);
  assert.equal(r.ok, false);
});

test('comparaison après relecture', () => {
  const contenu = { operatedMode: 2, ecoRule1: { ruleMode: 1, daysOfEffectiveWeek: ['MONDAY', 'FRIDAY'] } };
  assert.deepEqual(comparerReglages(contenu, {
    operatedMode: '2', ecoRule1: { ruleMode: 1, daysOfEffectiveWeek: ['FRIDAY', 'MONDAY'] },
  }), []);
  const ecarts = comparerReglages(contenu, { operatedMode: 0, ecoRule1: { ruleMode: 1 } });
  assert.deepEqual(ecarts.map((e) => e.champ), ['operatedMode', 'ecoRule1.daysOfEffectiveWeek']);
  assert.equal(comparerReglages({ operatedMode: 0 }, { operatedMode: null }).length, 1);
});
