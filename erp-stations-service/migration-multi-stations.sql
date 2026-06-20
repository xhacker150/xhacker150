-- =====================================================================
--  MIGRATION : multi-stations par utilisateur + nouveaux rôles
--  À exécuter dans : Supabase -> SQL Editor -> New query -> Run
--  (idempotent : peut être ré-exécuté sans risque)
-- =====================================================================

-- 1. Colonne station_ids (tableau) + migration des données existantes
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS station_ids uuid[] DEFAULT '{}';
UPDATE public.profiles
   SET station_ids = ARRAY[station_id]
 WHERE station_id IS NOT NULL
   AND (station_ids IS NULL OR array_length(station_ids,1) IS NULL);

-- 2. Nouveaux rôles autorisés
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','gerant','comptable','agent_facturation','chef_piste'));

-- 3. Helpers RLS
--    my_station_ids() : toutes les stations de l'utilisateur courant
CREATE OR REPLACE FUNCTION public.my_station_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE((SELECT station_ids FROM public.profiles WHERE id=auth.uid()), ARRAY[]::uuid[])
$$;

--    my_station() : REMPLACÉ (pas supprimé) -> 1re station, pour compat
--    NB : pas de DROP, sinon les policies qui en dépendent bloquent.
CREATE OR REPLACE FUNCTION public.my_station()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT station_ids[1] FROM public.profiles WHERE id=auth.uid()
$$;

--    can_saisir() : qui peut saisir/modifier des bons et fiches
CREATE OR REPLACE FUNCTION public.can_saisir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT exists(select 1 from public.profiles
                where id=auth.uid() and role in ('admin','gerant','chef_piste'))
$$;

--    can_supprimer() : qui peut supprimer des bons
CREATE OR REPLACE FUNCTION public.can_supprimer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT exists(select 1 from public.profiles
                where id=auth.uid() and role in ('admin','gerant'))
$$;

-- =====================================================================
-- 4. POLICIES — bons (lecture multi-stations + rôles)
-- =====================================================================
DROP POLICY IF EXISTS b_read  ON public.bons;
DROP POLICY IF EXISTS b_g_ins ON public.bons;
DROP POLICY IF EXISTS b_g_upd ON public.bons;
DROP POLICY IF EXISTS b_g_del ON public.bons;

CREATE POLICY b_read ON public.bons FOR SELECT
  USING (public.is_compta() OR station_id = ANY(public.my_station_ids()));
CREATE POLICY b_g_ins ON public.bons FOR INSERT
  WITH CHECK (public.can_saisir() AND station_id = ANY(public.my_station_ids()));
CREATE POLICY b_g_upd ON public.bons FOR UPDATE
  USING (public.can_saisir() AND station_id = ANY(public.my_station_ids()))
  WITH CHECK (public.can_saisir() AND station_id = ANY(public.my_station_ids()));
CREATE POLICY b_g_del ON public.bons FOR DELETE
  USING (public.can_supprimer() AND station_id = ANY(public.my_station_ids()));

-- =====================================================================
-- 5. POLICIES — fiches
-- =====================================================================
DROP POLICY IF EXISTS f_read       ON public.fiches;
DROP POLICY IF EXISTS f_gerant_ins ON public.fiches;
DROP POLICY IF EXISTS f_gerant_upd ON public.fiches;

CREATE POLICY f_read ON public.fiches FOR SELECT
  USING (public.is_compta() OR station_id = ANY(public.my_station_ids()));
CREATE POLICY f_gerant_ins ON public.fiches FOR INSERT
  WITH CHECK (public.can_saisir() AND station_id = ANY(public.my_station_ids()));
CREATE POLICY f_gerant_upd ON public.fiches FOR UPDATE
  USING (public.can_saisir() AND station_id = ANY(public.my_station_ids()))
  WITH CHECK (public.can_saisir() AND station_id = ANY(public.my_station_ids()));

-- =====================================================================
-- 6. POLICIES — ecritures & alertes (lecture multi-stations)
-- =====================================================================
DROP POLICY IF EXISTS e_read ON public.ecritures;
CREATE POLICY e_read ON public.ecritures FOR SELECT
  USING (public.is_compta() OR station_id = ANY(public.my_station_ids()));

DROP POLICY IF EXISTS a_read ON public.alertes;
CREATE POLICY a_read ON public.alertes FOR SELECT
  USING (public.is_compta() OR station_id = ANY(public.my_station_ids()));
