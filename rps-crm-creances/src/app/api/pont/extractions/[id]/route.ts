import { NextResponse } from "next/server";
import { avecPont } from "@/lib/pont";

export const dynamic = "force-dynamic";

/** DELETE : abandonne une extraction en cours (push interrompu). GET : état et lots reçus. */
export const DELETE = avecPont(async (_request, ctx, supabase) => {
  const { id } = await ctx.params;
  const { error } = await supabase.rpc("pont_abandonner_extraction", { p_extraction: id });
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ id, statut: "abandonnee" });
});

export const GET = avecPont(async (_request, ctx, supabase) => {
  const { id } = await ctx.params;
  const { data, error } = await supabase.from("extractions").select("*").eq("id", id).maybeSingle();
  if (error || !data) return NextResponse.json({ erreur: "Extraction introuvable" }, { status: 404 });
  const { data: lots } = await supabase.from("extraction_lots").select("jeu, lot, nb_lignes, nb_rejets, recu_le").eq("extraction_id", id).order("jeu").order("lot");
  return NextResponse.json({ ...data, lots: lots ?? [] });
});
