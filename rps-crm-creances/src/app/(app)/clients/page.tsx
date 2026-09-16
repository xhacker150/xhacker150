import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { extractionActive } from "@/lib/session";
import { fmt, formatDate, TYPOLOGIES, LIBELLES_STATUT } from "@/lib/format";
import { BadgeStatut, Score, Badge } from "@/components/Badge";
import type { VueClient } from "@/lib/types";

type SP = { q?: string; statut?: string; typologie?: string; segment?: string; tri?: string; sens?: string; limite?: string; interlocuteur?: string };
const COLONNES: [string, string, boolean][] = [["compte", "COMPTE", false], ["intitule", "CLIENT", false], ["facture_exercice", "FACTURÉ", true], ["regle", "RÉGLÉ", true], ["solde", "SOLDE", true], ["dernier_reglement", "DERNIER RÈGL.", false], ["derniere_facture", "DERN. FACTURE", false], ["score", "SCORE", true]];

export default async function PageClients({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const extraction = await extractionActive();
  const tri = sp.tri ?? "solde";
  const asc = sp.sens === "asc";
  let req = supabase.from("vue_clients").select("*");
  if (sp.q) req = req.or(`intitule.ilike.%${sp.q}%,compte.ilike.%${sp.q}%`);
  if (sp.statut === "debiteurs") req = req.gt("solde", 1000);
  else if (sp.statut) req = req.eq("statut", sp.statut);
  if (sp.typologie) req = req.eq("typologie", sp.typologie);
  if (sp.segment) req = req.eq("segment_encours", sp.segment);
  if (sp.limite) req = req.eq("limite_depassee", true);
  if (sp.interlocuteur) req = req.eq("interlocuteur_id", sp.interlocuteur);
  req = req.order(tri === "jours" ? "jours_sans_reglement" : tri, { ascending: asc, nullsFirst: false });
  const { data } = await req;
  const tous = (data ?? []) as VueClient[];
  // clients « actifs » comme dans la maquette : facturés, ou solde non nul, ou réglés
  const clients = tous.filter((c) => Number(c.facture) > 0 || Math.abs(Number(c.solde)) > 1000 || Number(c.regle) > 0 || sp.q);
  const totalSolde = clients.reduce((s, c) => s + Math.max(0, Number(c.solde)), 0);
  const lien = (params: Partial<SP>) => {
    const u = new URLSearchParams();
    Object.entries({ ...sp, ...params }).forEach(([k, v]) => { if (v) u.set(k, v); });
    return `/clients?${u.toString()}`;
  };

  return (
    <>
      <h1 className="pg">Clients ({clients.length}) <span className="muted">encours {fmt(totalSolde)} F · données du {formatDate(extraction?.date_extraction)}</span></h1>
      <form className="frm" method="get" style={{ marginBottom: 10 }}>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher un client ou un compte…" style={{ width: 240 }} />
        <select name="statut" defaultValue={sp.statut ?? ""}><option value="">Tous statuts</option><option value="debiteurs">Débiteurs</option>{Object.entries(LIBELLES_STATUT).map(([k, v]) => <option key={k} value={k}>{v.libelle}</option>)}</select>
        <select name="typologie" defaultValue={sp.typologie ?? ""}><option value="">Toutes typologies</option>{TYPOLOGIES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select name="segment" defaultValue={sp.segment ?? ""}><option value="">Tous segments</option>{["> 100 M", "25-100 M", "5-25 M", "< 5 M", "nul / créditeur"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <button className="btn" type="submit">Filtrer</button>
        <a className="btn" href={`/api/export/clients?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()}`}>⬇ Export CSV</a>
        {(sp.q || sp.statut || sp.typologie || sp.segment || sp.limite) && <Link className="btn" href="/clients">Réinitialiser</Link>}
      </form>
      <div className="card p0"><div className="tbl" style={{ maxHeight: "70vh", overflow: "auto" }}>
        <table>
          <thead><tr>
            {COLONNES.map(([k, l, num]) => (
              <th key={k} className={num ? "num" : ""}><Link href={lien({ tri: k, sens: tri === k && !asc ? "asc" : "desc" })}>{l}{tri === k ? (asc ? " ▲" : " ▼") : ""}</Link></th>
            ))}
            <th>TYPOLOGIE</th><th>STATUT</th>
          </tr></thead>
          <tbody>
            {clients.length === 0 && <tr><td colSpan={10} className="muted">Aucun client{extraction ? "" : " : chargez d'abord une extraction (onglet SOURCE)"}.</td></tr>}
            {clients.map((c) => (
              <tr key={c.compte}>
                <td><Link href={`/clients/${c.compte}`}>{c.compte}</Link></td>
                <td><Link href={`/clients/${c.compte}`}><b>{c.intitule}</b></Link>{c.limite_depassee && <> <Badge classe="rouge" title="Limite de crédit dépassée">limite</Badge></>}</td>
                <td className="num">{fmt(c.facture_exercice)}</td>
                <td className="num">{fmt(c.regle)}</td>
                <td className="num" style={{ fontWeight: "bold", color: Number(c.solde) > 1000 ? "var(--rouge)" : "var(--vert)" }}>{fmt(c.solde)}</td>
                <td>{formatDate(c.dernier_reglement, true)}{c.jours_sans_reglement !== null && Number(c.solde) > 1000 && <span className="muted"> ({c.jours_sans_reglement} j)</span>}</td>
                <td>{formatDate(c.derniere_facture, true)}</td>
                <td className="num"><Score score={c.score} /></td>
                <td><Badge classe="gris">{c.typologie}</Badge></td>
                <td><BadgeStatut statut={c.statut} detail={c.statut === "promesse" && c.prochaine_echeance ? formatDate(c.prochaine_echeance, true) : c.statut === "relancé" && c.derniere_relance ? formatDate(c.derniere_relance, true) : undefined} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      <div className="note">Facturé : exercice en cours (gescom). Solde économique = RAN + facturation + dépenses payées pour le client − règlements. Les clients sans facturation ni mouvement sont masqués (recherche par compte pour les afficher).</div>
    </>
  );
}
