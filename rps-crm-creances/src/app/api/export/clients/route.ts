import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genererCsv } from "@/lib/tsv";
import type { VueClient } from "@/lib/types";
import { tout } from "@/lib/supabase/pagine";

/** Export CSV de la liste des clients (mêmes filtres que la page). Journalisé. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });
  const { data: profil } = await supabase.from("profils").select("role, actif").eq("id", user.id).maybeSingle();
  if (!profil?.actif || !["dg", "recouvrement", "exploitation", "controle"].includes(profil.role)) {
    await supabase.rpc("journaliser", { p_quoi: "export_refuse", p_detail: { role: profil?.role ?? null } }).then(() => undefined, () => undefined);
    return NextResponse.json({ erreur: "Export non autorisé pour ce rôle" }, { status: 403 });
  }
  const u = new URL(request.url);
  let req = supabase.from("vue_clients").select("*").order("solde", { ascending: false });
  const q = u.searchParams.get("q"); const statut = u.searchParams.get("statut"); const typologie = u.searchParams.get("typologie"); const segment = u.searchParams.get("segment");
  if (q) req = req.or(`intitule.ilike.%${q}%,compte.ilike.%${q}%`);
  if (statut === "debiteurs") req = req.gt("solde", 1000); else if (statut) req = req.eq("statut", statut);
  if (typologie) req = req.eq("typologie", typologie);
  if (segment) req = req.eq("segment_encours", segment);
  const data = await tout<VueClient>(req);
  const { data: x } = await supabase.from("extractions").select("date_extraction").eq("statut", "active").maybeSingle();
  const lignes = ((data ?? []) as VueClient[]).filter((c) => c.actif);
  await supabase.rpc("journaliser", { p_quoi: "export_clients", p_detail: { nb: lignes.length, filtres: Object.fromEntries(u.searchParams) } });
  const csv = genererCsv(
    ["compte", "client", "ran", "facture", "facture_exercice", "regle", "debits_hors_ran", "solde", "dernier_reglement", "derniere_facture", "nb_reglements", "cadence_jours", "seuil_alerte_jours", "jours_sans_reglement", "typologie", "statut", "score", "segment", "limite_credit", "date_donnees"],
    lignes.map((c) => [c.compte, c.intitule, Math.round(Number(c.ran)), Math.round(Number(c.facture)), Math.round(Number(c.facture_exercice)), Math.round(Number(c.regle)), Math.round(Number(c.debits_hors_ran)), Math.round(Number(c.solde)), c.dernier_reglement, c.derniere_facture, c.nb_reglements, c.cadence_jours, c.seuil_alerte_jours, c.jours_sans_reglement, c.typologie, c.statut, c.score, c.segment_encours, c.limite_credit, x?.date_extraction ?? ""])
  );
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="CRM CREANCES - EXPORT ${x?.date_extraction ?? new Date().toISOString().slice(0, 10)}.csv"` } });
}
