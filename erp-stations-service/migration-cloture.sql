-- =====================================================================
--  LOT 2 — CLÔTURE DE JOURNÉE
--  Machine à états des fiches + verrous base + clôture/réouverture + audit
--  À exécuter dans : Supabase -> SQL Editor -> New query -> Run
--  Idempotent (rejouable sans risque).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Machine à états de la fiche : brouillon -> en_cours -> prete -> cloturee
-- ---------------------------------------------------------------------
ALTER TABLE public.fiches DROP CONSTRAINT IF EXISTS fiches_statut_check;
UPDATE public.fiches SET statut='en_cours' WHERE statut='ouverte';
ALTER TABLE public.fiches ADD CONSTRAINT fiches_statut_check
  CHECK (statut IN ('brouillon','en_cours','prete','cloturee'));
ALTER TABLE public.fiches ALTER COLUMN statut SET DEFAULT 'en_cours';

-- Traçabilité de réouverture
ALTER TABLE public.fiches ADD COLUMN IF NOT EXISTS motif_reouverture text;
ALTER TABLE public.fiches ADD COLUMN IF NOT EXISTS reouverte_at timestamptz;
ALTER TABLE public.fiches ADD COLUMN IF NOT EXISTS reouverte_by uuid REFERENCES auth.users(id);

-- ---------------------------------------------------------------------
-- 2. Trouver / créer la fiche d'un jour (idempotent, SECURITY DEFINER)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_fiche(p_station uuid, p_y int, p_m int, p_d int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE fid uuid;
BEGIN
  SELECT id INTO fid FROM public.fiches
   WHERE station_id=p_station AND d_year=p_y AND d_month=p_m AND d_day=p_d;
  IF fid IS NULL THEN
    INSERT INTO public.fiches(station_id,d_year,d_month,d_day,statut)
    VALUES(p_station,p_y,p_m,p_d,'en_cours')
    ON CONFLICT (station_id,d_year,d_month,d_day) DO NOTHING
    RETURNING id INTO fid;
    IF fid IS NULL THEN
      SELECT id INTO fid FROM public.fiches
       WHERE station_id=p_station AND d_year=p_y AND d_month=p_m AND d_day=p_d;
    END IF;
  END IF;
  RETURN fid;
END $$;

-- ---------------------------------------------------------------------
-- 3. Rattacher automatiquement chaque bon à la fiche de son jour
--    (trg_assign_fiche < trg_lock_bon par ordre alphabétique -> fiche_id prêt
--     avant le contrôle de verrou)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_fiche()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF new.fiche_id IS NULL THEN
    new.fiche_id := public.get_or_create_fiche(new.station_id,new.d_year,new.d_month,new.d_day);
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS trg_assign_fiche ON public.bons;
CREATE TRIGGER trg_assign_fiche BEFORE INSERT ON public.bons
  FOR EACH ROW EXECUTE FUNCTION public.assign_fiche();

-- ---------------------------------------------------------------------
-- 4. Verrous renforcés
-- ---------------------------------------------------------------------
-- 4a. Interdire la SUPPRESSION de bons d'une fiche clôturée (en plus de
--     trg_lock_bon qui couvre déjà INSERT/UPDATE)
CREATE OR REPLACE FUNCTION public.lock_fiche_cloturee_del()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st text;
BEGIN
  IF old.fiche_id IS NOT NULL THEN
    SELECT statut INTO st FROM public.fiches WHERE id=old.fiche_id;
    IF st='cloturee' THEN
      INSERT INTO public.audit_log(actor,action,tbl,row_id,details)
      VALUES (auth.uid(),'REFUS_SUPPRESSION_CLOTUREE','bons',old.id::text,to_jsonb(old));
      RAISE EXCEPTION 'Fiche clôturée : suppression du bon interdite';
    END IF;
  END IF;
  RETURN old;
END $$;
DROP TRIGGER IF EXISTS trg_lock_bon_del ON public.bons;
CREATE TRIGGER trg_lock_bon_del BEFORE DELETE ON public.bons
  FOR EACH ROW EXECUTE FUNCTION public.lock_fiche_cloturee_del();

