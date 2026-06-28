import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * Client Supabase à privilèges élevés (service_role) — RLS contournée.
 *
 * RÉSERVÉ AU SERVEUR : import GESCOM, traitements cron (relances). Ne JAMAIS
 * exposer la clé service_role côté client. Même avec ce client, la table `ventes`
 * reste en INSERT seul (trigger anti-UPDATE/DELETE en base — règle d'or).
 */
export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY manquante : requise pour l'import et les traitements serveur.",
    );
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
