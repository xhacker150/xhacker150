import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { formatMontant, formatDate, LIBELLES_MODE_REGLEMENT } from "@/lib/format";
import { Messages } from "@/components/Messages";
import { annulerReglement } from "./actions";

export default async function PageReglements({ searchParams }: { searchParams: Promise<{ q?: string; succes?: string; erreur?: string; id?: string; du?: string; au?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const parametres = await lireParametres();
  const devise = parametres.facturation.devise;
  let requete = supabase
    .from("reglements")
    .select("*, clients(raison_sociale, code), lettrages(montant, factures(numero, id))")
    .order("date_reglement", { ascending: false })
    .order("numero", { ascending: false })
    .limit(200);
  if (sp.du) requete = requete.gte("date_reglement", sp.du);
  if (sp.au) requete = requete.lte("date_reglement", sp.au);
  if (sp.q) requete = requete.or(`numero.ilike.%${sp.q}%,reference.ilike.%${sp.q}%`);
  const { data } = await requete;
  const reglements = data ?? [];
  const total = reglements.filter((r) => !r.annule).reduce((s, r) => s + Number(r.montant), 0);

  return (
    <>
      <div className="entete">
        <div><h1>Règlements</h1><p>{reglements.length} règlement(s) affichés · total {formatMontant(total, devise)}</p></div>
        <div className="actions"><Link href="/reglements/nouveau" className="btn primary">+ Nouvel encaissement</Link></div>
      </div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="carte">
        <form className="filtres" method="get">
          <div className="champ"><label>Recherche</label><input name="q" defaultValue={sp.q ?? ""} placeholder="N°, référence" /></div>
          <div className="champ"><label>Du</label><input type="date" name="du" defaultValue={sp.du ?? ""} /></div>
          <div className="champ"><label>Au</label><input type="date" name="au" defaultValue={sp.au ?? ""} /></div>
          <button className="btn" type="submit">Filtrer</button>
        </form>
        <div className="tableau-conteneur">
          <table className="tableau">
            <thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Mode</th><th>Affectation</th><th className="num">Montant</th><th></th></tr></thead>
            <tbody>
              {reglements.length === 0 && <tr><td colSpan={7} className="vide">Aucun règlement.</td></tr>}
              {reglements.map((r) => {
                const client = r.clients as unknown as { raison_sociale: string; code: string } | null;
                const lettr = (r.lettrages as unknown as { montant: number; factures: { numero: string; id: string } | null }[]) ?? [];
                const affecte = lettr.reduce((s, l) => s + Number(l.montant), 0);
                const nonAffecte = Number(r.montant) - affecte;
                return (
                  <tr key={r.id} style={{ opacity: r.annule ? 0.55 : 1, background: sp.id === r.id ? "var(--success-soft)" : undefined }}>
                    <td className="mono">{r.numero}{r.annule && <> <span className="badge neutral">Annulé</span></>}</td>
                    <td>{formatDate(r.date_reglement)}</td>
                    <td><Link href={`/clients/${r.client_id}`}>{client?.raison_sociale}</Link><div className="texte-3 petit">{client?.code}</div></td>
                    <td>{LIBELLES_MODE_REGLEMENT[r.mode] ?? r.mode}{r.reference && <div className="texte-3 petit">{r.reference}{r.banque ? ` · ${r.banque}` : ""}</div>}</td>
                    <td className="petit">
                      {lettr.map((l, i) => <div key={i}><Link href={`/factures/${l.factures?.id}`}>{l.factures?.numero}</Link> : {formatMontant(l.montant, devise)}</div>)}
                      {nonAffecte > 0.005 && !r.annule && <div style={{ color: "var(--warning)" }}>Non affecté : {formatMontant(nonAffecte, devise)}</div>}
                    </td>
                    <td className="num"><strong>{formatMontant(r.montant, devise)}</strong></td>
                    <td className="actions">
                      {!r.annule && (
                        <form action={annulerReglement.bind(null, r.id)} style={{ display: "inline-flex", gap: 4 }}>
                          <input name="motif" placeholder="motif" style={{ width: 110, padding: 4, border: "1px solid var(--border)", borderRadius: 6 }} />
                          <button className="btn petit danger" type="submit">Annuler</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
