"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { envoyerEmail, emailActif } from "@/lib/email";
import { envoyerRelancesEmail } from "@/lib/relances";

function retour(params: Record<string, string | undefined>) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) u.set(k, v); });
  redirect(`/recouvrement?${u.toString()}`);
}

/** Lance le moteur de relance (même traitement que le cron quotidien) et envoie les e-mails automatiques. */
export async function genererRelances() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generer_relances", { p_date: new Date().toISOString().slice(0, 10) });
  if (error) retour({ erreur: error.message });
  const { data: nbPromesses } = await supabase.rpc("verifier_promesses");
  const nbCreees = (data ?? []).length;
  const envoyes = await envoyerRelancesEmail(supabase, new Date().toISOString().slice(0, 10));
  revalidatePath("/recouvrement");
  revalidatePath("/dashboard");
  retour({
    succes: `${nbCreees} relance(s) générée(s), ${envoyes.ok} e-mail(s) envoyé(s)${envoyes.erreurs ? `, ${envoyes.erreurs} échec(s)` : ""}, ${nbPromesses ?? 0} promesse(s) rompue(s) détectée(s).${emailActif() ? "" : " Envoi e-mail non configuré : les relances e-mail sont à traiter manuellement."}`,
  });
}

export async function creerAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const client_id = String(formData.get("client_id") ?? "");
  const facture_id = String(formData.get("facture_id") ?? "") || null;
  const type = String(formData.get("type") ?? "note");
  const date_prevue = String(formData.get("date_prevue") ?? "");
  const sujet = String(formData.get("sujet") ?? "").trim();
  const contenu = String(formData.get("contenu") ?? "").trim() || null;
  const effectuee = formData.get("effectuee") === "1";
  if (!client_id || !sujet || !date_prevue) retour({ erreur: "Client, objet et date sont obligatoires", client_id, nouvelle: "1" });
  const canalParType: Record<string, string | null> = { appel: "appel", email: "email", sms: "sms", courrier: "courrier", visite: "visite", mise_en_demeure: "mise_en_demeure", contentieux: "contentieux" };
  const { error } = await supabase.from("actions_recouvrement").insert({
    client_id, facture_id, type, canal: canalParType[type] ?? null, date_prevue, sujet, contenu,
    statut: effectuee ? "effectuee" : "planifiee", date_effectuee: effectuee ? new Date().toISOString() : null, agent_id: user?.id, automatique: false,
  });
  if (error) retour({ erreur: error.message, client_id, nouvelle: "1" });
  revalidatePath("/recouvrement");
  retour({ succes: "Action enregistrée" });
}

export async function effectuerAction(id: string, formData: FormData) {
  const resultat = String(formData.get("resultat") ?? "").trim() || null;
  const promesseMontant = Number(formData.get("promesse_montant") ?? 0);
  const promesseDate = String(formData.get("promesse_date") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: action, error } = await supabase
    .from("actions_recouvrement")
    .update({ statut: "effectuee", date_effectuee: new Date().toISOString(), resultat, agent_id: user?.id })
    .eq("id", id)
    .select("client_id, facture_id")
    .single();
  if (error) retour({ erreur: error.message });
  if (promesseMontant > 0 && promesseDate && action) {
    await supabase.from("promesses_paiement").insert({ client_id: action.client_id, facture_id: action.facture_id, action_id: id, montant: promesseMontant, date_promise: promesseDate, cree_par: user?.id, commentaire: resultat });
  }
  revalidatePath("/recouvrement");
  retour({ succes: promesseMontant > 0 ? "Action clôturée et promesse enregistrée" : "Action clôturée" });
}

export async function annulerAction(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("actions_recouvrement").update({ statut: "annulee" }).eq("id", id);
  revalidatePath("/recouvrement");
  retour({ erreur: error?.message, succes: error ? undefined : "Action annulée" });
}

export async function envoyerActionEmail(id: string) {
  const supabase = await createClient();
  const { data: a } = await supabase.from("actions_recouvrement").select("id, sujet, contenu, clients(email)").eq("id", id).single();
  const client = a?.clients as unknown as { email: string | null } | null;
  if (!a || !client?.email) retour({ erreur: "Adresse e-mail du client manquante" });
  if (!emailActif()) retour({ erreur: "Envoi e-mail non configuré (RESEND_API_KEY)" });
  const res = await envoyerEmail({ a: client!.email!, sujet: a!.sujet ?? "Relance", texte: a!.contenu ?? "" });
  if (!res.ok) retour({ erreur: res.erreur });
  await supabase.from("actions_recouvrement").update({ statut: "effectuee", date_effectuee: new Date().toISOString(), resultat: `E-mail envoyé à ${client!.email}` }).eq("id", id);
  revalidatePath("/recouvrement");
  retour({ succes: "E-mail envoyé" });
}

export async function changerStatutPromesse(id: string, statut: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("promesses_paiement").update({ statut }).eq("id", id);
  revalidatePath("/recouvrement");
  retour({ onglet: "promesses", erreur: error?.message, succes: error ? undefined : "Promesse mise à jour" });
}

export async function creerPromesse(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const client_id = String(formData.get("client_id") ?? "");
  const montant = Number(formData.get("montant") ?? 0);
  const date_promise = String(formData.get("date_promise") ?? "");
  const commentaire = String(formData.get("commentaire") ?? "").trim() || null;
  if (!client_id || !(montant > 0) || !date_promise) retour({ onglet: "promesses", erreur: "Client, montant et date sont obligatoires" });
  const { error } = await supabase.from("promesses_paiement").insert({ client_id, montant, date_promise, commentaire, cree_par: user?.id });
  revalidatePath("/recouvrement");
  retour({ onglet: "promesses", erreur: error?.message, succes: error ? undefined : "Promesse enregistrée" });
}
