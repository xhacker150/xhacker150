import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { exigerProfil, lireParametres } from "@/lib/session";
import { LIBELLES_ROLE, LIBELLES_CANAL, formatDateHeure } from "@/lib/format";
import { Messages } from "@/components/Messages";
import { Badge } from "@/components/Badge";
import { enregistrerSeuils, modifierUtilisateur, enregistrerModele, supprimerModele } from "./actions";
import type { Profil, ModeleMessage } from "@/lib/types";

const VARIABLES = "{{client}} {{compte}} {{solde}} {{avance}} {{facture_exercice}} {{regle}} {{dernier_reglement}} {{jours}} {{date}} {{date_donnees}} {{societe}} {{signature}}";

export default async function PageParametres({ searchParams }: { searchParams: Promise<{ onglet?: string; succes?: string; erreur?: string }> }) {
  const sp = await searchParams;
  const onglet = sp.onglet ?? "general";
  const { profil } = await exigerProfil();
  const dg = profil.role === "dg";
  const p = await lireParametres();
  const supabase = await createClient();
  const [{ data: utilisateurs }, { data: modeles }, { data: audit }] = await Promise.all([
    onglet === "utilisateurs" ? supabase.from("profils").select("*").order("nom") : Promise.resolve({ data: [] }),
    onglet === "modeles" ? supabase.from("modeles_messages").select("*").order("niveau", { nullsFirst: false }) : Promise.resolve({ data: [] }),
    onglet === "journal" ? supabase.from("audit").select("*").order("quand", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
  ]);

  return (
    <>
      <h1 className="pg">Paramètres</h1>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      {!dg && <div className="info">Lecture seule : le paramétrage est réservé à la Direction générale.</div>}
      <nav className="onglets" style={{ position: "static", marginBottom: 12, borderRadius: 8 }}>
        {[["general", "Seuils & société"], ["sequences", "Séquences de relance"], ["modeles", "Modèles de messages"], ["utilisateurs", "Utilisateurs"], ["journal", "Journal d'audit"]].map(([k, l]) => (
          <Link key={k} href={`/parametres?onglet=${k}`} className={onglet === k ? "on" : ""}>{l}</Link>
        ))}
      </nav>

      {onglet === "general" && (
        <form action={enregistrerSeuils}>
          <div className="card">
            <h3>Règles de recouvrement (CDC-05 §3.2, §3.4)</h3>
            <div className="frm">
              <label className="ch">Solde minimum pour relancer (F)<input type="number" name="solde_min_relance" defaultValue={p.seuils.solde_min_relance} disabled={!dg} /></label>
              <label className="ch">Filet générique (jours sans règlement)<input type="number" name="jours_generique" defaultValue={p.seuils.jours_generique} disabled={!dg} /></label>
              <label className="ch">Coefficient de cadence<input type="number" step="0.1" name="coef_cadence" defaultValue={p.seuils.coef_cadence} disabled={!dg} /></label>
              <label className="ch">Borne basse (j)<input type="number" name="cadence_min_jours" defaultValue={p.seuils.cadence_min_jours} disabled={!dg} /></label>
              <label className="ch">Borne haute (j)<input type="number" name="cadence_max_jours" defaultValue={p.seuils.cadence_max_jours} disabled={!dg} /></label>
              <label className="ch">Promesse : part minimale du solde (%)<input type="number" name="promesse_part_min" defaultValue={p.seuils.promesse_part_min} disabled={!dg} /></label>
              <label className="ch">N3 ferme au-delà de (j)<input type="number" name="n3_jours" defaultValue={p.seuils.n3_jours} disabled={!dg} /></label>
              <label className="ch">N4 pré-contentieux au-delà de (j)<input type="number" name="n4_jours" defaultValue={p.seuils.n4_jours} disabled={!dg} /></label>
              <label className="ch">Péremption des données (j)<input type="number" name="peremption_donnees_jours" defaultValue={p.seuils.peremption_donnees_jours} disabled={!dg} /></label>
            </div>
            <div className="note">Alerte décrochage = coefficient × médiane des intervalles de règlement du client, bornée entre les deux bornes. Le filet générique s&apos;applique aux clients sans cadence établie (moins de 3 règlements).</div>
          </div>
          <div className="card">
            <h3>Société (documents officiels)</h3>
            <div className="frm">
              <label className="ch">Raison sociale<input name="societe_nom" defaultValue={p.societe.nom} disabled={!dg} /></label>
              <label className="ch">Sigle<input name="societe_sigle" defaultValue={p.societe.sigle} disabled={!dg} /></label>
              <label className="ch">Adresse<input name="societe_adresse" defaultValue={p.societe.adresse} disabled={!dg} /></label>
              <label className="ch">Ville<input name="societe_ville" defaultValue={p.societe.ville} disabled={!dg} /></label>
              <label className="ch">Pays<input name="societe_pays" defaultValue={p.societe.pays} disabled={!dg} /></label>
              <label className="ch">NIF<input name="societe_nif" defaultValue={p.societe.nif} disabled={!dg} /></label>
              <label className="ch">Téléphone<input name="societe_telephone" defaultValue={p.societe.telephone} disabled={!dg} /></label>
              <label className="ch">E-mail<input name="societe_email" defaultValue={p.societe.email} disabled={!dg} /></label>
              <label className="ch">Site<input name="societe_site" defaultValue={p.societe.site} disabled={!dg} /></label>
            </div>
            {dg && <div className="mt"><button className="btn pr" type="submit">Enregistrer et recalculer</button></div>}
          </div>
        </form>
      )}

      {onglet === "sequences" && (
        <div className="card">
          <h3>Séquences de relance (CDC-05 §5.5)</h3>
          <div className="tbl"><table>
            <thead><tr><th>Palier</th><th>Libellé</th><th>Déclencheur</th><th>Ce que fait le CRM</th></tr></thead>
            <tbody>
              <tr><td><b>N1</b></td><td>Préventif : envoi du relevé</td><td>J+3 après facturation du mois</td><td>Modèle « relevé » proposé dans la fiche (WhatsApp / e-mail). Envoi manuel tant que le modèle n&apos;est pas validé par le DG.</td></tr>
              <tr><td><b>N2</b></td><td>Amiable</td><td>Décrochage de cadence individuelle, ou solde &gt; {p.seuils.solde_min_relance} F et &gt; {p.seuils.jours_generique} j</td><td>Entrée automatique dans « À relancer » ; message + tâche d&apos;appel, adaptés à la typologie (grands comptes : relevé et rendez-vous, jamais de petites relances ; fil de l&apos;eau : suivi de dérive seulement).</td></tr>
              <tr><td><b>N3</b></td><td>Ferme</td><td>&gt; {p.seuils.n3_jours} jours</td><td>Courrier de relance à la charte + copie DG (modèle « relance ferme »).</td></tr>
              <tr><td><b>N4</b></td><td>Pré-contentieux</td><td>&gt; {p.seuils.n4_jours} jours ou promesse non tenue 2 fois</td><td>Mise en demeure générée (modèle juridique OHADA) ; passage en contentieux = décision DG dans l&apos;application.</td></tr>
            </tbody>
          </table></div>
          <div className="note">Toute séquence s&apos;arrête seule dès qu&apos;un règlement arrive dans l&apos;extraction Sage (fermeture automatique de la relance ou de la promesse). Aucun envoi automatique sans validation initiale du modèle par le DG. Les clients créditeurs ne sont jamais relancés.</div>
        </div>
      )}

      {onglet === "modeles" && (
        <>
          {((modeles ?? []) as ModeleMessage[]).map((m) => (
            <form key={m.code} action={enregistrerModele.bind(null, m.code)} className="card">
              <h3>{m.libelle} <small>{m.code} · {m.valide_par_dg ? <Badge classe="vert">validé DG</Badge> : <Badge classe="or">non validé</Badge>}</small></h3>
              <div className="frm">
                <label className="ch">Libellé<input name="libelle" defaultValue={m.libelle} disabled={!dg} /></label>
                <label className="ch">Canal par défaut<select name="canal" defaultValue={m.canal} disabled={!dg}>{Object.entries(LIBELLES_CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="ch">Palier<select name="niveau" defaultValue={m.niveau ?? ""} disabled={!dg}><option value="">—</option><option value="1">N1</option><option value="2">N2</option><option value="3">N3</option><option value="4">N4</option></select></label>
                <label className="ch" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name="valide_par_dg" value="1" defaultChecked={m.valide_par_dg} disabled={!dg} /> validé par le DG</label>
              </div>
              <textarea name="corps" rows={7} defaultValue={m.corps} style={{ width: "100%", marginTop: 8 }} disabled={!dg} />
              {dg && <div className="frm"><button className="btn pr" type="submit">Enregistrer</button><button className="btn" formAction={supprimerModele.bind(null, m.code)} type="submit">Supprimer</button></div>}
            </form>
          ))}
          {dg && (
            <form action={enregistrerModele.bind(null, "")} className="card">
              <h3>Nouveau modèle</h3>
              <div className="frm">
                <label className="ch">Code<input name="code" required placeholder="ex. relance_bv" /></label>
                <label className="ch">Libellé<input name="libelle" required /></label>
                <label className="ch">Canal<select name="canal" defaultValue="whatsapp">{Object.entries(LIBELLES_CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="ch">Palier<select name="niveau" defaultValue=""><option value="">—</option><option value="1">N1</option><option value="2">N2</option><option value="3">N3</option><option value="4">N4</option></select></label>
              </div>
              <textarea name="corps" rows={6} style={{ width: "100%", marginTop: 8 }} placeholder={`Variables : ${VARIABLES}`} required />
              <div className="mt"><button className="btn pr" type="submit">Créer</button></div>
            </form>
          )}
          <div className="note">Variables disponibles : <code>{VARIABLES}</code>. Aucun chiffre interne d&apos;un autre client ne peut apparaître dans un message.</div>
        </>
      )}

      {onglet === "utilisateurs" && (
        <div className="card p0">
          <h3>Utilisateurs <small>comptes nominatifs, jamais partagés</small></h3>
          <div className="tbl"><table>
            <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Actif</th><th /></tr></thead>
            <tbody>
              {((utilisateurs ?? []) as Profil[]).map((u) => (
                <tr key={u.id}><td>{u.nom}</td><td>{u.email}</td>
                  <td colSpan={3}>
                    <form action={modifierUtilisateur.bind(null, u.id)} className="frm" style={{ marginTop: 0 }}>
                      <select name="role" defaultValue={u.role} disabled={!dg}>{Object.entries(LIBELLES_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <label className="ch" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name="actif" value="1" defaultChecked={u.actif} disabled={!dg || u.id === profil.id} /> actif</label>
                      {dg && u.id !== profil.id && <button className="btn sm" type="submit">Enregistrer</button>}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="note" style={{ padding: "0 14px 12px" }}>DG : tout voir, tout paramétrer, contentieux, limites. Chargé de recouvrement : relances, promesses, notes, tâches, chargement des fichiers. Comptabilité : lecture + pointage des règlements (payeur, liens). Exploitation et contrôle de gestion : lecture et exports. Les comptes se créent depuis la page de connexion ou le tableau de bord Supabase (Authentication).</div>
        </div>
      )}

      {onglet === "journal" && (
        <div className="card p0">
          <h3>Journal d&apos;audit <small>qui a vu quoi, modifié quoi, envoyé quoi, quand — 200 dernières entrées</small></h3>
          {profil.role !== "dg" && profil.role !== "controle" ? <p className="muted" style={{ padding: 14 }}>Réservé au DG et au contrôle de gestion.</p> : (
            <div className="tbl"><table>
              <thead><tr><th>Quand</th><th>Qui</th><th>Quoi</th><th>Compte</th><th>Détail</th></tr></thead>
              <tbody>{(audit ?? []).map((a) => <tr key={a.id}><td>{formatDateHeure(a.quand)}</td><td>{a.qui_nom ?? "service"}</td><td>{a.quoi}</td><td>{a.compte && <Link href={`/clients/${a.compte}`}>{a.compte}</Link>}</td><td className="muted" style={{ fontSize: 11 }}>{a.detail ? JSON.stringify(a.detail) : ""}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      )}
    </>
  );
}
