-- Pin search_path on helper/trigger functions that didn't set one
-- (Supabase security advisor: function_search_path_mutable). Without a fixed
-- search_path a function resolves names against the caller's path, which a
-- malicious role could shadow. Behaviour is otherwise unchanged.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('touch_updated_at', 'require_auth', 'local_date_of', 'local_today',
                         'validate_contact', 'guard_profile_role', 'app_error',
                         'validate_facility_settings', 'validate_court', 'guard_payment_qr')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', f.sig);
  end loop;
end $$;
