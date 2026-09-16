"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface EtatFacture {
  erreur?: string;
}

export async function creerFacture(_etat: EtatFacture, formData: FormData): Promise<EtatFacture> {
  const client_id = String(formData.get("client_id") ?? "");
  const date_facture = String(formData.get("date_facture") ?? "");
  const date_echeance = String(formData.get("date_echeance") ?? "") || null;
  const objet = String(formData.get("objet") ?? "").trim() || null;
  const reference_externe = String(formData.get("reference_externe") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const emettre = formData.get("emettre") === "1";

  let lignes: { designation: string; quantite: number; prix_unitaire: number; taux_tva: number }[] = [];
  try {
    lignes = JSON.parse(String(formData.get("lignes") ?? "[]"));
  } catch {
    return { erreur: "Lignes invalides" };
  }
  lignes = lignes.filter((l) => l.designation && l.designation.trim() !== "");
  if (!client_id) return { erreur: "Sélectionnez un client" };
  if (!date_facture) return { erreur: "Date de facture obligatoire" };
  if (lignes.length === 0) return { erreur: "Ajoutez au moins une ligne" };
  if (lignes.some((l) => !(l.quantite > 0) || l.prix_unitaire < 0)) return { erreur: "Quantités et prix doivent être positifs" };
  if (date_echeance && date_echeance < date_facture) return { erreur: "L'échéance doit être postérieure à la date de facture" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("creer_facture", {
    p_client_id: client_id,
    p_lignes: lignes,
    p_date_facture: date_facture,
    p_date_echeance: date_echeance,
    p_objet: objet,
    p_reference_externe: reference_externe,
    p_notes: notes,
    p_emettre: emettre,
  });
  if (error) return { erreur: error.message };
  revalidatePath("/factures");
  revalidatePath(`/clients/${client_id}`);
  redirect(`/factures/${data}?succes=${encodeURIComponent(emettre ? "Facture émise" : "Brouillon enregistré")}`);
}

export async function emettreFacture(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("emettre_facture", { p_id: id });
  revalidatePath(`/factures/${id}`);
  redirect(`/factures/${id}?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Facture émise")}`}`);
}

export async function annulerFacture(id: string, formData: FormData) {
  const motif = String(formData.get("motif") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("annuler_facture", { p_id: id, p_motif: motif });
  revalidatePath(`/factures/${id}`);
  redirect(`/factures/${id}?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Facture annulée")}`}`);
}

export async function basculerSuspensionRelances(id: string, suspendre: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("factures").update({ relances_suspendues: suspendre }).eq("id", id);
  revalidatePath(`/factures/${id}`);
  redirect(`/factures/${id}?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent(suspendre ? "Relances suspendues" : "Relances réactivées")}`}`);
}

export async function ouvrirLitige(id: string, clientId: string, formData: FormData) {
  const motif = String(formData.get("motif") ?? "").trim();
  if (!motif) redirect(`/factures/${id}?erreur=${encodeURIComponent("Indiquez le motif du litige")}`);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("litiges").insert({ facture_id: id, client_id: clientId, motif, ouvert_par: user?.id });
  if (!error) {
    await supabase.from("actions_recouvrement").insert({ client_id: clientId, facture_id: id, type: "litige", statut: "effectuee", date_effectuee: new Date().toISOString(), sujet: "Litige ouvert", contenu: motif, agent_id: user?.id });
  }
  revalidatePath(`/factures/${id}`);
  redirect(`/factures/${id}?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Litige ouvert, relances suspendues")}`}`);
}

export async function cloturerLitige(litigeId: string, factureId: string, formData: FormData) {
  const statut = String(formData.get("statut") ?? "resolu");
  const resolution = String(formData.get("resolution") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase.from("litiges").update({ statut, resolution, resolu_le: new Date().toISOString() }).eq("id", litigeId);
  revalidatePath(`/factures/${factureId}`);
  redirect(`/factures/${factureId}?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Litige clôturé")}`}`);
}
