-- Scénario de test de la logique métier (à exécuter sur la base locale après le stub auth)
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('11111111-1111-1111-1111-111111111111', 'admin@test.local', '{"nom":"Admin Test"}');
INSERT INTO auth.users (id, email) VALUES ('22222222-2222-2222-2222-222222222222', 'agent@test.local');
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

-- Le premier utilisateur est admin, le second agent
SELECT email, role FROM profils ORDER BY cree_le;

INSERT INTO clients (code, raison_sociale, email, telephone, delai_paiement_jours) VALUES
 ('CL001', 'SONIDEP', 'compta@sonidep.ne', '+22790000001', 30),
 ('CL002', 'NIGER TELECOM', 'finance@nigertelecom.ne', '+22790000002', 45);

-- Facture 1 : émise, échéance dépassée de 20 jours
SELECT creer_facture((SELECT id FROM clients WHERE code='CL001'),
  '[{"designation":"Carburant","quantite":100,"prix_unitaire":1000,"taux_tva":19},{"designation":"Livraison","quantite":1,"prix_unitaire":5000}]'::jsonb,
  CURRENT_DATE - 50, CURRENT_DATE - 20, 'Livraison carburant', 'SAGE-0001', NULL, true) AS f1 \gset
SELECT set_config('test.f1', :'f1', false);
-- Facture 2 : émise, non échue
SELECT creer_facture((SELECT id FROM clients WHERE code='CL001'),
  '[{"designation":"Lubrifiants","quantite":10,"prix_unitaire":20000}]'::jsonb,
  CURRENT_DATE, NULL, 'Lubrifiants', NULL, NULL, true) AS f2 \gset
SELECT set_config('test.f2', :'f2', false);
-- Facture 3 : brouillon
SELECT creer_facture((SELECT id FROM clients WHERE code='CL002'),
  '[{"designation":"Prestation","quantite":1,"prix_unitaire":50000}]'::jsonb) AS f3 \gset
SELECT set_config('test.f3', :'f3', false);

SELECT numero, statut, montant_ht, montant_tva, montant_ttc, reste_a_payer, jours_retard, tranche_age FROM vue_factures ORDER BY numero;

-- Les montants : F1 = 100*1000 = 100000 HT + 19000 TVA + 5000 HT + 950 TVA = 105000 HT / 19950 TVA / 124950 TTC
DO $$ DECLARE f RECORD; BEGIN
  SELECT * INTO f FROM factures WHERE id = current_setting('test.f1')::uuid;
  IF f.montant_ht <> 105000 OR f.montant_tva <> 19950 OR f.montant_ttc <> 124950 THEN RAISE EXCEPTION 'Montants F1 incorrects: % % %', f.montant_ht, f.montant_tva, f.montant_ttc; END IF;
  IF f.statut <> 'emise' THEN RAISE EXCEPTION 'F1 devrait être émise'; END IF;
END $$;

-- Moteur de relance : jour J -> F1 (20 j de retard) saute le rappel avant échéance et passe au niveau 2 ; F2 (échéance J+30) rien
SELECT facture_numero, niveau, canal, automatique FROM generer_relances(CURRENT_DATE);
DO $$ BEGIN IF (SELECT niveau_relance FROM factures WHERE id = current_setting('test.f1')::uuid) <> 2 THEN RAISE EXCEPTION 'F1 devrait démarrer au niveau 2'; END IF; END $$;
-- Délai min 3 jours : rien le lendemain
SELECT count(*) AS relances_j1 FROM generer_relances(CURRENT_DATE + 1);
-- J+3 : niveau 3 (seuil 15 j) ; J+6 : niveau 4 ? (seuil 30 j : 26 j -> non) ; J+10 : niveau 4 ; J+25 : niveau 5 (mise en demeure) + F2 niveau 1 (J-5 avant échéance)
SELECT facture_numero, niveau FROM generer_relances(CURRENT_DATE + 3);
SELECT count(*) AS relances_j6 FROM generer_relances(CURRENT_DATE + 6);
SELECT facture_numero, niveau, canal FROM generer_relances(CURRENT_DATE + 10);
SELECT facture_numero, niveau, canal FROM generer_relances(CURRENT_DATE + 25);
SELECT code, statut FROM clients WHERE code = 'CL001';
DO $$ BEGIN
  IF (SELECT statut FROM clients WHERE code='CL001') <> 'bloque' THEN RAISE EXCEPTION 'Le client devrait être bloqué après mise en demeure'; END IF;
  IF (SELECT niveau_relance FROM factures WHERE id = current_setting('test.f1')::uuid) <> 5 THEN RAISE EXCEPTION 'F1 devrait être au niveau 5'; END IF;
