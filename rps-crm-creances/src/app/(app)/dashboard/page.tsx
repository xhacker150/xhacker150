import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtF, fmtM, formatDate, libelleMois } from "@/lib/format";
import { BadgeStatut, Score } from "@/components/Badge";
import { Messages } from "@/components/Messages";

interface Kpis {
  sans_donnees?: boolean; date_extraction: string; saisi_jusquau: string | null; donnees_perimees: boolean;
  creances_totales: number; avances: number; clients_debiteurs: number; a_relancer: number; a_relancer_montant: number;
  facture_mois: number; encaisse_mois: number; facture_mois_clos: number; encaisse_mois_clos: number; mois: string; mois_clos: string;
  dso_jours: number | null; creances_90j: number; part_creances_90j: number;
  balance_facturation: Record<string, number>; balance_dernier_reglement: Record<string, number>;
  top_debiteurs: { compte: string; intitule: string; solde: number; jours: number | null; statut: string; typologie: string; score: number }[];
  promesses_semaine: { id: string; compte: string; intitule: string; montant: number; echeance: string; auteur: string }[];
  promesses_echues: { id: string; compte: string; intitule: string; montant: number; echeance: string; auteur: string }[];
  prevision_30j: number; prevision_60j: number; taux_promesses_tenues: number | null; taches_du_jour: number; contentieux: number; limites_depassees: number;
  courbe_12_mois: { mois: string; facture: number; encaisse: number }[];
}
interface Alertes {
  decrochages: { compte: string; intitule: string; solde: number; jours: number; seuil: number; typologie: string }[];
  promesses_echues: unknown[]; limites_depassees: { compte: string; intitule: string; solde: number; limite: number }[];
  comptes_muets: { compte: string; intitule: string; solde: number }[]; avances_qui_fondent: { compte: string; intitule: string; avance: number }[];
}
const TRANCHES: [string, string][] = [["0_30", "0-30 j"], ["31_60", "31-60 j"], ["61_90", "61-90 j"], ["plus_90", "+90 j"]];

