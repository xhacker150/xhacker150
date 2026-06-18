-- =====================================================================
--  ERP STATIONS-SERVICE — SCHÉMA SUPABASE (PostgreSQL)
--  SYSCOHADA / XOF · carburant Super & Gasoil · hors TVA
--  Inclut : référentiels, fiche journalière, bons, comptabilité partie
--  double, piste d'audit, RLS stricte, + COUCHE IA (anomalies & prévisions).
--  À exécuter dans : Supabase → SQL Editor → New query → Run
--  Idempotent.
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
--  1. RÉFÉRENTIELS & IDENTITÉ
-- =====================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'gerant' check (role in ('admin','comptable','gerant','pompiste')),
  station_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.stations (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='profiles_station_fk') then
    alter table public.profiles add constraint profiles_station_fk
      foreign key (station_id) references public.stations(id) on delete set null;
  end if;
end $$;

create table if not exists public.cuves (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  nom text not null, produit text not null check (produit in ('Super','Gasoil')),
  capacite numeric
);

create table if not exists public.pompes (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  nom text not null, produit text not null check (produit in ('Super','Gasoil'))
);

create table if not exists public.clients (
  cpt text primary key, nom text not null, prin text, plafond numeric,
  created_at timestamptz not null default now()
);

-- Prix historisés (un prix s'applique à partir de sa date d'effet)
create table if not exists public.tarifs (
  id uuid primary key default gen_random_uuid(),
  produit text not null check (produit in ('Super','Gasoil')),
  prix numeric not null, date_effet date not null,
  unique (produit, date_effet)
);

create or replace function public.prix_du_jour(p_produit text, p_date date)
returns numeric language sql stable as $$
  select prix from public.tarifs
  where produit=p_produit and date_effet<=p_date
  order by date_effet desc limit 1
$$;

-- =====================================================================
--  2. EXPLOITATION : FICHES & BONS
-- =====================================================================
create table if not exists public.fiches (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  d_year int not null, d_month int not null check (d_month between 1 and 12),
  d_day  int not null check (d_day between 1 and 31),
  -- volumes théoriques (par index) saisis à la clôture
  vol_super numeric default 0, vol_gasoil numeric default 0,
  -- versement réel du pompiste
  versement numeric default 0,
  statut text not null default 'ouverte' check (statut in ('ouverte','cloturee')),
  cloturee_at timestamptz, cloturee_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (station_id, d_year, d_month, d_day)
);

