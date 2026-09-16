-- ============================================================
-- RPS CRM CRÉANCES — schéma Supabase (PostgreSQL 17)
-- Sage reste la vérité des chiffres : les tables sage_* sont des copies
-- en lecture des extractions du pont (qr0/qr1/qr3/qr4). Le CRM n'écrit
-- que dans ses propres tables (actions, messages, audit…).
-- Règle n°1 : solde économique = RAN + facturation gescom + débits hors RAN − règlements.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- Types
-- ------------------------------------------------------------
CREATE TYPE role_enum AS ENUM ('dg', 'recouvrement', 'compta', 'exploitation', 'controle');
CREATE TYPE type_action_enum AS ENUM ('relance', 'promesse', 'plan', 'mise_en_demeure', 'contentieux', 'note', 'tache', 'appel');
CREATE TYPE statut_action_enum AS ENUM ('ouverte', 'fermee');
CREATE TYPE canal_enum AS ENUM ('whatsapp', 'sms', 'email', 'telephone', 'courrier', 'visite');
CREATE TYPE lien_reglement_enum AS ENUM ('multi_clients', 'regle_via', 'regularise');

CREATE OR REPLACE FUNCTION maj_modifie_le() RETURNS TRIGGER AS $$
BEGIN NEW.modifie_le = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Profils utilisateurs (comptes nominatifs, liés à auth.users)
-- ------------------------------------------------------------
CREATE TABLE profils (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(150) NOT NULL,
    nom VARCHAR(150) NOT NULL,
    role role_enum NOT NULL DEFAULT 'exploitation',
    telephone VARCHAR(30),
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_profils_maj BEFORE UPDATE ON profils FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

-- Le tout premier compte devient DG et actif (amorçage) ; tout compte suivant est créé INACTIF
-- et doit être activé par le DG (Paramètres → Utilisateurs). Comptes nominatifs, jamais partagés.
CREATE OR REPLACE FUNCTION creer_profil_utilisateur() RETURNS TRIGGER
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role role_enum := 'exploitation'; v_actif BOOLEAN := false;
BEGIN
    PERFORM pg_advisory_xact_lock(4242);   -- évite la course au « premier = DG »
    IF NOT EXISTS (SELECT 1 FROM profils) THEN v_role := 'dg'; v_actif := true; END IF;
    INSERT INTO profils (id, email, nom, role, actif)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1)), v_role, v_actif)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_auth_user_profil AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION creer_profil_utilisateur();

-- Appel « service » : clé service_role (pont, cron Vercel) ou session sans JWT hors PostgREST (SQL Editor, pg_cron, installation).
-- Ne dépend jamais de current_user (qui devient le propriétaire dans une fonction SECURITY DEFINER).
CREATE OR REPLACE FUNCTION est_service() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND auth.uid() IS NULL AND session_user NOT IN ('authenticator', 'anon', 'authenticated')); $$;

CREATE OR REPLACE FUNCTION role_courant() RETURNS role_enum
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role FROM profils WHERE id = auth.uid() AND actif = true; $$;
CREATE OR REPLACE FUNCTION nom_courant() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT nom FROM profils WHERE id = auth.uid(); $$;
-- Toujours vrai/faux, jamais NULL : une garde « IF NOT peut_recouvrer() » doit bloquer un compte sans rôle
CREATE OR REPLACE FUNCTION est_utilisateur_actif() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT role_courant() IS NOT NULL; $$;
CREATE OR REPLACE FUNCTION est_dg() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT COALESCE(role_courant() = 'dg', false); $$;
CREATE OR REPLACE FUNCTION peut_recouvrer() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT COALESCE(role_courant() IN ('dg', 'recouvrement'), false); $$;
CREATE OR REPLACE FUNCTION peut_pointer() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT COALESCE(role_courant() IN ('dg', 'recouvrement', 'compta'), false); $$;

-- Seul le DG (ou le service) change le rôle, l'état ou l'identité d'un compte ; un DG ne se désactive pas lui-même.
CREATE OR REPLACE FUNCTION proteger_profil() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF est_service() THEN RETURN NEW; END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.actif IS DISTINCT FROM OLD.actif OR NEW.id <> OLD.id OR NEW.email <> OLD.email) AND NOT est_dg() THEN
        RAISE EXCEPTION 'Seul le DG modifie le rôle ou l''état d''un compte';
    END IF;
    IF NEW.actif = false AND OLD.actif = true AND OLD.id = auth.uid() THEN
        RAISE EXCEPTION 'Un compte ne peut pas se désactiver lui-même';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_profils_protege BEFORE UPDATE ON profils FOR EACH ROW EXECUTE FUNCTION proteger_profil();

-- ------------------------------------------------------------
-- Paramètres
-- ------------------------------------------------------------
CREATE TABLE parametres (
    cle VARCHAR(60) PRIMARY KEY,
    valeur JSONB NOT NULL,
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION parametre(p_cle VARCHAR) RETURNS JSONB
LANGUAGE sql STABLE AS $$ SELECT valeur FROM parametres WHERE cle = p_cle; $$;

-- ------------------------------------------------------------
-- Extractions du pont Sage (copies en lecture, remplacées à chaque extraction)
-- ------------------------------------------------------------
CREATE TABLE extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date_extraction DATE NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'api',            -- api | fichiers
    statut VARCHAR(20) NOT NULL DEFAULT 'en_cours',       -- en_cours | active | archivee | abandonnee
    saisi_jusquau DATE,                                   -- dernière date de facturation saisie en gescom
    nb_clients INT NOT NULL DEFAULT 0,
    nb_facturation INT NOT NULL DEFAULT 0,
    nb_ecritures INT NOT NULL DEFAULT 0,
    nb_livraisons INT NOT NULL DEFAULT 0,
    nb_rejets INT NOT NULL DEFAULT 0,                    -- lignes refusées (compte hors périmètre, date ou montant invalides)
    attendus JSONB,                                       -- totaux annoncés par le pont {clients, facturation, ecritures, livraisons}
    heure_extraction TIMESTAMPTZ,
    commentaire TEXT,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_le TIMESTAMPTZ,
    CHECK (statut IN ('en_cours', 'active', 'archivee', 'abandonnee')),
    CHECK (source IN ('api', 'fichiers'))
);
CREATE UNIQUE INDEX idx_extraction_active ON extractions (statut) WHERE statut = 'active';

