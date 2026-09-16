import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { extractionActive } from "@/lib/session";
import { fmt, formatDate, libelleMois } from "@/lib/format";
import type { VueClient, Ecriture } from "@/lib/types";

export default async function PageFacturation() {
  const supabase = await createClient();
  const extraction = await extractionActive();
  const [{ data: facturation }, { data: reglements }, { data: clients }] = await Promise.all([
    supabase.from("vue_facturation").select("compte, mois, ht"),
    supabase.from("vue_ecritures").select("compte, date_ecriture, journal, piece, ref_piece, intitule, montant, ordre").eq("est_reglement", true).order("date_ecriture", { ascending: false }).limit(60),
    supabase.from("vue_clients").select("*").gt("facture", 0).order("intitule"),
  ]);
  const fac = new Map<string, number>();
  const facParClientMois = new Map<string, Set<string>>();
  for (const f of facturation ?? []) {
    fac.set(f.mois, (fac.get(f.mois) ?? 0) + Number(f.ht));
    if (!facParClientMois.has(f.compte)) facParClientMois.set(f.compte, new Set());
    if (Number(f.ht) > 0) facParClientMois.get(f.compte)!.add(f.mois);
  }
  const { data: encParMois } = await supabase.from("vue_ecritures").select("date_ecriture, montant").eq("est_reglement", true);
  const enc = new Map<string, number>();
  for (const e of encParMois ?? []) { const m = String(e.date_ecriture).slice(0, 7); enc.set(m, (enc.get(m) ?? 0) + Number(e.montant)); }
  const mois = [...new Set([...fac.keys(), ...enc.keys()])].sort();
  const moisCourant = extraction?.date_extraction.slice(0, 7);
  const moisClos = extraction ? new Date(Date.UTC(Number(extraction.date_extraction.slice(0, 4)), Number(extraction.date_extraction.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7) : "";
  // Clients actifs (facturés le mois clos ou le précédent) sans facture le mois courant : signal gescom
  const cl = (clients ?? []) as VueClient[];
  const sansFacture = cl.filter((c) => { const s = facParClientMois.get(c.compte); return s && s.has(moisClos) && moisCourant && !s.has(moisCourant); });
  const regl = (reglements ?? []) as Ecriture[];
  const nomClient = new Map(cl.map((c) => [c.compte, c.intitule]));

  return (
    <>
      <h1 className="pg">Facturation et encaissements — clients à terme <span className="muted">données du {formatDate(extraction?.date_extraction)}, saisi jusqu&apos;au {formatDate(extraction?.saisi_jusquau)}</span></h1>
      <div className="card p0">
        <div className="tbl"><table>
          <thead><tr><th>MOIS</th><th className="num">FACTURÉ (F)</th><th className="num">ENCAISSÉ (F)</th><th className="num">TAUX</th><th style={{ width: "38%" }}>COUVERTURE</th></tr></thead>
          <tbody>
            {mois.map((m) => { const f = fac.get(m) ?? 0, e = enc.get(m) ?? 0, t = f ? Math.round((100 * e) / f) : 0; return (
              <tr key={m}>
                <td><b>{libelleMois(m)}</b>{m === moisCourant && <span className="muted"> (en cours, saisie incomplète)</span>}</td>
                <td className="num">{fmt(f)}</td><td className="num">{fmt(e)}</td>
                <td className="num" style={{ fontWeight: "bold", color: t >= 90 ? "var(--vert)" : t >= 70 ? "var(--or)" : "var(--rouge)" }}>{f ? `${t} %` : "—"}</td>
                <td><div className={`bar ${t < 70 ? "r" : ""}`}><i style={{ width: `${Math.min(t, 100)}%` }} /></div></td>
              </tr>); })}
          </tbody>
        </table></div>
        <div className="note" style={{ padding: "0 14px 12px" }}>Facturé : ventes gescom du mois (comptes 411 hors clients cash des stations). Encaissé : crédits comptabilisés dans le mois, tous exercices de facturation confondus — le taux dépasse donc parfois 100 % quand un client apure son passif. Le mois en cours est incomplet tant que la saisie n&apos;est pas finie ; aucun indicateur n&apos;est comparé sur un mois non clos.</div>
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
            <tbody>{regl.map((e) => <tr key={`${e.compte}${e.ordre}`}><td>{formatDate(e.date_ecriture, true)}</td><td><Link href={`/clients/${e.compte}?onglet=reglements`}>{nomClient.get(e.compte) ?? e.compte}</Link></td><td>{e.journal}</td><td>{e.piece}</td><td className="num">{fmt(e.montant)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}
