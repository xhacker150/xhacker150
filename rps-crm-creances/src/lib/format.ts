/** Formatage à la française : montants « 1 234 567 F », dates jj/mm/aaaa. */
export function fmt(valeur: number | string | null | undefined): string {
  const n = Math.round(Number(valeur ?? 0));
  return Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(/^/, n < 0 ? "-" : "");
}
export function fmtF(valeur: number | string | null | undefined): string {
  return `${fmt(valeur)} F`;
}
export function fmtM(valeur: number | string | null | undefined): string {
  const n = Number(valeur ?? 0);
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2).replace(".", ",")} Md`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  return fmt(n);
}
export function formatDate(valeur: string | Date | null | undefined, court = false): string {
  if (!valeur) return "—";
  const s = typeof valeur === "string" ? valeur : valeur.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${court ? m[1].slice(2) : m[1]}`;
}
export function formatDateHeure(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return valeur;
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}
export const MOIS = ["janv.", "févr.", "mars", "avril", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export function libelleMois(m: string): string {
  if (!m || m.length < 7) return m;
  return `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}
export function jours(dateIso: string | null | undefined, ref?: string): number | null {
  if (!dateIso) return null;
  const a = new Date((ref ?? aujourdhui()) + "T00:00:00Z").getTime();
  const b = new Date(dateIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.floor((a - b) / 86400000);
}

export const LIBELLES_ROLE: Record<string, string> = {
  dg: "Direction générale",
  recouvrement: "Chargé de recouvrement",
  compta: "Comptabilité",
  exploitation: "Direction exploitation",
  controle: "Contrôle de gestion",
};
export const LIBELLES_TYPE_ACTION: Record<string, string> = {
  relance: "Relance", promesse: "Promesse de paiement", plan: "Plan de paiement", contentieux: "Contentieux", note: "Note", tache: "Tâche", appel: "Appel",
};
export const LIBELLES_CANAL: Record<string, string> = {
  whatsapp: "WhatsApp", sms: "SMS", email: "E-mail", telephone: "Téléphone", courrier: "Courrier", visite: "Visite",
};
export const TYPOLOGIES = [
  "standard", "grand compte à remises", "fil de l'eau (mobile money)", "au camion / à la consommation", "BV / Bénin", "compte muet", "créditeur", "collectif (payeurs multiples)",
];
export const LIBELLES_STATUT: Record<string, { libelle: string; classe: string }> = {
  "à relancer": { libelle: "À relancer", classe: "rouge" },
  "relancé": { libelle: "Relancé", classe: "bleu" },
  promesse: { libelle: "Promesse", classe: "or" },
  plan: { libelle: "Plan de paiement", classe: "or" },
  contentieux: { libelle: "Contentieux", classe: "rouge" },
  "en cours": { libelle: "En cours", classe: "gris" },
  "soldé": { libelle: "Soldé", classe: "vert" },
  "créditeur": { libelle: "Créditeur", classe: "vert" },
};
export function classeScore(score: number): string {
  return score >= 70 ? "vert" : score >= 40 ? "or" : "rouge";
}
/** Lien WhatsApp pré-rempli (phase 1 du CDC-05 §5.6). */
export function lienWhatsApp(tel: string | null | undefined, texte: string): string | null {
  if (!tel) return null;
  let n = tel.replace(/[^\d+]/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 8) n = "227" + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(texte)}`;
}
