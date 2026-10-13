'use strict';

/**
 * Réglages d'onduleurs modifiables depuis le tableau de bord.
 *
 * Seuls quelques paramètres d'exploitation sont autorisés. Les protections réseau
 * (anti-îlotage, seuils de tension/fréquence, limites d'injection), la remise à zéro
 * usine et les arrêts à distance restent volontairement exclus.
 *
 * Les clés sont celles de l'OpenAPI fSolar pour les onduleurs T-REX
 * (POST /openApi/cmd/deviceSetting). Les autres gammes (IVEM, IVGM…) ont des clés
 * différentes et ne sont pas encore prises en charge.
 */

const MODELES_PRIS_EN_CHARGE = [/^T-REX/i];

const JOURS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const REGLES_ECO = ['ecoRule1', 'ecoRule2', 'ecoRule3', 'ecoRule4'];

const CHAMPS = {
  operatedMode: {
    libelle: 'Mode de fonctionnement',
    type: 'choix',
    choix: { 0: 'Général', 1: 'Secours (backup)', 2: 'ECO' },
  },
  batteryOnGridDischargeDepthSoc: {
    libelle: 'SOC mini de décharge batterie (réseau présent)',
    type: 'entier', min: 10, max: 100, unite: '%',
  },
  batteryOffGridDischargeDepthSoc: {
    libelle: 'SOC mini de décharge batterie (hors réseau)',
    type: 'entier', min: 0, max: 100, unite: '%',
  },
  batteryOffGridRecoveryDepthSoc: {
    libelle: 'SOC de reprise batterie (hors réseau)',
    type: 'entier', min: 0, max: 100, unite: '%',
  },
  buzzerEnable: { libelle: 'Buzzer', type: 'choix', choix: { 0: 'Désactivé', 1: 'Activé' } },
  lcdBacklightEnable: { libelle: 'Rétroéclairage écran', type: 'choix', choix: { 0: 'Désactivé', 1: 'Activé' } },
};

const CHAMPS_REGLE_ECO = {
  ruleMode: { libelle: 'Action', type: 'choix', choix: { 0: 'Désactivée', 1: 'Charge', 2: 'Décharge' } },
  power: { libelle: 'Puissance', type: 'entier', min: 0, max: 100000, unite: 'W' },
  soc: { libelle: 'SOC cible', type: 'entier', min: 0, max: 100, unite: '%' },
  voltage: { libelle: 'Tension cible', type: 'decimal', min: 48, max: 60, unite: 'V', optionnel: true },
  startTime: { libelle: 'Heure de début', type: 'heure' },
  stopTime: { libelle: 'Heure de fin', type: 'heure' },
  startDay: { libelle: 'Date de début (MM:JJ)', type: 'jour' },
  stopDay: { libelle: 'Date de fin (MM:JJ)', type: 'jour' },
  daysOfEffectiveWeek: { libelle: 'Jours actifs', type: 'jours' },
};

function modelePrisEnCharge(modele) {
  return !!modele && MODELES_PRIS_EN_CHARGE.some((re) => re.test(modele));
}

/** Puissance nominale fSolar → W (la doc ne précise pas l'unité : < 1000 est lu en kW). */
function puissanceNominaleW(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1000 ? n * 1000 : n;
}

function validerValeur(nom, def, valeur, erreurs) {
  switch (def.type) {
    case 'choix': {
      const n = Number(valeur);
      if (!Number.isInteger(n) || !(String(n) in def.choix)) {
        erreurs.push(`${nom} : valeur ${JSON.stringify(valeur)} non autorisée (${Object.keys(def.choix).join(', ')}).`);
        return undefined;
      }
      return n;
    }
    case 'entier':
    case 'decimal': {
      const n = Number(valeur);
      const ok = typeof valeur !== 'boolean' && valeur !== '' && valeur !== null && Number.isFinite(n)
        && (def.type === 'decimal' || Number.isInteger(n));
      if (!ok || n < def.min || n > def.max) {
        erreurs.push(`${nom} : doit être un ${def.type === 'entier' ? 'entier' : 'nombre'} entre ${def.min} et ${def.max}${def.unite ? ' ' + def.unite : ''}.`);
        return undefined;
      }
      return n;
    }
    case 'heure': {
      const m = typeof valeur === 'string' && valeur.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
      if (!m) {
        erreurs.push(`${nom} : format attendu HH:mm (00:00 à 23:59).`);
        return undefined;
      }
      return valeur;
    }
    case 'jour': {
      const m = typeof valeur === 'string' && valeur.match(/^(\d{2}):(\d{2})$/);
      const mois = m ? +m[1] : 0;
      const jour = m ? +m[2] : 0;
      const joursParMois = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (!m || mois < 1 || mois > 12 || jour < 1 || jour > joursParMois[mois - 1]) {
        erreurs.push(`${nom} : format attendu MM:JJ (ex. 01:01 ou 12:31).`);
        return undefined;
      }
      return valeur;
    }
    case 'jours': {
      const ok = Array.isArray(valeur) && valeur.length > 0 && valeur.every((j) => JOURS.includes(j));
      if (!ok) {
        erreurs.push(`${nom} : liste non vide parmi ${JOURS.join(', ')}.`);
        return undefined;
      }
      return [...new Set(valeur)].sort((a, b) => JOURS.indexOf(a) - JOURS.indexOf(b));
    }
    default:
      throw new Error(`Type de champ inconnu : ${def.type}`);
  }
}

