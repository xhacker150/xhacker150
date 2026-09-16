import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profil, ParametresFacturation, ParametresSociete, ParametresRecouvrement } from "@/lib/types";

/** Retourne l'utilisateur connecté et son profil, ou redirige vers la page de connexion. */
export async function exigerProfil(): Promise<{ profil: Profil }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profil } = await supabase.from("profils").select("*").eq("id", user.id).single();
  if (!profil || !profil.actif) {
    await supabase.auth.signOut();
    redirect("/login?erreur=compte_inactif");
  }
  return { profil: profil as Profil };
}

export async function exigerRole(roles: Profil["role"][]) {
  const { profil } = await exigerProfil();
  if (!roles.includes(profil.role)) redirect("/dashboard?erreur=acces_refuse");
  return { profil };
}

export interface Parametres {
  societe: ParametresSociete;
  facturation: ParametresFacturation;
  recouvrement: ParametresRecouvrement;
}

const DEFAUTS: Parametres = {
  societe: { nom: "Ma Société", adresse: "", ville: "", pays: "", telephone: "", email: "", nif: "", rccm: "" },
  facturation: {
    devise: "XOF",
    taux_tva_defaut: 19,
    delai_paiement_defaut: 30,
    prefixe_facture: "FAC",
    prefixe_reglement: "REG",
    mentions_legales: "",
  },
  recouvrement: { delai_min_entre_relances_jours: 3, montant_min_relance: 0, email_expediteur: "" },
};

export async function lireParametres(): Promise<Parametres> {
  const supabase = await createClient();
  const { data } = await supabase.from("parametres").select("cle, valeur");
  const p: Parametres = structuredClone(DEFAUTS);
  for (const row of data ?? []) {
    if (row.cle in p) {
      (p as unknown as Record<string, object>)[row.cle] = { ...(p as unknown as Record<string, object>)[row.cle], ...row.valeur };
    }
  }
  return p;
}
