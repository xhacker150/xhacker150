-- Recette « chiffres au franc » sur les témoins réels (CDC-05 §3.5), HORS CI.
-- 1. Charger dans le CRM (écran SOURCE ou pont) les fichiers sql_out archivés à la date d'arrêté.
-- 2. Copier recette/temoins.json.example en recette/temoins.json (hors dépôt) et renseigner les valeurs.
-- 3. Exécuter : psql -v ON_ERROR_STOP=1 -v temoins="$(cat recette/temoins.json)" -f supabase/tests/recette_temoins.sql
-- Chaque écart est un bug bloquant (règle n°1).
\set ON_ERROR_STOP on
DO $$
DECLARE j JSONB := :'temoins'::jsonb; t JSONB; v NUMERIC; d DATE; n INT := 0;
BEGIN
  SELECT date_extraction INTO d FROM extractions WHERE statut = 'active';
  FOR t IN SELECT * FROM jsonb_array_elements(j->'temoins') LOOP
    CONTINUE WHEN (t->>'date_arrete')::DATE <> d;   -- seuls les témoins de la date d'arrêté chargée sont vérifiés
    SELECT solde INTO v FROM clients_calc WHERE compte = t->>'compte';
    IF v IS NULL THEN RAISE EXCEPTION 'Témoin % : compte % absent', t->>'code', t->>'compte'; END IF;
    IF v <> (t->>'solde_attendu')::NUMERIC THEN RAISE EXCEPTION 'Témoin % : solde % attendu %', t->>'code', v, t->>'solde_attendu'; END IF;
    IF t ? 'debits_hors_ran_attendus' AND (SELECT debits_hors_ran FROM clients_calc WHERE compte = t->>'compte') <> (t->>'debits_hors_ran_attendus')::NUMERIC THEN
      RAISE EXCEPTION 'Témoin % : débits hors RAN', t->>'code'; END IF;
    n := n + 1;
  END LOOP;
  IF (j->'bouclage_top_10'->>'date_arrete')::DATE = d THEN
    SELECT SUM(solde) INTO v FROM (SELECT solde FROM clients_calc WHERE solde > 0 ORDER BY solde DESC LIMIT 10) x;
    IF v <> (j->'bouclage_top_10'->>'total_attendu')::NUMERIC THEN RAISE EXCEPTION 'Bouclage top 10 : % attendu %', v, j->'bouclage_top_10'->>'total_attendu'; END IF;
  END IF;
  RAISE NOTICE 'RECETTE TÉMOINS : % témoin(s) vérifié(s) au franc à l''arrêté du %', n, d;
END $$;