function validerRegleEco(nom, regle, puissanceMaxW, erreurs) {
  if (!regle || typeof regle !== 'object' || Array.isArray(regle)) {
    erreurs.push(`${nom} : objet attendu.`);
    return undefined;
  }
  for (const cle of Object.keys(regle)) {
    if (!(cle in CHAMPS_REGLE_ECO)) erreurs.push(`${nom}.${cle} : champ non autorisé.`);
  }
  const propre = {};
  const ruleMode = validerValeur(`${nom}.ruleMode`, CHAMPS_REGLE_ECO.ruleMode, regle.ruleMode, erreurs);
  if (ruleMode === undefined) return undefined;
  propre.ruleMode = ruleMode;
  // Une règle désactivée n'a besoin que de ruleMode
  if (ruleMode === 0) return propre;

  for (const [cle, def] of Object.entries(CHAMPS_REGLE_ECO)) {
    if (cle === 'ruleMode') continue;
    if (regle[cle] === undefined) {
      if (!def.optionnel) erreurs.push(`${nom}.${cle} : obligatoire quand la règle est active.`);
      continue;
    }
    const v = validerValeur(`${nom}.${cle}`, def, regle[cle], erreurs);
    if (v !== undefined) propre[cle] = v;
  }
  if (propre.power !== undefined && puissanceMaxW && propre.power > puissanceMaxW) {
    erreurs.push(`${nom}.power : ${propre.power} W dépasse la puissance nominale de l'onduleur (${puissanceMaxW} W).`);
  }
  if (propre.startTime && propre.startTime === propre.stopTime) {
    erreurs.push(`${nom} : l'heure de début et l'heure de fin sont identiques.`);
  }
  return propre;
}

/**
 * Valide une demande de réglage.
 * @returns {{ ok: boolean, erreurs: string[], contenu: object }}
 *   contenu ne contient que les champs autorisés, normalisés.
 */
function validerReglages(demande, { modele, puissanceNominale } = {}) {
  const erreurs = [];
  const contenu = {};

  if (!modelePrisEnCharge(modele)) {
    return {
      ok: false,
      erreurs: [`Modèle "${modele || 'inconnu'}" non pris en charge pour le pilotage (gammes autorisées : T-REX).`],
      contenu,
    };
  }
  if (!demande || typeof demande !== 'object' || Array.isArray(demande) || !Object.keys(demande).length) {
    return { ok: false, erreurs: ['Aucun réglage fourni.'], contenu };
  }

  const puissanceMaxW = puissanceNominaleW(puissanceNominale);
  for (const [cle, valeur] of Object.entries(demande)) {
    if (REGLES_ECO.includes(cle)) {
      const regle = validerRegleEco(cle, valeur, puissanceMaxW, erreurs);
      if (regle !== undefined) contenu[cle] = regle;
    } else if (cle in CHAMPS) {
      const v = validerValeur(cle, CHAMPS[cle], valeur, erreurs);
      if (v !== undefined) contenu[cle] = v;
    } else {
      erreurs.push(`${cle} : réglage non autorisé depuis le tableau de bord.`);
    }
  }

  if (
    contenu.batteryOffGridDischargeDepthSoc !== undefined &&
    contenu.batteryOffGridRecoveryDepthSoc !== undefined &&
    contenu.batteryOffGridRecoveryDepthSoc <= contenu.batteryOffGridDischargeDepthSoc
  ) {
    erreurs.push('Le SOC de reprise hors réseau doit être supérieur au SOC mini de décharge hors réseau.');
  }

  return { ok: erreurs.length === 0, erreurs, contenu };
}

function valeursEgales(attendu, lu) {
  if (Array.isArray(attendu)) {
    if (!Array.isArray(lu)) return false;
    const a = [...attendu].map(String).sort();
    const b = [...lu].map(String).sort();
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (typeof attendu === 'number') {
    const n = Number(lu);
    return lu !== null && lu !== '' && Number.isFinite(n) && Math.abs(n - attendu) < 1e-6;
  }
  return String(attendu) === String(lu ?? '');
}

/** Compare les réglages demandés aux valeurs relues sur l'onduleur. */
function comparerReglages(contenu, relues) {
  const ecarts = [];
  for (const [cle, attendu] of Object.entries(contenu)) {
    if (attendu && typeof attendu === 'object' && !Array.isArray(attendu)) {
      const sousLu = relues?.[cle] || {};
      for (const [sousCle, sousAttendu] of Object.entries(attendu)) {
        if (!valeursEgales(sousAttendu, sousLu[sousCle])) {
          ecarts.push({ champ: `${cle}.${sousCle}`, attendu: sousAttendu, lu: sousLu[sousCle] ?? null });
        }
      }
    } else if (!valeursEgales(attendu, relues?.[cle])) {
      ecarts.push({ champ: cle, attendu, lu: relues?.[cle] ?? null });
    }
  }
  return ecarts;
}

/** Description des champs pour le formulaire du tableau de bord. */
function descriptionChamps() {
  return { champs: CHAMPS, reglesEco: REGLES_ECO, champsRegleEco: CHAMPS_REGLE_ECO, jours: JOURS };
}

/** Extrait des valeurs relues celles qui concernent la liste blanche (pour l'affichage). */
function extraireValeursAutorisees(relues) {
  const res = {};
  if (!relues || typeof relues !== 'object') return res;
  for (const cle of [...Object.keys(CHAMPS), ...REGLES_ECO]) {
    if (relues[cle] !== undefined) res[cle] = relues[cle];
  }
  return res;
}

module.exports = {
  validerReglages,
  comparerReglages,
  descriptionChamps,
  extraireValeursAutorisees,
  modelePrisEnCharge,
};