END $$;
SELECT niveau, type, canal, statut, automatique, sujet FROM actions_recouvrement WHERE facture_id = :'f1' ORDER BY niveau;
SELECT contenu FROM actions_recouvrement WHERE facture_id = :'f1' AND niveau = 2;

-- Promesse de paiement puis vérification (rompue)
INSERT INTO promesses_paiement (client_id, facture_id, montant, date_promise) VALUES ((SELECT id FROM clients WHERE code='CL001'), :'f1', 50000, CURRENT_DATE - 1);
SELECT verifier_promesses(CURRENT_DATE) AS promesses_rompues;
SELECT statut FROM promesses_paiement;

-- Règlement partiel avec lettrage FIFO : 150000 -> F1 (124950) soldée, F2 (238000) partiellement (25050)
SELECT enregistrer_reglement((SELECT id FROM clients WHERE code='CL001'), 150000, CURRENT_DATE, 'virement', 'VIR-123', 'BOA') AS r1 \gset
SELECT numero, statut, montant_regle, reste_a_payer, date_paiement FROM vue_factures WHERE client_id = (SELECT id FROM clients WHERE code='CL001') ORDER BY numero;
DO $$ BEGIN
  IF (SELECT statut FROM factures WHERE id = current_setting('test.f1')::uuid) <> 'payee' THEN RAISE EXCEPTION 'F1 devrait être payée'; END IF;
  IF (SELECT montant_regle FROM factures WHERE id = current_setting('test.f2')::uuid) <> 25050 THEN RAISE EXCEPTION 'F2 devrait avoir 25050 réglés'; END IF;
  IF (SELECT statut FROM clients WHERE code='CL001') <> 'actif' THEN RAISE EXCEPTION 'Le client devrait être réactivé (plus d''échu)'; END IF;
END $$;

-- Annulation du règlement : retour à l'état initial
SELECT annuler_reglement(:'r1', 'Chèque impayé');
SELECT numero, statut, montant_regle FROM factures WHERE client_id = (SELECT id FROM clients WHERE code='CL001') ORDER BY numero;
DO $$ BEGIN
  IF (SELECT statut FROM factures WHERE id = current_setting('test.f1')::uuid) <> 'emise' THEN RAISE EXCEPTION 'F1 devrait redevenir émise'; END IF;
END $$;

-- Lettrage manuel ciblé sur F2
SELECT enregistrer_reglement((SELECT id FROM clients WHERE code='CL001'), 38000, CURRENT_DATE, 'mobile_money', NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('facture_id', :'f2', 'montant', 38000))) AS r2 \gset
SELECT numero, statut, montant_regle FROM factures WHERE id = :'f2';

-- Litige : suspend les relances
INSERT INTO litiges (facture_id, client_id, motif) VALUES (:'f1', (SELECT id FROM clients WHERE code='CL001'), 'Quantité contestée');
SELECT litige FROM factures WHERE id = :'f1';
SELECT count(*) AS relances_avec_litige FROM generer_relances(CURRENT_DATE + 60);
UPDATE litiges SET statut = 'resolu', resolu_le = now();
SELECT litige FROM factures WHERE id = :'f1';

-- Annulation d'une facture brouillon
SELECT annuler_facture(:'f3', 'Erreur de saisie');
SELECT statut FROM factures WHERE id = :'f3';

-- Tableau de bord et situation client
SELECT jsonb_pretty(tableau_de_bord() - 'encaissements_6_mois' - 'top_debiteurs');
SELECT jsonb_pretty(situation_client((SELECT id FROM clients WHERE code='CL001')));
SELECT code, encours_total, echu_total, t_0_30, non_echu FROM vue_balance_agee ORDER BY code;

-- RLS : l'agent voit les clients mais ne peut pas modifier les paramètres
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SELECT count(*) AS clients_visibles_agent FROM clients;
SELECT est_admin() AS agent_est_admin, est_utilisateur_actif() AS agent_actif;
UPDATE parametres SET valeur = '{}' WHERE cle = 'societe';
SELECT (valeur->>'nom') AS nom_societe_inchange FROM parametres WHERE cle='societe';
ROLLBACK;
