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
CREATE TYPE type_action_enum AS ENUM ('relance', 'promesse', 'plan', 'contentieux', 'note', 'tache', 'appel');
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

CREATE OR REPLACE FUNCTION creer_profil_utilisateur() RETURNS TRIGGER
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role role_enum := 'exploitation';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profils) THEN v_role := 'dg'; END IF;
    INSERT INTO profils (id, email, nom, role)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1)), v_role)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_auth_user_profil AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION creer_profil_utilisateur();

CREATE OR REPLACE FUNCTION role_courant() RETURNS role_enum
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role FROM profils WHERE id = auth.uid() AND actif = true; $$;
CREATE OR REPLACE FUNCTION nom_courant() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT nom FROM profils WHERE id = auth.uid(); $$;
CREATE OR REPLACE FUNCTION est_utilisateur_actif() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT role_courant() IS NOT NULL; $$;
CREATE OR REPLACE FUNCTION est_dg() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT role_courant() = 'dg'; $$;
CREATE OR REPLACE FUNCTION peut_recouvrer() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT role_courant() IN ('dg', 'recouvrement'); $$;
CREATE OR REPLACE FUNCTION peut_pointer() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT role_courant() IN ('dg', 'recouvrement', 'compta'); $$;

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
    commentaire TEXT,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_le TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_extraction_active ON extractions (statut) WHERE statut = 'active';

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
    station VARCHAR(40)                   -- numéro/nom de station déduit de l'intitulé de dépôt (le numéro fait foi)
);
CREATE INDEX idx_sage_livr ON sage_livraisons (extraction_id, compte, date_livraison);

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
    jours_sans_reglement INT,
    typologie_auto VARCHAR(40) NOT NULL DEFAULT 'standard',
    score INT NOT NULL DEFAULT 100,
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
    resultat VARCHAR(20),                           -- promesse : tenue | non_tenue | annulee
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
CREATE TRIGGER trg_actions_maj BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION maj_modifie_le();

CREATE TABLE plans_echeances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id UUID NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    echeance DATE NOT NULL,
    montant NUMERIC(16,0) NOT NULL,
    tenue BOOLEAN,
    reglee_par_piece VARCHAR(30)
);

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

CREATE TABLE etiquettes_payeur (            -- comptes collectifs (ex. SSN) : payeur par pièce
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte VARCHAR(16) NOT NULL,
    piece VARCHAR(30) NOT NULL,
    payeur VARCHAR(80) NOT NULL,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    UNIQUE (compte, piece)
);

