import { createClient } from "@/lib/supabase/server";
import { formatDateHeure } from "@/lib/format";
import { Messages } from "@/components/Messages";
import { importerClients, importerFactures } from "./actions";

export default async function PageImport({ searchParams }: { searchParams: Promise<{ succes?: string; erreur?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: historique } = await supabase.from("imports_sage").select("*, profils(nom)").order("cree_le", { ascending: false }).limit(20);

  return (
    <>
      <div className="entete"><div><h1>Import / Export Sage</h1><p>Reprise des tiers et des factures depuis un export CSV de Sage (Comptabilité ou Gestion commerciale), et export des créances vers Excel / Sage.</p></div></div>
      <Messages succes={sp.succes} erreur={sp.erreur} />

      <div className="grille grille-2">
        <div className="carte">
          <h2>1. Importer les clients (tiers)</h2>
          <p className="petit texte-2">Export Sage « Plan tiers » ou « Clients » en CSV. Colonnes reconnues (ordre libre, en-têtes insensibles à la casse et aux accents) :</p>
          <p className="petit"><code>Compte</code> ou <code>Code</code> (obligatoire), <code>Intitulé</code> (obligatoire), <code>NIF</code>, <code>RCCM</code>, <code>Adresse</code>, <code>Ville</code>, <code>Pays</code>, <code>Téléphone</code>, <code>Email</code>, <code>Contact</code>, <code>Délai paiement</code>, <code>Plafond crédit</code>.</p>
          <p className="petit texte-2">Un client existant (même code) est mis à jour.</p>
          <form action={importerClients} className="form" encType="multipart/form-data">
            <div className="champ"><label>Fichier CSV</label><input type="file" name="fichier" accept=".csv,.txt,text/csv" required /></div>
            <div className="pied"><button className="btn primary" type="submit">Importer les clients</button></div>
          </form>
        </div>
        <div className="carte">
          <h2>2. Importer les factures / le solde des créances</h2>
          <p className="petit texte-2">Export Sage « Factures clients » ou « Balance / échéancier tiers » (une ligne par pièce non soldée). Colonnes reconnues :</p>
          <p className="petit"><code>Compte</code> (obligatoire), <code>N° pièce</code> (obligatoire, sert de clé anti-doublon), <code>Date</code> (obligatoire), <code>Montant TTC</code> ou <code>Débit</code> (obligatoire), <code>Échéance</code>, <code>Montant HT</code>, <code>Réglé</code> ou <code>Crédit</code>, <code>Libellé</code>, <code>Intitulé</code>.</p>
          <p className="petit texte-2">Dates au format jj/mm/aaaa ou aaaa-mm-jj ; montants avec virgule ou point. Sans échéance, le délai de paiement du client s&apos;applique. Les pièces déjà importées sont ignorées.</p>
          <form action={importerFactures} className="form" encType="multipart/form-data">
            <div className="champ"><label>Fichier CSV</label><input type="file" name="fichier" accept=".csv,.txt,text/csv" required /></div>
            <label className="champ inline"><input type="checkbox" name="creer_clients" value="1" defaultChecked /> Créer automatiquement les clients inconnus</label>
            <div className="pied"><button className="btn primary" type="submit">Importer les factures</button></div>
          </form>
        </div>
      </div>

      <div className="carte">
        <h2>3. Exporter</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="/api/export/balance-agee" className="btn">Balance âgée par client (CSV)</a>
          <a href="/api/export/balance-agee?detail=1" className="btn">Factures ouvertes détaillées (CSV)</a>
        </div>
        <p className="petit texte-2 mt">Fichiers CSV UTF-8 avec séparateur « ; », directement ouvrables dans Excel ou importables dans Sage.</p>
      </div>

      <div className="carte">
        <h2>Historique des imports</h2>
        <table className="tableau">
          <thead><tr><th>Date</th><th>Type</th><th>Fichier</th><th className="num">Lignes</th><th className="num">Importées</th><th className="num">Ignorées</th><th>Erreurs</th><th>Par</th></tr></thead>
          <tbody>
            {(historique ?? []).length === 0 && <tr><td colSpan={8} className="vide">Aucun import.</td></tr>}
            {(historique ?? []).map((h) => (
              <tr key={h.id}>
                <td>{formatDateHeure(h.cree_le)}</td><td>{h.type}</td><td>{h.nom_fichier}</td>
                <td className="num">{h.nb_lignes}</td><td className="num">{h.nb_importees}</td><td className="num">{h.nb_ignorees}</td>
                <td className="petit">{(h.erreurs as string[]).length > 0 && <details><summary>{(h.erreurs as string[]).length} erreur(s)</summary><ul>{(h.erreurs as string[]).map((e, i) => <li key={i}>{e}</li>)}</ul></details>}</td>
                <td>{(h.profils as unknown as { nom: string } | null)?.nom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
