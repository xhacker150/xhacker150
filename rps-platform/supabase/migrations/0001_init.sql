-- =====================================================================
--  RPS — Plateforme de pilotage réseau stations-service
--  Migration socle : 0001_init.sql
--  Cible : Supabase (PostgreSQL 15+)
--  Esprit : opérationnel réseau (major pétrolier) + rigueur ERP (Sage/Oracle)
--
--  RÈGLE D'OR : les données issues de GESCOM (table `ventes`) ne sont JAMAIS
--  modifiées. Corrections, règlements et commandes vivent dans des tables
--  séparées, horodatées et auditées.
-- =====================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "unaccent";       -- comparaisons sans accents

-- ---------------------------------------------------------------------
--  ENUMS
-- ---------------------------------------------------------------------
create type role_utilisateur   as enum ('direction', 'controle', 'station');
create type statut_station      as enum ('active', 'hors_service');
create type type_vente          as enum ('especes', 'credit');
create type statut_facture      as enum ('brouillon', 'emise', 'partiellement_reglee', 'reglee', 'echue', 'annulee');
create type mode_reglement      as enum ('especes', 'virement', 'mobile_money', 'cheque', 'compensation');
create type statut_commande     as enum ('enregistree', 'validee', 'livree', 'facturee', 'annulee');
create type canal_relance       as enum ('sms', 'email', 'appel', 'courrier');
create type statut_relance      as enum ('planifiee', 'envoyee', 'echec', 'annulee');
create type type_anomalie       as enum (
  'date_hors_periode', 'doublon_piece', 'doublon_contenu', 'piece_renumerotee',
  'compte_tiers_corrige', 'collectif_corrige', 'decimal_normalise',
  'espace_nettoye', 'depot_corrige', 'station_manquante', 'collision_sage', 'autre'
);

-- ---------------------------------------------------------------------
--  AUDIT : colonnes communes + trigger
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