CREATE TABLE reglements_liens (             -- particularités CDC-05 §3.3
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compte VARCHAR(16) NOT NULL,
    piece VARCHAR(30) NOT NULL,
    lien lien_reglement_enum NOT NULL,
    piece_liee VARCHAR(30),
    compte_lie VARCHAR(16),
    note TEXT,
    cree_par UUID REFERENCES profils(id) ON DELETE SET NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_liens_compte ON reglements_liens (compte, piece);

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

CREATE OR REPLACE FUNCTION journaliser(p_quoi VARCHAR, p_compte VARCHAR DEFAULT NULL, p_detail JSONB DEFAULT NULL) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO audit (qui, qui_nom, quoi, compte, detail) VALUES (auth.uid(), nom_courant(), p_quoi, p_compte, p_detail); $$;

-- ------------------------------------------------------------
-- Fonctions du pont : chargement d'une extraction (chunks) puis activation
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pont_debut_extraction(p_date DATE, p_source VARCHAR DEFAULT 'api', p_saisi_jusquau DATE DEFAULT NULL, p_commentaire TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
    -- une extraction en cours abandonnée depuis plus d'une heure est purgée
    DELETE FROM extractions WHERE statut = 'en_cours' AND cree_le < now() - INTERVAL '1 hour';
    INSERT INTO extractions (date_extraction, source, saisi_jusquau, commentaire, cree_par)
    VALUES (p_date, p_source, p_saisi_jusquau, p_commentaire, auth.uid()) RETURNING id INTO v_id;
    RETURN v_id;
END; $$;

-- p_jeu : clients | facturation | ecritures | livraisons ; p_lignes : tableau de tableaux au format des requêtes qr0/qr1/qr3/qr4
CREATE OR REPLACE FUNCTION pont_ajouter_lignes(p_extraction UUID, p_jeu VARCHAR, p_lignes JSONB)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT; v_base INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM extractions WHERE id = p_extraction AND statut = 'en_cours') THEN
        RAISE EXCEPTION 'Extraction % introuvable ou déjà activée', p_extraction;
    END IF;
    IF p_jeu = 'clients' THEN
        INSERT INTO sage_clients (extraction_id, compte, intitule)
        SELECT p_extraction, trim(l->>0), left(trim(COALESCE(l->>1, '')), 120)
          FROM jsonb_array_elements(p_lignes) l
         WHERE trim(COALESCE(l->>0, '')) <> ''
        ON CONFLICT (extraction_id, compte) DO NOTHING;
    ELSIF p_jeu = 'facturation' THEN
        INSERT INTO sage_facturation (extraction_id, compte, mois, ht)
        SELECT p_extraction, trim(l->>0), left(trim(l->>1), 7), COALESCE(NULLIF(replace(l->>2, ',', '.'), '')::NUMERIC, 0)
          FROM jsonb_array_elements(p_lignes) l WHERE trim(COALESCE(l->>0, '')) <> '' AND length(trim(COALESCE(l->>1, ''))) >= 7;
    ELSIF p_jeu = 'ecritures' THEN
        SELECT COALESCE(MAX(ordre), 0) INTO v_base FROM sage_ecritures WHERE extraction_id = p_extraction;
        INSERT INTO sage_ecritures (extraction_id, ordre, compte, date_ecriture, journal, piece, ref_piece, intitule, sens, montant)
        SELECT p_extraction, v_base + (row_number() OVER ())::INT, trim(l->>0), (l->>1)::DATE, left(trim(l->>2), 10),
               left(trim(l->>3), 30), left(trim(l->>4), 60), left(trim(l->>5), 200),
               COALESCE(NULLIF(l->>6, '')::INT, 0)::SMALLINT, COALESCE(NULLIF(replace(l->>7, ',', '.'), '')::NUMERIC, 0)
          FROM jsonb_array_elements(p_lignes) l WHERE trim(COALESCE(l->>0, '')) <> '' AND COALESCE(l->>1, '') ~ '^\d{4}-\d{2}-\d{2}';
    ELSIF p_jeu = 'livraisons' THEN
        SELECT COALESCE(MAX(ordre), 0) INTO v_base FROM sage_livraisons WHERE extraction_id = p_extraction;
        INSERT INTO sage_livraisons (extraction_id, ordre, compte, date_livraison, piece, ar_ref, designation, qte, montant_ht, depot, station)
        SELECT p_extraction, v_base + (row_number() OVER ())::INT, trim(l->>0), (l->>1)::DATE, left(trim(l->>2), 30), left(trim(l->>3), 30),
               left(trim(l->>4), 120), COALESCE(NULLIF(replace(l->>5, ',', '.'), '')::NUMERIC, 0), COALESCE(NULLIF(replace(l->>6, ',', '.'), '')::NUMERIC, 0),
               left(trim(l->>7), 120), left(trim(regexp_replace(COALESCE(l->>7, ''), '^.*RPS', '')), 40)
          FROM jsonb_array_elements(p_lignes) l WHERE trim(COALESCE(l->>0, '')) <> '' AND COALESCE(l->>1, '') ~ '^\d{4}-\d{2}-\d{2}';
    ELSE
        RAISE EXCEPTION 'Jeu inconnu : %', p_jeu;
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END; $$;

CREATE OR REPLACE FUNCTION pont_activer_extraction(p_extraction UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e extractions; v_stats JSONB;
BEGIN
    SELECT * INTO e FROM extractions WHERE id = p_extraction AND statut = 'en_cours';
    IF e.id IS NULL THEN RAISE EXCEPTION 'Extraction introuvable ou déjà activée'; END IF;

    UPDATE extractions SET
        nb_clients = (SELECT count(*) FROM sage_clients WHERE extraction_id = p_extraction),
        nb_facturation = (SELECT count(*) FROM sage_facturation WHERE extraction_id = p_extraction),
        nb_ecritures = (SELECT count(*) FROM sage_ecritures WHERE extraction_id = p_extraction),
        nb_livraisons = (SELECT count(*) FROM sage_livraisons WHERE extraction_id = p_extraction),
        saisi_jusquau = COALESCE(saisi_jusquau, (SELECT max(date_livraison) FROM sage_livraisons WHERE extraction_id = p_extraction))
    WHERE id = p_extraction;

    IF (SELECT nb_clients FROM extractions WHERE id = p_extraction) = 0 THEN
        RAISE EXCEPTION 'Extraction vide : aucun client (qr0)';
    END IF;

    UPDATE extractions SET statut = 'archivee' WHERE statut = 'active';
    UPDATE extractions SET statut = 'active', active_le = now() WHERE id = p_extraction;
    -- on ne conserve les données que des 2 dernières extractions archivées
    DELETE FROM extractions WHERE statut = 'archivee' AND id NOT IN (
        SELECT id FROM extractions WHERE statut = 'archivee' ORDER BY active_le DESC NULLS LAST LIMIT 2);

    v_stats := recalculer_clients();
    PERFORM journaliser('extraction_activee', NULL, jsonb_build_object('extraction', p_extraction, 'date', e.date_extraction, 'source', e.source) || v_stats);
    RETURN v_stats;
END; $$;

-- ------------------------------------------------------------
-- Calcul des soldes économiques, cadences, typologies, scores
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

CREATE OR REPLACE FUNCTION recalculer_clients()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ext UUID;
    v_date DATE;
    v_exercice TEXT;
    v_coef NUMERIC := COALESCE((parametre('seuils')->>'coef_cadence')::NUMERIC, 1.5);
    v_min INT := COALESCE((parametre('seuils')->>'cadence_min_jours')::INT, 10);
    v_max INT := COALESCE((parametre('seuils')->>'cadence_max_jours')::INT, 45);
    v_generique INT := COALESCE((parametre('seuils')->>'jours_generique')::INT, 30);
    v_nb INT; v_fermees INT := 0;
    act RECORD;
BEGIN
    SELECT id, date_extraction INTO v_ext, v_date FROM extractions WHERE statut = 'active';
    IF v_ext IS NULL THEN RETURN jsonb_build_object('clients', 0); END IF;
    v_exercice := to_char(v_date, 'YYYY');

    TRUNCATE clients_calc;
    INSERT INTO clients_calc (compte, intitule, ran, facture, facture_exercice, regle, debits_hors_ran, solde,
                              derniere_facture, dernier_reglement, nb_reglements, reglement_moyen, part_mobile_money, litres_exercice,
                              cadence_jours, seuil_alerte_jours, jours_sans_reglement, typologie_auto, score)
    WITH f AS (
        SELECT compte, SUM(ht) AS facture, SUM(ht) FILTER (WHERE left(mois, 4) = v_exercice) AS facture_ex
          FROM sage_facturation WHERE extraction_id = v_ext GROUP BY compte),
    e AS (
        SELECT compte,
               SUM(CASE WHEN journal = 'RAN' THEN CASE WHEN sens = 0 THEN montant ELSE -montant END ELSE 0 END) AS ran,
               SUM(CASE WHEN journal <> 'RAN' AND sens = 1 THEN montant ELSE 0 END) AS regle,
               SUM(CASE WHEN journal <> 'RAN' AND sens = 0 THEN montant ELSE 0 END) AS debits,
               COUNT(*) FILTER (WHERE journal <> 'RAN' AND sens = 1) AS nb_regl,
               COUNT(*) FILTER (WHERE journal <> 'RAN' AND sens = 1 AND journal IN ('NITA', 'CAINIT', 'AIRTEL', 'AIRT')) AS nb_mm,
               MAX(date_ecriture) FILTER (WHERE journal <> 'RAN' AND sens = 1) AS der_regl
          FROM sage_ecritures WHERE extraction_id = v_ext GROUP BY compte),
    cad AS (
        SELECT compte, percentile_cont(0.5) WITHIN GROUP (ORDER BY intervalle) AS mediane, COUNT(*) AS n
          FROM (SELECT compte, date_ecriture - lag(date_ecriture) OVER (PARTITION BY compte ORDER BY date_ecriture, ordre) AS intervalle
                  FROM sage_ecritures WHERE extraction_id = v_ext AND journal <> 'RAN' AND sens = 1) i
         WHERE intervalle IS NOT NULL GROUP BY compte),
    l AS (
        SELECT compte, MAX(date_livraison) AS der_fact, SUM(qte) FILTER (WHERE to_char(date_livraison, 'YYYY') = v_exercice) AS litres
          FROM sage_livraisons WHERE extraction_id = v_ext GROUP BY compte)
    SELECT c.compte, c.intitule,
           COALESCE(e.ran, 0), COALESCE(f.facture, 0), COALESCE(f.facture_ex, 0), COALESCE(e.regle, 0), COALESCE(e.debits, 0),
           COALESCE(e.ran, 0) + COALESCE(f.facture, 0) + COALESCE(e.debits, 0) - COALESCE(e.regle, 0) AS solde,
           l.der_fact, e.der_regl, COALESCE(e.nb_regl, 0),
           CASE WHEN COALESCE(e.nb_regl, 0) > 0 THEN e.regle / e.nb_regl ELSE 0 END,
           CASE WHEN COALESCE(e.nb_regl, 0) > 0 THEN ROUND(100.0 * e.nb_mm / e.nb_regl, 2) ELSE 0 END,
           COALESCE(l.litres, 0),
           CASE WHEN cad.n >= 2 THEN ROUND(cad.mediane)::INT ELSE NULL END,
           CASE WHEN cad.n >= 2 THEN LEAST(v_max, GREATEST(v_min, ROUND(v_coef * cad.mediane)::INT)) ELSE v_generique END,
           CASE WHEN e.der_regl IS NULL THEN NULL ELSE v_date - e.der_regl END,
           typologie_auto(c.compte, COALESCE(e.ran, 0) + COALESCE(f.facture, 0) + COALESCE(e.debits, 0) - COALESCE(e.regle, 0),
                          COALESCE(e.nb_regl, 0)::INT, COALESCE(f.facture, 0),
                          CASE WHEN COALESCE(e.nb_regl, 0) > 0 THEN e.regle / e.nb_regl ELSE 0 END,
                          CASE WHEN COALESCE(e.nb_regl, 0) > 0 THEN 100.0 * e.nb_mm / e.nb_regl ELSE 0 END),
           100
      FROM sage_clients c
      LEFT JOIN f ON f.compte = c.compte
      LEFT JOIN e ON e.compte = c.compte
      LEFT JOIN cad ON cad.compte = c.compte
      LEFT JOIN l ON l.compte = c.compte
     WHERE c.extraction_id = v_ext;

    -- Score de risque 0-100 (100 = aucun risque) : retard vs cadence, compte muet, dépassement de limite, promesses non tenues, contentieux
    UPDATE clients_calc cc SET score = GREATEST(0, LEAST(100,
        100
        - CASE WHEN cc.solde <= 1000 THEN 0
               WHEN cc.jours_sans_reglement IS NULL THEN 40
               ELSE LEAST(40, ROUND(40.0 * cc.jours_sans_reglement / (2 * cc.seuil_alerte_jours)))::INT END
        - CASE WHEN cc.typologie_auto = 'compte muet' THEN 20 ELSE 0 END
        - CASE WHEN EXISTS (SELECT 1 FROM clients_ext ce WHERE ce.compte = cc.compte AND ce.limite_credit > 0 AND cc.solde > ce.limite_credit) THEN 15 ELSE 0 END
        - LEAST(20, 10 * (SELECT count(*) FROM actions ac WHERE ac.compte = cc.compte AND ac.type = 'promesse'
                                                          AND (ac.resultat = 'non_tenue' OR (ac.statut = 'ouverte' AND ac.echeance < v_date))))::INT
        - CASE WHEN EXISTS (SELECT 1 FROM actions ac WHERE ac.compte = cc.compte AND ac.type = 'contentieux' AND ac.statut = 'ouverte') THEN 25 ELSE 0 END
    ));
    UPDATE clients_calc SET score = 100 WHERE solde < 0;

    -- Fermeture automatique : la donnée Sage commande.
    FOR act IN SELECT x.*, cc.solde AS solde_client FROM actions x JOIN clients_calc cc ON cc.compte = x.compte
              WHERE x.statut = 'ouverte' AND x.type IN ('relance', 'promesse', 'contentieux', 'plan') LOOP
        IF act.solde_client <= 1000 THEN
            UPDATE actions SET statut = 'fermee', ferme_le = now(), ferme_motif = 'Compte soldé (extraction du ' || to_char(v_date, 'DD/MM/YYYY') || ')',
                               resultat = CASE WHEN type = 'promesse' THEN 'tenue' ELSE resultat END WHERE id = act.id;
            v_fermees := v_fermees + 1;
        ELSIF act.type = 'promesse' AND act.montant IS NOT NULL THEN
            -- un règlement au moins égal au montant promis, encaissé depuis la promesse (tolérance 7 jours avant l'échéance)
            PERFORM 1 FROM sage_ecritures se WHERE se.extraction_id = v_ext AND se.compte = act.compte AND se.journal <> 'RAN' AND se.sens = 1
               AND se.date_ecriture >= act.date_action AND se.montant >= act.montant * 0.98;
            IF FOUND THEN
                UPDATE actions SET statut = 'fermee', ferme_le = now(), resultat = 'tenue', ferme_motif = 'Règlement reçu',
                       reglee_par_piece = (SELECT piece FROM sage_ecritures se WHERE se.extraction_id = v_ext AND se.compte = act.compte AND se.journal <> 'RAN'
                                            AND se.sens = 1 AND se.date_ecriture >= act.date_action AND se.montant >= act.montant * 0.98 ORDER BY date_ecriture LIMIT 1)
                 WHERE id = act.id;
                v_fermees := v_fermees + 1;
            END IF;
        ELSIF act.type = 'relance' THEN
            PERFORM 1 FROM sage_ecritures se WHERE se.extraction_id = v_ext AND se.compte = act.compte AND se.journal <> 'RAN' AND se.sens = 1
               AND se.date_ecriture > act.date_action;
            IF FOUND THEN
                UPDATE actions SET statut = 'fermee', ferme_le = now(), ferme_motif = 'Règlement reçu après relance',
                       reglee_par_piece = (SELECT piece FROM sage_ecritures se WHERE se.extraction_id = v_ext AND se.compte = act.compte AND se.journal <> 'RAN'
                                            AND se.sens = 1 AND se.date_ecriture > act.date_action ORDER BY date_ecriture LIMIT 1)
                 WHERE id = act.id;
                v_fermees := v_fermees + 1;
            END IF;
        END IF;
    END LOOP;

    SELECT count(*) INTO v_nb FROM clients_calc;
    RETURN jsonb_build_object('clients', v_nb, 'actions_fermees_auto', v_fermees, 'date', v_date);
END; $$;

-- ------------------------------------------------------------
-- Vue clients : calcul + extension CRM + statut pipeline
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW vue_clients WITH (security_invoker = true) AS
WITH ouvertes AS (
    SELECT compte,
           bool_or(type = 'contentieux') AS contentieux,
           bool_or(type = 'promesse') AS promesse,
           bool_or(type = 'plan') AS plan,
           bool_or(type = 'relance') AS relance,
           MIN(echeance) FILTER (WHERE type IN ('promesse', 'plan')) AS prochaine_echeance,
           MAX(date_action) FILTER (WHERE type = 'relance') AS derniere_relance,
           MAX(niveau) FILTER (WHERE type = 'relance') AS niveau_relance,
           SUM(montant) FILTER (WHERE type = 'promesse') AS montant_promis,
           bool_or(type = 'promesse' AND echeance < CURRENT_DATE) AS promesse_echue
      FROM actions WHERE statut = 'ouverte' GROUP BY compte),
rompues AS (
    SELECT compte, count(*) AS nb FROM actions WHERE type = 'promesse' AND (resultat = 'non_tenue' OR (statut = 'ouverte' AND echeance < CURRENT_DATE)) GROUP BY compte),
tenues AS (
    SELECT compte, count(*) FILTER (WHERE resultat = 'tenue') AS nb_tenues, count(*) AS nb_total FROM actions WHERE type = 'promesse' AND statut = 'fermee' GROUP BY compte)
SELECT cc.*,
       COALESCE(NULLIF(ce.typologie, ''), cc.typologie_auto) AS typologie,
       ce.typologie_manuelle, ce.limite_credit, ce.interlocuteur_id, ce.segment_zone, ce.categorie, ce.contacts, ce.notes,
       p.nom AS interlocuteur,
       (ce.limite_credit IS NOT NULL AND ce.limite_credit > 0 AND cc.solde > ce.limite_credit) AS limite_depassee,
       o.contentieux, o.promesse, o.plan, o.relance, o.prochaine_echeance, o.derniere_relance, o.niveau_relance, o.montant_promis,
       COALESCE(o.promesse_echue, false) AS promesse_echue,
       COALESCE(r.nb, 0) AS nb_promesses_rompues,
       t.nb_tenues, t.nb_total,
       (cc.solde > COALESCE((parametre('seuils')->>'solde_min_relance')::NUMERIC, 500000)
        AND COALESCE(cc.jours_sans_reglement, 9999) > cc.seuil_alerte_jours) AS decroche,
       CASE
           WHEN cc.solde <= 1000 AND cc.facture > 0 THEN 'soldé'
           WHEN cc.solde < -1000 THEN 'créditeur'
           WHEN o.contentieux THEN 'contentieux'
           WHEN o.plan THEN 'plan'
           WHEN o.promesse THEN 'promesse'
           WHEN o.relance THEN 'relancé'
           WHEN cc.solde > COALESCE((parametre('seuils')->>'solde_min_relance')::NUMERIC, 500000)
                AND COALESCE(cc.jours_sans_reglement, 9999) > cc.seuil_alerte_jours THEN 'à relancer'
           WHEN cc.solde > 0 THEN 'en cours'
           ELSE 'soldé' END AS statut,
       CASE
           WHEN cc.solde <= 1000 THEN NULL
           WHEN COALESCE(cc.jours_sans_reglement, 9999) > 90 OR COALESCE(r.nb, 0) >= 2 THEN 4
           WHEN COALESCE(cc.jours_sans_reglement, 9999) > 60 THEN 3
           WHEN cc.solde > COALESCE((parametre('seuils')->>'solde_min_relance')::NUMERIC, 500000)
                AND COALESCE(cc.jours_sans_reglement, 9999) > cc.seuil_alerte_jours THEN 2
           ELSE 1 END AS niveau_suggere,
       CASE WHEN cc.solde > 100000000 THEN '> 100 M' WHEN cc.solde > 25000000 THEN '25-100 M'
            WHEN cc.solde > 5000000 THEN '5-25 M' WHEN cc.solde > 0 THEN '< 5 M' ELSE 'nul / créditeur' END AS segment_encours
  FROM clients_calc cc
  LEFT JOIN clients_ext ce ON ce.compte = cc.compte
  LEFT JOIN profils p ON p.id = ce.interlocuteur_id
  LEFT JOIN ouvertes o ON o.compte = cc.compte
  LEFT JOIN rompues r ON r.compte = cc.compte
  LEFT JOIN tenues t ON t.compte = cc.compte;

-- Écritures et livraisons de l'extraction active (vues de commodité)
CREATE OR REPLACE VIEW vue_ecritures WITH (security_invoker = true) AS
SELECT se.*, ep.payeur, rl.lien, rl.piece_liee, rl.compte_lie, rl.note AS lien_note,
       (se.journal <> 'RAN' AND se.sens = 1) AS est_reglement
  FROM sage_ecritures se
  JOIN extractions x ON x.id = se.extraction_id AND x.statut = 'active'
  LEFT JOIN etiquettes_payeur ep ON ep.compte = se.compte AND ep.piece = se.piece
  LEFT JOIN reglements_liens rl ON rl.compte = se.compte AND rl.piece = se.piece;

CREATE OR REPLACE VIEW vue_livraisons WITH (security_invoker = true) AS
SELECT sl.* FROM sage_livraisons sl JOIN extractions x ON x.id = sl.extraction_id AND x.statut = 'active';

CREATE OR REPLACE VIEW vue_facturation WITH (security_invoker = true) AS
SELECT sf.* FROM sage_facturation sf JOIN extractions x ON x.id = sf.extraction_id AND x.statut = 'active';

-- ------------------------------------------------------------
-- Tableau de bord
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tableau_de_bord() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    x extractions;
    v_mois TEXT;
    v_mois_clos TEXT;
    v_solde_min NUMERIC := COALESCE((parametre('seuils')->>'solde_min_relance')::NUMERIC, 500000);
    r RECORD; f RECORD;
    v_reste NUMERIC; v_age INT;
    v_b0 NUMERIC := 0; v_b1 NUMERIC := 0; v_b2 NUMERIC := 0; v_b3 NUMERIC := 0;
    v_fact_12 NUMERIC; v_encours NUMERIC;
BEGIN
    SELECT * INTO x FROM extractions WHERE statut = 'active';
    IF x.id IS NULL THEN RETURN jsonb_build_object('sans_donnees', true); END IF;
    v_mois := to_char(x.date_extraction, 'YYYY-MM');
    v_mois_clos := to_char(date_trunc('month', x.date_extraction) - INTERVAL '1 month', 'YYYY-MM');

    -- Balance âgée par ancienneté de facturation : le solde est affecté aux mois de facturation les plus récents (les plus anciens sont réputés payés)
    FOR r IN SELECT compte, solde FROM clients_calc WHERE solde > 1000 LOOP
        v_reste := r.solde;
        FOR f IN SELECT mois, ht FROM vue_facturation WHERE compte = r.compte AND ht > 0 ORDER BY mois DESC LOOP
            EXIT WHEN v_reste <= 0;
            v_age := (x.date_extraction - to_date(f.mois || '-01', 'YYYY-MM-DD'))::INT;
            IF v_age <= 30 THEN v_b0 := v_b0 + LEAST(v_reste, f.ht);
            ELSIF v_age <= 60 THEN v_b1 := v_b1 + LEAST(v_reste, f.ht);
            ELSIF v_age <= 90 THEN v_b2 := v_b2 + LEAST(v_reste, f.ht);
            ELSE v_b3 := v_b3 + LEAST(v_reste, f.ht); END IF;
            v_reste := v_reste - f.ht;
        END LOOP;
        IF v_reste > 0 THEN v_b3 := v_b3 + v_reste; END IF;  -- reliquat = RAN ou débits hors RAN : plus de 90 jours
    END LOOP;

    SELECT COALESCE(SUM(ht), 0) INTO v_fact_12 FROM vue_facturation
     WHERE mois <= v_mois_clos AND mois > to_char(date_trunc('month', x.date_extraction) - INTERVAL '13 months', 'YYYY-MM');
    SELECT COALESCE(SUM(solde) FILTER (WHERE solde > 0), 0) INTO v_encours FROM clients_calc;

    RETURN jsonb_build_object(
        'date_extraction', x.date_extraction,
        'saisi_jusquau', x.saisi_jusquau,
        'source', x.source,
        'donnees_perimees', (CURRENT_DATE - x.date_extraction) > 1,
        'creances_totales', v_encours,
        'avances', (SELECT COALESCE(SUM(-solde) FILTER (WHERE solde < 0), 0) FROM clients_calc),
        'clients_debiteurs', (SELECT count(*) FROM clients_calc WHERE solde > 1000),
        'a_relancer', (SELECT count(*) FROM vue_clients WHERE statut = 'à relancer'),
        'a_relancer_montant', (SELECT COALESCE(SUM(solde), 0) FROM vue_clients WHERE statut = 'à relancer'),
        'facture_mois', (SELECT COALESCE(SUM(ht), 0) FROM vue_facturation WHERE mois = v_mois),
        'encaisse_mois', (SELECT COALESCE(SUM(montant), 0) FROM vue_ecritures WHERE est_reglement AND to_char(date_ecriture, 'YYYY-MM') = v_mois),
        'facture_mois_clos', (SELECT COALESCE(SUM(ht), 0) FROM vue_facturation WHERE mois = v_mois_clos),
        'encaisse_mois_clos', (SELECT COALESCE(SUM(montant), 0) FROM vue_ecritures WHERE est_reglement AND to_char(date_ecriture, 'YYYY-MM') = v_mois_clos),
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
            FROM clients_calc WHERE solde > 1000),
        'top_debiteurs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde, 'jours', jours_sans_reglement,
                                'statut', statut, 'typologie', typologie, 'score', score) ORDER BY solde DESC), '[]'::jsonb)
                          FROM (SELECT * FROM vue_clients WHERE solde > 0 ORDER BY solde DESC LIMIT 8) t),
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
                                  FROM actions WHERE type = 'promesse' AND statut = 'fermee'),
        'taches_du_jour', (SELECT count(*) FROM actions WHERE statut = 'ouverte' AND type IN ('tache', 'appel') AND echeance <= CURRENT_DATE),
        'contentieux', (SELECT count(*) FROM vue_clients WHERE statut = 'contentieux'),
        'limites_depassees', (SELECT count(*) FROM vue_clients WHERE limite_depassee),
        'courbe_12_mois', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mois', m, 'facture', fa, 'encaisse', en) ORDER BY m), '[]'::jsonb)
            FROM (SELECT to_char(g, 'YYYY-MM') AS m,
                         (SELECT COALESCE(SUM(ht), 0) FROM vue_facturation WHERE mois = to_char(g, 'YYYY-MM')) AS fa,
                         (SELECT COALESCE(SUM(montant), 0) FROM vue_ecritures WHERE est_reglement AND to_char(date_ecriture, 'YYYY-MM') = to_char(g, 'YYYY-MM')) AS en
                    FROM generate_series(date_trunc('month', x.date_extraction) - INTERVAL '11 months', date_trunc('month', x.date_extraction), INTERVAL '1 month') g) s)
    );
