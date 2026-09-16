"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface EtatReglement {
  erreur?: string;
}

export async function enregistrerReglement(_etat: EtatReglement, formData: FormData): Promise<EtatReglement> {
  const client_id = String(formData.get("client_id") ?? "");
  const montant = Number(formData.get("montant") ?? 0);
  const date_reglement = String(formData.get("date_reglement") ?? "");
  const mode = String(formData.get("mode") ?? "virement");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const banque = String(formData.get("banque") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const modeLettrage = String(formData.get("mode_lettrage") ?? "auto");

  if (!client_id) return { erreur: "Sélectionnez un client" };
  if (!(montant > 0)) return { erreur: "Le montant doit être positif" };
  if (!date_reglement) return { erreur: "Date obligatoire" };

  let lettrages: { facture_id: string; montant: number }[] | null = null;
  if (modeLettrage === "manuel") {
    try {
      lettrages = (JSON.parse(String(formData.get("lettrages") ?? "[]")) as { facture_id: string; montant: number }[]).filter((l) => l.montant > 0);
    } catch {
      return { erreur: "Affectation invalide" };
    }
    const total = lettrages.reduce((s, l) => s + l.montant, 0);
    if (total - montant > 0.005) return { erreur: `Le total affecté (${total}) dépasse le montant du règlement (${montant})` };
    if (lettrages.length === 0) return { erreur: "Affectez le règlement à au moins une facture, ou choisissez l'affectation automatique" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enregistrer_reglement", {
    p_client_id: client_id,
    p_montant: montant,
    p_date_reglement: date_reglement,
    p_mode: mode,
    p_reference: reference,
    p_banque: banque,
    p_notes: notes,
    p_lettrages: lettrages,
  });
  if (error) return { erreur: error.message };
  revalidatePath("/reglements");
  revalidatePath("/factures");
  revalidatePath(`/clients/${client_id}`);
  redirect(`/reglements?succes=${encodeURIComponent("Règlement enregistré")}&id=${data}`);
}

export async function annulerReglement(id: string, formData: FormData) {
  const motif = String(formData.get("motif") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("annuler_reglement", { p_id: id, p_motif: motif });
  revalidatePath("/reglements");
  revalidatePath("/factures");
  redirect(`/reglements?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent("Règlement annulé, factures recalculées")}`}`);
}
