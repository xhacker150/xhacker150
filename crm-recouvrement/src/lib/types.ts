/** Types des entités principales (miroir du schéma SQL). */

export type Role = "admin" | "gestionnaire" | "agent";
export type StatutFacture = "brouillon" | "emise" | "partiellement_payee" | "payee" | "annulee";
export type StatutClient = "actif" | "surveille" | "bloque" | "contentieux" | "inactif";
export type Canal = "email" | "sms" | "appel" | "courrier" | "visite" | "mise_en_demeure" | "contentieux";

export interface Profil {
  id: string;
  email: string;
  nom: string;
  role: Role;
  telephone: string | null;
  actif: boolean;
}

export interface Client {
  id: string;
  code: string;
  raison_sociale: string;
  type: "entreprise" | "particulier" | "administration";
  nif: string | null;
  rccm: string | null;
  adresse: string | null;
  ville: string | null;
  pays: string | null;
  telephone: string | null;
  email: string | null;
  contact_nom: string | null;
  contact_fonction: string | null;
  delai_paiement_jours: number;
  plafond_credit: number;
  statut: StatutClient;
  scenario_id: string | null;
  agent_id: string | null;
  reference_sage: string | null;
  notes: string | null;
  cree_le: string;
}

export interface Facture {
  id: string;
  numero: string;
  client_id: string;
  date_facture: string;
  date_echeance: string;
  reference_externe: string | null;
  objet: string | null;
  montant_ht: number;
  montant_tva: number;
  montant_ttc: number;
  montant_regle: number;
  statut: StatutFacture;
  niveau_relance: number;
  derniere_relance_le: string | null;
  relances_suspendues: boolean;
  litige: boolean;
  date_paiement: string | null;
  notes: string | null;
  cree_le: string;
}

export interface VueFacture extends Facture {
  client_code: string;
  client_nom: string;
  client_statut: StatutClient;
  reste_a_payer: number;
  jours_retard: number;
  en_retard: boolean;
  tranche_age: string | null;
}

export interface LigneFacture {
  id: string;
  facture_id: string;
  ordre: number;
  designation: string;
  quantite: number;
  prix_unitaire: number;
  taux_tva: number;
  montant_ht: number;
  montant_tva: number;
  montant_ttc: number;
}

export interface Reglement {
  id: string;
  numero: string;
  client_id: string;
  date_reglement: string;
  montant: number;
  mode: string;
  reference: string | null;
  banque: string | null;
  annule: boolean;
  notes: string | null;
  cree_le: string;
}

export interface ActionRecouvrement {
  id: string;
  client_id: string;
  facture_id: string | null;
  etape_id: string | null;
  niveau: number | null;
  type: string;
  canal: Canal | null;
  statut: "planifiee" | "effectuee" | "annulee";
  automatique: boolean;
  date_prevue: string;
  date_effectuee: string | null;
  sujet: string | null;
  contenu: string | null;
  resultat: string | null;
  agent_id: string | null;
  cree_le: string;
}

export interface Promesse {
  id: string;
  client_id: string;
  facture_id: string | null;
  montant: number;
  date_promise: string;
  statut: "en_attente" | "tenue" | "rompue" | "annulee";
  commentaire: string | null;
}

export interface Litige {
  id: string;
  facture_id: string;
  client_id: string;
  motif: string;
  statut: "ouvert" | "resolu" | "rejete";
  resolution: string | null;
  ouvert_le: string;
  resolu_le: string | null;
}

export interface Scenario {
  id: string;
  nom: string;
  description: string | null;
  par_defaut: boolean;
  actif: boolean;
}

export interface EtapeRelance {
  id: string;
  scenario_id: string;
  niveau: number;
  libelle: string;
  jours_apres_echeance: number;
  canal: Canal;
  automatique: boolean;
  modele_sujet: string | null;
  modele_corps: string | null;
  bloquer_client: boolean;
  passer_en_contentieux: boolean;
}

export interface BalanceAgee {
  client_id: string;
  code: string;
  raison_sociale: string;
  statut: StatutClient;
  plafond_credit: number;
  telephone: string | null;
  email: string | null;
  nb_factures_ouvertes: number;
  encours_total: number;
  non_echu: number;
  t_0_30: number;
  t_31_60: number;
  t_61_90: number;
  t_91_120: number;
  t_plus_120: number;
  echu_total: number;
  retard_max_jours: number;
}

export interface ParametresSociete {
  nom: string;
  adresse: string;
  ville: string;
  pays: string;
  telephone: string;
  email: string;
  nif: string;
  rccm: string;
}

export interface ParametresFacturation {
  devise: string;
  taux_tva_defaut: number;
  delai_paiement_defaut: number;
  prefixe_facture: string;
  prefixe_reglement: string;
  mentions_legales: string;
}

export interface ParametresRecouvrement {
  delai_min_entre_relances_jours: number;
  montant_min_relance: number;
  email_expediteur: string;
}