END; $$;

-- Encaissements du jour / de la veille pour les alertes du matin
CREATE OR REPLACE FUNCTION alertes_du_jour() RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT jsonb_build_object(
        'decrochages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde, 'jours', jours_sans_reglement, 'seuil', seuil_alerte_jours, 'typologie', typologie) ORDER BY solde DESC), '[]'::jsonb)
                        FROM vue_clients WHERE decroche AND statut = 'à relancer'),
        'promesses_echues', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', a.compte, 'intitule', c.intitule, 'montant', a.montant, 'echeance', a.echeance) ORDER BY a.echeance), '[]'::jsonb)
                             FROM actions a JOIN clients_calc c ON c.compte = a.compte WHERE a.statut = 'ouverte' AND a.type = 'promesse' AND a.echeance < CURRENT_DATE),
        'limites_depassees', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde, 'limite', limite_credit) ORDER BY solde DESC), '[]'::jsonb) FROM vue_clients WHERE limite_depassee),
        'comptes_muets', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'solde', solde) ORDER BY solde DESC), '[]'::jsonb) FROM vue_clients WHERE typologie = 'compte muet' AND solde > 0),
        'avances_qui_fondent', (SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', compte, 'intitule', intitule, 'avance', -solde) ORDER BY solde), '[]'::jsonb) FROM vue_clients WHERE solde < -1000 AND facture_exercice > 0 AND -solde < facture_exercice / 12)
    ); $$;

