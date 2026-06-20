-- =====================================================================
--  CORRECTIF : permettre la création de clients (et tarifs)
--  Cause : la table clients a pour clé "cpt" (pas "id"), or la fonction
--  d'audit lisait new.id pour toutes les tables -> erreur à l'insertion.
--  À exécuter dans : Supabase -> SQL Editor -> New query -> Run
-- =====================================================================
create or replace function public.audit()
returns trigger language plpgsql security definer set search_path=public as $$
declare rec jsonb; rid text;
begin
  rec := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  rid := coalesce(rec->>'id', rec->>'cpt');
  insert into public.audit_log(actor,action,tbl,row_id,details)
  values (auth.uid(), tg_op, tg_table_name, rid, rec);
  return coalesce(new,old);
end $$;