-- ---------------------------------------------------------------------
--  PROFILS (lié à auth.users de Supabase)
-- ---------------------------------------------------------------------
create table profils (
  id          uuid primary key references auth.users(id) on delete cascade,
  nom         text not null,
  role        role_utilisateur not null default 'station',
  station_id  uuid,                      -- périmètre si role = 'station' (FK ajoutée + bas)
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  RÉFÉRENTIEL RÉSEAU
-- ---------------------------------------------------------------------
create table stations (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique,           -- '14', '32'...
  code_site     text not null unique,           -- 'TA-06', 'NY-32'
  nom_officiel  text not null,                  -- 'RPS Madina'
  format_piece  text,                           -- préfixe attendu (ex. 'F14')
  statut        statut_station not null default 'active',
  latitude      double precision,
  longitude     double precision,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_stations_statut on stations(statut);

-- profils.station_id -> stations.id (après création de stations)
alter table profils
  add constraint fk_profils_station
  foreign key (station_id) references stations(id) on delete set null;

create table produits (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,               -- 'GASOIL', 'SUPER'
  libelle   text not null,
  unite     text not null default 'L',
  actif     boolean not null default true
);

-- Barème de prix daté (façon major : un prix par produit, par période, par station optionnelle)
create table prix (
  id           uuid primary key default gen_random_uuid(),
  produit_id   uuid not null references produits(id),
  station_id   uuid references stations(id),    -- null = prix réseau par défaut
  prix_unitaire numeric(12,2) not null check (prix_unitaire >= 0),
  date_debut   date not null,
  date_fin     date,                            -- null = en vigueur
  created_at   timestamptz not null default now(),
  unique (produit_id, station_id, date_debut)
);
create index idx_prix_lookup on prix(produit_id, station_id, date_debut);

-- ---------------------------------------------------------------------
--  CLIENTS
-- ---------------------------------------------------------------------
create table clients (
  id              uuid primary key default gen_random_uuid(),
  compte_tiers    text not null unique,         -- '41110024'
  compte_collectif text,                         -- compte général '4111000'
  nom             text not null,
  telephone       text,                          -- pour SMS / USSD
  email           text,
  delai_paiement_jours int not null default 30,  -- échéancier
  plafond_credit  numeric(14,0),                 -- alerte encours
  actif           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_clients_nom on clients(nom);

-- ---------------------------------------------------------------------
--  VENTES (PRISES) — SOURCE GESCOM, LECTURE SEULE APRÈS IMPORT
--  Aucune mise à jour applicative ; seul l'import écrit ici.
-- ---------------------------------------------------------------------
create table ventes (
  id            uuid primary key default gen_random_uuid(),
  import_id     uuid not null,                  -- FK -> imports (ajoutée + bas)
  date_vente    date not null,
  station_id    uuid not null references stations(id),
  piece         text not null,                  -- n° de pièce (éventuellement renuméroté)
  piece_origine text,                           -- n° d'origine si renuméroté (traçabilité)
  client_id     uuid references clients(id),
  compte_tiers  text,                           -- valeur telle qu'importée (après correction ciblée)
  lieu_livraison text,                          -- conservé tel quel depuis la source
  type_vente    type_vente not null,
  produit_id    uuid not null references produits(id),
  description   text,
  quantite      numeric(14,2) not null check (quantite >= 0),  -- litres
  prix_unitaire numeric(12,2) not null check (prix_unitaire >= 0),
  montant       numeric(16,2) not null check (montant >= 0),   -- quantite * prix_unitaire (source)
  created_at    timestamptz not null default now()
);
create index idx_ventes_date    on ventes(date_vente);
create index idx_ventes_station on ventes(station_id, date_vente);
create index idx_ventes_client  on ventes(client_id, date_vente);
create index idx_ventes_produit on ventes(produit_id);
-- Unicité métier : une pièce/station/date ne doit exister qu'une fois (dédoublonnage)
create unique index uq_ventes_piece on ventes(station_id, date_vente, piece, produit_id);

-- Garde-fou : interdire UPDATE/DELETE applicatif sur les ventes (règle d'or)
create or replace function ventes_lecture_seule() returns trigger as $$
begin
  raise exception 'Les ventes (source GESCOM) sont en lecture seule. Modification interdite.';
end; $$ language plpgsql;
create trigger trg_ventes_no_update before update on ventes
  for each row execute function ventes_lecture_seule();
create trigger trg_ventes_no_delete before delete on ventes
  for each row execute function ventes_lecture_seule();

-- ---------------------------------------------------------------------
--  IMPORTS GESCOM + JOURNAL D'ANOMALIES (piste d'audit)
-- ---------------------------------------------------------------------
create table imports (
  id              uuid primary key default gen_random_uuid(),
  date_traitee    date not null,                -- la journée des prises importées
  fichier_source  text,
  nb_ventes       int not null default 0,
  nb_anomalies    int not null default 0,
  montant_total   numeric(16,2) not null default 0,
  quantite_totale numeric(16,2) not null default 0,
  importe_par     uuid references profils(id),
  created_at      timestamptz not null default now()
);

alter table ventes
  add constraint fk_ventes_import
  foreign key (import_id) references imports(id) on delete restrict;

create table import_anomalies (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid not null references imports(id) on delete cascade,
  type        type_anomalie not null,
  station_id  uuid references stations(id),
  piece       text,
  detail      text not null,                    -- description lisible
  valeur_origine text,                          -- avant correction (traçabilité)
  valeur_corrigee text,                         -- après correction
  created_at  timestamptz not null default now()
);
create index idx_anomalies_import on import_anomalies(import_id);
create index idx_anomalies_type   on import_anomalies(type);

-- ---------------------------------------------------------------------
--  FACTURATION
-- ---------------------------------------------------------------------
create table factures (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique,           -- 'FACT-20260623-ABCDEF'
  client_id     uuid not null references clients(id),
  station_id    uuid references stations(id),
  date_emission date not null,
  periode_debut date not null,
  periode_fin   date not null,
  date_echeance date not null,                  -- = date_emission + delai_paiement
  montant_ht    numeric(16,2) not null default 0,
  remise        numeric(16,2) not null default 0,
  montant_net   numeric(16,2) not null default 0,
  statut        statut_facture not null default 'emise',
  notes         text,
  emise_par     uuid references profils(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_factures_client   on factures(client_id);
create index idx_factures_echeance on factures(date_echeance);
create index idx_factures_statut   on factures(statut);
create trigger trg_factures_updated before update on factures
  for each row execute function set_updated_at();

-- Lignes de facture (rattachées aux ventes, sans les altérer)
create table facture_lignes (
  id          uuid primary key default gen_random_uuid(),
  facture_id  uuid not null references factures(id) on delete cascade,
  vente_id    uuid references ventes(id),       -- lien vers la prise source
  produit_id  uuid not null references produits(id),
  quantite    numeric(14,2) not null,
  prix_unitaire numeric(12,2) not null,
  montant     numeric(16,2) not null
);
create index idx_facture_lignes_facture on facture_lignes(facture_id);

-- ---------------------------------------------------------------------
--  RÈGLEMENTS + LETTRAGE (façon Sage/Oracle : affectation, pas d'écrasement)
-- ---------------------------------------------------------------------
create table reglements (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id),
  date_reglement date not null,
  montant       numeric(16,2) not null check (montant > 0),
  mode          mode_reglement not null,
  reference     text,                            -- n° transaction / chèque
  notes         text,
  saisi_par     uuid references profils(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_reglements_client on reglements(client_id, date_reglement);
create trigger trg_reglements_updated before update on reglements
  for each row execute function set_updated_at();

-- Lettrage : un règlement peut couvrir plusieurs factures et inversement
create table reglement_affectations (
  id            uuid primary key default gen_random_uuid(),
  reglement_id  uuid not null references reglements(id) on delete cascade,
  facture_id    uuid not null references factures(id) on delete restrict,
  montant_affecte numeric(16,2) not null check (montant_affecte > 0),
  created_at    timestamptz not null default now(),
  unique (reglement_id, facture_id)
);
create index idx_affect_facture on reglement_affectations(facture_id);

-- Contrôle : la somme affectée d'un règlement ne dépasse pas son montant
create or replace function check_affectation() returns trigger as $$
declare total numeric(16,2); reglement_montant numeric(16,2);
begin
  select coalesce(sum(montant_affecte),0) into total
    from reglement_affectations where reglement_id = new.reglement_id;
  select montant into reglement_montant from reglements where id = new.reglement_id;
  if total > reglement_montant then
    raise exception 'Lettrage : total affecté (%) > montant du règlement (%).', total, reglement_montant;
  end if;
  return new;
end; $$ language plpgsql;
create trigger trg_check_affectation after insert or update on reglement_affectations
  for each row execute function check_affectation();

-- ---------------------------------------------------------------------
--  COMMANDES CLIENTS
-- ---------------------------------------------------------------------
create table commandes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id),
  produit_id    uuid not null references produits(id),
  station_id    uuid references stations(id),
  quantite      numeric(14,2) not null check (quantite > 0),
  date_souhaitee date,
  statut        statut_commande not null default 'enregistree',
  facture_id    uuid references factures(id),    -- liée une fois facturée
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_commandes_client on commandes(client_id);
create index idx_commandes_statut on commandes(statut);
create trigger trg_commandes_updated before update on commandes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
--  RELANCES (préparées maintenant, envoi SMS branché plus tard)
-- ---------------------------------------------------------------------
create table relances (
  id            uuid primary key default gen_random_uuid(),
  facture_id    uuid not null references factures(id) on delete cascade,
  client_id     uuid not null references clients(id),
  canal         canal_relance not null default 'sms',
  message       text not null,
  date_planifiee timestamptz not null,
  date_envoi    timestamptz,
  statut        statut_relance not null default 'planifiee',
  erreur        text,
  created_at    timestamptz not null default now()
);
create index idx_relances_statut on relances(statut, date_planifiee);

-- =====================================================================
--  VUES MÉTIER
-- =====================================================================

-- Statut/échéancier des factures (réglé, reste dû, statut calculé à la date du jour)
create or replace view v_factures_statut as
select
  f.id, f.numero, f.client_id, c.nom as client, f.station_id,
  f.date_emission, f.date_echeance, f.montant_net,
  coalesce(sum(ra.montant_affecte),0)               as montant_regle,
  f.montant_net - coalesce(sum(ra.montant_affecte),0) as reste_du,
  case
    when f.statut = 'annulee' then 'annulee'
    when f.montant_net - coalesce(sum(ra.montant_affecte),0) <= 0 then 'reglee'
    when coalesce(sum(ra.montant_affecte),0) > 0
         and current_date > f.date_echeance then 'echue'
    when coalesce(sum(ra.montant_affecte),0) > 0 then 'partiellement_reglee'
    when current_date > f.date_echeance then 'echue'
    else 'emise'
  end as statut_calcule,
  greatest(0, current_date - f.date_echeance) as jours_retard
from factures f
join clients c on c.id = f.client_id
left join reglement_affectations ra on ra.facture_id = f.id
group by f.id, c.nom;

-- Encours clients avec ancienneté (aging Sage/Oracle : 0-30 / 31-60 / 61-90 / 90+)
create or replace view v_encours_clients as
select
  c.id as client_id, c.nom, c.compte_tiers, c.telephone, c.plafond_credit,
  sum(vs.reste_du)                                   as encours_total,
  sum(vs.reste_du) filter (where vs.jours_retard = 0)            as a_jour,
  sum(vs.reste_du) filter (where vs.jours_retard between 1 and 30)  as retard_0_30,
  sum(vs.reste_du) filter (where vs.jours_retard between 31 and 60) as retard_31_60,
  sum(vs.reste_du) filter (where vs.jours_retard between 61 and 90) as retard_61_90,
  sum(vs.reste_du) filter (where vs.jours_retard > 90)             as retard_90_plus,
  case when c.plafond_credit is not null and sum(vs.reste_du) > c.plafond_credit
       then true else false end as plafond_depasse
from clients c
join v_factures_statut vs on vs.client_id = c.id
where vs.reste_du > 0
group by c.id;

-- Stations manquantes pour une date : en service mais sans prise transmise
create or replace view v_stations_manquantes as
select s.id as station_id, s.numero, s.code_site, s.nom_officiel, d.jour as date_traitee
from stations s
cross join (select distinct date_vente as jour from ventes) d
where s.statut = 'active'
  and not exists (
    select 1 from ventes v
    where v.station_id = s.id and v.date_vente = d.jour and v.quantite > 0
  );

-- KPI journalier (volume, CA, lignes, clients/stations actifs)
create or replace view v_kpi_journalier as
select
  date_vente,
  count(*)                          as nb_lignes,
  sum(quantite)                     as quantite_totale,
  sum(montant)                      as montant_total,
  count(distinct client_id)         as clients_actifs,
  count(distinct station_id)        as stations_actives,
  sum(montant) filter (where type_vente='especes') as ca_especes,
  sum(montant) filter (where type_vente='credit')  as ca_credit
from ventes
group by date_vente;

-- =====================================================================
--  ROW LEVEL SECURITY
-- =====================================================================
alter table stations    enable row level security;
alter table clients     enable row level security;
alter table ventes      enable row level security;
alter table factures    enable row level security;
alter table reglements  enable row level security;
alter table commandes   enable row level security;
alter table relances    enable row level security;
alter table imports     enable row level security;
alter table import_anomalies enable row level security;

-- Helper : rôle de l'utilisateur courant
create or replace function mon_role() returns role_utilisateur as $$
  select role from profils where id = auth.uid();
$$ language sql stable security definer;

-- Helper : station de l'utilisateur courant (si role station)
create or replace function ma_station() returns uuid as $$
  select station_id from profils where id = auth.uid();
$$ language sql stable security definer;

-- Direction & contrôle : tout voir ; station : son périmètre.
-- (Exemple sur ventes ; répliquer le motif sur les autres tables.)
create policy ventes_lecture on ventes for select using (
  mon_role() in ('direction','controle')
  or (mon_role() = 'station' and station_id = ma_station())
);
create policy factures_lecture on factures for select using (
  mon_role() in ('direction','controle')
  or (mon_role() = 'station' and station_id = ma_station())
);
create policy clients_lecture on clients for select using (
  mon_role() in ('direction','controle','station')
);
-- Écritures financières réservées à direction/contrôle
create policy reglements_ecriture on reglements for all using (
  mon_role() in ('direction','controle')
) with check (mon_role() in ('direction','controle'));

-- NB : compléter les policies (insert/update) table par table selon les besoins,
-- en gardant les ventes en lecture seule (déjà verrouillées par trigger).

-- =====================================================================
--  FIN MIGRATION SOCLE
-- =====================================================================
