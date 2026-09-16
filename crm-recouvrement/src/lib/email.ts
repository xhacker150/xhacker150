/**
 * Envoi d'e-mails de relance via l'API Resend (https://resend.com).
 * Sans RESEND_API_KEY, l'envoi est désactivé et les relances restent à traiter manuellement.
 */
export function emailActif(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function envoyerEmail(params: {
  a: string;
  sujet: string;
  texte: string;
  expediteur?: string;
}): Promise<{ ok: boolean; erreur?: string; id?: string }> {
  const cle = process.env.RESEND_API_KEY;
  if (!cle) return { ok: false, erreur: "RESEND_API_KEY non configurée" };
  const from = params.expediteur || process.env.EMAIL_EXPEDITEUR || "Recouvrement <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [params.a], subject: params.sujet, text: params.texte }),
    });
    if (!res.ok) {
      const corps = await res.text();
      return { ok: false, erreur: `Resend ${res.status} : ${corps.slice(0, 200)}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message : String(e) };
  }
}
