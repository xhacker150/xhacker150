import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { FactureForm } from "@/components/FactureForm";
import { aujourdhui } from "@/lib/format";

export default async function PageNouvelleFacture({ searchParams }: { searchParams: Promise<{ client_id?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: clients }, parametres] = await Promise.all([
    supabase.from("clients").select("id, code, raison_sociale, delai_paiement_jours, statut").neq("statut", "inactif").order("raison_sociale"),
    lireParametres(),
  ]);
  return (
    <>
      <div className="entete"><div><h1>Nouvelle facture</h1><p>Le numéro est attribué automatiquement ({parametres.facturation.prefixe_facture}-AAAA-NNNNNN).</p></div></div>
      <div className="carte">
        <FactureForm
          clients={clients ?? []}
          clientInitial={sp.client_id}
          tauxTvaDefaut={Number(parametres.facturation.taux_tva_defaut)}
          devise={parametres.facturation.devise}
          dateDuJour={aujourdhui()}
        />
      </div>
    </>
  );
}
