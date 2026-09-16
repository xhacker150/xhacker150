import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { formatMontant, formatDate, LIBELLES_TRANCHE, LIBELLES_TYPE_ACTION } from "@/lib/format";
import { Badge, BadgeStatutClient } from "@/components/Badge";
import { Messages } from "@/components/Messages";

interface Kpis {
  encours_total: number;
  echu_total: number;
  non_echu_total: number;
  nb_factures_retard: number;
  nb_clients_retard: number;
  dso_jours: number;
  encaisse_mois: number;
  facture_mois: number;
  actions_du_jour: number;
  actions_en_retard: number;
  promesses_semaine: number;
  litiges_ouverts: number;
  taux_recouvrement: number;
  balance_agee: Record<string, number>;
  top_debiteurs: { client_id: string; code: string; raison_sociale: string; encours_total: number; echu_total: number; retard_max_jours: number; statut: string }[];
  encaissements_6_mois: { mois: string; facture: number; encaisse: number }[];
}

const COULEURS_TRANCHE: Record<string, string> = {
  non_echu: "#2563eb",
  "0_30": "#f59e0b",
  "31_60": "#f97316",
  "61_90": "#ef4444",
  "91_120": "#b91c1c",
  plus_120: "#7f1d1d",
};

export default async function PageTableauDeBord({ searchParams }: { searchParams: Promise<{ erreur?: string; succes?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: kpisBrut }, parametres, { data: actions }, { data: promesses }] = await Promise.all([
    supabase.rpc("tableau_de_bord"),
    lireParametres(),
    supabase
      .from("actions_recouvrement")
      .select("id, type, canal, sujet, date_prevue, niveau, clients(raison_sociale), factures(numero)")
      .eq("statut", "planifiee")
      .lte("date_prevue", new Date().toISOString().slice(0, 10))
      .order("date_prevue")
      .limit(8),
    supabase
      .from("promesses_paiement")
      .select("id, montant, date_promise, clients(raison_sociale)")
      .eq("statut", "en_attente")
      .order("date_promise")
      .limit(6),
  ]);
  const k = (kpisBrut ?? {}) as Kpis;
  const devise = parametres.facturation.devise;
  const tranches = Object.entries(k.balance_agee ?? {});
  const maxTranche = Math.max(1, ...tranches.map(([, v]) => Number(v)));
  const maxMois = Math.max(1, ...(k.encaissements_6_mois ?? []).flatMap((m) => [Number(m.facture), Number(m.encaisse)]));

  return (
    <>
      <div className="entete">
        <div>
          <h1>Tableau de bord</h1>
          <p>Situation des créances au {formatDate(new Date().toISOString())}</p>
        </div>
        <div className="actions">
          <Link href="/factures/nouvelle" className="btn primary">+ Nouvelle facture</Link>
          <Link href="/reglements/nouveau" className="btn">+ Encaissement</Link>
        </div>
      </div>
      <Messages erreur={sp.erreur === "acces_refuse" ? "Accès réservé aux gestionnaires." : sp.erreur} succes={sp.succes} />

      <div className="grille grille-4">
        <div className="kpi primary">
          <div className="libelle">Encours clients</div>
          <div className="valeur">{formatMontant(k.encours_total, devise)}</div>
          <div className="detail">dont non échu {formatMontant(k.non_echu_total, devise)}</div>
        </div>
        <div className="kpi danger">
          <div className="libelle">Créances échues</div>
          <div className="valeur">{formatMontant(k.echu_total, devise)}</div>
          <div className="detail">{k.nb_factures_retard ?? 0} facture(s) · {k.nb_clients_retard ?? 0} client(s)</div>
        </div>
        <div className="kpi warning">
          <div className="libelle">DSO (délai moyen de règlement)</div>
          <div className="valeur">{k.dso_jours ?? 0} j</div>
          <div className="detail">Taux de recouvrement à échéance : {k.taux_recouvrement ?? 0} %</div>
        </div>
        <div className="kpi success">
          <div className="libelle">Encaissé ce mois</div>
          <div className="valeur">{formatMontant(k.encaisse_mois, devise)}</div>
          <div className="detail">Facturé ce mois : {formatMontant(k.facture_mois, devise)}</div>
        </div>
      </div>

      <div className="grille grille-4 mt">
        <Link href="/recouvrement" className="kpi" style={{ textDecoration: "none" }}>
          <div className="libelle">Actions de recouvrement à faire</div>
          <div className="valeur">{k.actions_du_jour ?? 0}</div>
          <div className="detail">{k.actions_en_retard ?? 0} en retard</div>
        </Link>
        <Link href="/recouvrement?onglet=promesses" className="kpi" style={{ textDecoration: "none" }}>
          <div className="libelle">Promesses attendues (7 j)</div>
          <div className="valeur">{formatMontant(k.promesses_semaine, devise)}</div>
        </Link>
        <Link href="/recouvrement?onglet=litiges" className="kpi" style={{ textDecoration: "none" }}>
          <div className="libelle">Litiges ouverts</div>
          <div className="valeur">{k.litiges_ouverts ?? 0}</div>
        </Link>
        <Link href="/creances" className="kpi" style={{ textDecoration: "none" }}>
          <div className="libelle">Créances &gt; 90 jours</div>
          <div className="valeur">{formatMontant(Number(k.balance_agee?.t_91_120 ?? 0) + Number(k.balance_agee?.t_plus_120 ?? 0), devise)}</div>
        </Link>
      </div>

      <div className="grille grille-2 mt">
        <div className="carte">
          <h2>Balance âgée <small><Link href="/creances">Détail par client →</Link></small></h2>
          <div className="barres">
            {tranches.map(([cle, valeur]) => (
              <div className="barre" key={cle}>
                <span>{LIBELLES_TRANCHE[cle] ?? cle}</span>
                <div className="jauge"><div style={{ width: `${(Number(valeur) / maxTranche) * 100}%`, background: COULEURS_TRANCHE[cle] }} /></div>
                <span className="montant">{formatMontant(valeur, devise)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="carte">
          <h2>Facturé vs encaissé (6 mois)</h2>
          <div className="barres">
            {(k.encaissements_6_mois ?? []).map((m) => (
              <div key={m.mois}>
                <div className="barre">
                  <span>{m.mois}</span>
                  <div className="jauge"><div style={{ width: `${(Number(m.facture) / maxMois) * 100}%`, background: "#93c5fd" }} /></div>
                  <span className="montant texte-2">{formatMontant(m.facture, devise)}</span>
                </div>
                <div className="barre">
                  <span className="texte-3 petit">encaissé</span>
                  <div className="jauge"><div style={{ width: `${(Number(m.encaisse) / maxMois) * 100}%`, background: "#22c55e" }} /></div>
                  <span className="montant">{formatMontant(m.encaisse, devise)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grille grille-2">
        <div className="carte">
          <h2>Principaux débiteurs <small>par montant échu</small></h2>
          <div className="tableau-conteneur">
            <table className="tableau">
              <thead><tr><th>Client</th><th className="num">Échu</th><th className="num">Retard max</th><th>Statut</th></tr></thead>
              <tbody>
                {(k.top_debiteurs ?? []).length === 0 && <tr><td colSpan={4} className="vide">Aucune créance échue.</td></tr>}
                {(k.top_debiteurs ?? []).map((d) => (
                  <tr key={d.client_id}>
                    <td><Link href={`/clients/${d.client_id}`}>{d.raison_sociale}</Link><div className="texte-3 petit">{d.code}</div></td>
                    <td className="num">{formatMontant(d.echu_total, devise)}</td>
                    <td className="num">{d.retard_max_jours} j</td>
                    <td><BadgeStatutClient statut={d.statut} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="carte">
          <h2>Agenda de recouvrement <small><Link href="/recouvrement">Tout voir →</Link></small></h2>
          <div className="tableau-conteneur">
            <table className="tableau">
              <thead><tr><th>Date</th><th>Action</th><th>Client</th></tr></thead>
              <tbody>
                {(actions ?? []).length === 0 && <tr><td colSpan={3} className="vide">Aucune action en attente.</td></tr>}
                {(actions ?? []).map((a) => {
                  const client = a.clients as unknown as { raison_sociale: string } | null;
                  const facture = a.factures as unknown as { numero: string } | null;
                  return (
                    <tr key={a.id}>
                      <td className={a.date_prevue < new Date().toISOString().slice(0, 10) ? "" : "muet"}>{formatDate(a.date_prevue)}</td>
                      <td>
                        <Badge ton="info">{LIBELLES_TYPE_ACTION[a.type] ?? a.type}</Badge> {a.sujet}
                        {facture && <div className="texte-3 petit">{facture.numero}</div>}
                      </td>
                      <td>{client?.raison_sociale}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(promesses ?? []).length > 0 && (
            <>
              <h3 className="mt">Promesses de paiement à venir</h3>
              <table className="tableau">
                <tbody>
                  {(promesses ?? []).map((p) => {
                    const client = p.clients as unknown as { raison_sociale: string } | null;
                    return (
                      <tr key={p.id}>
                        <td>{formatDate(p.date_promise)}</td>
                        <td>{client?.raison_sociale}</td>
                        <td className="num">{formatMontant(p.montant, devise)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </>
  );
}
