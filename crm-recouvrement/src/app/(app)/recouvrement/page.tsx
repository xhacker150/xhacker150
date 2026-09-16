import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { emailActif } from "@/lib/email";
import { formatMontant, formatDate, formatDateHeure, aujourdhui, LIBELLES_TYPE_ACTION, LIBELLES_CANAL } from "@/lib/format";
import { Badge, BadgeStatutAction, BadgeStatutPromesse } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import { genererRelances, creerAction, effectuerAction, annulerAction, envoyerActionEmail, changerStatutPromesse, creerPromesse } from "./actions";

type SP = { onglet?: string; statut?: string; type?: string; client_id?: string; facture_id?: string; nouvelle?: string; succes?: string; erreur?: string; periode?: string };

export default async function PageRecouvrement({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const onglet = sp.onglet ?? "actions";
  const supabase = await createClient();
  const parametres = await lireParametres();
  const devise = parametres.facturation.devise;
  const today = aujourdhui();

  const { data: clients } = await supabase.from("clients").select("id, code, raison_sociale").order("raison_sociale");
  const nouvelle = sp.nouvelle === "1";
  let facturesClient: { id: string; numero: string; reste_a_payer: number }[] = [];
  if (nouvelle && sp.client_id) {
    const { data } = await supabase.from("vue_factures").select("id, numero, reste_a_payer").eq("client_id", sp.client_id).in("statut", ["emise", "partiellement_payee"]).order("date_echeance");
    facturesClient = data ?? [];
  }

  // Onglet actions
  const statut = sp.statut ?? "planifiee";
  let reqActions = supabase
    .from("actions_recouvrement")
    .select("*, clients(id, raison_sociale, email, telephone), factures(id, numero, montant_ttc, montant_regle), profils(nom)")
    .order("date_prevue", { ascending: statut === "planifiee" })
    .order("cree_le", { ascending: false })
    .limit(200);
  if (statut !== "toutes") reqActions = reqActions.eq("statut", statut);
  if (sp.type) reqActions = reqActions.eq("type", sp.type);
  if (sp.client_id && !nouvelle) reqActions = reqActions.eq("client_id", sp.client_id);
  if (sp.periode === "jour") reqActions = reqActions.lte("date_prevue", today);
  if (sp.periode === "semaine") reqActions = reqActions.lte("date_prevue", new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const { data: actions } = onglet === "actions" ? await reqActions : { data: [] };

  const { data: promesses } = onglet === "promesses"
    ? await supabase.from("promesses_paiement").select("*, clients(id, raison_sociale), factures(id, numero)").order("statut").order("date_promise").limit(200)
    : { data: [] };
  const { data: litiges } = onglet === "litiges"
    ? await supabase.from("litiges").select("*, clients(id, raison_sociale), factures(id, numero, montant_ttc)").order("statut").order("ouvert_le", { ascending: false }).limit(200)
    : { data: [] };

  return (
    <>
      <div className="entete">
        <div>
          <h1>Recouvrement</h1>
          <p>Agenda des relances, promesses de paiement et litiges. Le moteur tourne chaque matin (cron Vercel) ; vous pouvez le lancer manuellement.</p>
        </div>
        <div className="actions">
          <Link href={`/recouvrement?nouvelle=1${sp.client_id ? `&client_id=${sp.client_id}` : ""}`} className="btn">+ Action manuelle</Link>
          <form action={genererRelances}><button className="btn primary" type="submit">▶ Générer les relances du jour</button></form>
        </div>
      </div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      {!emailActif() && <div className="alerte info non-imprimable">Envoi automatique des e-mails non configuré (variable RESEND_API_KEY). Les relances e-mail apparaissent dans l&apos;agenda pour envoi manuel.</div>}

      {nouvelle && (
        <div className="carte">
          <h2>Nouvelle action de recouvrement</h2>
          <form action={creerAction} className="form">
            <div className="ligne ligne-3">
              <div className="champ">
                <label>Client *</label>
                <select name="client_id" required defaultValue={sp.client_id ?? ""}>
                  <option value="">— Sélectionner —</option>
                  {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.raison_sociale}</option>)}
                </select>
                {!sp.client_id && <span className="aide">Pour rattacher une facture, ouvrez ce formulaire depuis la fiche client ou la facture.</span>}
              </div>
              <div className="champ">
                <label>Facture concernée</label>
                <select name="facture_id" defaultValue={sp.facture_id ?? ""}>
                  <option value="">— Aucune / toutes —</option>
                  {facturesClient.map((f) => <option key={f.id} value={f.id}>{f.numero} · reste {formatMontant(f.reste_a_payer, devise)}</option>)}
                </select>
              </div>
              <div className="champ">
                <label>Type *</label>
                <select name="type" defaultValue="appel">{Object.entries(LIBELLES_TYPE_ACTION).filter(([k]) => !["relance", "litige", "promesse"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
            </div>
            <div className="ligne ligne-3">
              <div className="champ"><label>Date prévue *</label><input type="date" name="date_prevue" required defaultValue={today} /></div>
              <div className="champ" style={{ gridColumn: "span 2" }}><label>Objet *</label><input name="sujet" required placeholder="Ex : Appel pour obtenir une date de règlement" /></div>
            </div>
            <div className="champ"><label>Contenu / consignes</label><textarea name="contenu" rows={3} /></div>
            <label className="champ inline"><input type="checkbox" name="effectuee" value="1" /> Déjà effectuée (simple enregistrement dans l&apos;historique)</label>
            <div className="pied"><Link href="/recouvrement" className="btn">Annuler</Link><button className="btn primary" type="submit">Enregistrer</button></div>
          </form>
        </div>
      )}

      <div className="onglets">
        <Link href="/recouvrement?onglet=actions" className={onglet === "actions" ? "actif" : ""}>Agenda des actions</Link>
        <Link href="/recouvrement?onglet=promesses" className={onglet === "promesses" ? "actif" : ""}>Promesses de paiement</Link>
        <Link href="/recouvrement?onglet=litiges" className={onglet === "litiges" ? "actif" : ""}>Litiges</Link>
      </div>

      {onglet === "actions" && (
        <div className="carte">
          <form className="filtres" method="get">
            <input type="hidden" name="onglet" value="actions" />
            <div className="champ"><label>Statut</label><select name="statut" defaultValue={statut}><option value="planifiee">À faire</option><option value="effectuee">Effectuées</option><option value="annulee">Annulées</option><option value="toutes">Toutes</option></select></div>
            <div className="champ"><label>Type</label><select name="type" defaultValue={sp.type ?? ""}><option value="">Tous</option>{Object.entries(LIBELLES_TYPE_ACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="champ"><label>Échéance</label><select name="periode" defaultValue={sp.periode ?? ""}><option value="">Toutes</option><option value="jour">Aujourd&apos;hui et en retard</option><option value="semaine">7 prochains jours</option></select></div>
            <div className="champ"><label>Client</label><select name="client_id" defaultValue={sp.client_id ?? ""}><option value="">Tous</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.raison_sociale}</option>)}</select></div>
            <button className="btn" type="submit">Filtrer</button>
          </form>
          <div className="tableau-conteneur">
            <table className="tableau">
              <thead><tr><th>Date</th><th>Client</th><th>Action</th><th>Facture</th><th>Statut</th><th className="actions">Traitement</th></tr></thead>
              <tbody>
                {(actions ?? []).length === 0 && <tr><td colSpan={6} className="vide">Aucune action.</td></tr>}
                {(actions ?? []).map((a) => {
                  const client = a.clients as unknown as { id: string; raison_sociale: string; email: string | null; telephone: string | null } | null;
                  const facture = a.factures as unknown as { id: string; numero: string; montant_ttc: number; montant_regle: number } | null;
                  const agent = a.profils as unknown as { nom: string } | null;
                  const enRetard = a.statut === "planifiee" && a.date_prevue < today;
                  return (
                    <tr key={a.id}>
                      <td style={{ color: enRetard ? "var(--danger)" : undefined }}>{formatDate(a.date_prevue)}{enRetard && <div className="petit">en retard</div>}{a.date_effectuee && <div className="texte-3 petit">fait {formatDateHeure(a.date_effectuee)}</div>}</td>
                      <td><Link href={`/clients/${client?.id}`}>{client?.raison_sociale}</Link><div className="texte-3 petit">{client?.telephone}<br />{client?.email}</div></td>
                      <td style={{ maxWidth: 420 }}>
                        <Badge ton={a.automatique ? "info" : "neutral"}>{LIBELLES_TYPE_ACTION[a.type] ?? a.type}{a.niveau ? ` N${a.niveau}` : ""}</Badge>{a.canal && a.canal !== a.type && <> <span className="texte-3 petit">{LIBELLES_CANAL[a.canal]}</span></>}
                        <div><strong>{a.sujet}</strong></div>
                        {a.contenu && <details className="petit"><summary className="texte-2">Voir le contenu</summary><pre className="pre">{a.contenu}</pre></details>}
                        {a.resultat && <div className="petit texte-2">→ {a.resultat}</div>}
                        {agent && <div className="texte-3 petit">par {agent.nom}</div>}
                      </td>
                      <td>{facture && <Link href={`/factures/${facture.id}`}>{facture.numero}</Link>}{facture && <div className="texte-3 petit">reste {formatMontant(Number(facture.montant_ttc) - Number(facture.montant_regle), devise)}</div>}</td>
                      <td><BadgeStatutAction statut={a.statut} /></td>
                      <td className="actions">
                        {a.statut === "planifiee" && (
                          <details>
                            <summary className="btn petit primary" style={{ listStyle: "none" }}>Traiter</summary>
                            <form action={effectuerAction.bind(null, a.id)} className="form" style={{ marginTop: 8, textAlign: "left", minWidth: 260 }}>
                              <div className="champ"><label>Résultat / compte-rendu</label><textarea name="resultat" rows={2} /></div>
                              <div className="ligne">
                                <div className="champ"><label>Promesse : montant</label><input type="number" name="promesse_montant" min="0" step="1" /></div>
                                <div className="champ"><label>Promesse : date</label><input type="date" name="promesse_date" /></div>
                              </div>
                              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                {a.canal === "email" && client?.email && <button className="btn petit" formAction={envoyerActionEmail.bind(null, a.id)} type="submit">Envoyer l&apos;e-mail</button>}
                                <button className="btn petit" formAction={annulerAction.bind(null, a.id)} type="submit">Annuler l&apos;action</button>
                                <button className="btn petit success" type="submit">Marquer effectuée</button>
                              </div>
                            </form>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {onglet === "promesses" && (
        <>
          <div className="carte">
            <h2>Enregistrer une promesse de paiement</h2>
            <form action={creerPromesse} className="form">
              <div className="ligne ligne-4">
                <div className="champ"><label>Client *</label><select name="client_id" required defaultValue={sp.client_id ?? ""}><option value="">— Sélectionner —</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.raison_sociale}</option>)}</select></div>
                <div className="champ"><label>Montant *</label><input type="number" name="montant" min="1" step="1" required /></div>
                <div className="champ"><label>Date promise *</label><input type="date" name="date_promise" required /></div>
                <div className="champ"><label>Commentaire</label><input name="commentaire" /></div>
              </div>
              <div className="pied"><button className="btn primary" type="submit">Enregistrer</button></div>
            </form>
          </div>
          <div className="carte">
            <table className="tableau">
              <thead><tr><th>Date promise</th><th>Client</th><th>Facture</th><th className="num">Montant</th><th>Statut</th><th>Commentaire</th><th></th></tr></thead>
              <tbody>
                {(promesses ?? []).length === 0 && <tr><td colSpan={7} className="vide">Aucune promesse.</td></tr>}
                {(promesses ?? []).map((p) => {
                  const client = p.clients as unknown as { id: string; raison_sociale: string } | null;
                  const facture = p.factures as unknown as { id: string; numero: string } | null;
                  return (
                    <tr key={p.id}>
                      <td style={{ color: p.statut === "en_attente" && p.date_promise < today ? "var(--danger)" : undefined }}>{formatDate(p.date_promise)}</td>
                      <td><Link href={`/clients/${client?.id}`}>{client?.raison_sociale}</Link></td>
                      <td>{facture && <Link href={`/factures/${facture.id}`}>{facture.numero}</Link>}</td>
                      <td className="num">{formatMontant(p.montant, devise)}</td>
                      <td><BadgeStatutPromesse statut={p.statut} /></td>
                      <td className="petit">{p.commentaire}</td>
                      <td className="actions">
                        {p.statut === "en_attente" && (
                          <>
                            <form action={changerStatutPromesse.bind(null, p.id, "tenue")} style={{ display: "inline" }}><button className="btn petit success" type="submit">Tenue</button></form>{" "}
                            <form action={changerStatutPromesse.bind(null, p.id, "rompue")} style={{ display: "inline" }}><button className="btn petit danger" type="submit">Rompue</button></form>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {onglet === "litiges" && (
        <div className="carte">
          <p className="texte-2 petit">Un litige s&apos;ouvre depuis la fiche de la facture concernée. Tant qu&apos;il est ouvert, les relances automatiques de cette facture sont suspendues.</p>
          <table className="tableau">
            <thead><tr><th>Ouvert le</th><th>Client</th><th>Facture</th><th>Motif</th><th>Statut</th><th>Résolution</th></tr></thead>
            <tbody>
              {(litiges ?? []).length === 0 && <tr><td colSpan={6} className="vide">Aucun litige.</td></tr>}
              {(litiges ?? []).map((l) => {
                const client = l.clients as unknown as { id: string; raison_sociale: string } | null;
                const facture = l.factures as unknown as { id: string; numero: string; montant_ttc: number } | null;
                return (
                  <tr key={l.id}>
                    <td>{formatDateHeure(l.ouvert_le)}</td>
                    <td><Link href={`/clients/${client?.id}`}>{client?.raison_sociale}</Link></td>
                    <td>{facture && <Link href={`/factures/${facture.id}`}>{facture.numero}</Link>}<div className="texte-3 petit">{formatMontant(facture?.montant_ttc, devise)}</div></td>
                    <td>{l.motif}</td>
                    <td><Badge ton={l.statut === "ouvert" ? "warning" : l.statut === "resolu" ? "success" : "neutral"}>{l.statut === "ouvert" ? "Ouvert" : l.statut === "resolu" ? "Résolu" : "Rejeté"}</Badge></td>
                    <td className="petit">{l.resolution}{l.resolu_le && <div className="texte-3">{formatDateHeure(l.resolu_le)}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
