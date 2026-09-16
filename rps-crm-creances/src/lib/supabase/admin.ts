import { createClient } from "@supabase/supabase-js";

/**
 * Client avec la clé service_role : contourne le RLS.
 * Réservé aux traitements serveur (cron des relances). Ne jamais l'importer côté client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY et NEXT_PUBLIC_SUPABASE_URL doivent être définis");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
