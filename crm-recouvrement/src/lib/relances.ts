import type { SupabaseClient } from "@supabase/supabase-js";
import { envoyerEmail, emailActif } from "@/lib/email";

/**
 * Envoie les relances e-mail automatiques planifiées (échues à la date donnée) et les marque effectuées.
 * Utilisé par le cron quotidien et par le bouton "Générer les relances".
 */
export async function envoyerRelancesEmail(supabase: SupabaseClient, date: string): Promise<{ ok: number; erreurs: number }> {
  if (!emailActif()) return { ok: 0, erreurs: 0 };
  const { data: param } = await supabase.from("parametres").select("valeur").eq("cle", "recouvrement").single();
  const expediteur = (param?.valeur as { email_expediteur?: string } | null)?.email_expediteur || undefined;
  const { data: actions } = await supabase
    .from("actions_recouvrement")
    .select("id, sujet, contenu, clients(email)")
    .eq("statut", "planifiee")
    .eq("automatique", true)
    .eq("canal", "email")
    .lte("date_prevue", date);
  let ok = 0;
  let erreurs = 0;
  for (const a of actions ?? []) {
    const client = a.clients as unknown as { email: string | null } | null;
    if (!client?.email) {
      await supabase.from("actions_recouvrement").update({ automatique: false, resultat: "Adresse e-mail du client manquante : à traiter manuellement" }).eq("id", a.id);
      erreurs++;
      continue;
    }
    const res = await envoyerEmail({ a: client.email, sujet: a.sujet ?? "Relance", texte: a.contenu ?? "", expediteur });
    if (res.ok) {
      await supabase.from("actions_recouvrement").update({ statut: "effectuee", date_effectuee: new Date().toISOString(), resultat: `E-mail envoyé à ${client.email}` }).eq("id", a.id);
      ok++;
    } else {
      await supabase.from("actions_recouvrement").update({ resultat: `Échec d'envoi : ${res.erreur}` }).eq("id", a.id);
      erreurs++;
    }
  }
  return { ok, erreurs };
}
