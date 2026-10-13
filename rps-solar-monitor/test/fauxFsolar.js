'use strict';

/**
 * Faux serveur fSolar pour les tests, calqué sur la documentation :
 * RSA PKCS#1 v1.5, jetons "Bearer_…", erreurs en HTTP 200 avec un code,
 * identifiants > 2^53 renvoyés en nombres JSON bruts.
 */

const crypto = require('crypto');
const http = require('http');

const PLANT_A = '1514942003705499649'; // > 2^53 : doit rester une chaîne
const PLANT_B = '11614669775';
const SN_TREX = '020505004822242582';
const SN_TREX_2 = '020505004822240024';
const SN_IVEM = '100202000624170143';

function creerFauxFsolar({ utilisateur = 'rps@example.com', motDePasse = 'secret-fsolar' } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const clePublique = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const etat = {
    appels: [],
    connexions: 0,
    rafraichissements: 0,
    jetonsValides: new Set(),
    forcerExpiration: false, // le prochain appel authentifié renverra 998
    reglages: {
      [SN_TREX]: { deviceSn: SN_TREX, operatedMode: 0, batteryOnGridDischargeDepthSoc: 50, buzzerEnable: 1,
        ecoRule1: { ruleMode: 0 } },
      [SN_TREX_2]: { deviceSn: SN_TREX_2, operatedMode: 1 },
    },
    ignorerReglages: false, // simule un onduleur qui n'applique pas les commandes
  };
  let compteur = 0;
  // Horodatages figés : deux appels successifs renvoient la même mesure / le même événement
  const enHeureLocale = (d) => new Date(d.getTime() + 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const heureMesure = enHeureLocale(new Date()); // UTC+1
  const heureEvenement = enHeureLocale(new Date(Date.now() - 3600000)); // il y a une heure

  function nouveauJeton(prefixe) {
    compteur++;
    const j = `Bearer_${prefixe}.${compteur}.${crypto.randomBytes(6).toString('hex')}`;
    etat.jetonsValides.add(j);
    return j;
  }

  function jetons() {
    const maintenant = Date.now();
    return {
      token: nouveauJeton('acces'),
      tokenExpireTime: String(maintenant + 30 * 86400000),
      refreshToken: nouveauJeton('rafraichir'),
      refTokenExpireTime: String(maintenant + 60 * 86400000),
    };
  }

  const ok = (data) => ({ code: 200, message: 'Success', data });
  const ko = (code, message) => ({ code, message, data: message });

  function lireParams(req, url, corps) {
    const p = Object.fromEntries(url.searchParams);
    if (corps && (req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) {
      Object.assign(p, Object.fromEntries(new URLSearchParams(corps)));
    }
    return p;
  }

  function traiter(req, url, corps) {
    const chemin = url.pathname;
    const params = lireParams(req, url, corps);
    etat.appels.push({ methode: req.method, chemin, params, query: Object.fromEntries(url.searchParams), corps,
      authorization: req.headers.authorization, lang: req.headers.lang });

    if (chemin === '/openApi/sec/login' && req.method === 'POST') {
      const { userName, password } = JSON.parse(corps || '{}');
      let clair = null;
      try {
        clair = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
          Buffer.from(password, 'base64')).toString('utf8');
      } catch {
        clair = null;
      }
      if (userName !== utilisateur || clair !== motDePasse) return ko(1002006, 'Wrong password');
      etat.connexions++;
      return ok(jetons());
    }
    if (chemin === '/openApi/sec/refreshToken' && req.method === 'POST') {
      const { refreshToken } = JSON.parse(corps || '{}');
      if (!etat.jetonsValides.has(refreshToken)) return ko(999, 'You need to log in again.');
      etat.rafraichissements++;
      return ok(jetons());
    }

    // Endpoints authentifiés
    const auth = req.headers.authorization;
    if (!auth || !etat.jetonsValides.has(auth)) return ko(999, 'You need to log in again.');
    if (etat.forcerExpiration) {
      etat.forcerExpiration = false;
      etat.jetonsValides.delete(auth);
      return ko(998, 'The token has expired, please log in again');
    }

    if (chemin === '/openApi/plants/list') {
      return ok({
        dataList: [
          { plantId: PLANT_A, plantName: 'Station Niamey Centre', timeZone: 'UTC+01:00', plantAddress: 'Niamey', plantAuthority: 1 },
          { plantId: PLANT_B, plantName: 'Station Dosso', timeZone: 'UTC+01:00', plantAddress: 'Dosso', plantAuthority: 1 },
        ],
        pageSize: '300',
      });
    }
    if (chemin === '/openApi/devices/list') {
      return ok({
        dataList: [
          { plantId: PLANT_A, deviceSn: SN_TREX },
          { plantId: PLANT_A, deviceSn: SN_TREX_2 },
          { plantId: PLANT_B, deviceSn: SN_IVEM },
        ],
      });
    }
    let m = chemin.match(/^\/openApi\/data\/deviceDataBasic\/(\w+)$/);
    if (m) {
      const modeles = { [SN_TREX]: 'T-REX-10KLP3G01', [SN_TREX_2]: 'T-REX-6KLP1G01', [SN_IVEM]: 'IVEM-AI5048' };
      return ok({ deviceSn: m[1], deviceModel: modeles[m[1]], deviceType: 'INV', ratedPower: 10000, status: 'normal',
        firmwareVersion: '1.2.3' });
    }
    if (chemin === '/openApi/data/devicesDataHistory') {
      const sns = (params.deviceSnList || '').split(',');
      // Seul SN_TREX a une mesure récente ; SN_TREX_2 a une mesure ancienne (hors ligne)
      const liste = [];
      if (sns.includes(SN_TREX)) {
        liste.push({ deviceSn: SN_TREX, deviceDataTime: heureMesure, timeZone: 'UTC+01:00', pvTotalPower: 5200,
          acTtlInpower: -800, meterPower: 3100, acTotalOutActPower: 900, emsPower: 400, emsSoc: 76, devTempMax: 41,
          workMode: 'Normal' });
      }
      if (sns.includes(SN_TREX_2)) {
        liste.push({ deviceSn: SN_TREX_2, deviceDataTime: '2026-01-01 10:00:00', timeZone: 'UTC+01:00', pvTotalPower: 100 });
      }
      return ok({ dataList: liste, total: liste.length });
    }
    if (chemin === '/openApi/data/deviceDataEnergy') {
      const sn = params.deviceSn;
      const mois = (params.dateStr || '').slice(0, 7);
      if (params.timeDimension !== 'month' || !mois) return ok({ records: [] });
      const records = [1, 2, 3].map((j) => ({
        deviceSn: sn, dataTime: `${mois}-0${j}`, generateEnergy: 20 + j, pv1Energy: 10 + j, pv2Energy: 10,
        gridInput: 5, feedOutput: 1, batCharEnergy: 4, bat2ChartEnergy: null, batDisEnergy: 3,
        offGridEnergy: 2, gridTiedEnergy: 18, smartLoadEnergy: 0, genEnergy: 0,
      }));
      return ok({ records, total: records.length, size: 300, current: 1, pages: 1 });
    }
    m = chemin.match(/^\/openApi\/data\/deviceDataWarn\/(\w+)$/);
    if (m) {
      if (m[1] !== SN_TREX) return ok([]);
      return ok([
        { deviceSn: SN_TREX, warringName: 'PV2 Low voltage', warringType: 'W', warnCode: 'W12',
          dataTimeStr: heureEvenement, timeZone: 'UTC+01:00' },
      ]);
    }
    m = chemin.match(/^\/openApi\/cmd\/deviceSetting\/(\w+)$/);
    if (m && req.method === 'GET') {
      return ok(etat.reglages[m[1]] || { deviceSn: m[1] });
    }
    if (chemin === '/openApi/cmd/deviceSetting' && req.method === 'POST') {
      const { deviceSn, content } = JSON.parse(corps || '{}');
      if (!etat.ignorerReglages) {
        etat.reglages[deviceSn] = { ...(etat.reglages[deviceSn] || { deviceSn }), ...content };
      }
      // Identifiant de commande > 2^53, en nombre JSON brut
      return { raw: `{"code":200,"message":"Success","data":{"id":9797479076789696123,"deviceSn":"${deviceSn}"}}` };
    }
    return ko(404, `Route inconnue ${chemin}`);
  }

  const serveur = http.createServer((req, res) => {
    const morceaux = [];
    req.on('data', (c) => morceaux.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const corps = Buffer.concat(morceaux).toString('utf8');
      let reponse;
      try {
        reponse = traiter(req, url, corps);
      } catch (err) {
        reponse = ko(500, err.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(reponse.raw || JSON.stringify(reponse));
    });
  });

  return {
    etat,
    clePublique,
    utilisateur,
    motDePasse,
    demarrer: () => new Promise((r) => serveur.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${serveur.address().port}`))),
    arreter: () => new Promise((r) => serveur.close(r)),
  };
}

module.exports = { creerFauxFsolar, PLANT_A, PLANT_B, SN_TREX, SN_TREX_2, SN_IVEM };
