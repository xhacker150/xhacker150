/** Utilitaires de formatage (montants, dates, libellés). Sans dépendance à l'environnement d'exécution. */

export function formatMontant(valeur: number | string | null | undefined, devise = "XOF"): string {
  const n = Number(valeur ?? 0);
  const entier = Math.round(Math.abs(n));
  const chaine = entier.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n < 0 ? "-" : ""}${chaine} ${devise}`;
}

export function formatNombre(valeur: number | string | null | undefined, decimales = 0): string {
  const n = Number(valeur ?? 0);
  const [ent, dec] = n.toFixed(decimales).split(".");
  const entier = ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec ? `${entier},${dec}` : entier;
}

/** Date ISO (yyyy-mm-dd ou timestamp) vers jj/mm/aaaa. */
export function formatDate(valeur: string | Date | null | undefined): string {
  if (!valeur) return "";
  const s = typeof valeur === "string" ? valeur : valeur.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatDateHeure(valeur: string | null | undefined): string {
  if (!valeur) return "";
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return valeur;
  const p = (x: number) => x.toString().padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Date du jour au format ISO (yyyy-mm-dd). */
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ajouterJours(dateIso: string, jours: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

export const LIBELLES_STATUT_FACTURE: Record<string, string> = {
  brouillon: "Brouillon",
  emise: "Émise",
  partiellement_payee: "Partiellement payée",
  payee: "Payée",
  annulee: "Annulée",
};

export const LIBELLES_STATUT_CLIENT: Record<string, string> = {
  actif: "Actif",
  surveille: "Sous surveillance",
  bloque: "Bloqué",
  contentieux: "Contentieux",
  inactif: "Inactif",
};

export const LIBELLES_TYPE_CLIENT: Record<string, string> = {
  entreprise: "Entreprise",
  particulier: "Particulier",
  administration: "Administration",
};

export const LIBELLES_MODE_REGLEMENT: Record<string, string> = {
  especes: "Espèces",
  virement: "Virement",
  cheque: "Chèque",
  mobile_money: "Mobile Money",
  carte: "Carte bancaire",
  compensation: "Compensation",
  autre: "Autre",
};

export const LIBELLES_CANAL: Record<string, string> = {
  email: "E-mail",
  sms: "SMS",
  appel: "Appel téléphonique",
  courrier: "Courrier",
  visite: "Visite",
  mise_en_demeure: "Mise en demeure",
  contentieux: "Contentieux",
};

export const LIBELLES_TYPE_ACTION: Record<string, string> = {
  relance: "Relance",
  appel: "Appel",
  email: "E-mail",
  sms: "SMS",
  courrier: "Courrier",
  visite: "Visite",
  promesse: "Promesse de paiement",
  litige: "Litige",
  mise_en_demeure: "Mise en demeure",
  contentieux: "Contentieux",
  note: "Note",
};

export const LIBELLES_STATUT_ACTION: Record<string, string> = {
  planifiee: "À faire",
  effectuee: "Effectuée",
  annulee: "Annulée",
};

export const LIBELLES_STATUT_PROMESSE: Record<string, string> = {
  en_attente: "En attente",
  tenue: "Tenue",
  rompue: "Rompue",
  annulee: "Annulée",
};

export const LIBELLES_TRANCHE: Record<string, string> = {
  non_echu: "Non échu",
  "0_30": "1-30 j",
  "31_60": "31-60 j",
  "61_90": "61-90 j",
  "91_120": "91-120 j",
  plus_120: "> 120 j",
};

export const LIBELLES_ROLE: Record<string, string> = {
  admin: "Administrateur",
  gestionnaire: "Gestionnaire",
  agent: "Agent de recouvrement",
};
