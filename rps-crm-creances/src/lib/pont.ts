import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Authentification des appels du pont (RPS-SERVER → CRM) par clé d'application. */
export function verifierClePont(request: Request): NextResponse | null {
  const attendue = process.env.PONT_API_KEY;
  const recue = request.headers.get("x-api-key");
  if (!attendue || !recue || recue !== attendue) {
    return NextResponse.json({ erreur: "Clé API invalide" }, { status: 401 });
  }
  return null;
}

export async function journaliserPont(quoi: string, detail: Record<string, unknown>) {
  const supabase = createAdminClient();
  await supabase.from("audit").insert({ qui_nom: "pont", quoi, detail });
}

export const JEUX = ["clients", "facturation", "ecritures", "livraisons"] as const;
export type Jeu = (typeof JEUX)[number];
