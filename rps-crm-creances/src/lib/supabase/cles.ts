/**
 * Clés d'API Supabase du projet « RPS CRM CREANCES ».
 *
 * Nouveau schéma de clés (décision du chantier passerelle, 09/2026) :
 *   - côté navigateur / session : clé **publiable** `sb_publishable_…` (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ;
 *   - côté serveur (pont, crons) : clé **secrète** `sb_secret_…` (SUPABASE_SECRET_KEYS, liste « nouvelle,ancienne »
 *     pour une rotation à chaud : la première est utilisée).
 * Les anciennes clés JWT `anon` / `service_role` restent acceptées en repli tant qu'elles ne sont pas désactivées.
 */
export function clePubliable(): string {
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!cle) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY doit être définie");
  return cle;
}

export function cleSecrete(): string {
  const liste = (process.env.SUPABASE_SECRET_KEYS || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (liste.length === 0) throw new Error("SUPABASE_SECRET_KEYS doit être définie (serveur uniquement)");
  return liste[0];
}

export function urlSupabase(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL doit être définie");
  return url;
}
