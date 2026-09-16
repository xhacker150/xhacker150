import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { exigerProfil, extractionActive, peutRecouvrer, lireParametres } from "@/lib/session";
import { fmt, fmtF, formatDate, jours, aujourdhui, LIBELLES_TYPE_ACTION, LIBELLES_CANAL } from "@/lib/format";
import { Badge, Score } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import { creerAction, fermerAction } from "../clients/actions";
import type { VueClient, Action } from "@/lib/types";

type SP = { vue?: string; succes?: string; erreur?: string; interlocuteur?: string; typologie?: string };
const COLONNES: { cle: string; titre: string; classe: string; statuts: string[] }[] = [
  { cle: "a_relancer", titre: "À relancer", classe: "rouge", statuts: ["à relancer"] },
  { cle: "relance", titre: "Relancé", classe: "", statuts: ["relancé"] },
  { cle: "promesse", titre: "Promesse / plan de paiement", classe: "or", statuts: ["promesse", "plan"] },
  { cle: "contentieux", titre: "Contentieux", classe: "rouge", statuts: ["contentieux"] },
];

export default async function PageRecouvrement({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const vue = sp.vue ?? "pipeline";
  const supabase = await createClient();
  const [{ profil }, extraction, parametres] = await Promise.all([exigerProfil(), extractionActive(), lireParametres()]);
  const droit = peutRecouvrer(profil.role);
  let req = supabase.from("vue_clients").select("*").in("statut", ["à relancer", "relancé", "promesse", "plan", "contentieux"]).order("solde", { ascending: false });
  if (sp.interlocuteur) req = req.eq("interlocuteur_id", sp.interlocuteur);
  if (sp.typologie) req = req.eq("typologie", sp.typologie);
  const [{ data: clients }, { data: ouvertes }, { data: agents }] = await Promise.all([
    req,
    supabase.from("actions").select("*").eq("statut", "ouverte").order("echeance", { ascending: true, nullsFirst: false }),
    supabase.from("profils").select("id, nom").eq("actif", true).order("nom"),
  ]);
  const liste = (clients ?? []) as VueClient[];
  const actions = (ouvertes ?? []) as Action[];
  const parCompte = new Map<string, Action[]>();
  for (const a of actions) parCompte.set(a.compte, [...(parCompte.get(a.compte) ?? []), a]);
  const nomClient = new Map(liste.map((c) => [c.compte, c.intitule]));
  const today = aujourdhui();

  const promesses = actions.filter((a) => a.type === "promesse" || a.type === "plan").sort((a, b) => (a.echeance ?? "9") < (b.echeance ?? "9") ? -1 : 1);
  const taches = actions.filter((a) => a.type === "tache" || a.type === "appel").sort((a, b) => (a.echeance ?? "9") < (b.echeance ?? "9") ? -1 : 1);

  return (
    <>
      <h1 className="pg">Recouvrement — {vue === "pipeline" ? "pipeline" : vue === "promesses" ? "promesses et plans" : "tâches"} <span className="muted">données du {formatDate(extraction?.date_extraction)}</span></h1>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="frm" style={{ marginBottom: 12 }}>
        <nav className="onglets" style={{ position: "static", flex: 1, borderRadius: 8 }}>
          <Link href="/recouvrement" className={vue === "pipeline" ? "on" : ""}>Pipeline</Link>
          <Link href="/recouvrement?vue=promesses" className={vue === "promesses" ? "on" : ""}>Promesses ({promesses.length})</Link>
          <Link href="/recouvrement?vue=taches" className={vue === "taches" ? "on" : ""}>Tâches ({taches.length})</Link>
        </nav>
        <form method="get" className="frm" style={{ marginTop: 0 }}>
          <input type="hidden" name="vue" value={vue} />
          <select name="interlocuteur" defaultValue={sp.interlocuteur ?? ""}><option value="">Tous les chargés de compte</option>{(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}</select>
          <button className="btn" type="submit">Filtrer</button>
        </form>
      </div>

      {vue === "pipeline" && (
        <>
          <div className="kgrid">
            {COLONNES.map((col) => {
              const arr = liste.filter((c) => col.statuts.includes(c.statut));
              return (
                <div className="kcol" key={col.cle}>
                  <h4><span>{col.titre} ({arr.length})</span><span>{fmt(arr.reduce((s, c) => s + Number(c.solde), 0))} F</span></h4>
                  {arr.length === 0 && <div className="muted">Rien ici.</div>}
                  {arr.slice(0, 40).map((c) => {
                    const a = (parCompte.get(c.compte) ?? []).find((x) => ["relance", "promesse", "plan", "contentieux"].includes(x.type));
                    const stagne = a ? (jours(a.date_action) ?? 0) > 14 : (c.jours_sans_reglement ?? 0) > 2 * c.seuil_alerte_jours;
                    return (
                      <div key={c.compte} className={`kcard ${col.classe} ${stagne ? "pourri" : ""}`} title={stagne ? "Cette carte stagne" : ""}>
                        <b><Link href={`/clients/${c.compte}`}>{c.intitule}</Link> <Score score={c.score} /></b>
                        <span className="m">{fmtF(c.solde)}</span> <span className="muted">dernier règl. {formatDate(c.dernier_reglement, true)} ({c.jours_sans_reglement === null ? "jamais" : `${c.jours_sans_reglement} j`}) · alerte à {c.seuil_alerte_jours} j</span>
                        <div className="muted">{c.typologie}{c.niveau_suggere ? ` · niveau suggéré N${c.niveau_suggere}` : ""}{c.interlocuteur ? ` · ${c.interlocuteur}` : ""}</div>
                        {a?.note && <div className="muted">« {a.note.slice(0, 70)} » — {a.auteur}, {formatDate(a.date_action, true)}</div>}
                        {a?.type === "promesse" && a.echeance && <div style={{ color: a.echeance < today ? "var(--rouge)" : "var(--or)", fontWeight: "bold", fontSize: 11 }}>{a.echeance < today ? "⚠ promesse échue le" : "promesse de"} {fmtF(a.montant)} {a.echeance < today ? "" : "le"} {formatDate(a.echeance, true)}</div>}
                        {stagne && <div style={{ color: "var(--rouge)", fontSize: 11 }}>⏳ stagne depuis {a ? jours(a.date_action) : c.jours_sans_reglement} j</div>}
                        {droit && (
                          <div className="a">
                            {col.cle === "a_relancer" && (
                              <form action={creerAction.bind(null, c.compte)}>
                                <input type="hidden" name="type" value="relance" /><input type="hidden" name="niveau" value={c.niveau_suggere ?? 2} /><input type="hidden" name="canal" value="telephone" /><input type="hidden" name="retour" value="recouvrement" />
                                <input type="hidden" name="note" value="Relance notée depuis le pipeline" />
                                <button className="btn sm" type="submit">✆ Relancé</button>
                              </form>
                            )}
                            <Link className="btn sm" href={`/clients/${c.compte}?onglet=messages&modele=${c.niveau_suggere && c.niveau_suggere >= 3 ? "relance_ferme" : "relance_amiable"}`}>✉ Message</Link>
                            {col.cle !== "promesse" && (
                              <details style={{ display: "inline-block" }}>
                                <summary className="btn sm">🤝 Promesse</summary>
                                <form action={creerAction.bind(null, c.compte)} className="frm" style={{ background: "#fff", padding: 6, border: "1px solid var(--bord)", borderRadius: 6 }}>
                                  <input type="hidden" name="type" value="promesse" /><input type="hidden" name="retour" value="recouvrement" />
                                  <input type="number" name="montant" placeholder={`≥ ${fmt(Number(c.solde) * parametres.seuils.promesse_part_min / 100)}`} style={{ width: 130 }} required />
                                  <input type="date" name="echeance" required /><input name="note" placeholder="qui a promis, comment" style={{ width: 150 }} />
                                  <button className="btn sm bl" type="submit">OK</button>
                                </form>
                              </details>
                            )}
                            {col.cle !== "contentieux" && profil.role === "dg" && (
                              <form action={creerAction.bind(null, c.compte)}>
                                <input type="hidden" name="type" value="contentieux" /><input type="hidden" name="niveau" value="4" /><input type="hidden" name="retour" value="recouvrement" /><input type="hidden" name="note" value="Passage en contentieux décidé par le DG" />
                                <button className="btn sm" type="submit">⚖ Contentieux</button>
                              </form>
                            )}
                            {a && (
                              <form action={fermerAction.bind(null, c.compte, a.id)}>
                                <input type="hidden" name="retour" value="recouvrement" />
                                {a.type === "promesse" && <input type="hidden" name="resultat" value={a.echeance && a.echeance < today ? "non_tenue" : "tenue"} />}
                                <button className="btn sm" type="submit" title="Clore l'action ouverte">✔ Clore</button>
                              </form>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="note">Entrée automatique dans « À relancer » : solde &gt; {fmt(parametres.seuils.solde_min_relance)} F et pas de règlement depuis plus de 1,5 × la cadence du client (bornée {parametres.seuils.cadence_min_jours}-{parametres.seuils.cadence_max_jours} j ; filet générique {parametres.seuils.jours_generique} j). Une carte sort d&apos;elle-même dès qu&apos;un règlement couvrant arrive dans l&apos;extraction Sage. Une carte qui stagne plus de 14 jours rosit. Séquence : N1 relevé préventif · N2 amiable · N3 ferme (&gt; {parametres.seuils.n3_jours} j, copie DG) · N4 mise en demeure (&gt; {parametres.seuils.n4_jours} j ou 2 promesses non tenues, décision DG).</div>
        </>
      )}

      {vue === "promesses" && (
        <div className="card p0">
          <h3>Promesses et plans de paiement ouverts <small>alimentent la prévision d&apos;encaissement</small></h3>
          <div className="tbl"><table>
            <thead><tr><th>Échéance</th><th>Client</th><th>Type</th><th className="num">Montant</th><th>Engagement</th><th>Par</th><th /></tr></thead>
            <tbody>
              {promesses.length === 0 && <tr><td colSpan={7} className="muted">Aucune promesse ouverte.</td></tr>}
              {promesses.map((a) => (
                <tr key={a.id} style={{ color: a.echeance && a.echeance < today ? "var(--rouge)" : undefined }}>
                  <td>{formatDate(a.echeance)}{a.echeance && a.echeance < today && <b> (échue)</b>}{a.echeance === today && <b> (aujourd&apos;hui)</b>}</td>
                  <td><Link href={`/clients/${a.compte}`}>{nomClient.get(a.compte) ?? a.compte}</Link></td>
                  <td>{LIBELLES_TYPE_ACTION[a.type]}</td><td className="num">{fmt(a.montant)}</td><td className="muted">{a.note}</td><td>{a.auteur}</td>
                  <td>{droit && <form action={fermerAction.bind(null, a.compte, a.id)} className="actions-inline"><input type="hidden" name="retour" value="recouvrement" /><button className="btn sm" name="resultat" value="tenue" type="submit">Tenue</button><button className="btn sm" name="resultat" value="non_tenue" type="submit">Non tenue</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {vue === "taches" && (
        <div className="card p0">
          <h3>Tâches et appels à faire</h3>
          <div className="tbl"><table>
            <thead><tr><th>Pour le</th><th>Client</th><th>Type</th><th>Note</th><th>Canal</th><th>Assigné</th><th>Par</th><th /></tr></thead>
            <tbody>
              {taches.length === 0 && <tr><td colSpan={8} className="muted">Aucune tâche ouverte.</td></tr>}
              {taches.map((a) => (
                <tr key={a.id} style={{ color: a.echeance && a.echeance < today ? "var(--rouge)" : undefined }}>
                  <td>{formatDate(a.echeance)}</td><td><Link href={`/clients/${a.compte}`}>{nomClient.get(a.compte) ?? a.compte}</Link></td><td>{LIBELLES_TYPE_ACTION[a.type]}</td><td>{a.note}</td><td>{a.canal ? LIBELLES_CANAL[a.canal] : ""}</td>
                  <td>{(agents ?? []).find((g) => g.id === a.assignee_id)?.nom ?? "—"}</td><td>{a.auteur}</td>
                  <td>{droit && <form action={fermerAction.bind(null, a.compte, a.id)}><input type="hidden" name="retour" value="recouvrement" /><button className="btn sm" type="submit">✔ Fait</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      <Badge classe="gris">{liste.length} clients dans le pipeline</Badge>
    </>
  );
}
