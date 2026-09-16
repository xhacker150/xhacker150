import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretsEgaux } from "@/lib/pont";
import { envoyerEmail, gabaritHtml, emailActif } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Traitement nocturne (Vercel Cron) : recalcul, sauvegarde quotidienne, contrôle de santé (e-mail aux administrateurs seulement en anomalie). */
export async function GET(request: Request) {
  const jeton = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secretsEgaux(jeton, process.env.CRON_SECRET)) return NextResponse.json({ erreur: "Non autorisé" }, { status: 401 });
  const supabase = createAdminClient();
  const { data: recalcul, error } = await supabase.rpc("recalculer_clients");
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  await supabase.from("audit").insert({ qui_nom: "cron", quoi: "recalcul_nocturne", detail: recalcul });
  const { data: sauvegarde } = await supabase.rpc("sauvegarde_quotidienne");
  const { data: sante } = await supabase.rpc("controle_sante");
  let alerte: { ok: boolean; erreur?: string; envoyes: number } | null = null;
  if (sante && sante.ok === false && emailActif()) {
    const { data: p } = await supabase.from("parametres").select("valeur").eq("cle", "exploitation").maybeSingle();
    const expl = (p?.valeur ?? {}) as { admins_alerte?: string[]; domaines_email?: string[]; expediteur?: string };
    const anomalies = (sante.anomalies as string[]) ?? [];
    alerte = await envoyerEmail({
      a: expl.admins_alerte ?? [], domaines: expl.domaines_email, expediteur: expl.expediteur || undefined,
      sujet: `[CRM Créances] ${anomalies.length} anomalie(s) au contrôle de santé`,
      html: gabaritHtml("Contrôle de santé du CRM", `<ul>${anomalies.map((a) => `<li>${a}</li>`).join("")}</ul>`, process.env.NEXT_PUBLIC_APP_URL),
    });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, recalcul, sauvegarde, sante, alerte });
}
