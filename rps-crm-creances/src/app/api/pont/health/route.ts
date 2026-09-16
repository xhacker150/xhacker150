import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifierClePont } from "@/lib/pont";

export const dynamic = "force-dynamic";

/** État du CRM vu du pont : extraction active et sa date (chaque réponse porte date_extraction). */
export async function GET(request: Request) {
  const refus = verifierClePont(request);
  if (refus) return refus;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("extractions").select("date_extraction, saisi_jusquau, source, active_le, nb_clients").eq("statut", "active").maybeSingle();
  if (error) return NextResponse.json({ ok: false, erreur: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, date_extraction: data?.date_extraction ?? null, saisi_jusquau: data?.saisi_jusquau ?? null, source: data?.source ?? null, active_le: data?.active_le ?? null, nb_clients: data?.nb_clients ?? 0, heure_serveur: new Date().toISOString() });
}