-- Lots reçus : rend le chargement idempotent (un lot renvoyé après un timeout n'est pas compté deux fois)
CREATE TABLE extraction_lots (
    extraction_id UUID NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    jeu VARCHAR(12) NOT NULL,
    lot INT NOT NULL,
    nb_lignes INT NOT NULL,
    nb_rejets INT NOT NULL DEFAULT 0,
    exemples_rejets JSONB,
    recu_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (extraction_id, jeu, lot)
);

-- Historique par client à chaque activation (tendance de l'encours, DSO, score)
CREATE TABLE clients_historique (
    compte VARCHAR(16) NOT NULL,
    date_extraction DATE NOT NULL,
    solde NUMERIC(16,2) NOT NULL,
    ran NUMERIC(16,2) NOT NULL,
    facture NUMERIC(16,2) NOT NULL,
    regle NUMERIC(16,2) NOT NULL,
    jours_sans_reglement INT,
    score INT,
    typologie VARCHAR(40),
    PRIMARY KEY (compte, date_extraction)
);

CREATE TABLE sage_clients (               -- qr0 : CT_Num, CT_Intitule
    extraction_id UUID NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    compte VARCHAR(16) NOT NULL,
    intitule VARCHAR(120) NOT NULL,
    PRIMARY KEY (extraction_id, compte)
);
CREATE TABLE sage_facturation (           -- qr1 : CT_Num, mois, ht
    extraction_id UUID NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    compte VARCHAR(16) NOT NULL,
    mois CHAR(7) NOT NULL,
    ht NUMERIC(16,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_sage_fact ON sage_facturation (extraction_id, compte, mois);
CREATE TABLE sage_ecritures (             -- qr3 : CT_Num, d, JO_Num, EC_Piece, EC_RefPiece, EC_Intitule, EC_Sens, EC_Montant
    extraction_id UUID NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    ordre INT NOT NULL,
    compte VARCHAR(16) NOT NULL,
    date_ecriture DATE NOT NULL,
    journal VARCHAR(10) NOT NULL,
    piece VARCHAR(30),
    ref_piece VARCHAR(60),
    intitule VARCHAR(200),
    sens SMALLINT NOT NULL,               -- 0 = débit, 1 = crédit
    montant NUMERIC(16,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_sage_ecr ON sage_ecritures (extraction_id, compte, date_ecriture);
CREATE TABLE sage_livraisons (            -- qr4 : CT_Num, d, DO_Piece, AR_Ref, DL_Design, DL_Qte, DL_MontantHT, DE_Intitule
    extraction_id UUID NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    ordre INT NOT NULL,
    compte VARCHAR(16) NOT NULL,
    date_livraison DATE NOT NULL,
    piece VARCHAR(30),
    ar_ref VARCHAR(30),
    designation VARCHAR(120),
    qte NUMERIC(14,3) NOT NULL DEFAULT 0,
    montant_ht NUMERIC(16,2) NOT NULL DEFAULT 0,
    depot VARCHAR(120),
    station VARCHAR(40),                  -- libellé de station (après « RPS » dans l'intitulé de dépôt)
    station_numero VARCHAR(10)            -- numéro de station « nn » dans « XX-nn-RPS … » : le numéro fait foi
);
CREATE INDEX idx_sage_livr ON sage_livraisons (extraction_id, compte, date_livraison);
CREATE INDEX idx_sage_ecr_mois ON sage_ecritures (extraction_id, date_ecriture) WHERE sens = 1;
CREATE INDEX idx_sage_ecr_piece ON sage_ecritures (extraction_id, compte, journal, piece);

-- Résultat du calcul par client (rafraîchi à chaque activation d'extraction)
CREATE TABLE clients_calc (
    compte VARCHAR(16) PRIMARY KEY,
    intitule VARCHAR(120) NOT NULL,
    ran NUMERIC(16,2) NOT NULL DEFAULT 0,
    facture NUMERIC(16,2) NOT NULL DEFAULT 0,            -- facturation gescom (période extraite)
    facture_exercice NUMERIC(16,2) NOT NULL DEFAULT 0,   -- facturation de l'exercice en cours
    regle NUMERIC(16,2) NOT NULL DEFAULT 0,              -- crédits compta hors RAN
    debits_hors_ran NUMERIC(16,2) NOT NULL DEFAULT 0,    -- dépenses payées pour le client
    solde NUMERIC(16,2) NOT NULL DEFAULT 0,              -- solde économique (négatif = créditeur)
    derniere_facture DATE,
    dernier_reglement DATE,
    nb_reglements INT NOT NULL DEFAULT 0,
    reglement_moyen NUMERIC(16,2) NOT NULL DEFAULT 0,
    part_mobile_money NUMERIC(5,2) NOT NULL DEFAULT 0,   -- % des règlements via NITA/CAINIT/Airtel
    litres_exercice NUMERIC(16,3) NOT NULL DEFAULT 0,
    cadence_jours INT,                                   -- médiane des intervalles entre règlements
    seuil_alerte_jours INT NOT NULL DEFAULT 30,          -- 1,5 × médiane bornée 10-45, sinon filet générique
    jours_sans_reglement INT,                            -- à la date du calcul (la vue recalcule sur CURRENT_DATE)
    nb_regularisations INT NOT NULL DEFAULT 0,           -- crédits neutralisés (régularisations), hors cadence et fermetures
    bons_servis NUMERIC(16,2) NOT NULL DEFAULT 0,        -- livraisons de l'exercice (bons), pour le ratio BV
    ratio_bv NUMERIC(8,2),                               -- bons servis / réglés (comptes BV)
    bv_bloque BOOLEAN NOT NULL DEFAULT false,            -- règle dure BV : pas de nouveau lot sans règlement du précédent
    typologie_auto VARCHAR(40) NOT NULL DEFAULT 'standard',
    score INT NOT NULL DEFAULT 100,
    actif BOOLEAN GENERATED ALWAYS AS (facture > 0 OR abs(solde) > 1000 OR regle > 0) STORED,
    calcule_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Base CRM (seule zone en écriture)
-- ------------------------------------------------------------
CREATE TABLE clients_ext (                  -- extension du référentiel Sage : jamais de soldes ici
    compte VARCHAR(16) PRIMARY KEY,
    contacts JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{nom, tel, whatsapp, email, role}]
    typologie VARCHAR(40),                          -- surcharge manuelle (NULL = typologie auto)
    typologie_manuelle BOOLEAN NOT NULL DEFAULT false,
    limite_credit NUMERIC(16,0),
    interlocuteur_id UUID REFERENCES profils(id) ON DELETE SET NULL,
    segment_zone VARCHAR(40),
    categorie VARCHAR(40),                          -- BV / transporteur / société / administration…
    notes TEXT,
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_clients_ext_maj BEFORE UPDATE ON clients_ext FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();
-- La limite de crédit est fixée par le DG (CDC-05 §5.8) : personne d'autre ne peut la modifier
CREATE OR REPLACE FUNCTION proteger_limite_credit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF est_service() OR est_dg() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.limite_credit IS NOT NULL THEN RAISE EXCEPTION 'La limite de crédit est fixée par le DG'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.limite_credit IS DISTINCT FROM OLD.limite_credit THEN NEW.limite_credit := OLD.limite_credit; END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_clients_ext_limite BEFORE INSERT OR UPDATE ON clients_ext FOR EACH ROW EXECUTE FUNCTION proteger_limite_credit();

CREATE TABLE actions (                      -- relances, promesses, plans, contentieux, notes, tâches
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte VARCHAR(16) NOT NULL,
    type type_action_enum NOT NULL,
    statut statut_action_enum NOT NULL DEFAULT 'ouverte',
    niveau INT,                                     -- N1..N4 (séquence de relance)
    canal canal_enum,
    note TEXT,
    montant NUMERIC(16,0),                          -- promesse / plan
    echeance DATE,                                  -- promesse / tâche
    resultat VARCHAR(20) CHECK (resultat IS NULL OR resultat IN ('tenue', 'non_tenue', 'annulee')),  -- promesse / plan
    reglee_par_piece VARCHAR(30),                   -- pièce compta qui a soldé l'action (fermeture automatique)
    assignee_id UUID REFERENCES profils(id) ON DELETE SET NULL,
    auteur_id UUID REFERENCES profils(id) ON DELETE SET NULL,
    auteur VARCHAR(80) NOT NULL DEFAULT 'système',
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_action DATE NOT NULL DEFAULT CURRENT_DATE,
    ferme_le TIMESTAMPTZ,
    ferme_motif TEXT,
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_actions_compte ON actions (compte, statut);
CREATE INDEX idx_actions_echeance ON actions (statut, echeance);
CREATE INDEX idx_actions_type ON actions (type, statut, resultat);
-- une seule relance / promesse / plan / mise en demeure / contentieux ouvert à la fois par client
CREATE UNIQUE INDEX ux_action_ouverte ON actions (compte, type) WHERE statut = 'ouverte' AND type IN ('relance', 'promesse', 'plan', 'mise_en_demeure', 'contentieux');
CREATE TRIGGER trg_actions_maj BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

CREATE TABLE plans_echeances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id UUID NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    echeance DATE NOT NULL,
    montant NUMERIC(16,0) NOT NULL,
    tenue BOOLEAN,
    reglee_par_piece VARCHAR(30)
);
CREATE INDEX idx_plans_action ON plans_echeances (action_id);

CREATE TABLE modeles_messages (
    code VARCHAR(40) PRIMARY KEY,
    libelle VARCHAR(100) NOT NULL,
    canal canal_enum NOT NULL DEFAULT 'whatsapp',
    niveau INT,
    corps TEXT NOT NULL,
    valide_par_dg BOOLEAN NOT NULL DEFAULT false,      -- aucun envoi automatique sans validation DG
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages_sortants (            -- WhatsApp / SMS / e-mail (tracés dans la timeline)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte VARCHAR(16) NOT NULL,
    canal canal_enum NOT NULL,
    modele VARCHAR(40),
    destinataire VARCHAR(120),
    contenu TEXT NOT NULL,
    action_id UUID REFERENCES actions(id) ON DELETE SET NULL,
    envoye_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    envoye_par_nom VARCHAR(80),
    envoye_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_compte ON messages_sortants (compte, envoye_le);

CREATE TABLE etiquettes_payeur (            -- comptes collectifs (ex. SSN) : payeur par règlement ET par bon
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte VARCHAR(16) NOT NULL,
    nature VARCHAR(10) NOT NULL DEFAULT 'reglement' CHECK (nature IN ('reglement', 'bon')),
    journal VARCHAR(10) NOT NULL DEFAULT '',   -- EC_Piece n'est unique que par journal dans Sage
    piece VARCHAR(30) NOT NULL,
    payeur VARCHAR(80) NOT NULL,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    UNIQUE (compte, nature, journal, piece)
);

CREATE TABLE reglements_liens (             -- particularités CDC-05 §3.3
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte VARCHAR(16) NOT NULL,
    journal VARCHAR(10) NOT NULL DEFAULT '',
    piece VARCHAR(30) NOT NULL,
    lien lien_reglement_enum NOT NULL,
    piece_liee VARCHAR(30),
    compte_lie VARCHAR(16),
    note TEXT,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (compte, journal, piece, lien)
);
CREATE INDEX idx_liens_compte ON reglements_liens (compte, journal, piece);

CREATE TABLE documents (                    -- métadonnées des documents générés (fichiers en GED)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte VARCHAR(16) NOT NULL,
    type VARCHAR(30) NOT NULL,              -- situation_4_volets | releve | relance | mise_en_demeure
    date_arrete DATE NOT NULL,
    chemin_ged VARCHAR(255),
    genere_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    genere_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit (                        -- qui a vu / modifié / envoyé quoi, quand
    id BIGSERIAL PRIMARY KEY,
    quand TIMESTAMPTZ NOT NULL DEFAULT now(),
    qui UUID,
    qui_nom VARCHAR(80),
    quoi VARCHAR(60) NOT NULL,
    compte VARCHAR(16),
    detail JSONB
);
CREATE INDEX idx_audit_quand ON audit (quand DESC);
CREATE INDEX idx_audit_compte ON audit (compte);
CREATE INDEX idx_audit_qui ON audit (qui, quand DESC);
CREATE INDEX idx_documents_compte ON documents (compte, genere_le DESC);

CREATE OR REPLACE FUNCTION journaliser(p_quoi VARCHAR, p_compte VARCHAR DEFAULT NULL, p_detail JSONB DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL AND NOT est_service() THEN RAISE EXCEPTION 'Journalisation réservée aux utilisateurs connectés'; END IF;
    INSERT INTO audit (qui, qui_nom, quoi, compte, detail)
    VALUES (auth.uid(), COALESCE(nom_courant(), CASE WHEN est_service() THEN 'service' END), p_quoi, p_compte, p_detail);
END; $$;
REVOKE EXECUTE ON FUNCTION journaliser(VARCHAR, VARCHAR, JSONB) FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- Aides de validation (chargement tolérant : une ligne invalide est rejetée, pas le lot)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION vers_numeric(p TEXT) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT := regexp_replace(COALESCE(p, ''), '[[:space:]  ]', '', 'g');
BEGIN
    IF v = '' THEN RETURN 0; END IF;
    IF v ~ ',' AND v ~ '\.' THEN
        IF position(',' IN v) > position('.' IN v) THEN v := replace(replace(v, '.', ''), ',', '.'); ELSE v := replace(v, ',', ''); END IF;
    ELSE
        v := replace(v, ',', '.');
    END IF;
    RETURN v::NUMERIC;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION vers_date(p TEXT) RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
    RETURN left(p, 10)::DATE;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

-- Périmètre CDC-05 : comptes 411 hors 41180 (clients cash des stations)
CREATE OR REPLACE FUNCTION compte_dans_perimetre(p TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT p IS NOT NULL AND trim(p) LIKE '411%' AND trim(p) NOT LIKE '41180%'; $$;

-- ------------------------------------------------------------
-- Fonctions du pont : chargement d'une extraction (lots idempotents) puis activation contrôlée
-- Réservées au service (clé service_role) et au DG / recouvrement (mode fichiers).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION exiger_pont() RETURNS VOID LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT (est_service() OR peut_recouvrer()) THEN
        RAISE EXCEPTION 'Chargement réservé au service du pont, au DG et au recouvrement';
    END IF;
END; $$;

CREATE OR REPLACE FUNCTION pont_debut_extraction(p_date DATE, p_source VARCHAR DEFAULT 'api', p_saisi_jusquau DATE DEFAULT NULL,
                                                 p_commentaire TEXT DEFAULT NULL, p_attendus JSONB DEFAULT NULL, p_heure TIMESTAMPTZ DEFAULT now())
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
    PERFORM exiger_pont();
    IF p_date > CURRENT_DATE + 1 THEN RAISE EXCEPTION 'Date d''extraction dans le futur : %', p_date; END IF;
    -- une extraction en cours depuis plus de 6 h est abandonnée (marquée, purgée physiquement après 1 jour)
    UPDATE extractions SET statut = 'abandonnee' WHERE statut = 'en_cours' AND cree_le < now() - INTERVAL '6 hours';
    DELETE FROM extractions WHERE statut = 'abandonnee' AND cree_le < now() - INTERVAL '1 day';
    INSERT INTO extractions (date_extraction, source, saisi_jusquau, commentaire, attendus, heure_extraction, cree_par)
    VALUES (p_date, p_source, p_saisi_jusquau, p_commentaire, p_attendus, p_heure, auth.uid()) RETURNING id INTO v_id;
    RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION pont_abandonner_extraction(p_extraction UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM exiger_pont();
    UPDATE extractions SET statut = 'abandonnee' WHERE id = p_extraction AND statut = 'en_cours';
END; $$;

-- p_jeu : clients | facturation | ecritures | livraisons ; p_lignes : tableau de tableaux au format qr0/qr1/qr3/qr4 ;
-- p_lot : numéro de lot (idempotence : un lot déjà reçu est ignoré). Retourne {acceptees, rejetees, deja_recu}.
CREATE OR REPLACE FUNCTION pont_ajouter_lignes(p_extraction UUID, p_jeu VARCHAR, p_lignes JSONB, p_lot INT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT := 0; v_base INT; v_total INT; v_rejets INT; v_date DATE; v_exemples JSONB;
BEGIN
    PERFORM exiger_pont();
    SELECT date_extraction INTO v_date FROM extractions WHERE id = p_extraction AND statut = 'en_cours';
    IF v_date IS NULL THEN RAISE EXCEPTION 'Extraction % introuvable ou déjà activée', p_extraction; END IF;
    v_total := COALESCE(jsonb_array_length(p_lignes), 0);
    IF p_lot IS NOT NULL THEN
        INSERT INTO extraction_lots (extraction_id, jeu, lot, nb_lignes) VALUES (p_extraction, p_jeu, p_lot, v_total) ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN RETURN jsonb_build_object('acceptees', 0, 'rejetees', 0, 'deja_recu', true); END IF;
    END IF;

    IF p_jeu = 'clients' THEN
        INSERT INTO sage_clients (extraction_id, compte, intitule)
        SELECT p_extraction, trim(l->>0), left(trim(COALESCE(l->>1, '')), 120)
          FROM jsonb_array_elements(p_lignes) l
         WHERE compte_dans_perimetre(l->>0)
        ON CONFLICT (extraction_id, compte) DO NOTHING;
    ELSIF p_jeu = 'facturation' THEN
        INSERT INTO sage_facturation (extraction_id, compte, mois, ht)
        SELECT p_extraction, trim(l->>0), left(trim(l->>1), 7), vers_numeric(l->>2)
          FROM jsonb_array_elements(p_lignes) l
         WHERE compte_dans_perimetre(l->>0) AND COALESCE(l->>1, '') ~ '^\d{4}-\d{2}' AND vers_numeric(l->>2) IS NOT NULL;
    ELSIF p_jeu = 'ecritures' THEN
        SELECT COALESCE(MAX(ordre), 0) INTO v_base FROM sage_ecritures WHERE extraction_id = p_extraction;
        INSERT INTO sage_ecritures (extraction_id, ordre, compte, date_ecriture, journal, piece, ref_piece, intitule, sens, montant)
        SELECT p_extraction, v_base + n::INT, trim(l->>0), vers_date(l->>1), upper(left(trim(l->>2), 10)),
               left(trim(l->>3), 30), left(trim(l->>4), 60), left(trim(l->>5), 200),
               (l->>6)::INT::SMALLINT, vers_numeric(l->>7)
          FROM jsonb_array_elements(p_lignes) WITH ORDINALITY AS t(l, n)
         WHERE compte_dans_perimetre(l->>0) AND vers_date(l->>1) IS NOT NULL AND vers_date(l->>1) BETWEEN DATE '2000-01-01' AND v_date
           AND COALESCE(l->>6, '') IN ('0', '1') AND vers_numeric(l->>7) IS NOT NULL;
    ELSIF p_jeu = 'livraisons' THEN
        SELECT COALESCE(MAX(ordre), 0) INTO v_base FROM sage_livraisons WHERE extraction_id = p_extraction;
        INSERT INTO sage_livraisons (extraction_id, ordre, compte, date_livraison, piece, ar_ref, designation, qte, montant_ht, depot, station, station_numero)
        SELECT p_extraction, v_base + n::INT, trim(l->>0), vers_date(l->>1), left(trim(l->>2), 30), left(trim(l->>3), 30),
               left(trim(l->>4), 120), vers_numeric(l->>5), vers_numeric(l->>6),
               left(trim(l->>7), 120), left(trim(regexp_replace(COALESCE(l->>7, ''), '^.*RPS', '')), 40),
               (regexp_match(COALESCE(l->>7, ''), '^[^-]*-\s*(\d+)\s*-\s*RPS'))[1]
          FROM jsonb_array_elements(p_lignes) WITH ORDINALITY AS t(l, n)
         WHERE compte_dans_perimetre(l->>0) AND vers_date(l->>1) IS NOT NULL AND vers_date(l->>1) BETWEEN DATE '2000-01-01' AND v_date
           AND vers_numeric(l->>5) IS NOT NULL AND vers_numeric(l->>6) IS NOT NULL;
    ELSE
        RAISE EXCEPTION 'Jeu inconnu : %', p_jeu;
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rejets := v_total - v_n;
    IF v_rejets > 0 THEN
        -- exemples de lignes rejetées (5 au plus), pour le compte-rendu
        SELECT jsonb_agg(l) INTO v_exemples FROM (
            SELECT l FROM jsonb_array_elements(p_lignes) l
             WHERE NOT compte_dans_perimetre(l->>0)
                OR (p_jeu IN ('ecritures', 'livraisons') AND (vers_date(l->>1) IS NULL OR vers_date(l->>1) > v_date OR vers_date(l->>1) < DATE '2000-01-01'))
                OR (p_jeu = 'facturation' AND (COALESCE(l->>1, '') !~ '^\d{4}-\d{2}' OR vers_numeric(l->>2) IS NULL))
                OR (p_jeu = 'ecritures' AND (COALESCE(l->>6, '') NOT IN ('0', '1') OR vers_numeric(l->>7) IS NULL))
                OR (p_jeu = 'livraisons' AND (vers_numeric(l->>5) IS NULL OR vers_numeric(l->>6) IS NULL))
             LIMIT 5) x;
        UPDATE extractions SET nb_rejets = nb_rejets + v_rejets WHERE id = p_extraction;
        IF p_lot IS NOT NULL THEN UPDATE extraction_lots SET nb_rejets = v_rejets, exemples_rejets = v_exemples WHERE extraction_id = p_extraction AND jeu = p_jeu AND lot = p_lot; END IF;
    END IF;
    RETURN jsonb_build_object('acceptees', v_n, 'rejetees', v_rejets, 'deja_recu', false, 'exemples_rejets', v_exemples);
END; $$;

-- Activation : contrôles de complétude (totaux annoncés, rejets, régression de date, volume vs extraction active),
-- bascule atomique, recalcul, historique. p_forcer = true (DG) passe outre les contrôles de volume/rejets, jamais la régression de date.
CREATE OR REPLACE FUNCTION pont_activer_extraction(p_extraction UUID, p_forcer BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e extractions; act extractions; v_stats JSONB; v_att JSONB;
BEGIN
    PERFORM exiger_pont();
    SELECT * INTO e FROM extractions WHERE id = p_extraction AND statut = 'en_cours';
    IF e.id IS NULL THEN RAISE EXCEPTION 'Extraction introuvable ou déjà activée'; END IF;
    SELECT * INTO act FROM extractions WHERE statut = 'active';

    UPDATE extractions SET
        nb_clients = (SELECT count(*) FROM sage_clients WHERE extraction_id = p_extraction),
        nb_facturation = (SELECT count(*) FROM sage_facturation WHERE extraction_id = p_extraction),
        nb_ecritures = (SELECT count(*) FROM sage_ecritures WHERE extraction_id = p_extraction),
        nb_livraisons = (SELECT count(*) FROM sage_livraisons WHERE extraction_id = p_extraction),
        saisi_jusquau = COALESCE(saisi_jusquau, (SELECT max(date_livraison) FROM sage_livraisons WHERE extraction_id = p_extraction))
    WHERE id = p_extraction RETURNING * INTO e;

    IF e.nb_clients = 0 THEN RAISE EXCEPTION 'Extraction vide : aucun client (qr0) dans le périmètre 411 hors 41180'; END IF;
    IF act.id IS NOT NULL AND e.date_extraction < act.date_extraction THEN
        RAISE EXCEPTION 'Extraction du % antérieure à l''extraction active du % : refusée', e.date_extraction, act.date_extraction;
    END IF;
    v_att := e.attendus;
    IF v_att IS NOT NULL AND NOT p_forcer THEN
        IF (v_att->>'clients')::INT IS DISTINCT FROM e.nb_clients + (SELECT COALESCE(SUM(nb_rejets), 0) FROM extraction_lots WHERE extraction_id = e.id AND jeu = 'clients')::INT
           OR (v_att->>'ecritures')::INT IS DISTINCT FROM e.nb_ecritures + (SELECT COALESCE(SUM(nb_rejets), 0) FROM extraction_lots WHERE extraction_id = e.id AND jeu = 'ecritures')::INT
           OR (v_att->>'livraisons')::INT IS DISTINCT FROM e.nb_livraisons + (SELECT COALESCE(SUM(nb_rejets), 0) FROM extraction_lots WHERE extraction_id = e.id AND jeu = 'livraisons')::INT
           OR (v_att->>'facturation')::INT IS DISTINCT FROM e.nb_facturation + (SELECT COALESCE(SUM(nb_rejets), 0) FROM extraction_lots WHERE extraction_id = e.id AND jeu = 'facturation')::INT THEN
            RAISE EXCEPTION 'Extraction incomplète : lignes reçues différentes des totaux annoncés (%)', v_att;
        END IF;
    END IF;
    IF NOT p_forcer THEN
        IF e.nb_rejets > 0 THEN RAISE EXCEPTION '% ligne(s) rejetée(s) (hors périmètre, date ou montant invalides) : corrigez ou forcez (DG)', e.nb_rejets; END IF;
        IF act.id IS NOT NULL AND (e.nb_clients < act.nb_clients * 0.8 OR e.nb_ecritures < act.nb_ecritures * 0.8) THEN
            RAISE EXCEPTION 'Extraction partielle : % clients / % écritures contre % / % dans l''extraction active. Activation refusée pour ne pas fermer des actions à tort', e.nb_clients, e.nb_ecritures, act.nb_clients, act.nb_ecritures;
        END IF;
    END IF;

    UPDATE extractions SET statut = 'archivee' WHERE statut = 'active';
    UPDATE extractions SET statut = 'active', active_le = now() WHERE id = p_extraction;
    DELETE FROM extractions WHERE statut = 'archivee' AND id NOT IN (
        SELECT id FROM extractions WHERE statut = 'archivee' ORDER BY active_le DESC NULLS LAST LIMIT 2);

    v_stats := recalculer_clients();
    INSERT INTO clients_historique (compte, date_extraction, solde, ran, facture, regle, jours_sans_reglement, score, typologie)
    SELECT compte, e.date_extraction, solde, ran, facture, regle, jours_sans_reglement, score, typologie_auto FROM clients_calc
    ON CONFLICT (compte, date_extraction) DO UPDATE SET solde = EXCLUDED.solde, ran = EXCLUDED.ran, facture = EXCLUDED.facture, regle = EXCLUDED.regle,
        jours_sans_reglement = EXCLUDED.jours_sans_reglement, score = EXCLUDED.score, typologie = EXCLUDED.typologie;
    PERFORM journaliser('extraction_activee', NULL, jsonb_build_object('extraction', p_extraction, 'date', e.date_extraction, 'source', e.source, 'force', p_forcer, 'rejets', e.nb_rejets) || v_stats);
    RETURN v_stats || jsonb_build_object('rejets', e.nb_rejets);
END; $$;

-- ------------------------------------------------------------
-- Calcul des soldes économiques, cadences, typologies, scores (une seule implémentation opposable)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION typologie_auto(p_compte VARCHAR, p_solde NUMERIC, p_nb_regl INT, p_fact NUMERIC, p_moyen NUMERIC, p_part_mm NUMERIC)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_solde < -1000 THEN 'créditeur'
        WHEN p_nb_regl = 0 AND p_fact > 500000 THEN 'compte muet'
        WHEN p_compte LIKE '41150%' THEN 'BV / Bénin'
        WHEN p_moyen > 15000000 THEN 'grand compte à remises'
        WHEN p_nb_regl >= 15 AND p_part_mm > 50 THEN 'fil de l''eau (mobile money)'
        WHEN p_nb_regl >= 15 THEN 'au camion / à la consommation'
        ELSE 'standard' END; $$;

-- Écriture de régularisation : neutre sur le solde, mais ni cadence, ni « dernier règlement », ni fermeture d'action
CREATE OR REPLACE FUNCTION est_regularisation(p_compte VARCHAR, p_journal VARCHAR, p_piece VARCHAR, p_intitule VARCHAR) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT (p_journal = 'OD' AND COALESCE(p_intitule, '') ILIKE '%REGUL%')
        OR EXISTS (SELECT 1 FROM reglements_liens rl WHERE rl.compte = p_compte AND rl.piece = p_piece AND rl.lien = 'regularise'
                      AND (rl.journal = '' OR rl.journal = p_journal)); $$;

CREATE OR REPLACE FUNCTION recalculer_clients()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ext UUID;
    v_date DATE;
    v_ref DATE := CURRENT_DATE;                -- horloge unique pour les jours écoulés
    v_exercice TEXT;
    p JSONB := COALESCE(parametre('seuils'), '{}'::jsonb);
    v_coef NUMERIC := COALESCE((p->>'coef_cadence')::NUMERIC, 1.5);
    v_min INT := COALESCE((p->>'cadence_min_jours')::INT, 10);
    v_max INT := COALESCE((p->>'cadence_max_jours')::INT, 45);
    v_generique INT := COALESCE((p->>'jours_generique')::INT, 30);
    v_mm TEXT[] := COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p->'journaux_mobile_money') x), ARRAY['NITA', 'CAINIT']);
    v_part_couvrant NUMERIC := COALESCE((p->>'part_min_reglement_couvrant')::NUMERIC, 25);
    v_bv_max NUMERIC := COALESCE((p->>'bv_ratio_max')::NUMERIC, 1.5);
    v_tolerance INT := COALESCE((p->>'tolerance_promesse_jours')::INT, 7);
    v_nb INT; v_fermees INT := 0; v_credits NUMERIC; v_piece VARCHAR; v_reste NUMERIC; v_dg UUID;
    act RECORD; ech RECORD;
BEGIN
    IF NOT (est_service() OR peut_recouvrer()) THEN RAISE EXCEPTION 'Recalcul réservé au service, au DG et au recouvrement'; END IF;
    SELECT id, date_extraction INTO v_ext, v_date FROM extractions WHERE statut = 'active';
    IF v_ext IS NULL THEN RETURN jsonb_build_object('clients', 0); END IF;
    v_exercice := COALESCE(p->>'exercice', to_char(v_date, 'YYYY'));

    DELETE FROM clients_calc;
    INSERT INTO clients_calc (compte, intitule, ran, facture, facture_exercice, regle, debits_hors_ran, solde,
                              derniere_facture, dernier_reglement, nb_reglements, reglement_moyen, part_mobile_money, litres_exercice,
                              cadence_jours, seuil_alerte_jours, jours_sans_reglement, nb_regularisations, bons_servis, ratio_bv, bv_bloque, typologie_auto, score)
    WITH f AS (
        SELECT compte, SUM(ht) AS facture, SUM(ht) FILTER (WHERE left(mois, 4) = v_exercice) AS facture_ex
          FROM sage_facturation WHERE extraction_id = v_ext GROUP BY compte),
    ecr AS (
        SELECT se.*, (journal <> 'RAN' AND sens = 1) AS credit,
               (journal <> 'RAN' AND sens = 1 AND est_regularisation(compte, journal, piece, intitule)) AS regul
          FROM sage_ecritures se WHERE extraction_id = v_ext),
    e AS (
        SELECT compte,
               SUM(CASE WHEN journal = 'RAN' THEN CASE WHEN sens = 0 THEN montant ELSE -montant END ELSE 0 END) AS ran,
               SUM(CASE WHEN credit THEN montant ELSE 0 END) AS regle,                         -- solde : toutes les régularisations comptent (neutres)
               SUM(CASE WHEN journal <> 'RAN' AND sens = 0 THEN montant ELSE 0 END) AS debits,
               COUNT(*) FILTER (WHERE credit AND NOT regul) AS nb_regl,
               COUNT(*) FILTER (WHERE credit AND regul) AS nb_regul,
               COUNT(*) FILTER (WHERE credit AND NOT regul AND journal = ANY (v_mm)) AS nb_mm,
               SUM(montant) FILTER (WHERE credit AND NOT regul) AS regle_effectif,
               MAX(date_ecriture) FILTER (WHERE credit AND NOT regul) AS der_regl
          FROM ecr GROUP BY compte),
    cad AS (   -- médiane « haute » des intervalles, comme la maquette (élément n/2 du tableau trié)
        SELECT compte, (array_agg(intervalle ORDER BY intervalle))[count(*) / 2 + 1] AS mediane, count(*) AS n
          FROM (SELECT compte, date_ecriture - lag(date_ecriture) OVER (PARTITION BY compte ORDER BY date_ecriture, ordre) AS intervalle
                  FROM ecr WHERE credit AND NOT regul) i
         WHERE intervalle IS NOT NULL GROUP BY compte),
    l AS (
        SELECT compte, MAX(date_livraison) AS der_fact,
               SUM(qte) FILTER (WHERE to_char(date_livraison, 'YYYY') = v_exercice) AS litres,
               SUM(montant_ht) FILTER (WHERE to_char(date_livraison, 'YYYY') = v_exercice) AS bons
          FROM sage_livraisons WHERE extraction_id = v_ext GROUP BY compte)
    SELECT c.compte, c.intitule,
           COALESCE(e.ran, 0), COALESCE(f.facture, 0), COALESCE(f.facture_ex, 0), COALESCE(e.regle, 0), COALESCE(e.debits, 0),
           COALESCE(e.ran, 0) + COALESCE(f.facture, 0) + COALESCE(e.debits, 0) - COALESCE(e.regle, 0) AS solde,
           l.der_fact, e.der_regl, COALESCE(e.nb_regl, 0),
           CASE WHEN COALESCE(e.nb_regl, 0) > 0 THEN e.regle_effectif / e.nb_regl ELSE 0 END,
           CASE WHEN COALESCE(e.nb_regl, 0) > 0 THEN ROUND(100.0 * e.nb_mm / e.nb_regl, 2) ELSE 0 END,
           COALESCE(l.litres, 0),
           CASE WHEN cad.n >= 2 THEN ROUND(cad.mediane)::INT ELSE NULL END,
           CASE WHEN cad.n >= 2 THEN LEAST(v_max, GREATEST(v_min, ROUND(v_coef * cad.mediane)::INT)) ELSE v_generique END,
           CASE WHEN e.der_regl IS NULL THEN NULL ELSE v_ref - e.der_regl END,
           COALESCE(e.nb_regul, 0),
           COALESCE(l.bons, 0),
           CASE WHEN c.compte LIKE '41150%' AND COALESCE(e.regle_effectif, 0) > 0 THEN ROUND(COALESCE(l.bons, 0) / e.regle_effectif, 2)
                WHEN c.compte LIKE '41150%' AND COALESCE(l.bons, 0) > 0 THEN 999 ELSE NULL END,
           (c.compte LIKE '41150%' AND COALESCE(l.bons, 0) > 0 AND COALESCE(l.bons, 0) > v_bv_max * COALESCE(e.regle_effectif, 0)),
           typologie_auto(c.compte, COALESCE(e.ran, 0) + COALESCE(f.facture, 0) + COALESCE(e.debits, 0) - COALESCE(e.regle, 0),
                          COALESCE(e.nb_regl, 0)::INT, COALESCE(f.facture, 0),
                          CASE WHEN COALESCE(e.nb_regl, 0) > 0 THEN e.regle_effectif / e.nb_regl ELSE 0 END,
                          CASE WHEN COALESCE(e.nb_regl, 0) > 0 THEN 100.0 * e.nb_mm / e.nb_regl ELSE 0 END),
           100
      FROM sage_clients c
      LEFT JOIN f ON f.compte = c.compte
      LEFT JOIN e ON e.compte = c.compte
      LEFT JOIN cad ON cad.compte = c.compte
      LEFT JOIN l ON l.compte = c.compte
     WHERE c.extraction_id = v_ext;

    -- Fermeture automatique : la donnée Sage commande.
    FOR act IN SELECT x.*, cc.solde AS solde_client FROM actions x JOIN clients_calc cc ON cc.compte = x.compte
                WHERE x.statut = 'ouverte' AND x.type IN ('relance', 'promesse', 'contentieux', 'plan', 'mise_en_demeure') LOOP
        -- crédits effectifs (hors régularisations) encaissés depuis l'action
        SELECT COALESCE(SUM(montant), 0), (array_agg(piece ORDER BY date_ecriture DESC, ordre DESC))[1]
          INTO v_credits, v_piece
          FROM sage_ecritures se WHERE se.extraction_id = v_ext AND se.compte = act.compte AND se.journal <> 'RAN' AND se.sens = 1
           AND se.date_ecriture >= act.date_action AND NOT est_regularisation(se.compte, se.journal, se.piece, se.intitule);

        IF act.solde_client <= 1000 AND act.type <> 'contentieux' THEN
            UPDATE actions SET statut = 'fermee', ferme_le = now(), ferme_motif = 'Compte soldé (extraction du ' || to_char(v_date, 'DD/MM/YYYY') || ')',
                               resultat = CASE WHEN type IN ('promesse', 'plan') THEN 'tenue' ELSE resultat END, reglee_par_piece = COALESCE(reglee_par_piece, v_piece) WHERE id = act.id;
            v_fermees := v_fermees + 1;
        ELSIF act.type = 'promesse' AND act.montant IS NOT NULL THEN
            IF v_credits >= act.montant * 0.98 THEN
                UPDATE actions SET statut = 'fermee', ferme_le = now(), resultat = 'tenue', ferme_motif = 'Règlement reçu', reglee_par_piece = v_piece WHERE id = act.id;
                v_fermees := v_fermees + 1;
            ELSIF act.echeance IS NOT NULL AND act.echeance + v_tolerance < v_ref AND act.resultat IS DISTINCT FROM 'non_tenue' THEN
                UPDATE actions SET resultat = 'non_tenue' WHERE id = act.id;   -- reste ouverte (en rouge) jusqu'à décision humaine
            END IF;
        ELSIF act.type = 'plan' THEN
            -- affectation FIFO des crédits reçus aux échéances
            v_reste := v_credits;
            FOR ech IN SELECT * FROM plans_echeances WHERE action_id = act.id ORDER BY echeance, id LOOP
                IF v_reste >= ech.montant * 0.98 AND ech.tenue IS NOT TRUE THEN
                    UPDATE plans_echeances SET tenue = true, reglee_par_piece = v_piece WHERE id = ech.id;
                END IF;
                IF ech.tenue IS TRUE OR v_reste >= ech.montant * 0.98 THEN v_reste := v_reste - ech.montant; END IF;
            END LOOP;
            UPDATE actions SET echeance = (SELECT MIN(echeance) FROM plans_echeances WHERE action_id = act.id AND tenue IS NOT TRUE) WHERE id = act.id;
            IF NOT EXISTS (SELECT 1 FROM plans_echeances WHERE action_id = act.id AND tenue IS NOT TRUE) THEN
                UPDATE actions SET statut = 'fermee', ferme_le = now(), resultat = 'tenue', ferme_motif = 'Plan de paiement honoré', reglee_par_piece = v_piece WHERE id = act.id;
                v_fermees := v_fermees + 1;
            END IF;
        ELSIF act.type = 'relance' THEN
            -- règlement « couvrant » : au moins une part du solde à la date de la relance, pas un acompte symbolique
            IF v_credits > 0 AND v_credits >= (act.solde_client + v_credits) * v_part_couvrant / 100 THEN
                UPDATE actions SET statut = 'fermee', ferme_le = now(), ferme_motif = 'Règlement reçu après relance', reglee_par_piece = v_piece WHERE id = act.id;
                v_fermees := v_fermees + 1;
            END IF;
        END IF;
    END LOOP;

    -- Promesse échue non tenue : tâche J+1 au DG (une seule fois par promesse)
    SELECT id INTO v_dg FROM profils WHERE role = 'dg' AND actif ORDER BY cree_le LIMIT 1;
    INSERT INTO actions (compte, type, statut, note, echeance, assignee_id, auteur, date_action)
    SELECT a.compte, 'tache', 'ouverte', 'Promesse de ' || replace(to_char(a.montant, 'FM999G999G999G990'), ',', ' ') || ' F échue le ' || to_char(a.echeance, 'DD/MM/YYYY') || ' non tenue (réf. ' || a.id || ')',
           v_ref, v_dg, 'système', v_ref
      FROM actions a
     WHERE a.type = 'promesse' AND a.statut = 'ouverte' AND a.echeance < v_ref
       AND NOT EXISTS (SELECT 1 FROM actions t WHERE t.type = 'tache' AND t.note LIKE '%(réf. ' || a.id || ')');

    -- Score de risque 0-100 (100 = aucun risque)
    UPDATE clients_calc cc SET score = GREATEST(0, LEAST(100,
        100
        - CASE WHEN cc.solde <= 1000 THEN 0
               WHEN cc.jours_sans_reglement IS NULL THEN 40
               ELSE LEAST(40, ROUND(40.0 * cc.jours_sans_reglement / (2 * cc.seuil_alerte_jours)))::INT END
        - CASE WHEN cc.typologie_auto = 'compte muet' THEN 20 ELSE 0 END
        - CASE WHEN EXISTS (SELECT 1 FROM clients_ext ce WHERE ce.compte = cc.compte AND ce.limite_credit > 0 AND cc.solde > ce.limite_credit) THEN 15 ELSE 0 END
        - LEAST(20, 10 * (SELECT count(*) FROM actions ac WHERE ac.compte = cc.compte AND ac.type = 'promesse'
                                                          AND (ac.resultat = 'non_tenue' OR (ac.statut = 'ouverte' AND ac.echeance < v_ref))))::INT
        - CASE WHEN EXISTS (SELECT 1 FROM actions ac WHERE ac.compte = cc.compte AND ac.type = 'contentieux' AND ac.statut = 'ouverte') THEN 25 ELSE 0 END
        - CASE WHEN cc.bv_bloque THEN 15 ELSE 0 END
    ));
    UPDATE clients_calc SET score = 100 WHERE solde < 0;

    SELECT count(*) INTO v_nb FROM clients_calc;
    RETURN jsonb_build_object('clients', v_nb, 'actions_fermees_auto', v_fermees, 'date', v_date);
END; $$;

-- ------------------------------------------------------------
-- Vue clients : calcul + extension CRM + statut pipeline (agrégats d'actions dans une table maintenue par trigger)
-- ------------------------------------------------------------
CREATE TABLE clients_pipeline (
    compte VARCHAR(16) PRIMARY KEY,
    contentieux BOOLEAN NOT NULL DEFAULT false,
    mise_en_demeure BOOLEAN NOT NULL DEFAULT false,
    promesse BOOLEAN NOT NULL DEFAULT false,
    plan BOOLEAN NOT NULL DEFAULT false,
    relance BOOLEAN NOT NULL DEFAULT false,
    prochaine_echeance DATE,
    derniere_relance DATE,
    niveau_relance INT,
    montant_promis NUMERIC(16,0),
    nb_rompues INT NOT NULL DEFAULT 0,
    nb_tenues INT NOT NULL DEFAULT 0,
    nb_total INT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION rafraichir_pipeline(p_compte VARCHAR) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO clients_pipeline (compte, contentieux, mise_en_demeure, promesse, plan, relance, prochaine_echeance, derniere_relance, niveau_relance, montant_promis, nb_rompues, nb_tenues, nb_total)
    SELECT p_compte,
           bool_or(type = 'contentieux' AND statut = 'ouverte'),
           bool_or(type = 'mise_en_demeure' AND statut = 'ouverte'),
           bool_or(type = 'promesse' AND statut = 'ouverte'),
           bool_or(type = 'plan' AND statut = 'ouverte'),
           bool_or(type = 'relance' AND statut = 'ouverte'),
           MIN(echeance) FILTER (WHERE statut = 'ouverte' AND type IN ('promesse', 'plan')),
           MAX(date_action) FILTER (WHERE statut = 'ouverte' AND type = 'relance'),
           MAX(niveau) FILTER (WHERE statut = 'ouverte' AND type IN ('relance', 'mise_en_demeure')),
           SUM(montant) FILTER (WHERE statut = 'ouverte' AND type = 'promesse'),
           count(*) FILTER (WHERE type = 'promesse' AND (resultat = 'non_tenue' OR (statut = 'ouverte' AND echeance < CURRENT_DATE))),
           count(*) FILTER (WHERE type IN ('promesse', 'plan') AND statut = 'fermee' AND resultat = 'tenue'),
           count(*) FILTER (WHERE type IN ('promesse', 'plan') AND statut = 'fermee')
      FROM actions WHERE compte = p_compte
    ON CONFLICT (compte) DO UPDATE SET contentieux = EXCLUDED.contentieux, mise_en_demeure = EXCLUDED.mise_en_demeure, promesse = EXCLUDED.promesse, plan = EXCLUDED.plan, relance = EXCLUDED.relance,
        prochaine_echeance = EXCLUDED.prochaine_echeance, derniere_relance = EXCLUDED.derniere_relance, niveau_relance = EXCLUDED.niveau_relance, montant_promis = EXCLUDED.montant_promis,
        nb_rompues = EXCLUDED.nb_rompues, nb_tenues = EXCLUDED.nb_tenues, nb_total = EXCLUDED.nb_total; $$;

CREATE OR REPLACE FUNCTION trg_actions_pipeline() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM rafraichir_pipeline(COALESCE(NEW.compte, OLD.compte));
    RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER trg_actions_pipeline AFTER INSERT OR UPDATE OR DELETE ON actions FOR EACH ROW EXECUTE FUNCTION trg_actions_pipeline();

CREATE OR REPLACE VIEW vue_clients WITH (security_invoker = true) AS
WITH p AS (SELECT COALESCE((parametre('seuils')->>'solde_min_relance')::NUMERIC, 500000) AS solde_min,
                  COALESCE((parametre('seuils')->>'n3_jours')::INT, 60) AS n3, COALESCE((parametre('seuils')->>'n4_jours')::INT, 90) AS n4)
SELECT cc.compte, cc.intitule, cc.ran, cc.facture, cc.facture_exercice, cc.regle, cc.debits_hors_ran, cc.solde,
       cc.derniere_facture, cc.dernier_reglement, cc.nb_reglements, cc.reglement_moyen, cc.part_mobile_money, cc.litres_exercice,
       cc.cadence_jours, cc.seuil_alerte_jours,
       CASE WHEN cc.dernier_reglement IS NULL THEN NULL ELSE (CURRENT_DATE - cc.dernier_reglement) END AS jours_sans_reglement,
       cc.nb_regularisations, cc.bons_servis, cc.ratio_bv, cc.bv_bloque, cc.typologie_auto, cc.score, cc.actif, cc.calcule_le,
       COALESCE(NULLIF(ce.typologie, ''), cc.typologie_auto) AS typologie,
       ce.typologie_manuelle, ce.limite_credit, ce.interlocuteur_id, ce.segment_zone, ce.categorie, ce.contacts, ce.notes,
       pr.nom AS interlocuteur,
       (ce.limite_credit IS NOT NULL AND ce.limite_credit > 0 AND cc.solde > ce.limite_credit) AS limite_depassee,
       COALESCE(o.contentieux, false) AS contentieux, COALESCE(o.mise_en_demeure, false) AS mise_en_demeure, COALESCE(o.promesse, false) AS promesse,
       COALESCE(o.plan, false) AS plan, COALESCE(o.relance, false) AS relance,
       o.prochaine_echeance, o.derniere_relance, o.niveau_relance, o.montant_promis,
       (o.promesse AND o.prochaine_echeance < CURRENT_DATE) AS promesse_echue,
       COALESCE(o.nb_rompues, 0) AS nb_promesses_rompues, o.nb_tenues, o.nb_total,
       (cc.solde > p.solde_min AND COALESCE(CURRENT_DATE - cc.dernier_reglement, 9999) > cc.seuil_alerte_jours
        AND NOT (COALESCE(NULLIF(ce.typologie, ''), cc.typologie_auto) = 'fil de l''eau (mobile money)' AND cc.solde <= cc.facture_exercice / 26)) AS decroche,
       CASE  -- écart assumé avec la maquette : un client créditeur est affiché « créditeur » (pas « soldé »), la relance lui est interdite
           WHEN cc.solde < -1000 THEN 'créditeur'
           WHEN cc.solde <= 1000 AND cc.facture > 0 THEN 'soldé'
           WHEN o.contentieux THEN 'contentieux'
           WHEN o.mise_en_demeure THEN 'mise en demeure'
           WHEN o.plan THEN 'plan'
           WHEN o.promesse THEN 'promesse'
           WHEN o.relance THEN 'relancé'
           WHEN cc.solde > p.solde_min AND COALESCE(CURRENT_DATE - cc.dernier_reglement, 9999) > cc.seuil_alerte_jours
                AND NOT (COALESCE(NULLIF(ce.typologie, ''), cc.typologie_auto) = 'fil de l''eau (mobile money)' AND cc.solde <= cc.facture_exercice / 26) THEN 'à relancer'
           WHEN cc.solde > 0 THEN 'en cours'
           ELSE 'soldé' END AS statut,
       CASE
           WHEN cc.solde <= 1000 THEN NULL
           WHEN COALESCE(CURRENT_DATE - cc.dernier_reglement, 9999) > p.n4 OR COALESCE(o.nb_rompues, 0) >= 2 THEN 4
           WHEN COALESCE(CURRENT_DATE - cc.dernier_reglement, 9999) > p.n3 THEN 3
           WHEN cc.solde > p.solde_min AND COALESCE(CURRENT_DATE - cc.dernier_reglement, 9999) > cc.seuil_alerte_jours THEN 2
           ELSE 1 END AS niveau_suggere,
       CASE WHEN cc.solde > 100000000 THEN '> 100 M' WHEN cc.solde > 25000000 THEN '25-100 M'
            WHEN cc.solde > 5000000 THEN '5-25 M' WHEN cc.solde > 0 THEN '< 5 M' ELSE 'nul / créditeur' END AS segment_encours
  FROM clients_calc cc
  CROSS JOIN p
  LEFT JOIN clients_ext ce ON ce.compte = cc.compte
  LEFT JOIN profils pr ON pr.id = ce.interlocuteur_id
  LEFT JOIN clients_pipeline o ON o.compte = cc.compte;

-- Écritures de l'extraction active : une ligne par écriture (liens et payeur agrégés, jamais de doublon)
CREATE OR REPLACE VIEW vue_ecritures WITH (security_invoker = true) AS
SELECT se.*,
       ep.payeur,
       li.liens,
       (SELECT lien::TEXT FROM reglements_liens rl WHERE rl.compte = se.compte AND rl.piece = se.piece AND (rl.journal = '' OR rl.journal = se.journal) ORDER BY rl.cree_le LIMIT 1) AS lien,
       (se.journal <> 'RAN' AND se.sens = 1) AS est_reglement,
       (se.journal <> 'RAN' AND se.sens = 1 AND est_regularisation(se.compte, se.journal, se.piece, se.intitule)) AS est_regularisation
  FROM sage_ecritures se
  JOIN extractions x ON x.id = se.extraction_id AND x.statut = 'active'
  LEFT JOIN etiquettes_payeur ep ON ep.compte = se.compte AND ep.nature = 'reglement' AND ep.piece = se.piece AND (ep.journal = '' OR ep.journal = se.journal)
  LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('lien', rl.lien, 'piece_liee', rl.piece_liee, 'compte_lie', rl.compte_lie, 'note', rl.note)) AS liens
        FROM reglements_liens rl WHERE rl.compte = se.compte AND rl.piece = se.piece AND (rl.journal = '' OR rl.journal = se.journal)) li ON true;

CREATE OR REPLACE VIEW vue_livraisons WITH (security_invoker = true) AS
SELECT sl.*, ep.payeur
  FROM sage_livraisons sl JOIN extractions x ON x.id = sl.extraction_id AND x.statut = 'active'
  LEFT JOIN etiquettes_payeur ep ON ep.compte = sl.compte AND ep.nature = 'bon' AND ep.piece = sl.piece;

CREATE OR REPLACE VIEW vue_facturation WITH (security_invoker = true) AS
SELECT sf.* FROM sage_facturation sf JOIN extractions x ON x.id = sf.extraction_id AND x.statut = 'active';

-- Pièces couvrant plusieurs clients (même journal, pièce, date sur ≥ 2 comptes) : détection automatique CDC-05 §3.3
CREATE OR REPLACE VIEW vue_pieces_multi_clients WITH (security_invoker = true) AS
SELECT journal, piece, date_ecriture, count(DISTINCT compte) AS nb_comptes, SUM(montant) AS total,
       jsonb_agg(jsonb_build_object('compte', compte, 'montant', montant) ORDER BY compte) AS repartition
  FROM vue_ecritures WHERE est_reglement AND piece IS NOT NULL
 GROUP BY journal, piece, date_ecriture HAVING count(DISTINCT compte) > 1;

-- Soldes par payeur (comptes collectifs) : bons étiquetés − règlements étiquetés
CREATE OR REPLACE VIEW vue_soldes_payeur WITH (security_invoker = true) AS
SELECT compte, payeur,
       COALESCE(SUM(bons), 0) AS bons, COALESCE(SUM(reglements), 0) AS reglements, COALESCE(SUM(bons), 0) - COALESCE(SUM(reglements), 0) AS solde
  FROM (SELECT compte, payeur, montant_ht AS bons, 0 AS reglements FROM vue_livraisons WHERE payeur IS NOT NULL
        UNION ALL
        SELECT compte, payeur, 0, montant FROM vue_ecritures WHERE payeur IS NOT NULL AND est_reglement) t
 GROUP BY compte, payeur;

-- Agrégats mensuels (facturé / encaissé) calculés en base : jamais tronqués par la pagination de l'API
CREATE OR REPLACE FUNCTION facturation_mensuelle() RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH x AS (SELECT id, date_extraction FROM extractions WHERE statut = 'active'),
    f AS (SELECT mois, SUM(ht) AS facture FROM sage_facturation sf JOIN x ON x.id = sf.extraction_id GROUP BY mois),
    e AS (SELECT to_char(date_ecriture, 'YYYY-MM') AS mois, SUM(montant) AS encaisse FROM sage_ecritures se JOIN x ON x.id = se.extraction_id
           WHERE journal <> 'RAN' AND sens = 1 GROUP BY 1),
    m AS (SELECT mois FROM f UNION SELECT mois FROM e)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('mois', m.mois, 'facture', COALESCE(f.facture, 0), 'encaisse', COALESCE(e.encaisse, 0)) ORDER BY m.mois), '[]'::jsonb)
      FROM m LEFT JOIN f USING (mois) LEFT JOIN e USING (mois); $$;

-- Clients facturés le mois clos mais sans facture le mois courant (signal gescom)
CREATE OR REPLACE FUNCTION clients_sans_facture_mois() RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH x AS (SELECT id, to_char(date_extraction, 'YYYY-MM') AS mois, to_char(date_trunc('month', date_extraction) - INTERVAL '1 month', 'YYYY-MM') AS mois_clos FROM extractions WHERE statut = 'active')
    SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', c.compte, 'intitule', c.intitule, 'solde', c.solde, 'derniere_facture', c.derniere_facture) ORDER BY c.solde DESC), '[]'::jsonb)
      FROM clients_calc c, x
     WHERE EXISTS (SELECT 1 FROM sage_facturation sf WHERE sf.extraction_id = x.id AND sf.compte = c.compte AND sf.mois = x.mois_clos AND sf.ht > 0)
       AND NOT EXISTS (SELECT 1 FROM sage_facturation sf WHERE sf.extraction_id = x.id AND sf.compte = c.compte AND sf.mois = x.mois AND sf.ht > 0); $$;

-- ------------------------------------------------------------
-- Tableau de bord (agrégats en une passe, top 10 pour le bouclage CDC-05 §3.5)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tableau_de_bord() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    x extractions;
    v_mois TEXT; v_mois_clos TEXT;
    r RECORD; f RECORD;
    v_reste NUMERIC; v_age INT;
    v_b0 NUMERIC := 0; v_b1 NUMERIC := 0; v_b2 NUMERIC := 0; v_b3 NUMERIC := 0;
    v_fact_12 NUMERIC; v_encours NUMERIC; v_mens JSONB;
    v_peremption INT := COALESCE((parametre('seuils')->>'peremption_donnees_jours')::INT, 1);
BEGIN
    SELECT * INTO x FROM extractions WHERE statut = 'active';
    IF x.id IS NULL THEN RETURN jsonb_build_object('sans_donnees', true); END IF;
    v_mois := to_char(x.date_extraction, 'YYYY-MM');
    v_mois_clos := to_char(date_trunc('month', x.date_extraction) - INTERVAL '1 month', 'YYYY-MM');
    v_mens := facturation_mensuelle();

    -- Balance âgée par ancienneté de facturation : le solde est affecté aux mois de facturation les plus récents (les plus anciens sont réputés payés)
    FOR r IN SELECT compte, solde FROM clients_calc WHERE solde > 1000 LOOP
        v_reste := r.solde;
        FOR f IN SELECT mois, ht FROM sage_facturation WHERE extraction_id = x.id AND compte = r.compte AND ht > 0 ORDER BY mois DESC LOOP
            EXIT WHEN v_reste <= 0;
            v_age := (x.date_extraction - to_date(f.mois || '-01', 'YYYY-MM-DD'))::INT;
            IF v_age <= 30 THEN v_b0 := v_b0 + LEAST(v_reste, f.ht);
            ELSIF v_age <= 60 THEN v_b1 := v_b1 + LEAST(v_reste, f.ht);
            ELSIF v_age <= 90 THEN v_b2 := v_b2 + LEAST(v_reste, f.ht);
            ELSE v_b3 := v_b3 + LEAST(v_reste, f.ht); END IF;
            v_reste := v_reste - f.ht;
        END LOOP;
        IF v_reste > 0 THEN v_b3 := v_b3 + v_reste; END IF;  -- reliquat = RAN ou débits hors RAN : réputé ancien
    END LOOP;

    SELECT COALESCE(SUM((m->>'facture')::NUMERIC), 0) INTO v_fact_12 FROM jsonb_array_elements(v_mens) m
     WHERE m->>'mois' <= v_mois_clos AND m->>'mois' > to_char(date_trunc('month', x.date_extraction) - INTERVAL '13 months', 'YYYY-MM');
    SELECT COALESCE(SUM(solde) FILTER (WHERE solde > 0), 0) INTO v_encours FROM clients_calc;

    RETURN jsonb_build_object(
        'date_extraction', x.date_extraction,
        'saisi_jusquau', x.saisi_jusquau,
        'source', x.source,
        'donnees_perimees', (CURRENT_DATE - x.date_extraction) > v_peremption,
        'creances_totales', v_encours,
        'avances', (SELECT COALESCE(SUM(-solde) FILTER (WHERE solde < 0), 0) FROM clients_calc),
        'clients_debiteurs', (SELECT count(*) FROM clients_calc WHERE solde > 1000),
        'a_relancer', (SELECT count(*) FROM vue_clients WHERE statut = 'à relancer'),
        'a_relancer_montant', (SELECT COALESCE(SUM(solde), 0) FROM vue_clients WHERE statut = 'à relancer'),
        'facture_mois', (SELECT COALESCE((m->>'facture')::NUMERIC, 0) FROM jsonb_array_elements(v_mens) m WHERE m->>'mois' = v_mois),
        'encaisse_mois', (SELECT COALESCE((m->>'encaisse')::NUMERIC, 0) FROM jsonb_array_elements(v_mens) m WHERE m->>'mois' = v_mois),
        'facture_mois_clos', (SELECT COALESCE((m->>'facture')::NUMERIC, 0) FROM jsonb_array_elements(v_mens) m WHERE m->>'mois' = v_mois_clos),
        'encaisse_mois_clos', (SELECT COALESCE((m->>'encaisse')::NUMERIC, 0) FROM jsonb_array_elements(v_mens) m WHERE m->>'mois' = v_mois_clos),
        'mois', v_mois, 'mois_clos', v_mois_clos,
        'dso_jours', CASE WHEN v_fact_12 > 0 THEN ROUND(v_encours / v_fact_12 * 365) ELSE NULL END,
        'creances_90j', v_b3,
        'part_creances_90j', CASE WHEN v_encours > 0 THEN ROUND(100 * v_b3 / v_encours, 1) ELSE 0 END,
        'balance_facturation', jsonb_build_object('0_30', v_b0, '31_60', v_b1, '61_90', v_b2, 'plus_90', v_b3),
        'balance_dernier_reglement', (SELECT jsonb_build_object(
            '0_30', COALESCE(SUM(solde) FILTER (WHERE jours_sans_reglement <= 30), 0),
            '31_60', COALESCE(SUM(solde) FILTER (WHERE jours_sans_reglement BETWEEN 31 AND 60), 0),
            '61_90', COALESCE(SUM(solde) FILTER (WHERE jours_sans_reglement BETWEEN 61 AND 90), 0),
            'plus_90', COALESCE(SUM(solde) FILTER (WHERE jours_sans_reglement > 90 OR jours_sans_reglement IS NULL), 0))
            FROM vue_clients WHERE solde > 1000),
        'top_debiteurs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde, 'jours', jours_sans_reglement,
                                'statut', statut, 'typologie', typologie, 'score', score) ORDER BY solde DESC), '[]'::jsonb)
                          FROM (SELECT * FROM vue_clients WHERE solde > 0 ORDER BY solde DESC LIMIT 10) t),
        'total_top_10', (SELECT COALESCE(SUM(solde), 0) FROM (SELECT solde FROM clients_calc WHERE solde > 0 ORDER BY solde DESC LIMIT 10) t),
        'promesses_semaine', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'compte', a.compte, 'intitule', cc.intitule, 'montant', a.montant, 'echeance', a.echeance, 'auteur', a.auteur) ORDER BY a.echeance), '[]'::jsonb)
                              FROM actions a JOIN clients_calc cc ON cc.compte = a.compte
                              WHERE a.statut = 'ouverte' AND a.type IN ('promesse', 'plan') AND a.echeance BETWEEN CURRENT_DATE AND CURRENT_DATE + 7),
        'promesses_echues', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'compte', a.compte, 'intitule', cc.intitule, 'montant', a.montant, 'echeance', a.echeance, 'auteur', a.auteur) ORDER BY a.echeance), '[]'::jsonb)
                             FROM actions a JOIN clients_calc cc ON cc.compte = a.compte
                             WHERE a.statut = 'ouverte' AND a.type IN ('promesse', 'plan') AND a.echeance < CURRENT_DATE),
        'prevision_30j', (SELECT COALESCE(SUM(montant), 0) FROM actions WHERE statut = 'ouverte' AND type = 'promesse' AND echeance BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)
                         + (SELECT COALESCE(SUM(pe.montant), 0) FROM plans_echeances pe JOIN actions a ON a.id = pe.action_id WHERE a.statut = 'ouverte' AND pe.tenue IS NOT TRUE AND pe.echeance BETWEEN CURRENT_DATE AND CURRENT_DATE + 30),
        'prevision_60j', (SELECT COALESCE(SUM(montant), 0) FROM actions WHERE statut = 'ouverte' AND type = 'promesse' AND echeance BETWEEN CURRENT_DATE AND CURRENT_DATE + 60)
                         + (SELECT COALESCE(SUM(pe.montant), 0) FROM plans_echeances pe JOIN actions a ON a.id = pe.action_id WHERE a.statut = 'ouverte' AND pe.tenue IS NOT TRUE AND pe.echeance BETWEEN CURRENT_DATE AND CURRENT_DATE + 60),
        'taux_promesses_tenues', (SELECT CASE WHEN count(*) > 0 THEN ROUND(100.0 * count(*) FILTER (WHERE resultat = 'tenue') / count(*)) ELSE NULL END
                                  FROM actions WHERE type IN ('promesse', 'plan') AND statut = 'fermee'),
        'taches_du_jour', (SELECT count(*) FROM actions WHERE statut = 'ouverte' AND type IN ('tache', 'appel') AND echeance <= CURRENT_DATE),
        'contentieux', (SELECT count(*) FROM vue_clients WHERE statut = 'contentieux'),
        'limites_depassees', (SELECT count(*) FROM vue_clients WHERE limite_depassee),
        'bv_bloques', (SELECT count(*) FROM clients_calc WHERE bv_bloque),
        'courbe_12_mois', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mois', to_char(g, 'YYYY-MM'),
                                'facture', COALESCE((SELECT (m->>'facture')::NUMERIC FROM jsonb_array_elements(v_mens) m WHERE m->>'mois' = to_char(g, 'YYYY-MM')), 0),
                                'encaisse', COALESCE((SELECT (m->>'encaisse')::NUMERIC FROM jsonb_array_elements(v_mens) m WHERE m->>'mois' = to_char(g, 'YYYY-MM')), 0)) ORDER BY g), '[]'::jsonb)
                           FROM generate_series(date_trunc('month', x.date_extraction) - INTERVAL '11 months', date_trunc('month', x.date_extraction), INTERVAL '1 month') g)
    );
