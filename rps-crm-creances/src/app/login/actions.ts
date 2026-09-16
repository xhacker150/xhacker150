"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function seConnecter(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const motDePasse = String(formData.get("mot_de_passe") ?? "");
  const suivant = String(formData.get("suivant") ?? "/dashboard");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) {
    redirect(`/login?erreur=${encodeURIComponent("Identifiants incorrects")}`);
  }
  redirect(suivant.startsWith("/") ? suivant : "/dashboard");
}

export async function creerCompte(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const motDePasse = String(formData.get("mot_de_passe") ?? "");
  const nom = String(formData.get("nom") ?? "").trim();
  if (motDePasse.length < 8) redirect(`/login?onglet=inscription&erreur=${encodeURIComponent("Mot de passe : 8 caractères minimum")}`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password: motDePasse, options: { data: { nom } } });
  if (error) redirect(`/login?onglet=inscription&erreur=${encodeURIComponent(error.message)}`);
  if (data.session) redirect("/dashboard");
  redirect(`/login?info=${encodeURIComponent("Compte créé. Vérifiez votre e-mail pour confirmer l'adresse, puis connectez-vous.")}`);
}

export async function seDeconnecter() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
