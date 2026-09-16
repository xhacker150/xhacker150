import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { formatMontant, formatDate, formatNombre, formatDateHeure, LIBELLES_MODE_REGLEMENT, LIBELLES_TYPE_ACTION } from "@/lib/format";
import { BadgeStatutFacture, BadgeStatutAction } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import { emettreFacture, annulerFacture, basculerSuspensionRelances, ouvrirLitige, cloturerLitige } from "../actions";
import type { VueFacture, LigneFacture, Litige, ActionRecouvrement } from "@/lib/types";

export default async function PageFacture({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ succes?: string; erreur?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: facture }, { data: lignes }, { data: lettrages }, { data: litiges }, { data: actions }, parametres] = await Promise.all([
    supabase.from("vue_factures").select("*").eq("id", id).single(),
    supabase.from("lignes_facture").select("*").eq("facture_id", id).order("ordre"),
    supabase.from("lettrages").select("id, montant, reglements(id, numero, date_reglement, mode, reference, annule)").eq("facture_id", id),
    supabase.from("litiges").select("*").eq("facture_id", id).order("ouvert_le", { ascending: false }),
    supabase.from("actions_recouvrement").select("*").eq("facture_id", id).order("date_prevue", { ascending: false }),
    lireParametres(),
  ]);
  if (!facture) notFound();
  const f = facture as VueFacture;
  const { data: client } = await supabase.from("clients").select("*").eq("id", f.client_id).single();
  const devise = parametres.facturation.devise;
  const societe = parametres.societe;
  const ouverte = f.statut === "emise" || f.statut === "partiellement_payee";
  const litigeOuvert = ((litiges ?? []) as Litige[]).find((l) => l.statut === "ouvert");

  return (
    <>
      <div className="entete">
        <div>
          <h1>Facture {f.numero} <BadgeStatutFacture statut={f.statut} enRetard={f.en_retard} /></h1>
          <p><Link href={`/clients/${f.client_id}`}>{f.client_nom}</Link> · émise le {formatDate(f.date_facture)} · échéance {formatDate(f.date_echeance)}{f.en_retard ? ` (${f.jours_retard} jours de retard)` : ""}</p>
        </div>
        <div className="actions">
          {f.statut === "brouillon" && <form action={emettreFacture.bind(null, id)}><button className="btn primary" type="submit">Émettre</button></form>}
          {ouverte && <Link href={`/reglements/nouveau?client_id=${f.client_id}&facture_id=${id}`} className="btn primary">Encaisser</Link>}
          {ouverte && <Link href={`/recouvrement?client_id=${f.client_id}&facture_id=${id}&nouvelle=1`} className="btn">+ Action de relance</Link>}
          <Link href={`/factures/${id}/imprimer`} className="btn" target="_blank">Imprimer / PDF</Link>
        </div>
      </div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      {f.litige && <div className="alerte avert">Litige en cours : les relances automatiques sont suspendues jusqu&apos;à sa résolution.</div>}
      {f.relances_suspendues && !f.litige && <div className="alerte info">Relances automatiques suspendues manuellement pour cette facture.</div>}

      <div className="grille grille-4">
        <div className="kpi"><div className="libelle">Montant HT</div><div className="valeur">{formatMontant(f.montant_ht, devise)}</div></div>
        <div className="kpi"><div className="libelle">TVA</div><div className="valeur">{formatMontant(f.montant_tva, devise)}</div></div>
        <div className="kpi primary"><div className="libelle">Total TTC</div><div className="valeur">{formatMontant(f.montant_ttc, devise)}</div></div>
        <div className={`kpi ${Number(f.reste_a_payer) > 0 && ouverte ? "danger" : "success"}`}><div className="libelle">Reste à payer</div><div className="valeur">{formatMontant(ouverte ? f.reste_a_payer : 0, devise)}</div><div className="detail">réglé : {formatMontant(f.montant_regle, devise)}{f.date_paiement ? ` · soldée le ${formatDate(f.date_paiement)}` : ""}</div></div>
      </div>

      <div className="grille grille-2 mt">
        <div className="carte">
          <h2>Détail</h2>
          <table className="tableau">
            <thead><tr><th>Désignation</th><th className="num">Qté</th><th className="num">PU HT</th><th className="num">TVA</th><th className="num">Total HT</th></tr></thead>
            <tbody>
              {((lignes ?? []) as LigneFacture[]).map((l) => (
                <tr key={l.id}><td>{l.designation}</td><td className="num">{formatNombre(l.quantite, Number(l.quantite) % 1 ? 3 : 0)}</td><td className="num">{formatMontant(l.prix_unitaire, devise)}</td><td className="num">{formatNombre(l.taux_tva, 0)} %</td><td className="num">{formatMontant(l.montant_ht, devise)}</td></tr>
              ))}
            </tbody>
          </table>
          <dl className="liste-def mt">
            {f.objet && <><dt>Objet</dt><dd>{f.objet}</dd></>}
            {f.reference_externe && <><dt>Référence Sage</dt><dd>{f.reference_externe}</dd></>}
            <dt>Niveau de relance</dt><dd>{f.niveau_relance > 0 ? `Niveau ${f.niveau_relance} (dernière relance le ${formatDate(f.derniere_relance_le)})` : "Aucune relance"}</dd>
            {f.notes && <><dt>Notes</dt><dd className="pre">{f.notes}</dd></>}
          </dl>
        </div>
        <div className="carte">
          <h2>Règlements affectés</h2>
          <table className="tableau">
            <thead><tr><th>N°</th><th>Date</th><th>Mode</th><th className="num">Montant</th></tr></thead>
            <tbody>
              {(lettrages ?? []).length === 0 && <tr><td colSpan={4} className="vide">Aucun règlement.</td></tr>}
              {(lettrages ?? []).map((l) => {
                const r = l.reglements as unknown as { id: string; numero: string; date_reglement: string; mode: string; reference: string | null; annule: boolean } | null;
                return (
                  <tr key={l.id} style={{ opacity: r?.annule ? 0.5 : 1 }}>
                    <td>{r?.numero}{r?.annule && <> <span className="badge neutral">Annulé</span></>}</td>
                    <td>{formatDate(r?.date_reglement)}</td>
                    <td>{LIBELLES_MODE_REGLEMENT[r?.mode ?? ""] ?? r?.mode}{r?.reference && <div className="texte-3 petit">{r.reference}</div>}</td>
                    <td className="num">{formatMontant(l.montant, devise)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="mt">Litiges</h3>
          {((litiges ?? []) as Litige[]).map((l) => (
            <div key={l.id} className="alerte" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <strong>{l.statut === "ouvert" ? "Ouvert" : l.statut === "resolu" ? "Résolu" : "Rejeté"}</strong> le {formatDateHeure(l.ouvert_le)} — {l.motif}
              {l.resolution && <div className="petit texte-2">Résolution : {l.resolution}</div>}
              {l.statut === "ouvert" && (
                <form action={cloturerLitige.bind(null, l.id, id)} className="form mt">
                  <div className="ligne">
                    <div className="champ"><label>Issue</label><select name="statut" defaultValue="resolu"><option value="resolu">Résolu (relances reprennent)</option><option value="rejete">Rejeté (réclamation infondée)</option></select></div>
                    <div className="champ"><label>Commentaire</label><input name="resolution" /></div>
                  </div>
                  <div><button className="btn petit" type="submit">Clôturer le litige</button></div>
                </form>
              )}
            </div>
          ))}
          {ouverte && !litigeOuvert && (
            <form action={ouvrirLitige.bind(null, id, f.client_id)} className="form">
              <div className="champ"><label>Ouvrir un litige (suspend les relances)</label><input name="motif" placeholder="Motif de la contestation" required /></div>
              <div><button className="btn petit" type="submit">Ouvrir le litige</button></div>
            </form>
          )}
        </div>
      </div>

      <div className="grille grille-2">
        <div className="carte">
          <h2>Historique de relance</h2>
          <table className="tableau">
            <thead><tr><th>Date</th><th>Action</th><th>Statut</th></tr></thead>
            <tbody>
              {(actions ?? []).length === 0 && <tr><td colSpan={3} className="vide">Aucune action.</td></tr>}
              {((actions ?? []) as ActionRecouvrement[]).map((a) => (
                <tr key={a.id}>
                  <td>{formatDate(a.date_prevue)}</td>
                  <td><strong>{LIBELLES_TYPE_ACTION[a.type] ?? a.type}</strong>{a.niveau ? ` · N${a.niveau}` : ""}<div className="petit">{a.sujet}</div>{a.resultat && <div className="petit texte-2">→ {a.resultat}</div>}</td>
                  <td><BadgeStatutAction statut={a.statut} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="carte non-imprimable">
          <h2>Gestion</h2>
          {ouverte && (
            <form action={basculerSuspensionRelances.bind(null, id, !f.relances_suspendues)} className="mt">
              <button className="btn" type="submit">{f.relances_suspendues ? "Réactiver les relances automatiques" : "Suspendre les relances automatiques"}</button>
            </form>
          )}
          {(f.statut === "brouillon" || (f.statut === "emise" && Number(f.montant_regle) === 0)) && (
            <form action={annulerFacture.bind(null, id)} className="form mt">
              <div className="champ"><label>Annuler la facture</label><input name="motif" placeholder="Motif d'annulation" /></div>
              <div><button className="btn danger petit" type="submit">Annuler définitivement</button></div>
            </form>
          )}
          <p className="petit texte-3 mt">Émetteur : {societe.nom}{societe.nif ? ` · NIF ${societe.nif}` : ""}. Client : {client?.raison_sociale} {client?.nif ? `· NIF ${client.nif}` : ""}.</p>
        </div>
      </div>
    </>
  );
}
