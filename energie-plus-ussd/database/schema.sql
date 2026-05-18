-- ============================================================
-- ENERGIE PLUS - Schéma PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Types énumérés
CREATE TYPE profil_enum AS ENUM ('pompiste', 'gerant', 'admin');
CREATE TYPE statut_carte_enum AS ENUM ('actif', 'bloque', 'expire', 'opposition');
CREATE TYPE type_bon_enum AS ENUM ('fixe', 'variable');
CREATE TYPE statut_bon_enum AS ENUM ('actif', 'consomme', 'expire', 'annule');
CREATE TYPE type_transaction_enum AS ENUM ('carte', 'bon');
CREATE TYPE statut_transaction_enum AS ENUM ('validee', 'annulee');
CREATE TYPE canal_enum AS ENUM ('ussd', 'app', 'backoffice');

-- ============================================================
-- TABLE: stations
-- ============================================================
CREATE TABLE stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom VARCHAR(100) NOT NULL,
    code VARCHAR(10) UNIQUE NOT NULL,
    ville VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    modifie_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: utilisateurs
-- ============================================================
CREATE TABLE utilisateurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telephone VARCHAR(20) UNIQUE NOT NULL,
    pin_hash VARCHAR(255) NOT NULL,
    profil profil_enum NOT NULL DEFAULT 'pompiste',
    station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
    actif BOOLEAN NOT NULL DEFAULT true,
    tentatives_pin INT NOT NULL DEFAULT 0,
    bloque BOOLEAN NOT NULL DEFAULT false,
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    modifie_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: entreprises
-- ============================================================
CREATE TABLE entreprises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom VARCHAR(150) NOT NULL,
    telephone VARCHAR(20),
    email VARCHAR(150),
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: cartes
-- ============================================================
CREATE TABLE cartes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(10) UNIQUE NOT NULL,
    titulaire_nom VARCHAR(150) NOT NULL,
    titulaire_telephone VARCHAR(20),
    solde DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    plafond_journalier DECIMAL(15,2) NOT NULL DEFAULT 50000.00,
    plafond_hebdomadaire DECIMAL(15,2) NOT NULL DEFAULT 200000.00,
    plafond_mensuel DECIMAL(15,2) NOT NULL DEFAULT 500000.00,
    statut statut_carte_enum NOT NULL DEFAULT 'actif',
    date_expiration DATE,
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: bons
-- ============================================================
CREATE TABLE bons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(20) UNIQUE NOT NULL,
    entreprise_id UUID REFERENCES entreprises(id) ON DELETE SET NULL,
    montant DECIMAL(15,2),
    type type_bon_enum NOT NULL DEFAULT 'fixe',
    montant_max DECIMAL(15,2),
    statut statut_bon_enum NOT NULL DEFAULT 'actif',
    date_expiration DATE,
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    consomme_le TIMESTAMP WITH TIME ZONE
);

-- ============================================================
-- TABLE: transactions
-- ============================================================
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_confirmation VARCHAR(6) UNIQUE NOT NULL,
    type type_transaction_enum NOT NULL,
    reference_id UUID NOT NULL,
    montant DECIMAL(15,2) NOT NULL,
    station_id UUID NOT NULL REFERENCES stations(id),
    operateur_id UUID NOT NULL REFERENCES utilisateurs(id),
    statut statut_transaction_enum NOT NULL DEFAULT 'validee',
    canal canal_enum NOT NULL DEFAULT 'ussd',
    prix_litre DECIMAL(10,4),
    litres DECIMAL(10,4),
    annulee_le TIMESTAMP WITH TIME ZONE,
    annulee_par UUID REFERENCES utilisateurs(id),
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: prix_carburant
-- ============================================================
CREATE TABLE prix_carburant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_carburant VARCHAR(30) NOT NULL DEFAULT 'essence',
    prix_litre DECIMAL(10,4) NOT NULL,
    effectif_le DATE NOT NULL DEFAULT CURRENT_DATE,
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: clotures
-- ============================================================
CREATE TABLE clotures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id),
    gerant_id UUID NOT NULL REFERENCES utilisateurs(id),
    date_cloture DATE NOT NULL,
    nb_transactions INT NOT NULL DEFAULT 0,
    total_cartes DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_bons DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_general DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(station_id, date_cloture)
);

