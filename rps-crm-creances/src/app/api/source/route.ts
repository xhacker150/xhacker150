import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { JEUX, type Jeu, TAILLE_MAX_CORPS } from "@/lib/pont";
import { traduireErreur } from "@/lib/erreurs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mode « fichiers du pont » depuis le navigateur, par lots (les fonctions Vercel refusent les corps > 4,5 Mo).
 * Authentification par la session utilisateur ; la base vérifie le rôle (DG / recouvrement) dans les fonctions pont_*.
 * Corps : {etape: 'debut', date, saisi_jusquau, attendus} | {etape: 'lot', id, jeu, lot, lignes} | {etape: 'activer', id, forcer} | {etape: 'abandon', id}
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > TAILLE_MAX_CORPS) return NextResponse.json({ erreur: "Lot trop volumineux" }, { status: 413 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });
  const { data: profil } = await supabase.from("profils").select("role, actif").eq("id", user.id).maybeSingle();
  if (!profil?.actif || !["dg", "recouvrement"].includes(profil.role)) return NextResponse.json({ erreur: "Réservé au DG et au recouvrement" }, { status: 403 });

  const corps = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corps || typeof corps.etape !== "string") return NextResponse.json({ erreur: "corps invalide" }, { status: 400 });
  try {
    if (corps.etape === "debut") {
      const { data, error } = await supabase.rpc("pont_debut_extraction", {
        p_date: String(corps.date ?? new Date().toISOString().slice(0, 10)), p_source: "fichiers", p_saisi_jusquau: (corps.saisi_jusquau as string) || null,
        p_commentaire: `Chargement manuel des fichiers du pont (${user.email})`, p_attendus: corps.attendus ?? null,
      });
      if (error) throw error;
      return NextResponse.json({ id: data });
    }
    if (corps.etape === "lot") {
      if (!JEUX.includes(corps.jeu as Jeu) || !Array.isArray(corps.lignes)) return NextResponse.json({ erreur: "lot invalide" }, { status: 400 });
      const { data, error } = await supabase.rpc("pont_ajouter_lignes", { p_extraction: corps.id, p_jeu: corps.jeu, p_lignes: corps.lignes, p_lot: Number(corps.lot) });
      if (error) throw error;
      return NextResponse.json(data);
    }
    if (corps.etape === "activer") {
      const forcer = corps.forcer === true && profil.role === "dg";
      const { data, error } = await supabase.rpc("pont_activer_extraction", { p_extraction: corps.id, p_forcer: forcer });
      if (error) return NextResponse.json({ erreur: traduireErreur(error), brut: error.message, refus: true }, { status: 409 });
      revalidatePath("/", "layout");
      return NextResponse.json(data);
    }
    if (corps.etape === "abandon") {
      const { error } = await supabase.rpc("pont_abandonner_extraction", { p_extraction: corps.id });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ erreur: "étape inconnue" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erreur: traduireErreur(e) }, { status: 500 });
  }
}
