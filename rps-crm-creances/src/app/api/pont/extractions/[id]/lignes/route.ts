import { NextResponse } from "next/server";
import { avecPont, JEUX, type Jeu } from "@/lib/pont";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ajoute un lot : {jeu, lot, lignes[]}. Idempotent : un lot déjà reçu répond deja_recu=true sans rien insérer. */
export const POST = avecPont(async (request, ctx, supabase) => {
  const { id } = await ctx.params;
  const corps = (await request.json().catch(() => null)) as { jeu?: string; lot?: number; lignes?: unknown[] } | null;
  if (!corps || !corps.jeu || !JEUX.includes(corps.jeu as Jeu) || !Array.isArray(corps.lignes)) {
    return NextResponse.json({ erreur: "corps attendu : {jeu, lot, lignes[]}" }, { status: 400 });
  }
  if (corps.lignes.length > 5000) return NextResponse.json({ erreur: "5 000 lignes maximum par appel" }, { status: 413 });
  const { data, error } = await supabase.rpc("pont_ajouter_lignes", { p_extraction: id, p_jeu: corps.jeu, p_lignes: corps.lignes, p_lot: corps.lot ?? null });
  if (error) return NextResponse.json({ erreur: error.message }, { status: error.message.includes("introuvable") ? 404 : 500 });
  return NextResponse.json({ id, jeu: corps.jeu, lot: corps.lot ?? null, ...(data as object) });
});