export default async function PageTableauDeBord({ searchParams }: { searchParams: Promise<{ erreur?: string; succes?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: kpis }, { data: alertes }] = await Promise.all([supabase.rpc("tableau_de_bord"), supabase.rpc("alertes_du_jour")]);
  const k = (kpis ?? { sans_donnees: true }) as Kpis;
  const al = (alertes ?? {}) as Alertes;

  if (k.sans_donnees) {
    return (
      <>
        <h1 className="pg">Tableau de bord créances</h1>
        <Messages erreur={sp.erreur} succes={sp.succes} />
        <div className="card">
          <h3>Bienvenue</h3>
          <p>Aucune extraction du pont Sage n&apos;a encore été chargée. Le CRM n&apos;invente aucun chiffre : rendez-vous dans <Link href="/source">SOURCE</Link> pour charger les fichiers du pont (qr0, qr1, qr3, qr4) ou configurer l&apos;API du pont.</p>
        </div>
      </>
    );
  }
  const total = Math.max(1, Number(k.creances_totales));
  const maxCourbe = Math.max(1, ...k.courbe_12_mois.flatMap((m) => [Number(m.facture), Number(m.encaisse)]));
  const maxTop = Math.max(1, ...k.top_debiteurs.map((d) => Number(d.solde)));

  return (
    <>
      <h1 className="pg">Tableau de bord créances — {formatDate(k.date_extraction)}</h1>
      <Messages erreur={sp.erreur} succes={sp.succes} />
      <div className="tuiles">
        <Link href="/clients?statut=debiteurs" className="tuile r"><div className="l">Créances totales</div><div className="v">{fmtF(k.creances_totales)}</div><div className="d">{k.clients_debiteurs} clients débiteurs</div></Link>
        <Link href="/recouvrement" className="tuile r"><div className="l">À relancer</div><div className="v">{k.a_relancer}</div><div className="d">{fmtF(k.a_relancer_montant)} · décrochage de cadence</div></Link>
        <Link href="/facturation" className="tuile b"><div className="l">Facturé {libelleMois(k.mois)}</div><div className="v">{fmtF(k.facture_mois)}</div><div className="d">saisi jusqu&apos;au {formatDate(k.saisi_jusquau)} — mois non clos</div></Link>
        <Link href="/facturation" className="tuile v2"><div className="l">Encaissé {libelleMois(k.mois)}</div><div className="v">{fmtF(k.encaisse_mois)}</div><div className="d">{libelleMois(k.mois_clos)} : {fmtM(k.encaisse_mois_clos)} / {fmtM(k.facture_mois_clos)} facturés</div></Link>
        <Link href="/clients?statut=créditeur" className="tuile v2"><div className="l">Avances clients</div><div className="v">{fmtF(k.avances)}</div><div className="d">clients créditeurs : relance interdite</div></Link>
        <div className="tuile o"><div className="l">DSO</div><div className="v">{k.dso_jours ?? "—"} j</div><div className="d">encours / facturé 12 derniers mois clos × 365</div></div>
        <Link href="/clients?tri=jours" className="tuile r"><div className="l">Créances &gt; 90 j</div><div className="v">{k.part_creances_90j} %</div><div className="d">{fmtF(k.creances_90j)} — cible &lt; 5 %</div></Link>
        <Link href="/recouvrement?vue=promesses" className="tuile o"><div className="l">Prévision d&apos;encaissement</div><div className="v">{fmtM(k.prevision_30j)}</div><div className="d">à 30 j · {fmtM(k.prevision_60j)} à 60 j · promesses tenues : {k.taux_promesses_tenues ?? "—"} %</div></Link>
      </div>

      {(al.decrochages?.length > 0 || k.promesses_echues.length > 0 || al.limites_depassees?.length > 0) && (
        <div className="card" style={{ borderLeft: "4px solid var(--rouge)" }}>
          <h3>Alertes du matin</h3>
          <ul style={{ paddingLeft: 18, fontSize: 12.5 }}>
            {al.decrochages?.slice(0, 6).map((d) => (
              <li key={d.compte}><Link href={`/clients/${d.compte}`}><b>{d.intitule}</b></Link> a décroché : {d.jours} j sans règlement (sa cadence : alerte à {d.seuil} j) — solde {fmtF(d.solde)} · {d.typologie}</li>
            ))}
            {k.promesses_echues.map((p) => (
              <li key={p.id}><Link href={`/clients/${p.compte}`}><b>{p.intitule}</b></Link> : promesse de {fmtF(p.montant)} échue le {formatDate(p.echeance)} non tenue ({p.auteur})</li>
            ))}
            {al.limites_depassees?.map((l) => (
              <li key={l.compte}><Link href={`/clients/${l.compte}`}><b>{l.intitule}</b></Link> dépasse sa limite de crédit : {fmtF(l.solde)} pour {fmtF(l.limite)} — décision DG requise</li>
            ))}
            {al.comptes_muets?.map((c) => (
              <li key={c.compte}><Link href={`/clients/${c.compte}`}><b>{c.intitule}</b></Link> : compte muet (aucun règlement), {fmtF(c.solde)} dus — pré-contentieux</li>
            ))}
            {al.avances_qui_fondent?.map((c) => (
              <li key={c.compte}><Link href={`/clients/${c.compte}`}><b>{c.intitule}</b></Link> : avance de {fmtF(c.avance)}, inférieure à un mois de consommation</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h3>Top débiteurs <small><Link href="/clients">tous les clients →</Link></small></h3>
          <div className="stat-liste">
            {k.top_debiteurs.map((d) => (
              <Link href={`/clients/${d.compte}`} key={d.compte} className="stat-ligne" style={{ color: "inherit" }}>
                <span className="n">{d.intitule}</span>
                <span className="b"><span className="bar r"><i style={{ width: `${Math.round((100 * Number(d.solde)) / maxTop)}%` }} /></span></span>
                <span className="m sc">{fmtF(d.solde)}</span>
                <span style={{ width: 28 }}><Score score={d.score} /></span>
              </Link>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Balance âgée</h3>
          <div className="muted" style={{ marginBottom: 4 }}>Par ancienneté du dernier règlement</div>
          {TRANCHES.map(([cle, lib]) => (
            <div className="stat-ligne" key={cle} style={{ marginBottom: 5 }}>
              <span className="n" style={{ width: 60 }}>{lib}</span>
              <span className="b"><span className={`bar ${cle === "plus_90" ? "r" : ""}`}><i style={{ width: `${Math.round((100 * Number(k.balance_dernier_reglement[cle] ?? 0)) / total)}%` }} /></span></span>
              <span className="m sc">{fmtF(k.balance_dernier_reglement[cle])}</span>
            </div>
          ))}
          <div className="muted" style={{ margin: "10px 0 4px" }}>Par ancienneté de facturation (les mois les plus anciens sont réputés réglés en premier)</div>
          {TRANCHES.map(([cle, lib]) => (
            <div className="stat-ligne" key={cle} style={{ marginBottom: 5 }}>
              <span className="n" style={{ width: 60 }}>{lib}</span>
              <span className="b"><span className={`bar ${cle === "plus_90" ? "r" : "o"}`}><i style={{ width: `${Math.round((100 * Number(k.balance_facturation[cle] ?? 0)) / total)}%` }} /></span></span>
              <span className="m sc">{fmtF(k.balance_facturation[cle])}</span>
            </div>
          ))}
          <div className="note">Règle sur-mesure RPS : chaque client a sa cadence — l&apos;alerte « à relancer » part à 1,5 × la médiane de SES intervalles de règlement (bornée 10-45 j), pas à un seuil unique. La leçon SINOMA : un décrochage se voit en 2 semaines, pas en 6.</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Facturé vs encaissé — 12 mois</h3>
          {k.courbe_12_mois.map((m) => (
            <div key={m.mois} style={{ marginBottom: 6 }}>
              <div className="stat-ligne"><span className="n" style={{ width: 70 }}>{libelleMois(m.mois)}</span><span className="b"><span className="bar"><i style={{ width: `${Math.round((100 * Number(m.facture)) / maxCourbe)}%` }} /></span></span><span className="m sc muted">{fmtM(m.facture)}</span></div>
              <div className="stat-ligne"><span className="n" style={{ width: 70 }} /><span className="b"><span className="bar v"><i style={{ width: `${Math.round((100 * Number(m.encaisse)) / maxCourbe)}%` }} /></span></span><span className="m sc">{fmtM(m.encaisse)}</span></div>
            </div>
          ))}
          <div className="note">Bleu : facturé (gescom). Vert : encaissé (crédits compta hors RAN). Le mois en cours est incomplet tant que la saisie n&apos;est pas finie.</div>
        </div>
        <div className="card">
          <h3>Promesses de la semaine <small><Link href="/recouvrement?vue=promesses">toutes →</Link></small></h3>
          <div className="tbl"><table>
            <thead><tr><th>Échéance</th><th>Client</th><th className="num">Montant</th><th>Par</th></tr></thead>
            <tbody>
              {k.promesses_semaine.length === 0 && <tr><td colSpan={4} className="muted">Aucune promesse à échéance dans les 7 jours.</td></tr>}
              {k.promesses_semaine.map((p) => (
                <tr key={p.id}><td>{formatDate(p.echeance)}</td><td><Link href={`/clients/${p.compte}`}>{p.intitule}</Link></td><td className="num">{fmtF(p.montant)}</td><td>{p.auteur}</td></tr>
              ))}
            </tbody>
          </table></div>
          <div className="tuiles mt" style={{ marginBottom: 0 }}>
            <Link href="/recouvrement?vue=taches" className="tuile"><div className="l">Tâches du jour</div><div className="v">{k.taches_du_jour}</div></Link>
            <Link href="/recouvrement" className="tuile r"><div className="l">Contentieux</div><div className="v">{k.contentieux}</div></Link>
            <Link href="/clients?limite=1" className="tuile o"><div className="l">Limites dépassées</div><div className="v">{k.limites_depassees}</div></Link>
          </div>
        </div>
      </div>
      <div className="note">Solde économique = report à nouveau + facturation gescom + dépenses payées pour le client − règlements encaissés (comptes 411 hors 41180). Source : extractions du pont Sage, lecture seule.</div>
    </>
  );
}
