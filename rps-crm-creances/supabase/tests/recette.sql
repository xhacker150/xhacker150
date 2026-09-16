-- ============================================================
-- RECETTE SQL — rejoue le scénario synthétique (pont/donnees_synthetiques.py --sql) et vérifie
-- les règles du CDC-05 §3 / CLAUDE.md. Base jetable ; tout est annulé par ROLLBACK.
--   psql -v ON_ERROR_STOP=1 -v charge=/tmp/charge.sql -f supabase/tests/recette.sql
-- Prérequis : stub auth + migrations appliqués (voir .github/workflows/recette.yml).
-- ============================================================
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

-- 0. Comptes de test : tout nouveau compte est inactif ; le DG est désigné par installer_dg()
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'dg@test.local', '{"nom":"DG Test"}'),
  ('22222222-2222-2222-2222-222222222222', 'reco@test.local', '{"nom":"Chargé Reco"}'),
  ('33333333-3333-3333-3333-333333333333', 'expl@test.local', '{"nom":"Lecteur"}');
DO $$ BEGIN
  IF (SELECT count(*) FROM profils WHERE actif) <> 0 THEN RAISE EXCEPTION 'Un nouveau compte doit être inactif'; END IF;
END $$;
SELECT installer_dg('dg@test.local');
UPDATE profils SET role = 'recouvrement', actif = true WHERE email = 'reco@test.local';
DO $$ BEGIN
  IF (SELECT role FROM profils WHERE email = 'dg@test.local') <> 'dg' OR NOT (SELECT actif FROM profils WHERE email = 'dg@test.local') THEN RAISE EXCEPTION 'installer_dg'; END IF;
  IF (SELECT h.role FROM habilitations h JOIN profils p ON p.id = h.user_id WHERE p.email = 'reco@test.local') <> 'recouvrement' THEN RAISE EXCEPTION 'habilitations non synchronisées'; END IF;
  RAISE NOTICE 'OK 0 — comptes, amorçage DG, habilitations';
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- 1. Chargement du jeu synthétique (lots numérotés + totaux annoncés) : crée la table temporaire "attendus"
\i :charge

DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN SELECT a.compte, a.solde AS att, c.solde AS sql, a.ran AS ran_att, c.ran AS ran_sql, a.regle AS regle_att, c.regle AS regle_sql, a.nb AS nb_att, c.nb_reglements AS nb_sql
             FROM attendus a FULL JOIN clients_calc c USING (compte) LOOP
    n := n + 1;
    IF r.att IS DISTINCT FROM r.sql THEN RAISE EXCEPTION 'SOLDE % : attendu % obtenu %', r.compte, r.att, r.sql; END IF;
    IF r.ran_att IS DISTINCT FROM r.ran_sql THEN RAISE EXCEPTION 'RAN % : attendu % obtenu %', r.compte, r.ran_att, r.ran_sql; END IF;
    IF r.regle_att IS DISTINCT FROM r.regle_sql THEN RAISE EXCEPTION 'REGLE % : attendu % obtenu %', r.compte, r.regle_att, r.regle_sql; END IF;
    IF r.nb_att IS DISTINCT FROM r.nb_sql THEN RAISE EXCEPTION 'NB REGL % : attendu % obtenu %', r.compte, r.nb_att, r.nb_sql; END IF;
  END LOOP;
  IF n <> 10 THEN RAISE EXCEPTION '10 comptes attendus, % trouvés', n; END IF;
  IF (SELECT nb_rejets FROM extractions WHERE statut = 'active') <> 0 THEN RAISE EXCEPTION 'rejets inattendus'; END IF;
  IF (SELECT count(*) FROM stations) < 5 THEN RAISE EXCEPTION 'référentiel stations non alimenté'; END IF;
  IF NOT EXISTS (SELECT 1 FROM stations WHERE numero = '12') THEN RAISE EXCEPTION 'numéro de station 12 non extrait'; END IF;
  IF (SELECT count(*) FROM clients_historique) <> 10 THEN RAISE EXCEPTION 'historique non alimenté'; END IF;
  RAISE NOTICE 'OK 1 — 10 soldes au franc, stations, historique';
END $$;