create table if not exists public.bons (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  fiche_id uuid references public.fiches(id) on delete set null,
  d_year int not null, d_month int not null check (d_month between 1 and 12),
  d_day  int not null check (d_day between 1 and 31),
  nom text, cpt text, immat text, bl text,
  produit text check (produit in ('Super','Gasoil','')),
  qte numeric, pu numeric,
  piece_url text,                       -- justificatif (Supabase Storage)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists bons_scope_idx on public.bons (station_id,d_year,d_month,d_day);

-- =====================================================================
--  3. COMPTABILITÉ — PARTIE DOUBLE
-- =====================================================================
create table if not exists public.ecritures (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  journal text not null,                -- VT, CA, BQ, OD, AC
  piece_date date not null,
  libelle text not null,
  source_type text, source_id uuid,     -- traçabilité (bon, fiche, od...)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.lignes_ecriture (
  id uuid primary key default gen_random_uuid(),
  ecriture_id uuid not null references public.ecritures(id) on delete cascade,
  compte text not null, libelle text,
  debit numeric not null default 0 check (debit>=0),
  credit numeric not null default 0 check (credit>=0)
);

-- Contrôle d'équilibre : une écriture doit être équilibrée (débits=crédits)
create or replace function public.check_equilibre()
returns trigger language plpgsql as $$
declare d numeric; c numeric; eid uuid;
begin
  eid := coalesce(new.ecriture_id, old.ecriture_id);
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d,c
  from public.lignes_ecriture where ecriture_id=eid;
  if round(d,2) <> round(c,2) then
    raise exception 'Écriture déséquilibrée (débit=% / crédit=%)', d, c;
  end if;
  return null;
end $$;

drop trigger if exists trg_equilibre on public.lignes_ecriture;
create constraint trigger trg_equilibre
  after insert or update or delete on public.lignes_ecriture
  deferrable initially deferred
  for each row execute function public.check_equilibre();

-- =====================================================================
--  4. PISTE D'AUDIT IMMUABLE
-- =====================================================================
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor uuid, action text, tbl text, row_id text, details jsonb
);

create or replace function public.audit()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_log(actor,action,tbl,row_id,details)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce(new.id::text, old.id::text),
          case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return coalesce(new,old);
end $$;

do $$ declare t text;
begin
  foreach t in array array['bons','fiches','ecritures','clients','tarifs','stations']
  loop
    execute format('drop trigger if exists trg_audit on public.%I;', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit();', t);
  end loop;
end $$;

-- empêcher modification/suppression de l'audit
create or replace function public.audit_immutable()
returns trigger language plpgsql as $$
begin raise exception 'Journal d''audit immuable'; end $$;
drop trigger if exists trg_audit_ro on public.audit_log;
create trigger trg_audit_ro before update or delete on public.audit_log
  for each row execute function public.audit_immutable();

-- verrou : pas d'écriture sur une fiche clôturée
create or replace function public.lock_fiche_cloturee()
returns trigger language plpgsql as $$
declare st text;
begin
  if new.fiche_id is not null then
    select statut into st from public.fiches where id=new.fiche_id;
    if st='cloturee' then raise exception 'Fiche clôturée : modification interdite'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_bon on public.bons;
create trigger trg_lock_bon before insert or update on public.bons
  for each row execute function public.lock_fiche_cloturee();

-- =====================================================================
--  5. CRÉATION AUTOMATIQUE DU PROFIL (1er compte = admin)
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare n int;
begin
  select count(*) into n from public.profiles;
  insert into public.profiles(id,email,role)
  values (new.id,new.email, case when n=0 then 'admin' else 'gerant' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
--  6. HELPERS RLS
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;
create or replace function public.is_compta() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','comptable')) $$;
create or replace function public.my_station() returns uuid
language sql stable security definer set search_path=public as $$
  select station_id from public.profiles where id=auth.uid() $$;

-- =====================================================================
--  7. DOSSIER D'ANALYSE EXACT (chiffres calculés par PostgreSQL)
--  C'est la base qui calcule (fiable) ; Claude juge dessus (voir Edge Function).
-- =====================================================================
-- Recette cash théorique par fiche = (volume - bons) * prix du jour
create or replace view public.v_fiche_calc as
select f.*,
  d.dt as fiche_date,
  coalesce(b.bon_super,0)  as bon_super,
  coalesce(b.bon_gasoil,0) as bon_gasoil,
  (f.vol_super  - coalesce(b.bon_super,0))  as cash_vol_super,
  (f.vol_gasoil - coalesce(b.bon_gasoil,0)) as cash_vol_gasoil,
  (f.vol_super  - coalesce(b.bon_super,0))  * public.prix_du_jour('Super',  d.dt)
+ (f.vol_gasoil - coalesce(b.bon_gasoil,0)) * public.prix_du_jour('Gasoil', d.dt) as cash_theorique
from public.fiches f
cross join lateral (select make_date(f.d_year,f.d_month,f.d_day) as dt) d
left join lateral (
  select sum(case when produit='Super' then qte else 0 end) as bon_super,
         sum(case when produit='Gasoil' then qte else 0 end) as bon_gasoil
  from public.bons b where b.fiche_id=f.id and b.bl is not null
) b on true;

-- Tendance de consommation par produit (pente = litres/jour via régression)
create or replace view public.v_tendance_produit as
select station_id, produit,
       count(*) as n_jours,
       round(avg(q),1) as moyenne_jour,
       round(regr_slope(q, jour)::numeric,2) as pente_litres_par_jour,
       round(regr_intercept(q, jour)::numeric,1) as ordonnee
from (
  select b.station_id, b.produit,
         extract(epoch from make_date(b.d_year,b.d_month,b.d_day))/86400 as jour,
         sum(b.qte) as q
  from public.bons b where b.produit in ('Super','Gasoil') and b.qte is not null
  group by b.station_id,b.produit,b.d_year,b.d_month,b.d_day
) s
group by station_id,produit;

create or replace view public.v_top_clients as
select b.station_id, b.d_year, b.d_month,
       coalesce(b.cpt,b.nom) as client, coalesce(b.nom,b.cpt) as nom,
       sum(b.qte*b.pu) as montant, count(*) filter (where b.bl is not null) as nb_bons
from public.bons b
group by b.station_id,b.d_year,b.d_month,coalesce(b.cpt,b.nom),coalesce(b.nom,b.cpt);

-- Table des alertes : Claude y écrit ses détections (résolvables/suivies)
create table if not exists public.alertes (
  id uuid primary key default gen_random_uuid(),
  station_id uuid references public.stations(id) on delete cascade,
  fiche_id uuid references public.fiches(id) on delete cascade,
  type text not null,            -- ex : FRAUDE_CAISSE, BON_SUSPECT, COULAGE, AUTRE
  gravite text not null default 'moyenne' check (gravite in ('faible','moyenne','haute')),
  score numeric,                 -- niveau de confiance attribué par Claude (0-100)
  message text,                  -- explication rédigée par Claude
  detail jsonb,                  -- contexte chiffré (jour, montants...)
  source text default 'claude',  -- origine de la détection
  resolue boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists alertes_scope_idx on public.alertes(station_id,resolue,created_at);

-- DOSSIER D'ANALYSE : tout ce que Claude doit examiner, chiffré exactement par PG.
-- Renvoie un JSON : jours du mois (volumes, bons, cash théorique, versement, écart),
-- top clients, plus gros bons, tendances, prix appliqués.
create or replace function public.dossier_analyse(p_station uuid, p_year int, p_month int)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'station', (select name from public.stations where id=p_station),
    'periode', to_char(make_date(p_year,p_month,1),'MM/YYYY'),
    'devise', 'XOF',
    -- une ligne par jour, chiffres exacts
    'jours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(fc.fiche_date,'YYYY-MM-DD'),
        'vol_super', fc.vol_super, 'vol_gasoil', fc.vol_gasoil,
        'bons_super', fc.bon_super, 'bons_gasoil', fc.bon_gasoil,
        'cash_theorique', round(fc.cash_theorique),
        'versement', fc.versement,
        'ecart', round(fc.versement - fc.cash_theorique),
        'statut', fc.statut,
        'fiche_id', fc.id
      ) order by fc.fiche_date)
      from public.v_fiche_calc fc
      where fc.station_id=p_station and fc.d_year=p_year and fc.d_month=p_month
    ), '[]'::jsonb),
    -- repères statistiques de cadrage (calculés par PG, pas par Claude)
    'reperes_ecart', (
      select jsonb_build_object(
        'moyenne', round(avg(versement-cash_theorique)),
        'ecart_type', round(coalesce(stddev_samp(versement-cash_theorique),0)),
        'n_jours_historique', count(*))
      from public.v_fiche_calc where station_id=p_station
    ),
    -- plus gros bons de la période (pour repérer un bon gonflé)
    'plus_gros_bons', coalesce((
      select jsonb_agg(j) from (
        select jsonb_build_object('date',make_date(b.d_year,b.d_month,b.d_day),
                 'client',coalesce(b.nom,b.cpt),'bl',b.bl,'produit',b.produit,
                 'qte',b.qte,'montant',round(b.qte*b.pu),'fiche_id',b.fiche_id) j
        from public.bons b
        where b.station_id=p_station and b.d_year=p_year and b.d_month=p_month and b.bl is not null
        order by b.qte*b.pu desc nulls last limit 15
      ) t), '[]'::jsonb),
    -- top clients du mois
    'top_clients', coalesce((
      select jsonb_agg(j) from (
        select jsonb_build_object('client',nom,'montant',round(montant),'nb_bons',nb_bons) j
        from public.v_top_clients
        where station_id=p_station and d_year=p_year and d_month=p_month
        order by montant desc nulls last limit 5
      ) t), '[]'::jsonb),
    -- tendances par produit (régression PG)
    'tendances', coalesce((
      select jsonb_agg(jsonb_build_object('produit',produit,'moyenne_jour',moyenne_jour,
               'pente_litres_par_jour',pente_litres_par_jour,'n_jours',n_jours))
      from public.v_tendance_produit where station_id=p_station
    ), '[]'::jsonb)
  )
