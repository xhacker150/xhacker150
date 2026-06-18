-- Add station_ids array to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS station_ids uuid[] DEFAULT '{}';

-- Migrate existing station_id to station_ids array
UPDATE public.profiles SET station_ids = ARRAY[station_id] WHERE station_id IS NOT NULL;

-- Update role check constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','gerant','comptable','agent_facturation','chef_piste'));

-- Helper function returning all station IDs for current user
CREATE OR REPLACE FUNCTION public.my_station_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT station_ids FROM public.profiles WHERE id = auth.uid()),
    ARRAY[]::uuid[]
  )
$$;

-- Backward-compat: my_station() returns first station
DROP FUNCTION IF EXISTS public.my_station();
CREATE OR REPLACE FUNCTION public.my_station() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT station_ids[1] FROM public.profiles WHERE id = auth.uid()
$$;

-- Update RLS policies on bons table
DROP POLICY IF EXISTS "bons_select" ON public.bons;
DROP POLICY IF EXISTS "bons_insert" ON public.bons;
DROP POLICY IF EXISTS "bons_update" ON public.bons;
DROP POLICY IF EXISTS "bons_delete" ON public.bons;

-- Admin sees all, others see their stations
CREATE POLICY "bons_select" ON public.bons FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  OR station_id = ANY(public.my_station_ids())
);
-- Chef de piste and gerant can insert
CREATE POLICY "bons_insert" ON public.bons FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','gerant','chef_piste')
  AND station_id = ANY(public.my_station_ids())
);
-- Chef de piste and gerant can update
CREATE POLICY "bons_update" ON public.bons FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','gerant','chef_piste')
  AND station_id = ANY(public.my_station_ids())
);
-- Only admin and gerant can delete
CREATE POLICY "bons_delete" ON public.bons FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','gerant')
  AND station_id = ANY(public.my_station_ids())
);
