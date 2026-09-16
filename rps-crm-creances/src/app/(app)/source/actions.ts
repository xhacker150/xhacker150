"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { lireTsv, lots } from "@/lib/tsv";

const FICHIERS: { champ: string; jeu: string; colonnes: number }[] = [
  { champ: "qr0", jeu: "clients", colonnes: 2 },
  { champ: "qr1", jeu: "facturation", colonnes: 3 },
  { champ: "qr3", jeu: "ecritures", colonnes: 8 },
  { champ: "qr4", jeu: "livraisons", colonnes: 8 },
];

/** Mode « Fichiers du pont » : chargement manuel des 4 extractions TSV (sql_out/qr*.txt). */
export async function chargerFichiers(formData: FormData) {
  const supabase = await createClient();
  const dateExtraction = String(formData.get("date_extraction") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const saisiJusquau = String(formData.get("saisi_jusquau") ?? "").trim() || null;
  const contenus: Record<string, string[][]> = {};
  for (const f of FICHIERS) {
    const fichier = formData.get(f.champ);
    if (!(fichier instanceof File) || fichier.size === 0) redirect(`/source?erreur=${encodeURIComponent(`Fichier ${f.champ} manquant`)}`);
    const lignes = lireTsv(Buffer.from(await fichier.arrayBuffer()).toString("utf8"));
    if (lignes.length > 0 && lignes[0].length < f.colonnes) redirect(`/source?erreur=${encodeURIComponent(`Le fichier ${f.champ} n'a pas ${f.colonnes} colonnes (séparateur tabulation attendu)`)}`);
    contenus[f.jeu] = lignes;
  }
  if (contenus.clients.length === 0) redirect(`/source?erreur=${encodeURIComponent("qr0_clients est vide")}`);

  const { data: extractionId, error } = await supabase.rpc("pont_debut_extraction", { p_date: dateExtraction, p_source: "fichiers", p_saisi_jusquau: saisiJusquau, p_commentaire: "Chargement manuel des fichiers du pont" });
  if (error) redirect(`/source?erreur=${encodeURIComponent(error.message)}`);
  for (const f of FICHIERS) {
    for (const lot of lots(contenus[f.jeu], 2000)) {
      const { error: e } = await supabase.rpc("pont_ajouter_lignes", { p_extraction: extractionId, p_jeu: f.jeu, p_lignes: lot });
      if (e) redirect(`/source?erreur=${encodeURIComponent(`${f.jeu} : ${e.message}`)}`);
    }
  }
  const { data: stats, error: e2 } = await supabase.rpc("pont_activer_extraction", { p_extraction: extractionId });
  if (e2) redirect(`/source?erreur=${encodeURIComponent(e2.message)}`);
  revalidatePath("/", "layout");
  redirect(`/source?succes=${encodeURIComponent(`Extraction du ${dateExtraction} activée : ${stats?.clients ?? 0} clients calculés, ${stats?.actions_fermees_auto ?? 0} action(s) fermée(s) automatiquement`)}`);
}

export async function recalculer() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recalculer_clients");
  revalidatePath("/", "layout");
  redirect(`/source?${error ? `erreur=${encodeURIComponent(error.message)}` : `succes=${encodeURIComponent(`Recalcul effectué : ${data?.clients ?? 0} clients, ${data?.actions_fermees_auto ?? 0} action(s) fermée(s)`)}`}`);
}
