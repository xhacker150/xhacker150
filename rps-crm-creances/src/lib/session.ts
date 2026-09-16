import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profil, Role, Extraction } from "@/lib/types";

/** Utilisateur connecté et actif, sinon redirection vers la connexion. */
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

export async function exigerRole(roles: Role[]) {
  const { profil } = await exigerProfil();
  if (!roles.includes(profil.role)) redirect("/dashboard?erreur=acces_refuse");
  return { profil };
}

export function peutRecouvrer(role: Role) {
  return role === "dg" || role === "recouvrement";
}
export function peutPointer(role: Role) {
  return role === "dg" || role === "recouvrement" || role === "compta";
}

export interface Parametres {
  societe: { nom: string; sigle: string; adresse: string; ville: string; pays: string; nif: string; telephone: string; email: string; site: string };
  seuils: { solde_min_relance: number; jours_generique: number; coef_cadence: number; cadence_min_jours: number; cadence_max_jours: number; promesse_part_min: number; n3_jours: number; n4_jours: number; peremption_donnees_jours: number };
  sequences: Record<string, { libelle: string; declencheur: string }>;
}
const DEFAUTS: Parametres = {
  societe: { nom: "RISSA PETROLEUM SERVICE", sigle: "RPS", adresse: "B.P. 2184 Niamey", ville: "Niamey", pays: "Niger", nif: "7272/R", telephone: "", email: "", site: "" },
  seuils: { solde_min_relance: 500000, jours_generique: 30, coef_cadence: 1.5, cadence_min_jours: 10, cadence_max_jours: 45, promesse_part_min: 50, n3_jours: 60, n4_jours: 90, peremption_donnees_jours: 1 },
  sequences: {},
};
export async function lireParametres(): Promise<Parametres> {
  const supabase = await createClient();
  const { data } = await supabase.from("parametres").select("cle, valeur");
  const p: Parametres = structuredClone(DEFAUTS);
  for (const row of data ?? []) {
    if (row.cle in p) (p as unknown as Record<string, object>)[row.cle] = { ...(p as unknown as Record<string, object>)[row.cle], ...row.valeur };
  }
  return p;
}

/** Extraction active (la source de tous les chiffres) ; null si aucune donnée n'a encore été chargée. */
export async function extractionActive(): Promise<Extraction | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("extractions").select("*").eq("statut", "active").maybeSingle();
  return (data as Extraction | null) ?? null;
}
