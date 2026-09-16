import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { exigerProfil } from "@/lib/session";
import { LIBELLES_CANAL } from "@/lib/format";
import { Badge } from "@/components/Badge";
import { Messages } from "@/components/Messages";
import { creerScenario, definirParDefaut, supprimerScenario } from "./actions";
import type { EtapeRelance } from "@/lib/types";

export default async function PageScenarios({ searchParams }: { searchParams: Promise<{ succes?: string; erreur?: string }> }) {
  const sp = await searchParams;
  const { profil } = await exigerProfil();
  const gestionnaire = profil.role === "admin" || profil.role === "gestionnaire";
  const supabase = await createClient();
  const { data: scenarios } = await supabase.from("scenarios_relance").select("*, etapes_relance(*), clients(count)").order("par_defaut", { ascending: false }).order("nom");

  return (
    <>
      <div className="entete">
        <div><h1>Scénarios de relance</h1><p>Chaque scénario définit les étapes successives du recouvrement (délai après échéance, canal, modèle de message, blocage du client).</p></div>
      </div>
      <Messages succes={sp.succes} erreur={sp.erreur} />
      <div className="grille grille-2">
        {(scenarios ?? []).map((s) => {
          const etapes = ((s.etapes_relance ?? []) as EtapeRelance[]).sort((a, b) => a.niveau - b.niveau);
          const nbClients = (s.clients as unknown as { count: number }[])?.[0]?.count ?? 0;
          return (
            <div className="carte" key={s.id}>
              <h2>
                <span><Link href={`/scenarios/${s.id}`}>{s.nom}</Link> {s.par_defaut && <Badge ton="primary">Par défaut</Badge>} {!s.actif && <Badge ton="neutral">Inactif</Badge>}</span>
                <small>{nbClients} client(s) affecté(s)</small>
              </h2>
              {s.description && <p className="texte-2 petit">{s.description}</p>}
              <table className="tableau">
                <thead><tr><th>Niv.</th><th>Étape</th><th className="num">Délai</th><th>Canal</th><th>Effets</th></tr></thead>
                <tbody>
                  {etapes.length === 0 && <tr><td colSpan={5} className="vide">Aucune étape.</td></tr>}
                  {etapes.map((e) => (
                    <tr key={e.id}>
                      <td>{e.niveau}</td>
                      <td>{e.libelle}</td>
                      <td className="num">{e.jours_apres_echeance < 0 ? `J${e.jours_apres_echeance}` : `J+${e.jours_apres_echeance}`}</td>
                      <td>{LIBELLES_CANAL[e.canal]}{e.automatique && <span className="texte-3 petit"> · auto</span>}</td>
                      <td className="petit">{e.bloquer_client && <Badge ton="danger">Bloque</Badge>} {e.passer_en_contentieux && <Badge ton="danger">Contentieux</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {gestionnaire && (
                <div className="mt" style={{ display: "flex", gap: 6 }}>
                  <Link href={`/scenarios/${s.id}`} className="btn petit">Modifier</Link>
                  {!s.par_defaut && <form action={definirParDefaut.bind(null, s.id)}><button className="btn petit" type="submit">Définir par défaut</button></form>}
                  {!s.par_defaut && <form action={supprimerScenario.bind(null, s.id)}><button className="btn petit danger" type="submit">Supprimer</button></form>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {gestionnaire && (
        <div className="carte">
          <h2>Nouveau scénario</h2>
          <form action={creerScenario} className="form">
            <div className="ligne"><div className="champ"><label>Nom *</label><input name="nom" required /></div><div className="champ"><label>Description</label><input name="description" /></div></div>
            <div className="pied"><button className="btn primary" type="submit">Créer</button></div>
          </form>
        </div>
      )}
    </>
  );
}
