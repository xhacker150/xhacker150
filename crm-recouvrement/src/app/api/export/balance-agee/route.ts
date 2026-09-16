import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genererCsv } from "@/lib/csv";
import { LIBELLES_STATUT_CLIENT, LIBELLES_STATUT_FACTURE, LIBELLES_TRANCHE } from "@/lib/format";

/** Export CSV de la balance âgée (ou du détail des factures ouvertes) pour Excel / Sage. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });

  const url = new URL(request.url);
  const detail = url.searchParams.get("detail") === "1";
  const date = new Date().toISOString().slice(0, 10);

  if (detail) {
    const { data } = await supabase
      .from("vue_factures")
      .select("*")
      .in("statut", ["emise", "partiellement_payee"])
      .order("client_nom")
      .order("date_echeance");
    const csv = genererCsv(
      ["Code client", "Client", "N° facture", "Référence Sage", "Date facture", "Échéance", "Montant TTC", "Réglé", "Reste à payer", "Jours de retard", "Tranche", "Statut", "Niveau relance", "Litige"],
      (data ?? []).map((f) => [
        f.client_code, f.client_nom, f.numero, f.reference_externe, f.date_facture, f.date_echeance,
        f.montant_ttc, f.montant_regle, f.reste_a_payer, f.jours_retard, LIBELLES_TRANCHE[f.tranche_age] ?? "",
        LIBELLES_STATUT_FACTURE[f.statut] ?? f.statut, f.niveau_relance, f.litige ? "oui" : "non",
      ])
    );
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="factures-ouvertes-${date}.csv"` },
    });
  }

  const { data } = await supabase.from("vue_balance_agee").select("*").gt("encours_total", 0).order("echu_total", { ascending: false });
  const csv = genererCsv(
    ["Code", "Client", "Statut", "Nb factures", "Non échu", "1-30 j", "31-60 j", "61-90 j", "91-120 j", "> 120 j", "Total échu", "Encours", "Retard max (j)", "Téléphone", "E-mail"],
    (data ?? []).map((l) => [
      l.code, l.raison_sociale, LIBELLES_STATUT_CLIENT[l.statut] ?? l.statut, l.nb_factures_ouvertes,
      l.non_echu, l.t_0_30, l.t_31_60, l.t_61_90, l.t_91_120, l.t_plus_120, l.echu_total, l.encours_total, l.retard_max_jours, l.telephone, l.email,
    ])
  );
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="balance-agee-${date}.csv"` },
  });
}
