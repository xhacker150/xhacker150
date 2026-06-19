-- =====================================================================
--  LOT 3 — INTÉGRATION SAGE 100 GESCOM
--  Table de journalisation des synchronisations + colonne source sur écritures
--  Idempotent (rejouable sans risque).
-- =====================================================================

-- 1. Journal de synchronisation Sage
CREATE TABLE IF NOT EXISTS public.sage_sync_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  direction  text        NOT NULL CHECK (direction IN ('import','export')),
  entity     text        NOT NULL,
  count      int         NOT NULL DEFAULT 0,
  status     text        NOT NULL DEFAULT 'ok',
  details    text
);

ALTER TABLE public.sage_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sage_log_read ON public.sage_sync_log;
CREATE POLICY sage_log_read ON public.sage_sync_log FOR SELECT
  USING (public.is_admin() OR public.is_compta());

-- 2. Colonne source sur écritures (pour distinguer les écritures Sage importées)
ALTER TABLE public.ecritures ADD COLUMN IF NOT EXISTS source     text;
ALTER TABLE public.ecritures ADD COLUMN IF NOT EXISTS ref_externe text;

-- 3. Index pour les requêtes fréquentes de l'API REST
CREATE INDEX IF NOT EXISTS bons_station_created ON public.bons(station_id, created_at);
CREATE INDEX IF NOT EXISTS bons_bl ON public.bons(bl) WHERE bl IS NOT NULL;