-- 2. Les 4 cas imposés par CLAUDE.md, assertés un par un
DO $$
DECLARE c clients_calc;
BEGIN
  SELECT * INTO c FROM clients_calc WHERE compte = '41110001';
  IF c.ran <> 250000000 THEN RAISE EXCEPTION 'RAN débiteur 41110001 : %', c.ran; END IF;
  SELECT * INTO c FROM clients_calc WHERE compte = '41120020';
  IF c.ran <> -31300 OR c.solde <> -47950 THEN RAISE EXCEPTION 'RAN créditeur / avance 41120020 : % / %', c.ran, c.solde; END IF;
  SELECT * INTO c FROM clients_calc WHERE compte = '41110002';
  IF c.ran <> 40000000 THEN RAISE EXCEPTION 'RAN en cours d''année 41110002 : %', c.ran; END IF;
  IF c.regle <> 487200000 OR c.debits_hors_ran <> 30000000 OR c.nb_regularisations <> 1 OR c.nb_reglements <> 15 THEN
    RAISE EXCEPTION 'Régularisation 41110002 : regle % debits % regul % nb %', c.regle, c.debits_hors_ran, c.nb_regularisations, c.nb_reglements; END IF;
  IF (SELECT sum(CASE WHEN sens = 1 THEN montant ELSE -montant END) FROM vue_ecritures WHERE piece = '17283') <> 0 THEN RAISE EXCEPTION 'Régularisation 17283 non neutre'; END IF;
  IF NOT (SELECT est_regularisation FROM vue_ecritures WHERE piece = '17283' AND sens = 1) THEN RAISE EXCEPTION 'régularisation non détectée'; END IF;
  SELECT * INTO c FROM clients_calc WHERE compte = '41110030';
  IF c.debits_hors_ran <> 2044100 OR c.nb_reglements <> 0 OR c.typologie_auto <> 'compte muet' OR c.solde <> c.ran + c.facture + 2044100 THEN
    RAISE EXCEPTION 'Débits hors RAN 41110030 : % / %', c.debits_hors_ran, c.typologie_auto; END IF;
  IF (SELECT solde FROM clients_calc WHERE compte = '41110040') <> -80220000 THEN RAISE EXCEPTION 'Créditeur 41110040'; END IF;
  IF (SELECT statut FROM vue_clients WHERE compte = '41110040') <> 'créditeur' THEN RAISE EXCEPTION 'Statut créditeur'; END IF;
  IF (SELECT solde FROM clients_calc WHERE compte = '41110060') <> 0 OR (SELECT statut FROM vue_clients WHERE compte = '41110060') <> 'soldé' THEN RAISE EXCEPTION 'Compte soldé 41110060'; END IF;
  IF (SELECT typologie_auto FROM clients_calc WHERE compte = '41120010') <> 'fil de l''eau (mobile money)' THEN RAISE EXCEPTION 'typologie fil de l''eau : %', (SELECT typologie_auto FROM clients_calc WHERE compte = '41120010'); END IF;
  IF (SELECT typologie_auto FROM clients_calc WHERE compte = '41150003') <> 'BV / Bénin' OR NOT (SELECT bv_bloque FROM clients_calc WHERE compte = '41150003') THEN RAISE EXCEPTION 'BV : ratio bons/réglés non bloquant'; END IF;
  IF (SELECT actif FROM clients_calc WHERE compte = '41110070') THEN RAISE EXCEPTION 'client inactif marqué actif'; END IF;
  RAISE NOTICE 'OK 2 — RAN débiteur/créditeur, débits hors RAN, régularisation, typologies, BV';
END $$;

-- 3. Remise multi-clients (pièce 2984) et « réglé via » (OD 13)
DO $$
BEGIN
  IF (SELECT count(DISTINCT compte) FROM vue_ecritures WHERE piece = '2984' AND est_reglement) <> 2
     OR (SELECT sum(montant) FROM vue_ecritures WHERE piece = '2984') <> 100200000 THEN RAISE EXCEPTION 'Remise multi-clients 2984'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vue_pieces_multi_clients WHERE piece = '2984' AND nb_comptes = 2) THEN RAISE EXCEPTION 'détection automatique multi-clients'; END IF;
  IF (SELECT count(*) FROM vue_ecritures WHERE piece = 'OD13') <> 2 THEN RAISE EXCEPTION 'réglé via : 2 écritures attendues'; END IF;
  RAISE NOTICE 'OK 3 — remise multi-clients, réglé via';
END $$;

