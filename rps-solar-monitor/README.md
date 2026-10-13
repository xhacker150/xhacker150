# RPS Solaire — suivi des systèmes solaires des stations

Application web qui suit les onduleurs **Felicity Solar** installés dans les stations RPS. Elle passe par l'API fSolar (OpenAPI) et offre :

- **Tableau de bord** : l'état de chaque station en temps réel. On y voit la puissance solaire, la consommation, l'import ou l'export réseau, la batterie (SOC), les onduleurs hors ligne et les alarmes ou défauts.
- **Rapports de production** : l'énergie par station et par jour ou par mois (production, consommation, réseau, batterie, groupe), avec un taux d'autonomie et un export CSV pour Excel.
- **Pilotage limité** : quelques réglages d'onduleur modifiables à distance, avec motif obligatoire, journal et vérification par relecture.

## Architecture

```
┌──────────────┐   toutes les 5–60 min    ┌──────────────────────────┐
│  API fSolar  │ ◄─────────────────────── │  Collecteur (Node.js)    │
│ (Felicity)   │ ───── mesures, énergie,  │  inventaire · mesures ·  │
└──────────────┘       alarmes            │  énergie · alarmes ·     │
       ▲                                  │  vérif. des commandes    │
       │ commandes de réglage             └────────────┬─────────────┘
       │ (liste blanche)                               │
┌──────┴───────────────────────────┐          ┌────────▼────────┐
│  API web + tableau de bord       │ ◄──────► │   PostgreSQL    │
│  (Express, même processus)       │          │                 │
└──────────────────────────────────┘          └─────────────────┘
```

Un seul service Node.js (API, tableau de bord et collecte) plus PostgreSQL. Le schéma est appliqué automatiquement au démarrage et peut être rejoué sans risque.

| Dossier | Contenu |
|---|---|
| `src/fsolar/client.js` | Client de l'API fSolar |
| `src/collecteur/` | Synchronisation périodique et conversion des données fSolar |
| `src/routes/` | API web (authentification, stations, rapports, réglages) |
| `src/reglages/listeBlanche.js` | Réglages autorisés et leurs contrôles |
| `public/` | Tableau de bord (HTML/CSS/JS, sans framework ; Chart.js servi localement) |
| `database/schema.sql` | Schéma PostgreSQL |
| `scripts/` | Création d'utilisateurs, import d'historique |
| `test/` | Tests unitaires et de bout en bout (avec un faux serveur fSolar) |

## Installation (Docker)

```sh
cp .env.example .env
# Renseigner au minimum : DB_PASSWORD, JWT_SECRET (openssl rand -hex 32),
# FSOLAR_USERNAME, FSOLAR_PASSWORD
docker compose up -d --build

# Premier administrateur
docker compose exec -e MOT_DE_PASSE='un-mot-de-passe-long' app \
  node scripts/creer-utilisateur.js admin admin "Administrateur RPS"
```

Le tableau de bord est ensuite sur `http://<serveur>:3100`. En production, placez-le derrière un reverse proxy HTTPS (nginx, Traefik…) et mettez `TRUST_PROXY=true`. Le cookie de session n'est envoyé qu'en HTTPS (`COOKIE_SECURE=true`).

### Mise en route

1. **Attendre la première collecte** (quelques secondes) : les centrales et onduleurs du compte fSolar apparaissent dans **Administration**.
2. **Créer les stations RPS** (code, nom, ville) dans **Administration**, puis **rattacher chaque centrale fSolar à sa station**.
3. **Importer l'historique** (facultatif), par exemple sur 12 mois :
   `docker compose exec app node scripts/importer-historique.js 12`
4. **Créer les comptes** :
   `MOT_DE_PASSE='…' node scripts/creer-utilisateur.js <identifiant> <lecteur|operateur|admin> ["Nom"]`

| Rôle | Peut |
|---|---|
| `lecteur` | consulter le tableau de bord, les rapports et le journal des commandes |
| `operateur` | en plus, lire et modifier les réglages autorisés des onduleurs |
| `admin` | en plus, gérer les stations et le rattachement des centrales |

## Réglages à distance

