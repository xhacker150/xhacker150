import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailActif } from "@/lib/email";
import { envoyerRelancesEmail } from "@/lib/relances";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Traitement quotidien (Vercel Cron, voir vercel.json) :
 *  1. génère les actions de relance de l'étape suivante pour chaque facture échue éligible ;
 *  2. détecte les promesses de paiement non tenues ;
 *  3. envoie les relances e-mail automatiques (si RESEND_API_KEY est configurée).
 * Protégé par CRON_SECRET (Vercel l'envoie automatiquement en en-tête Authorization).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const autorisation = request.headers.get("authorization");
  if (!secret || autorisation !== `Bearer ${secret}`) {
    return NextResponse.json({ erreur: "Non autorisé" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const aujourdhui = new Date().toISOString().slice(0, 10);

  const { data: relances, error } = await supabase.rpc("generer_relances", { p_date: aujourdhui });
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  const { data: promessesRompues } = await supabase.rpc("verifier_promesses", { p_date: aujourdhui });

  const emails = await envoyerRelancesEmail(supabase, aujourdhui);

  return NextResponse.json({
    date: aujourdhui,
    relances_generees: (relances ?? []).length,
    detail: relances,
    promesses_rompues: promessesRompues ?? 0,
    emails_envoyes: emails.ok,
    emails_echoues: emails.erreurs,
    email_actif: emailActif(),
  });
}
