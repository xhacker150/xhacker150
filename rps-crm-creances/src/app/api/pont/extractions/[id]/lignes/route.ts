import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifierClePont, JEUX, type Jeu } from "@/lib/pont";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ajoute un lot de lignes à une extraction ouverte. Corps : {jeu: clients|facturation|ecritures|livraisons, lignes: [[...], ...]}. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refus = verifierClePont(request);
  if (refus) return refus;
  const { id } = await params;
  const corps = (await request.json().catch(() => null)) as { jeu?: string; lignes?: unknown[] } | null;
  if (!corps || !corps.jeu || !JEUX.includes(corps.jeu as Jeu) || !Array.isArray(corps.lignes)) {
    return NextResponse.json({ erreur: "corps attendu : {jeu, lignes[]}" }, { status: 400 });
  }
  if (corps.lignes.length > 5000) return NextResponse.json({ erreur: "5 000 lignes maximum par appel" }, { status: 413 });
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("pont_ajouter_lignes", { p_extraction: id, p_jeu: corps.jeu, p_lignes: corps.lignes });
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ id, jeu: corps.jeu, lignes_ajoutees: data });
}