-- 4. Cadence individuelle (leçon SINOMA) et bouclage du classement top 10
DO $$
DECLARE c vue_clients; s NUMERIC; t NUMERIC; tb JSONB;
BEGIN
  SELECT * INTO c FROM vue_clients WHERE compte = '41110002';
  IF c.cadence_jours <> 15 OR c.seuil_alerte_jours <> 23 OR NOT c.decroche OR c.statut <> 'à relancer' THEN
    RAISE EXCEPTION 'Cadence 41110002 : % / % / % / %', c.cadence_jours, c.seuil_alerte_jours, c.decroche, c.statut; END IF;
  SELECT * INTO c FROM vue_clients WHERE compte = '41120010';   -- cadence 5 j → 1,5 × 5 = 8 → borne basse 10
  IF c.cadence_jours <> 5 OR c.seuil_alerte_jours <> 10 THEN RAISE EXCEPTION 'Borne basse 10 j non appliquée : % / %', c.cadence_jours, c.seuil_alerte_jours; END IF;
  SELECT * INTO c FROM vue_clients WHERE compte = '41120050';   -- cadence 64 j → borne haute 45
  IF c.seuil_alerte_jours <> 45 THEN RAISE EXCEPTION 'Borne haute 45 j non appliquée'; END IF;
  SELECT * INTO c FROM vue_clients WHERE compte = '41110070';
  IF c.seuil_alerte_jours <> 30 OR c.cadence_jours IS NOT NULL THEN RAISE EXCEPTION 'Filet générique 30 j'; END IF;
  SELECT sum(solde) INTO s FROM clients_calc WHERE solde > 0;
  tb := tableau_de_bord();
  SELECT sum((d->>'solde')::NUMERIC) INTO t FROM jsonb_array_elements(tb->'top_debiteurs') d;
  IF s <> t OR s <> (tb->>'creances_totales')::NUMERIC OR s <> (tb->>'total_top_10')::NUMERIC THEN RAISE EXCEPTION 'Bouclage top 10 : % vs % vs %', s, t, tb->>'total_top_10'; END IF;
  IF jsonb_array_length(tb->'courbe_12_mois') <> 12 THEN RAISE EXCEPTION 'courbe 12 mois'; END IF;
  IF (tb->'balance_dernier_reglement'->>'plus_90')::NUMERIC < 270700100 THEN RAISE EXCEPTION 'balance âgée : compte muet attendu en +90 j'; END IF;
  RAISE NOTICE 'OK 4 — cadence, bouclage top 10, tableau de bord';
END $$;

-- 5. Règles métier et droits (rôles applicatifs)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);   -- compte inactif
DO $$ BEGIN
  IF (SELECT count(*) FROM clients_calc) <> 0 THEN RAISE EXCEPTION 'un compte inactif voit les clients'; END IF;
  BEGIN PERFORM creer_action('41110001', 'relance', 'x'); RAISE EXCEPTION 'compte inactif a pu créer une action';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Droits insuffisants%' THEN RAISE; END IF; END;
  BEGIN PERFORM pont_debut_extraction(CURRENT_DATE, 'api'); RAISE EXCEPTION 'compte inactif a pu ouvrir une extraction';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Chargement réservé%' THEN RAISE; END IF; END;
  BEGIN UPDATE profils SET role = 'dg', actif = true WHERE id = auth.uid(); END;   -- RLS : 0 ligne visible
  IF EXISTS (SELECT 1 FROM profils WHERE id = auth.uid() AND role = 'dg') THEN RAISE EXCEPTION 'escalade de rôle'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