END; $$;

-- Alertes du matin
CREATE OR REPLACE FUNCTION alertes_du_jour() RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH vc AS (SELECT * FROM vue_clients)
    SELECT jsonb_build_object(
        'decrochages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde, 'jours', jours_sans_reglement, 'seuil', seuil_alerte_jours, 'typologie', typologie) ORDER BY solde DESC), '[]'::jsonb)
                        FROM vc WHERE decroche AND statut = 'à relancer'),
        'promesses_echues', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', a.compte, 'intitule', c.intitule, 'montant', a.montant, 'echeance', a.echeance) ORDER BY a.echeance), '[]'::jsonb)
                             FROM actions a JOIN clients_calc c ON c.compte = a.compte WHERE a.statut = 'ouverte' AND a.type = 'promesse' AND a.echeance < CURRENT_DATE),
        'limites_depassees', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde, 'limite', limite_credit) ORDER BY solde DESC), '[]'::jsonb) FROM vc WHERE limite_depassee),
        'comptes_muets', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde) ORDER BY solde DESC), '[]'::jsonb) FROM vc WHERE typologie = 'compte muet' AND solde > 0),
        'bv_bloques', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde, 'ratio', ratio_bv, 'bons', bons_servis) ORDER BY solde DESC), '[]'::jsonb) FROM vc WHERE bv_bloque),
        'avances_qui_fondent', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'avance', -solde) ORDER BY solde), '[]'::jsonb) FROM vc WHERE solde < -1000 AND facture_exercice > 0 AND -solde < facture_exercice / 12)
    ); $$;

