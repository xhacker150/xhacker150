import { createClient } from "@supabase/supabase-js";
import { cleSecrete, urlSupabase } from "./cles";

/**
 * Client avec la clé secrète (`sb_secret_…`, rôle service_role) : contourne le RLS.
 * Réservé aux traitements serveur (pont, crons). Ne jamais l'importer côté client.
 */
export function createAdminClient() {
  return createClient(urlSupabase(), cleSecrete(), { auth: { persistSession: false, autoRefreshToken: false } });
}
