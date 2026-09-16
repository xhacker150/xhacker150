-- ============================================================
-- Données de démonstration (optionnel)
-- À exécuter dans l'éditeur SQL Supabase APRÈS la migration.
-- Crée des clients et des factures à différents stades de retard.
-- ============================================================
BEGIN;

INSERT INTO clients (code, raison_sociale, type, nif, ville, telephone, email, contact_nom, delai_paiement_jours, plafond_credit, reference_sage) VALUES
 ('411SONI', 'SONIDEP SA', 'entreprise', 'NIF-000123', 'Niamey', '+227 20 73 00 01', 'comptabilite@sonidep.example', 'Mme Halima Issoufou', 30, 5000000, '411SONI'),
 ('411NITE', 'NIGER TELECOMS', 'entreprise', 'NIF-000456', 'Niamey', '+227 20 73 00 02', 'fournisseurs@nigertelecoms.example', 'M. Abdou Maiga', 45, 0, '411NITE'),
 ('411BTPS', 'BTP SAHEL SARL', 'entreprise', 'NIF-000789', 'Maradi', '+227 96 00 00 03', 'gerant@btpsahel.example', 'M. Ibrahim Souley', 30, 2000000, '411BTPS'),
 ('411MAIR', 'MAIRIE DE DOSSO', 'administration', NULL, 'Dosso', '+227 20 65 00 04', 'finances@dosso.example', 'M. le Receveur', 60, 0, '411MAIR'),
 ('411ALIO', 'ALIO Moussa', 'particulier', NULL, 'Niamey', '+227 90 00 00 05', 'alio.moussa@example.com', NULL, 15, 300000, '411ALIO');

-- Grands comptes : scénario allégé
UPDATE clients SET scenario_id = (SELECT id FROM scenarios_relance WHERE nom = 'Scénario grands comptes') WHERE code IN ('411NITE', '411MAIR');

-- Factures (émises) : soldées, en cours, en retard de 10 / 35 / 70 / 130 jours
SELECT creer_facture((SELECT id FROM clients WHERE code='411SONI'), '[{"designation":"Fourniture carburant - lot 1","quantite":1200,"prix_unitaire":650,"taux_tva":19}]', CURRENT_DATE - 95, CURRENT_DATE - 65, 'Carburant janvier', 'FA-SAGE-1001', NULL, true);
SELECT creer_facture((SELECT id FROM clients WHERE code='411SONI'), '[{"designation":"Fourniture carburant - lot 2","quantite":800,"prix_unitaire":650,"taux_tva":19}]', CURRENT_DATE - 40, CURRENT_DATE - 10, 'Carburant mars', 'FA-SAGE-1002', NULL, true);
SELECT creer_facture((SELECT id FROM clients WHERE code='411SONI'), '[{"designation":"Lubrifiants","quantite":50,"prix_unitaire":12000,"taux_tva":19}]', CURRENT_DATE - 5, NULL, 'Lubrifiants', 'FA-SAGE-1003', NULL, true);
SELECT creer_facture((SELECT id FROM clients WHERE code='411NITE'), '[{"designation":"Maintenance groupes électrogènes","quantite":3,"prix_unitaire":450000,"taux_tva":19}]', CURRENT_DATE - 80, CURRENT_DATE - 35, 'Maintenance T1', 'FA-SAGE-1004', NULL, true);
SELECT creer_facture((SELECT id FROM clients WHERE code='411BTPS'), '[{"designation":"Location engins (jours)","quantite":12,"prix_unitaire":85000,"taux_tva":19},{"designation":"Transport","quantite":1,"prix_unitaire":150000,"taux_tva":19}]', CURRENT_DATE - 100, CURRENT_DATE - 70, 'Chantier route Maradi', 'FA-SAGE-1005', NULL, true);
SELECT creer_facture((SELECT id FROM clients WHERE code='411MAIR'), '[{"designation":"Éclairage public - phase 2","quantite":1,"prix_unitaire":3200000,"taux_tva":19}]', CURRENT_DATE - 190, CURRENT_DATE - 130, 'Marché EP-2', 'FA-SAGE-1006', NULL, true);
SELECT creer_facture((SELECT id FROM clients WHERE code='411ALIO'), '[{"designation":"Installation solaire domestique","quantite":1,"prix_unitaire":420000,"taux_tva":19}]', CURRENT_DATE - 20, NULL, 'Kit solaire', 'FA-SAGE-1007', NULL, true);
SELECT creer_facture((SELECT id FROM clients WHERE code='411ALIO'), '[{"designation":"Batterie de remplacement","quantite":1,"prix_unitaire":95000,"taux_tva":19}]', CURRENT_DATE - 2, NULL, 'Batterie', NULL, NULL, false);

-- Règlements : la première facture SONIDEP est soldée, NIGER TELECOMS a payé partiellement
SELECT enregistrer_reglement((SELECT id FROM clients WHERE code='411SONI'), 928200, CURRENT_DATE - 60, 'virement', 'VIR 2026-0455', 'BOA Niger', 'Solde lot 1');
SELECT enregistrer_reglement((SELECT id FROM clients WHERE code='411NITE'), 800000, CURRENT_DATE - 20, 'cheque', 'CHQ 1187', 'SONIBANK', 'Acompte maintenance');

-- Une promesse de paiement et un litige
INSERT INTO promesses_paiement (client_id, facture_id, montant, date_promise, commentaire)
VALUES ((SELECT id FROM clients WHERE code='411BTPS'), (SELECT id FROM factures WHERE reference_externe='FA-SAGE-1005'), 700000, CURRENT_DATE + 5, 'Promesse obtenue par téléphone');
INSERT INTO litiges (facture_id, client_id, motif)
VALUES ((SELECT id FROM factures WHERE reference_externe='FA-SAGE-1006'), (SELECT id FROM clients WHERE code='411MAIR'), 'PV de réception non signé, la mairie conteste la phase 2');

COMMIT;

-- Ensuite, lancez le moteur pour voir les relances : SELECT * FROM generer_relances();
