-- ============================================================
-- Bases héritées du projet « RPS WORKFLOW » (workflow v1), adaptées au CRM (projet Supabase dédié)
--   - amorçage explicite du DG (plus de « premier inscrit = DG »), profils inactifs, e-mail de contact réel
--   - référentiels que le workflow n'a jamais eus : stations (depuis les dépôts qr4), habilitations, tiers 411
--   - patrons d'exploitation : numérotation atomique des courriers, instantané quotidien, contrôle de santé,
--     récapitulatif quotidien, pg_cron (si disponible), bucket Storage privé (si Supabase)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Comptes : amorçage explicite, profils inactifs, e-mail de contact
-- ------------------------------------------------------------
ALTER TABLE profils ADD COLUMN IF NOT EXISTS email_contact VARCHAR(150);      -- adresse réelle (l'e-mail Auth peut être technique)
ALTER TABLE profils ADD COLUMN IF NOT EXISTS recap_quotidien BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profils ADD COLUMN IF NOT EXISTS derniere_connexion TIMESTAMPTZ;

-- Tout nouveau compte Auth reçoit un profil INACTIF sans rôle élevé ; le DG est désigné par installer_dg().
CREATE OR REPLACE FUNCTION creer_profil_utilisateur() RETURNS TRIGGER
SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO profils (id, email, nom, role, actif, email_contact)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1)), 'exploitation', false,
            COALESCE(NEW.raw_user_meta_data->>'email_contact', NEW.email))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Amorçage : désigne le DG par e-mail. Appelable par le service (SQL Editor / clé service_role) ou par un DG actif.
CREATE OR REPLACE FUNCTION installer_dg(p_email VARCHAR) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
    IF NOT (est_service() OR est_dg()) THEN RAISE EXCEPTION 'Réservé à l''installation (service) ou au DG'; END IF;
    SELECT id INTO v_id FROM profils WHERE lower(email) = lower(p_email) OR lower(email_contact) = lower(p_email);
    IF v_id IS NULL THEN RAISE EXCEPTION 'Aucun compte Auth pour % : créez-le d''abord (Authentication → Users)', p_email; END IF;
    UPDATE profils SET role = 'dg', actif = true WHERE id = v_id;
    INSERT INTO habilitations (user_id, application, role, actif, modifie_par) VALUES (v_id, 'crm', 'dg', true, auth.uid())
    ON CONFLICT (user_id, application) DO UPDATE SET role = 'dg', actif = true, modifie_le = now();
    INSERT INTO audit (qui, qui_nom, quoi, detail) VALUES (auth.uid(), COALESCE(nom_courant(), 'installation'), 'installer_dg', jsonb_build_object('email', p_email));
END; $$;
REVOKE EXECUTE ON FUNCTION installer_dg(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION installer_dg(VARCHAR) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Référentiels partagés (le CRM en devient la source pour les autres applications)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS habilitations (      -- une ligne par (personne, application) : prêt pour un partage multi-applications
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    application VARCHAR(20) NOT NULL DEFAULT 'crm',
    role VARCHAR(20) NOT NULL,
    actif BOOLEAN NOT NULL DEFAULT true,
    modifie_par UUID,
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, application)
);
ALTER TABLE habilitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY habilitations_lecture ON habilitations FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY habilitations_dg ON habilitations FOR ALL TO authenticated USING (est_dg()) WITH CHECK (est_dg());

-- Le profil CRM reste la source de vérité opérationnelle ; habilitations en est le miroir (synchronisé par trigger)
CREATE OR REPLACE FUNCTION synchroniser_habilitation() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO habilitations (user_id, application, role, actif, modifie_par)
    VALUES (NEW.id, 'crm', NEW.role::TEXT, NEW.actif, auth.uid())
    ON CONFLICT (user_id, application) DO UPDATE SET role = EXCLUDED.role, actif = EXCLUDED.actif, modifie_par = EXCLUDED.modifie_par, modifie_le = now();
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_profils_habilitation AFTER INSERT OR UPDATE OF role, actif ON profils FOR EACH ROW EXECUTE FUNCTION synchroniser_habilitation();