-- ------------------------------------------------------------
-- Actions CRM : une seule voie d'écriture (fonctions), règles vérifiées aussi par trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION controler_action() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_solde NUMERIC; v_min NUMERIC := COALESCE((parametre('seuils')->>'promesse_part_min')::NUMERIC, 50);
BEGIN
    IF est_service() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT solde INTO v_solde FROM clients_calc WHERE compte = NEW.compte;
        IF v_solde IS NULL THEN RAISE EXCEPTION 'Compte % inconnu de l''extraction active', NEW.compte; END IF;
        IF NEW.type = 'contentieux' AND NOT est_dg() THEN RAISE EXCEPTION 'Le passage en contentieux est une décision du DG'; END IF;
        IF NEW.type = 'contentieux' AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.compte = NEW.compte AND a.type = 'mise_en_demeure') THEN
            RAISE EXCEPTION 'Étape pré-contentieuse obligatoire : générez d''abord la mise en demeure';
        END IF;
        IF NEW.type IN ('relance', 'mise_en_demeure', 'contentieux') AND v_solde < -1000 THEN RAISE EXCEPTION 'Client créditeur : relance interdite'; END IF;
        IF NEW.type = 'promesse' AND (NEW.montant IS NULL OR NEW.montant <= 0 OR NEW.echeance IS NULL) THEN RAISE EXCEPTION 'Une promesse exige un montant et une échéance'; END IF;
        IF NEW.type = 'promesse' AND v_solde > 0 AND NEW.montant < v_solde * v_min / 100 THEN
            RAISE EXCEPTION 'Montant promis inférieur à % %% du solde exigible : enregistrez un plan de paiement', v_min;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.type <> OLD.type OR NEW.compte <> OLD.compte OR NEW.date_action <> OLD.date_action OR NEW.auteur_id IS DISTINCT FROM OLD.auteur_id OR NEW.cree_le <> OLD.cree_le THEN
            RAISE EXCEPTION 'Une action ne se réécrit pas : fermez-la et créez-en une autre';
        END IF;
        IF OLD.type = 'contentieux' AND NEW.statut = 'fermee' AND OLD.statut = 'ouverte' AND NOT est_dg() THEN RAISE EXCEPTION 'La sortie du contentieux est une décision du DG'; END IF;
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_actions_controle BEFORE INSERT OR UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION controler_action();

