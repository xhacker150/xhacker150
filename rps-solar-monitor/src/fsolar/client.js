'use strict';

/**
 * Client de l'OpenAPI Felicity Solar (fSolar).
 *
 * Particularités de l'API prises en compte (voir docs/fsolar-openapi/REVIEW.md) :
 *  - le mot de passe est chiffré en RSA PKCS#1 v1.5 avec la clé publique fournie ;
 *  - le jeton est renvoyé sous la forme "Bearer_<jwt>" et doit être envoyé tel quel ;
 *  - les erreurs arrivent en HTTP 200 avec un champ "code" différent de 200
 *    (998 : jeton expiré, 999 : reconnexion nécessaire) ;
 *  - certains identifiants dépassent 2^53 : ils sont conservés en chaînes ;
 *  - la doc place les paramètres des GET dans un corps form-data.
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const JSONbig = require('json-bigint')({ storeAsString: true });

const CODE_SUCCES = 200;
const CODE_JETON_EXPIRE = 998;
const CODE_RECONNEXION = 999;
// Rafraîchit le jeton un peu avant son expiration
const MARGE_EXPIRATION_MS = 5 * 60 * 1000;
const TAILLE_PAGE_MAX = 300;
const LOT_MAX_MESURES = 50;
const PAGES_MAX = 200;

class FsolarError extends Error {
  constructor(message, { code = null, statutHttp = null, chemin = null } = {}) {
    super(message);
    this.name = 'FsolarError';
    this.code = code;
    this.statutHttp = statutHttp;
    this.chemin = chemin;
  }
}

function chiffrerMotDePasse(motDePasse, clePubliqueBase64) {
  const cle = crypto.createPublicKey({
    key: Buffer.from(clePubliqueBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return crypto
    .publicEncrypt({ key: cle, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(motDePasse, 'utf8'))
    .toString('base64');
}

function encoderFormulaire(params) {
  const sp = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(params || {})) {
    if (valeur === undefined || valeur === null) continue;
    sp.append(cle, String(valeur));
  }
  return sp.toString();
}

/** Extrait la liste d'éléments d'une réponse paginée, quelle que soit sa forme. */
function extraireListe(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const cle of ['dataList', 'records', 'list', 'rows']) {
    if (Array.isArray(data[cle])) return data[cle];
  }
  if (data.data && typeof data.data === 'object') return extraireListe(data.data);
  return [];
}

class FsolarClient {
  constructor(options) {
    const {
      baseUrl,
      utilisateur,
      motDePasse,
      clePublique,
      langue = 'en_US',
      modeParametresGet = 'both',
      timeoutMs = 30000,
      maintenant = Date.now,
    } = options;
    this.baseUrl = new URL(baseUrl);
    this.utilisateur = utilisateur;
    this.motDePasse = motDePasse;
    this.clePublique = clePublique;
    this.langue = langue;
    this.modeParametresGet = modeParametresGet;
    this.timeoutMs = timeoutMs;
    this.maintenant = maintenant;

    this.jeton = null;
    this.jetonExpire = 0;
    this.jetonRafraichissement = null;
    this.jetonRafraichissementExpire = 0;
    this._connexionEnCours = null;
  }

  // ── Transport HTTP ────────────────────────────────────────────────────────