-- 4b. Verrou sur la fiche elle-même : aucune modif si clôturée,
--     sauf réouverture officielle (cloturee -> en_cours) par un admin avec motif
CREATE OR REPLACE FUNCTION public.lock_fiche_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF old.statut='cloturee' THEN
    IF new.statut='en_cours' AND public.is_admin()
       AND coalesce(trim(new.motif_reouverture),'')<>'' THEN
      RETURN new;  -- réouverture autorisée
    END IF;
    INSERT INTO public.audit_log(actor,action,tbl,row_id,details)
    VALUES (auth.uid(),'REFUS_MODIF_CLOTUREE','fiches',old.id::text,to_jsonb(new));
    RAISE EXCEPTION 'Fiche clôturée : modification interdite (réouverture admin requise)';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS trg_lock_fiche_upd ON public.fiches;
CREATE TRIGGER trg_lock_fiche_upd BEFORE UPDATE ON public.fiches
  FOR EACH ROW EXECUTE FUNCTION public.lock_fiche_update();

-- ---------------------------------------------------------------------
-- 5. CLÔTURER une fiche : pré-contrôles serveur + verrou + audit
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cloturer_fiche(p_fiche uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f record; calc record; ecart numeric;
BEGIN
  SELECT * INTO f FROM public.fiches WHERE id=p_fiche;
  IF f IS NULL THEN RAISE EXCEPTION 'Fiche introuvable'; END IF;
  IF f.statut='cloturee' THEN RAISE EXCEPTION 'Fiche déjà clôturée'; END IF;

  -- droits : admin, ou gérant/chef de piste rattaché à la station
  IF NOT (public.is_admin()
          OR (public.can_saisir() AND f.station_id = ANY(public.my_station_ids()))) THEN
    RAISE EXCEPTION 'Droits insuffisants pour clôturer cette station';
  END IF;

  -- pré-contrôles bloquants
  IF f.vol_super IS NULL OR f.vol_gasoil IS NULL THEN
     RAISE EXCEPTION 'Volumes vendus manquants (Super et/ou Gasoil)'; END IF;
  IF f.vol_super < 0 OR f.vol_gasoil < 0 THEN
     RAISE EXCEPTION 'Volumes négatifs interdits'; END IF;
  IF f.versement IS NULL THEN
     RAISE EXCEPTION 'Versement (espèces remises) non renseigné'; END IF;

  SELECT * INTO calc FROM public.v_fiche_calc WHERE id=p_fiche;
  IF calc.cash_vol_super < 0 OR calc.cash_vol_gasoil < 0 THEN
     RAISE EXCEPTION 'Incohérence : volume vendu inférieur au volume des bons à crédit'; END IF;

  ecart := round(f.versement - calc.cash_theorique);

  UPDATE public.fiches
     SET statut='cloturee', cloturee_at=now(), cloturee_by=auth.uid()
   WHERE id=p_fiche;

  INSERT INTO public.audit_log(actor,action,tbl,row_id,details)
  VALUES (auth.uid(),'CLOTURE','fiches',p_fiche::text,
          jsonb_build_object('cash_theorique',round(calc.cash_theorique),
                             'versement',f.versement,'ecart',ecart));

  RETURN jsonb_build_object('ok',true,'ecart',ecart,
                            'cash_theorique',round(calc.cash_theorique));
END $$;

-- ---------------------------------------------------------------------
-- 6. ROUVRIR une fiche : admin uniquement + motif obligatoire + audit
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rouvrir_fiche(p_fiche uuid, p_motif text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f record;
BEGIN
  IF NOT public.is_admin() THEN
     RAISE EXCEPTION 'Réouverture réservée à l''administrateur'; END IF;
  IF coalesce(trim(p_motif),'')='' THEN
     RAISE EXCEPTION 'Motif de réouverture obligatoire'; END IF;
  SELECT * INTO f FROM public.fiches WHERE id=p_fiche;
  IF f IS NULL THEN RAISE EXCEPTION 'Fiche introuvable'; END IF;
  IF f.statut<>'cloturee' THEN RAISE EXCEPTION 'La fiche n''est pas clôturée'; END IF;

  UPDATE public.fiches
     SET statut='en_cours', motif_reouverture=p_motif,
         reouverte_at=now(), reouverte_by=auth.uid(),
         cloturee_at=null, cloturee_by=null
   WHERE id=p_fiche;

  INSERT INTO public.audit_log(actor,action,tbl,row_id,details)
  VALUES (auth.uid(),'REOUVERTURE','fiches',p_fiche::text,
          jsonb_build_object('motif',p_motif));
  RETURN jsonb_build_object('ok',true);
END $$;

-- ---------------------------------------------------------------------
-- 7. Droits d'exécution + temps réel
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_or_create_fiche(uuid,int,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloturer_fiche(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.rouvrir_fiche(uuid,text)           TO authenticated;

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fiches;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