-- ------------------------------------------------------------
-- Actions CRM (écriture contrôlée + journal)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION creer_action(p_compte VARCHAR, p_type type_action_enum, p_note TEXT DEFAULT NULL, p_montant NUMERIC DEFAULT NULL,
                                        p_echeance DATE DEFAULT NULL, p_canal canal_enum DEFAULT NULL, p_niveau INT DEFAULT NULL,
                                        p_assignee UUID DEFAULT NULL, p_date_action DATE DEFAULT CURRENT_DATE, p_echeances JSONB DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id UUID; v_solde NUMERIC; v_min NUMERIC; e JSONB;
BEGIN
    IF NOT peut_recouvrer() THEN RAISE EXCEPTION 'Droits insuffisants pour créer une action'; END IF;
    SELECT solde INTO v_solde FROM clients_calc WHERE compte = p_compte;
    IF p_type = 'promesse' THEN
        IF p_montant IS NULL OR p_montant <= 0 OR p_echeance IS NULL THEN RAISE EXCEPTION 'Une promesse exige un montant et une échéance'; END IF;
        v_min := COALESCE((parametre('seuils')->>'promesse_part_min')::NUMERIC, 50);
        IF v_solde IS NOT NULL AND v_solde > 0 AND p_montant < v_solde * v_min / 100 THEN
            RAISE EXCEPTION 'Montant promis inférieur à % %% du solde exigible : enregistrez un plan de paiement', v_min;
        END IF;
    END IF;
    IF p_type = 'plan' AND (p_echeances IS NULL OR jsonb_array_length(p_echeances) = 0) THEN
        RAISE EXCEPTION 'Un plan de paiement exige au moins une échéance';
    END IF;
    IF p_type IN ('relance', 'contentieux') AND v_solde IS NOT NULL AND v_solde < -1000 THEN
        RAISE EXCEPTION 'Client créditeur : relance interdite';
    END IF;
    IF p_type = 'contentieux' AND NOT est_dg() THEN RAISE EXCEPTION 'Le passage en contentieux est une décision du DG'; END IF;

    -- une seule relance / promesse / plan / contentieux ouvert à la fois
    IF p_type IN ('relance', 'promesse', 'plan', 'contentieux') THEN
        UPDATE actions SET statut = 'fermee', ferme_le = now(), ferme_motif = 'Remplacée par ' || p_type::TEXT
         WHERE compte = p_compte AND statut = 'ouverte' AND type IN ('relance', 'promesse', 'plan') AND type <> 'contentieux';
    END IF;

    INSERT INTO actions (compte, type, note, montant, echeance, canal, niveau, assignee_id, auteur_id, auteur, date_action)
    VALUES (p_compte, p_type, p_note, p_montant, p_echeance, p_canal, p_niveau, p_assignee, auth.uid(), COALESCE(nom_courant(), 'système'), p_date_action)
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
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE a actions;
BEGIN
    IF NOT peut_recouvrer() THEN RAISE EXCEPTION 'Droits insuffisants'; END IF;
    SELECT * INTO a FROM actions WHERE id = p_id;
    IF a.id IS NULL THEN RAISE EXCEPTION 'Action introuvable'; END IF;
    IF a.type = 'contentieux' AND NOT est_dg() THEN RAISE EXCEPTION 'La sortie du contentieux est une décision du DG'; END IF;
    UPDATE actions SET statut = 'fermee', ferme_le = now(), ferme_motif = p_motif, resultat = COALESCE(p_resultat, resultat) WHERE id = p_id;
    PERFORM journaliser('fermeture_' || a.type::TEXT, a.compte, jsonb_build_object('id', p_id, 'motif', p_motif, 'resultat', p_resultat));
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
-- Sécurité (RLS)
-- ------------------------------------------------------------
ALTER TABLE profils ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametres ENABLE ROW LEVEL SECURITY;
ALTER TABLE extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_facturation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_ecritures ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_livraisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_calc ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_ext ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans_echeances ENABLE ROW LEVEL SECURITY;
ALTER TABLE modeles_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages_sortants ENABLE ROW LEVEL SECURITY;
ALTER TABLE etiquettes_payeur ENABLE ROW LEVEL SECURITY;
ALTER TABLE reglements_liens ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;

-- Lecture : tout utilisateur actif. Écriture : selon le rôle.
CREATE POLICY profils_lecture ON profils FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY profils_soi ON profils FOR UPDATE TO authenticated USING (id = auth.uid() OR est_dg()) WITH CHECK (id = auth.uid() OR est_dg());
CREATE POLICY profils_dg ON profils FOR ALL TO authenticated USING (est_dg()) WITH CHECK (est_dg());
CREATE POLICY parametres_lecture ON parametres FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY parametres_dg ON parametres FOR ALL TO authenticated USING (est_dg()) WITH CHECK (est_dg());
CREATE POLICY extractions_lecture ON extractions FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY sage_clients_lecture ON sage_clients FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY sage_fact_lecture ON sage_facturation FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY sage_ecr_lecture ON sage_ecritures FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY sage_livr_lecture ON sage_livraisons FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY calc_lecture ON clients_calc FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY ext_lecture ON clients_ext FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY ext_ecriture ON clients_ext FOR ALL TO authenticated USING (peut_recouvrer()) WITH CHECK (peut_recouvrer());
CREATE POLICY actions_lecture ON actions FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY actions_ecriture ON actions FOR ALL TO authenticated USING (peut_recouvrer()) WITH CHECK (peut_recouvrer());
CREATE POLICY plans_lecture ON plans_echeances FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY plans_ecriture ON plans_echeances FOR ALL TO authenticated USING (peut_recouvrer()) WITH CHECK (peut_recouvrer());
CREATE POLICY modeles_lecture ON modeles_messages FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY modeles_dg ON modeles_messages FOR ALL TO authenticated USING (est_dg()) WITH CHECK (est_dg());
CREATE POLICY messages_lecture ON messages_sortants FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY messages_ecriture ON messages_sortants FOR INSERT TO authenticated WITH CHECK (peut_recouvrer());
CREATE POLICY payeur_lecture ON etiquettes_payeur FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY payeur_ecriture ON etiquettes_payeur FOR ALL TO authenticated USING (peut_pointer()) WITH CHECK (peut_pointer());
CREATE POLICY liens_lecture ON reglements_liens FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY liens_ecriture ON reglements_liens FOR ALL TO authenticated USING (peut_pointer()) WITH CHECK (peut_pointer());
CREATE POLICY documents_lecture ON documents FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY documents_ecriture ON documents FOR INSERT TO authenticated WITH CHECK (est_utilisateur_actif());
CREATE POLICY audit_lecture ON audit FOR SELECT TO authenticated USING (role_courant() IN ('dg', 'controle'));

-- Les fonctions du pont sont réservées au service (clé service_role) et au DG / recouvrement (chargement manuel des fichiers)
REVOKE EXECUTE ON FUNCTION pont_debut_extraction(DATE, VARCHAR, DATE, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION pont_ajouter_lignes(UUID, VARCHAR, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION pont_activer_extraction(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION recalculer_clients() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pont_debut_extraction(DATE, VARCHAR, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pont_ajouter_lignes(UUID, VARCHAR, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pont_activer_extraction(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION recalculer_clients() TO authenticated, service_role;

-- ------------------------------------------------------------
-- Paramétrage de départ (CDC-05 §3.4, §8)
-- ------------------------------------------------------------
INSERT INTO parametres (cle, valeur) VALUES
('societe', '{"nom": "RISSA PETROLEUM SERVICE", "sigle": "RPS", "adresse": "B.P. 2184 Niamey", "ville": "Niamey", "pays": "Niger", "nif": "7272/R", "telephone": "", "email": "", "site": "apps.rps.ne"}'),
('seuils', '{"solde_min_relance": 500000, "jours_generique": 30, "coef_cadence": 1.5, "cadence_min_jours": 10, "cadence_max_jours": 45, "promesse_part_min": 50, "n3_jours": 60, "n4_jours": 90, "peremption_donnees_jours": 1}'),
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
