import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { formatMontant, formatDate, formatDateHeure, LIBELLES_TYPE_CLIENT, LIBELLES_MODE_REGLEMENT, LIBELLES_TYPE_ACTION, LIBELLES_STATUT_CLIENT } from "@/lib/format";
import { BadgeStatutClient, BadgeStatutFacture, BadgeStatutAction, BadgeStatutPromesse } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import { changerStatutClient } from "../actions";
import type { VueFacture, Reglement, ActionRecouvrement, Promesse, BalanceAgee } from "@/lib/types";

export default async function PageClient({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ succes?: string; erreur?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: client }, { data: situation }, { data: factures }, { data: reglements }, { data: actions }, { data: promesses }, parametres] = await Promise.all([
    supabase.from("clients").select("*, scenarios_relance(nom), profils(nom)").eq("id", id).single(),
    supabase.rpc("situation_client", { p_client_id: id }),
    supabase.from("vue_factures").select("*").eq("client_id", id).order("date_facture", { ascending: false }).limit(50),
    supabase.from("reglements").select("*").eq("client_id", id).order("date_reglement", { ascending: false }).limit(20),
    supabase.from("actions_recouvrement").select("*, factures(numero), profils(nom)").eq("client_id", id).order("date_prevue", { ascending: false }).limit(30),
    supabase.from("promesses_paiement").select("*").eq("client_id", id).order("date_promise", { ascending: false }).limit(10),
    lireParametres(),
  ]);
  if (!client) notFound();
  const devise = parametres.facturation.devise;
  const sit = (situation ?? {}) as { balance?: BalanceAgee; total_facture?: number; total_regle?: number; delai_moyen_paiement?: number | null; nb_promesses_rompues?: number };
  const b = sit.balance;
  const scenario = client.scenarios_relance as unknown as { nom: string } | null;
  const agent = client.profils as unknown as { nom: string } | null;
  const depassement = Number(client.plafond_credit) > 0 && Number(b?.encours_total ?? 0) > Number(client.plafond_credit);

  return (
    <>
      <div className="entete">
        <div>
          <h1>{client.raison_sociale} <BadgeStatutClient statut={client.statut} /></h1>
          <p>{client.code} · {LIBELLES_TYPE_CLIENT[client.type]} {client.ville ? `· ${client.ville}` : ""}</p>
        </div>
        <div className="actions">
          <Link href={`/factures/nouvelle?client_id=${id}`} className="btn primary">+ Facture</Link>
          <Link href={`/reglements/nouveau?client_id=${id}`} className="btn">+ Encaissement</Link>
          <Link href={`/recouvrement?client_id=${id}&nouvelle=1`} className="btn">+ Action</Link>
          <Link href={`/clients/${id}/modifier`} className="btn">Modifier</Link>
        </div>
      </div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      {depassement && <div className="alerte avert">Plafond de crédit dépassé : encours {formatMontant(b?.encours_total, devise)} pour un plafond de {formatMontant(client.plafond_credit, devise)}.</div>}
      {client.statut === "bloque" && <div className="alerte erreur">Client bloqué : aucune nouvelle facture ne devrait être émise avant régularisation.</div>}

      <div className="grille grille-4">
        <div className="kpi primary"><div className="libelle">Encours</div><div className="valeur">{formatMontant(b?.encours_total, devise)}</div><div className="detail">{b?.nb_factures_ouvertes ?? 0} facture(s) ouverte(s)</div></div>
        <div className="kpi danger"><div className="libelle">Échu</div><div className="valeur">{formatMontant(b?.echu_total, devise)}</div><div className="detail">retard max {b?.retard_max_jours ?? 0} j</div></div>
        <div className="kpi"><div className="libelle">Délai moyen de paiement</div><div className="valeur">{sit.delai_moyen_paiement ?? "-"} j</div><div className="detail">conditions : {client.delai_paiement_jours} j</div></div>
        <div className="kpi"><div className="libelle">Total facturé / réglé</div><div className="valeur">{formatMontant(sit.total_regle, devise)}</div><div className="detail">sur {formatMontant(sit.total_facture, devise)} · {sit.nb_promesses_rompues ?? 0} promesse(s) rompue(s)</div></div>
      </div>

      <div className="grille grille-2 mt">
        <div className="carte">
          <h2>Coordonnées</h2>
          <dl className="liste-def">
            <dt>Contact</dt><dd>{client.contact_nom ?? "-"} {client.contact_fonction ? `(${client.contact_fonction})` : ""}</dd>
            <dt>Téléphone</dt><dd>{client.telephone ?? "-"}</dd>
            <dt>E-mail</dt><dd>{client.email ?? <span className="texte-3">non renseigné (relances e-mail impossibles)</span>}</dd>
            <dt>Adresse</dt><dd>{[client.adresse, client.ville, client.pays].filter(Boolean).join(", ") || "-"}</dd>
            <dt>NIF / RCCM</dt><dd>{client.nif ?? "-"} / {client.rccm ?? "-"}</dd>
            <dt>Référence Sage</dt><dd>{client.reference_sage ?? "-"}</dd>
            <dt>Scénario de relance</dt><dd>{scenario?.nom ?? "Scénario par défaut"}</dd>
            <dt>Agent</dt><dd>{agent?.nom ?? "Non affecté"}</dd>
            <dt>Plafond de crédit</dt><dd>{Number(client.plafond_credit) > 0 ? formatMontant(client.plafond_credit, devise) : "illimité"}</dd>
          </dl>
          {client.notes && <p className="pre mt">{client.notes}</p>}
          <div className="mt" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(LIBELLES_STATUT_CLIENT).filter(([k]) => k !== client.statut).map(([k, v]) => (
              <form key={k} action={changerStatutClient.bind(null, id, k)}><button className="btn petit" type="submit">Passer en « {v} »</button></form>
            ))}
          </div>
        </div>
        <div className="carte">
          <h2>Balance âgée</h2>
          <table className="tableau">
            <tbody>
              <tr><td>Non échu</td><td className="num">{formatMontant(b?.non_echu, devise)}</td></tr>
              <tr><td>1 à 30 jours</td><td className="num">{formatMontant(b?.t_0_30, devise)}</td></tr>
              <tr><td>31 à 60 jours</td><td className="num">{formatMontant(b?.t_31_60, devise)}</td></tr>
              <tr><td>61 à 90 jours</td><td className="num">{formatMontant(b?.t_61_90, devise)}</td></tr>
              <tr><td>91 à 120 jours</td><td className="num">{formatMontant(b?.t_91_120, devise)}</td></tr>
              <tr><td>Plus de 120 jours</td><td className="num">{formatMontant(b?.t_plus_120, devise)}</td></tr>
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{formatMontant(b?.encours_total, devise)}</td></tr></tfoot>
          </table>
        </div>
      </div>

      <div className="carte">
        <h2>Factures <small><Link href={`/factures?client_id=${id}`}>Toutes →</Link></small></h2>
        <div className="tableau-conteneur">
          <table className="tableau">
            <thead><tr><th>N°</th><th>Date</th><th>Échéance</th><th>Objet</th><th className="num">TTC</th><th className="num">Reste</th><th>Statut</th><th className="num">Relance</th></tr></thead>
            <tbody>
              {(factures ?? []).length === 0 && <tr><td colSpan={8} className="vide">Aucune facture.</td></tr>}
              {((factures ?? []) as VueFacture[]).map((f) => (
                <tr key={f.id}>
                  <td><Link href={`/factures/${f.id}`}>{f.numero}</Link>{f.reference_externe && <div className="texte-3 petit">{f.reference_externe}</div>}</td>
                  <td>{formatDate(f.date_facture)}</td>
                  <td>{formatDate(f.date_echeance)}{f.en_retard && <div className="petit" style={{ color: "var(--danger)" }}>+{f.jours_retard} j</div>}</td>
                  <td>{f.objet}</td>
                  <td className="num">{formatMontant(f.montant_ttc, devise)}</td>
                  <td className="num">{formatMontant(f.reste_a_payer, devise)}</td>
                  <td><BadgeStatutFacture statut={f.statut} enRetard={f.en_retard} />{f.litige && <> <span className="badge warning">Litige</span></>}</td>
                  <td className="num">{f.niveau_relance > 0 ? `N${f.niveau_relance}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grille grille-2">
        <div className="carte">
          <h2>Règlements</h2>
          <table className="tableau">
            <thead><tr><th>N°</th><th>Date</th><th>Mode</th><th className="num">Montant</th></tr></thead>
            <tbody>
              {(reglements ?? []).length === 0 && <tr><td colSpan={4} className="vide">Aucun règlement.</td></tr>}
              {((reglements ?? []) as Reglement[]).map((r) => (
                <tr key={r.id} style={{ opacity: r.annule ? 0.5 : 1 }}>
                  <td>{r.numero}{r.annule && <> <span className="badge neutral">Annulé</span></>}</td>
                  <td>{formatDate(r.date_reglement)}</td>
                  <td>{LIBELLES_MODE_REGLEMENT[r.mode] ?? r.mode}{r.reference && <div className="texte-3 petit">{r.reference}</div>}</td>
                  <td className="num">{formatMontant(r.montant, devise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(promesses ?? []).length > 0 && (
            <>
              <h3 className="mt">Promesses de paiement</h3>
              <table className="tableau">
                <tbody>
                  {((promesses ?? []) as Promesse[]).map((p) => (
                    <tr key={p.id}><td>{formatDate(p.date_promise)}</td><td className="num">{formatMontant(p.montant, devise)}</td><td><BadgeStatutPromesse statut={p.statut} /></td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="carte">
          <h2>Historique de recouvrement</h2>
          <table className="tableau">
            <thead><tr><th>Date</th><th>Action</th><th>Statut</th></tr></thead>
            <tbody>
              {(actions ?? []).length === 0 && <tr><td colSpan={3} className="vide">Aucune action.</td></tr>}
              {((actions ?? []) as (ActionRecouvrement & { factures: { numero: string } | null; profils: { nom: string } | null })[]).map((a) => (
                <tr key={a.id}>
                  <td>{formatDate(a.date_prevue)}{a.date_effectuee && <div className="texte-3 petit">fait le {formatDateHeure(a.date_effectuee)}</div>}</td>
                  <td>
                    <strong>{LIBELLES_TYPE_ACTION[a.type] ?? a.type}</strong>{a.niveau ? ` · niveau ${a.niveau}` : ""}{a.automatique ? " · auto" : ""}
                    <div className="petit">{a.sujet}</div>
                    {a.factures?.numero && <div className="texte-3 petit">{a.factures.numero}</div>}
                    {a.resultat && <div className="petit texte-2">→ {a.resultat}</div>}
                  </td>
                  <td><BadgeStatutAction statut={a.statut} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
