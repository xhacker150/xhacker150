import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { formatMontant, LIBELLES_STATUT_CLIENT } from "@/lib/format";
import { BadgeStatutClient } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import type { BalanceAgee } from "@/lib/types";

export default async function PageClients({ searchParams }: { searchParams: Promise<{ q?: string; statut?: string; succes?: string; erreur?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const parametres = await lireParametres();
  let requete = supabase.from("vue_balance_agee").select("*").order("raison_sociale");
  if (sp.q) requete = requete.or(`raison_sociale.ilike.%${sp.q}%,code.ilike.%${sp.q}%`);
  if (sp.statut) requete = requete.eq("statut", sp.statut);
  const { data } = await requete;
  const clients = (data ?? []) as BalanceAgee[];
  const devise = parametres.facturation.devise;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Clients</h1>
          <p>{clients.length} client(s) · encours total {formatMontant(clients.reduce((s, c) => s + Number(c.encours_total), 0), devise)}</p>
        </div>
        <div className="actions">
          <Link href="/import" className="btn">Importer depuis Sage</Link>
          <Link href="/clients/nouveau" className="btn primary">+ Nouveau client</Link>
        </div>
      </div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="carte">
        <form className="filtres" method="get">
          <div className="champ"><label>Recherche</label><input name="q" defaultValue={sp.q ?? ""} placeholder="Nom, code" /></div>
          <div className="champ">
            <label>Statut</label>
            <select name="statut" defaultValue={sp.statut ?? ""}>
              <option value="">Tous</option>
              {Object.entries(LIBELLES_STATUT_CLIENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <button className="btn" type="submit">Filtrer</button>
        </form>
        <div className="tableau-conteneur">
          <table className="tableau">
            <thead>
              <tr><th>Code</th><th>Client</th><th>Contact</th><th>Statut</th><th className="num">Encours</th><th className="num">Échu</th><th className="num">Retard max</th></tr>
            </thead>
            <tbody>
              {clients.length === 0 && <tr><td colSpan={7} className="vide">Aucun client.</td></tr>}
              {clients.map((c) => (
                <tr key={c.client_id}>
                  <td className="mono">{c.code}</td>
                  <td><Link href={`/clients/${c.client_id}`}>{c.raison_sociale}</Link></td>
                  <td className="petit texte-2">{c.telephone}<br />{c.email}</td>
                  <td><BadgeStatutClient statut={c.statut} /></td>
                  <td className="num">{formatMontant(c.encours_total, devise)}</td>
                  <td className="num" style={{ color: Number(c.echu_total) > 0 ? "var(--danger)" : undefined }}>{formatMontant(c.echu_total, devise)}</td>
                  <td className="num">{Number(c.retard_max_jours) > 0 ? `${c.retard_max_jours} j` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
