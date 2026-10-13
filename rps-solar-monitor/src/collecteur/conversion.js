'use strict';

/**
 * Conversion des réponses fSolar vers les lignes de la base.
 * Les noms de champs fSolar (y compris leurs fautes : warringName, bat2ChartEnergy)
 * sont ceux de la documentation officielle.
 */

const { analyserFuseau, dateDepuisTexteLocal } = require('../temps');

function nombre(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function texte(v) {
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

/** Somme des valeurs présentes ; null si aucune n'est renseignée. */
function somme(...valeurs) {
  const presentes = valeurs.map(nombre).filter((v) => v !== null);
  return presentes.length ? presentes.reduce((a, b) => a + b, 0) : null;
}

function convertirCentrale(p) {
  const plantId = texte(p.plantId);
  if (!plantId) return null;
  return {
    plantId,
    nom: texte(p.plantName),
    fuseau: texte(p.timeZone),
    adresse: texte(p.plantAddress),
  };
}

function convertirOnduleur(d) {
  const deviceSn = texte(d.deviceSn);
  if (!deviceSn) return null;
  return { deviceSn, plantId: texte(d.plantId) };
}

function convertirDonneesBase(b) {
  return {
    modele: texte(b.deviceModel),
    typeAppareil: texte(b.deviceType || b.type),
    sousType: texte(b.subType),
    puissanceNominale: nombre(b.ratedPower),
    statut: texte(b.status),
    versionFirmware: texte(b.firmwareVersion),
  };
}

function convertirMesure(m, fuseauDefautMinutes) {
  const deviceSn = texte(m.deviceSn);
  if (!deviceSn) return null;
  const decalage = analyserFuseau(m.timeZone) ?? fuseauDefautMinutes;
  const horodatage = dateDepuisTexteLocal(m.deviceDataTime, decalage);
  if (!horodatage) return null;
  return {
    deviceSn,
    horodatage,
    pvW: nombre(m.pvTotalPower),
    reseauW: nombre(m.acTtlInpower),
    chargeW: nombre(m.meterPower),
    secoursW: nombre(m.acTotalOutActPower),
    batterieW: nombre(m.emsPower),
    soc: nombre(m.emsSoc),
    temperatureMax: nombre(m.devTempMax),
    modeTravail: texte(m.workMode),
    brut: m,
  };
}

/** Un enregistrement d'énergie journalier (dataTime "YYYY-MM-DD"), sinon null. */
function convertirEnergieJour(r, deviceSnParDefaut) {
  const jour = texte(r.dataTime);
  if (!jour || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  return {
    deviceSn: texte(r.deviceSn) || deviceSnParDefaut,
    jour,
    productionKwh: nombre(r.generateEnergy),
    pvKwh: somme(r.pv1Energy, r.pv2Energy, r.pv3Energy, r.pv4Energy),
    reseauImportKwh: nombre(r.gridInput),
    reseauExportKwh: nombre(r.feedOutput),
    batterieChargeKwh: somme(r.batCharEnergy, r.bat2ChartEnergy),
    batterieDechargeKwh: somme(r.batDisEnergy, r.batDis2Energy),
    consommationKwh: somme(r.offGridEnergy, r.gridTiedEnergy, r.smartLoadEnergy),
    groupeKwh: nombre(r.genEnergy),
    brut: r,
  };
}

function convertirEvenement(e, deviceSnParDefaut, fuseauDefautMinutes) {
  const horodatageTexte = texte(e.dataTimeStr);
  const code = texte(e.warnCode);
  if (!horodatageTexte || !code) return null;
  const decalage = analyserFuseau(e.timeZone) ?? fuseauDefautMinutes;
  return {
    deviceSn: texte(e.deviceSn) || deviceSnParDefaut,
    horodatageTexte,
    horodatage: dateDepuisTexteLocal(horodatageTexte, decalage),
    code,
    nom: texte(e.warringName),
    typeEvenement: texte(e.warringType),
    fuseau: texte(e.timeZone),
  };
}

module.exports = {
  nombre,
  convertirCentrale,
  convertirOnduleur,
  convertirDonneesBase,
  convertirMesure,
  convertirEnergieJour,
  convertirEvenement,
};
