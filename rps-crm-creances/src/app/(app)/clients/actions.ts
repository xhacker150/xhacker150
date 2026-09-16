"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function retour(compte: string, params: Record<string, string | undefined>) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) u.set(k, v); });
  revalidatePath(`/clients/${compte}`);
  revalidatePath("/recouvrement");
  revalidatePath("/dashboard");
  redirect(`/clients/${compte}${u.size ? `?${u.toString()}` : ""}`);
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Crée une action CRM (relance, promesse, plan, contentieux, note, tâche, appel). Ne touche jamais à Sage. */
export async function creerAction(compte: string, formData: FormData) {
  const type = s(formData, "type");
  const supabase = await createClient();
  let echeances: { echeance: string; montant: number }[] | null = null;
  if (type === "plan") {
    echeances = [];
    for (let i = 1; i <= 6; i++) {
      const e = s(formData, `plan_echeance_${i}`);
      const m = Number(s(formData, `plan_montant_${i}`) || 0);
      if (e && m > 0) echeances.push({ echeance: e, montant: m });
    }
  }
  const { data, error } = await supabase.rpc("creer_action", {
    p_compte: compte,
    p_type: type,
    p_note: s(formData, "note") || null,
    p_montant: Number(s(formData, "montant") || 0) || null,
    p_echeance: s(formData, "echeance") || null,
    p_canal: s(formData, "canal") || null,
    p_niveau: Number(s(formData, "niveau") || 0) || null,
    p_assignee: s(formData, "assignee_id") || null,
    p_date_action: s(formData, "date_action") || new Date().toISOString().slice(0, 10),
    p_echeances: echeances,
  });
  if (error) retour(compte, { erreur: error.message, retour: s(formData, "retour") || undefined });
  const retourVers = s(formData, "retour");
  if (retourVers === "recouvrement") { revalidatePath("/recouvrement"); redirect(`/recouvrement?succes=${encodeURIComponent("Action enregistrée")}`); }
  retour(compte, { succes: `${type === "promesse" ? "Promesse" : type === "plan" ? "Plan de paiement" : "Action"} enregistré(e)`, action: String(data) });
}

export async function fermerAction(compte: string, id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fermer_action", { p_id: id, p_motif: s(formData, "motif") || null, p_resultat: s(formData, "resultat") || null });
  const retourVers = s(formData, "retour");
  if (retourVers === "recouvrement") { revalidatePath("/recouvrement"); redirect(`/recouvrement?${error ? `erreur=${encodeURIComponent(error.message)}` : "succes=Action+close"}`); }
  retour(compte, { erreur: error?.message, succes: error ? undefined : "Action close" });
}

/** Trace un message sortant (WhatsApp / SMS / e-mail / courrier) dans la timeline. L'envoi lui-même se fait via le lien wa.me ou la passerelle. */
export async function enregistrerMessage(compte: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profil } = await supabase.from("profils").select("nom").eq("id", user?.id ?? "").maybeSingle();
  const canal = s(formData, "canal") || "whatsapp";
  const contenu = s(formData, "contenu");
  if (!contenu) retour(compte, { erreur: "Message vide" });
  const niveau = Number(s(formData, "niveau") || 0) || null;
  let actionId: string | null = null;
  if (s(formData, "creer_relance") === "1") {
    const { data } = await supabase.rpc("creer_action", { p_compte: compte, p_type: "relance", p_note: `Message ${canal} envoyé (${s(formData, "modele") || "libre"})`, p_canal: canal, p_niveau: niveau });
    actionId = data ?? null;
  }
  const { error } = await supabase.from("messages_sortants").insert({
    compte, canal, modele: s(formData, "modele") || null, destinataire: s(formData, "destinataire") || null, contenu, action_id: actionId, envoye_par: user?.id, envoye_par_nom: profil?.nom ?? null,
  });
  if (!error) await supabase.rpc("journaliser", { p_quoi: "message_" + canal, p_compte: compte, p_detail: { modele: s(formData, "modele") || null, destinataire: s(formData, "destinataire") || null } });
  retour(compte, { erreur: error?.message, succes: error ? undefined : "Message tracé dans la chronologie" });
}

/** Extension du référentiel : contacts, typologie manuelle, limite de crédit, interlocuteur, zone, notes. */
export async function enregistrerClientExt(compte: string, formData: FormData) {
  const supabase = await createClient();
  const contacts = [];
  for (let i = 1; i <= 4; i++) {
    const nom = s(formData, `contact_nom_${i}`);
    if (nom) contacts.push({ nom, tel: s(formData, `contact_tel_${i}`) || undefined, whatsapp: s(formData, `contact_whatsapp_${i}`) || undefined, email: s(formData, `contact_email_${i}`) || undefined, role: s(formData, `contact_role_${i}`) || undefined });
  }
  const typologie = s(formData, "typologie");
  const limite = Number(s(formData, "limite_credit") || 0);
  const { error } = await supabase.from("clients_ext").upsert({
    compte, contacts, typologie: typologie || null, typologie_manuelle: Boolean(typologie),
    limite_credit: limite > 0 ? limite : null, interlocuteur_id: s(formData, "interlocuteur_id") || null,
    segment_zone: s(formData, "segment_zone") || null, categorie: s(formData, "categorie") || null, notes: s(formData, "notes") || null,
  });
  if (!error) await supabase.rpc("journaliser", { p_quoi: "fiche_modifiee", p_compte: compte, p_detail: { typologie: typologie || null, limite_credit: limite || null } });
  retour(compte, { erreur: error?.message, succes: error ? undefined : "Fiche mise à jour" });
}

/** Étiquette « payeur » sur une pièce (comptes collectifs) ou lien de règlement (multi-clients, réglé via, régularisation). */
export async function qualifierReglement(compte: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const piece = s(formData, "piece");
  if (!piece) retour(compte, { erreur: "Pièce manquante" });
  const payeur = s(formData, "payeur");
  const lien = s(formData, "lien");
  let erreur: string | undefined;
  if (payeur) {
    const { error } = await supabase.from("etiquettes_payeur").upsert({ compte, piece, payeur, cree_par: user?.id }, { onConflict: "compte,piece" });
    erreur = error?.message;
  }
  if (lien && !erreur) {
    const { error } = await supabase.from("reglements_liens").insert({ compte, piece, lien, piece_liee: s(formData, "piece_liee") || null, compte_lie: s(formData, "compte_lie") || null, note: s(formData, "note") || null, cree_par: user?.id });
    erreur = error?.message;
  }
  if (!erreur) await supabase.rpc("journaliser", { p_quoi: "reglement_qualifie", p_compte: compte, p_detail: { piece, payeur: payeur || null, lien: lien || null } });
  retour(compte, { erreur, succes: erreur ? undefined : "Règlement qualifié", onglet: "reglements" });
}

export async function enregistrerDocument(compte: string, type: string, dateArrete: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("documents").insert({ compte, type, date_arrete: dateArrete, genere_par: user?.id, chemin_ged: `30_CLIENTS/${compte}/` });
  await supabase.rpc("journaliser", { p_quoi: "document_" + type, p_compte: compte, p_detail: { date_arrete: dateArrete } });
}
