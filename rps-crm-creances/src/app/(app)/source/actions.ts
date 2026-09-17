"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { exigerRole } from "@/lib/session";
import { codeErreur } from "@/lib/erreurs";

export async function recalculer() {
  await exigerRole(["dg", "recouvrement"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recalculer_clients");
  revalidatePath("/", "layout");
  redirect(`/source?${error ? `erreur=${codeErreur(error)}` : `succes=${encodeURIComponent(`Recalcul effectué : ${data?.clients ?? 0} clients, ${data?.actions_fermees_auto ?? 0} action(s) fermée(s)`)}`}`);
}

export async function abandonnerExtraction(id: string) {
  await exigerRole(["dg", "recouvrement"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("pont_abandonner_extraction", { p_extraction: id });
  revalidatePath("/source");
  redirect(`/source?${error ? `erreur=${codeErreur(error)}` : "succes=Extraction+abandonn%C3%A9e"}`);
}

/** Reprise des actions de la maquette (30_CLIENTS/data/crm_*.json). */
export async function importerActionsMaquette(formData: FormData) {
  await exigerRole(["dg", "recouvrement"]);
  const fichier = formData.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) redirect("/source?erreur=Fichier+manquant");
  let actions: unknown;
  try { actions = JSON.parse(await fichier.text()); } catch { redirect("/source?erreur=JSON+invalide"); }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("importer_actions_maquette", { p_actions: actions });
  revalidatePath("/recouvrement");
  redirect(`/source?${error ? `erreur=${codeErreur(error)}` : `succes=${encodeURIComponent(`${data ?? 0} action(s) importée(s) de la maquette`)}`}`);
}