UPDATE profils SET actif = true WHERE email = 'expl@test.local';   -- activé par le DG (rôle exploitation)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM vue_clients) <> 10 THEN RAISE EXCEPTION 'exploitation doit lire les clients'; END IF;
  IF (SELECT count(*) FROM audit) <> 0 THEN RAISE EXCEPTION 'exploitation voit l''audit'; END IF;
  BEGIN UPDATE profils SET role = 'dg' WHERE id = auth.uid(); RAISE EXCEPTION 'escalade de rôle acceptée';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Seul le DG%' THEN RAISE; END IF; END;
  BEGIN PERFORM creer_action('41110001', 'relance', 'x'); RAISE EXCEPTION 'exploitation a pu créer une action';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Droits insuffisants%' THEN RAISE; END IF; END;
  BEGIN PERFORM recalculer_clients(); RAISE EXCEPTION 'exploitation a pu recalculer';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Recalcul réservé%' THEN RAISE; END IF; END;
  RAISE NOTICE 'OK 5a — lecture seule : ni action, ni extraction, ni escalade';
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);   -- recouvrement
DO $$ DECLARE v UUID; BEGIN
  BEGIN PERFORM creer_action('41110040', 'relance', 'x'); RAISE EXCEPTION 'relance d''un créditeur acceptée';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Client créditeur%' THEN RAISE; END IF; END;
  BEGIN PERFORM creer_action('41110001', 'promesse', 'x', 1000, CURRENT_DATE + 10); RAISE EXCEPTION 'promesse < 50 %% acceptée';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Montant promis%' THEN RAISE; END IF; END;
  BEGIN PERFORM creer_action('41110001', 'contentieux', 'x'); RAISE EXCEPTION 'contentieux hors DG accepté';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%décision du DG%' THEN RAISE; END IF; END;
  BEGIN INSERT INTO actions (compte, type, note) VALUES ('41110001', 'note', 'direct'); RAISE EXCEPTION 'écriture directe dans actions acceptée';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- la limite de crédit est réservée au DG : un chargé de recouvrement ne peut pas la poser
  INSERT INTO clients_ext (compte, notes) VALUES ('41110001', 'note reco');
  BEGIN INSERT INTO clients_ext (compte, limite_credit) VALUES ('41110002', 1000); RAISE EXCEPTION 'limite posée par le recouvrement';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'La limite de crédit%' THEN RAISE; END IF; END;
  v := creer_action('41110001', 'promesse', 'recette : deux virements de 50 M', 100000000, CURRENT_DATE + 10, NULL, NULL, NULL, CURRENT_DATE - 5);
  PERFORM set_config('test.promesse', v::TEXT, false);
  IF (SELECT auteur FROM actions WHERE id = v) <> 'Chargé Reco' THEN RAISE EXCEPTION 'auteur non journalisé'; END IF;
  BEGIN DELETE FROM actions WHERE id = v;   -- RLS : aucune politique DELETE → 0 ligne ; trigger : refus explicite
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Suppression interdite%' THEN RAISE; END IF; END;
  IF NOT EXISTS (SELECT 1 FROM actions WHERE id = v) THEN RAISE EXCEPTION 'suppression d''action acceptée'; END IF;
  IF (SELECT statut FROM vue_clients WHERE compte = '41110001') <> 'promesse' THEN RAISE EXCEPTION 'pipeline : statut promesse attendu'; END IF;
  RAISE NOTICE 'OK 5b — refus métier, limite DG, pas de suppression, pipeline';
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);   -- DG
DO $$ DECLARE v UUID; BEGIN
  BEGIN PERFORM creer_action('41110030', 'contentieux', 'sans mise en demeure'); RAISE EXCEPTION 'contentieux sans mise en demeure accepté';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%pré-contentieuse%' THEN RAISE; END IF; END;
  v := creer_action('41110030', 'mise_en_demeure', 'MED envoyée');
  v := creer_action('41110030', 'contentieux', 'Décision DG');
  IF (SELECT statut FROM vue_clients WHERE compte = '41110030') <> 'contentieux' THEN RAISE EXCEPTION 'statut contentieux'; END IF;
  UPDATE clients_ext SET limite_credit = 100000000 WHERE compte = '41110001';
  IF NOT (SELECT limite_depassee FROM vue_clients WHERE compte = '41110001') THEN RAISE EXCEPTION 'limite dépassée non détectée'; END IF;
  IF reserver_numero('MED') !~ '^MED-\d{4}-0001$' THEN RAISE EXCEPTION 'numérotation'; END IF;
  RAISE NOTICE 'OK 5c — DG : mise en demeure puis contentieux, limite, numérotation';
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit WHERE quoi = 'action_promesse' AND compte = '41110001') THEN RAISE EXCEPTION 'audit absent'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM clients_calc) <> 0 THEN RAISE EXCEPTION 'anon voit clients_calc'; END IF;
  BEGIN PERFORM pont_activer_extraction(gen_random_uuid()); RAISE EXCEPTION 'anon peut activer une extraction';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM journaliser('x'); RAISE EXCEPTION 'anon peut journaliser';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'OK 5d — anon ne voit rien et n''exécute rien';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- 6. §9 (2) : un règlement saisi en compta sort la carte du pipeline (promesse tenue en DEUX virements de 50 M)
