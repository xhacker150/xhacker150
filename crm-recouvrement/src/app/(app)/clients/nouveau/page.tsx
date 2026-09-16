import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { ClientForm } from "@/components/ClientForm";
import { Messages } from "@/components/Messages";
import { creerClient } from "../actions";

export default async function PageNouveauClient({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: scenarios }, { data: agents }, parametres] = await Promise.all([
    supabase.from("scenarios_relance").select("*").eq("actif", true).order("nom"),
    supabase.from("profils").select("id, nom").eq("actif", true).order("nom"),
    lireParametres(),
  ]);
  return (
    <>
      <div className="entete"><div><h1>Nouveau client</h1></div></div>
      <Messages erreur={sp.erreur} />
      <div className="carte">
        <ClientForm scenarios={scenarios ?? []} agents={agents ?? []} action={creerClient} delaiDefaut={parametres.facturation.delai_paiement_defaut} />
      </div>
    </>
  );
}
