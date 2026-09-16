import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifierClePont, journaliserPont } from "@/lib/pont";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Active l'extraction : elle remplace la précédente, les soldes, cadences et scores sont recalculés, les actions couvertes se ferment. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refus = verifierClePont(request);
  if (refus) return refus;
  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("pont_activer_extraction", { p_extraction: id });
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  await journaliserPont("extraction_activee_api", { id, ...data });
  revalidatePath("/", "layout");
  return NextResponse.json({ id, ...data });
}