SELECT pont_debut_extraction(CURRENT_DATE, 'api', NULL, 'recette', NULL) AS ext2 \gset
SELECT set_config('test.ext2', :'ext2', false);
SELECT pont_ajouter_lignes(:'ext2', 'clients',     (SELECT jsonb_agg(jsonb_build_array(compte, intitule)) FROM sage_clients WHERE extraction_id = (SELECT id FROM extractions WHERE statut = 'active')), 1);
SELECT pont_ajouter_lignes(:'ext2', 'facturation', (SELECT jsonb_agg(jsonb_build_array(compte, mois, ht::text)) FROM sage_facturation WHERE extraction_id = (SELECT id FROM extractions WHERE statut = 'active')), 1);
SELECT pont_ajouter_lignes(:'ext2', 'ecritures',   (SELECT jsonb_agg(jsonb_build_array(compte, date_ecriture::text, journal, piece, ref_piece, intitule, sens, montant::text) ORDER BY ordre) FROM sage_ecritures WHERE extraction_id = (SELECT id FROM extractions WHERE statut = 'active')), 1);
SELECT pont_ajouter_lignes(:'ext2', 'ecritures',   jsonb_build_array(
    jsonb_build_array('41110001', (CURRENT_DATE - 3)::text, 'BQECOB', 'BQ9998', '', 'REMISE CHEQUES 50M', 1, '50000000.00'),
    jsonb_build_array('41110001', (CURRENT_DATE - 1)::text, 'BQECOB', 'BQ9999', '', 'REMISE CHEQUES 50M', 1, '50000000.00'),
    jsonb_build_array('41110002', (CURRENT_DATE - 1)::text, 'NITA', 'NT77', '', 'VERS NITA', 1, '5000000.00')), 2);
SELECT pont_ajouter_lignes(:'ext2', 'livraisons',  (SELECT jsonb_agg(jsonb_build_array(compte, date_livraison::text, piece, ar_ref, designation, qte::text, montant_ht::text, depot) ORDER BY ordre) FROM sage_livraisons WHERE extraction_id = (SELECT id FROM extractions WHERE statut = 'active')), 1);
-- lot 2 renvoyé une seconde fois (timeout côté pont) : ignoré, pas de doublon
DO $$ DECLARE r JSONB; BEGIN
  r := pont_ajouter_lignes(current_setting('test.ext2')::uuid, 'ecritures', '[["41110001","2026-01-01","BQECOB","DOUBLON","","x",1,"1"]]'::jsonb, 2);
  IF NOT (r->>'deja_recu')::BOOLEAN THEN RAISE EXCEPTION 'lot rejoué non ignoré'; END IF;
END $$;
SELECT pont_activer_extraction(:'ext2');
DO $$
DECLARE a actions;
BEGIN
  SELECT * INTO a FROM actions WHERE id = current_setting('test.promesse')::uuid;
  IF a.statut <> 'fermee' OR a.resultat <> 'tenue' OR a.reglee_par_piece <> 'BQ9999' THEN RAISE EXCEPTION 'Promesse non fermée par le cumul des règlements : % / % / %', a.statut, a.resultat, a.reglee_par_piece; END IF;
  IF (SELECT solde FROM clients_calc WHERE compte = '41110001') <> 55280000 THEN RAISE EXCEPTION 'Solde après règlement'; END IF;
  IF (SELECT statut FROM vue_clients WHERE compte = '41110001') <> 'en cours' THEN RAISE EXCEPTION 'La carte doit sortir de la colonne promesse : %', (SELECT statut FROM vue_clients WHERE compte = '41110001'); END IF;
  IF (SELECT count(*) FROM sage_ecritures WHERE piece = 'DOUBLON') <> 0 THEN RAISE EXCEPTION 'doublon de lot inséré'; END IF;
  IF (SELECT statut FROM vue_clients WHERE compte = '41110002') <> 'en cours' THEN RAISE EXCEPTION 'CARGO a réglé : plus à relancer'; END IF;
  IF (SELECT count(*) FROM extractions WHERE statut = 'active') <> 1 OR (SELECT count(*) FROM extractions WHERE statut = 'archivee') <> 1 THEN RAISE EXCEPTION 'états des extractions'; END IF;
  RAISE NOTICE 'OK 6 — règlement saisi => promesse tenue (cumul), lot idempotent';
END $$;

