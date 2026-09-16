"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
function retour(onglet: string, erreur?: string, succes?: string) {
  revalidatePath("/", "layout");
  redirect(`/parametres?onglet=${onglet}&${erreur ? `erreur=${encodeURIComponent(erreur)}` : `succes=${encodeURIComponent(succes ?? "Enregistré")}`}`);
}

export async function enregistrerSeuils(formData: FormData) {
  const supabase = await createClient();
  const seuils = {
    solde_min_relance: Number(s(formData, "solde_min_relance") || 500000),
    jours_generique: Number(s(formData, "jours_generique") || 30),
    coef_cadence: Number(s(formData, "coef_cadence") || 1.5),
    cadence_min_jours: Number(s(formData, "cadence_min_jours") || 10),
    cadence_max_jours: Number(s(formData, "cadence_max_jours") || 45),
    promesse_part_min: Number(s(formData, "promesse_part_min") || 50),
    n3_jours: Number(s(formData, "n3_jours") || 60),
    n4_jours: Number(s(formData, "n4_jours") || 90),
    peremption_donnees_jours: Number(s(formData, "peremption_donnees_jours") || 1),
  };
  const societe = { nom: s(formData, "societe_nom"), sigle: s(formData, "societe_sigle"), adresse: s(formData, "societe_adresse"), ville: s(formData, "societe_ville"), pays: s(formData, "societe_pays"), nif: s(formData, "societe_nif"), telephone: s(formData, "societe_telephone"), email: s(formData, "societe_email"), site: s(formData, "societe_site") };
  const { error } = await supabase.from("parametres").upsert([{ cle: "seuils", valeur: seuils }, { cle: "societe", valeur: societe }]);
  if (!error) await supabase.rpc("recalculer_clients");
  retour("general", error?.message, "Paramètres enregistrés, soldes et cadences recalculés");
}

export async function modifierUtilisateur(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("profils").update({ role: s(formData, "role"), actif: formData.get("actif") === "1" }).eq("id", id);
  if (!error) await supabase.rpc("journaliser", { p_quoi: "utilisateur_modifie", p_detail: { id, role: s(formData, "role"), actif: formData.get("actif") === "1" } });
  retour("utilisateurs", error?.message, "Utilisateur mis à jour");
}

export async function enregistrerModele(code: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("modeles_messages").upsert({
    code: code || s(formData, "code").toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
    libelle: s(formData, "libelle"), canal: s(formData, "canal") || "whatsapp", niveau: Number(s(formData, "niveau") || 0) || null,
    corps: s(formData, "corps"), valide_par_dg: formData.get("valide_par_dg") === "1", modifie_le: new Date().toISOString(),
  });
  retour("modeles", error?.message, "Modèle enregistré");
}

export async function supprimerModele(code: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("modeles_messages").delete().eq("code", code);
  retour("modeles", error?.message, "Modèle supprimé");
}
