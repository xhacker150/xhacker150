import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { exigerRole } from "@/lib/session";
import { LIBELLES_CANAL } from "@/lib/format";
import { Messages } from "@/components/Messages";
import { modifierScenario, enregistrerEtape, supprimerEtape } from "../actions";
import type { EtapeRelance } from "@/lib/types";

const VARIABLES = "{{client}} {{contact}} {{numero}} {{reference}} {{montant}} {{reste}} {{devise}} {{echeance}} {{date_facture}} {{jours_retard}} {{telephone}} {{email}} {{societe}}";

function FormEtape({ scenarioId, etape, niveauSuivant }: { scenarioId: string; etape?: EtapeRelance; niveauSuivant: number }) {
  const e = etape;
  return (
    <form action={enregistrerEtape.bind(null, scenarioId, e?.id ?? null)} className="form">
      <div className="ligne ligne-4">
        <div className="champ"><label>Niveau *</label><input type="number" name="niveau" min={1} required defaultValue={e?.niveau ?? niveauSuivant} /></div>
        <div className="champ" style={{ gridColumn: "span 2" }}><label>Libellé *</label><input name="libelle" required defaultValue={e?.libelle ?? ""} /></div>
        <div className="champ"><label>Jours après échéance</label><input type="number" name="jours_apres_echeance" min={-60} required defaultValue={e?.jours_apres_echeance ?? 0} /><span className="aide">Négatif = avant l&apos;échéance</span></div>
      </div>
      <div className="ligne ligne-4">
        <div className="champ"><label>Canal</label><select name="canal" defaultValue={e?.canal ?? "email"}>{Object.entries(LIBELLES_CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <label className="champ inline"><input type="checkbox" name="automatique" value="1" defaultChecked={e?.automatique ?? true} /> Envoi automatique (e-mail)</label>
        <label className="champ inline"><input type="checkbox" name="bloquer_client" value="1" defaultChecked={e?.bloquer_client ?? false} /> Bloquer le client</label>
        <label className="champ inline"><input type="checkbox" name="passer_en_contentieux" value="1" defaultChecked={e?.passer_en_contentieux ?? false} /> Passer en contentieux</label>
      </div>
      <div className="champ"><label>Objet du message</label><input name="modele_sujet" defaultValue={e?.modele_sujet ?? ""} /></div>
      <div className="champ"><label>Modèle du message / consigne</label><textarea name="modele_corps" rows={6} defaultValue={e?.modele_corps ?? ""} /><span className="aide">Variables : <code>{VARIABLES}</code></span></div>
      <div className="pied">
        {e && <button className="btn danger petit" formAction={supprimerEtape.bind(null, scenarioId, e.id)} type="submit">Supprimer l&apos;étape</button>}
        <button className="btn primary" type="submit">{e ? "Enregistrer" : "Ajouter l'étape"}</button>
      </div>
    </form>
  );
}

export default async function PageScenario({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ succes?: string; erreur?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  await exigerRole(["admin", "gestionnaire"]);
  const supabase = await createClient();
  const { data: scenario } = await supabase.from("scenarios_relance").select("*").eq("id", id).single();
  if (!scenario) notFound();
  const { data: etapes } = await supabase.from("etapes_relance").select("*").eq("scenario_id", id).order("niveau");
  const liste = (etapes ?? []) as EtapeRelance[];
  const niveauSuivant = (liste.at(-1)?.niveau ?? 0) + 1;

  return (
    <>
      <div className="entete"><div><h1>{scenario.nom}</h1><p><Link href="/scenarios">← Scénarios</Link></p></div></div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="carte">
        <h2>Général</h2>
        <form action={modifierScenario.bind(null, id)} className="form">
          <div className="ligne ligne-3">
            <div className="champ"><label>Nom</label><input name="nom" required defaultValue={scenario.nom} /></div>
            <div className="champ"><label>Description</label><input name="description" defaultValue={scenario.description ?? ""} /></div>
            <label className="champ inline"><input type="checkbox" name="actif" value="1" defaultChecked={scenario.actif} /> Actif</label>
          </div>
          <div className="pied"><button className="btn primary" type="submit">Enregistrer</button></div>
        </form>
      </div>
      {liste.map((e) => (
        <div className="carte" key={e.id}>
          <h2>Niveau {e.niveau} — {e.libelle} <small>{e.jours_apres_echeance < 0 ? `J${e.jours_apres_echeance}` : `J+${e.jours_apres_echeance}`} · {LIBELLES_CANAL[e.canal]}</small></h2>
          <FormEtape scenarioId={id} etape={e} niveauSuivant={niveauSuivant} />
        </div>
      ))}
      <div className="carte">
        <h2>Ajouter une étape</h2>
        <FormEtape scenarioId={id} niveauSuivant={niveauSuivant} />
      </div>
    </>
  );
}
