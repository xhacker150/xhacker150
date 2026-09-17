"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Connexion. Les comptes sont créés par la Direction générale (Supabase Authentication → Users) : pas d'inscription libre. */
export async function seConnecter(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const motDePasse = String(formData.get("mot_de_passe") ?? "");
  const suivant = String(formData.get("suivant") ?? "/dashboard");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) redirect(`/login?erreur=identifiants`);
  await supabase.from("profils").update({ derniere_connexion: new Date().toISOString() }).eq("email", email);
  // redirection interne uniquement (jamais « //hote » ni URL absolue)
  redirect(/^\/(?!\/)[\w\-./?=&%]*$/.test(suivant) ? suivant : "/dashboard");
}

export async function seDeconnecter() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
