import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Limite de corps des fonctions Vercel (4,5 Mo) : au-delà, réponse 413 explicite plutôt qu'une erreur opaque. */
export const TAILLE_MAX_CORPS = 4_400_000;

function empreinte(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

/** Clés acceptées : PONT_API_KEYS (liste, rotation à chaud) ou PONT_API_KEY. Comparaison en temps constant. */
export function verifierCle(recue: string | null): { ok: boolean; empreinte?: string } {
  const liste = (process.env.PONT_API_KEYS ?? process.env.PONT_API_KEY ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (!recue || liste.length === 0) return { ok: false };
  const h = Buffer.from(empreinte(recue));
  for (const cle of liste) {
    if (timingSafeEqual(h, Buffer.from(empreinte(cle)))) return { ok: true, empreinte: empreinte(cle).slice(0, 8) };
  }
  return { ok: false };
}

/** Comparaison en temps constant d'un secret (cron). */
export function secretsEgaux(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return timingSafeEqual(Buffer.from(empreinte(a)), Buffer.from(empreinte(b)));
}

/** Limiteur de débit en mémoire d'instance (frein, pas barrière : compléter par le pare-feu Vercel). */
const compteurs = new Map<string, { n: number; depuis: number }>();
export function debitAutorise(cle: string, maxParMinute = 120): boolean {
  const maintenant = Date.now();
  const c = compteurs.get(cle);
  if (!c || maintenant - c.depuis > 60_000) {
    compteurs.set(cle, { n: 1, depuis: maintenant });
    return true;
  }
  c.n++;
  return c.n <= maxParMinute;
}

export const JEUX = ["clients", "facturation", "ecritures", "livraisons"] as const;
export type Jeu = (typeof JEUX)[number];

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }, supabase: ReturnType<typeof createAdminClient>) => Promise<NextResponse>;

/**
 * Enveloppe des routes du pont : authentification par clé, débit, taille du corps, et journalisation de CHAQUE appel
 * (y compris les refus 401) : méthode, chemin, IP, statut, durée, empreinte de clé, extraction (CDC-05 §7.1).
 * L'échec de la trace technique ne bloque jamais l'appel.
 */
export function avecPont(handler: Handler): (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (request, ctx) => {
    const debut = Date.now();
    const url = new URL(request.url);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const cle = verifierCle(request.headers.get("x-api-key"));
    let reponse: NextResponse;
    let extractionId: string | undefined;
    try {
      if (!cle.ok) reponse = NextResponse.json({ erreur: "Clé API invalide" }, { status: 401 });
      else if (!debitAutorise(`${ip}|${cle.empreinte}`)) reponse = NextResponse.json({ erreur: "Trop d'appels : réessayez dans une minute" }, { status: 429 });
      else if (Number(request.headers.get("content-length") ?? 0) > TAILLE_MAX_CORPS) reponse = NextResponse.json({ erreur: "Corps trop volumineux (> 4,4 Mo) : utilisez le mode par lots (/api/pont/extractions)" }, { status: 413 });
      else {
        const params = await ctx.params;
        extractionId = params?.id;
        reponse = await handler(request, ctx, createAdminClient());
      }
    } catch (e) {
      reponse = NextResponse.json({ erreur: "Erreur interne du CRM", detail: e instanceof Error ? e.message.slice(0, 200) : String(e) }, { status: 500 });
    }
    try {
      const supabase = createAdminClient();
      await supabase.from("audit").insert({
        qui_nom: "pont", quoi: `pont_${request.method.toLowerCase()}`,
        detail: { chemin: url.pathname, statut: reponse.status, duree_ms: Date.now() - debut, ip, cle: cle.empreinte ?? null, extraction: extractionId ?? null },
      });
    } catch {
      // trace technique : jamais bloquante
    }
    return reponse;
  };
}
