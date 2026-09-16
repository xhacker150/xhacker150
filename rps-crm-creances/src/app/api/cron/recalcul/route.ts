import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Recalcul nocturne (Vercel Cron) : scores, jours sans règlement, promesses échues, fermetures automatiques. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ erreur: "Non autorisé" }, { status: 401 });
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("recalculer_clients");
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  await supabase.from("audit").insert({ qui_nom: "cron", quoi: "recalcul_nocturne", detail: data });
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, ...data });
}