$$;

-- =====================================================================
--  9. ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.stations enable row level security;
alter table public.cuves    enable row level security;
alter table public.pompes   enable row level security;
alter table public.clients  enable row level security;
alter table public.tarifs   enable row level security;
alter table public.fiches   enable row level security;
alter table public.bons     enable row level security;
alter table public.ecritures enable row level security;
alter table public.lignes_ecriture enable row level security;
alter table public.alertes  enable row level security;
alter table public.audit_log enable row level security;

-- profiles
drop policy if exists p_prof_read on public.profiles;
create policy p_prof_read on public.profiles for select using (id=auth.uid() or public.is_admin());
drop policy if exists p_prof_self on public.profiles;
create policy p_prof_self on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());
drop policy if exists p_prof_admin on public.profiles;
create policy p_prof_admin on public.profiles for all using (public.is_admin()) with check (public.is_admin());

-- référentiels : lecture pour connectés, écriture admin
do $$ declare t text;
begin
  foreach t in array array['stations','cuves','pompes','clients','tarifs'] loop
    execute format('drop policy if exists r_read on public.%I;',t);
    execute format('create policy r_read on public.%I for select using (auth.uid() is not null);',t);
    execute format('drop policy if exists r_write on public.%I;',t);
    execute format('create policy r_write on public.%I for all using (public.is_admin()) with check (public.is_admin());',t);
  end loop;
