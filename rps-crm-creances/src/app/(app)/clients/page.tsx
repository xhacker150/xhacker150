import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { extractionActive } from "@/lib/session";
import { tout } from "@/lib/supabase/pagine";
import { fmt, formatDate, TYPOLOGIES, LIBELLES_STATUT } from "@/lib/format";
import { BadgeStatut, Score, Badge } from "@/components/Badge";
import type { VueClient } from "@/lib/types";

type SP = { q?: string; statut?: string; typologie?: string; segment?: string; zone?: string; categorie?: string; tri?: string; sens?: string; limite?: string; interlocuteur?: string; jours_min?: string; bv?: string };
const COLONNES: [string, string, boolean, boolean][] = [["compte", "COMPTE", false, true], ["intitule", "CLIENT", false, false], ["facture_exercice", "FACTURÉ", true, true], ["regle", "RÉGLÉ", true, true], ["solde", "SOLDE", true, false], ["dernier_reglement", "DERNIER RÈGL.", false, false], ["derniere_facture", "DERN. FACTURE", false, true], ["score", "SCORE", true, false]];

export default async function PageClients({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const extraction = await extractionActive();
  const tri = sp.tri ?? "solde";
  const asc = sp.sens === "asc";
  let req = supabase.from("vue_clients").select("*");
  if (sp.q) req = req.or(`intitule.ilike.%${sp.q}%,compte.ilike.%${sp.q}%`);
  else req = req.eq("actif", true);          // clients sans facturation ni mouvement masqués (maquette), sauf recherche explicite
  if (sp.statut === "debiteurs") req = req.gt("solde", 1000);
  else if (sp.statut) req = req.eq("statut", sp.statut);
  if (sp.typologie) req = req.eq("typologie", sp.typologie);
  if (sp.segment) req = req.eq("segment_encours", sp.segment);
  if (sp.zone) req = req.eq("segment_zone", sp.zone);
  if (sp.categorie) req = req.eq("categorie", sp.categorie);
  if (sp.limite) req = req.eq("limite_depassee", true);
  if (sp.bv) req = req.eq("bv_bloque", true);
  if (sp.interlocuteur) req = req.eq("interlocuteur_id", sp.interlocuteur);
  if (sp.jours_min) req = req.gt("solde", 1000).or(`jours_sans_reglement.gt.${Number(sp.jours_min)},jours_sans_reglement.is.null`);
  req = req.order(tri === "jours" ? "jours_sans_reglement" : tri, { ascending: asc, nullsFirst: false });
  const clients = await tout<VueClient>(req);
  const totalSolde = clients.reduce((s, c) => s + Math.max(0, Number(c.solde)), 0);
  const [{ data: zones }, { data: categories }] = await Promise.all([
    supabase.from("clients_ext").select("segment_zone").not("segment_zone", "is", null),
    supabase.from("clients_ext").select("categorie").not("categorie", "is", null),
  ]);
  const listeZones = [...new Set((zones ?? []).map((z) => z.segment_zone as string))].sort();
  const listeCategories = [...new Set((categories ?? []).map((z) => z.categorie as string))].sort();
  const lien = (params: Partial<SP>) => {
    const u = new URLSearchParams();
    Object.entries({ ...sp, ...params }).forEach(([k, v]) => { if (v) u.set(k, v); });
    return `/clients?${u.toString()}`;
  };
  const filtres = sp.q || sp.statut || sp.typologie || sp.segment || sp.limite || sp.zone || sp.categorie || sp.jours_min || sp.bv;

  return (
    <>
      <h1 className="pg">Clients ({clients.length}) <span className="muted">encours {fmt(totalSolde)} F · données du {formatDate(extraction?.date_extraction)}</span></h1>
      <form className="frm" method="get" style={{ marginBottom: 10 }}>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher un client ou un compte…" style={{ width: 220 }} />
        <select name="statut" defaultValue={sp.statut ?? ""}><option value="">Tous statuts</option><option value="debiteurs">Débiteurs</option>{Object.entries(LIBELLES_STATUT).map(([k, v]) => <option key={k} value={k}>{v.libelle}</option>)}</select>
        <select name="typologie" defaultValue={sp.typologie ?? ""}><option value="">Toutes typologies</option>{TYPOLOGIES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select name="segment" defaultValue={sp.segment ?? ""}><option value="">Tous segments</option>{["> 100 M", "25-100 M", "5-25 M", "< 5 M", "nul / créditeur"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        {listeZones.length > 0 && <select name="zone" defaultValue={sp.zone ?? ""}><option value="">Toutes zones</option>{listeZones.map((z) => <option key={z} value={z}>{z}</option>)}</select>}
        {listeCategories.length > 0 && <select name="categorie" defaultValue={sp.categorie ?? ""}><option value="">Toutes catégories</option>{listeCategories.map((z) => <option key={z} value={z}>{z}</option>)}</select>}
        <button className="btn" type="submit">Filtrer</button>
        <a className="btn" href={`/api/export/clients?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()}`}>⬇ Export CSV</a>
        {filtres && <Link className="btn" href="/clients">Réinitialiser</Link>}
      </form>
      {sp.jours_min && <div className="info">Clients débiteurs sans règlement depuis plus de {sp.jours_min} jours (ou jamais).</div>}
      <div className="card p0"><div className="tbl" style={{ maxHeight: "70vh", overflow: "auto" }}>
        <table>
          <thead><tr>
            {COLONNES.map(([k, l, num, opt]) => (
              <th key={k} className={`${num ? "num" : ""} ${opt ? "opt" : ""}`}><Link href={lien({ tri: k, sens: tri === k && !asc ? "asc" : "desc" })}>{l}{tri === k ? (asc ? " ▲" : " ▼") : ""}</Link></th>
            ))}
            <th className="opt">TYPOLOGIE</th><th>STATUT</th>
          </tr></thead>
          <tbody>
            {clients.length === 0 && <tr><td colSpan={10} className="muted">Aucun client{extraction ? "" : " : chargez d'abord une extraction (onglet SOURCE)"}.</td></tr>}
            {clients.map((c) => (
              <tr key={c.compte}>
                <td className="opt"><Link href={`/clients/${c.compte}`}>{c.compte}</Link></td>
                <td><Link href={`/clients/${c.compte}`}><b>{c.intitule}</b></Link>{c.limite_depassee && <> <Badge classe="rouge" title="Limite de crédit dépassée">limite</Badge></>}{c.bv_bloque && <> <Badge classe="rouge" title="BV : bons servis > seuil × réglés">BV</Badge></>}</td>
                <td className="num opt">{fmt(c.facture_exercice)}</td>
                <td className="num opt">{fmt(c.regle)}</td>
                <td className="num" style={{ fontWeight: "bold", color: Number(c.solde) > 1000 ? "var(--rouge)" : "var(--vert)" }}>{fmt(c.solde)}</td>
                <td>{formatDate(c.dernier_reglement, true)}{c.jours_sans_reglement !== null && Number(c.solde) > 1000 && <span className="muted"> ({c.jours_sans_reglement} j)</span>}</td>
                <td className="opt">{formatDate(c.derniere_facture, true)}</td>
                <td className="num"><Score score={c.score} /></td>
                <td className="opt"><Badge classe="gris">{c.typologie}</Badge></td>
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
