import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { ReglementForm } from "@/components/ReglementForm";
import { aujourdhui } from "@/lib/format";

export default async function PageNouveauReglement({ searchParams }: { searchParams: Promise<{ client_id?: string; facture_id?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: clients }, parametres] = await Promise.all([
    supabase.from("clients").select("id, code, raison_sociale").order("raison_sociale"),
    lireParametres(),
  ]);
  return (
    <>
      <div className="entete"><div><h1>Nouvel encaissement</h1><p>Le règlement est lettré sur les factures ouvertes du client et leur statut est recalculé automatiquement.</p></div></div>
      <div className="carte">
        <ReglementForm clients={clients ?? []} clientInitial={sp.client_id} factureInitiale={sp.facture_id} devise={parametres.facturation.devise} dateDuJour={aujourdhui()} />
      </div>
    </>
  );
}
