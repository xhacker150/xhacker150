"use client";

import { useState } from "react";
import { lireTsv, lots } from "@/lib/tsv";

const FICHIERS: { champ: string; jeu: string; colonnes: number; nom: string }[] = [
  { champ: "qr0", jeu: "clients", colonnes: 2, nom: "qr0_clients.txt" },
  { champ: "qr1", jeu: "facturation", colonnes: 3, nom: "qr1_fact_clients.txt" },
  { champ: "qr3", jeu: "ecritures", colonnes: 8, nom: "qr3_ecr_clients.txt" },
  { champ: "qr4", jeu: "livraisons", colonnes: 8, nom: "qr4_livr_clients.txt" },
];

/** Chargement des 4 fichiers du pont par lots depuis le navigateur (limite Vercel 4,5 Mo par appel), avec compte-rendu des rejets. */
export function ChargementFichiers({ dateDuJour, estDg }: { dateDuJour: string; estDg: boolean }) {
  const [etat, setEtat] = useState<string>("");
  const [journal, setJournal] = useState<string[]>([]);
  const [enCours, setEnCours] = useState(false);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [refus, setRefus] = useState<string | null>(null);

  async function appel(corps: Record<string, unknown>) {
    const r = await fetch("/api/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erreur ?? `HTTP ${r.status}`), { refus: j.refus, id: corps.id });
    return j;
  }

  async function activer(id: string, forcer: boolean) {
    setEtat(forcer ? "Activation forcée…" : "Activation…");
    const r = await appel({ etape: "activer", id, forcer });
    setEtat(`Extraction activée : ${r.clients} clients calculés, ${r.actions_fermees_auto} action(s) fermée(s) automatiquement, ${r.rejets ?? 0} ligne(s) rejetée(s).`);
    setRefus(null);
    setExtractionId(null);
    setTimeout(() => window.location.assign("/source?succes=" + encodeURIComponent("Extraction activée")), 800);
  }

  async function charger(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setEnCours(true); setJournal([]); setRefus(null);
    try {
      const contenus: Record<string, string[][]> = {};
      for (const f of FICHIERS) {
        const fichier = fd.get(f.champ);
        if (!(fichier instanceof File) || fichier.size === 0) throw new Error(`Fichier ${f.nom} manquant`);
        const lignes = lireTsv(await fichier.text());
        if (lignes.length && lignes[0].length < f.colonnes) throw new Error(`${f.nom} : ${f.colonnes} colonnes attendues (tabulations)`);
        contenus[f.jeu] = lignes;
      }
      const attendus = Object.fromEntries(FICHIERS.map((f) => [f.jeu, contenus[f.jeu].length]));
      setEtat("Ouverture de l'extraction…");
      const { id } = await appel({ etape: "debut", date: fd.get("date_extraction"), saisi_jusquau: fd.get("saisi_jusquau") || null, attendus });
      setExtractionId(id);
      for (const f of FICHIERS) {
        let lot = 0;
        let acceptees = 0, rejetees = 0;
        for (const bloc of lots(contenus[f.jeu], 2000)) {
          lot++;
          setEtat(`${f.nom} : lot ${lot} (${acceptees} lignes acceptées)…`);
          const r = await appel({ etape: "lot", id, jeu: f.jeu, lot, lignes: bloc });
          acceptees += Number(r.acceptees ?? 0); rejetees += Number(r.rejetees ?? 0);
          if (r.exemples_rejets) setJournal((j) => [...j, `${f.nom} lot ${lot} : ${r.rejetees} rejet(s), ex. ${JSON.stringify(r.exemples_rejets[0])}`]);
        }
        setJournal((j) => [...j, `${f.nom} : ${acceptees} acceptées, ${rejetees} rejetées`]);
      }
      await activer(id, false);
    } catch (err) {
      const e2 = err as Error & { refus?: boolean; id?: string };
      setEtat(`Échec : ${e2.message}`);
      if (e2.refus && e2.id) setRefus(String(e2.id));
    } finally {
      setEnCours(false);
    }
  }

  async function abandonner() {
    if (!extractionId) return;
    await appel({ etape: "abandon", id: extractionId }).catch(() => {});
    setExtractionId(null); setRefus(null); setEtat("Extraction abandonnée.");
  }

  return (
    <form onSubmit={charger} className="frm" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="frm">
        <label className="ch">Date de l&apos;extraction<input type="date" name="date_extraction" defaultValue={dateDuJour} max={dateDuJour} required /></label>
        <label className="ch">Facturation saisie jusqu&apos;au (facultatif)<input type="date" name="saisi_jusquau" /></label>
      </div>
      {FICHIERS.map((f) => <label key={f.champ} className="ch">{f.nom}<input type="file" name={f.champ} accept=".txt,.tsv,.csv" required /></label>)}
      <div className="frm">
        <button className="btn pr" type="submit" disabled={enCours}>{enCours ? "Chargement…" : "Charger et activer l'extraction"}</button>
        {refus && estDg && <button className="btn" type="button" onClick={() => activer(refus, true)}>Forcer l&apos;activation (DG)</button>}
        {extractionId && !enCours && <button className="btn" type="button" onClick={abandonner}>Abandonner</button>}
      </div>
      {etat && <div className={etat.startsWith("Échec") ? "warn" : "info"}>{etat}</div>}
      {journal.length > 0 && <ul className="muted" style={{ paddingLeft: 18 }}>{journal.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </form>
  );
}
