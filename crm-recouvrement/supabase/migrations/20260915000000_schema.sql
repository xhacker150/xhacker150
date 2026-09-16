-- ============================================================
-- CRM RECOUVREMENT - Migration Supabase (PostgreSQL 17)
-- Facturation, suivi de créances et recouvrement automatisé
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- Types énumérés
-- ------------------------------------------------------------
CREATE TYPE role_enum AS ENUM ('admin', 'gestionnaire', 'agent');
CREATE TYPE type_client_enum AS ENUM ('entreprise', 'particulier', 'administration');
CREATE TYPE statut_client_enum AS ENUM ('actif', 'surveille', 'bloque', 'contentieux', 'inactif');
CREATE TYPE statut_facture_enum AS ENUM ('brouillon', 'emise', 'partiellement_payee', 'payee', 'annulee');
CREATE TYPE mode_reglement_enum AS ENUM ('especes', 'virement', 'cheque', 'mobile_money', 'carte', 'compensation', 'autre');
CREATE TYPE canal_relance_enum AS ENUM ('email', 'sms', 'appel', 'courrier', 'visite', 'mise_en_demeure', 'contentieux');
CREATE TYPE type_action_enum AS ENUM ('relance', 'appel', 'email', 'sms', 'courrier', 'visite', 'promesse', 'litige', 'mise_en_demeure', 'contentieux', 'note');
CREATE TYPE statut_action_enum AS ENUM ('planifiee', 'effectuee', 'annulee');
CREATE TYPE statut_promesse_enum AS ENUM ('en_attente', 'tenue', 'rompue', 'annulee');
CREATE TYPE statut_litige_enum AS ENUM ('ouvert', 'resolu', 'rejete');

-- ------------------------------------------------------------
-- Utilitaires
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maj_modifie_le() RETURNS TRIGGER AS $$
BEGIN
    NEW.modifie_le = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- TABLE: profils (liée à auth.users)
-- ------------------------------------------------------------
CREATE TABLE profils (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(150) NOT NULL,
    nom VARCHAR(150) NOT NULL,
    role role_enum NOT NULL DEFAULT 'agent',
    telephone VARCHAR(30),
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_profils_maj BEFORE UPDATE ON profils FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

-- Création automatique du profil à l'inscription ; le premier utilisateur devient admin
CREATE OR REPLACE FUNCTION creer_profil_utilisateur() RETURNS TRIGGER
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role role_enum := 'agent';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profils) THEN
        v_role := 'admin';
    END IF;
    INSERT INTO profils (id, email, nom, role)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1)), v_role)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_auth_user_profil AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION creer_profil_utilisateur();

CREATE OR REPLACE FUNCTION role_courant() RETURNS role_enum
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role FROM profils WHERE id = auth.uid() AND actif = true;
$$;

CREATE OR REPLACE FUNCTION est_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT role_courant() = 'admin'; $$;

CREATE OR REPLACE FUNCTION est_gestionnaire() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT role_courant() IN ('admin', 'gestionnaire'); $$;

