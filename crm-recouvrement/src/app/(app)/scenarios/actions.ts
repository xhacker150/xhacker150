"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function creerScenario(formData: FormData) {
  const nom = String(formData.get("nom") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!nom) redirect(`/scenarios?erreur=${encodeURIComponent("Nom obligatoire")}`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("scenarios_relance").insert({ nom, description }).select("id").single();
  if (error) redirect(`/scenarios?erreur=${encodeURIComponent(error.message)}`);
  revalidatePath("/scenarios");
  redirect(`/scenarios/${data.id}?succes=${encodeURIComponent("Scénario créé : ajoutez ses étapes")}`);
}

export async function modifierScenario(id: string, formData: FormData) {
  const nom = String(formData.get("nom") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const actif = formData.get("actif") === "1";
  const supabase = await createClient();
  const { error } = await supabase.from("scenarios_relance").update({ nom, description, actif }).eq("id", id);
  revalidatePath("/scenarios");
  redirect(`/scenarios/${id}?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Scénario mis à jour")}`}`);
}

export async function definirParDefaut(id: string) {
  const supabase = await createClient();
  await supabase.from("scenarios_relance").update({ par_defaut: false }).eq("par_defaut", true);
  const { error } = await supabase.from("scenarios_relance").update({ par_defaut: true, actif: true }).eq("id", id);
  revalidatePath("/scenarios");
  redirect(`/scenarios?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Scénario par défaut mis à jour")}`}`);
}

export async function supprimerScenario(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("scenarios_relance").delete().eq("id", id).eq("par_defaut", false);
  revalidatePath("/scenarios");
  redirect(`/scenarios?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Scénario supprimé")}`}`);
}

function lireEtape(formData: FormData) {
  return {
    niveau: Number(formData.get("niveau") ?? 1),
    libelle: String(formData.get("libelle") ?? "").trim(),
    jours_apres_echeance: Number(formData.get("jours_apres_echeance") ?? 0),
    canal: String(formData.get("canal") ?? "email"),
    automatique: formData.get("automatique") === "1",
    modele_sujet: String(formData.get("modele_sujet") ?? "").trim() || null,
    modele_corps: String(formData.get("modele_corps") ?? "").trim() || null,
    bloquer_client: formData.get("bloquer_client") === "1",
    passer_en_contentieux: formData.get("passer_en_contentieux") === "1",
  };
}

export async function enregistrerEtape(scenarioId: string, etapeId: string | null, formData: FormData) {
  const champs = lireEtape(formData);
  if (!champs.libelle) redirect(`/scenarios/${scenarioId}?erreur=${encodeURIComponent("Libellé obligatoire")}`);
  const supabase = await createClient();
  const { error } = etapeId
    ? await supabase.from("etapes_relance").update(champs).eq("id", etapeId)
    : await supabase.from("etapes_relance").insert({ ...champs, scenario_id: scenarioId });
  revalidatePath(`/scenarios/${scenarioId}`);
  const msg = error?.code === "23505" ? "Ce niveau existe déjà dans le scénario" : error?.message;
  redirect(`/scenarios/${scenarioId}?${error ? `erreur=${encodeURIComponent(msg ?? "")}` : `succes=${encodeURIComponent("Étape enregistrée")}`}`);
}

export async function supprimerEtape(scenarioId: string, etapeId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("etapes_relance").delete().eq("id", etapeId);
  revalidatePath(`/scenarios/${scenarioId}`);
  redirect(`/scenarios/${scenarioId}?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Étape supprimée")}`}`);
}