CREATE OR REPLACE FUNCTION refuser_suppression() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF est_service() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Suppression interdite (la preuve de tout) : fermez l''élément avec un motif';
END; $$;
CREATE TRIGGER trg_actions_nodelete BEFORE DELETE ON actions FOR EACH ROW EXECUTE FUNCTION refuser_suppression();
CREATE TRIGGER trg_messages_nodelete BEFORE DELETE ON messages_sortants FOR EACH ROW EXECUTE FUNCTION refuser_suppression();

-- Un message de relance ne part jamais vers un client créditeur
CREATE OR REPLACE FUNCTION controler_message() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.modele IN ('relance_amiable', 'relance_ferme', 'mise_en_demeure')
       AND EXISTS (SELECT 1 FROM clients_calc WHERE compte = NEW.compte AND solde < -1000) THEN
        RAISE EXCEPTION 'Client créditeur : aucun message de relance';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_messages_controle BEFORE INSERT ON messages_sortants FOR EACH ROW EXECUTE FUNCTION controler_message();

CREATE OR REPLACE FUNCTION creer_action(p_compte VARCHAR, p_type type_action_enum, p_note TEXT DEFAULT NULL, p_montant NUMERIC DEFAULT NULL,
                                        p_echeance DATE DEFAULT NULL, p_canal canal_enum DEFAULT NULL, p_niveau INT DEFAULT NULL,
                                        p_assignee UUID DEFAULT NULL, p_date_action DATE DEFAULT CURRENT_DATE, p_echeances JSONB DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; e JSONB;
BEGIN
    IF NOT peut_recouvrer() THEN RAISE EXCEPTION 'Droits insuffisants pour créer une action'; END IF;
    IF p_type = 'plan' AND (p_echeances IS NULL OR jsonb_array_length(p_echeances) = 0) THEN
        RAISE EXCEPTION 'Un plan de paiement exige au moins une échéance';
    END IF;
    IF p_date_action > CURRENT_DATE THEN RAISE EXCEPTION 'Une action ne se date pas dans le futur'; END IF;
    -- une seule relance / promesse / plan ouvert à la fois (le contentieux et la mise en demeure restent ouverts en parallèle)
    IF p_type IN ('relance', 'promesse', 'plan') THEN
        UPDATE actions SET statut = 'fermee', ferme_le = now(), ferme_motif = 'Remplacée par ' || p_type::TEXT
         WHERE compte = p_compte AND statut = 'ouverte' AND type IN ('relance', 'promesse', 'plan');
    END IF;
    INSERT INTO actions (compte, type, note, montant, echeance, canal, niveau, assignee_id, auteur_id, auteur, date_action)
    VALUES (p_compte, p_type, p_note, p_montant, p_echeance, p_canal, COALESCE(p_niveau, CASE WHEN p_type = 'mise_en_demeure' THEN 4 END), p_assignee, auth.uid(), COALESCE(nom_courant(), 'système'), p_date_action)
    RETURNING id INTO v_id;
    IF p_type = 'plan' THEN
        FOR e IN SELECT * FROM jsonb_array_elements(p_echeances) LOOP
            INSERT INTO plans_echeances (action_id, echeance, montant) VALUES (v_id, (e->>'echeance')::DATE, (e->>'montant')::NUMERIC);
        END LOOP;
        UPDATE actions SET montant = (SELECT SUM(montant) FROM plans_echeances WHERE action_id = v_id),
                           echeance = (SELECT MIN(echeance) FROM plans_echeances WHERE action_id = v_id) WHERE id = v_id;
    END IF;
    PERFORM journaliser('action_' || p_type::TEXT, p_compte, jsonb_build_object('id', v_id, 'montant', p_montant, 'echeance', p_echeance, 'niveau', p_niveau));
    RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION fermer_action(p_id UUID, p_motif TEXT DEFAULT NULL, p_resultat VARCHAR DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a actions;
BEGIN
    IF NOT peut_recouvrer() THEN RAISE EXCEPTION 'Droits insuffisants'; END IF;
    SELECT * INTO a FROM actions WHERE id = p_id;
    IF a.id IS NULL THEN RAISE EXCEPTION 'Action introuvable'; END IF;
    IF a.statut = 'fermee' THEN RAISE EXCEPTION 'Action déjà close'; END IF;
    IF a.type = 'contentieux' AND NOT est_dg() THEN RAISE EXCEPTION 'La sortie du contentieux est une décision du DG'; END IF;
    UPDATE actions SET statut = 'fermee', ferme_le = now(), ferme_motif = p_motif, resultat = COALESCE(p_resultat, resultat) WHERE id = p_id;
    PERFORM journaliser('fermeture_' || a.type::TEXT, a.compte, jsonb_build_object('id', p_id, 'motif', p_motif, 'resultat', p_resultat));
END; $$;

-- Import des actions de la maquette (30_CLIENTS/data/crm_*.json) : {id, compte, type, note, echeance, date, statut, auteur}
CREATE OR REPLACE FUNCTION importer_actions_maquette(p_actions JSONB) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a JSONB; n INT := 0;
BEGIN
    IF NOT peut_recouvrer() THEN RAISE EXCEPTION 'Droits insuffisants'; END IF;
    FOR a IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
        CONTINUE WHEN NOT (a->>'type' IN ('relance', 'promesse', 'contentieux', 'note')) OR NOT compte_dans_perimetre(a->>'compte');
        INSERT INTO actions (compte, type, note, echeance, date_action, statut, auteur, ferme_le, ferme_motif, montant)
        VALUES (a->>'compte', (a->>'type')::type_action_enum, a->>'note', vers_date(a->>'echeance'), COALESCE(vers_date(a->>'date'), CURRENT_DATE),
                CASE WHEN a->>'statut' = 'fermée' THEN 'fermee' ELSE 'ouverte' END, COALESCE(a->>'auteur', 'maquette'),
                CASE WHEN a->>'statut' = 'fermée' THEN now() END, CASE WHEN a->>'statut' = 'fermée' THEN 'Importée close depuis la maquette' END,
                vers_numeric((regexp_match(COALESCE(a->>'note', ''), '(\d[\d ]{5,})'))[1]));
        n := n + 1;
    END LOOP;
    PERFORM journaliser('import_actions_maquette', NULL, jsonb_build_object('nb', n));
    RETURN n;
END; $$;

-- Rendu d'un modèle de message pour un client (variables {{...}})
CREATE OR REPLACE FUNCTION rendre_message(p_code VARCHAR, p_compte VARCHAR) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE c RECORD; v TEXT; x extractions; s JSONB := parametre('societe');
BEGIN
    SELECT corps INTO v FROM modeles_messages WHERE code = p_code;
    SELECT * INTO c FROM vue_clients WHERE compte = p_compte;
    SELECT * INTO x FROM extractions WHERE statut = 'active';
    IF v IS NULL OR c.compte IS NULL THEN RETURN COALESCE(v, ''); END IF;
    v := replace(v, '{{client}}', c.intitule);
    v := replace(v, '{{compte}}', c.compte);
    v := replace(v, '{{solde}}', replace(to_char(GREATEST(c.solde, 0), 'FM999G999G999G990'), ',', ' '));
    v := replace(v, '{{avance}}', replace(to_char(GREATEST(-c.solde, 0), 'FM999G999G999G990'), ',', ' '));
    v := replace(v, '{{facture_exercice}}', replace(to_char(c.facture_exercice, 'FM999G999G999G990'), ',', ' '));
    v := replace(v, '{{regle}}', replace(to_char(c.regle, 'FM999G999G999G990'), ',', ' '));
    v := replace(v, '{{dernier_reglement}}', COALESCE(to_char(c.dernier_reglement, 'DD/MM/YYYY'), 'aucun'));
    v := replace(v, '{{jours}}', COALESCE(c.jours_sans_reglement::TEXT, '—'));
    v := replace(v, '{{date}}', to_char(CURRENT_DATE, 'DD/MM/YYYY'));
    v := replace(v, '{{date_donnees}}', COALESCE(to_char(x.date_extraction, 'DD/MM/YYYY'), '—'));
    v := replace(v, '{{societe}}', COALESCE(s->>'nom', 'RPS'));
    v := replace(v, '{{signature}}', COALESCE(nom_courant(), '') || E'\n' || COALESCE(s->>'nom', 'RPS') || ' — ' || COALESCE(s->>'telephone', ''));
    RETURN v;
END; $$;

-- ------------------------------------------------------------
-- Sécurité (RLS) : lecture pour tout utilisateur actif ; écriture selon le rôle ; les actions ne s'écrivent
-- que par les fonctions creer_action / fermer_action (SECURITY DEFINER, règles + journal) ; jamais de DELETE.
-- ------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER TABLE profils ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametres ENABLE ROW LEVEL SECURITY;
ALTER TABLE extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_facturation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_ecritures ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_livraisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_calc ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_historique ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_pipeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_ext ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans_echeances ENABLE ROW LEVEL SECURITY;
ALTER TABLE modeles_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages_sortants ENABLE ROW LEVEL SECURITY;
ALTER TABLE etiquettes_payeur ENABLE ROW LEVEL SECURITY;
ALTER TABLE reglements_liens ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY profils_lecture ON profils FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY profils_soi ON profils FOR UPDATE TO authenticated USING (id = auth.uid() OR est_dg()) WITH CHECK (id = auth.uid() OR est_dg());   -- rôle/actif protégés par trigger
CREATE POLICY parametres_lecture ON parametres FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY parametres_dg ON parametres FOR ALL TO authenticated USING (est_dg()) WITH CHECK (est_dg());
CREATE POLICY extractions_lecture ON extractions FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY lots_lecture ON extraction_lots FOR SELECT TO authenticated USING (peut_recouvrer());
CREATE POLICY sage_clients_lecture ON sage_clients FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY sage_fact_lecture ON sage_facturation FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY sage_ecr_lecture ON sage_ecritures FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY sage_livr_lecture ON sage_livraisons FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY calc_lecture ON clients_calc FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY histo_lecture ON clients_historique FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY pipeline_lecture ON clients_pipeline FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY ext_lecture ON clients_ext FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY ext_insertion ON clients_ext FOR INSERT TO authenticated WITH CHECK (peut_recouvrer());
CREATE POLICY ext_maj ON clients_ext FOR UPDATE TO authenticated USING (peut_recouvrer()) WITH CHECK (peut_recouvrer());
CREATE POLICY actions_lecture ON actions FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY plans_lecture ON plans_echeances FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY modeles_lecture ON modeles_messages FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY modeles_dg ON modeles_messages FOR ALL TO authenticated USING (est_dg()) WITH CHECK (est_dg());
CREATE POLICY messages_lecture ON messages_sortants FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY messages_ecriture ON messages_sortants FOR INSERT TO authenticated WITH CHECK (peut_recouvrer());
CREATE POLICY payeur_lecture ON etiquettes_payeur FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY payeur_ecriture ON etiquettes_payeur FOR ALL TO authenticated USING (peut_pointer()) WITH CHECK (peut_pointer());
CREATE POLICY liens_lecture ON reglements_liens FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY liens_ecriture ON reglements_liens FOR ALL TO authenticated USING (peut_pointer()) WITH CHECK (peut_pointer());
CREATE POLICY documents_lecture ON documents FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY documents_ecriture ON documents FOR INSERT TO authenticated WITH CHECK (peut_pointer());
CREATE POLICY audit_lecture ON audit FOR SELECT TO authenticated USING (role_courant() IN ('dg', 'controle'));

-- Suppressions journalisées sur le pointage
CREATE OR REPLACE FUNCTION journaliser_suppression() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO audit (qui, qui_nom, quoi, compte, detail) VALUES (auth.uid(), nom_courant(), 'suppression_' || TG_TABLE_NAME, OLD.compte, to_jsonb(OLD));
    RETURN OLD;
END; $$;
CREATE TRIGGER trg_payeur_suppression AFTER DELETE ON etiquettes_payeur FOR EACH ROW EXECUTE FUNCTION journaliser_suppression();
CREATE TRIGGER trg_liens_suppression AFTER DELETE ON reglements_liens FOR EACH ROW EXECUTE FUNCTION journaliser_suppression();

-- Droits d'exécution explicites (les autres fonctions restent réservées : ALTER DEFAULT PRIVILEGES ci-dessus ne
-- s'applique qu'aux fonctions créées ensuite, on révoque donc explicitement les fonctions sensibles)
REVOKE EXECUTE ON FUNCTION pont_debut_extraction(DATE, VARCHAR, DATE, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION pont_abandonner_extraction(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION pont_ajouter_lignes(UUID, VARCHAR, JSONB, INT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION pont_activer_extraction(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION recalculer_clients() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION rafraichir_pipeline(VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION creer_action(VARCHAR, type_action_enum, TEXT, NUMERIC, DATE, canal_enum, INT, UUID, DATE, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION fermer_action(UUID, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION importer_actions_maquette(JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION tableau_de_bord() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION alertes_du_jour() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION facturation_mensuelle() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION clients_sans_facture_mois() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION rendre_message(VARCHAR, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pont_debut_extraction(DATE, VARCHAR, DATE, TEXT, JSONB, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pont_abandonner_extraction(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pont_ajouter_lignes(UUID, VARCHAR, JSONB, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pont_activer_extraction(UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION recalculer_clients() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION creer_action(VARCHAR, type_action_enum, TEXT, NUMERIC, DATE, canal_enum, INT, UUID, DATE, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fermer_action(UUID, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION importer_actions_maquette(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION tableau_de_bord() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION alertes_du_jour() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION facturation_mensuelle() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION clients_sans_facture_mois() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION rendre_message(VARCHAR, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION journaliser(VARCHAR, VARCHAR, JSONB) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Paramétrage de départ (CDC-05 §3.4, §8)
-- ------------------------------------------------------------
INSERT INTO parametres (cle, valeur) VALUES
('societe', '{"nom": "RISSA PETROLEUM SERVICE", "sigle": "RPS", "adresse": "B.P. 2184 Niamey", "ville": "Niamey", "pays": "Niger", "nif": "7272/R", "telephone": "", "email": "", "site": "apps.rps.ne"}'),
('seuils', '{"solde_min_relance": 500000, "jours_generique": 30, "coef_cadence": 1.5, "cadence_min_jours": 10, "cadence_max_jours": 45, "promesse_part_min": 50, "n3_jours": 60, "n4_jours": 90, "peremption_donnees_jours": 1, "part_min_reglement_couvrant": 25, "tolerance_promesse_jours": 7, "bv_ratio_max": 1.5, "journaux_mobile_money": ["NITA", "CAINIT"], "stagnation_jours": 14, "exercice": null}'),
('sequences', '{"N1": {"libelle": "Préventif : envoi du relevé", "declencheur": "J+3 après facturation du mois"}, "N2": {"libelle": "Amiable : message + appel", "declencheur": "décrochage de cadence ou solde > seuil et > 30 j"}, "N3": {"libelle": "Ferme : courrier à la charte + copie DG", "declencheur": "> 60 jours"}, "N4": {"libelle": "Pré-contentieux : mise en demeure (décision DG)", "declencheur": "> 90 jours ou promesse non tenue 2 fois"}}');

INSERT INTO modeles_messages (code, libelle, canal, niveau, corps, valide_par_dg) VALUES
('releve', 'N1 — Envoi du relevé (préventif)', 'whatsapp', 1,
 E'Bonjour {{client}},\n\nVeuillez trouver votre situation RPS au {{date_donnees}} : facturé {{facture_exercice}} F, réglé {{regle}} F, solde dû {{solde}} F (dernier règlement le {{dernier_reglement}}).\n\nNous restons à votre disposition pour tout rapprochement.\n\n{{signature}}', false),
('relance_amiable', 'N2 — Relance amiable', 'whatsapp', 2,
 E'Bonjour {{client}},\n\nSauf erreur de notre part, votre compte {{compte}} présente au {{date_donnees}} un solde dû de {{solde}} F, sans règlement depuis le {{dernier_reglement}} ({{jours}} jours).\n\nMerci de nous indiquer la date et le montant de votre prochain règlement.\n\n{{signature}}', false),
('relance_ferme', 'N3 — Relance ferme', 'email', 3,
 E'Madame, Monsieur,\n\nMalgré nos précédentes relances, le solde de votre compte {{compte}} s''élève à {{solde}} F au {{date_donnees}}, sans règlement depuis {{jours}} jours.\n\nNous vous demandons de régulariser cette situation sous huit jours. À défaut, nous serons contraints de suspendre les livraisons et d''engager les démarches de recouvrement prévues par la réglementation OHADA.\n\nCopie : Direction Générale.\n\n{{signature}}', false),
('mise_en_demeure', 'N4 — Mise en demeure (pré-contentieux)', 'courrier', 4,
 E'MISE EN DEMEURE\n\n{{client}} — compte {{compte}}\n\nPar la présente, {{societe}} vous met en demeure de régler la somme de {{solde}} F CFA correspondant au solde de votre compte arrêté au {{date_donnees}}, sous huitaine à compter de la réception de ce courrier.\n\nÀ défaut de règlement dans ce délai, nous engagerons sans autre préavis une procédure d''injonction de payer conformément à l''Acte uniforme OHADA portant organisation des procédures simplifiées de recouvrement et des voies d''exécution.\n\nFait à Niamey, le {{date}}.\n\n{{signature}}', false),
('remerciement', 'Remerciement de règlement', 'whatsapp', NULL,
 E'Bonjour {{client}},\n\nNous accusons réception de votre règlement, avec nos remerciements. Votre solde au {{date_donnees}} est de {{solde}} F.\n\n{{signature}}', false);
