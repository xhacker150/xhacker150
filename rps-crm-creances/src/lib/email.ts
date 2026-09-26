/** E-mails transactionnels via Resend (patron repris du workflow RPS) : alertes de santé, récapitulatif, relances N3. */
export function emailActif(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Gabarit HTML à la charte RPS (bandeau 66/34 rouge/bleu, bouton « Ouvrir l'application »). */
export function gabaritHtml(titre: string, corpsHtml: string, lienApp?: string): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#F4F6FA;font-family:Arial,Helvetica,sans-serif;color:#1B1F2E">
<div style="max-width:640px;margin:0 auto;background:#fff">
<div style="display:flex;height:8px"><div style="width:66%;background:#EA0000"></div><div style="width:34%;background:#0051DD"></div></div>
<div style="padding:20px 24px"><div style="font-weight:bold;font-size:18px"><span style="color:#EA0000">RPS</span> <span style="color:#0051DD">CRM CRÉANCES</span></div>
<h1 style="font-size:16px;margin:16px 0 8px">${titre}</h1>${corpsHtml}
${lienApp ? `<p style="margin-top:20px"><a href="${lienApp}" style="background:#EA0000;color:#fff;padding:9px 16px;border-radius:7px;text-decoration:none;font-weight:bold">Ouvrir l'application</a></p>` : ""}
</div><div style="padding:10px 24px;border-top:2px solid #EA0000;font-size:11px;color:#6A7280">RISSA PETROLEUM SERVICE — B.P. 2184 Niamey — NIF 7272/R. Message automatique, aucune donnée d'un autre client.</div></div></body></html>`;
}

function destinatairesAutorises(liste: string[], domaines: string[]): string[] {
  const propres = liste.map((d) => d.trim().toLowerCase()).filter((d) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d));
  if (domaines.length === 0) return propres;
  return propres.filter((d) => domaines.some((dom) => d.endsWith("@" + dom.toLowerCase())));
}

export async function envoyerEmail(params: { a: string[]; sujet: string; html: string; texte?: string; expediteur?: string; domaines?: string[] }): Promise<{ ok: boolean; erreur?: string; envoyes: number }> {
  const cle = process.env.RESEND_API_KEY;
  const dest = destinatairesAutorises(params.a, params.domaines ?? []);
  if (!cle) return { ok: false, erreur: "RESEND_API_KEY non configurée", envoyes: 0 };
  if (dest.length === 0) return { ok: false, erreur: "Aucun destinataire autorisé", envoyes: 0 };
  const from = params.expediteur || process.env.EMAIL_EXPEDITEUR || "RPS CRM Créances <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: dest, subject: params.sujet, html: params.html, text: params.texte }),
    });
    if (!res.ok) return { ok: false, erreur: `Fournisseur e-mail : HTTP ${res.status}`, envoyes: 0 };   // jamais le détail du fournisseur au client
    return { ok: true, envoyes: dest.length };
  } catch {
    return { ok: false, erreur: "Fournisseur e-mail injoignable", envoyes: 0 };
  }
}
