import { NextResponse } from "next/server";
import { avecPont } from "@/lib/pont";

export const dynamic = "force-dynamic";

/** Ouvre une extraction (mode par lots). Corps : {date, saisi_jusquau?, commentaire?, attendus?: {clients, facturation, ecritures, livraisons}, heure?}. */
export const POST = avecPont(async (request, _ctx, supabase) => {
  const corps = (await request.json().catch(() => ({}))) as { date?: string; saisi_jusquau?: string; commentaire?: string; attendus?: Record<string, number>; heure?: string };
  const date = corps.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ erreur: "date attendue au format AAAA-MM-JJ" }, { status: 400 });
  const { data, error } = await supabase.rpc("pont_debut_extraction", {
    p_date: date, p_source: "api", p_saisi_jusquau: corps.saisi_jusquau ?? null, p_commentaire: corps.commentaire ?? "API du pont",
    p_attendus: corps.attendus ?? null, p_heure: corps.heure ?? new Date().toISOString(),
  });
  if (error) return NextResponse.json({ erreur: error.message }, { status: error.message.includes("futur") ? 400 : 500 });
  return NextResponse.json({ id: data, date_extraction: date }, { status: 201 });
});
