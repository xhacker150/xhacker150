"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function enregistrerParametres(formData: FormData) {
  const v = (k: string) => String(formData.get(k) ?? "").trim();
  const societe = { nom: v("societe_nom"), adresse: v("societe_adresse"), ville: v("societe_ville"), pays: v("societe_pays"), telephone: v("societe_telephone"), email: v("societe_email"), nif: v("societe_nif"), rccm: v("societe_rccm") };
  const facturation = {
    devise: v("devise") || "XOF",
    taux_tva_defaut: Number(v("taux_tva_defaut") || 0),
    delai_paiement_defaut: Number(v("delai_paiement_defaut") || 30),
    prefixe_facture: (v("prefixe_facture") || "FAC").toUpperCase().slice(0, 10),
    prefixe_reglement: (v("prefixe_reglement") || "REG").toUpperCase().slice(0, 10),
    mentions_legales: v("mentions_legales"),
  };
  const recouvrement = {
    delai_min_entre_relances_jours: Number(v("delai_min_entre_relances_jours") || 3),
    montant_min_relance: Number(v("montant_min_relance") || 0),
    email_expediteur: v("email_expediteur"),
  };
  const supabase = await createClient();
  const { error } = await supabase.from("parametres").upsert([
    { cle: "societe", valeur: societe },
    { cle: "facturation", valeur: facturation },
    { cle: "recouvrement", valeur: recouvrement },
  ]);
  revalidatePath("/", "layout");
  redirect(`/parametres?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Paramètres enregistrés")}`}`);
}

export async function modifierUtilisateur(id: string, formData: FormData) {
  const role = String(formData.get("role") ?? "agent");
  const actif = formData.get("actif") === "1";
  const supabase = await createClient();
  const { error } = await supabase.from("profils").update({ role, actif }).eq("id", id);
  revalidatePath("/parametres");
  redirect(`/parametres?onglet=utilisateurs&${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Utilisateur mis à jour")}`}`);
}
