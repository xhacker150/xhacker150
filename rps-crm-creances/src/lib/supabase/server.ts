import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clePubliable, urlSupabase } from "./cles";

/** Client Supabase côté serveur (composants serveur, actions, routes) lié à la session de l'utilisateur. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    urlSupabase(),
    clePubliable(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Appelé depuis un composant serveur : le middleware rafraîchit la session.
          }
        },
      },
    }
  );
}