Seuls ces réglages sont modifiables, et uniquement sur les onduleurs **T-REX**. Ce sont les seuls dont la documentation fSolar décrit les champs.

| Réglage | Valeurs |
|---|---|
| Mode de fonctionnement | Général, Secours, ECO |
| SOC mini de décharge (réseau présent) | 10–100 % |
| SOC mini de décharge / de reprise (hors réseau) | 0–100 %, reprise > mini |
| Règles ECO 1 à 4 (créneaux de charge/décharge) | action, puissance ≤ puissance nominale, SOC, tension 48–60 V, heures, dates, jours |
| Buzzer, rétroéclairage | activé / désactivé |

Certaines fonctions restent **volontairement exclues**, même si l'API les permet :
- les protections réseau (anti-îlotage, seuils tension/fréquence, limites d'injection) ;
- la remise à zéro usine ;
- l'arrêt à distance.

Pour chaque commande :
1. le formulaire n'envoie que les champs modifiés ;
2. un motif est obligatoire ;
3. le serveur valide les valeurs, relit les réglages actuels et les conserve dans le journal, puis envoie la commande ;
4. une seule commande à la fois par onduleur ;
5. après `REGLAGES_DELAI_VERIFICATION_SEC`, le collecteur relit l'onduleur. La commande passe alors en **Appliquée (vérifiée)**, ou en **Écart** si les valeurs diffèrent encore après `REGLAGES_DELAI_ABANDON_MIN`.

## Points à confirmer avec Felicity Solar

L'application a été construite à partir de la documentation publique de l'API, qui comporte des contradictions (voir `docs/fsolar-openapi/REVIEW.md`). Je n'ai pas pu la tester contre l'API réelle. Les choix faits sont isolés et réglables :

1. **Paramètres des requêtes GET.** La doc les place dans un corps form-data. Par défaut (`FSOLAR_GET_PARAMS=both`), le client les envoie à la fois dans l'URL et dans le corps. Si fSolar refuse l'un des deux, passez à `query` ou `body`.
2. **Énergie journalière.** La collecte demande `timeDimension=month` et suppose un enregistrement par jour (`dataTime` au format `YYYY-MM-DD`). Les autres enregistrements sont ignorés. À vérifier lors du premier import.
3. **Forme des réponses** des mesures temps réel (`devicesDataHistory`), non documentée. Le client accepte `dataList`, `records`, `list` ou un tableau direct.
4. **Fuseaux horaires.** Les heures fSolar sont lues avec le fuseau indiqué par l'API, sinon `FUSEAU_DEFAUT` (+01:00).
5. **Unité de la puissance nominale.** Une valeur < 1000 est lue en kW, sinon en W. Elle sert à limiter la puissance des règles ECO.
6. **Partie batterie.** Le signe de la puissance batterie (`emsPower`) n'est pas documenté. Il est affiché tel quel.

## Développement et tests

```sh
npm install
npm test                                     # tests unitaires
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres npm test   # + bout en bout
```

Le test de bout en bout crée une base temporaire, puis il :
1. lance un faux serveur fSolar conforme à la doc (RSA, jetons `Bearer_…`, erreurs en HTTP 200, identifiants > 2^53) ;
2. exécute la collecte ;
3. vérifie l'API web (droits, aperçu, rapports JSON/CSV, réglages avec vérification et écart).

## Sécurité

- Les identifiants fSolar et le secret JWT viennent uniquement de l'environnement (`.env`, jamais commité).
- Les mots de passe sont stockés en bcrypt. Après 5 échecs de connexion, l'accès est bloqué 15 minutes par identifiant et par IP.
- La session est un cookie `HttpOnly`, `SameSite=Strict`. Toute écriture exige du JSON (protection CSRF).
- En-têtes de sécurité : CSP stricte (aucun script externe ni inline), `X-Frame-Options: DENY`, `nosniff`.
- Les rôles sont relus en base à chaque requête : un compte désactivé perd l'accès immédiatement.
- La connexion à fSolar chiffre le mot de passe avec la clé RSA-512 imposée par fSolar. Cette clé est faible : la protection réelle est le HTTPS vers `open-api.felicitysolar.com`.
