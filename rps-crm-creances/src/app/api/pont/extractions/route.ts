import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifierClePont, journaliserPont } from "@/lib/pont";

export const dynamic = "force-dynamic";

/** Ouvre une extraction (mode par lots). Corps : {date, saisi_jusquau?, commentaire?}. Retourne {id}. */
export async function POST(request: Request) {
  const refus = verifierClePont(request);
  if (refus) return refus;
  const corps = (await request.json().catch(() => ({}))) as { date?: string; saisi_jusquau?: string; commentaire?: string };
  const date = corps.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ erreur: "date attendue au format AAAA-MM-JJ" }, { status: 400 });
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("pont_debut_extraction", { p_date: date, p_source: "api", p_saisi_jusquau: corps.saisi_jusquau ?? null, p_commentaire: corps.commentaire ?? "API du pont" });
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  await journaliserPont("extraction_ouverte", { id: data, date });
  return NextResponse.json({ id: data, date_extraction: date }, { status: 201 });
}
