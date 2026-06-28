/**
 * Types de la base RPS — dérivés de supabase/migrations/0001_init.sql.
 *
 * ⚠️ Saisis à la main pour l'étape 1 (socle). À l'étape 2, une fois la migration
 * appliquée sur Supabase, régénérer ce fichier avec :
 *   npx supabase gen types typescript --project-id <ref> --schema public > src/lib/supabase/types.ts
 * (ou via le serveur MCP Supabase). Garder la table `ventes` en lecture seule.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RoleUtilisateur = "direction" | "controle" | "station";
export type StatutStation = "active" | "hors_service";
export type TypeVente = "especes" | "credit";
export type StatutFacture =
  | "brouillon"
  | "emise"
  | "partiellement_reglee"
  | "reglee"
  | "echue"
  | "annulee";
export type ModeReglement =
  | "especes"
  | "virement"
  | "mobile_money"
  | "cheque"
  | "compensation";
export type StatutCommande =
  | "enregistree"
  | "validee"
  | "livree"
  | "facturee"
  | "annulee";
export type CanalRelance = "sms" | "email" | "appel" | "courrier";
export type StatutRelance = "planifiee" | "envoyee" | "echec" | "annulee";
export type TypeAnomalie =
  | "date_hors_periode"
  | "doublon_piece"
  | "doublon_contenu"
  | "piece_renumerotee"
  | "compte_tiers_corrige"
  | "collectif_corrige"
  | "decimal_normalise"
  | "espace_nettoye"
  | "depot_corrige"
  | "station_manquante"
  | "collision_sage"
  | "autre";

export type Database = {
  public: {
    Tables: {
      profils: {
        Row: {
          id: string;
          nom: string;
          role: RoleUtilisateur;
          station_id: string | null;
          actif: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          nom: string;
          role?: RoleUtilisateur;
          station_id?: string | null;
          actif?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          nom?: string;
          role?: RoleUtilisateur;
          station_id?: string | null;
          actif?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stations: {
        Row: {
          id: string;
          numero: string;
          code_site: string;
          nom_officiel: string;
          format_piece: string | null;
          statut: StatutStation;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          numero: string;
          code_site: string;
          nom_officiel: string;
          format_piece?: string | null;
          statut?: StatutStation;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          numero?: string;
          code_site?: string;
          nom_officiel?: string;
          format_piece?: string | null;
          statut?: StatutStation;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      produits: {
        Row: {
          id: string;
          code: string;
          libelle: string;
          unite: string;
          actif: boolean;
        };
        Insert: {
          id?: string;
          code: string;
          libelle: string;
          unite?: string;
          actif?: boolean;
        };
        Update: {
          id?: string;
          code?: string;
          libelle?: string;
          unite?: string;
          actif?: boolean;
        };
        Relationships: [];
      };
      prix: {
        Row: {
          id: string;
          produit_id: string;
          station_id: string | null;
          prix_unitaire: number;
          date_debut: string;
          date_fin: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          produit_id: string;
          station_id?: string | null;
          prix_unitaire: number;
          date_debut: string;
          date_fin?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          produit_id?: string;
          station_id?: string | null;
          prix_unitaire?: number;
          date_debut?: string;
          date_fin?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          compte_tiers: string;
          compte_collectif: string | null;
          nom: string;
          telephone: string | null;
          email: string | null;
          delai_paiement_jours: number;
          plafond_credit: number | null;
          actif: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          compte_tiers: string;
          compte_collectif?: string | null;
          nom: string;
          telephone?: string | null;
          email?: string | null;
          delai_paiement_jours?: number;
          plafond_credit?: number | null;
          actif?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          compte_tiers?: string;
          compte_collectif?: string | null;
          nom?: string;
          telephone?: string | null;
          email?: string | null;
          delai_paiement_jours?: number;
          plafond_credit?: number | null;
          actif?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ventes: {
        Row: {
          id: string;
          import_id: string;
          date_vente: string;
          station_id: string;
          piece: string;
          piece_origine: string | null;
          client_id: string | null;
          compte_tiers: string | null;
          lieu_livraison: string | null;
          type_vente: TypeVente;
          produit_id: string;
          description: string | null;
          quantite: number;
          prix_unitaire: number;
          montant: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          import_id: string;
          date_vente: string;
          station_id: string;
          piece: string;
          piece_origine?: string | null;
          client_id?: string | null;
          compte_tiers?: string | null;
          lieu_livraison?: string | null;
          type_vente: TypeVente;
          produit_id: string;
          description?: string | null;
          quantite: number;
          prix_unitaire: number;
          montant: number;
          created_at?: string;
        };
        // Lecture seule (règle d'or) : pas de mise à jour applicative.
        Update: never;
        Relationships: [];
      };
      imports: {
        Row: {
          id: string;
          date_traitee: string;
          fichier_source: string | null;
          nb_ventes: number;
          nb_anomalies: number;
          montant_total: number;
          quantite_totale: number;
          importe_par: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          date_traitee: string;
          fichier_source?: string | null;
          nb_ventes?: number;
          nb_anomalies?: number;
          montant_total?: number;
          quantite_totale?: number;
          importe_par?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          date_traitee?: string;
          fichier_source?: string | null;
          nb_ventes?: number;
          nb_anomalies?: number;
          montant_total?: number;
          quantite_totale?: number;
          importe_par?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      import_anomalies: {
        Row: {
          id: string;
          import_id: string;
          type: TypeAnomalie;
          station_id: string | null;
          piece: string | null;
          detail: string;
          valeur_origine: string | null;
          valeur_corrigee: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          import_id: string;
          type: TypeAnomalie;
          station_id?: string | null;
          piece?: string | null;
          detail: string;
          valeur_origine?: string | null;
          valeur_corrigee?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          import_id?: string;
          type?: TypeAnomalie;
          station_id?: string | null;
          piece?: string | null;
          detail?: string;
          valeur_origine?: string | null;
          valeur_corrigee?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      factures: {
        Row: {
          id: string;
          numero: string;
          client_id: string;
          station_id: string | null;
          date_emission: string;
          periode_debut: string;
          periode_fin: string;
          date_echeance: string;
          montant_ht: number;
          remise: number;
          montant_net: number;
          statut: StatutFacture;
          notes: string | null;
          emise_par: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          numero: string;
          client_id: string;
          station_id?: string | null;
          date_emission: string;
          periode_debut: string;
          periode_fin: string;
          date_echeance: string;
          montant_ht?: number;
          remise?: number;
          montant_net?: number;
          statut?: StatutFacture;
          notes?: string | null;
          emise_par?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          numero?: string;
          client_id?: string;
          station_id?: string | null;
          date_emission?: string;
          periode_debut?: string;
          periode_fin?: string;
          date_echeance?: string;
          montant_ht?: number;
          remise?: number;
          montant_net?: number;
          statut?: StatutFacture;
          notes?: string | null;
          emise_par?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      facture_lignes: {
        Row: {
          id: string;
          facture_id: string;
          vente_id: string | null;
          produit_id: string;
          quantite: number;
          prix_unitaire: number;
          montant: number;
        };
        Insert: {
          id?: string;
          facture_id: string;
          vente_id?: string | null;
          produit_id: string;
          quantite: number;
          prix_unitaire: number;
          montant: number;
        };
        Update: {
          id?: string;
          facture_id?: string;
          vente_id?: string | null;
          produit_id?: string;
          quantite?: number;
          prix_unitaire?: number;
          montant?: number;
        };
        Relationships: [];
      };
      reglements: {
        Row: {
          id: string;
          client_id: string;
          date_reglement: string;
          montant: number;
          mode: ModeReglement;
          reference: string | null;
          notes: string | null;
          saisi_par: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          date_reglement: string;
          montant: number;
          mode: ModeReglement;
          reference?: string | null;
          notes?: string | null;
          saisi_par?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          date_reglement?: string;
          montant?: number;
          mode?: ModeReglement;
          reference?: string | null;
          notes?: string | null;
          saisi_par?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reglement_affectations: {
        Row: {
          id: string;
          reglement_id: string;
          facture_id: string;
          montant_affecte: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          reglement_id: string;
          facture_id: string;
          montant_affecte: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          reglement_id?: string;
          facture_id?: string;
          montant_affecte?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      commandes: {
        Row: {
          id: string;
          client_id: string;
          produit_id: string;
          station_id: string | null;
          quantite: number;
          date_souhaitee: string | null;
          statut: StatutCommande;
          facture_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          produit_id: string;
          station_id?: string | null;
          quantite: number;
          date_souhaitee?: string | null;
          statut?: StatutCommande;
          facture_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          produit_id?: string;
          station_id?: string | null;
          quantite?: number;
          date_souhaitee?: string | null;
          statut?: StatutCommande;
          facture_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      relances: {
        Row: {
          id: string;
          facture_id: string;
          client_id: string;
          canal: CanalRelance;
          message: string;
          date_planifiee: string;
          date_envoi: string | null;
          statut: StatutRelance;
          erreur: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          facture_id: string;
          client_id: string;
          canal?: CanalRelance;
          message: string;
          date_planifiee: string;
          date_envoi?: string | null;
          statut?: StatutRelance;
          erreur?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          facture_id?: string;
          client_id?: string;
          canal?: CanalRelance;
          message?: string;
          date_planifiee?: string;
          date_envoi?: string | null;
          statut?: StatutRelance;
          erreur?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      v_factures_statut: {
        Row: {
          id: string | null;
          numero: string | null;
          client_id: string | null;
          client: string | null;
          station_id: string | null;
          date_emission: string | null;
          date_echeance: string | null;
          montant_net: number | null;
          montant_regle: number | null;
          reste_du: number | null;
          statut_calcule: string | null;
          jours_retard: number | null;
        };
        Relationships: [];
      };
      v_encours_clients: {
        Row: {
          client_id: string | null;
          nom: string | null;
          compte_tiers: string | null;
          telephone: string | null;
          plafond_credit: number | null;
          encours_total: number | null;
          a_jour: number | null;
          retard_0_30: number | null;
          retard_31_60: number | null;
          retard_61_90: number | null;
          retard_90_plus: number | null;
          plafond_depasse: boolean | null;
        };
        Relationships: [];
      };
      v_stations_manquantes: {
        Row: {
          station_id: string | null;
          numero: string | null;
          code_site: string | null;
          nom_officiel: string | null;
          date_traitee: string | null;
        };
        Relationships: [];
      };
      v_kpi_journalier: {
        Row: {
          date_vente: string | null;
          nb_lignes: number | null;
          quantite_totale: number | null;
          montant_total: number | null;
          clients_actifs: number | null;
          stations_actives: number | null;
          ca_especes: number | null;
          ca_credit: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      mon_role: {
        Args: Record<string, never>;
        Returns: RoleUtilisateur;
      };
      ma_station: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: {
      role_utilisateur: RoleUtilisateur;
      statut_station: StatutStation;
      type_vente: TypeVente;
      statut_facture: StatutFacture;
      mode_reglement: ModeReglement;
      statut_commande: StatutCommande;
      canal_relance: CanalRelance;
      statut_relance: StatutRelance;
      type_anomalie: TypeAnomalie;
    };
    CompositeTypes: Record<string, never>;
  };
};

/* Raccourcis pratiques pour le code applicatif. */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
