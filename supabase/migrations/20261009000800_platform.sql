-- =============================================================================
-- Migration 0800: Supabase platform wiring — Realtime, Storage, pg_cron.
-- Each block is guarded so the migration also applies to a plain PostgreSQL
-- test database that lacks these Supabase components.
-- =============================================================================

-- ---------------------------------------------------------------- Realtime -
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  -- slot_locks: public availability feed. bookings/payments: RLS-filtered
  -- (customers receive only their own rows, staff receive all). courts: public
  -- catalogue, so activating/deactivating a court updates open calendars.
  alter publication supabase_realtime add table public.slot_locks, public.bookings, public.payments, public.courts;
end $$;

alter table public.bookings replica identity full;
alter table public.payments replica identity full;

-- ----------------------------------------------------------------- Storage -
-- Private bucket for proof-of-payment images: <user id>/<file>.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('payment-proofs', 'payment-proofs', false, 5242880,
            array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;

    execute $p$
      create policy "payment proofs: owner upload" on storage.objects for insert to authenticated
        with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
    execute $p$
      create policy "payment proofs: owner or staff read" on storage.objects for select to authenticated
        using (bucket_id = 'payment-proofs'
               and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()))
    $p$;
  end if;
end $$;

-- ----------------------------------------------------------------- pg_cron -
-- Database-only jobs. The email worker (Edge Function) is scheduled separately
-- because it needs your project URL and a secret: see docs/DEPLOYMENT.md.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('nthplay-expire-stale', '* * * * *', 'select public.expire_stale_records()');
    perform cron.schedule('nthplay-reminders', '*/15 * * * *', 'select public.enqueue_reminders()');
  else
    raise notice 'pg_cron not available: schedule expire_stale_records() and enqueue_reminders() another way.';
  end if;
end $$;
