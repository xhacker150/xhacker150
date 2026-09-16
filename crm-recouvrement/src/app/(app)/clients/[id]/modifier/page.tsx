import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { lireParametres } from "@/lib/session";
import { ClientForm } from "@/components/ClientForm";
import { Messages } from "@/components/Messages";
import { modifierClient } from "../../actions";

export default async function PageModifierClient({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erreur?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: client }, { data: scenarios }, { data: agents }, parametres] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase.from("scenarios_relance").select("*").eq("actif", true).order("nom"),
    supabase.from("profils").select("id, nom").eq("actif", true).order("nom"),
    lireParametres(),
  ]);
  if (!client) notFound();
  const action = modifierClient.bind(null, id);
  return (
    <>
      <div className="entete"><div><h1>Modifier {client.raison_sociale}</h1></div></div>
      <Messages erreur={sp.erreur} />
      <div className="carte">
        <ClientForm client={client} scenarios={scenarios ?? []} agents={agents ?? []} action={action} delaiDefaut={parametres.facturation.delai_paiement_defaut} />
      </div>
    </>
  );
}
