import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { extractionActive, lireParametres } from "@/lib/session";
import { fmt, formatDate, libelleMois, LIBELLES_TYPE_ACTION } from "@/lib/format";
import { enregistrerDocument } from "../../actions";
import type { VueClient, Ecriture, Livraison, Action } from "@/lib/types";

/**
 * Situation officielle 4 volets (CDC-05 §5.9, gabarit charte RPS) :
 * 1. facture du dernier mois clos (réserve « saisi jusqu'au » si incomplet) ; 2. relevé de facturation ;
 * 3. situation chronologique : RAN, chaque règlement individuellement, débits hors RAN, solde ; 4. note d'analyse.
 */
export default async function PageSituation({ params }: { params: Promise<{ compte: string }> }) {
  const { compte } = await params;
  const supabase = await createClient();
  const [extraction, parametres] = await Promise.all([extractionActive(), lireParametres()]);
  if (!extraction) notFound();
  const [{ data: client }, { data: ecritures }, { data: facturation }, { data: livraisons }, { data: actions }] = await Promise.all([
    supabase.from("vue_clients").select("*").eq("compte", compte).maybeSingle(),
    supabase.from("vue_ecritures").select("*").eq("compte", compte).order("date_ecriture").order("ordre"),
    supabase.from("vue_facturation").select("mois, ht").eq("compte", compte).order("mois"),
    supabase.from("vue_livraisons").select("*").eq("compte", compte).order("date_livraison").order("ordre"),
    supabase.from("actions").select("*").eq("compte", compte).order("cree_le", { ascending: false }).limit(15),
  ]);
  if (!client) notFound();
  const c = client as VueClient;
  const s = parametres.societe;
  const dateArrete = extraction.date_extraction;
  await enregistrerDocument(compte, "situation_4_volets", dateArrete);

  const ecr = (ecritures ?? []) as Ecriture[];
  const livr = (livraisons ?? []) as Livraison[];
  const mensuel = (facturation ?? []) as { mois: string; ht: number }[];
  // dernier mois clos = mois précédant la date d'arrêté ; si la saisie est incomplète on le signale
  const d = new Date(dateArrete + "T00:00:00Z");
  const moisClos = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const livrMois = livr.filter((l) => l.date_livraison.startsWith(moisClos));
  const totalMois = livrMois.reduce((x, l) => x + Number(l.montant_ht), 0);
  const litresMois = livrMois.reduce((x, l) => x + Number(l.qte), 0);
  const saisiIncomplet = extraction.saisi_jusquau ? extraction.saisi_jusquau < `${moisClos}-28` && extraction.saisi_jusquau.startsWith(moisClos) : false;
  const releveLong = livr.length > 300;

  // Volet 3 : chronologie avec solde courant (RAN d'abord, puis facturation mensuelle, débits et règlements dans l'ordre des dates)
  type L = { date: string; libelle: string; debit: number; credit: number; ref: string };
  const lignes: L[] = [
    ...ecr.filter((e) => e.journal === "RAN").map((e) => ({ date: e.date_ecriture, libelle: `Report à nouveau — ${e.intitule ?? ""}`, debit: e.sens === 0 ? Number(e.montant) : 0, credit: e.sens === 1 ? Number(e.montant) : 0, ref: `${e.journal} ${e.piece ?? ""}` })),
    ...mensuel.map((m) => ({ date: `${m.mois}-01`, libelle: `Facturation ${libelleMois(m.mois)}`, debit: Number(m.ht), credit: 0, ref: "gescom" })),
    ...ecr.filter((e) => e.journal !== "RAN").map((e) => ({ date: e.date_ecriture, libelle: `${e.sens === 1 ? "Règlement" : "Dépense payée pour le client"} — ${e.intitule ?? ""}${e.payeur ? ` (payeur : ${e.payeur})` : ""}`, debit: e.sens === 0 ? Number(e.montant) : 0, credit: e.sens === 1 ? Number(e.montant) : 0, ref: `${e.journal} ${e.piece ?? ""} ${e.ref_piece ?? ""}`.trim() })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let cumul = 0;

  return (
    <div className="doc">
      <div className="noprint" style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <Link href={`/clients/${compte}`} className="btn">← Fiche client</Link>
        <span className="muted" style={{ alignSelf: "center" }}>Imprimer ou enregistrer en PDF avec Ctrl+P. Classement GED : 30_CLIENTS/{compte}/</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><div className="logo" style={{ fontSize: 22 }}><b>{s.sigle}</b> <span>{s.nom}</span></div><div className="muted">{s.adresse} · {s.ville}, {s.pays} · NIF {s.nif}</div></div>
        <div className="right"><h1>SITUATION CLIENT</h1><div><b>{c.intitule}</b> — compte {c.compte}</div><div>Arrêtée au {formatDate(dateArrete)}</div>{extraction.saisi_jusquau && <div className="muted">Facturation saisie jusqu&apos;au {formatDate(extraction.saisi_jusquau)}</div>}</div>
      </div>
      <div className="bandeau"><i /><i /></div>

      <section className="volet">
        <h2>Volet 1 — Facture du dernier mois clos : {libelleMois(moisClos)}</h2>
        {saisiIncomplet && <div className="warn">Réserve : la facturation de {libelleMois(moisClos)} n&apos;est saisie que jusqu&apos;au {formatDate(extraction.saisi_jusquau)} ; ce volet sera complété à la clôture de la saisie.</div>}
        {releveLong ? (
          <p>Relevé mensuel synthétique ({livrMois.length} livraisons) : {fmt(litresMois)} litres, {fmt(totalMois)} F HT. Le détail des bons est disponible sur demande.</p>
        ) : (
          <table>
            <thead><tr><th>Date</th><th>Pièce</th><th>Produit</th><th>Bon / camion</th><th>Station</th><th className="num">Litres</th><th className="num">Montant HT (F)</th></tr></thead>
            <tbody>{livrMois.map((l, i) => <tr key={i}><td>{formatDate(l.date_livraison)}</td><td>{l.piece}</td><td>{l.ar_ref}</td><td>{l.designation}</td><td>{l.station ?? l.depot}</td><td className="num">{fmt(l.qte)}</td><td className="num">{fmt(l.montant_ht)}</td></tr>)}
              {livrMois.length === 0 && <tr><td colSpan={7} className="muted">Aucune livraison en {libelleMois(moisClos)}.</td></tr>}</tbody>
            <tfoot><tr><td colSpan={5}>TOTAL {libelleMois(moisClos).toUpperCase()}</td><td className="num">{fmt(litresMois)}</td><td className="num">{fmt(totalMois)}</td></tr></tfoot>
          </table>
        )}
      </section>

      <section className="volet">
        <h2>Volet 2 — Relevé de facturation</h2>
        <table>
          <thead><tr><th>Mois</th><th className="num">Montant HT (F)</th></tr></thead>
          <tbody>{mensuel.map((m) => <tr key={m.mois}><td>{libelleMois(m.mois)}{m.mois > moisClos ? " (mois en cours, saisie incomplète)" : ""}</td><td className="num">{fmt(m.ht)}</td></tr>)}</tbody>
          <tfoot><tr><td>TOTAL FACTURÉ</td><td className="num">{fmt(c.facture)}</td></tr></tfoot>
        </table>
      </section>

      <section className="volet">
        <h2>Volet 3 — Situation chronologique du compte</h2>
        <table>
          <thead><tr><th>Date</th><th>Libellé</th><th>Référence</th><th className="num">Débit (F)</th><th className="num">Crédit (F)</th><th className="num">Solde (F)</th></tr></thead>
          <tbody>{lignes.map((l, i) => { cumul += l.debit - l.credit; return <tr key={i}><td>{formatDate(l.date)}</td><td>{l.libelle}</td><td>{l.ref}</td><td className="num">{l.debit ? fmt(l.debit) : ""}</td><td className="num">{l.credit ? fmt(l.credit) : ""}</td><td className="num">{fmt(cumul)}</td></tr>; })}</tbody>
          <tfoot><tr><td colSpan={3}>SOLDE AU {formatDate(dateArrete).toUpperCase()} {Number(c.solde) < 0 ? "(EN VOTRE FAVEUR)" : "(DÛ)"}</td><td className="num">{fmt(Number(c.ran) > 0 ? c.ran : 0)}</td><td className="num">{fmt(c.regle)}</td><td className="num"><b>{fmt(c.solde)}</b></td></tr></tfoot>
        </table>
        <p className="note">RAN {fmt(c.ran)} + facturation {fmt(c.facture)} + dépenses payées pour le client {fmt(c.debits_hors_ran)} − règlements {fmt(c.regle)} = {fmt(c.solde)} F. Chaque règlement est présenté individuellement (date, journal, pièce, référence).</p>
      </section>

      <section className="volet">
        <h2>Volet 4 — Note d&apos;analyse</h2>
        <dl className="dl">
          <dt>Typologie</dt><dd>{c.typologie}</dd>
          <dt>Cadence de règlement</dt><dd>{c.cadence_jours ? `un règlement tous les ~${c.cadence_jours} jours (${c.nb_reglements} règlements)` : `${c.nb_reglements} règlement(s), cadence non établie`}</dd>
          <dt>Dernier règlement</dt><dd>{formatDate(c.dernier_reglement)}{c.jours_sans_reglement !== null ? ` — ${c.jours_sans_reglement} jours` : ""}</dd>
          <dt>Statut recouvrement</dt><dd>{c.statut}{c.prochaine_echeance ? ` — prochaine échéance ${formatDate(c.prochaine_echeance)}` : ""}</dd>
          <dt>Score de risque</dt><dd>{c.score}/100</dd>
          {c.limite_credit ? <><dt>Limite de crédit</dt><dd>{fmt(c.limite_credit)} F {c.limite_depassee ? "— DÉPASSÉE" : ""}</dd></> : null}
        </dl>
        {(actions ?? []).length > 0 && <>
          <h3 style={{ marginTop: 10 }}>Dernières actions de recouvrement</h3>
          <ul style={{ paddingLeft: 18 }}>{((actions ?? []) as Action[]).map((a) => <li key={a.id}>{formatDate(a.date_action)} — {LIBELLES_TYPE_ACTION[a.type]}{a.montant ? ` ${fmt(a.montant)} F` : ""}{a.echeance ? ` (échéance ${formatDate(a.echeance)})` : ""} — {a.statut}{a.resultat ? ` : ${a.resultat}` : ""} — {a.auteur}</li>)}</ul>
        </>}
      </section>
      <div className="pied">{s.nom} — {s.adresse} — NIF {s.nif} — Document généré le {formatDate(new Date().toISOString())} à partir des données Sage du {formatDate(dateArrete)} (lecture seule).</div>
    </div>
  );
}
