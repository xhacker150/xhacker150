-- ============================================================
-- Durcissement après les avis de sécurité Supabase (linter) sur le projet « RPS CRM CREANCES »
--   0011 : chemin de recherche figé sur toutes les fonctions du schéma public
--   0028 / 0029 : fonctions SECURITY DEFINER (déclencheurs, internes) retirées de l'API REST
--   rafraichir_stations() : réservée au service (elle est appelée par déclencheur à l'activation)
-- ============================================================

-- 1. search_path figé : une fonction ne doit jamais résoudre un nom via le search_path de l'appelant
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT p.oid::regprocedure AS sig
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prokind = 'f'
                AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%') LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
    END LOOP;
END $$;

-- 2. Fonctions de déclencheur : jamais appelables par l'API (elles s'exécutent par les triggers, sans contrôle EXECUTE)
REVOKE EXECUTE ON FUNCTION creer_profil_utilisateur() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION journaliser_suppression() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION synchroniser_habilitation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_actions_pipeline() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION trg_extraction_activee() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION proteger_profil() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION proteger_limite_credit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION controler_action() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION controler_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION refuser_suppression() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION maj_modifie_le() FROM PUBLIC, anon, authenticated;

-- 3. Fonctions internes : le service seul (le déclencheur d'activation les appelle sans contrôle EXECUTE)
REVOKE EXECUTE ON FUNCTION rafraichir_stations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rafraichir_stations() TO service_role;

-- 4. Aides de rôle : inutiles à anon (toutes les politiques RLS sont « TO authenticated »)
REVOKE EXECUTE ON FUNCTION role_courant() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION nom_courant() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION est_service() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION est_utilisateur_actif() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION est_dg() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION peut_recouvrer() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION peut_pointer() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION parametre(VARCHAR) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION exiger_pont() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION role_courant(), nom_courant(), est_service(), est_utilisateur_actif(), est_dg(), peut_recouvrer(), peut_pointer(), parametre(VARCHAR), exiger_pont() TO authenticated, service_role;