-- ------------------------------------------------------------
-- TABLE: parametres
-- ------------------------------------------------------------
CREATE TABLE parametres (
    cle VARCHAR(60) PRIMARY KEY,
    valeur JSONB NOT NULL,
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION parametre(p_cle VARCHAR) RETURNS JSONB
LANGUAGE sql STABLE AS $$ SELECT valeur FROM parametres WHERE cle = p_cle; $$;

-- ------------------------------------------------------------
-- TABLE: compteurs (numérotation des pièces)
-- ------------------------------------------------------------
CREATE TABLE compteurs (
    prefixe VARCHAR(10) NOT NULL,
    annee INT NOT NULL,
    valeur INT NOT NULL DEFAULT 0,
    PRIMARY KEY (prefixe, annee)
);

CREATE OR REPLACE FUNCTION prochain_numero(p_prefixe VARCHAR, p_date DATE DEFAULT CURRENT_DATE)
RETURNS VARCHAR AS $$
DECLARE
    v_annee INT := EXTRACT(YEAR FROM p_date)::INT;
    v_valeur INT;
BEGIN
    INSERT INTO compteurs (prefixe, annee, valeur) VALUES (p_prefixe, v_annee, 1)
    ON CONFLICT (prefixe, annee) DO UPDATE SET valeur = compteurs.valeur + 1
    RETURNING valeur INTO v_valeur;
    RETURN p_prefixe || '-' || v_annee || '-' || LPAD(v_valeur::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- TABLE: scenarios_relance / etapes_relance
-- ------------------------------------------------------------
CREATE TABLE scenarios_relance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom VARCHAR(100) NOT NULL,
    description TEXT,
    par_defaut BOOLEAN NOT NULL DEFAULT false,
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_scenario_defaut ON scenarios_relance (par_defaut) WHERE par_defaut = true;
CREATE TRIGGER trg_scenarios_maj BEFORE UPDATE ON scenarios_relance FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

CREATE TABLE etapes_relance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID NOT NULL REFERENCES scenarios_relance(id) ON DELETE CASCADE,
    niveau INT NOT NULL CHECK (niveau > 0),
    libelle VARCHAR(100) NOT NULL,
    jours_apres_echeance INT NOT NULL CHECK (jours_apres_echeance >= -60),
    canal canal_relance_enum NOT NULL DEFAULT 'email',
    automatique BOOLEAN NOT NULL DEFAULT true,
    modele_sujet VARCHAR(200),
    modele_corps TEXT,
    bloquer_client BOOLEAN NOT NULL DEFAULT false,
    passer_en_contentieux BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (scenario_id, niveau)
);

-- ------------------------------------------------------------
-- TABLE: clients
-- ------------------------------------------------------------
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    raison_sociale VARCHAR(200) NOT NULL,
    type type_client_enum NOT NULL DEFAULT 'entreprise',
    nif VARCHAR(50),
    rccm VARCHAR(50),
    adresse TEXT,
    ville VARCHAR(100),
    pays VARCHAR(100) DEFAULT 'Niger',
    telephone VARCHAR(30),
    email VARCHAR(150),
    contact_nom VARCHAR(150),
    contact_fonction VARCHAR(100),
    delai_paiement_jours INT NOT NULL DEFAULT 30 CHECK (delai_paiement_jours >= 0),
    plafond_credit DECIMAL(15,2) NOT NULL DEFAULT 0,
    statut statut_client_enum NOT NULL DEFAULT 'actif',
    scenario_id UUID REFERENCES scenarios_relance(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES profils(id) ON DELETE SET NULL,
    reference_sage VARCHAR(50),
    notes TEXT,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_raison ON clients (lower(raison_sociale));
CREATE INDEX idx_clients_statut ON clients (statut);
CREATE UNIQUE INDEX idx_clients_ref_sage ON clients (reference_sage) WHERE reference_sage IS NOT NULL;
CREATE TRIGGER trg_clients_maj BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

-- ------------------------------------------------------------
-- TABLE: factures / lignes_facture
-- ------------------------------------------------------------
CREATE TABLE factures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(30) UNIQUE NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    date_facture DATE NOT NULL DEFAULT CURRENT_DATE,
    date_echeance DATE NOT NULL,
    reference_externe VARCHAR(50),
    objet VARCHAR(255),
    montant_ht DECIMAL(15,2) NOT NULL DEFAULT 0,
    montant_tva DECIMAL(15,2) NOT NULL DEFAULT 0,
    montant_ttc DECIMAL(15,2) NOT NULL DEFAULT 0,
    montant_regle DECIMAL(15,2) NOT NULL DEFAULT 0,
    statut statut_facture_enum NOT NULL DEFAULT 'brouillon',
    niveau_relance INT NOT NULL DEFAULT 0,
    derniere_relance_le DATE,
    relances_suspendues BOOLEAN NOT NULL DEFAULT false,
    litige BOOLEAN NOT NULL DEFAULT false,
    date_paiement DATE,
    notes TEXT,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (date_echeance >= date_facture),
    CHECK (montant_regle >= 0)
);
CREATE INDEX idx_factures_client ON factures (client_id);
CREATE INDEX idx_factures_statut ON factures (statut);
CREATE INDEX idx_factures_echeance ON factures (date_echeance);
CREATE UNIQUE INDEX idx_factures_ref_externe ON factures (reference_externe) WHERE reference_externe IS NOT NULL;
CREATE TRIGGER trg_factures_maj BEFORE UPDATE ON factures FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

CREATE TABLE lignes_facture (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facture_id UUID NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
    ordre INT NOT NULL DEFAULT 1,
    designation VARCHAR(255) NOT NULL,
    quantite DECIMAL(12,3) NOT NULL DEFAULT 1 CHECK (quantite > 0),
    prix_unitaire DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (prix_unitaire >= 0),
    taux_tva DECIMAL(5,2) NOT NULL DEFAULT 19 CHECK (taux_tva >= 0),
    montant_ht DECIMAL(15,2) NOT NULL DEFAULT 0,
    montant_tva DECIMAL(15,2) NOT NULL DEFAULT 0,
    montant_ttc DECIMAL(15,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_lignes_facture ON lignes_facture (facture_id);

-- ------------------------------------------------------------
-- TABLE: reglements / lettrages
-- ------------------------------------------------------------
CREATE TABLE reglements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(30) UNIQUE NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    date_reglement DATE NOT NULL DEFAULT CURRENT_DATE,
    montant DECIMAL(15,2) NOT NULL CHECK (montant > 0),
    mode mode_reglement_enum NOT NULL DEFAULT 'virement',
    reference VARCHAR(100),
    banque VARCHAR(100),
    annule BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reglements_client ON reglements (client_id);
CREATE INDEX idx_reglements_date ON reglements (date_reglement);

CREATE TABLE lettrages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reglement_id UUID NOT NULL REFERENCES reglements(id) ON DELETE CASCADE,
    facture_id UUID NOT NULL REFERENCES factures(id) ON DELETE RESTRICT,
    montant DECIMAL(15,2) NOT NULL CHECK (montant > 0),
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lettrages_facture ON lettrages (facture_id);
CREATE INDEX idx_lettrages_reglement ON lettrages (reglement_id);

CREATE OR REPLACE FUNCTION recalculer_facture(p_facture_id UUID) RETURNS VOID AS $$
DECLARE
    v_regle DECIMAL(15,2);
    v_ttc DECIMAL(15,2);
    v_statut statut_facture_enum;
    v_date_paiement DATE;
BEGIN
    SELECT COALESCE(SUM(l.montant), 0), MAX(r.date_reglement)
      INTO v_regle, v_date_paiement
      FROM lettrages l JOIN reglements r ON r.id = l.reglement_id
     WHERE l.facture_id = p_facture_id AND r.annule = false;

    SELECT montant_ttc, statut INTO v_ttc, v_statut FROM factures WHERE id = p_facture_id;

    IF v_statut IN ('brouillon', 'annulee') THEN
        UPDATE factures SET montant_regle = v_regle WHERE id = p_facture_id;
        RETURN;
    END IF;

    IF v_regle >= v_ttc AND v_ttc > 0 THEN
        v_statut := 'payee';
    ELSIF v_regle > 0 THEN
        v_statut := 'partiellement_payee';
        v_date_paiement := NULL;
    ELSE
        v_statut := 'emise';
        v_date_paiement := NULL;
    END IF;

    UPDATE factures SET montant_regle = v_regle, statut = v_statut, date_paiement = v_date_paiement
     WHERE id = p_facture_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_lettrage_recalcul() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recalculer_facture(OLD.facture_id);
        RETURN OLD;
    END IF;
    PERFORM recalculer_facture(NEW.facture_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_lettrages_recalcul AFTER INSERT OR UPDATE OR DELETE ON lettrages
    FOR EACH ROW EXECUTE FUNCTION trg_lettrage_recalcul();

CREATE OR REPLACE FUNCTION trg_reglement_annule() RETURNS TRIGGER AS $$
DECLARE r RECORD;
BEGIN
    IF NEW.annule IS DISTINCT FROM OLD.annule THEN
        FOR r IN SELECT DISTINCT facture_id FROM lettrages WHERE reglement_id = NEW.id LOOP
            PERFORM recalculer_facture(r.facture_id);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_reglements_annule AFTER UPDATE ON reglements
    FOR EACH ROW EXECUTE FUNCTION trg_reglement_annule();

-- ------------------------------------------------------------
-- TABLE: actions_recouvrement / promesses_paiement / litiges
-- ------------------------------------------------------------
CREATE TABLE actions_recouvrement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    facture_id UUID REFERENCES factures(id) ON DELETE SET NULL,
    etape_id UUID REFERENCES etapes_relance(id) ON DELETE SET NULL,
    niveau INT,
    type type_action_enum NOT NULL DEFAULT 'note',
    canal canal_relance_enum,
    statut statut_action_enum NOT NULL DEFAULT 'planifiee',
    automatique BOOLEAN NOT NULL DEFAULT false,
    date_prevue DATE NOT NULL DEFAULT CURRENT_DATE,
    date_effectuee TIMESTAMPTZ,
    sujet VARCHAR(255),
    contenu TEXT,
    resultat TEXT,
    agent_id UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_actions_client ON actions_recouvrement (client_id);
CREATE INDEX idx_actions_facture ON actions_recouvrement (facture_id);
CREATE INDEX idx_actions_statut_date ON actions_recouvrement (statut, date_prevue);
CREATE TRIGGER trg_actions_maj BEFORE UPDATE ON actions_recouvrement FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

CREATE TABLE promesses_paiement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    facture_id UUID REFERENCES factures(id) ON DELETE SET NULL,
    action_id UUID REFERENCES actions_recouvrement(id) ON DELETE SET NULL,
    montant DECIMAL(15,2) NOT NULL CHECK (montant > 0),
    date_promise DATE NOT NULL,
    statut statut_promesse_enum NOT NULL DEFAULT 'en_attente',
    commentaire TEXT,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_promesses_statut_date ON promesses_paiement (statut, date_promise);
CREATE TRIGGER trg_promesses_maj BEFORE UPDATE ON promesses_paiement FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

CREATE TABLE litiges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facture_id UUID NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    motif TEXT NOT NULL,
    statut statut_litige_enum NOT NULL DEFAULT 'ouvert',
    resolution TEXT,
    ouvert_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    ouvert_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolu_le TIMESTAMPTZ
);
CREATE INDEX idx_litiges_facture ON litiges (facture_id);

CREATE OR REPLACE FUNCTION trg_litige_facture() RETURNS TRIGGER AS $$
DECLARE v_facture UUID := COALESCE(NEW.facture_id, OLD.facture_id);
BEGIN
    UPDATE factures SET litige = EXISTS (SELECT 1 FROM litiges WHERE facture_id = v_facture AND statut = 'ouvert')
     WHERE id = v_facture;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_litiges_facture AFTER INSERT OR UPDATE OR DELETE ON litiges
    FOR EACH ROW EXECUTE FUNCTION trg_litige_facture();

-- ------------------------------------------------------------
-- TABLE: imports_sage / journal_audit
-- ------------------------------------------------------------
CREATE TABLE imports_sage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL,
    nom_fichier VARCHAR(255),
    nb_lignes INT NOT NULL DEFAULT 0,
    nb_importees INT NOT NULL DEFAULT 0,
    nb_ignorees INT NOT NULL DEFAULT 0,
    erreurs JSONB NOT NULL DEFAULT '[]'::jsonb,
    utilisateur_id UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journal_audit (
    id BIGSERIAL PRIMARY KEY,
    utilisateur_id UUID REFERENCES profils(id) ON DELETE SET NULL,
    entite VARCHAR(40) NOT NULL,
    entite_id UUID,
    action VARCHAR(40) NOT NULL,
    details JSONB,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entite ON journal_audit (entite, entite_id);

-- ------------------------------------------------------------
-- VUES
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW vue_factures WITH (security_invoker = true) AS
SELECT f.*,
       c.code AS client_code,
       c.raison_sociale AS client_nom,
       c.statut AS client_statut,
       (f.montant_ttc - f.montant_regle) AS reste_a_payer,
       CASE WHEN f.statut IN ('emise', 'partiellement_payee') AND f.date_echeance < CURRENT_DATE
            THEN (CURRENT_DATE - f.date_echeance) ELSE 0 END AS jours_retard,
       (f.statut IN ('emise', 'partiellement_payee') AND f.date_echeance < CURRENT_DATE) AS en_retard,
       CASE
           WHEN f.statut NOT IN ('emise', 'partiellement_payee') THEN NULL
           WHEN f.date_echeance >= CURRENT_DATE THEN 'non_echu'
           WHEN CURRENT_DATE - f.date_echeance <= 30 THEN '0_30'
           WHEN CURRENT_DATE - f.date_echeance <= 60 THEN '31_60'
           WHEN CURRENT_DATE - f.date_echeance <= 90 THEN '61_90'
           WHEN CURRENT_DATE - f.date_echeance <= 120 THEN '91_120'
           ELSE 'plus_120'
       END AS tranche_age
FROM factures f
JOIN clients c ON c.id = f.client_id;

CREATE OR REPLACE VIEW vue_balance_agee WITH (security_invoker = true) AS
SELECT c.id AS client_id,
       c.code,
       c.raison_sociale,
       c.statut,
       c.plafond_credit,
       c.telephone,
       c.email,
       COUNT(f.id) FILTER (WHERE f.statut IN ('emise', 'partiellement_payee')) AS nb_factures_ouvertes,
       COALESCE(SUM(f.reste_a_payer) FILTER (WHERE f.statut IN ('emise', 'partiellement_payee')), 0) AS encours_total,
       COALESCE(SUM(f.reste_a_payer) FILTER (WHERE f.tranche_age = 'non_echu'), 0) AS non_echu,
       COALESCE(SUM(f.reste_a_payer) FILTER (WHERE f.tranche_age = '0_30'), 0) AS t_0_30,
       COALESCE(SUM(f.reste_a_payer) FILTER (WHERE f.tranche_age = '31_60'), 0) AS t_31_60,
       COALESCE(SUM(f.reste_a_payer) FILTER (WHERE f.tranche_age = '61_90'), 0) AS t_61_90,
       COALESCE(SUM(f.reste_a_payer) FILTER (WHERE f.tranche_age = '91_120'), 0) AS t_91_120,
       COALESCE(SUM(f.reste_a_payer) FILTER (WHERE f.tranche_age = 'plus_120'), 0) AS t_plus_120,
       COALESCE(SUM(f.reste_a_payer) FILTER (WHERE f.en_retard), 0) AS echu_total,
       COALESCE(MAX(f.jours_retard), 0) AS retard_max_jours
FROM clients c
LEFT JOIN vue_factures f ON f.client_id = c.id
GROUP BY c.id, c.code, c.raison_sociale, c.statut, c.plafond_credit, c.telephone, c.email;

-- ------------------------------------------------------------
-- FONCTIONS MÉTIER (appelées via supabase.rpc)
-- ------------------------------------------------------------

-- Création d'une facture avec ses lignes. p_lignes : [{designation, quantite, prix_unitaire, taux_tva}]
CREATE OR REPLACE FUNCTION creer_facture(
    p_client_id UUID,
    p_lignes JSONB,
    p_date_facture DATE DEFAULT CURRENT_DATE,
    p_date_echeance DATE DEFAULT NULL,
    p_objet VARCHAR DEFAULT NULL,
    p_reference_externe VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_emettre BOOLEAN DEFAULT false
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_id UUID;
    v_numero VARCHAR;
    v_echeance DATE;
    v_delai INT;
    v_prefixe VARCHAR := COALESCE(parametre('facturation')->>'prefixe_facture', 'FAC');
    v_ligne JSONB;
    v_ordre INT := 0;
    v_qte DECIMAL(12,3);
    v_pu DECIMAL(15,2);
    v_taux DECIMAL(5,2);
    v_ht DECIMAL(15,2);
    v_tva DECIMAL(15,2);
    v_tot_ht DECIMAL(15,2) := 0;
    v_tot_tva DECIMAL(15,2) := 0;
BEGIN
    IF p_lignes IS NULL OR jsonb_array_length(p_lignes) = 0 THEN
        RAISE EXCEPTION 'Une facture doit comporter au moins une ligne';
    END IF;

    SELECT delai_paiement_jours INTO v_delai FROM clients WHERE id = p_client_id;
    IF v_delai IS NULL THEN
        RAISE EXCEPTION 'Client introuvable';
    END IF;
    v_echeance := COALESCE(p_date_echeance, p_date_facture + v_delai);
    v_numero := prochain_numero(v_prefixe, p_date_facture);

    INSERT INTO factures (numero, client_id, date_facture, date_echeance, objet, reference_externe, notes, cree_par)
    VALUES (v_numero, p_client_id, p_date_facture, v_echeance, p_objet, NULLIF(p_reference_externe, ''), p_notes, auth.uid())
    RETURNING id INTO v_id;

    FOR v_ligne IN SELECT * FROM jsonb_array_elements(p_lignes) LOOP
        v_ordre := v_ordre + 1;
        v_qte := COALESCE((v_ligne->>'quantite')::DECIMAL, 1);
        v_pu := COALESCE((v_ligne->>'prix_unitaire')::DECIMAL, 0);
        v_taux := COALESCE((v_ligne->>'taux_tva')::DECIMAL, (parametre('facturation')->>'taux_tva_defaut')::DECIMAL, 0);
        v_ht := ROUND(v_qte * v_pu, 2);
        v_tva := ROUND(v_ht * v_taux / 100, 2);
        INSERT INTO lignes_facture (facture_id, ordre, designation, quantite, prix_unitaire, taux_tva, montant_ht, montant_tva, montant_ttc)
        VALUES (v_id, v_ordre, COALESCE(v_ligne->>'designation', 'Prestation'), v_qte, v_pu, v_taux, v_ht, v_tva, v_ht + v_tva);
        v_tot_ht := v_tot_ht + v_ht;
        v_tot_tva := v_tot_tva + v_tva;
    END LOOP;

    UPDATE factures SET montant_ht = v_tot_ht, montant_tva = v_tot_tva, montant_ttc = v_tot_ht + v_tot_tva
     WHERE id = v_id;

    IF p_emettre THEN
        PERFORM emettre_facture(v_id);
    END IF;

    INSERT INTO journal_audit (utilisateur_id, entite, entite_id, action, details)
    VALUES (auth.uid(), 'facture', v_id, 'creation', jsonb_build_object('numero', v_numero, 'ttc', v_tot_ht + v_tot_tva));
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION emettre_facture(p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_statut statut_facture_enum; v_ttc DECIMAL(15,2);
BEGIN
    SELECT statut, montant_ttc INTO v_statut, v_ttc FROM factures WHERE id = p_id;
    IF v_statut IS NULL THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
    IF v_statut <> 'brouillon' THEN RAISE EXCEPTION 'Seule une facture en brouillon peut être émise'; END IF;
    IF v_ttc <= 0 THEN RAISE EXCEPTION 'Le montant de la facture doit être positif'; END IF;
    UPDATE factures SET statut = 'emise' WHERE id = p_id;
    PERFORM recalculer_facture(p_id);
    INSERT INTO journal_audit (utilisateur_id, entite, entite_id, action) VALUES (auth.uid(), 'facture', p_id, 'emission');
END;
$$;

CREATE OR REPLACE FUNCTION annuler_facture(p_id UUID, p_motif TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_regle DECIMAL(15,2);
BEGIN
    SELECT montant_regle INTO v_regle FROM factures WHERE id = p_id;
    IF v_regle IS NULL THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
    IF v_regle > 0 THEN RAISE EXCEPTION 'Impossible d''annuler une facture partiellement ou totalement réglée'; END IF;
    UPDATE factures SET statut = 'annulee', notes = CONCAT_WS(E'\n', notes, 'Annulée : ' || COALESCE(p_motif, 'sans motif')) WHERE id = p_id;
    UPDATE actions_recouvrement SET statut = 'annulee' WHERE facture_id = p_id AND statut = 'planifiee';
    INSERT INTO journal_audit (utilisateur_id, entite, entite_id, action, details) VALUES (auth.uid(), 'facture', p_id, 'annulation', jsonb_build_object('motif', p_motif));
END;
$$;

-- Enregistre un règlement et le lettre. p_lettrages : [{facture_id, montant}] ou NULL pour un lettrage FIFO automatique
CREATE OR REPLACE FUNCTION enregistrer_reglement(
    p_client_id UUID,
    p_montant DECIMAL,
    p_date_reglement DATE DEFAULT CURRENT_DATE,
    p_mode mode_reglement_enum DEFAULT 'virement',
    p_reference VARCHAR DEFAULT NULL,
    p_banque VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_lettrages JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_id UUID;
    v_numero VARCHAR;
    v_reste DECIMAL(15,2) := p_montant;
    v_aff DECIMAL(15,2);
    v_l JSONB;
    v_facture RECORD;
    v_prefixe VARCHAR := COALESCE(parametre('facturation')->>'prefixe_reglement', 'REG');
BEGIN
    IF p_montant IS NULL OR p_montant <= 0 THEN RAISE EXCEPTION 'Le montant du règlement doit être positif'; END IF;
    v_numero := prochain_numero(v_prefixe, p_date_reglement);

    INSERT INTO reglements (numero, client_id, date_reglement, montant, mode, reference, banque, notes, cree_par)
    VALUES (v_numero, p_client_id, p_date_reglement, p_montant, p_mode, p_reference, p_banque, p_notes, auth.uid())
    RETURNING id INTO v_id;

    IF p_lettrages IS NOT NULL AND jsonb_array_length(p_lettrages) > 0 THEN
        FOR v_l IN SELECT * FROM jsonb_array_elements(p_lettrages) LOOP
            SELECT id, client_id, montant_ttc - montant_regle AS reste, statut INTO v_facture
              FROM factures WHERE id = (v_l->>'facture_id')::UUID FOR UPDATE;
            IF v_facture.id IS NULL THEN RAISE EXCEPTION 'Facture % introuvable', v_l->>'facture_id'; END IF;
            IF v_facture.client_id <> p_client_id THEN RAISE EXCEPTION 'La facture n''appartient pas à ce client'; END IF;
            IF v_facture.statut NOT IN ('emise', 'partiellement_payee') THEN RAISE EXCEPTION 'La facture ne peut pas être lettrée (statut %)', v_facture.statut; END IF;
            v_aff := LEAST((v_l->>'montant')::DECIMAL, v_facture.reste, v_reste);
            IF v_aff > 0 THEN
                INSERT INTO lettrages (reglement_id, facture_id, montant) VALUES (v_id, v_facture.id, v_aff);
                v_reste := v_reste - v_aff;
            END IF;
        END LOOP;
    ELSE
        -- Lettrage automatique : les factures les plus anciennes d'abord
        FOR v_facture IN
            SELECT id, montant_ttc - montant_regle AS reste FROM factures
             WHERE client_id = p_client_id AND statut IN ('emise', 'partiellement_payee')
             ORDER BY date_echeance, date_facture, numero
             FOR UPDATE
        LOOP
            EXIT WHEN v_reste <= 0;
            v_aff := LEAST(v_facture.reste, v_reste);
            IF v_aff > 0 THEN
                INSERT INTO lettrages (reglement_id, facture_id, montant) VALUES (v_id, v_facture.id, v_aff);
                v_reste := v_reste - v_aff;
            END IF;
        END LOOP;
    END IF;

    -- Promesses de paiement honorées
    UPDATE promesses_paiement SET statut = 'tenue'
     WHERE client_id = p_client_id AND statut = 'en_attente' AND montant <= p_montant AND date_promise >= p_date_reglement - 7;

    -- Un client bloqué qui n'a plus d'échu est réactivé
    UPDATE clients SET statut = 'actif'
     WHERE id = p_client_id AND statut = 'bloque'
       AND NOT EXISTS (SELECT 1 FROM vue_factures WHERE client_id = p_client_id AND en_retard);

    INSERT INTO journal_audit (utilisateur_id, entite, entite_id, action, details)
    VALUES (auth.uid(), 'reglement', v_id, 'creation', jsonb_build_object('numero', v_numero, 'montant', p_montant, 'non_lettre', v_reste));
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION annuler_reglement(p_id UUID, p_motif TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    UPDATE reglements SET annule = true, notes = CONCAT_WS(E'\n', notes, 'Annulé : ' || COALESCE(p_motif, 'sans motif')) WHERE id = p_id AND annule = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'Règlement introuvable ou déjà annulé'; END IF;
    INSERT INTO journal_audit (utilisateur_id, entite, entite_id, action, details) VALUES (auth.uid(), 'reglement', p_id, 'annulation', jsonb_build_object('motif', p_motif));
END;
$$;

-- Formate un montant à la française (séparateur de milliers : espace)
CREATE OR REPLACE FUNCTION fmt_montant(p NUMERIC) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT replace(to_char(COALESCE(p, 0), 'FM999G999G999G990'), ',', ' '); $$;

-- Remplace les variables {{...}} d'un modèle de relance
CREATE OR REPLACE FUNCTION rendre_modele(p_modele TEXT, p_facture_id UUID, p_date DATE DEFAULT CURRENT_DATE) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE f RECORD; v TEXT := COALESCE(p_modele, ''); v_devise TEXT := COALESCE(parametre('facturation')->>'devise', 'XOF');
BEGIN
    SELECT vf.*, c.telephone AS client_telephone, c.email AS client_email, c.contact_nom
      INTO f FROM vue_factures vf JOIN clients c ON c.id = vf.client_id WHERE vf.id = p_facture_id;
    IF f.id IS NULL THEN RETURN v; END IF;
    v := replace(v, '{{client}}', COALESCE(f.client_nom, ''));
    v := replace(v, '{{contact}}', COALESCE(f.contact_nom, f.client_nom, ''));
    v := replace(v, '{{numero}}', COALESCE(f.numero, ''));
    v := replace(v, '{{reference}}', COALESCE(f.reference_externe, f.numero, ''));
    v := replace(v, '{{montant}}', fmt_montant(f.montant_ttc));
    v := replace(v, '{{reste}}', fmt_montant(f.reste_a_payer));
    v := replace(v, '{{devise}}', v_devise);
    v := replace(v, '{{echeance}}', to_char(f.date_echeance, 'DD/MM/YYYY'));
    v := replace(v, '{{date_facture}}', to_char(f.date_facture, 'DD/MM/YYYY'));
    v := replace(v, '{{jours_retard}}', GREATEST(p_date - f.date_echeance, 0)::TEXT);
    v := replace(v, '{{telephone}}', COALESCE(f.client_telephone, ''));
    v := replace(v, '{{email}}', COALESCE(f.client_email, ''));
    v := replace(v, '{{societe}}', COALESCE(parametre('societe')->>'nom', ''));
    RETURN v;
END;
$$;

-- Moteur de relance : crée l'action de l'étape suivante pour chaque facture éligible
CREATE OR REPLACE FUNCTION generer_relances(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (action_id UUID, facture_numero VARCHAR, client_nom VARCHAR, niveau INT, canal canal_relance_enum, automatique BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    f RECORD;
    e RECORD;
    v_scenario UUID;
    v_defaut UUID;
    v_delai_min INT := COALESCE((parametre('recouvrement')->>'delai_min_entre_relances_jours')::INT, 3);
    v_montant_min DECIMAL := COALESCE((parametre('recouvrement')->>'montant_min_relance')::DECIMAL, 0);
    v_action UUID;
    v_type type_action_enum;
BEGIN
    SELECT id INTO v_defaut FROM scenarios_relance WHERE par_defaut = true AND actif = true LIMIT 1;

    FOR f IN
        SELECT vf.id, vf.numero, vf.client_id, vf.client_nom, vf.date_echeance, vf.niveau_relance, vf.derniere_relance_le,
               vf.reste_a_payer, c.scenario_id, c.statut AS statut_client
          FROM vue_factures vf JOIN clients c ON c.id = vf.client_id
         WHERE vf.statut IN ('emise', 'partiellement_payee')
           AND vf.litige = false
           AND vf.relances_suspendues = false
           AND vf.reste_a_payer > v_montant_min
           AND c.statut NOT IN ('contentieux', 'inactif')
         ORDER BY vf.date_echeance
    LOOP
        v_scenario := COALESCE(f.scenario_id, v_defaut);
        CONTINUE WHEN v_scenario IS NULL;

        -- Étape suivante ; les rappels avant échéance sont ignorés si la facture est déjà échue
        SELECT * INTO e FROM etapes_relance
         WHERE scenario_id = v_scenario AND etapes_relance.niveau > f.niveau_relance
           AND NOT (jours_apres_echeance < 0 AND p_date > f.date_echeance)
         ORDER BY etapes_relance.niveau LIMIT 1;
        CONTINUE WHEN e.id IS NULL;
        CONTINUE WHEN (p_date - f.date_echeance) < e.jours_apres_echeance;
        CONTINUE WHEN f.derniere_relance_le IS NOT NULL AND (p_date - f.derniere_relance_le) < v_delai_min;

        v_type := CASE e.canal
            WHEN 'email' THEN 'email'::type_action_enum
            WHEN 'sms' THEN 'sms'
            WHEN 'appel' THEN 'appel'
            WHEN 'courrier' THEN 'courrier'
            WHEN 'visite' THEN 'visite'
            WHEN 'mise_en_demeure' THEN 'mise_en_demeure'
            WHEN 'contentieux' THEN 'contentieux'
            ELSE 'relance' END;

        INSERT INTO actions_recouvrement (client_id, facture_id, etape_id, niveau, type, canal, statut, automatique, date_prevue, sujet, contenu)
        VALUES (f.client_id, f.id, e.id, e.niveau, v_type, e.canal, 'planifiee', e.automatique, p_date,
                LEFT(rendre_modele(e.modele_sujet, f.id, p_date), 255), rendre_modele(e.modele_corps, f.id, p_date))
        RETURNING id INTO v_action;

        UPDATE factures SET niveau_relance = e.niveau, derniere_relance_le = p_date WHERE id = f.id;

        IF e.passer_en_contentieux THEN
            UPDATE clients SET statut = 'contentieux' WHERE id = f.client_id;
        ELSIF e.bloquer_client AND f.statut_client IN ('actif', 'surveille') THEN
            UPDATE clients SET statut = 'bloque' WHERE id = f.client_id;
        END IF;

        action_id := v_action; facture_numero := f.numero; client_nom := f.client_nom;
        niveau := e.niveau; canal := e.canal; automatique := e.automatique;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- Marque les promesses échues non honorées comme rompues et crée une action de suivi
CREATE OR REPLACE FUNCTION verifier_promesses(p_date DATE DEFAULT CURRENT_DATE) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p RECORD; v_nb INT := 0;
BEGIN
    FOR p IN SELECT * FROM promesses_paiement WHERE statut = 'en_attente' AND date_promise < p_date LOOP
        UPDATE promesses_paiement SET statut = 'rompue' WHERE id = p.id;
        INSERT INTO actions_recouvrement (client_id, facture_id, type, canal, statut, automatique, date_prevue, sujet, contenu)
        VALUES (p.client_id, p.facture_id, 'appel', 'appel', 'planifiee', false, p_date,
                'Promesse de paiement non tenue',
                'La promesse de paiement de ' || fmt_montant(p.montant) || ' prévue le ' || to_char(p.date_promise, 'DD/MM/YYYY') || ' n''a pas été honorée. Recontacter le client.');
        v_nb := v_nb + 1;
    END LOOP;
    RETURN v_nb;
END;
$$;

-- Indicateurs du tableau de bord
CREATE OR REPLACE FUNCTION tableau_de_bord() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v JSONB;
    v_encours DECIMAL; v_echu DECIMAL; v_non_echu DECIMAL;
    v_ca_12m DECIMAL; v_dso NUMERIC;
    v_encaisse_mois DECIMAL; v_facture_mois DECIMAL;
    v_nb_retard INT; v_nb_clients_retard INT;
    v_actions_jour INT; v_actions_retard INT;
    v_promesses_semaine DECIMAL; v_litiges INT;
    v_taux_recouvrement NUMERIC;
BEGIN
    SELECT COALESCE(SUM(reste_a_payer), 0), COALESCE(SUM(reste_a_payer) FILTER (WHERE en_retard), 0),
           COALESCE(SUM(reste_a_payer) FILTER (WHERE NOT en_retard), 0),
           COUNT(*) FILTER (WHERE en_retard), COUNT(DISTINCT client_id) FILTER (WHERE en_retard)
      INTO v_encours, v_echu, v_non_echu, v_nb_retard, v_nb_clients_retard
      FROM vue_factures WHERE statut IN ('emise', 'partiellement_payee');

    SELECT COALESCE(SUM(montant_ttc), 0) INTO v_ca_12m FROM factures
     WHERE statut <> 'annulee' AND statut <> 'brouillon' AND date_facture >= CURRENT_DATE - INTERVAL '12 months';
    v_dso := CASE WHEN v_ca_12m > 0 THEN ROUND(v_encours / v_ca_12m * 365, 0) ELSE 0 END;

    SELECT COALESCE(SUM(montant), 0) INTO v_encaisse_mois FROM reglements
     WHERE annule = false AND date_trunc('month', date_reglement) = date_trunc('month', CURRENT_DATE);
    SELECT COALESCE(SUM(montant_ttc), 0) INTO v_facture_mois FROM factures
     WHERE statut NOT IN ('annulee', 'brouillon') AND date_trunc('month', date_facture) = date_trunc('month', CURRENT_DATE);

    SELECT COUNT(*) FILTER (WHERE date_prevue = CURRENT_DATE), COUNT(*) FILTER (WHERE date_prevue < CURRENT_DATE)
      INTO v_actions_jour, v_actions_retard FROM actions_recouvrement WHERE statut = 'planifiee';

    SELECT COALESCE(SUM(montant), 0) INTO v_promesses_semaine FROM promesses_paiement
     WHERE statut = 'en_attente' AND date_promise BETWEEN CURRENT_DATE AND CURRENT_DATE + 7;

    SELECT COUNT(*) INTO v_litiges FROM litiges WHERE statut = 'ouvert';

    SELECT CASE WHEN SUM(montant_ttc) > 0 THEN ROUND(SUM(montant_regle) / SUM(montant_ttc) * 100, 1) ELSE 0 END
      INTO v_taux_recouvrement FROM factures
     WHERE statut IN ('emise', 'partiellement_payee', 'payee') AND date_echeance < CURRENT_DATE
       AND date_facture >= CURRENT_DATE - INTERVAL '12 months';

    v := jsonb_build_object(
        'encours_total', v_encours,
        'echu_total', v_echu,
        'non_echu_total', v_non_echu,
        'nb_factures_retard', v_nb_retard,
        'nb_clients_retard', v_nb_clients_retard,
        'dso_jours', v_dso,
        'encaisse_mois', v_encaisse_mois,
        'facture_mois', v_facture_mois,
        'actions_du_jour', v_actions_jour,
        'actions_en_retard', v_actions_retard,
        'promesses_semaine', v_promesses_semaine,
        'litiges_ouverts', v_litiges,
        'taux_recouvrement', v_taux_recouvrement,
        'balance_agee', (SELECT jsonb_build_object(
            'non_echu', COALESCE(SUM(non_echu), 0), 't_0_30', COALESCE(SUM(t_0_30), 0), 't_31_60', COALESCE(SUM(t_31_60), 0),
            't_61_90', COALESCE(SUM(t_61_90), 0), 't_91_120', COALESCE(SUM(t_91_120), 0), 't_plus_120', COALESCE(SUM(t_plus_120), 0))
            FROM vue_balance_agee),
        'top_debiteurs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('client_id', client_id, 'code', code, 'raison_sociale', raison_sociale,
                                  'encours_total', encours_total, 'echu_total', echu_total, 'retard_max_jours', retard_max_jours, 'statut', statut)), '[]'::jsonb)
            FROM (SELECT * FROM vue_balance_agee WHERE echu_total > 0 ORDER BY echu_total DESC LIMIT 8) t),
        'encaissements_6_mois', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mois', mois, 'facture', facture, 'encaisse', encaisse) ORDER BY mois), '[]'::jsonb)
            FROM (
                SELECT to_char(m, 'YYYY-MM') AS mois,
                       (SELECT COALESCE(SUM(montant_ttc), 0) FROM factures WHERE statut NOT IN ('annulee', 'brouillon') AND date_trunc('month', date_facture) = m) AS facture,
                       (SELECT COALESCE(SUM(montant), 0) FROM reglements WHERE annule = false AND date_trunc('month', date_reglement) = m) AS encaisse
                  FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '5 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') m
            ) s)
    );
    RETURN v;
END;
$$;

-- Situation complète d'un client
CREATE OR REPLACE FUNCTION situation_client(p_client_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT jsonb_build_object(
        'balance', (SELECT to_jsonb(b) FROM vue_balance_agee b WHERE b.client_id = p_client_id),
        'total_facture', (SELECT COALESCE(SUM(montant_ttc), 0) FROM factures WHERE client_id = p_client_id AND statut NOT IN ('annulee', 'brouillon')),
        'total_regle', (SELECT COALESCE(SUM(montant), 0) FROM reglements WHERE client_id = p_client_id AND annule = false),
        'delai_moyen_paiement', (SELECT ROUND(AVG(date_paiement - date_facture), 0) FROM factures WHERE client_id = p_client_id AND statut = 'payee' AND date_paiement IS NOT NULL),
        'nb_promesses_rompues', (SELECT COUNT(*) FROM promesses_paiement WHERE client_id = p_client_id AND statut = 'rompue')
    );
$$;

-- ------------------------------------------------------------
-- SÉCURITÉ (RLS) : tout utilisateur authentifié et actif accède aux données,
-- les paramètres, scénarios et profils sont réservés aux gestionnaires / admins.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION est_utilisateur_actif() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM profils WHERE id = auth.uid() AND actif = true);
$$;

ALTER TABLE profils ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametres ENABLE ROW LEVEL SECURITY;
ALTER TABLE compteurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios_relance ENABLE ROW LEVEL SECURITY;
ALTER TABLE etapes_relance ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE factures ENABLE ROW LEVEL SECURITY;
ALTER TABLE lignes_facture ENABLE ROW LEVEL SECURITY;
ALTER TABLE reglements ENABLE ROW LEVEL SECURITY;
ALTER TABLE lettrages ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions_recouvrement ENABLE ROW LEVEL SECURITY;
ALTER TABLE promesses_paiement ENABLE ROW LEVEL SECURITY;
ALTER TABLE litiges ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports_sage ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY profils_lecture ON profils FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY profils_maj_soi ON profils FOR UPDATE TO authenticated USING (id = auth.uid() OR est_admin()) WITH CHECK (id = auth.uid() OR est_admin());
CREATE POLICY profils_admin ON profils FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());

CREATE POLICY parametres_lecture ON parametres FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY parametres_ecriture ON parametres FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());

CREATE POLICY compteurs_tous ON compteurs FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());

CREATE POLICY scenarios_lecture ON scenarios_relance FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY scenarios_ecriture ON scenarios_relance FOR ALL TO authenticated USING (est_gestionnaire()) WITH CHECK (est_gestionnaire());
CREATE POLICY etapes_lecture ON etapes_relance FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY etapes_ecriture ON etapes_relance FOR ALL TO authenticated USING (est_gestionnaire()) WITH CHECK (est_gestionnaire());

CREATE POLICY clients_tous ON clients FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY factures_tous ON factures FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY lignes_tous ON lignes_facture FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY reglements_tous ON reglements FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY lettrages_tous ON lettrages FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY actions_tous ON actions_recouvrement FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY promesses_tous ON promesses_paiement FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY litiges_tous ON litiges FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY imports_tous ON imports_sage FOR ALL TO authenticated USING (est_utilisateur_actif()) WITH CHECK (est_utilisateur_actif());
CREATE POLICY audit_lecture ON journal_audit FOR SELECT TO authenticated USING (est_gestionnaire());
CREATE POLICY audit_insertion ON journal_audit FOR INSERT TO authenticated WITH CHECK (est_utilisateur_actif());

-- Les fonctions de traitement planifié ne sont accessibles qu'au service (cron) et aux gestionnaires
REVOKE EXECUTE ON FUNCTION generer_relances(DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION verifier_promesses(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generer_relances(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION verifier_promesses(DATE) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Données de référence
-- ------------------------------------------------------------
INSERT INTO parametres (cle, valeur) VALUES
('societe', '{"nom": "Ma Société", "adresse": "", "ville": "Niamey", "pays": "Niger", "telephone": "", "email": "", "nif": "", "rccm": ""}'),
('facturation', '{"devise": "XOF", "taux_tva_defaut": 19, "delai_paiement_defaut": 30, "prefixe_facture": "FAC", "prefixe_reglement": "REG", "mentions_legales": "Tout retard de paiement entraîne l''application de pénalités conformément à l''Acte uniforme OHADA."}'),
('recouvrement', '{"delai_min_entre_relances_jours": 3, "montant_min_relance": 0, "email_expediteur": ""}');

WITH s AS (
    INSERT INTO scenarios_relance (nom, description, par_defaut)
    VALUES ('Scénario standard', 'Parcours de relance progressif : rappel avant échéance, relances, mise en demeure, contentieux', true)
    RETURNING id
)
INSERT INTO etapes_relance (scenario_id, niveau, libelle, jours_apres_echeance, canal, automatique, modele_sujet, modele_corps, bloquer_client, passer_en_contentieux)
SELECT s.id, e.* FROM s, (VALUES
    (1, 'Rappel avant échéance', -5, 'email'::canal_relance_enum, true,
     'Rappel : facture {{numero}} arrive à échéance le {{echeance}}',
     E'Bonjour {{client}},\n\nNous vous rappelons que la facture {{numero}} d''un montant de {{reste}} {{devise}} arrive à échéance le {{echeance}}.\n\nNous vous remercions de bien vouloir procéder à son règlement.\n\nCordialement,\n{{societe}}', false, false),
    (2, 'Rappel courtois', 3, 'email'::canal_relance_enum, true,
     'Facture {{numero}} échue - rappel',
     E'Bonjour {{client}},\n\nSauf erreur de notre part, la facture {{numero}} d''un montant de {{reste}} {{devise}}, échue le {{echeance}}, reste impayée à ce jour.\n\nNous vous prions de régulariser cette situation dans les meilleurs délais.\n\nCordialement,\n{{societe}}', false, false),
    (3, 'Première relance', 15, 'email'::canal_relance_enum, true,
     'Relance 1 - facture {{numero}} impayée ({{jours_retard}} jours de retard)',
     E'Bonjour {{client}},\n\nMalgré notre précédent rappel, la facture {{numero}} d''un montant de {{reste}} {{devise}} demeure impayée depuis {{jours_retard}} jours.\n\nNous vous demandons de procéder au règlement sous 8 jours.\n\nCordialement,\n{{societe}}', false, false),
    (4, 'Deuxième relance (appel)', 30, 'appel'::canal_relance_enum, false,
     'Appel de relance - facture {{numero}}',
     'Contacter {{client}} au {{telephone}} pour obtenir une date de paiement ferme de la facture {{numero}} ({{reste}} {{devise}}, {{jours_retard}} jours de retard).', false, false),
    (5, 'Mise en demeure', 45, 'mise_en_demeure'::canal_relance_enum, false,
     'MISE EN DEMEURE - facture {{numero}}',
     E'Par la présente, nous vous mettons en demeure de régler la somme de {{reste}} {{devise}} correspondant à la facture {{numero}} échue le {{echeance}}, sous huitaine à compter de la réception de ce courrier.\n\nA défaut, nous engagerons sans autre préavis une procédure d''injonction de payer conformément à l''Acte uniforme OHADA portant organisation des procédures simplifiées de recouvrement et des voies d''exécution.\n\n{{societe}}', true, false),
    (6, 'Transmission au contentieux', 60, 'contentieux'::canal_relance_enum, false,
     'Dossier contentieux - {{client}} - facture {{numero}}',
     'Transmettre le dossier {{client}} (facture {{numero}}, {{reste}} {{devise}}, {{jours_retard}} jours de retard) au service juridique pour injonction de payer.', true, true)
) AS e(niveau, libelle, jours, canal, auto, sujet, corps, bloquer, contentieux);

WITH s AS (
    INSERT INTO scenarios_relance (nom, description, par_defaut)
    VALUES ('Scénario grands comptes', 'Relances espacées, sans blocage automatique', false)
    RETURNING id
)
INSERT INTO etapes_relance (scenario_id, niveau, libelle, jours_apres_echeance, canal, automatique, modele_sujet, modele_corps)
SELECT s.id, e.* FROM s, (VALUES
    (1, 'Rappel courtois', 7, 'email'::canal_relance_enum, true, 'Facture {{numero}} - rappel', E'Bonjour {{client}},\n\nLa facture {{numero}} ({{reste}} {{devise}}) est échue depuis le {{echeance}}. Merci de nous indiquer la date de règlement prévue.\n\nCordialement,\n{{societe}}'),
    (2, 'Relance téléphonique', 30, 'appel'::canal_relance_enum, false, 'Appel - facture {{numero}}', 'Contacter {{client}} ({{telephone}}) au sujet de la facture {{numero}}.'),
    (3, 'Courrier de relance', 60, 'courrier'::canal_relance_enum, false, 'Relance écrite - facture {{numero}}', 'Adresser un courrier officiel à {{client}} pour la facture {{numero}} ({{reste}} {{devise}}).'),
    (4, 'Visite / réunion', 90, 'visite'::canal_relance_enum, false, 'Visite - {{client}}', 'Organiser une réunion avec {{client}} pour le règlement de {{reste}} {{devise}}.')
) AS e(niveau, libelle, jours, canal, auto, sujet, corps);
