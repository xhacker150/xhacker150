"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function lireChamps(formData: FormData) {
  const v = (k: string) => {
    const x = formData.get(k);
    return x === null ? null : String(x).trim() || null;
  };
  return {
    code: v("code")?.toUpperCase() ?? "",
    raison_sociale: v("raison_sociale") ?? "",
    type: v("type") ?? "entreprise",
    nif: v("nif"),
    rccm: v("rccm"),
    adresse: v("adresse"),
    ville: v("ville"),
    pays: v("pays"),
    telephone: v("telephone"),
    email: v("email"),
    contact_nom: v("contact_nom"),
    contact_fonction: v("contact_fonction"),
    delai_paiement_jours: Number(v("delai_paiement_jours") ?? 30),
    plafond_credit: Number(v("plafond_credit") ?? 0),
    statut: v("statut") ?? "actif",
    scenario_id: v("scenario_id"),
    agent_id: v("agent_id"),
    reference_sage: v("reference_sage"),
    notes: v("notes"),
  };
}

export async function creerClient(formData: FormData) {
  const champs = lireChamps(formData);
  if (!champs.code || !champs.raison_sociale) redirect(`/clients/nouveau?erreur=${encodeURIComponent("Code et raison sociale obligatoires")}`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").insert(champs).select("id").single();
  if (error) {
    const msg = error.code === "23505" ? "Ce code client existe déjà" : error.message;
    redirect(`/clients/nouveau?erreur=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/clients");
  redirect(`/clients/${data.id}?succes=${encodeURIComponent("Client créé")}`);
}

export async function modifierClient(id: string, formData: FormData) {
  const champs = lireChamps(formData);
  if (!champs.code || !champs.raison_sociale) redirect(`/clients/${id}/modifier?erreur=${encodeURIComponent("Code et raison sociale obligatoires")}`);
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update(champs).eq("id", id);
  if (error) {
    const msg = error.code === "23505" ? "Ce code client existe déjà" : error.message;
    redirect(`/clients/${id}/modifier?erreur=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}?succes=${encodeURIComponent("Client mis à jour")}`);
}

export async function changerStatutClient(id: string, statut: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({ statut }).eq("id", id);
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Statut mis à jour")}`}`);
}
