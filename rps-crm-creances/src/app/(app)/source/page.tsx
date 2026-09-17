import { createClient } from "@/lib/supabase/server";
import { exigerProfil, peutRecouvrer } from "@/lib/session";
import { formatDate, formatDateHeure, aujourdhui, LIBELLES_STATUT_EXTRACTION, LIBELLES_SOURCE } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import { ChargementFichiers } from "@/components/ChargementFichiers";
import { recalculer, abandonnerExtraction, importerActionsMaquette } from "./actions";
import type { Extraction } from "@/lib/types";

export default async function PageSource({ searchParams }: { searchParams: Promise<{ succes?: string; erreur?: string }> }) {
  const sp = await searchParams;
  const { profil } = await exigerProfil();
  const supabase = await createClient();
  const [{ data }, { data: battement }] = await Promise.all([
    supabase.from("extractions").select("*").order("cree_le", { ascending: false }).limit(15),
    profil.role === "dg" ? supabase.from("audit").select("quand, detail").eq("quoi", "pont_battement").order("quand", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const extractions = (data ?? []) as Extraction[];
  const active = extractions.find((e) => e.statut === "active");
  const droit = peutRecouvrer(profil.role);
  const urlApi = process.env.NEXT_PUBLIC_APP_URL || "https://<votre-app>.vercel.app";

  return (
    <>
      <h1 className="pg">Source des données</h1>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="tuiles">
        <div className={`tuile ${active ? "v2" : "r"}`}><div className="l">Extraction active</div><div className="v" style={{ fontSize: 15 }}>{active ? formatDate(active.date_extraction) : "aucune"}</div><div className="d">{active ? `${LIBELLES_SOURCE[active.source] ?? active.source} · activée le ${formatDateHeure(active.active_le)}` : "chargez les fichiers ci-dessous"}</div></div>
        {active && <div className="tuile"><div className="l">Saisi jusqu&apos;au</div><div className="v" style={{ fontSize: 15 }}>{formatDate(active.saisi_jusquau)}</div><div className="d">dernière livraison saisie en gescom</div></div>}
        {active && <div className="tuile b"><div className="l">Volumes</div><div className="v" style={{ fontSize: 15 }}>{active.nb_clients} clients</div><div className="d">{active.nb_facturation} lignes de facturation · {active.nb_ecritures} écritures · {active.nb_livraisons} livraisons{active.nb_rejets ? ` · ${active.nb_rejets} rejet(s)` : ""}</div></div>}
        {battement && <div className="tuile"><div className="l">Dernier battement du pont</div><div className="v" style={{ fontSize: 15 }}>{formatDateHeure(battement.quand)}</div><div className="d">état : {(battement.detail as { etat?: string })?.etat ?? "?"}</div></div>}
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Mode « Fichiers du pont »</h3>
          <p className="muted">Chargez les 4 extractions quotidiennes produites par le pont dans <code>REPORTING CLAUDE RPS\sql_out</code> (TSV, 1 ligne d&apos;en-tête). Envoi par lots depuis votre navigateur ; les lignes hors périmètre (comptes ≠ 411, 41180), aux dates ou montants invalides sont rejetées et comptées. Une extraction partielle ou plus ancienne que celle en place est refusée.</p>
          {droit ? <ChargementFichiers dateDuJour={aujourdhui()} estDg={profil.role === "dg"} /> : <p className="muted">Réservé au DG et au recouvrement.</p>}
          {droit && active && <form action={recalculer} className="mt"><button className="btn" type="submit">⟳ Recalculer soldes, cadences et scores</button> <span className="muted">(fait chaque nuit automatiquement)</span></form>}
          {droit && (
            <details className="mt"><summary className="muted">Reprise des actions de la maquette (30_CLIENTS\data\crm_*.json)</summary>
              <form action={importerActionsMaquette} className="frm" encType="multipart/form-data"><input type="file" name="fichier" accept=".json" required /><button className="btn sm" type="submit">Importer</button></form>
            </details>
          )}
        </div>
        <div className="card">
          <h3>Mode « API du pont » (serveur RPS → CRM)</h3>
          <p className="muted">Le service du pont installé sur RPS-SERVER (dossier <code>pont/</code> du dépôt) lit Sage en SELECT-only et <b>pousse</b> l&apos;extraction vers le CRM (chaque heure recommandé). Sage n&apos;est jamais exposé à Internet.</p>
          <dl className="dl mt">
            <dt>Santé / battement</dt><dd><code>GET|POST {urlApi}/api/pont/health</code></dd>
            <dt>Extraction par lots</dt><dd><code>POST /api/pont/extractions</code> {"{date, saisi_jusquau, attendus}"} → id ; <code>POST /api/pont/extractions/&lt;id&gt;/lignes</code> {"{jeu, lot, lignes}"} (idempotent par numéro de lot) ; <code>POST …/activer</code> ; <code>DELETE …</code> pour abandonner</dd>
            <dt>Petit volume</dt><dd><code>POST /api/pont/extract</code> (&lt; 4,4 Mo) ; <code>GET /api/pont/extract</code> = extraction active au format de la maquette</dd>
            <dt>Authentification</dt><dd>en-tête <code>X-API-Key</code> (variable <code>PONT_API_KEYS</code>, plusieurs clés = rotation à chaud) ; chaque appel est journalisé, refus compris</dd>
            <dt>Chaque réponse porte</dt><dd><code>date_extraction</code> — aucun chiffre n&apos;est servi sans sa date</dd>
          </dl>
          <p className="note">Transition : double fonctionnement fichiers + API un mois minimum ; les fichiers restent le secours (CDC-05 §7.1). Coupure du pont : le CRM sert les dernières données datées et affiche un bandeau, sans estimation.</p>
        </div>
      </div>

      <div className="card p0">
        <h3>Historique des extractions</h3>
        <div className="tbl"><table>
          <thead><tr><th>Date données</th><th>Source</th><th>Statut</th><th className="opt">Saisi jusqu&apos;au</th><th className="num">Clients</th><th className="num opt">Facturation</th><th className="num">Écritures</th><th className="num opt">Livraisons</th><th className="num">Rejets</th><th className="opt">Reçue le</th><th className="opt">Commentaire</th><th /></tr></thead>
          <tbody>
            {extractions.length === 0 && <tr><td colSpan={12} className="muted">Aucune extraction.</td></tr>}
            {extractions.map((e) => <tr key={e.id}><td>{formatDate(e.date_extraction)}</td><td>{LIBELLES_SOURCE[e.source] ?? e.source}</td><td><Badge classe={e.statut === "active" ? "vert" : e.statut === "en_cours" ? "or" : "gris"}>{LIBELLES_STATUT_EXTRACTION[e.statut] ?? e.statut}</Badge></td><td className="opt">{formatDate(e.saisi_jusquau)}</td><td className="num">{e.nb_clients}</td><td className="num opt">{e.nb_facturation}</td><td className="num">{e.nb_ecritures}</td><td className="num opt">{e.nb_livraisons}</td><td className="num">{e.nb_rejets}</td><td className="opt">{formatDateHeure(e.cree_le)}</td><td className="muted opt">{e.commentaire}</td>
              <td>{droit && e.statut === "en_cours" && <form action={abandonnerExtraction.bind(null, e.id)}><button className="btn sm" type="submit">Abandonner</button></form>}</td></tr>)}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
