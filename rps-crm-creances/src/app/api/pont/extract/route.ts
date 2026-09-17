import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { avecPont, JEUX } from "@/lib/pont";
import { lots } from "@/lib/tsv";
import { tout } from "@/lib/supabase/pagine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST : extraction en un appel (< 4,4 Mo) — corps {date, saisi_jusquau?, clients, facturation, ecritures, livraisons}. Lots numérotés en interne. */
export const POST = avecPont(async (request, _ctx, supabase) => {
  const corps = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corps || !Array.isArray(corps.clients)) return NextResponse.json({ erreur: "corps attendu : {date, clients, facturation, ecritures, livraisons}" }, { status: 400 });
  const date = typeof corps.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(corps.date) ? corps.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const attendus = Object.fromEntries(JEUX.map((j) => [j, Array.isArray(corps[j]) ? (corps[j] as unknown[]).length : 0]));
  const { data: id, error } = await supabase.rpc("pont_debut_extraction", { p_date: date, p_source: "api", p_saisi_jusquau: (corps.saisi_jusquau as string | undefined) ?? null, p_commentaire: "API du pont (extract)", p_attendus: attendus });
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  const stats: Record<string, { acceptees: number; rejetees: number }> = {};
  for (const jeu of JEUX) {
    const lignes = Array.isArray(corps[jeu]) ? (corps[jeu] as unknown[]) : [];
    stats[jeu] = { acceptees: 0, rejetees: 0 };
    let lot = 0;
    for (const bloc of lots(lignes, 2000)) {
      lot++;
      const { data: r, error: e } = await supabase.rpc("pont_ajouter_lignes", { p_extraction: id, p_jeu: jeu, p_lignes: bloc, p_lot: lot });
      if (e) return NextResponse.json({ erreur: `${jeu} : ${e.message}`, id }, { status: 500 });
      stats[jeu].acceptees += Number((r as { acceptees?: number })?.acceptees ?? 0);
      stats[jeu].rejetees += Number((r as { rejetees?: number })?.rejetees ?? 0);
    }
  }
  const { data: resultat, error: e2 } = await supabase.rpc("pont_activer_extraction", { p_extraction: id, p_forcer: false });
  if (e2) return NextResponse.json({ erreur: e2.message, id, lignes: stats }, { status: 409 });
  revalidatePath("/", "layout");
  return NextResponse.json({ id, date_extraction: date, lignes: stats, ...(resultat as object) }, { status: 201 });
});

/** GET : extraction active au format /crm/extract (lecture paginée complète, jamais tronquée). ?jeu=ecritures pour un seul jeu. */
export const GET = avecPont(async (request, _ctx, supabase) => {
  const { data: x } = await supabase.from("extractions").select("id, date_extraction, saisi_jusquau").eq("statut", "active").maybeSingle();
  if (!x) return NextResponse.json({ erreur: "aucune extraction active" }, { status: 404 });
  const jeu = new URL(request.url).searchParams.get("jeu");
  const veut = (j: string) => !jeu || jeu === j;
  const [c, f, e, l] = await Promise.all([
    veut("clients") ? tout<{ compte: string; intitule: string }>(supabase.from("sage_clients").select("compte, intitule").eq("extraction_id", x.id).order("compte")) : [],
    veut("facturation") ? tout<{ compte: string; mois: string; ht: number }>(supabase.from("sage_facturation").select("compte, mois, ht").eq("extraction_id", x.id).order("compte").order("mois")) : [],
    veut("ecritures") ? tout<{ compte: string; date_ecriture: string; journal: string; piece: string; ref_piece: string; intitule: string; sens: number; montant: number }>(supabase.from("sage_ecritures").select("compte, date_ecriture, journal, piece, ref_piece, intitule, sens, montant").eq("extraction_id", x.id).order("ordre")) : [],
    veut("livraisons") ? tout<{ compte: string; date_livraison: string; piece: string; ar_ref: string; designation: string; qte: number; montant_ht: number; depot: string }>(supabase.from("sage_livraisons").select("compte, date_livraison, piece, ar_ref, designation, qte, montant_ht, depot").eq("extraction_id", x.id).order("ordre")) : [],
  ]);
  return NextResponse.json({
    date: x.date_extraction, date_extraction: x.date_extraction, saisi_jusquau: x.saisi_jusquau,
    clients: c.map((r) => [r.compte, r.intitule]),
    facturation: f.map((r) => [r.compte, r.mois, r.ht]),
    ecritures: e.map((r) => [r.compte, r.date_ecriture, r.journal, r.piece, r.ref_piece, r.intitule, r.sens, r.montant]),
    livraisons: l.map((r) => [r.compte, r.date_livraison, r.piece, r.ar_ref, r.designation, r.qte, r.montant_ht, r.depot]),
  });
});