-- 7. Robustesse du chargement : montants, périmètre, dates, doublons, extraction partielle refusée
SELECT pont_debut_extraction(CURRENT_DATE, 'fichiers') AS ext3 \gset
SELECT set_config('test.ext3', :'ext3', false);
DO $$
DECLARE r JSONB; e UUID := current_setting('test.ext3')::uuid;
BEGIN
  r := pont_ajouter_lignes(e, 'facturation', '[["41110001","2026-01","1 234,56"],["41110001","2026-02","1.234,56"],["41110001","2026-03","abc"]]'::jsonb);
  IF (r->>'acceptees')::INT <> 2 OR (r->>'rejetees')::INT <> 1 THEN RAISE EXCEPTION 'montants : %', r; END IF;
  IF (SELECT sum(ht) FROM sage_facturation WHERE extraction_id = e) <> 2469.12 THEN RAISE EXCEPTION 'virgule décimale / séparateur de milliers'; END IF;
  r := pont_ajouter_lignes(e, 'clients', '[["41110001","A"],["41110001","A doublon"],["41180001","CASH STATION"],["52110001","BANQUE"]]'::jsonb);
  IF (SELECT count(*) FROM sage_clients WHERE extraction_id = e) <> 1 OR (r->>'rejetees')::INT <> 3 THEN RAISE EXCEPTION 'périmètre 411 hors 41180 / doublon qr0 (compté comme rejet) : %', r; END IF;
  r := pont_ajouter_lignes(e, 'ecritures', '[["41110001","2030-01-01","BQECOB","F","","FUTUR",1,"1"],["41110001","1999-02-02","BQECOB","V","","1999",1,"1"],["41110001","2026-13-45","BQECOB","D","","DATE",1,"1"],["41110001","2026-05-05","ran","R","","minuscule",0,"5"]]'::jsonb);
  IF (r->>'acceptees')::INT <> 1 OR (r->>'rejetees')::INT <> 3 THEN RAISE EXCEPTION 'dates hors bornes : %', r; END IF;
  IF (SELECT journal FROM sage_ecritures WHERE extraction_id = e) <> 'RAN' THEN RAISE EXCEPTION 'journal non normalisé en majuscules'; END IF;
  BEGIN PERFORM pont_activer_extraction(e); RAISE EXCEPTION 'extraction avec rejets activée';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%rejetée%' THEN RAISE; END IF; END;
  PERFORM pont_abandonner_extraction(e);
  IF (SELECT statut FROM extractions WHERE id = e) <> 'abandonnee' THEN RAISE EXCEPTION 'abandon'; END IF;
  -- extraction propre mais partielle (1 client sur 10) : refusée sans forçage, les actions ouvertes ne sont pas touchées
  e := pont_debut_extraction(CURRENT_DATE, 'fichiers', NULL, 'partielle');
  PERFORM pont_ajouter_lignes(e, 'clients', '[["41110030","SOCIETE MUETTE SARL"]]'::jsonb, 1);
  PERFORM pont_ajouter_lignes(e, 'ecritures', '[["41110030","2026-09-01","BQBOA","P1","","REGLEMENT",1,"300000000"]]'::jsonb, 1);
  BEGIN PERFORM pont_activer_extraction(e); RAISE EXCEPTION 'extraction partielle activée';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Extraction partielle%' THEN RAISE; END IF; END;
  IF (SELECT statut FROM actions WHERE type = 'contentieux' AND compte = '41110030') <> 'ouverte' THEN RAISE EXCEPTION 'le contentieux a été fermé par une extraction refusée'; END IF;
  IF (SELECT count(*) FROM clients_calc) <> 10 THEN RAISE EXCEPTION 'clients_calc altérée par une extraction refusée'; END IF;
  PERFORM pont_abandonner_extraction(e);
  RAISE NOTICE 'OK 7 — chargement tolérant, périmètre, dates, extraction partielle refusée';
END $$;
-- extraction antérieure à l'active : refusée
DO $$ BEGIN
  BEGIN PERFORM pont_debut_extraction(CURRENT_DATE + 5, 'api'); RAISE EXCEPTION 'date future acceptée';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Date d''extraction%' THEN RAISE; END IF; END;
END $$;

-- 8. Exploitation (appels du service : cron, clé service_role) : sauvegarde quotidienne, contrôle de santé, récapitulatif
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$ DECLARE s JSONB; BEGIN
  s := sauvegarde_quotidienne();
  IF (s->>'actions')::INT < 3 THEN RAISE EXCEPTION 'sauvegarde : %', s; END IF;
  s := controle_sante();
  IF NOT (s->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'contrôle de santé en anomalie : %', s->'anomalies'; END IF;
  s := recapitulatif_quotidien();
  IF s->'alertes'->'comptes_muets' IS NULL THEN RAISE EXCEPTION 'récapitulatif'; END IF;
  RAISE NOTICE 'OK 8 — exploitation';
END $$;

ROLLBACK;
\echo 'RECETTE SQL : OK'
