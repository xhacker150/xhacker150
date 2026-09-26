import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretsEgaux } from "@/lib/pont";
import { envoyerEmail, gabaritHtml, emailActif } from "@/lib/email";
import { fmtF, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Récapitulatif quotidien recouvrement (patron « recap-quotidien » du workflow) aux profils abonnés. */
export async function GET(request: Request) {
  const jeton = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secretsEgaux(jeton, process.env.CRON_SECRET)) return NextResponse.json({ erreur: "Non autorisé" }, { status: 401 });
  if (!emailActif()) return NextResponse.json({ ok: false, erreur: "e-mail non configuré" });
  const supabase = createAdminClient();
  const { data: r, error } = await supabase.rpc("recapitulatif_quotidien");
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  const dest = ((r.destinataires as { email: string }[]) ?? []).map((d) => d.email);
  if (dest.length === 0) return NextResponse.json({ ok: true, envoyes: 0 });
  const t = r.tableau as Record<string, unknown>;
  const al = r.alertes as Record<string, { intitule: string; solde?: number; montant?: number; echeance?: string; jours?: number }[]>;
  const liste = (titre: string, items: { intitule: string; solde?: number; montant?: number; echeance?: string; jours?: number }[]) =>
    items.length ? `<h3 style="font-size:13px;color:#0051DD">${titre} (${items.length})</h3><ul>${items.slice(0, 15).map((i) => `<li>${i.intitule} — ${fmtF(i.solde ?? i.montant ?? 0)}${i.echeance ? ` (échéance ${formatDate(i.echeance)})` : ""}${i.jours ? ` — ${i.jours} j` : ""}</li>`).join("")}</ul>` : "";
  const html = gabaritHtml(`Récapitulatif recouvrement du ${formatDate(String(r.date))}`,
    `<p>Créances totales <b>${fmtF(t.creances_totales as number)}</b> · à relancer <b>${t.a_relancer}</b> · encaissé ce mois <b>${fmtF(t.encaisse_mois as number)}</b> · données du ${formatDate(String(t.date_extraction))}</p>`
    + liste("Décrochages de cadence", al.decrochages ?? []) + liste("Promesses échues non tenues", al.promesses_echues ?? []) + liste("Limites de crédit dépassées", al.limites_depassees ?? []) + liste("Comptes muets", al.comptes_muets ?? []) + liste("BV bloqués", al.bv_bloques ?? []),
    process.env.NEXT_PUBLIC_APP_URL);
  const { data: p } = await supabase.from("parametres").select("valeur").eq("cle", "exploitation").maybeSingle();
  const expl = (p?.valeur ?? {}) as { domaines_email?: string[]; expediteur?: string };
  const res = await envoyerEmail({ a: dest, domaines: expl.domaines_email, expediteur: expl.expediteur || undefined, sujet: `[CRM Créances] Récapitulatif du ${formatDate(String(r.date))}`, html });
  await supabase.from("audit").insert({ qui_nom: "cron", quoi: "recap_quotidien", detail: { destinataires: dest.length, ...res } });
  return NextResponse.json({ ok: res.ok, envoyes: res.envoyes });
}
