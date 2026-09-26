"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { exigerRole } from "@/lib/session";
import { codeErreur } from "@/lib/erreurs";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
function retour(onglet: string, erreur?: unknown, succes?: string): never {
  revalidatePath("/", "layout");
  redirect(`/parametres?onglet=${onglet}&${erreur ? `erreur=${codeErreur(erreur)}` : `succes=${encodeURIComponent(succes ?? "Enregistré")}`}`);
}

export async function enregistrerSeuils(formData: FormData) {
  await exigerRole(["dg"]);
  const supabase = await createClient();
  const n = (k: string, d: number) => { const v = Number(s(formData, k)); return Number.isFinite(v) && s(formData, k) !== "" ? v : d; };
  const seuils = {
    solde_min_relance: n("solde_min_relance", 500000), jours_generique: n("jours_generique", 30), coef_cadence: n("coef_cadence", 1.5),
    cadence_min_jours: n("cadence_min_jours", 10), cadence_max_jours: n("cadence_max_jours", 45), promesse_part_min: n("promesse_part_min", 50),
    n3_jours: n("n3_jours", 60), n4_jours: n("n4_jours", 90), peremption_donnees_jours: n("peremption_donnees_jours", 1),
    part_min_reglement_couvrant: n("part_min_reglement_couvrant", 25), tolerance_promesse_jours: n("tolerance_promesse_jours", 7), bv_ratio_max: n("bv_ratio_max", 1.5),
    journaux_mobile_money: s(formData, "journaux_mobile_money").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
    stagnation_jours: n("stagnation_jours", 14), exercice: s(formData, "exercice") || null,
  };
  const societe = { nom: s(formData, "societe_nom"), sigle: s(formData, "societe_sigle"), adresse: s(formData, "societe_adresse"), ville: s(formData, "societe_ville"), pays: s(formData, "societe_pays"), nif: s(formData, "societe_nif"), telephone: s(formData, "societe_telephone"), email: s(formData, "societe_email"), site: s(formData, "societe_site") };
  const exploitation = {
    fuseau: s(formData, "fuseau") || "Africa/Niamey", heure_pont: s(formData, "heure_pont") || "07:00", expediteur: s(formData, "expediteur"),
    admins_alerte: s(formData, "admins_alerte").split(",").map((x) => x.trim()).filter(Boolean), domaines_email: s(formData, "domaines_email").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
  };
  const { error } = await supabase.from("parametres").upsert([{ cle: "seuils", valeur: seuils }, { cle: "societe", valeur: societe }, { cle: "exploitation", valeur: exploitation }]);
  if (error) retour("general", error);
  await supabase.rpc("journaliser", { p_quoi: "parametres_modifies", p_detail: { seuils } });
  const { error: e2 } = await supabase.rpc("recalculer_clients");
  retour("general", e2, "Paramètres enregistrés, soldes et cadences recalculés");
}

export async function modifierUtilisateur(id: string, formData: FormData) {
  const { profil } = await exigerRole(["dg"]);
  if (id === profil.id && formData.get("actif") !== "1") retour("utilisateurs", "Un compte ne peut pas se désactiver lui-même");
  const supabase = await createClient();
  const { error } = await supabase.from("profils").update({ role: s(formData, "role"), actif: formData.get("actif") === "1", email_contact: s(formData, "email_contact") || null, recap_quotidien: formData.get("recap_quotidien") === "1" }).eq("id", id);
  if (!error) await supabase.rpc("journaliser", { p_quoi: "utilisateur_modifie", p_detail: { id, role: s(formData, "role"), actif: formData.get("actif") === "1" } });
  retour("utilisateurs", error, "Utilisateur mis à jour");
}

export async function enregistrerModele(code: string, formData: FormData) {
  await exigerRole(["dg"]);
  const supabase = await createClient();
  const { error } = await supabase.from("modeles_messages").upsert({
    code: code || s(formData, "code").toLowerCase().replace(/[^a-z0-9_]+/g, "_"), libelle: s(formData, "libelle"), canal: s(formData, "canal") || "whatsapp",
    niveau: Number(s(formData, "niveau") || 0) || null, corps: s(formData, "corps"), valide_par_dg: formData.get("valide_par_dg") === "1", modifie_le: new Date().toISOString(),
  });
  retour("modeles", error, "Modèle enregistré");
}

export async function supprimerModele(code: string) {
  await exigerRole(["dg"]);
  const supabase = await createClient();
  const { error } = await supabase.from("modeles_messages").delete().eq("code", code);
  retour("modeles", error, "Modèle supprimé");
}

export async function enregistrerStation(numero: string, formData: FormData) {
  await exigerRole(["dg"]);
  const supabase = await createClient();
  const { error } = await supabase.from("stations").update({ libelle: s(formData, "libelle") || null, zone: s(formData, "zone") || null, actif: formData.get("actif") === "1", modifie_le: new Date().toISOString() }).eq("numero", numero);
  retour("stations", error, "Station mise à jour");
}
