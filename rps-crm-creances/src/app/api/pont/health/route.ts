import { NextResponse } from "next/server";
import { avecPont } from "@/lib/pont";

export const dynamic = "force-dynamic";

/** GET : état du CRM vu du pont. POST : battement {etat: 'ok'|'sage_erreur', detail} journalisé (distingue « Sage en panne » de « tâche arrêtée »). */
export const GET = avecPont(async (_request, _ctx, supabase) => {
  const { data, error } = await supabase.from("extractions").select("date_extraction, saisi_jusquau, source, active_le, nb_clients").eq("statut", "active").maybeSingle();
  if (error) return NextResponse.json({ ok: false, erreur: "Base injoignable" }, { status: 500 });
  const { data: dernier } = await supabase.from("audit").select("quand, detail").eq("quoi", "pont_battement").order("quand", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({ ok: true, date_extraction: data?.date_extraction ?? null, saisi_jusquau: data?.saisi_jusquau ?? null, source: data?.source ?? null, active_le: data?.active_le ?? null, nb_clients: data?.nb_clients ?? 0, dernier_battement: dernier?.quand ?? null, heure_serveur: new Date().toISOString() });
});

export const POST = avecPont(async (request, _ctx, supabase) => {
  const corps = (await request.json().catch(() => ({}))) as { etat?: string; detail?: string };
  await supabase.from("audit").insert({ qui_nom: "pont", quoi: "pont_battement", detail: { etat: corps.etat ?? "ok", detail: (corps.detail ?? "").slice(0, 500) } });
  return NextResponse.json({ ok: true, recu: corps.etat ?? "ok" });
});