CREATE TABLE IF NOT EXISTS stations (           -- le numéro de station fait foi (suffixe des comptes 41180nn, intitulés « XX-nn-RPS … »)
    numero VARCHAR(10) PRIMARY KEY,
    libelle VARCHAR(80),
    intitule_depot VARCHAR(120),
    zone VARCHAR(40),
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY stations_lecture ON stations FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE POLICY stations_dg ON stations FOR ALL TO authenticated USING (est_dg()) WITH CHECK (est_dg());

-- Alimentation automatique depuis les dépôts de l'extraction active (jamais de suppression : une station disparue reste, inactive)
CREATE OR REPLACE FUNCTION rafraichir_stations() RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
    INSERT INTO stations (numero, libelle, intitule_depot)
    SELECT DISTINCT ON (station_numero) station_numero, station, depot
      FROM sage_livraisons sl JOIN extractions x ON x.id = sl.extraction_id AND x.statut = 'active'
     WHERE station_numero IS NOT NULL
     ORDER BY station_numero, date_livraison DESC
    ON CONFLICT (numero) DO UPDATE SET libelle = COALESCE(stations.libelle, EXCLUDED.libelle), intitule_depot = EXCLUDED.intitule_depot, modifie_le = now();
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END; $$;
CREATE OR REPLACE FUNCTION trg_extraction_activee() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.statut = 'active' AND OLD.statut IS DISTINCT FROM 'active' THEN PERFORM rafraichir_stations(); END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_extractions_stations AFTER UPDATE OF statut ON extractions FOR EACH ROW EXECUTE FUNCTION trg_extraction_activee();

-- Tiers 411 vus par les autres applications (référentiel exportable, sans solde)
CREATE OR REPLACE VIEW vue_tiers_411 WITH (security_invoker = true) AS
SELECT sc.compte, sc.intitule, cc.typologie_auto AS typologie, ce.categorie, ce.segment_zone, x.date_extraction
  FROM sage_clients sc JOIN extractions x ON x.id = sc.extraction_id AND x.statut = 'active'
  LEFT JOIN clients_calc cc ON cc.compte = sc.compte
  LEFT JOIN clients_ext ce ON ce.compte = sc.compte;

-- ------------------------------------------------------------
-- 3. Patrons d'exploitation repris du workflow
-- ------------------------------------------------------------
-- Numérotation atomique des courriers (MED = mise en demeure, REL = relance écrite, SIT = situation officielle)
CREATE TABLE IF NOT EXISTS compteurs (
    type VARCHAR(10) NOT NULL,
    annee INT NOT NULL,
    valeur INT NOT NULL DEFAULT 0,
    PRIMARY KEY (type, annee)
);
ALTER TABLE compteurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY compteurs_lecture ON compteurs FOR SELECT TO authenticated USING (est_utilisateur_actif());
CREATE OR REPLACE FUNCTION reserver_numero(p_type VARCHAR) RETURNS VARCHAR
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v INT; v_annee INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
BEGIN
    IF NOT (est_service() OR peut_pointer()) THEN RAISE EXCEPTION 'Numérotation réservée aux rôles habilités'; END IF;
    IF p_type NOT IN ('MED', 'REL', 'SIT') THEN RAISE EXCEPTION 'Type de numéro inconnu : %', p_type; END IF;
    INSERT INTO compteurs (type, annee, valeur) VALUES (p_type, v_annee, 1)
    ON CONFLICT (type, annee) DO UPDATE SET valeur = compteurs.valeur + 1 RETURNING valeur INTO v;
    RETURN p_type || '-' || v_annee || '-' || lpad(v::TEXT, 4, '0');
END; $$;
REVOKE EXECUTE ON FUNCTION reserver_numero(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserver_numero(VARCHAR) TO authenticated, service_role;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS numero VARCHAR(20);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chemin_objet VARCHAR(255);     -- objet du bucket Storage crm-documents

-- Instantané quotidien des tables d'écriture (rétention 14 jours), en complément du pg_dump 90 j du pont
CREATE TABLE IF NOT EXISTS sauvegardes_quotidiennes (
    jour DATE NOT NULL,
    table_nom VARCHAR(40) NOT NULL,
    nb_lignes INT NOT NULL,
    contenu JSONB NOT NULL,
    sauvegarde_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (jour, table_nom)
);
ALTER TABLE sauvegardes_quotidiennes ENABLE ROW LEVEL SECURITY;   -- aucune politique : service uniquement
CREATE OR REPLACE FUNCTION sauvegarde_quotidienne(p_retention_jours INT DEFAULT 14) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t TEXT; n INT; v JSONB := '{}'::jsonb;
BEGIN
    IF NOT est_service() THEN RAISE EXCEPTION 'Sauvegarde réservée au service'; END IF;
    FOREACH t IN ARRAY ARRAY['profils', 'habilitations', 'clients_ext', 'actions', 'plans_echeances', 'messages_sortants', 'etiquettes_payeur', 'reglements_liens', 'documents', 'parametres', 'modeles_messages', 'stations'] LOOP
        EXECUTE format('INSERT INTO sauvegardes_quotidiennes (jour, table_nom, nb_lignes, contenu)
                        SELECT CURRENT_DATE, %L, count(*), COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %I t
                        ON CONFLICT (jour, table_nom) DO UPDATE SET nb_lignes = EXCLUDED.nb_lignes, contenu = EXCLUDED.contenu, sauvegarde_le = now()', t, t);
        EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
        v := v || jsonb_build_object(t, n);
    END LOOP;
    DELETE FROM sauvegardes_quotidiennes WHERE jour < CURRENT_DATE - p_retention_jours;
    INSERT INTO audit (qui_nom, quoi, detail) VALUES ('service', 'sauvegarde_quotidienne', v);
    RETURN v;
END; $$;
REVOKE EXECUTE ON FUNCTION sauvegarde_quotidienne(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sauvegarde_quotidienne(INT) TO service_role;

-- Contrôle de santé : anomalies à signaler aux administrateurs (e-mail seulement si anomalie)
CREATE OR REPLACE FUNCTION controle_sante() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE x extractions; anomalies JSONB := '[]'::jsonb; v INT;
    v_peremption INT := COALESCE((parametre('seuils')->>'peremption_donnees_jours')::INT, 1);
BEGIN
    IF NOT (est_service() OR est_dg()) THEN RAISE EXCEPTION 'Réservé au service et au DG'; END IF;
    SELECT * INTO x FROM extractions WHERE statut = 'active';
    IF x.id IS NULL THEN anomalies := anomalies || '"Aucune extraction active"'::jsonb;
    ELSIF CURRENT_DATE - x.date_extraction > v_peremption THEN
        anomalies := anomalies || to_jsonb(format('Extraction du %s : le pont n''a rien poussé depuis %s jour(s)', to_char(x.date_extraction, 'DD/MM/YYYY'), CURRENT_DATE - x.date_extraction));
    END IF;
    SELECT count(*) INTO v FROM extractions WHERE statut = 'en_cours' AND cree_le < now() - INTERVAL '2 hours';
    IF v > 0 THEN anomalies := anomalies || to_jsonb(format('%s extraction(s) en cours depuis plus de 2 h (push interrompu ?)', v)); END IF;
    IF NOT EXISTS (SELECT 1 FROM audit WHERE quoi IN ('recalcul_nocturne', 'extraction_activee') AND quand > now() - INTERVAL '36 hours') THEN
        anomalies := anomalies || '"Aucun recalcul ni activation depuis 36 h (cron arrêté ?)"'::jsonb;
    END IF;
    SELECT count(*) INTO v FROM actions WHERE type = 'promesse' AND statut = 'ouverte' AND echeance < CURRENT_DATE - 7;
    IF v > 0 THEN anomalies := anomalies || to_jsonb(format('%s promesse(s) échue(s) depuis plus de 7 jours sans décision', v)); END IF;
    SELECT count(*) INTO v FROM profils p LEFT JOIN habilitations h ON h.user_id = p.id AND h.application = 'crm'
     WHERE p.actif AND (h.user_id IS NULL OR h.role <> p.role::TEXT OR h.actif <> p.actif);
    IF v > 0 THEN anomalies := anomalies || to_jsonb(format('%s profil(s) incohérent(s) avec les habilitations', v)); END IF;
    IF NOT EXISTS (SELECT 1 FROM profils WHERE role = 'dg' AND actif) THEN anomalies := anomalies || '"Aucun DG actif"'::jsonb; END IF;
    SELECT count(*) INTO v FROM sauvegardes_quotidiennes WHERE jour >= CURRENT_DATE - 1;
    IF v = 0 AND EXISTS (SELECT 1 FROM sauvegardes_quotidiennes) THEN anomalies := anomalies || '"Sauvegarde quotidienne absente depuis 2 jours"'::jsonb; END IF;
    RETURN jsonb_build_object('date', CURRENT_DATE, 'ok', jsonb_array_length(anomalies) = 0, 'anomalies', anomalies,
                              'extraction', x.date_extraction, 'nb_profils_actifs', (SELECT count(*) FROM profils WHERE actif));
END; $$;
REVOKE EXECUTE ON FUNCTION controle_sante() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION controle_sante() TO authenticated, service_role;

-- Récapitulatif quotidien recouvrement (alertes + promesses + tâches) pour les profils abonnés
CREATE OR REPLACE FUNCTION recapitulatif_quotidien() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'date', CURRENT_DATE,
        'alertes', alertes_du_jour(),
        'tableau', tableau_de_bord() - 'courbe_12_mois',
        'destinataires', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nom', nom, 'email', COALESCE(email_contact, email))), '[]'::jsonb) FROM profils WHERE actif AND recap_quotidien)
    ); $$;
REVOKE EXECUTE ON FUNCTION recapitulatif_quotidien() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recapitulatif_quotidien() TO service_role;

-- Paramètres d'exploitation (fuseau, destinataires d'alerte, domaines autorisés)
INSERT INTO parametres (cle, valeur) VALUES
('exploitation', '{"fuseau": "Africa/Niamey", "admins_alerte": [], "domaines_email": [], "expediteur": "RPS CRM Créances <recouvrement@rps.ne>", "heure_pont": "07:00"}')
ON CONFLICT (cle) DO NOTHING;

-- ------------------------------------------------------------
-- 4. pg_cron (si l'extension est disponible : Supabase) — recalcul 04:00 UTC, sauvegarde 02:00 UTC, en doublon du cron Vercel
-- ------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron indisponible ici (%), planification laissée au cron Vercel', SQLERRM; RETURN; END;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('crm-recalcul-nocturne', 'crm-sauvegarde-quotidienne');
    PERFORM cron.schedule('crm-recalcul-nocturne', '0 4 * * *', $c$SELECT recalculer_clients();$c$);
    PERFORM cron.schedule('crm-sauvegarde-quotidienne', '0 2 * * *', $c$SELECT sauvegarde_quotidienne();$c$);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Planification pg_cron non appliquée : %', SQLERRM;
END $$;

-- ------------------------------------------------------------
-- 5. Bucket Storage privé pour les documents (si le schéma storage existe : Supabase)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('crm-documents', 'crm-documents', false, 10485760, ARRAY['application/pdf', 'image/png', 'image/jpeg'])
        ON CONFLICT (id) DO NOTHING;
        EXECUTE 'CREATE POLICY crm_documents_lecture ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''crm-documents'' AND public.est_utilisateur_actif())';
        EXECUTE 'CREATE POLICY crm_documents_ecriture ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''crm-documents'' AND public.peut_pointer())';
    END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Bucket Storage non créé : %', SQLERRM;
END $$;
