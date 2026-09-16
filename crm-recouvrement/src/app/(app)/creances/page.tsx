import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { formatMontant } from "@/lib/format";
import { BadgeStatutClient } from "@/components/Badge";
import type { BalanceAgee } from "@/lib/types";

export default async function PageCreances({ searchParams }: { searchParams: Promise<{ q?: string; tri?: string; tous?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const parametres = await lireParametres();
  const devise = parametres.facturation.devise;

  let requete = supabase.from("vue_balance_agee").select("*");
  if (!sp.tous) requete = requete.gt("encours_total", 0);
  if (sp.q) requete = requete.or(`raison_sociale.ilike.%${sp.q}%,code.ilike.%${sp.q}%`);
  const tri = sp.tri ?? "echu_total";
  requete = requete.order(tri, { ascending: tri === "raison_sociale" });
  const { data } = await requete;
  const lignes = (data ?? []) as BalanceAgee[];

  const total = (cle: keyof BalanceAgee) => lignes.reduce((s, l) => s + Number(l[cle] ?? 0), 0);
  const pct = (v: number) => (total("encours_total") > 0 ? `${((v / total("encours_total")) * 100).toFixed(1)} %` : "-");

  return (
    <>
      <div className="entete">
        <div>
          <h1>Balance âgée des créances</h1>
          <p>Répartition de l&apos;encours par ancienneté de retard, client par client.</p>
        </div>
        <div className="actions">
          <a href="/api/export/balance-agee" className="btn">Exporter CSV</a>
          <a href="/api/export/balance-agee?detail=1" className="btn">Exporter le détail des factures</a>
        </div>
      </div>

      <div className="carte">
        <form className="filtres" method="get">
          <div className="champ">
            <label>Recherche</label>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Nom ou code client" />
          </div>
          <div className="champ">
            <label>Trier par</label>
            <select name="tri" defaultValue={tri}>
              <option value="echu_total">Montant échu</option>
              <option value="encours_total">Encours total</option>
              <option value="retard_max_jours">Retard maximum</option>
              <option value="raison_sociale">Nom</option>
            </select>
          </div>
          <label className="champ inline"><input type="checkbox" name="tous" value="1" defaultChecked={Boolean(sp.tous)} /> Inclure les clients sans encours</label>
          <button className="btn" type="submit">Filtrer</button>
        </form>

        <div className="tableau-conteneur">
          <table className="tableau">
            <thead>
              <tr>
                <th>Client</th>
                <th>Statut</th>
                <th className="num">Non échu</th>
                <th className="num">1-30 j</th>
                <th className="num">31-60 j</th>
                <th className="num">61-90 j</th>
                <th className="num">91-120 j</th>
                <th className="num">&gt; 120 j</th>
                <th className="num">Total échu</th>
                <th className="num">Encours</th>
                <th className="num">Retard max</th>
              </tr>
            </thead>
            <tbody>
              {lignes.length === 0 && <tr><td colSpan={11} className="vide">Aucun encours.</td></tr>}
              {lignes.map((l) => (
                <tr key={l.client_id}>
                  <td><Link href={`/clients/${l.client_id}`}>{l.raison_sociale}</Link><div className="texte-3 petit">{l.code} · {l.nb_factures_ouvertes} facture(s)</div></td>
                  <td><BadgeStatutClient statut={l.statut} /></td>
                  <td className="num">{formatMontant(l.non_echu, devise)}</td>
                  <td className="num">{formatMontant(l.t_0_30, devise)}</td>
                  <td className="num">{formatMontant(l.t_31_60, devise)}</td>
                  <td className="num">{formatMontant(l.t_61_90, devise)}</td>
                  <td className="num">{formatMontant(l.t_91_120, devise)}</td>
                  <td className="num">{formatMontant(l.t_plus_120, devise)}</td>
                  <td className="num" style={{ color: Number(l.echu_total) > 0 ? "var(--danger)" : undefined }}>{formatMontant(l.echu_total, devise)}</td>
                  <td className="num"><strong>{formatMontant(l.encours_total, devise)}</strong></td>
                  <td className="num">{l.retard_max_jours} j</td>
                </tr>
              ))}
            </tbody>
            {lignes.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2}>Total ({lignes.length} clients)</td>
                  <td className="num">{formatMontant(total("non_echu"), devise)}<div className="texte-3 petit">{pct(total("non_echu"))}</div></td>
                  <td className="num">{formatMontant(total("t_0_30"), devise)}<div className="texte-3 petit">{pct(total("t_0_30"))}</div></td>
                  <td className="num">{formatMontant(total("t_31_60"), devise)}<div className="texte-3 petit">{pct(total("t_31_60"))}</div></td>
                  <td className="num">{formatMontant(total("t_61_90"), devise)}<div className="texte-3 petit">{pct(total("t_61_90"))}</div></td>
                  <td className="num">{formatMontant(total("t_91_120"), devise)}<div className="texte-3 petit">{pct(total("t_91_120"))}</div></td>
                  <td className="num">{formatMontant(total("t_plus_120"), devise)}<div className="texte-3 petit">{pct(total("t_plus_120"))}</div></td>
                  <td className="num">{formatMontant(total("echu_total"), devise)}<div className="texte-3 petit">{pct(total("echu_total"))}</div></td>
                  <td className="num">{formatMontant(total("encours_total"), devise)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
