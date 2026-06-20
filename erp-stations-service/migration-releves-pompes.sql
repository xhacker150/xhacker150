-- =====================================================================
--  LOT 4 — RELEVÉS POMPES (index + recouvrement par pompe et par jour)
--  Conforme à la fiche opérationnelle : index départ/arrivée, espèce,
--  bons, SPA, SAE, retour par pompe. Idempotent.
-- =====================================================================

-- 1. Table des relevés journaliers par pompe
CREATE TABLE IF NOT EXISTS public.releves_pompes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id     uuid        NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  pompe_id       uuid        NOT NULL REFERENCES public.pompes(id)   ON DELETE CASCADE,
  fiche_id       uuid        REFERENCES public.fiches(id),
  d_year         int         NOT NULL,
  d_month        int         NOT NULL,
  d_day          int         NOT NULL,
  index_depart   numeric,
  index_arrivee  numeric,
  pu             numeric,
  retour         numeric     NOT NULL DEFAULT 0,
  espece         numeric     NOT NULL DEFAULT 0,
  bons           numeric     NOT NULL DEFAULT 0,
  spa            numeric     NOT NULL DEFAULT 0,
  sae            numeric     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pompe_id, d_year, d_month, d_day)
);

ALTER TABLE public.releves_pompes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rp_read ON public.releves_pompes;
DROP POLICY IF EXISTS rp_ins  ON public.releves_pompes;
DROP POLICY IF EXISTS rp_upd  ON public.releves_pompes;
DROP POLICY IF EXISTS rp_del  ON public.releves_pompes;

CREATE POLICY rp_read ON public.releves_pompes FOR SELECT
  USING (public.is_compta() OR station_id = ANY(public.my_station_ids()));
CREATE POLICY rp_ins ON public.releves_pompes FOR INSERT
  WITH CHECK (public.can_saisir() AND station_id = ANY(public.my_station_ids()));
CREATE POLICY rp_upd ON public.releves_pompes FOR UPDATE
  USING (public.can_saisir() AND station_id = ANY(public.my_station_ids()))
  WITH CHECK (public.can_saisir() AND station_id = ANY(public.my_station_ids()));
CREATE POLICY rp_del ON public.releves_pompes FOR DELETE
  USING (public.can_saisir() AND station_id = ANY(public.my_station_ids()));

-- 2. Policies sur pompes (lecture pour tous les authentifiés, gestion admin)
DROP POLICY IF EXISTS pompes_read ON public.pompes;
DROP POLICY IF EXISTS pompes_ins  ON public.pompes;
DROP POLICY IF EXISTS pompes_del  ON public.pompes;

CREATE POLICY pompes_read ON public.pompes FOR SELECT USING (true);
CREATE POLICY pompes_ins  ON public.pompes FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY pompes_del  ON public.pompes FOR DELETE USING (public.is_admin());

-- 3. Realtime
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.releves_pompes;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.pompes;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
