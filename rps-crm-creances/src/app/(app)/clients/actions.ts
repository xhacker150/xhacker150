"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { exigerRole, exigerProfil } from "@/lib/session";
import { codeErreur } from "@/lib/erreurs";

function retour(compte: string, params: Record<string, string | undefined>): never {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) u.set(k, v); });
  revalidatePath(`/clients/${compte}`);
  revalidatePath("/recouvrement");
  revalidatePath("/dashboard");
  redirect(`/clients/${compte}${u.size ? `?${u.toString()}` : ""}`);
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Crée une action CRM (relance, promesse, plan, mise en demeure, contentieux, note, tâche, appel). Ne touche jamais à Sage. */
export async function creerAction(compte: string, formData: FormData) {
  await exigerRole(["dg", "recouvrement"]);
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
  const { error } = await supabase.rpc("creer_action", {
    p_compte: compte, p_type: type, p_note: s(formData, "note") || null, p_montant: Number(s(formData, "montant") || 0) || null,
    p_echeance: s(formData, "echeance") || null, p_canal: s(formData, "canal") || null, p_niveau: Number(s(formData, "niveau") || 0) || null,
    p_assignee: s(formData, "assignee_id") || null, p_date_action: s(formData, "date_action") || new Date().toISOString().slice(0, 10), p_echeances: echeances,
  });
  const retourVers = s(formData, "retour");
  if (error) {
    if (retourVers === "recouvrement") redirect(`/recouvrement?erreur=${codeErreur(error)}`);
    retour(compte, { erreur: codeErreur(error) });
  }
  if (retourVers === "recouvrement") { revalidatePath("/recouvrement"); redirect(`/recouvrement?succes=${encodeURIComponent("Action enregistrée")}`); }
  retour(compte, { succes: type === "promesse" ? "Promesse enregistrée" : type === "plan" ? "Plan de paiement enregistré" : type === "mise_en_demeure" ? "Mise en demeure enregistrée : préparez le courrier dans l'onglet Messages" : "Action enregistrée" });
}