-- ============================================================
-- TABLE: journal_audit
-- ============================================================
CREATE TABLE journal_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    cree_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX idx_utilisateurs_telephone ON utilisateurs(telephone);
CREATE INDEX idx_cartes_numero ON cartes(numero);
CREATE INDEX idx_bons_numero ON bons(numero);
CREATE INDEX idx_transactions_code ON transactions(code_confirmation);
CREATE INDEX idx_transactions_station_cree ON transactions(station_id, cree_le);
CREATE INDEX idx_transactions_reference_id ON transactions(reference_id);
CREATE INDEX idx_transactions_operateur ON transactions(operateur_id);
CREATE INDEX idx_journal_audit_utilisateur ON journal_audit(utilisateur_id);
CREATE INDEX idx_journal_audit_cree ON journal_audit(cree_le);

-- ============================================================
-- DONNÉES DE TEST
-- ============================================================

-- Stations
INSERT INTO stations (id, nom, code, ville, region) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Station Total Niamey Centre', 'STN001', 'Niamey', 'Niamey'),
  ('a1000000-0000-0000-0000-000000000002', 'Station Shell Zinder',        'SHZ002', 'Zinder',  'Zinder');

-- Utilisateurs
-- PIN "1234" haché avec bcrypt (cost 10) — pré-haché pour seed reproductible
-- Valeur: $2b$10$XURPShQNCsLjp1ESc2laoObo9QZDhxz7bPxDam5rWDIqz8HMKN3dW
INSERT INTO utilisateurs (id, telephone, pin_hash, profil, station_id) VALUES
  (
    'b1000000-0000-0000-0000-000000000001',
    '+22790000001',
    '$2b$10$XURPShQNCsLjp1ESc2laoObo9QZDhxz7bPxDam5rWDIqz8HMKN3dW',
    'admin',
    NULL
  ),
  (
    'b1000000-0000-0000-0000-000000000002',
    '+22790000002',
    '$2b$10$XURPShQNCsLjp1ESc2laoObo9QZDhxz7bPxDam5rWDIqz8HMKN3dW',
    'gerant',
    'a1000000-0000-0000-0000-000000000001'
  ),
  (
    'b1000000-0000-0000-0000-000000000003',
    '+22790000003',
    '$2b$10$XURPShQNCsLjp1ESc2laoObo9QZDhxz7bPxDam5rWDIqz8HMKN3dW',
    'pompiste',
    'a1000000-0000-0000-0000-000000000001'
  );

-- Entreprises
INSERT INTO entreprises (id, nom, telephone, email) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'SONIDEP SA',   '+22720000001', 'contact@sonidep.ne'),
  ('c1000000-0000-0000-0000-000000000002', 'Niger Telecom', '+22720000002', 'contact@nigertel.ne');

-- Cartes actives avec solde
INSERT INTO cartes (id, numero, titulaire_nom, titulaire_telephone, solde, plafond_journalier, plafond_hebdomadaire, plafond_mensuel, statut, date_expiration) VALUES
  (
    'd1000000-0000-0000-0000-000000000001',
    '1234567890',
    'Ibrahim Mahamane',
    '+22797000001',
    250000.00,
    50000.00,
    200000.00,
    500000.00,
    'actif',
    '2027-12-31'
  ),
  (
    'd1000000-0000-0000-0000-000000000002',
    '0987654321',
    'Fatima Oumarou',
    '+22797000002',
    100000.00,
    30000.00,
    150000.00,
    400000.00,
    'actif',
    '2027-06-30'
  );

-- Bons
INSERT INTO bons (id, numero, entreprise_id, montant, type, montant_max, statut, date_expiration) VALUES
  (
    'e1000000-0000-0000-0000-000000000001',
    'BON-2026-00001',
    'c1000000-0000-0000-0000-000000000001',
    15000.00,
    'fixe',
    NULL,
    'actif',
    '2026-12-31'
  ),
  (
    'e1000000-0000-0000-0000-000000000002',
    'BON-2026-00002',
    'c1000000-0000-0000-0000-000000000002',
    NULL,
    'variable',
    25000.00,
    'actif',
    '2026-12-31'
  );

-- Prix carburant
INSERT INTO prix_carburant (type_carburant, prix_litre, effectif_le) VALUES
  ('essence', 625.00, '2026-01-01'),
  ('gasoil',  595.00, '2026-01-01');