end $$;

-- fiches : admin/compta tout ; gérant sa station
drop policy if exists f_read on public.fiches;
create policy f_read on public.fiches for select using (public.is_compta() or station_id=public.my_station());
drop policy if exists f_admin on public.fiches;
create policy f_admin on public.fiches for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists f_gerant_ins on public.fiches;
create policy f_gerant_ins on public.fiches for insert with check (station_id=public.my_station());
drop policy if exists f_gerant_upd on public.fiches;
create policy f_gerant_upd on public.fiches for update using (station_id=public.my_station()) with check (station_id=public.my_station());

-- bons : idem fiches (strict par station)
drop policy if exists b_read on public.bons;
create policy b_read on public.bons for select using (public.is_compta() or station_id=public.my_station());
drop policy if exists b_admin on public.bons;
create policy b_admin on public.bons for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists b_g_ins on public.bons;
create policy b_g_ins on public.bons for insert with check (station_id=public.my_station());
drop policy if exists b_g_upd on public.bons;
create policy b_g_upd on public.bons for update using (station_id=public.my_station()) with check (station_id=public.my_station());
drop policy if exists b_g_del on public.bons;
create policy b_g_del on public.bons for delete using (station_id=public.my_station());

-- comptabilité : lecture compta/admin ; écriture via service (Edge Function) ou admin
drop policy if exists e_read on public.ecritures;
create policy e_read on public.ecritures for select using (public.is_compta() or station_id=public.my_station());
drop policy if exists e_admin on public.ecritures;
create policy e_admin on public.ecritures for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists le_read on public.lignes_ecriture;
create policy le_read on public.lignes_ecriture for select using (auth.uid() is not null);
drop policy if exists le_admin on public.lignes_ecriture;
create policy le_admin on public.lignes_ecriture for all using (public.is_admin()) with check (public.is_admin());

-- alertes : lecture compta/admin + gérant sa station ; maj (résolution) par compta/admin
drop policy if exists a_read on public.alertes;
create policy a_read on public.alertes for select using (public.is_compta() or station_id=public.my_station());
drop policy if exists a_upd on public.alertes;
create policy a_upd on public.alertes for update using (public.is_compta()) with check (public.is_compta());
drop policy if exists a_admin on public.alertes;
create policy a_admin on public.alertes for all using (public.is_admin()) with check (public.is_admin());

-- audit : lecture compta/admin uniquement
drop policy if exists au_read on public.audit_log;
create policy au_read on public.audit_log for select using (public.is_compta());

-- =====================================================================
--  FIN. Étapes : Edge Functions (detect-fraude, prevoir) + app. Voir GUIDE.
-- =====================================================================
