import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifierClePont, journaliserPont, JEUX } from "@/lib/pont";
import { lots } from "@/lib/tsv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Extraction en un seul appel (petits volumes, < 4 Mo) : équivalent du contrat /crm/extract de la maquette.
 * Corps : {date, saisi_jusquau?, clients[[CT_Num,CT_Intitule]], facturation[[CT_Num,mois,ht]], ecritures[[...8]], livraisons[[...8]]}
 */
export async function POST(request: Request) {
  const refus = verifierClePont(request);
  if (refus) return refus;
  const corps = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corps || !Array.isArray(corps.clients)) return NextResponse.json({ erreur: "corps attendu : {date, clients, facturation, ecritures, livraisons}" }, { status: 400 });
  const date = typeof corps.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(corps.date) ? corps.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const supabase = createAdminClient();
  const { data: id, error } = await supabase.rpc("pont_debut_extraction", { p_date: date, p_source: "api", p_saisi_jusquau: (corps.saisi_jusquau as string | undefined) ?? null, p_commentaire: "API du pont (extract)" });
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  const stats: Record<string, number> = {};
  for (const jeu of JEUX) {
    const lignes = Array.isArray(corps[jeu]) ? (corps[jeu] as unknown[]) : [];
    stats[jeu] = 0;
    for (const lot of lots(lignes, 2000)) {
      const { data: n, error: e } = await supabase.rpc("pont_ajouter_lignes", { p_extraction: id, p_jeu: jeu, p_lignes: lot });
      if (e) return NextResponse.json({ erreur: `${jeu} : ${e.message}`, id }, { status: 500 });
      stats[jeu] += Number(n ?? 0);
    }
  }
  const { data: resultat, error: e2 } = await supabase.rpc("pont_activer_extraction", { p_extraction: id });
  if (e2) return NextResponse.json({ erreur: e2.message, id }, { status: 500 });
  await journaliserPont("extraction_activee_api", { id, date, ...stats });
  revalidatePath("/", "layout");
  return NextResponse.json({ id, date_extraction: date, lignes: stats, ...resultat }, { status: 201 });
}

/** Lecture : renvoie l'extraction active au format du contrat /crm/extract (pour la maquette en mode API). */
export async function GET(request: Request) {
  const refus = verifierClePont(request);
  if (refus) return refus;
  const supabase = createAdminClient();
  const { data: x } = await supabase.from("extractions").select("id, date_extraction, saisi_jusquau").eq("statut", "active").maybeSingle();
  if (!x) return NextResponse.json({ erreur: "aucune extraction active" }, { status: 404 });
  const [c, f, e, l] = await Promise.all([
    supabase.from("sage_clients").select("compte, intitule").eq("extraction_id", x.id).order("compte"),
    supabase.from("sage_facturation").select("compte, mois, ht").eq("extraction_id", x.id).order("compte").order("mois"),
    supabase.from("sage_ecritures").select("compte, date_ecriture, journal, piece, ref_piece, intitule, sens, montant").eq("extraction_id", x.id).order("ordre").limit(100000),
    supabase.from("sage_livraisons").select("compte, date_livraison, piece, ar_ref, designation, qte, montant_ht, depot").eq("extraction_id", x.id).order("ordre").limit(100000),
  ]);
  return NextResponse.json({
    date: x.date_extraction, date_extraction: x.date_extraction, saisi_jusquau: x.saisi_jusquau,
    clients: (c.data ?? []).map((r) => [r.compte, r.intitule]),
    facturation: (f.data ?? []).map((r) => [r.compte, r.mois, r.ht]),
    ecritures: (e.data ?? []).map((r) => [r.compte, r.date_ecriture, r.journal, r.piece, r.ref_piece, r.intitule, r.sens, r.montant]),
    livraisons: (l.data ?? []).map((r) => [r.compte, r.date_livraison, r.piece, r.ar_ref, r.designation, r.qte, r.montant_ht, r.depot]),
  });
}
