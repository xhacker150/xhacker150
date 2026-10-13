'use strict';

/* global Chart */

(function () {
  const contenu = document.getElementById('contenu');
  const etat = { utilisateur: null, graphique: null, minuteur: null, description: null };

  // ── Utilitaires DOM ──────────────────────────────────────────────────────

  /** Crée un élément ; les enfants texte passent par textContent (pas d'injection HTML). */
  function h(tag, attrs, ...enfants) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const e of enfants.flat()) {
      if (e === null || e === undefined || e === false) continue;
      el.append(e instanceof Node ? e : document.createTextNode(String(e)));
    }
    return el;
  }

  function vider(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function afficher(...noeuds) {
    if (etat.graphique) {
      etat.graphique.destroy();
      etat.graphique = null;
    }
    vider(contenu);
    contenu.append(...noeuds);
  }

  let minuteurNotif = null;
  function notifier(message) {
    const n = document.getElementById('notification');
    n.textContent = message;
    n.hidden = false;
    clearTimeout(minuteurNotif);
    minuteurNotif = setTimeout(() => { n.hidden = true; }, 5000);
  }

  // ── Formats ──────────────────────────────────────────────────────────────

  const fr = (dec) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const f0 = fr(0);
  const f1 = fr(1);
  const f2 = fr(2);

  function kw(w) {
    return w === null || w === undefined ? '—' : `${f1.format(w / 1000)} kW`;
  }
  function kwh(v, dec = 1) {
    return v === null || v === undefined ? '—' : `${(dec === 2 ? f2 : f1).format(v)} kWh`;
  }
  function pct(v) {
    return v === null || v === undefined ? '—' : `${f0.format(v)} %`;
  }
  function nb(v, dec = 1) {
    return v === null || v === undefined ? '' : (dec === 2 ? f2 : dec === 0 ? f0 : f1).format(v);
  }
  function dateHeure(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function depuis(iso) {
    if (!iso) return 'jamais';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const heures = Math.round(min / 60);
    if (heures < 48) return `il y a ${heures} h`;
    return `il y a ${Math.round(heures / 24)} j`;
  }
  /** Réseau : positif = import, négatif = injection. */
  function reseau(w) {
    if (w === null || w === undefined) return '—';
    if (Math.abs(w) < 1) return '0 kW';
    return w > 0 ? `${kw(w)} (import)` : `${kw(-w)} (export)`;
  }
  function isoJour(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }

  const LIBELLES_ETAT = {
    normal: 'Normal', alarme: 'Alarme', defaut: 'Défaut', hors_ligne: 'Hors ligne', vide: 'Aucun onduleur',
  };
  function badgeEtat(e) {
    return h('span', { class: `etat etat-${e}` }, LIBELLES_ETAT[e] || e);
  }
  const LIBELLES_COMMANDE = {
    en_attente: 'En attente', envoyee: 'Envoyée — vérification…', verifiee: 'Appliquée (vérifiée)',
    ecart: 'Écart après relecture', echec: 'Échec', non_verifiee: 'Non vérifiée',
  };

  // ── API ──────────────────────────────────────────────────────────────────

  class ErreurApi extends Error {
    constructor(message, statut, details) {
      super(message);
      this.statut = statut;
      this.details = details;
    }
  }

  async function api(chemin, { methode = 'GET', corps } = {}) {
    const options = { method: methode, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (corps !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(corps);
    }
    const res = await fetch(`api${chemin}`, options);
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* réponse vide */
    }
    if (res.status === 401 && !chemin.startsWith('/auth/')) {
      etat.utilisateur = null;
      majSession();
      vueConnexion();
      throw new ErreurApi('Session expirée.', 401);
    }
    if (!res.ok || !json || json.success === false) {
      throw new ErreurApi((json && json.error) || `Erreur ${res.status}`, res.status, json && json.details);
    }
    return json.data;
  }

  function blocErreur(err) {
    return h('div', { class: 'panneau erreurs', role: 'alert' },
      h('strong', {}, err.message || String(err)),
      err.details && err.details.length ? h('ul', {}, err.details.map((d) => h('li', {}, d))) : null);
  }

  const peutPiloter = () => etat.utilisateur && ['operateur', 'admin'].includes(etat.utilisateur.role);

  // ── Session ──────────────────────────────────────────────────────────────

  function majSession() {
    const connecte = !!etat.utilisateur;
    document.getElementById('nav').hidden = !connecte;
    document.getElementById('session').hidden = !connecte;
    if (connecte) {
      document.getElementById('session-nom').textContent =
        `${etat.utilisateur.nom || etat.utilisateur.identifiant} · ${etat.utilisateur.role}`;
      for (const a of document.querySelectorAll('#nav [data-role]')) {
        a.hidden = a.dataset.role !== etat.utilisateur.role;
      }
    }
  }

  function vueConnexion() {
    arreterRafraichissement();
    const erreur = h('p', { class: 'erreurs', role: 'alert', hidden: true });
    const form = h('form', { class: 'panneau' },
      h('h1', {}, 'Connexion'),
      h('p', { class: 'attenue' }, 'Suivi des systèmes solaires des stations RPS'),
      h('div', {}, h('label', { for: 'identifiant' }, 'Identifiant'),
        h('input', { id: 'identifiant', name: 'identifiant', autocomplete: 'username', required: true })),
      h('div', {}, h('label', { for: 'mdp' }, 'Mot de passe'),
        h('input', { id: 'mdp', name: 'mdp', type: 'password', autocomplete: 'current-password', required: true })),
      erreur,
      h('button', { class: 'principal', type: 'submit' }, 'Se connecter'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.hidden = true;
      try {
        etat.utilisateur = await api('/auth/connexion', {
          methode: 'POST',
          corps: { identifiant: form.identifiant.value.trim(), motDePasse: form.mdp.value },
        });
        majSession();
        router();
      } catch (err) {
        erreur.textContent = err.message;
        erreur.hidden = false;
      }
    });
    afficher(h('div', { class: 'connexion' }, form));
    form.identifiant.focus();
  }

  document.getElementById('deconnexion').addEventListener('click', async () => {
    try {
      await api('/auth/deconnexion', { methode: 'POST', corps: {} });
    } finally {
      etat.utilisateur = null;
      majSession();
      vueConnexion();
    }
  });

  // ── Rafraîchissement automatique ─────────────────────────────────────────

  function rafraichirToutesLes(sec, fn) {
    arreterRafraichissement();
    etat.minuteur = setInterval(() => {
      if (!document.hidden) fn().catch(() => {});
    }, sec * 1000);
  }
  function arreterRafraichissement() {
    clearInterval(etat.minuteur);
    etat.minuteur = null;
  }

  // ── Vue : aperçu ─────────────────────────────────────────────────────────

  function indicateur(libelle, valeur, unite) {
    return h('div', { class: 'indicateur' },
      h('div', { class: 'libelle' }, libelle),
      h('div', { class: 'valeur' }, valeur, unite ? h('span', { class: 'unite' }, unite) : null));
  }

  function carteStation(s) {
    const r = s.resume || {};
    const lien = s.id ? `#/station/${s.id}` : null;
    const corps = [
      h('div', { class: 'titre' },
        h('div', {}, h('div', { class: 'nom' }, s.nom), h('div', { class: 'attenue petit' }, [s.code, s.ville].filter(Boolean).join(' · '))),
        badgeEtat(s.etat)),
      h('dl', { class: 'mesures' },
        h('dt', {}, 'Solaire'), h('dd', {}, kw(r.pvW)),
        h('dt', {}, 'Consommation'), h('dd', {}, kw(r.chargeW)),
        h('dt', {}, 'Réseau'), h('dd', {}, reseau(r.reseauW)),
        h('dt', {}, 'Batterie'), h('dd', {}, pct(r.socMoyen)),
        h('dt', {}, "Production aujourd'hui"), h('dd', {}, kwh(r.productionJourKwh)),
        h('dt', {}, 'Onduleurs en ligne'), h('dd', {}, `${r.nbEnLigne ?? 0} / ${r.nbOnduleurs ?? 0}`)),
    ];
    if (r.defauts24h || r.alarmes24h) {
      corps.push(h('p', { class: 'petit attenue' }, `24 h : ${r.defauts24h || 0} défaut(s), ${r.alarmes24h || 0} alarme(s)`));
    }
    return lien
      ? h('a', { class: `carte-station etat-${s.etat}`, href: lien }, corps)
      : h('div', { class: `carte-station etat-${s.etat}` }, corps);
  }

  function panneauCollecte(collecte) {
    const noms = {
      inventaire: 'Inventaire', mesures: 'Mesures temps réel', energie: 'Énergie journalière',
      evenements: 'Alarmes', verification_commandes: 'Vérification des commandes',
    };
    return h('details', { class: 'panneau' },
      h('summary', {}, 'État de la collecte fSolar'),
      h('div', { class: 'defilement' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Tâche'), h('th', {}, 'Dernier passage'), h('th', {}, 'Résultat'))),
        h('tbody', {}, collecte.length ? collecte.map((c) => h('tr', {},
          h('td', {}, noms[c.tache] || c.tache),
          h('td', {}, `${dateHeure(c.debut)} (${depuis(c.debut)})`),
          h('td', {}, c.succes ? `OK — ${c.nb_elements ?? 0} élément(s)` : h('span', { class: 'erreurs' }, c.erreur || 'Échec'))))
          : h('tr', {}, h('td', { colspan: 3, class: 'attenue' }, 'Aucune collecte pour le moment.'))))));
  }

  async function vueApercu() {
    const charger = async () => {
      const d = await api('/apercu');
      const avecOnduleurs = d.stations.filter((s) => s.resume && s.resume.nbOnduleurs);
      const somme = (champ) => avecOnduleurs.reduce((t, s) => (s.resume[champ] == null ? t : (t ?? 0) + s.resume[champ]), null);
      const total = avecOnduleurs.reduce((t, s) => t + s.resume.nbOnduleurs, 0);
      const enLigne = avecOnduleurs.reduce((t, s) => t + s.resume.nbEnLigne, 0);
      const defauts = d.stations.filter((s) => s.etat === 'defaut').length;
      const pv = somme('pvW');
      const prod = somme('productionJourKwh');

      afficher(
        h('div', { class: 'entete-page' },
          h('div', {}, h('h1', {}, 'Aperçu des stations'),
            h('div', { class: 'attenue petit' }, `Mis à jour ${dateHeure(new Date().toISOString())} · actualisation automatique`))),
        h('div', { class: 'indicateurs' },
          indicateur('Puissance solaire actuelle', pv == null ? '—' : f1.format(pv / 1000), pv == null ? null : 'kW'),
          indicateur("Production aujourd'hui", prod == null ? '—' : f0.format(prod), prod == null ? null : 'kWh'),
          indicateur('Onduleurs en ligne', `${enLigne} / ${total}`),
          indicateur('Stations en défaut', String(defauts))),
        d.stations.length
          ? h('div', { class: 'grille-stations' }, d.stations.map(carteStation))
          : h('div', { class: 'panneau' }, h('p', {}, 'Aucune station ni centrale pour le moment.'),
            h('p', { class: 'attenue' }, "La collecte fSolar remplit la liste des centrales ; un administrateur les rattache ensuite aux stations RPS (menu Administration).")),
        panneauCollecte(d.collecte));
    };
    await charger();
    rafraichirToutesLes(60, charger);
  }

  // ── Vue : station ────────────────────────────────────────────────────────

  function couleur(nom) {
    return getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
  }

  function graphiqueHistorique(canvas, historique) {
    const encre2 = couleur('--encre-2');
    const grille = couleur('--grille');
    etat.graphique = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: historique.map((j) => j.jour.slice(8, 10) + '/' + j.jour.slice(5, 7)),
        datasets: [
          { label: 'Production solaire', data: historique.map((j) => j.productionKwh), backgroundColor: couleur('--serie-1'),
            borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 18 },
          { label: 'Import réseau', data: historique.map((j) => j.reseauImportKwh), backgroundColor: couleur('--serie-2'),
            borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 18 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        datasets: { bar: { categoryPercentage: 0.8, barPercentage: 0.9 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label} : ${c.raw == null ? '—' : f1.format(c.raw)} kWh` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: encre2, maxRotation: 0, autoSkipPadding: 8 }, border: { color: couleur('--axe') } },
          y: { beginAtZero: true, grid: { color: grille }, border: { display: false },
            ticks: { color: encre2, callback: (v) => f0.format(v) },
            title: { display: true, text: 'kWh', color: encre2 } },
        },
      },
    });
  }

  function tableOnduleurs(onduleurs) {
    return h('div', { class: 'defilement' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Onduleur'), h('th', {}, 'État'), h('th', {}, 'Dernière mesure'),
        h('th', { class: 'n' }, 'Solaire'), h('th', { class: 'n' }, 'Conso.'), h('th', { class: 'n' }, 'Réseau'),
        h('th', { class: 'n' }, 'Batterie'), h('th', { class: 'n' }, 'SOC'), h('th', { class: 'n' }, 'Prod. jour'),
        peutPiloter() ? h('th', {}, '') : null)),
      h('tbody', {}, onduleurs.map((o) => h('tr', {},
        h('td', {}, h('div', { class: 'mono' }, o.deviceSn), h('div', { class: 'attenue petit' }, o.modele || 'Modèle inconnu')),
        h('td', {}, badgeEtat(o.etat), o.defauts24h || o.alarmes24h
          ? h('div', { class: 'attenue petit' }, `${o.defauts24h} déf. · ${o.alarmes24h} al. (24 h)`) : null),
        h('td', {}, o.derniereMesure ? depuis(o.derniereMesure) : '—'),
        h('td', { class: 'n' }, kw(o.pvW)),
        h('td', { class: 'n' }, kw(o.chargeW == null && o.secoursW == null ? null : (o.chargeW || 0) + (o.secoursW || 0))),
        h('td', { class: 'n' }, reseau(o.reseauW)),
        h('td', { class: 'n' }, kw(o.batterieW)),
        h('td', { class: 'n' }, pct(o.soc)),
        h('td', { class: 'n' }, kwh(o.productionJourKwh)),
        peutPiloter() ? h('td', {}, h('a', { href: `#/onduleur/${encodeURIComponent(o.deviceSn)}` }, 'Réglages')) : null)))));
  }

  async function vueStation(id) {
    const charger = async () => {
      const s = await api(`/stations/${encodeURIComponent(id)}`);
      const r = s.resume || {};
      const canvas = h('canvas', { role: 'img', 'aria-label': 'Production solaire et import réseau des 30 derniers jours, en kWh' });
      const tableHisto = h('details', {},
        h('summary', {}, 'Voir les valeurs'),
        h('div', { class: 'defilement' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Jour'), h('th', { class: 'n' }, 'Production'),
            h('th', { class: 'n' }, 'Consommation'), h('th', { class: 'n' }, 'Import réseau'), h('th', { class: 'n' }, 'Groupe'))),
          h('tbody', {}, s.historique.map((j) => h('tr', {}, h('td', {}, j.jour),
            h('td', { class: 'n' }, kwh(j.productionKwh)), h('td', { class: 'n' }, kwh(j.consommationKwh)),
            h('td', { class: 'n' }, kwh(j.reseauImportKwh)), h('td', { class: 'n' }, kwh(j.groupeKwh))))))));

      afficher(
        h('p', {}, h('a', { href: '#/' }, '← Toutes les stations')),
        h('div', { class: 'entete-page' },
          h('div', {}, h('h1', {}, s.nom), h('div', { class: 'attenue' }, [s.code, s.ville].filter(Boolean).join(' · '))),
          badgeEtat(s.etat)),
        h('div', { class: 'indicateurs' },
          indicateur('Solaire', r.pvW == null ? '—' : f1.format(r.pvW / 1000), r.pvW == null ? null : 'kW'),
          indicateur('Consommation', r.chargeW == null ? '—' : f1.format(r.chargeW / 1000), r.chargeW == null ? null : 'kW'),
          indicateur('Réseau', reseau(r.reseauW)),
          indicateur('Batterie (SOC moyen)', r.socMoyen == null ? '—' : f0.format(r.socMoyen), r.socMoyen == null ? null : '%'),
          indicateur("Production aujourd'hui", r.productionJourKwh == null ? '—' : f1.format(r.productionJourKwh), r.productionJourKwh == null ? null : 'kWh')),
        h('section', { class: 'panneau' }, h('h2', {}, 'Onduleurs'),
          s.onduleurs.length ? tableOnduleurs(s.onduleurs) : h('p', { class: 'attenue' }, 'Aucun onduleur rattaché à cette station.')),
        h('section', { class: 'panneau' }, h('h2', {}, '30 derniers jours'),
          s.historique.length
            ? [h('div', { class: 'legende' }, h('span', { class: 's1' }, 'Production solaire'), h('span', { class: 's2' }, 'Import réseau')),
              h('div', { class: 'graphique' }, canvas), tableHisto]
            : h('p', { class: 'attenue' }, "Pas encore de données d'énergie.")),
        h('section', { class: 'panneau' }, h('h2', {}, 'Alarmes et défauts récents'),
          s.evenements.length
            ? h('div', { class: 'defilement' }, h('table', {},
              h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Onduleur'), h('th', {}, 'Type'), h('th', {}, 'Code'), h('th', {}, 'Description'))),
              h('tbody', {}, s.evenements.map((e) => h('tr', {},
                h('td', {}, e.horodatage_texte), h('td', { class: 'mono' }, e.device_sn),
                h('td', {}, e.type_evenement === 'F' ? badgeEtat('defaut') : badgeEtat('alarme')),
                h('td', { class: 'mono' }, e.code), h('td', {}, e.nom || ''))))))
            : h('p', { class: 'attenue' }, 'Aucun événement enregistré.')));
      if (s.historique.length) graphiqueHistorique(canvas, s.historique);
    };
    await charger();
    rafraichirToutesLes(60, charger);
  }

  // ── Vue : rapports ───────────────────────────────────────────────────────

  async function vueRapports() {
    arreterRafraichissement();
    const stations = await api('/stations');
    const aujourdhui = new Date();
    const debutMois = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 1);
    const form = h('form', { class: 'panneau' },
      h('div', { class: 'formulaire-ligne' },
        h('div', {}, h('label', { for: 'debut' }, 'Du'), h('input', { id: 'debut', name: 'debut', type: 'date', value: isoJour(debutMois), required: true })),
        h('div', {}, h('label', { for: 'fin' }, 'Au'), h('input', { id: 'fin', name: 'fin', type: 'date', value: isoJour(aujourdhui), required: true })),
        h('div', {}, h('label', { for: 'grouper' }, 'Détail par'),
          h('select', { id: 'grouper', name: 'grouper' }, h('option', { value: 'jour' }, 'Jour'), h('option', { value: 'mois' }, 'Mois'))),
        h('div', {}, h('label', { for: 'station' }, 'Station'),
          h('select', { id: 'station', name: 'station' }, h('option', { value: '' }, 'Toutes'),
            stations.map((s) => h('option', { value: String(s.id) }, s.nom)))),
        h('div', { class: 'actions' }, h('button', { class: 'principal', type: 'submit' }, 'Afficher'))));
    const resultat = h('div', {});

    const params = () => new URLSearchParams({
      debut: form.debut.value, fin: form.fin.value, grouper: form.grouper.value, station: form.station.value,
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      vider(resultat);
      resultat.append(h('p', { class: 'chargement' }, 'Calcul…'));
      try {
        const d = await api(`/rapports/production?${params()}`);
        vider(resultat);
        const csv = h('a', { class: 'bouton', href: `api/rapports/production?${params()}&format=csv` }, 'Télécharger (CSV)');
        const colonnes = [
          ['productionKwh', 'Production'], ['consommationKwh', 'Consommation'], ['reseauImportKwh', 'Import réseau'],
          ['reseauExportKwh', 'Export réseau'], ['groupeKwh', 'Groupe'], ['autonomiePct', 'Autonomie'],
        ];
        const cellule = (l, c) => h('td', { class: 'n' }, c === 'autonomiePct' ? pct(l[c]) : kwh(l[c]));
        resultat.append(
          h('section', { class: 'panneau' },
            h('div', { class: 'entete-page' }, h('h2', {}, `Totaux du ${d.debut} au ${d.fin}`), csv),
            d.totaux.length ? h('div', { class: 'defilement' }, h('table', {},
              h('thead', {}, h('tr', {}, h('th', {}, 'Station'), colonnes.map(([, lib]) => h('th', { class: 'n' }, lib)))),
              h('tbody', {}, d.totaux.map((t) => h('tr', {}, h('td', {}, t.stationNom), colonnes.map(([c]) => cellule(t, c)))))))
              : h('p', { class: 'attenue' }, 'Aucune donnée sur cette période.'),
            h('p', { class: 'attenue petit' }, "Autonomie : part de la consommation qui n'a pas été prise au réseau (solaire, batterie, groupe).")),
          d.lignes.length ? h('section', { class: 'panneau' }, h('h2', {}, `Détail par ${d.grouper}`),
            h('div', { class: 'defilement' }, h('table', {},
              h('thead', {}, h('tr', {}, h('th', {}, 'Station'), h('th', {}, 'Période'), colonnes.map(([, lib]) => h('th', { class: 'n' }, lib)))),
              h('tbody', {}, d.lignes.map((l) => h('tr', {}, h('td', {}, l.stationNom), h('td', {}, l.periode),
                colonnes.map(([c]) => cellule(l, c)))))))) : null);
      } catch (err) {
        vider(resultat);
        resultat.append(blocErreur(err));
      }
    });

    afficher(h('h1', {}, 'Rapports de production'), h('p', { class: 'attenue' }, 'Énergie par station, en kWh.'), form, resultat);
    form.requestSubmit();
  }

  // ── Vue : réglages d'un onduleur ─────────────────────────────────────────

  function champSaisie(id, def, valeurActuelle) {
    let input;
    if (def.type === 'choix') {
      input = h('select', { id, name: id },
        h('option', { value: '' }, '— ne pas modifier —'),
        Object.entries(def.choix).map(([v, lib]) => h('option', { value: v }, `${lib} (${v})`)));
    } else if (def.type === 'heure') {
      input = h('input', { id, name: id, type: 'time', step: 60 });
    } else if (def.type === 'jour') {
      input = h('input', { id, name: id, placeholder: 'MM:JJ', pattern: '\\d{2}:\\d{2}', inputmode: 'numeric' });
    } else {
      input = h('input', { id, name: id, type: 'number', min: def.min, max: def.max, step: def.type === 'decimal' ? '0.1' : '1' });
    }
    const actuel = valeurActuelle === undefined || valeurActuelle === null
      ? 'Valeur actuelle inconnue'
      : `Actuel : ${def.type === 'choix' ? (def.choix[valeurActuelle] ?? valeurActuelle) : valeurActuelle}${def.unite ? ' ' + def.unite : ''}`;
    return h('div', {},
      h('label', { for: id }, def.libelle, def.min !== undefined ? ` (${def.min}–${def.max}${def.unite ? ' ' + def.unite : ''})` : ''),
      input, h('div', { class: 'valeur-actuelle' }, actuel));
  }

  function lireValeur(def, brut) {
    if (brut === '' || brut === null || brut === undefined) return undefined;
    if (def.type === 'choix' || def.type === 'entier' || def.type === 'decimal') return Number(brut);
    return brut;
  }

  async function vueReglages(sn) {
    arreterRafraichissement();
    if (!peutPiloter()) {
      afficher(blocErreur(new Error('Réservé aux opérateurs et administrateurs.')));
      return;
    }
    afficher(h('p', { class: 'chargement' }, "Lecture des réglages sur l'onduleur…"));
    etat.description = etat.description || (await api('/reglages/description'));
    const desc = etat.description;
    let lecture;
    try {
      lecture = await api(`/onduleurs/${encodeURIComponent(sn)}/reglages`);
    } catch (err) {
      afficher(h('p', {}, h('a', { href: '#/' }, '← Retour')), blocErreur(err));
      return;
    }
    const retour = h('p', {}, h('button', { type: 'button', class: 'bouton-lien', onclick: () => history.back() }, '← Retour'));
    if (!lecture.prisEnCharge) {
      afficher(retour, h('h1', {}, 'Réglages'), h('div', { class: 'panneau' },
        h('p', {}, `L'onduleur ${sn} (modèle ${lecture.modele || 'inconnu'}) n'est pas pris en charge pour le pilotage.`),
        h('p', { class: 'attenue' }, 'Seule la gamme T-REX est autorisée pour le moment.')));
      return;
    }
    const v = lecture.valeurs || {};

    const fsGeneral = h('fieldset', {}, h('legend', {}, 'Fonctionnement et batterie'),
      h('div', { class: 'champs' }, Object.entries(desc.champs).map(([cle, def]) => champSaisie(cle, def, v[cle]))));

    const fsRegles = desc.reglesEco.map((regle, i) => {
      const actuel = v[regle] || {};
      const jours = h('div', { class: 'jours' }, desc.jours.map((j) => h('label', {},
        h('input', { type: 'checkbox', name: `${regle}.daysOfEffectiveWeek`, value: j }),
        ({ MONDAY: 'Lun', TUESDAY: 'Mar', WEDNESDAY: 'Mer', THURSDAY: 'Jeu', FRIDAY: 'Ven', SATURDAY: 'Sam', SUNDAY: 'Dim' })[j])));
      const champs = Object.entries(desc.champsRegleEco)
        .filter(([c]) => c !== 'daysOfEffectiveWeek')
        .map(([c, def]) => champSaisie(`${regle}.${c}`, def, actuel[c]));
      return h('details', {}, h('summary', {}, `Règle ECO ${i + 1}`),
        h('fieldset', {}, h('legend', {}, `Règle ECO ${i + 1} — laissez « ne pas modifier » pour ne pas l'envoyer`),
          h('div', { class: 'champs' }, champs),
          h('label', {}, 'Jours actifs'), jours,
          h('div', { class: 'valeur-actuelle' }, `Actuel : ${Array.isArray(actuel.daysOfEffectiveWeek) ? actuel.daysOfEffectiveWeek.join(', ') : 'inconnu'}`)));
    });

    const zoneErreur = h('div', {});
    const form = h('form', { class: 'panneau', novalidate: true },
      fsGeneral, h('h3', {}, 'Mode ECO (créneaux de charge/décharge)'), fsRegles,
      h('div', { class: 'champ-motif' }, h('label', { for: 'motif' }, 'Motif de la modification (obligatoire, conservé dans le journal)'),
        h('textarea', { id: 'motif', name: 'motif', required: true, minlength: 5 })),
      zoneErreur,
      h('p', {}, h('button', { class: 'principal', type: 'submit' }, 'Envoyer à l’onduleur')));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      vider(zoneErreur);
      const reglages = {};
      for (const [cle, def] of Object.entries(desc.champs)) {
        const val = lireValeur(def, form.elements[cle].value);
        if (val !== undefined) reglages[cle] = val;
      }
      for (const regle of desc.reglesEco) {
        const mode = form.elements[`${regle}.ruleMode`].value;
        if (mode === '') continue; // règle non modifiée
        const r = {};
        for (const [c, def] of Object.entries(desc.champsRegleEco)) {
          if (c === 'daysOfEffectiveWeek') continue;
          const val = lireValeur(def, form.elements[`${regle}.${c}`].value);
          if (val !== undefined) r[c] = val;
        }
        const jours = [...form.querySelectorAll(`input[name="${regle}.daysOfEffectiveWeek"]:checked`)].map((x) => x.value);
        if (jours.length) r.daysOfEffectiveWeek = jours;
        reglages[regle] = r;
      }
      if (!Object.keys(reglages).length) {
        zoneErreur.append(blocErreur(new Error('Aucun réglage modifié.')));
        return;
      }
      const resume = Object.entries(reglages).map(([c, val]) => `• ${c} = ${JSON.stringify(val)}`).join('\n');
      if (!window.confirm(`Envoyer ces réglages à l'onduleur ${sn} ?\n\n${resume}`)) return;
      const bouton = form.querySelector('button[type="submit"]');
      bouton.disabled = true;
      try {
        const cmd = await api(`/onduleurs/${encodeURIComponent(sn)}/reglages`, {
          methode: 'POST', corps: { reglages, motif: form.motif.value },
        });
        notifier(`Commande n°${cmd.id} envoyée. La relecture de vérification aura lieu dans quelques minutes.`);
        location.hash = '#/commandes';
      } catch (err) {
        zoneErreur.append(blocErreur(err));
      } finally {
        bouton.disabled = false;
      }
    });

    afficher(retour,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Réglages de l’onduleur'),
        h('div', { class: 'attenue' }, h('span', { class: 'mono' }, sn), ` · ${lecture.modele}`))),
      h('div', { class: 'avertissement' },
        h('strong', {}, 'Attention : '),
        'ces réglages s’appliquent immédiatement au matériel. Seuls les champs remplis sont envoyés. ',
        'Chaque commande est journalisée puis vérifiée par relecture sur l’onduleur.'),
      form);
  }

  // ── Vue : journal des commandes ──────────────────────────────────────────

  async function vueCommandes() {
    const charger = async () => {
      const cmds = await api('/commandes?limite=200');
      afficher(h('h1', {}, 'Journal des commandes de réglage'),
        h('p', { class: 'attenue' }, 'Chaque commande est relue sur l’onduleur pour vérifier qu’elle a été appliquée.'),
        h('section', { class: 'panneau' }, cmds.length ? h('div', { class: 'defilement' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'N°'), h('th', {}, 'Date'), h('th', {}, 'Station / onduleur'),
            h('th', {}, 'Par'), h('th', {}, 'Réglages'), h('th', {}, 'Statut'), h('th', {}, 'Motif'))),
          h('tbody', {}, cmds.map((c) => h('tr', {},
            h('td', { class: 'n' }, String(c.id)),
            h('td', {}, dateHeure(c.cree_le)),
            h('td', {}, h('div', {}, c.station_nom || '—'), h('div', { class: 'mono attenue' }, c.device_sn)),
            h('td', {}, c.utilisateur),
            h('td', {}, h('code', {}, JSON.stringify(c.contenu))),
            h('td', {}, h('span', { class: `statut-commande statut-${c.statut}` }, LIBELLES_COMMANDE[c.statut] || c.statut),
              c.erreur ? h('div', { class: 'erreurs petit' }, c.erreur) : null),
            h('td', {}, c.motif || '')))))) : h('p', { class: 'attenue' }, 'Aucune commande envoyée.')));
    };
    await charger();
    rafraichirToutesLes(30, charger);
  }

  // ── Vue : administration ─────────────────────────────────────────────────

  async function vueAdmin() {
    arreterRafraichissement();
    if (!etat.utilisateur || etat.utilisateur.role !== 'admin') {
      afficher(blocErreur(new Error('Réservé aux administrateurs.')));
      return;
    }
    const [stations, centrales] = await Promise.all([api('/stations'), api('/centrales')]);

    const formStation = h('form', { class: 'formulaire-ligne' },
      h('div', {}, h('label', { for: 'nv-code' }, 'Code'), h('input', { id: 'nv-code', name: 'code', maxlength: 20, required: true })),
      h('div', {}, h('label', { for: 'nv-nom' }, 'Nom'), h('input', { id: 'nv-nom', name: 'nom', required: true })),
      h('div', {}, h('label', { for: 'nv-ville' }, 'Ville'), h('input', { id: 'nv-ville', name: 'ville' })),
      h('div', { class: 'actions' }, h('button', { class: 'principal', type: 'submit' }, 'Ajouter')));
    formStation.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('/stations', { methode: 'POST', corps: {
          code: formStation.code.value, nom: formStation.nom.value, ville: formStation.ville.value,
        } });
        notifier('Station ajoutée.');
        vueAdmin();
      } catch (err) {
        notifier(err.message);
      }
    });

    const selectStation = (c) => {
      const sel = h('select', { 'aria-label': `Station de la centrale ${c.nom || c.plant_id}` },
        h('option', { value: '' }, '— non affectée —'),
        stations.map((s) => h('option', { value: String(s.id), selected: s.id === c.station_id }, `${s.nom} (${s.code})`)));
      sel.addEventListener('change', async () => {
        try {
          await api(`/centrales/${encodeURIComponent(c.plant_id)}/station`, {
            methode: 'PUT', corps: { stationId: sel.value === '' ? null : Number(sel.value) },
          });
          notifier('Rattachement enregistré.');
        } catch (err) {
          notifier(err.message);
        }
      });
      return sel;
    };

    afficher(h('h1', {}, 'Administration'),
      h('section', { class: 'panneau' }, h('h2', {}, 'Centrales fSolar → stations RPS'),
        h('p', { class: 'attenue' }, 'Rattachez chaque centrale fSolar à sa station. La liste des centrales est mise à jour par la collecte.'),
        centrales.length ? h('div', { class: 'defilement' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Centrale'), h('th', {}, 'Adresse'), h('th', { class: 'n' }, 'Onduleurs'), h('th', {}, 'Station RPS'))),
          h('tbody', {}, centrales.map((c) => h('tr', {},
            h('td', {}, h('div', {}, c.nom || '—'), h('div', { class: 'mono attenue' }, c.plant_id)),
            h('td', {}, c.adresse || ''), h('td', { class: 'n' }, String(c.nb_onduleurs)),
            h('td', {}, selectStation(c)))))))
          : h('p', { class: 'attenue' }, 'Aucune centrale collectée pour le moment.')),
      h('section', { class: 'panneau' }, h('h2', {}, 'Stations'), formStation,
        h('div', { class: 'defilement' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Nom'), h('th', {}, 'Ville'), h('th', {}, 'Active'))),
          h('tbody', {}, stations.map((s) => h('tr', {}, h('td', { class: 'mono' }, s.code), h('td', {}, s.nom),
            h('td', {}, s.ville || ''), h('td', {}, s.actif ? 'Oui' : 'Non'))))))));
  }

  // ── Routeur ──────────────────────────────────────────────────────────────

  async function router() {
    if (!etat.utilisateur) {
      vueConnexion();
      return;
    }
    const chemin = location.hash.replace(/^#/, '') || '/';
    const parties = chemin.split('/').filter(Boolean);
    const route = parties[0] || 'apercu';
    for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('actif', a.dataset.route === route);
    try {
      if (route === 'station' && parties[1]) await vueStation(parties[1]);
      else if (route === 'onduleur' && parties[1]) await vueReglages(decodeURIComponent(parties[1]));
      else if (route === 'rapports') await vueRapports();
      else if (route === 'commandes') await vueCommandes();
      else if (route === 'admin') await vueAdmin();
      else await vueApercu();
      contenu.focus({ preventScroll: true });
    } catch (err) {
      if (err.statut !== 401) afficher(blocErreur(err));
    }
  }

  window.addEventListener('hashchange', router);
  // Les couleurs du graphique suivent le thème du système
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (etat.graphique) router();
  });

  (async () => {
    try {
      etat.utilisateur = await api('/auth/moi');
    } catch {
      etat.utilisateur = null;
    }
    majSession();
    router();
  })();
})();