  _http(methode, chemin, { query, corps, typeCorps, jeton }) {
    const url = new URL(this.baseUrl.pathname.replace(/\/$/, '') + chemin, this.baseUrl);
    const qs = encoderFormulaire(query);
    if (qs) url.search = qs;

    const entetes = { Accept: 'application/json', Lang: this.langue };
    if (jeton) entetes.Authorization = jeton;
    let charge = null;
    if (corps !== undefined && corps !== null) {
      charge = Buffer.from(corps, 'utf8');
      entetes['Content-Type'] = typeCorps;
      entetes['Content-Length'] = charge.length;
    }

    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method: methode, headers: entetes, timeout: this.timeoutMs }, (res) => {
        const morceaux = [];
        res.on('data', (m) => morceaux.push(m));
        res.on('end', () => resolve({ statut: res.statusCode, texte: Buffer.concat(morceaux).toString('utf8') }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new FsolarError(`Délai dépassé (${this.timeoutMs} ms)`, { chemin })));
      req.on('error', (err) =>
        reject(err instanceof FsolarError ? err : new FsolarError(`Erreur réseau : ${err.message}`, { chemin }))
      );
      if (charge) req.write(charge);
      req.end();
    });
  }

  async _appelBrut(methode, chemin, { params, json, jeton }) {
    const options = { jeton };
    if (methode === 'GET') {
      if (this.modeParametresGet !== 'body') options.query = params;
      if (this.modeParametresGet !== 'query' && params && Object.keys(params).length) {
        options.corps = encoderFormulaire(params);
        options.typeCorps = 'application/x-www-form-urlencoded';
      }
    } else {
      options.query = params;
      options.corps = JSON.stringify(json || {});
      options.typeCorps = 'application/json';
    }

    const { statut, texte } = await this._http(methode, chemin, options);
    let corps;
    try {
      corps = JSONbig.parse(texte);
    } catch {
      throw new FsolarError(`Réponse non JSON (HTTP ${statut})`, { statutHttp: statut, chemin });
    }
    if (statut < 200 || statut >= 300) {
      throw new FsolarError(corps?.message || `HTTP ${statut}`, { statutHttp: statut, code: corps?.code ?? null, chemin });
    }
    // Les codes peuvent arriver en nombre ou en chaîne
    const code = corps?.code === undefined || corps?.code === null ? null : Number(corps.code);
    if (code !== CODE_SUCCES) {
      throw new FsolarError(corps?.message || `Code ${corps?.code}`, { code, statutHttp: statut, chemin });
    }
    return corps.data;
  }

  // ── Authentification ──────────────────────────────────────────────────────

  _memoriserJetons(data) {
    if (!data || !data.token) throw new FsolarError('Réponse de connexion sans jeton');
    const now = this.maintenant();
    this.jeton = data.token;
    this.jetonExpire = Number(data.tokenExpireTime) || now + 60 * 60 * 1000;
    this.jetonRafraichissement = data.refreshToken || null;
    this.jetonRafraichissementExpire = Number(data.refTokenExpireTime) || 0;
  }

  async connexion() {
    if (!this.utilisateur || !this.motDePasse) {
      throw new FsolarError('Identifiants fSolar manquants (FSOLAR_USERNAME / FSOLAR_PASSWORD)');
    }
    const data = await this._appelBrut('POST', '/openApi/sec/login', {
      json: { userName: this.utilisateur, password: chiffrerMotDePasse(this.motDePasse, this.clePublique) },
    });
    this._memoriserJetons(data);
  }

  async _rafraichir() {
    const data = await this._appelBrut('POST', '/openApi/sec/refreshToken', {
      json: { refreshToken: this.jetonRafraichissement },
    });
    this._memoriserJetons(data);
  }

  /** Obtient un jeton valide (rafraîchi ou reconnecté si besoin). Un seul appel à la fois. */
  async _assurerJeton({ forcer = false } = {}) {
    const now = this.maintenant();
    if (!forcer && this.jeton && now < this.jetonExpire - MARGE_EXPIRATION_MS) return this.jeton;
    if (!this._connexionEnCours) {
      this._connexionEnCours = (async () => {
        const rafraichissable =
          this.jetonRafraichissement && now < this.jetonRafraichissementExpire - MARGE_EXPIRATION_MS;
        if (rafraichissable) {
          try {
            await this._rafraichir();
            return;
          } catch (err) {
            if (!(err instanceof FsolarError)) throw err;
            // Rafraîchissement refusé : on se reconnecte
          }
        }
        await this.connexion();
      })().finally(() => {
        this._connexionEnCours = null;
      });
    }
    await this._connexionEnCours;
    return this.jeton;
  }

  /** Appel authentifié, avec une nouvelle tentative si le jeton a expiré côté serveur. */
  async appel(methode, chemin, { params, json } = {}) {
    const jeton = await this._assurerJeton();
    try {
      return await this._appelBrut(methode, chemin, { params, json, jeton });
    } catch (err) {
      if (!(err instanceof FsolarError)) throw err;
      if (err.code === CODE_JETON_EXPIRE) {
        this.jetonExpire = 0;
        await this._assurerJeton({ forcer: true });
      } else if (err.code === CODE_RECONNEXION || err.statutHttp === 401) {
        this.jeton = null;
        this.jetonRafraichissement = null;
        await this._assurerJeton({ forcer: true });
      } else {
        throw err;
      }
      return this._appelBrut(methode, chemin, { params, json, jeton: this.jeton });
    }
  }

  async _toutesLesPages(chemin, params) {
    const resultats = [];
    for (let page = 1; page <= PAGES_MAX; page++) {
      const data = await this.appel('GET', chemin, {
        params: { ...params, pageNum: page, pageSize: TAILLE_PAGE_MAX },
      });
      const liste = extraireListe(data);
      resultats.push(...liste);
      if (liste.length < TAILLE_PAGE_MAX) break;
    }
    return resultats;
  }

  // ── Endpoints ─────────────────────────────────────────────────────────────

  utilisateurCourant() {
    return this.appel('GET', '/openApi/sec/userInfo');
  }

  listerCentrales() {
    return this._toutesLesPages('/openApi/plants/list', {});
  }

  listerOnduleurs({ plantId } = {}) {
    return this._toutesLesPages('/openApi/devices/list', { plantId });
  }

  donneesBase(deviceSn) {
    return this.appel('GET', `/openApi/data/deviceDataBasic/${encodeURIComponent(deviceSn)}`);
  }

  /** Dernière mesure temps réel de chaque onduleur (par lots de 50). */
  async dernieresMesures(deviceSns) {
    const resultats = [];
    for (let i = 0; i < deviceSns.length; i += LOT_MAX_MESURES) {
      const lot = deviceSns.slice(i, i + LOT_MAX_MESURES);
      const data = await this.appel('GET', '/openApi/data/devicesDataHistory', {
        params: { deviceSnList: lot.join(','), queryType: 0 },
      });
      resultats.push(...extraireListe(data));
    }
    return resultats;
  }

  /**
   * Énergie d'un onduleur. dimension : day | month | year | total.
   * dateStr au format "yyyy-MM-dd HH:mm:ss".
   */
  energieOnduleur(deviceSn, dimension, dateStr) {
    return this._toutesLesPages('/openApi/data/deviceDataEnergy', { deviceSn, timeDimension: dimension, dateStr });
  }

  /** Alarmes et défauts ; sans dates, l'API renvoie les 7 derniers jours. */
  async evenements(deviceSn, { debut, fin } = {}) {
    const data = await this.appel('GET', `/openApi/data/deviceDataWarn/${encodeURIComponent(deviceSn)}`, {
      params: { startTime: debut, endTime: fin },
    });
    return extraireListe(data);
  }

  lireReglages(deviceSn) {
    return this.appel('GET', `/openApi/cmd/deviceSetting/${encodeURIComponent(deviceSn)}`, {
      params: { deviceSn },
    });
  }

  envoyerReglages(deviceSn, contenu) {
    return this.appel('POST', '/openApi/cmd/deviceSetting', { json: { deviceSn, content: contenu } });
  }
}

module.exports = { FsolarClient, FsolarError, chiffrerMotDePasse, extraireListe, CODE_JETON_EXPIRE, CODE_RECONNEXION };
