import { createClient } from "@/lib/supabase/server";
import { exigerProfil, peutRecouvrer } from "@/lib/session";
import { formatDate, formatDateHeure, aujourdhui } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import { chargerFichiers, recalculer } from "./actions";
import type { Extraction } from "@/lib/types";

export default async function PageSource({ searchParams }: { searchParams: Promise<{ succes?: string; erreur?: string }> }) {
  const sp = await searchParams;
  const { profil } = await exigerProfil();
  const supabase = await createClient();
  const { data } = await supabase.from("extractions").select("*").order("cree_le", { ascending: false }).limit(15);
  const extractions = (data ?? []) as Extraction[];
  const active = extractions.find((e) => e.statut === "active");
  const droit = peutRecouvrer(profil.role);
  const urlApi = process.env.NEXT_PUBLIC_APP_URL || "https://<votre-app>.vercel.app";

  return (
    <>
      <h1 className="pg">Source des données</h1>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="tuiles">
        <div className={`tuile ${active ? "v2" : "r"}`}><div className="l">Extraction active</div><div className="v" style={{ fontSize: 15 }}>{active ? formatDate(active.date_extraction) : "aucune"}</div><div className="d">{active ? `${active.source === "api" ? "API du pont" : "fichiers du pont"} · activée le ${formatDateHeure(active.active_le)}` : "chargez les fichiers ci-dessous"}</div></div>
        {active && <div className="tuile"><div className="l">Saisi jusqu&apos;au</div><div className="v" style={{ fontSize: 15 }}>{formatDate(active.saisi_jusquau)}</div><div className="d">dernière livraison saisie en gescom</div></div>}
        {active && <div className="tuile b"><div className="l">Volumes</div><div className="v" style={{ fontSize: 15 }}>{active.nb_clients} clients</div><div className="d">{active.nb_facturation} lignes de facturation · {active.nb_ecritures} écritures · {active.nb_livraisons} livraisons</div></div>}
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Mode « Fichiers du pont »</h3>
          <p className="muted">Chargez les 4 extractions quotidiennes produites par le pont dans <code>REPORTING CLAUDE RPS\sql_out</code> (TSV, 1 ligne d&apos;en-tête). L&apos;extraction remplace la précédente et recalcule tous les soldes ; rien n&apos;est écrit vers Sage.</p>
          {droit ? (
            <form action={chargerFichiers} className="frm" style={{ flexDirection: "column", alignItems: "stretch" }} encType="multipart/form-data">
              <div className="frm">
                <label className="ch">Date de l&apos;extraction<input type="date" name="date_extraction" defaultValue={aujourdhui()} required /></label>
                <label className="ch">Facturation saisie jusqu&apos;au (facultatif)<input type="date" name="saisi_jusquau" /></label>
              </div>
              <label className="ch">qr0_clients.txt<input type="file" name="qr0" accept=".txt,.tsv,.csv" required /></label>
              <label className="ch">qr1_fact_clients.txt<input type="file" name="qr1" accept=".txt,.tsv,.csv" required /></label>
              <label className="ch">qr3_ecr_clients.txt<input type="file" name="qr3" accept=".txt,.tsv,.csv" required /></label>
              <label className="ch">qr4_livr_clients.txt<input type="file" name="qr4" accept=".txt,.tsv,.csv" required /></label>
              <div><button className="btn pr" type="submit">Charger et activer l&apos;extraction</button></div>
            </form>
          ) : <p className="muted">Réservé au DG et au recouvrement.</p>}
          {droit && active && <form action={recalculer} className="mt"><button className="btn" type="submit">⟳ Recalculer soldes, cadences et scores</button> <span className="muted">(fait chaque nuit automatiquement)</span></form>}
        </div>
        <div className="card">
          <h3>Mode « API du pont » (serveur RPS → CRM)</h3>
          <p className="muted">Le service du pont installé sur RPS-SERVER (dossier <code>pont/</code> du dépôt) lit Sage en SELECT-only et <b>pousse</b> l&apos;extraction chaque matin vers le CRM. Sage n&apos;est jamais exposé à Internet.</p>
          <dl className="dl mt">
            <dt>Santé</dt><dd><code>GET {urlApi}/api/pont/health</code></dd>
            <dt>Extraction (petit volume)</dt><dd><code>POST {urlApi}/api/pont/extract</code> — corps JSON {"{date, saisi_jusquau, clients, facturation, ecritures, livraisons}"} au format qr0/qr1/qr3/qr4</dd>
            <dt>Extraction par lots</dt><dd><code>POST /api/pont/extractions</code> → id, puis <code>POST /api/pont/extractions/&lt;id&gt;/lignes</code> {"{jeu, lignes}"} (2 000 lignes par appel), puis <code>POST /api/pont/extractions/&lt;id&gt;/activer</code></dd>
            <dt>Authentification</dt><dd>en-tête <code>X-API-Key</code> = variable d&apos;environnement <code>PONT_API_KEY</code> (Vercel)</dd>
            <dt>Chaque réponse porte</dt><dd><code>date_extraction</code> — aucun chiffre n&apos;est servi sans sa date</dd>
          </dl>
          <p className="note">Transition : double fonctionnement fichiers + API un mois minimum ; les fichiers restent le secours (CDC-05 §7.1). Coupure du pont : le CRM sert les dernières données datées et affiche un bandeau, sans estimation.</p>
        </div>
      </div>

      <div className="card p0">
        <h3>Historique des extractions</h3>
        <div className="tbl"><table>
          <thead><tr><th>Date données</th><th>Source</th><th>Statut</th><th>Saisi jusqu&apos;au</th><th className="num">Clients</th><th className="num">Facturation</th><th className="num">Écritures</th><th className="num">Livraisons</th><th>Reçue le</th><th>Commentaire</th></tr></thead>
          <tbody>
            {extractions.length === 0 && <tr><td colSpan={10} className="muted">Aucune extraction.</td></tr>}
            {extractions.map((e) => <tr key={e.id}><td>{formatDate(e.date_extraction)}</td><td>{e.source}</td><td><Badge classe={e.statut === "active" ? "vert" : e.statut === "en_cours" ? "or" : "gris"}>{e.statut}</Badge></td><td>{formatDate(e.saisi_jusquau)}</td><td className="num">{e.nb_clients}</td><td className="num">{e.nb_facturation}</td><td className="num">{e.nb_ecritures}</td><td className="num">{e.nb_livraisons}</td><td>{formatDateHeure(e.cree_le)}</td><td className="muted">{e.commentaire}</td></tr>)}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
