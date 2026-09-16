/** Types des entités (miroir du schéma SQL). */
export type Role = "dg" | "recouvrement" | "compta" | "exploitation" | "controle";
export type TypeAction = "relance" | "promesse" | "plan" | "contentieux" | "note" | "tache" | "appel";
export type Canal = "whatsapp" | "sms" | "email" | "telephone" | "courrier" | "visite";

export interface Profil { id: string; email: string; nom: string; role: Role; telephone: string | null; actif: boolean }

export interface Contact { nom: string; tel?: string; whatsapp?: string; email?: string; role?: string }

export interface VueClient {
  compte: string; intitule: string;
  ran: number; facture: number; facture_exercice: number; regle: number; debits_hors_ran: number; solde: number;
  derniere_facture: string | null; dernier_reglement: string | null; nb_reglements: number; reglement_moyen: number;
  part_mobile_money: number; litres_exercice: number; cadence_jours: number | null; seuil_alerte_jours: number;
  jours_sans_reglement: number | null; typologie_auto: string; score: number; calcule_le: string;
  typologie: string; typologie_manuelle: boolean | null; limite_credit: number | null; interlocuteur_id: string | null;
  segment_zone: string | null; categorie: string | null; contacts: Contact[] | null; notes: string | null; interlocuteur: string | null;
  limite_depassee: boolean; contentieux: boolean | null; promesse: boolean | null; plan: boolean | null; relance: boolean | null;
  prochaine_echeance: string | null; derniere_relance: string | null; niveau_relance: number | null; montant_promis: number | null;
  promesse_echue: boolean; nb_promesses_rompues: number; nb_tenues: number | null; nb_total: number | null; decroche: boolean;
  statut: string; niveau_suggere: number | null; segment_encours: string;
}

export interface Ecriture {
  extraction_id: string; ordre: number; compte: string; date_ecriture: string; journal: string; piece: string | null; ref_piece: string | null;
  intitule: string | null; sens: number; montant: number; payeur: string | null; lien: string | null; piece_liee: string | null;
  compte_lie: string | null; lien_note: string | null; est_reglement: boolean;
}

export interface Livraison {
  compte: string; date_livraison: string; piece: string | null; ar_ref: string | null; designation: string | null;
  qte: number; montant_ht: number; depot: string | null; station: string | null;
}

export interface Action {
  id: string; compte: string; type: TypeAction; statut: "ouverte" | "fermee"; niveau: number | null; canal: Canal | null; note: string | null;
  montant: number | null; echeance: string | null; resultat: string | null; reglee_par_piece: string | null; assignee_id: string | null;
  auteur_id: string | null; auteur: string; cree_le: string; date_action: string; ferme_le: string | null; ferme_motif: string | null;
}

export interface Extraction {
  id: string; date_extraction: string; source: string; statut: string; saisi_jusquau: string | null;
  nb_clients: number; nb_facturation: number; nb_ecritures: number; nb_livraisons: number; commentaire: string | null; cree_le: string; active_le: string | null;
}

export interface ModeleMessage { code: string; libelle: string; canal: Canal; niveau: number | null; corps: string; valide_par_dg: boolean }
