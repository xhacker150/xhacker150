-- ============================================================
-- RPS SOLAIRE - Suivi des systèmes solaires des stations
-- Schéma PostgreSQL (idempotent : peut être rejoué)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE role_enum AS ENUM ('lecteur', 'operateur', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE statut_commande_enum AS ENUM ('en_attente', 'envoyee', 'verifiee', 'ecart', 'echec', 'non_verifiee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Stations RPS (sites physiques)
-- ============================================================
CREATE TABLE IF NOT EXISTS stations (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    nom VARCHAR(150) NOT NULL,
    ville VARCHAR(100),
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Centrales fSolar ("plants"), rattachées à une station RPS
-- Les identifiants fSolar dépassent 2^53 : stockés en texte.
-- ============================================================
CREATE TABLE IF NOT EXISTS centrales (
    plant_id TEXT PRIMARY KEY,
    nom TEXT,
    fuseau TEXT,
    adresse TEXT,
    station_id INT REFERENCES stations(id) ON DELETE SET NULL,
    vue_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_centrales_station ON centrales(station_id);

-- ============================================================
-- Onduleurs / batteries
-- ============================================================
CREATE TABLE IF NOT EXISTS onduleurs (
    device_sn TEXT PRIMARY KEY,
    plant_id TEXT REFERENCES centrales(plant_id) ON DELETE SET NULL,
    modele TEXT,
    type_appareil TEXT,
    sous_type TEXT,
    puissance_nominale NUMERIC,
    statut TEXT,
    version_firmware TEXT,
    vu_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    infos_le TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_onduleurs_centrale ON onduleurs(plant_id);

-- ============================================================
-- Mesures temps réel (une ligne par relevé d'onduleur)
-- Puissances en W. reseau_w < 0 : injection sur le réseau.
-- ============================================================
CREATE TABLE IF NOT EXISTS mesures (
    id BIGSERIAL PRIMARY KEY,
    device_sn TEXT NOT NULL REFERENCES onduleurs(device_sn) ON DELETE CASCADE,
    horodatage TIMESTAMPTZ NOT NULL,
    pv_w NUMERIC,
    reseau_w NUMERIC,
    charge_w NUMERIC,
    secours_w NUMERIC,
    batterie_w NUMERIC,
    soc NUMERIC,
    temperature_max NUMERIC,
    mode_travail TEXT,
    brut JSONB,
    UNIQUE (device_sn, horodatage)
);
CREATE INDEX IF NOT EXISTS idx_mesures_sn_date ON mesures(device_sn, horodatage DESC);

-- ============================================================
-- Énergie journalière par onduleur (kWh)
-- ============================================================
CREATE TABLE IF NOT EXISTS energie_jour (
    device_sn TEXT NOT NULL REFERENCES onduleurs(device_sn) ON DELETE CASCADE,
    jour DATE NOT NULL,
    production_kwh NUMERIC,
    pv_kwh NUMERIC,
    reseau_import_kwh NUMERIC,
    reseau_export_kwh NUMERIC,
    batterie_charge_kwh NUMERIC,
    batterie_decharge_kwh NUMERIC,
    consommation_kwh NUMERIC,
    groupe_kwh NUMERIC,
    brut JSONB,
    maj_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (device_sn, jour)
);
CREATE INDEX IF NOT EXISTS idx_energie_jour ON energie_jour(jour);

-- ============================================================
-- Alarmes (W) et défauts (F)
-- ============================================================
CREATE TABLE IF NOT EXISTS evenements (
    id BIGSERIAL PRIMARY KEY,
    device_sn TEXT NOT NULL REFERENCES onduleurs(device_sn) ON DELETE CASCADE,
    horodatage_texte TEXT NOT NULL,
    horodatage TIMESTAMPTZ,
    code TEXT NOT NULL,
    nom TEXT,
    type_evenement TEXT,
    fuseau TEXT,
    vu_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_sn, horodatage_texte, code)
);
CREATE INDEX IF NOT EXISTS idx_evenements_sn_date ON evenements(device_sn, vu_le DESC);

-- ============================================================
-- Utilisateurs du tableau de bord
-- ============================================================
CREATE TABLE IF NOT EXISTS utilisateurs (
    id SERIAL PRIMARY KEY,
    identifiant VARCHAR(80) UNIQUE NOT NULL,
    nom VARCHAR(150),
    mot_de_passe_hash TEXT NOT NULL,
    role role_enum NOT NULL DEFAULT 'lecteur',
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Journal des commandes de réglage envoyées aux onduleurs
-- ============================================================
CREATE TABLE IF NOT EXISTS commandes (
    id BIGSERIAL PRIMARY KEY,
    device_sn TEXT NOT NULL REFERENCES onduleurs(device_sn),
    utilisateur_id INT NOT NULL REFERENCES utilisateurs(id),
    contenu JSONB NOT NULL,
    valeurs_avant JSONB,
    valeurs_relues JSONB,
    statut statut_commande_enum NOT NULL DEFAULT 'en_attente',
    id_commande_fsolar TEXT,
    erreur TEXT,
    motif TEXT,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    envoyee_le TIMESTAMPTZ,
    verifiee_le TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_commandes_sn ON commandes(device_sn, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_commandes_statut ON commandes(statut);

-- ============================================================
-- Journal de la collecte (santé de la synchronisation)
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_collecte (
    id BIGSERIAL PRIMARY KEY,
    tache TEXT NOT NULL,
    debut TIMESTAMPTZ NOT NULL,
    fin TIMESTAMPTZ,
    succes BOOLEAN,
    nb_elements INT,
    erreur TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_collecte ON journal_collecte(tache, debut DESC);
