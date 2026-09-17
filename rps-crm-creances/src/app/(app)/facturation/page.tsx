import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { extractionActive } from "@/lib/session";
import { lire } from "@/lib/erreurs";
import { fmt, formatDate, libelleMois } from "@/lib/format";

/** Vue mensuelle facturé / encaissé calculée en base (jamais tronquée par la pagination de l'API). */
export default async function PageFacturation() {
  const supabase = await createClient();
  const extraction = await extractionActive();
  const [mensuel, sansFacture, reglements] = await Promise.all([
    supabase.rpc("facturation_mensuelle").then((r) => (lire(r, "facturation mensuelle") ?? []) as { mois: string; facture: number; encaisse: number }[]),
    supabase.rpc("clients_sans_facture_mois").then((r) => (lire(r, "clients sans facture") ?? []) as { compte: string; intitule: string; solde: number; derniere_facture: string | null }[]),
    supabase.from("vue_ecritures").select("compte, date_ecriture, journal, piece, ref_piece, intitule, montant, ordre, est_regularisation").eq("est_reglement", true).order("date_ecriture", { ascending: false }).order("ordre", { ascending: false }).limit(60).then((r) => lire(r, "règlements") ?? []),
  ]);
  const comptes = [...new Set(reglements.map((e) => e.compte))];
  const { data: noms } = comptes.length ? await supabase.from("clients_calc").select("compte, intitule").in("compte", comptes) : { data: [] };
  const nomClient = new Map((noms ?? []).map((c) => [c.compte, c.intitule]));
  const moisCourant = extraction?.date_extraction.slice(0, 7);
  const moisClos = extraction ? new Date(Date.UTC(Number(extraction.date_extraction.slice(0, 4)), Number(extraction.date_extraction.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7) : "";

  return (
    <>
      <h1 className="pg">Facturation et encaissements — clients à terme <span className="muted">données du {formatDate(extraction?.date_extraction)}, saisi jusqu&apos;au {formatDate(extraction?.saisi_jusquau)}</span></h1>
      <div className="card p0">
        <div className="tbl"><table>
          <thead><tr><th>MOIS</th><th className="num">FACTURÉ (F)</th><th className="num">ENCAISSÉ (F)</th><th className="num">TAUX</th><th style={{ width: "38%" }} className="opt">COUVERTURE</th></tr></thead>
          <tbody>
            {mensuel.map((m) => { const f = Number(m.facture), e = Number(m.encaisse), t = f ? Math.round((100 * e) / f) : 0; return (
              <tr key={m.mois}>
                <td><b>{libelleMois(m.mois)}</b>{m.mois === moisCourant && <span className="muted"> (en cours, saisie incomplète)</span>}</td>
                <td className="num">{fmt(f)}</td><td className="num">{fmt(e)}</td>
                <td className="num" style={{ fontWeight: "bold", color: t >= 90 ? "var(--vert)" : t >= 70 ? "var(--or)" : "var(--rouge)" }}>{f ? `${t} %` : "—"}</td>
                <td className="opt"><div className={`bar ${t < 70 ? "r" : ""}`}><i style={{ width: `${Math.min(t, 100)}%` }} /></div></td>
              </tr>); })}
            {mensuel.length === 0 && <tr><td colSpan={5} className="muted">Aucune donnée : chargez une extraction.</td></tr>}
          </tbody>
        </table></div>
        <div className="note" style={{ padding: "0 14px 12px" }}>Facturé : ventes gescom du mois (comptes 411 hors clients cash des stations). Encaissé : crédits comptabilisés dans le mois (régularisations comprises, neutres), tous exercices de facturation confondus — le taux dépasse donc parfois 100 % quand un client apure son passif. Le mois en cours est incomplet tant que la saisie n&apos;est pas finie ; aucun indicateur n&apos;est comparé sur un mois non clos.</div>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Clients actifs sans facture ce mois-ci <small>signal gescom ({sansFacture.length})</small></h3>
          {sansFacture.length === 0 && <p className="muted">Tous les clients facturés en {libelleMois(moisClos)} ont une facture en {libelleMois(moisCourant ?? "")}.</p>}
          <ul style={{ paddingLeft: 18, fontSize: 12.5 }}>{sansFacture.map((c) => <li key={c.compte}><Link href={`/clients/${c.compte}`}>{c.intitule}</Link> — solde {fmt(c.solde)} F · dernière facture {formatDate(c.derniere_facture, true)}</li>)}</ul>
        </div>
        <div className="card p0">
          <h3>Derniers règlements encaissés <small>pointage compta, un à un</small></h3>
          <div className="tbl" style={{ maxHeight: 420, overflow: "auto" }}><table>
            <thead><tr><th>Date</th><th>Client</th><th>Journal</th><th>Pièce</th><th className="num">Montant</th></tr></thead>
            <tbody>{reglements.map((e) => <tr key={`${e.compte}${e.ordre}`} style={{ opacity: e.est_regularisation ? 0.6 : 1 }}><td>{formatDate(e.date_ecriture, true)}</td><td><Link href={`/clients/${e.compte}?onglet=reglements`}>{nomClient.get(e.compte) ?? e.compte}</Link></td><td>{e.journal}</td><td>{e.piece}{e.est_regularisation ? " (régul.)" : ""}</td><td className="num">{fmt(e.montant)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}
