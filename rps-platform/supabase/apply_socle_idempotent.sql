-- =====================================================================
--  RPS — Socle (schéma + seed) en UN SEUL script IDEMPOTENT
--  À coller dans le SQL Editor de Supabase et exécuter (Run). Rejouable.
--
--  Équivaut à 0001_init.sql + 0002_seed.sql, mais sûr à ré-exécuter :
--  enums gardés, `create ... if not exists`, policies/triggers recréés.
--  Les migrations canoniques restent 0001_init.sql et 0002_seed.sql.
--
--  RÈGLE D'OR : la table `ventes` (source GESCOM) reste en lecture seule
--  (triggers anti-UPDATE/DELETE). L'import n'y fait qu'INSÉRER.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ---------------------------------------------------------------------
--  ENUMS (gardés : ignorés s'ils existent déjà)
-- ---------------------------------------------------------------------
do $$ begin create type role_utilisateur as enum ('direction','controle','station'); exception when duplicate_object then null; end $$;
do $$ begin create type statut_station as enum ('active','hors_service'); exception when duplicate_object then null; end $$;
do $$ begin create type type_vente as enum ('especes','credit'); exception when duplicate_object then null; end $$;
do $$ begin create type statut_facture as enum ('brouillon','emise','partiellement_reglee','reglee','echue','annulee'); exception when duplicate_object then null; end $$;
do $$ begin create type mode_reglement as enum ('especes','virement','mobile_money','cheque','compensation'); exception when duplicate_object then null; end $$;
do $$ begin create type statut_commande as enum ('enregistree','validee','livree','facturee','annulee'); exception when duplicate_object then null; end $$;
do $$ begin create type canal_relance as enum ('sms','email','appel','courrier'); exception when duplicate_object then null; end $$;
do $$ begin create type statut_relance as enum ('planifiee','envoyee','echec','annulee'); exception when duplicate_object then null; end $$;
do $$ begin create type type_anomalie as enum (
  'date_hors_periode','doublon_piece','doublon_contenu','piece_renumerotee',
  'compte_tiers_corrige','collectif_corrige','decimal_normalise',
  'espace_nettoye','depot_corrige','station_manquante','collision_sage','autre'
); exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
--  FONCTION AUDIT
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

-- ---------------------------------------------------------------------
--  PROFILS
-- ---------------------------------------------------------------------
create table if not exists profils (
  id          uuid primary key references auth.users(id) on delete cascade,
  nom         text not null,
  role        role_utilisateur not null default 'station',
  station_id  uuid,
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  RÉFÉRENTIEL RÉSEAU
-- ---------------------------------------------------------------------
create table if not exists stations (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique,
  code_site     text not null unique,
  nom_officiel  text not null,
  format_piece  text,
  statut        statut_station not null default 'active',
  latitude      double precision,
  longitude     double precision,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_stations_statut on stations(statut);

do $$ begin
  alter table profils add constraint fk_profils_station
    foreign key (station_id) references stations(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists produits (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  libelle   text not null,
  unite     text not null default 'L',
  actif     boolean not null default true
);

create table if not exists prix (
  id           uuid primary key default gen_random_uuid(),
  produit_id   uuid not null references produits(id),
  station_id   uuid references stations(id),
  prix_unitaire numeric(12,2) not null check (prix_unitaire >= 0),
  date_debut   date not null,
  date_fin     date,
  created_at   timestamptz not null default now(),
  unique (produit_id, station_id, date_debut)
);
create index if not exists idx_prix_lookup on prix(produit_id, station_id, date_debut);

-- ---------------------------------------------------------------------
--  CLIENTS
-- ---------------------------------------------------------------------
create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  compte_tiers    text not null unique,
  compte_collectif text,
  nom             text not null,
  telephone       text,
  email           text,
  delai_paiement_jours int not null default 30,
  plafond_credit  numeric(14,0),
  actif           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_clients_nom on clients(nom);

-- ---------------------------------------------------------------------
--  VENTES (PRISES) — SOURCE GESCOM, LECTURE SEULE
-- ---------------------------------------------------------------------
create table if not exists ventes (
  id            uuid primary key default gen_random_uuid(),
  import_id     uuid not null,
  date_vente    date not null,
  station_id    uuid not null references stations(id),
  piece         text not null,
  piece_origine text,
  client_id     uuid references clients(id),
  compte_tiers  text,
  lieu_livraison text,
  type_vente    type_vente not null,
  produit_id    uuid not null references produits(id),
  description   text,
  quantite      numeric(14,2) not null check (quantite >= 0),
  prix_unitaire numeric(12,2) not null check (prix_unitaire >= 0),
  montant       numeric(16,2) not null check (montant >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists idx_ventes_date    on ventes(date_vente);
create index if not exists idx_ventes_station on ventes(station_id, date_vente);
create index if not exists idx_ventes_client  on ventes(client_id, date_vente);
create index if not exists idx_ventes_produit on ventes(produit_id);
create unique index if not exists uq_ventes_piece on ventes(station_id, date_vente, piece, produit_id);

create or replace function ventes_lecture_seule() returns trigger as $$
begin
  raise exception 'Les ventes (source GESCOM) sont en lecture seule. Modification interdite.';
end; $$ language plpgsql;
drop trigger if exists trg_ventes_no_update on ventes;
create trigger trg_ventes_no_update before update on ventes
  for each row execute function ventes_lecture_seule();
drop trigger if exists trg_ventes_no_delete on ventes;
create trigger trg_ventes_no_delete before delete on ventes
  for each row execute function ventes_lecture_seule();

-- ---------------------------------------------------------------------
--  IMPORTS + JOURNAL D'ANOMALIES
-- ---------------------------------------------------------------------
create table if not exists imports (
  id              uuid primary key default gen_random_uuid(),
  date_traitee    date not null,
  fichier_source  text,
  nb_ventes       int not null default 0,
  nb_anomalies    int not null default 0,
  montant_total   numeric(16,2) not null default 0,
  quantite_totale numeric(16,2) not null default 0,
  importe_par     uuid references profils(id),
  created_at      timestamptz not null default now()
);

do $$ begin
  alter table ventes add constraint fk_ventes_import
    foreign key (import_id) references imports(id) on delete restrict;
exception when duplicate_object then null; end $$;

create table if not exists import_anomalies (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid not null references imports(id) on delete cascade,
  type        type_anomalie not null,
  station_id  uuid references stations(id),
  piece       text,
  detail      text not null,
  valeur_origine text,
  valeur_corrigee text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_anomalies_import on import_anomalies(import_id);
create index if not exists idx_anomalies_type   on import_anomalies(type);

-- ---------------------------------------------------------------------
--  FACTURATION
-- ---------------------------------------------------------------------
create table if not exists factures (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique,
  client_id     uuid not null references clients(id),
  station_id    uuid references stations(id),
  date_emission date not null,
  periode_debut date not null,
  periode_fin   date not null,
  date_echeance date not null,
  montant_ht    numeric(16,2) not null default 0,
  remise        numeric(16,2) not null default 0,
  montant_net   numeric(16,2) not null default 0,
  statut        statut_facture not null default 'emise',
  notes         text,
  emise_par     uuid references profils(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_factures_client   on factures(client_id);
create index if not exists idx_factures_echeance on factures(date_echeance);
create index if not exists idx_factures_statut   on factures(statut);
drop trigger if exists trg_factures_updated on factures;
create trigger trg_factures_updated before update on factures
  for each row execute function set_updated_at();

create table if not exists facture_lignes (
  id          uuid primary key default gen_random_uuid(),
  facture_id  uuid not null references factures(id) on delete cascade,
  vente_id    uuid references ventes(id),
  produit_id  uuid not null references produits(id),
  quantite    numeric(14,2) not null,
  prix_unitaire numeric(12,2) not null,
  montant     numeric(16,2) not null
);
create index if not exists idx_facture_lignes_facture on facture_lignes(facture_id);

-- ---------------------------------------------------------------------
--  RÈGLEMENTS + LETTRAGE
-- ---------------------------------------------------------------------
create table if not exists reglements (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id),
  date_reglement date not null,
  montant       numeric(16,2) not null check (montant > 0),
  mode          mode_reglement not null,
  reference     text,
  notes         text,
  saisi_par     uuid references profils(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_reglements_client on reglements(client_id, date_reglement);
drop trigger if exists trg_reglements_updated on reglements;
create trigger trg_reglements_updated before update on reglements
  for each row execute function set_updated_at();

create table if not exists reglement_affectations (
  id            uuid primary key default gen_random_uuid(),
  reglement_id  uuid not null references reglements(id) on delete cascade,
  facture_id    uuid not null references factures(id) on delete restrict,
  montant_affecte numeric(16,2) not null check (montant_affecte > 0),
  created_at    timestamptz not null default now(),
  unique (reglement_id, facture_id)
);
create index if not exists idx_affect_facture on reglement_affectations(facture_id);

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
drop trigger if exists trg_check_affectation on reglement_affectations;
create trigger trg_check_affectation after insert or update on reglement_affectations
  for each row execute function check_affectation();

-- ---------------------------------------------------------------------
--  COMMANDES
-- ---------------------------------------------------------------------
create table if not exists commandes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id),
  produit_id    uuid not null references produits(id),
  station_id    uuid references stations(id),
  quantite      numeric(14,2) not null check (quantite > 0),
  date_souhaitee date,
  statut        statut_commande not null default 'enregistree',
  facture_id    uuid references factures(id),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_commandes_client on commandes(client_id);
create index if not exists idx_commandes_statut on commandes(statut);
drop trigger if exists trg_commandes_updated on commandes;
create trigger trg_commandes_updated before update on commandes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
--  RELANCES
-- ---------------------------------------------------------------------
create table if not exists relances (
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
create index if not exists idx_relances_statut on relances(statut, date_planifiee);

-- =====================================================================
--  VUES MÉTIER
-- =====================================================================
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

create or replace view v_stations_manquantes as
select s.id as station_id, s.numero, s.code_site, s.nom_officiel, d.jour as date_traitee
from stations s
cross join (select distinct date_vente as jour from ventes) d
where s.statut = 'active'
  and not exists (
    select 1 from ventes v
    where v.station_id = s.id and v.date_vente = d.jour and v.quantite > 0
  );

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

create or replace function mon_role() returns role_utilisateur as $$
  select role from profils where id = auth.uid();
$$ language sql stable security definer;

create or replace function ma_station() returns uuid as $$
  select station_id from profils where id = auth.uid();
$$ language sql stable security definer;

drop policy if exists ventes_lecture on ventes;
create policy ventes_lecture on ventes for select using (
  mon_role() in ('direction','controle')
  or (mon_role() = 'station' and station_id = ma_station())
);
drop policy if exists factures_lecture on factures;
create policy factures_lecture on factures for select using (
  mon_role() in ('direction','controle')
  or (mon_role() = 'station' and station_id = ma_station())
);
drop policy if exists clients_lecture on clients;
create policy clients_lecture on clients for select using (
  mon_role() in ('direction','controle','station')
);
drop policy if exists reglements_ecriture on reglements;
create policy reglements_ecriture on reglements for all using (
  mon_role() in ('direction','controle')
) with check (mon_role() in ('direction','controle'));

-- =====================================================================
--  SEED (référentiel) — idempotent via on conflict
-- =====================================================================
insert into produits (code,libelle) values ('GASOIL','Gasoil'),('SUPER','Super')
  on conflict (code) do nothing;

insert into stations (numero,code_site,nom_officiel,format_piece,statut) values
  ('18','AZ-18','RPS Agadez','F18','hors_service'),
  ('43','AZ-43','RPS Agadez Misrata','F43','active'),
  ('45','AZ-45','RPS Arlit','F45','active'),
  ('20','DI-20','RPS Diffa','F20','active'),
  ('01','DO-01','RPS Gaya','F01','active'),
  ('02','DO-02','RPS Dosso','F02','active'),
  ('03','DO-03','RPS Gaya','F03','active'),
  ('05','DO-05','RPS Doutchi','F05','active'),
  ('35','DO-35','RPS Gaya 03','F35','active'),
  ('36','DO-36','RPS Tandobon','F36','active'),
  ('04','MI-04','RPS Tessaoua','F04','active'),
  ('12','MI-12','RPS Maradi','F12','active'),
  ('40','MI-40','RPS Maradi-Tibiri','F40','hors_service'),
  ('46','MI-46','RPS Guidan Roumdji','F46','active'),
  ('47','MI-47','RPS Mayahi','F47','active'),
  ('08','NY-08','RPS Direction','F08','active'),
  ('11','NY-11','RPS Yantala','F11','active'),
  ('13','NY-13','RPS Koubia','F13','active'),
  ('14','NY-14','RPS Sorey','F14','active'),
  ('15','NY-15','RPS Lazarey','F15','active'),
  ('16','NY-16','RPS Cité Caisse','F16','active'),
  ('17','NY-17','RPS Bceao','F17','active'),
  ('21','NY-21','RPS Cité Progrès','F21','active'),
  ('22','NY-22','RPS-Kossey','F22','active'),
  ('23','NY-23','RPS Saga Gorou','F23','hors_service'),
  ('24','NY-24','RPS Route Rond Point Baré','F24','active'),
  ('25','NY-25','RPS Marhaba','F25','active'),
  ('26','NY-26','RPS Tourakou','F26','active'),
  ('27','NY-27','RPS Dar Salam','F27','active'),
  ('28','NY-28','RPS Bobiel','F28','active'),
  ('29','NY-29','RPS Harobanda','F29','active'),
  ('30','NY-30','RPS Chateau8','F30','active'),
  ('31','NY-31','RPS Rimbo','F31','active'),
  ('32','NY-32','RPS Madina','F32','active'),
  ('33','NY-33','RPS Les Arènes','F33','active'),
  ('34','NY-34','RPS Bonkaney','F34','active'),
  ('44','NY-44','RPS Saga','F44','active'),
  ('06','TA-06','RPS Konni','F06','active'),
  ('37','TA-37','RPS Konni 02','F37','active'),
  ('38','TA-38','RPS Tahoua 01','F38','active'),
  ('39','TA-39','RPS Tahoua 02','F39','active'),
  ('48','TA-48','RPS Tchinta RT Algérie','F48','active'),
  ('49','TA-49','RPS Tchinta RT Tahoua','F49','hors_service'),
  ('50','TA-50','RPS Abalak RT Agadez','F50','hors_service'),
  ('51','TA-51','RPS Abalak Préfecture','F51','active'),
  ('07','TY-07','RPS Mossi Paga','F07','hors_service'),
  ('10','TY-10','RPS Bangaré','F10','hors_service'),
  ('19','TY-19','RPS Bouppo','F19','hors_service'),
  ('52','TY-52','RPS Hamdallaye','F52','active'),
  ('53','TY-53','RPS Baléyara','F53','active'),
  ('54','TY-54','RPS Ayorou','F54','active'),
  ('09','ZR-09','RPS Zr-Rte Maradi','F09','hors_service'),
  ('41','ZR-41','RPS Zinder-Soraze','F41','active'),
  ('42','ZR-42','RPS Zr-Hypodrome','F42','active'),
  ('GR','','EX-DEPOT-RIMBO','FGRTS','active')
on conflict (numero) do nothing;

-- =====================================================================
--  VÉRIFICATION (doit renvoyer : 55 / 46 / 9 / 2 / 4)
-- =====================================================================
select
  (select count(*) from stations)                             as stations,
  (select count(*) from stations where statut='active')       as actives,
  (select count(*) from stations where statut='hors_service') as hors_service,
  (select count(*) from produits)                             as produits,
  (select count(*) from information_schema.views where table_schema='public') as vues;
