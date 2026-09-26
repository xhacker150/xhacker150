import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { avecPont } from "@/lib/pont";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Active l'extraction (contrôles de complétude, bascule atomique, recalcul, fermetures automatiques). {forcer: true} réservé au DG côté écran. */
export const POST = avecPont(async (request, ctx, supabase) => {
  const { id } = await ctx.params;
  const corps = (await request.json().catch(() => ({}))) as { forcer?: boolean };
  const { data, error } = await supabase.rpc("pont_activer_extraction", { p_extraction: id, p_forcer: corps.forcer === true });
  if (error) {
    const refus = /partielle|rejetée|incomplète|antérieure|vide/i.test(error.message);
    return NextResponse.json({ erreur: error.message, refus }, { status: refus ? 409 : 500 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ id, ...(data as object) });
});
