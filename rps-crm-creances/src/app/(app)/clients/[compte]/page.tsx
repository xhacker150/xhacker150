import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { exigerProfil, extractionActive, peutRecouvrer, peutPointer, lireParametres } from "@/lib/session";
import { fmt, fmtF, formatDate, formatDateHeure, libelleMois, aujourdhui, lienWhatsApp, TYPOLOGIES, LIBELLES_TYPE_ACTION, LIBELLES_CANAL } from "@/lib/format";
import { Badge, BadgeStatut, Score } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import { creerAction, fermerAction, enregistrerMessage, enregistrerClientExt, qualifierReglement } from "../actions";
import type { VueClient, Ecriture, Livraison, Action, Contact, ModeleMessage } from "@/lib/types";

type SP = { succes?: string; erreur?: string; onglet?: string; modele?: string };

export default async function PageFicheClient({ params, searchParams }: { params: Promise<{ compte: string }>; searchParams: Promise<SP> }) {
  const { compte } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ profil }, extraction, parametres] = await Promise.all([exigerProfil(), extractionActive(), lireParametres()]);
  const [{ data: client }, { data: ecritures }, { data: facturation }, { data: livraisons }, { data: actions }, { data: messages }, { data: agents }, { data: modeles }, { data: plans }, { data: docs }] = await Promise.all([
    supabase.from("vue_clients").select("*").eq("compte", compte).maybeSingle(),
    supabase.from("vue_ecritures").select("*").eq("compte", compte).order("date_ecriture").order("ordre"),
    supabase.from("vue_facturation").select("mois, ht").eq("compte", compte).order("mois"),
    supabase.from("vue_livraisons").select("*").eq("compte", compte).order("date_livraison", { ascending: false }).order("ordre", { ascending: false }).limit(300),
    supabase.from("actions").select("*").eq("compte", compte).order("cree_le", { ascending: false }),
    supabase.from("messages_sortants").select("*").eq("compte", compte).order("envoye_le", { ascending: false }).limit(50),
    supabase.from("profils").select("id, nom").eq("actif", true).order("nom"),
    supabase.from("modeles_messages").select("*").order("niveau"),
    supabase.from("plans_echeances").select("*, actions!inner(compte, statut)").eq("actions.compte", compte).order("echeance"),
    supabase.from("documents").select("*").eq("compte", compte).order("genere_le", { ascending: false }).limit(10),
  ]);
  if (!client) notFound();
  const c = client as VueClient;
  await supabase.rpc("journaliser", { p_quoi: "consultation_fiche", p_compte: compte });

  const ecr = (ecritures ?? []) as Ecriture[];
  const regls = ecr.filter((e) => e.est_reglement);
  const debits = ecr.filter((e) => e.journal !== "RAN" && e.sens === 0);
  const rans = ecr.filter((e) => e.journal === "RAN");
  const livr = (livraisons ?? []) as Livraison[];
  const acts = (actions ?? []) as Action[];
  const ouvertes = acts.filter((a) => a.statut === "ouverte");
  const contacts = (c.contacts ?? []) as Contact[];
  const droitReco = peutRecouvrer(profil.role);
  const droitPointage = peutPointer(profil.role);
  const modeleChoisi = ((modeles ?? []) as ModeleMessage[]).find((m) => m.code === (sp.modele ?? ""));
  let texteMessage = "";
  if (modeleChoisi) {
    const { data } = await supabase.rpc("rendre_message", { p_code: modeleChoisi.code, p_compte: compte });
    texteMessage = data ?? "";
  }
  const telWhatsApp = contacts.find((k) => k.whatsapp)?.whatsapp ?? contacts.find((k) => k.tel)?.tel ?? null;
  const onglet = sp.onglet ?? "synthese";
  const mensuel = (facturation ?? []) as { mois: string; ht: number }[];
  const litresMois = new Map<string, number>();
  for (const l of livr) litresMois.set(l.date_livraison.slice(0, 7), (litresMois.get(l.date_livraison.slice(0, 7)) ?? 0) + Number(l.qte));

  // Chronologie unifiée : règlements, RAN, débits, actions, messages, documents
  type Ev = { date: string; classe: string; titre: string; detail?: string; cle: string };
  const timeline: Ev[] = [
    ...acts.map((a) => ({ date: a.cree_le, classe: a.type === "contentieux" ? "rouge" : a.type === "promesse" || a.type === "plan" ? "or" : a.statut === "fermee" ? "gris" : "bleu", cle: "a" + a.id,
      titre: `${LIBELLES_TYPE_ACTION[a.type]}${a.niveau ? ` N${a.niveau}` : ""}${a.montant ? ` — ${fmtF(a.montant)}` : ""}${a.echeance ? ` (échéance ${formatDate(a.echeance)})` : ""} · ${a.statut === "ouverte" ? "ouverte" : `close${a.resultat ? ` : ${a.resultat}` : ""}`}`,
      detail: `${a.note ?? ""}${a.ferme_motif ? ` — ${a.ferme_motif}` : ""}${a.reglee_par_piece ? ` (pièce ${a.reglee_par_piece})` : ""} — ${a.auteur}` })),
    ...(messages ?? []).map((m) => ({ date: m.envoye_le as string, classe: "bleu", cle: "m" + m.id, titre: `Message ${LIBELLES_CANAL[m.canal] ?? m.canal}${m.modele ? ` (${m.modele})` : ""} → ${m.destinataire ?? "—"}`, detail: `${String(m.contenu).slice(0, 140)}… — ${m.envoye_par_nom ?? ""}` })),
    ...regls.map((e) => ({ date: e.date_ecriture, classe: "vert", cle: "r" + e.ordre, titre: `Règlement ${fmtF(e.montant)} — ${e.journal} ${e.piece ?? ""}`, detail: `${e.intitule ?? ""}${e.payeur ? ` · payeur : ${e.payeur}` : ""}${e.lien ? ` · ${e.lien}` : ""}` })),
    ...debits.map((e) => ({ date: e.date_ecriture, classe: "rouge", cle: "d" + e.ordre, titre: `Débit hors RAN ${fmtF(e.montant)} — ${e.journal} ${e.piece ?? ""}`, detail: e.intitule ?? "" })),
    ...rans.map((e) => ({ date: e.date_ecriture, classe: "gris", cle: "n" + e.ordre, titre: `RAN ${e.sens === 0 ? "débiteur" : "créditeur"} ${fmtF(e.montant)}`, detail: e.intitule ?? "" })),
    ...(docs ?? []).map((d) => ({ date: d.genere_le as string, classe: "gris", cle: "doc" + d.id, titre: `Document ${d.type} arrêté au ${formatDate(d.date_arrete)}`, detail: d.chemin_ged ?? "" })),
  ].sort((x, y) => (x.date < y.date ? 1 : -1));

  return (
    <>
      <div className="fh">
        <h2>{c.intitule}</h2>
        <Badge classe="bleu">{c.compte}</Badge>
        <BadgeStatut statut={c.statut} detail={c.statut === "promesse" && c.prochaine_echeance ? formatDate(c.prochaine_echeance, true) : undefined} />
        <Badge classe="gris" title={c.typologie_manuelle ? "Typologie fixée à la main" : `Typologie automatique (${c.typologie_auto})`}>{c.typologie}{c.typologie_manuelle ? " ✎" : ""}</Badge>
        <Score score={c.score} />
        {c.cadence_jours ? <span className="muted">règle tous les ~{c.cadence_jours} j — alerte décrochage à {c.seuil_alerte_jours} j</span> : <span className="muted">cadence non établie — filet générique {c.seuil_alerte_jours} j</span>}
        <span style={{ flex: 1 }} />
        <Link className="btn bl" href={`/clients/${compte}/situation`} target="_blank">📄 Situation officielle</Link>
        <Link className="btn" href="/clients">✕ Fermer</Link>
      </div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      {c.limite_depassee && <div className="warn">Limite de crédit dépassée : solde {fmtF(c.solde)} pour une limite de {fmtF(c.limite_credit)} — blocage recommandé, décision DG.</div>}
      {c.promesse_echue && <div className="warn">⚠ Promesse de paiement échue non tenue.</div>}
      {Number(c.solde) < -1000 && <div className="ok">Client créditeur (avance {fmtF(-Number(c.solde))}) : relance interdite, priorité de service.</div>}

      <div className="tuiles">
        <div className="tuile"><div className="l">Report à nouveau</div><div className="v" style={{ fontSize: 15 }}>{fmtF(c.ran)}</div><div className="d">{rans.length ? `journal RAN (${rans.map((r) => formatDate(r.date_ecriture, true)).join(", ")})` : "aucun RAN"}</div></div>
        <div className="tuile b"><div className="l">Facturé exercice</div><div className="v" style={{ fontSize: 15 }}>{fmtF(c.facture_exercice)}</div><div className="d">{c.litres_exercice ? `${fmt(c.litres_exercice)} litres · ` : ""}dernière facture {formatDate(c.derniere_facture, true)}</div></div>
        <div className="tuile v2"><div className="l">Réglé</div><div className="v" style={{ fontSize: 15 }}>{fmtF(c.regle)}</div><div className="d">{c.nb_reglements} règlement(s) · dernier {formatDate(c.dernier_reglement, true)}{c.jours_sans_reglement !== null ? ` (${c.jours_sans_reglement} j)` : ""}</div></div>
        {Number(c.debits_hors_ran) > 0 && <div className="tuile r"><div className="l">Dépenses payées pour le client</div><div className="v" style={{ fontSize: 15 }}>{fmtF(c.debits_hors_ran)}</div><div className="d">débits hors RAN, ajoutés à la dette</div></div>}
        <div className={`tuile ${Number(c.solde) > 1000 ? "r" : "v2"}`}><div className="l">{Number(c.solde) >= 0 ? "Solde dû" : "Avance"}</div><div className="v" style={{ fontSize: 15 }}>{fmtF(Math.abs(Number(c.solde)))}</div><div className="d">au {formatDate(extraction?.date_extraction)} · segment {c.segment_encours}</div></div>
        {c.limite_credit ? <div className={`tuile ${c.limite_depassee ? "r" : ""}`}><div className="l">Limite de crédit</div><div className="v" style={{ fontSize: 15 }}>{fmtF(c.limite_credit)}</div><div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${Math.min(100, Math.round((100 * Number(c.solde)) / Number(c.limite_credit)))}%`, background: c.limite_depassee ? "var(--rouge)" : undefined }} /></div></div> : null}
      </div>

      <nav className="onglets" style={{ position: "static", marginBottom: 12, borderRadius: 8 }}>
        {[["synthese", "Synthèse"], ["reglements", `Règlements (${regls.length})`], ["livraisons", `Livraisons (${livr.length})`], ["timeline", `Chronologie (${timeline.length})`], ["messages", "Messages"], ["fiche", "Fiche & contacts"]].map(([k, l]) => (
          <Link key={k} href={`/clients/${compte}?onglet=${k}`} className={onglet === k ? "on" : ""}>{l}</Link>
        ))}
      </nav>

      {onglet === "synthese" && (
        <div className="grid2">
          <div className="card">
            <h3>Facturation par mois</h3>
            <div className="tbl"><table>
              <thead><tr><th>Mois</th><th className="num">Litres</th><th className="num">Montant HT (F)</th></tr></thead>
              <tbody>
                {mensuel.map((m) => <tr key={m.mois}><td>{libelleMois(m.mois)}{extraction?.saisi_jusquau && m.mois === extraction.saisi_jusquau.slice(0, 7) ? <span className="muted"> (saisi jusqu&apos;au {formatDate(extraction.saisi_jusquau, true)})</span> : ""}</td><td className="num">{fmt(litresMois.get(m.mois) ?? 0)}</td><td className="num">{fmt(m.ht)}</td></tr>)}
                {mensuel.length === 0 && <tr><td colSpan={3} className="muted">Aucune facturation sur la période extraite.</td></tr>}
              </tbody>
              <tfoot><tr><td>TOTAL</td><td className="num">{fmt(c.litres_exercice)}</td><td className="num">{fmt(c.facture)}</td></tr></tfoot>
            </table></div>
          </div>
          <div className="card">
            <h3>Suivi recouvrement <small>{ouvertes.length} action(s) ouverte(s)</small></h3>
            {ouvertes.length === 0 && <p className="muted">Aucune action ouverte.</p>}
            {ouvertes.map((a) => (
              <div key={a.id} className={`kcard ${a.type === "contentieux" ? "rouge" : a.type === "promesse" || a.type === "plan" ? "or" : ""}`}>
                <b>{LIBELLES_TYPE_ACTION[a.type]}{a.niveau ? ` — niveau N${a.niveau}` : ""}{a.montant ? ` — ${fmtF(a.montant)}` : ""}{a.echeance ? ` — échéance ${formatDate(a.echeance)}` : ""}</b>
                <span className="muted">{formatDate(a.date_action)} · {a.auteur}{a.canal ? ` · ${LIBELLES_CANAL[a.canal]}` : ""}</span>
                {a.note && <div>{a.note}</div>}
                {a.type === "plan" && (plans ?? []).filter((p) => p.action_id === a.id).map((p) => (
                  <div key={p.id} className="muted">échéance {formatDate(p.echeance)} : {fmtF(p.montant)} {p.tenue ? "✔" : ""}</div>
                ))}
                {droitReco && (
                  <form action={fermerAction.bind(null, compte, a.id)} className="frm">
                    {a.type === "promesse" && <select name="resultat" defaultValue="tenue"><option value="tenue">Tenue</option><option value="non_tenue">Non tenue</option><option value="annulee">Annulée</option></select>}
                    <input name="motif" placeholder="Motif de clôture" style={{ flex: 1 }} />
                    <button className="btn sm" type="submit">✔ Clore</button>
                  </form>
                )}
              </div>
            ))}
            {droitReco && Number(c.solde) > -1000 && (
              <details className="mt">
                <summary className="btn pr">+ Nouvelle action</summary>
                <form action={creerAction.bind(null, compte)} className="frm" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div className="frm">
                    <label className="ch">Type<select name="type" defaultValue="relance">
                      <option value="relance">Relance (notée)</option><option value="appel">Appel à passer</option><option value="promesse">Promesse de paiement</option><option value="plan">Plan de paiement</option><option value="tache">Tâche</option><option value="note">Note</option>
                      {profil.role === "dg" && <option value="contentieux">Contentieux (DG)</option>}
                    </select></label>
                    <label className="ch">Niveau<select name="niveau" defaultValue={String(c.niveau_suggere ?? "")}><option value="">—</option><option value="1">N1 préventif</option><option value="2">N2 amiable</option><option value="3">N3 ferme</option><option value="4">N4 pré-contentieux</option></select></label>
                    <label className="ch">Canal<select name="canal" defaultValue="telephone"><option value="">—</option>{Object.entries(LIBELLES_CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label className="ch">Date<input type="date" name="date_action" defaultValue={aujourdhui()} /></label>
                    <label className="ch">Montant promis<input type="number" name="montant" min={0} step={1} placeholder={`≥ ${fmt(Number(c.solde) * parametres.seuils.promesse_part_min / 100)}`} /></label>
                    <label className="ch">Échéance<input type="date" name="echeance" /></label>
                    <label className="ch">Assigner à<select name="assignee_id" defaultValue=""><option value="">—</option>{(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}</select></label>
                  </div>
                  <details><summary className="muted">Plan de paiement : échéances (jusqu&apos;à 6)</summary>
                    <div className="frm">{[1, 2, 3, 4, 5, 6].map((i) => <span key={i} style={{ display: "inline-flex", gap: 4 }}><input type="date" name={`plan_echeance_${i}`} /><input type="number" name={`plan_montant_${i}`} placeholder="montant" style={{ width: 120 }} /></span>)}</div>
                  </details>
                  <textarea name="note" rows={2} placeholder="Note : qui, quoi, engagement obtenu… (la preuve de tout)" />
                  <div><button className="btn pr" type="submit">Enregistrer</button> <span className="muted">Une promesse doit couvrir au moins {parametres.seuils.promesse_part_min} % du solde, sinon enregistrez un plan.</span></div>
                </form>
              </details>
            )}
          </div>
        </div>
      )}

      {onglet === "reglements" && (
        <div className="card p0">
          <h3>Règlements — un à un <small>date, journal, pièce, référence · jamais de somme mensuelle</small></h3>
          <div className="tbl"><table>
            <thead><tr><th>Date</th><th>Journal</th><th>Pièce</th><th>Référence</th><th>Libellé</th><th>Payeur / lien</th><th className="num">Montant (F)</th>{droitPointage && <th>Qualifier</th>}</tr></thead>
            <tbody>
              {regls.length === 0 && <tr><td colSpan={8} className="muted">Aucun règlement sur la période extraite.</td></tr>}
              {regls.map((e) => (
                <tr key={e.ordre}>
                  <td>{formatDate(e.date_ecriture)}</td><td>{e.journal}</td><td>{e.piece}</td><td>{e.ref_piece}</td><td className="muted" style={{ maxWidth: 260 }}>{e.intitule}</td>
                  <td>{e.payeur && <Badge classe="bleu">{e.payeur}</Badge>} {e.lien && <Badge classe="or" title={e.lien_note ?? ""}>{e.lien === "multi_clients" ? "remise multi-clients" : e.lien === "regle_via" ? `réglé via ${e.compte_lie ?? ""}` : "régularisation"}{e.piece_liee ? ` → ${e.piece_liee}` : ""}</Badge>}</td>
                  <td className="num"><b>{fmt(e.montant)}</b></td>
                  {droitPointage && <td>
                    <details><summary className="btn sm">✎</summary>
                      <form action={qualifierReglement.bind(null, compte)} className="frm" style={{ flexDirection: "column", alignItems: "stretch", minWidth: 220 }}>
                        <input type="hidden" name="piece" value={e.piece ?? ""} />
                        <input name="payeur" placeholder="Payeur (compte collectif)" defaultValue={e.payeur ?? ""} />
                        <select name="lien" defaultValue=""><option value="">— lien —</option><option value="multi_clients">Remise multi-clients</option><option value="regle_via">Réglé via un autre client</option><option value="regularise">Régularisation d&apos;un règlement</option></select>
                        <input name="piece_liee" placeholder="Pièce liée" /><input name="compte_lie" placeholder="Compte lié (411…)" /><input name="note" placeholder="Note" />
                        <button className="btn sm bl" type="submit">Enregistrer</button>
                      </form>
                    </details>
                  </td>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={6}>TOTAL RÉGLÉ ({regls.length})</td><td className="num">{fmt(c.regle)}</td>{droitPointage && <td />}</tr></tfoot>
          </table></div>
          {(debits.length > 0 || rans.length > 0) && (
            <>
              <h3 style={{ padding: "12px 14px 0" }}>Autres écritures (RAN, dépenses payées pour le client)</h3>
              <div className="tbl"><table>
                <thead><tr><th>Date</th><th>Journal</th><th>Pièce</th><th>Libellé</th><th>Sens</th><th className="num">Montant (F)</th></tr></thead>
                <tbody>{[...rans, ...debits].map((e) => <tr key={e.ordre}><td>{formatDate(e.date_ecriture)}</td><td>{e.journal}</td><td>{e.piece}</td><td className="muted">{e.intitule}</td><td>{e.sens === 0 ? "débit" : "crédit"}</td><td className="num">{fmt(e.montant)}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </div>
      )}

      {onglet === "livraisons" && (
        <div className="card p0">
          <h3>Livraisons <small>{livr.length} lignes les plus récentes · le numéro de station fait foi</small></h3>
          <div className="tbl" style={{ maxHeight: "65vh", overflow: "auto" }}><table>
            <thead><tr><th>Date</th><th>Pièce</th><th>Produit</th><th>Bon / camion</th><th className="num">Litres</th><th className="num">Montant HT</th><th>Station</th></tr></thead>
            <tbody>{livr.map((l, i) => <tr key={i}><td>{formatDate(l.date_livraison)}</td><td>{l.piece}</td><td>{l.ar_ref}</td><td>{l.designation}</td><td className="num">{fmt(l.qte)}</td><td className="num">{fmt(l.montant_ht)}</td><td>{l.station ?? l.depot}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}

      {onglet === "timeline" && (
        <div className="card">
          <h3>Chronologie unifiée <small>factures, règlements, relances, promesses, messages, documents — datés et signés</small></h3>
          <div className="tl">
            {timeline.map((ev) => (
              <div key={ev.cle} className={`ev ${ev.classe}`}><b>{ev.date.length > 10 ? formatDateHeure(ev.date) : formatDate(ev.date)}</b> — {ev.titre}{ev.detail && <div className="muted">{ev.detail}</div>}</div>
            ))}
          </div>
        </div>
      )}

      {onglet === "messages" && (
        <div className="grid2">
          <div className="card">
            <h3>Envoyer un message à la charte</h3>
            <form method="get" className="frm">
              <input type="hidden" name="onglet" value="messages" />
              <select name="modele" defaultValue={sp.modele ?? ""}><option value="">— choisir un modèle —</option>{((modeles ?? []) as ModeleMessage[]).map((m) => <option key={m.code} value={m.code}>{m.libelle}{m.valide_par_dg ? "" : " (non validé DG)"}</option>)}</select>
              <button className="btn" type="submit">Préparer</button>
            </form>
            {droitReco ? (
              <form action={enregistrerMessage.bind(null, compte)} className="frm" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <input type="hidden" name="modele" value={modeleChoisi?.code ?? ""} />
                <input type="hidden" name="niveau" value={modeleChoisi?.niveau ?? ""} />
                <div className="frm">
                  <label className="ch">Canal<select name="canal" defaultValue={modeleChoisi?.canal ?? "whatsapp"}>{Object.entries(LIBELLES_CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label className="ch">Destinataire<input name="destinataire" defaultValue={telWhatsApp ?? contacts[0]?.email ?? ""} placeholder="numéro ou e-mail" /></label>
                  <label className="ch" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name="creer_relance" value="1" defaultChecked /> tracer comme relance</label>
                </div>
                <textarea name="contenu" rows={12} defaultValue={texteMessage} placeholder="Choisissez un modèle ou rédigez le message. Aucun chiffre d'un autre client ne doit y figurer." />
                <div className="actions-inline">
                  <button className="btn pr" type="submit">Enregistrer l&apos;envoi dans la chronologie</button>
                  {telWhatsApp && texteMessage && <a className="btn wa" href={lienWhatsApp(telWhatsApp, texteMessage) ?? "#"} target="_blank" rel="noreferrer">Ouvrir dans WhatsApp</a>}
                </div>
                {modeleChoisi && !modeleChoisi.valide_par_dg && <div className="note">Ce modèle n&apos;a pas encore été validé par le DG : envoi manuel uniquement, pas de séquence automatique.</div>}
              </form>
            ) : <p className="muted">Lecture seule : votre rôle ne permet pas d&apos;envoyer des messages.</p>}
          </div>
          <div className="card">
            <h3>Messages envoyés ({(messages ?? []).length})</h3>
            {(messages ?? []).map((m) => <div key={m.id} className="kcard"><b>{formatDateHeure(m.envoye_le)} · {LIBELLES_CANAL[m.canal] ?? m.canal} → {m.destinataire ?? "—"} · {m.envoye_par_nom}</b><div className="pre" style={{ marginTop: 4 }}>{m.contenu}</div></div>)}
            {(messages ?? []).length === 0 && <p className="muted">Aucun message tracé.</p>}
          </div>
        </div>
      )}

      {onglet === "fiche" && (
        <form action={enregistrerClientExt.bind(null, compte)} className="card">
          <h3>Fiche et contacts <small>extension du référentiel Sage — jamais de soldes ici</small></h3>
          <div className="frm">
            <label className="ch">Typologie (vide = automatique : {c.typologie_auto})<select name="typologie" defaultValue={c.typologie_manuelle ? c.typologie : ""} disabled={!droitReco}><option value="">Automatique</option>{TYPOLOGIES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="ch">Limite de crédit (F, fixée par le DG)<input type="number" name="limite_credit" defaultValue={c.limite_credit ?? ""} min={0} step={1} disabled={profil.role !== "dg"} /></label>
            <label className="ch">Chargé de compte<select name="interlocuteur_id" defaultValue={c.interlocuteur_id ?? ""} disabled={!droitReco}><option value="">—</option>{(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}</select></label>
            <label className="ch">Zone<input name="segment_zone" defaultValue={c.segment_zone ?? ""} disabled={!droitReco} /></label>
            <label className="ch">Catégorie<select name="categorie" defaultValue={c.categorie ?? ""} disabled={!droitReco}><option value="">—</option>{["société", "transporteur", "BV", "administration", "ONG / projet", "particulier"].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          </div>
          <h3 className="mt">Contacts (téléphone, WhatsApp)</h3>
          {[1, 2, 3, 4].map((i) => {
            const k = contacts[i - 1] ?? {};
            return (
              <div className="frm" key={i}>
                <input name={`contact_nom_${i}`} placeholder="Nom" defaultValue={k.nom ?? ""} disabled={!droitReco} />
                <input name={`contact_role_${i}`} placeholder="Fonction" defaultValue={k.role ?? ""} disabled={!droitReco} />
                <input name={`contact_tel_${i}`} placeholder="Téléphone" defaultValue={k.tel ?? ""} disabled={!droitReco} />
                <input name={`contact_whatsapp_${i}`} placeholder="WhatsApp" defaultValue={k.whatsapp ?? ""} disabled={!droitReco} />
                <input name={`contact_email_${i}`} placeholder="E-mail" defaultValue={k.email ?? ""} disabled={!droitReco} />
              </div>
            );
          })}
          <label className="ch mt">Notes d&apos;équipe<textarea name="notes" rows={3} defaultValue={c.notes ?? ""} disabled={!droitReco} /></label>
          {droitReco && <div className="mt"><button className="btn pr" type="submit">Enregistrer la fiche</button></div>}
          <div className="note">Typologie automatique d&apos;après le comportement réel : {c.typologie_auto}. Cadence : {c.cadence_jours ?? "—"} j (médiane des intervalles entre règlements), alerte à {c.seuil_alerte_jours} j. Part mobile money : {c.part_mobile_money} %. Promesses tenues : {c.nb_tenues ?? 0}/{c.nb_total ?? 0}, rompues : {c.nb_promesses_rompues}.</div>
        </form>
      )}
      <div className="note">Solde économique = report à nouveau + facturation gescom (+ dépenses payées pour le client) − règlements encaissés. Données : extraction du pont Sage du {formatDate(extraction?.date_extraction)} (lecture seule).</div>
    </>
  );
}