export async function fermerAction(compte: string, id: string, formData: FormData) {
  await exigerRole(["dg", "recouvrement"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fermer_action", { p_id: id, p_motif: s(formData, "motif") || null, p_resultat: s(formData, "resultat") || null });
  const retourVers = s(formData, "retour");
  if (retourVers === "recouvrement") { revalidatePath("/recouvrement"); redirect(`/recouvrement?${error ? `erreur=${codeErreur(error)}` : "succes=Action+close"}`); }
  retour(compte, { erreur: error ? codeErreur(error) : undefined, succes: error ? undefined : "Action close" });
}

/** Trace un message sortant (WhatsApp / SMS / e-mail / courrier). L'envoi lui-même se fait via wa.me ou la passerelle. */
export async function enregistrerMessage(compte: string, formData: FormData) {
  const { profil } = await exigerRole(["dg", "recouvrement"]);
  const supabase = await createClient();
  const canal = s(formData, "canal") || "whatsapp";
  const contenu = s(formData, "contenu");
  if (!contenu) retour(compte, { erreur: "Message vide", onglet: "messages" });
  const modele = s(formData, "modele") || null;
  const niveau = Number(s(formData, "niveau") || 0) || null;
  let actionId: string | null = null;
  if (s(formData, "creer_relance") === "1") {
    const { data, error } = await supabase.rpc("creer_action", { p_compte: compte, p_type: modele === "mise_en_demeure" ? "mise_en_demeure" : "relance", p_note: `Message ${canal} envoyé (${modele ?? "libre"})`, p_canal: canal, p_niveau: niveau });
    if (error) retour(compte, { erreur: codeErreur(error), onglet: "messages" });   // ex. client créditeur : rien n'est tracé
    actionId = data ?? null;
  }
  const { error } = await supabase.from("messages_sortants").insert({ compte, canal, modele, destinataire: s(formData, "destinataire") || null, contenu, action_id: actionId, envoye_par: profil.id, envoye_par_nom: profil.nom });
  if (error) retour(compte, { erreur: codeErreur(error), onglet: "messages" });
  await supabase.rpc("journaliser", { p_quoi: "message_" + canal, p_compte: compte, p_detail: { modele, destinataire: s(formData, "destinataire") || null } });
  retour(compte, { succes: "Message tracé dans la chronologie", onglet: "messages" });
}

/** Extension du référentiel : contacts, typologie manuelle, chargé de compte, zone, notes. La limite de crédit n'est envoyée que par le DG. */
export async function enregistrerClientExt(compte: string, formData: FormData) {
  const { profil } = await exigerRole(["dg", "recouvrement"]);
  const supabase = await createClient();
  const contacts = [];
  for (let i = 1; i <= 4; i++) {
    const nom = s(formData, `contact_nom_${i}`);
    if (nom) contacts.push({ nom, tel: s(formData, `contact_tel_${i}`) || undefined, whatsapp: s(formData, `contact_whatsapp_${i}`) || undefined, email: s(formData, `contact_email_${i}`) || undefined, role: s(formData, `contact_role_${i}`) || undefined });
  }
  const typologie = s(formData, "typologie");
  const ligne: Record<string, unknown> = {
    compte, contacts, typologie: typologie || null, typologie_manuelle: Boolean(typologie), interlocuteur_id: s(formData, "interlocuteur_id") || null,
    segment_zone: s(formData, "segment_zone") || null, categorie: s(formData, "categorie") || null, notes: s(formData, "notes") || null,
  };
  if (profil.role === "dg") {
    const limite = Number(s(formData, "limite_credit") || 0);
    ligne.limite_credit = limite > 0 ? limite : null;
  }
  const { error } = await supabase.from("clients_ext").upsert(ligne);   // colonnes absentes intactes (limite protégée aussi par trigger)
  if (error) retour(compte, { erreur: codeErreur(error), onglet: "fiche" });
  await supabase.rpc("journaliser", { p_quoi: "fiche_modifiee", p_compte: compte, p_detail: { typologie: typologie || null, limite_credit: ligne.limite_credit ?? "inchangée" } });
  retour(compte, { succes: "Fiche mise à jour", onglet: "fiche" });
}

/** Étiquette « payeur » (règlement ou bon) et liens de règlement (multi-clients, réglé via, régularisation). Clé : compte + journal + pièce. */
export async function qualifierReglement(compte: string, formData: FormData) {
  const { profil } = await exigerRole(["dg", "recouvrement", "compta"]);
  const supabase = await createClient();
  const piece = s(formData, "piece");
  const journal = s(formData, "journal");
  const nature = s(formData, "nature") === "bon" ? "bon" : "reglement";
  if (!piece) retour(compte, { erreur: "Pièce manquante", onglet: nature === "bon" ? "livraisons" : "reglements" });
  const payeur = s(formData, "payeur");
  const lien = s(formData, "lien");
  let erreur: unknown;
  if (payeur) {
    const { error } = await supabase.from("etiquettes_payeur").upsert({ compte, nature, journal, piece, payeur, cree_par: profil.id }, { onConflict: "compte,nature,journal,piece" });
    erreur = error;
  }
  if (lien && !erreur) {
    const { error } = await supabase.from("reglements_liens").insert({ compte, journal, piece, lien, piece_liee: s(formData, "piece_liee") || null, compte_lie: s(formData, "compte_lie") || null, note: s(formData, "note") || null, cree_par: profil.id });
    erreur = error;
  }
  if (erreur) retour(compte, { erreur: codeErreur(erreur), onglet: nature === "bon" ? "livraisons" : "reglements" });
  await supabase.rpc("journaliser", { p_quoi: "reglement_qualifie", p_compte: compte, p_detail: { journal, piece, nature, payeur: payeur || null, lien: lien || null } });
  if (lien === "regularise") await supabase.rpc("recalculer_clients").then(() => undefined, () => undefined);   // les régularisations changent cadence et fermetures (DG/recouvrement)
  retour(compte, { succes: "Règlement qualifié", onglet: nature === "bon" ? "livraisons" : "reglements" });
}

/** Génère la situation officielle (numérotée, tracée dans documents et l'audit) puis ouvre la page imprimable. */
export async function genererSituation(compte: string) {
  const { profil } = await exigerRole(["dg", "recouvrement", "compta"]);
  const supabase = await createClient();
  const { data: x } = await supabase.from("extractions").select("date_extraction").eq("statut", "active").maybeSingle();
  if (!x) retour(compte, { erreur: "Aucune extraction active" });
  const { data: numero } = await supabase.rpc("reserver_numero", { p_type: "SIT" });
  const { data: doc, error } = await supabase.from("documents").insert({ compte, type: "situation_4_volets", date_arrete: x!.date_extraction, numero, genere_par: profil.id, chemin_ged: `30_CLIENTS/${compte}/${numero}.pdf` }).select("id").single();
  if (error) retour(compte, { erreur: codeErreur(error) });
  await supabase.rpc("journaliser", { p_quoi: "document_situation_4_volets", p_compte: compte, p_detail: { numero, date_arrete: x!.date_extraction } });
  redirect(`/clients/${compte}/situation?doc=${doc.id}`);
}
