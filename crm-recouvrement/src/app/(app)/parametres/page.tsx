import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { exigerRole, lireParametres } from "@/lib/session";
import { LIBELLES_ROLE, formatDateHeure } from "@/lib/format";
import { Messages } from "@/components/Messages";
import { enregistrerParametres, modifierUtilisateur } from "./actions";
import type { Profil } from "@/lib/types";

export default async function PageParametres({ searchParams }: { searchParams: Promise<{ succes?: string; erreur?: string; onglet?: string }> }) {
  const sp = await searchParams;
  const { profil } = await exigerRole(["admin", "gestionnaire"]);
  const onglet = sp.onglet ?? "general";
  const p = await lireParametres();
  const supabase = await createClient();
  const { data: utilisateurs } = onglet === "utilisateurs" ? await supabase.from("profils").select("*").order("nom") : { data: [] };
  const { data: audit } = onglet === "journal" ? await supabase.from("journal_audit").select("*, profils(nom)").order("cree_le", { ascending: false }).limit(100) : { data: [] };

  return (
    <>
      <div className="entete"><div><h1>Paramètres</h1></div></div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="onglets">
        <Link href="/parametres" className={onglet === "general" ? "actif" : ""}>Société & facturation</Link>
        <Link href="/parametres?onglet=utilisateurs" className={onglet === "utilisateurs" ? "actif" : ""}>Utilisateurs</Link>
        <Link href="/parametres?onglet=journal" className={onglet === "journal" ? "actif" : ""}>Journal d&apos;audit</Link>
      </div>

      {onglet === "general" && (
        <form action={enregistrerParametres} className="form">
          {profil.role !== "admin" && <div className="alerte info">Seul un administrateur peut modifier ces paramètres.</div>}
          <div className="carte">
            <h2>Société émettrice</h2>
            <div className="form">
              <div className="ligne"><div className="champ"><label>Raison sociale</label><input name="societe_nom" defaultValue={p.societe.nom} required /></div><div className="champ"><label>Adresse</label><input name="societe_adresse" defaultValue={p.societe.adresse} /></div></div>
              <div className="ligne ligne-4">
                <div className="champ"><label>Ville</label><input name="societe_ville" defaultValue={p.societe.ville} /></div>
                <div className="champ"><label>Pays</label><input name="societe_pays" defaultValue={p.societe.pays} /></div>
                <div className="champ"><label>Téléphone</label><input name="societe_telephone" defaultValue={p.societe.telephone} /></div>
                <div className="champ"><label>E-mail</label><input name="societe_email" defaultValue={p.societe.email} /></div>
              </div>
              <div className="ligne"><div className="champ"><label>NIF</label><input name="societe_nif" defaultValue={p.societe.nif} /></div><div className="champ"><label>RCCM</label><input name="societe_rccm" defaultValue={p.societe.rccm} /></div></div>
            </div>
          </div>
          <div className="carte">
            <h2>Facturation</h2>
            <div className="form">
              <div className="ligne ligne-4">
                <div className="champ"><label>Devise</label><input name="devise" defaultValue={p.facturation.devise} maxLength={5} /></div>
                <div className="champ"><label>Taux de TVA par défaut (%)</label><input type="number" step="0.01" name="taux_tva_defaut" defaultValue={p.facturation.taux_tva_defaut} /></div>
                <div className="champ"><label>Délai de paiement par défaut (j)</label><input type="number" name="delai_paiement_defaut" defaultValue={p.facturation.delai_paiement_defaut} /></div>
                <div className="champ"><label>Préfixes (facture / règlement)</label><div style={{ display: "flex", gap: 6 }}><input name="prefixe_facture" defaultValue={p.facturation.prefixe_facture} /><input name="prefixe_reglement" defaultValue={p.facturation.prefixe_reglement} /></div></div>
              </div>
              <div className="champ"><label>Mentions légales (pied de facture)</label><textarea name="mentions_legales" rows={3} defaultValue={p.facturation.mentions_legales} /></div>
            </div>
          </div>
          <div className="carte">
            <h2>Recouvrement automatique</h2>
            <div className="form">
              <div className="ligne ligne-3">
                <div className="champ"><label>Délai minimum entre deux relances (jours)</label><input type="number" name="delai_min_entre_relances_jours" min={0} defaultValue={p.recouvrement.delai_min_entre_relances_jours} /></div>
                <div className="champ"><label>Montant minimum pour relancer</label><input type="number" name="montant_min_relance" min={0} defaultValue={p.recouvrement.montant_min_relance} /><span className="aide">Les factures dont le reste dû est inférieur ne sont pas relancées.</span></div>
                <div className="champ"><label>Expéditeur des e-mails</label><input name="email_expediteur" defaultValue={p.recouvrement.email_expediteur} placeholder="Recouvrement <recouvrement@domaine.com>" /><span className="aide">Domaine vérifié chez Resend. Vide = EMAIL_EXPEDITEUR de l&apos;environnement.</span></div>
              </div>
              <p className="petit texte-2">Le traitement quotidien est planifié par Vercel Cron (07:00 UTC, fichier <code>vercel.json</code>). Il génère les actions de relance, détecte les promesses rompues et envoie les e-mails automatiques.</p>
            </div>
          </div>
          {profil.role === "admin" && <div className="pied"><button className="btn primary" type="submit">Enregistrer les paramètres</button></div>}
        </form>
      )}

      {onglet === "utilisateurs" && (
        <div className="carte">
          <h2>Utilisateurs</h2>
          <p className="petit texte-2">Les comptes se créent depuis la page de connexion (« Créer un compte ») ou depuis le tableau de bord Supabase (Authentication). Le premier compte est administrateur ; les suivants sont agents jusqu&apos;à modification ici.</p>
          <table className="tableau">
            <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Actif</th><th></th></tr></thead>
            <tbody>
              {((utilisateurs ?? []) as Profil[]).map((u) => (
                <tr key={u.id}>
                  <td>{u.nom}</td>
                  <td>{u.email}</td>
                  <td colSpan={3}>
                    <form action={modifierUtilisateur.bind(null, u.id)} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <select name="role" defaultValue={u.role} disabled={profil.role !== "admin"} style={{ padding: 5, border: "1px solid var(--border)", borderRadius: 6 }}>{Object.entries(LIBELLES_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <label className="champ inline"><input type="checkbox" name="actif" value="1" defaultChecked={u.actif} disabled={profil.role !== "admin" || u.id === profil.id} /> actif</label>
                      {profil.role === "admin" && u.id !== profil.id && <button className="btn petit" type="submit">Enregistrer</button>}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onglet === "journal" && (
        <div className="carte">
          <h2>Journal d&apos;audit <small>100 dernières opérations</small></h2>
          <table className="tableau">
            <thead><tr><th>Date</th><th>Utilisateur</th><th>Entité</th><th>Action</th><th>Détails</th></tr></thead>
            <tbody>
              {(audit ?? []).map((a) => (
                <tr key={a.id}><td>{formatDateHeure(a.cree_le)}</td><td>{(a.profils as unknown as { nom: string } | null)?.nom ?? "système"}</td><td>{a.entite}</td><td>{a.action}</td><td className="petit mono">{a.details ? JSON.stringify(a.details) : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
