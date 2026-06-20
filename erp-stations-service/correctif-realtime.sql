-- =====================================================================
--  CORRECTIF : activer Realtime (synchro automatique de l'affichage)
--  À exécuter dans : Supabase -> SQL Editor -> New query -> Run
-- =====================================================================
do $$ declare t text;
begin
  foreach t in array array['bons','fiches','stations','clients','tarifs','alertes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception when duplicate_object then null;  -- déjà publiée
    end;
  end loop;
end $$;
