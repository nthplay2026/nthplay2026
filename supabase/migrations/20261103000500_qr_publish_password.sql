-- =============================================================================
-- Payment QR codes are uploaded by administrators and published only with a
-- separate publishing password. The password is stored as a bcrypt hash and is
-- never readable. QR links in payment_methods can't change any other way.
-- =============================================================================

-- Public bucket for the QR images customers scan (admins upload).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('payment-qr', 'payment-qr', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists "payment qr: public read" on storage.objects;
    drop policy if exists "payment qr: admin upload" on storage.objects;
    drop policy if exists "payment qr: admin delete" on storage.objects;
    create policy "payment qr: public read" on storage.objects for select
      using (bucket_id = 'payment-qr');
    create policy "payment qr: admin upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'payment-qr' and public.is_admin());
    create policy "payment qr: admin delete" on storage.objects for delete to authenticated
      using (bucket_id = 'payment-qr' and public.is_admin());
  end if;
end $$;

-- The publishing password (one row). No one can read it through the API.
create table if not exists public.qr_publish_secret (
  id              smallint primary key default 1 check (id = 1),
  password_hash   text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null
);
alter table public.qr_publish_secret enable row level security;
revoke all on public.qr_publish_secret from public, anon, authenticated;

-- Checks a password against the stored hash, counting failures (5 wrong → locked 15 min).
-- Returns null when correct, otherwise a {ok:false, code, message} result. It never
-- raises, so a failed attempt is still recorded.
create or replace function public.qr_password_check(p_password text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.qr_publish_secret;
begin
  select * into r from public.qr_publish_secret where id = 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_PASSWORD', 'message', 'Set a publishing password first.');
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'LOCKED',
      'message', 'Too many wrong attempts. Please try again in 15 minutes.');
  end if;
  if r.password_hash <> extensions.crypt(coalesce(p_password, ''), r.password_hash) then
    update public.qr_publish_secret
       set failed_attempts = r.failed_attempts + 1,
           locked_until = case when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where id = 1;
    return jsonb_build_object('ok', false, 'code', 'WRONG_PASSWORD',
      'message', case when r.failed_attempts + 1 >= 5
        then 'That password is incorrect. Publishing is locked for 15 minutes.'
        else 'That password is incorrect.' end);
  end if;
  update public.qr_publish_secret set failed_attempts = 0, locked_until = null where id = 1;
  return null;
end $$;
revoke all on function public.qr_password_check(text) from public, anon, authenticated;

create or replace function public.qr_password_is_set()
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return exists (select 1 from public.qr_publish_secret where id = 1);
end $$;

-- Creates the password, or changes it (the current one is required to change it).
create or replace function public.set_qr_publish_password(p_current text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  v_err jsonb;
begin
  if p_new is null or char_length(p_new) < 8 then
    return jsonb_build_object('ok', false, 'code', 'WEAK_PASSWORD', 'message', 'Use at least 8 characters.');
  end if;
  if exists (select 1 from public.qr_publish_secret where id = 1) then
    v_err := public.qr_password_check(p_current);
    if v_err is not null then return v_err; end if;
  end if;
  insert into public.qr_publish_secret (id, password_hash, updated_by)
  values (1, extensions.crypt(p_new, extensions.gen_salt('bf')), v_uid)
  on conflict (id) do update
    set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null,
        updated_at = now(), updated_by = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- Publishes (or removes, with p_qr_url null) the QR code for gcash / bank_transfer.
create or replace function public.publish_payment_qr(p_method text, p_qr_url text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_err jsonb;
begin
  perform public.require_admin();
  if p_method not in ('gcash', 'bank_transfer') then
    perform public.app_error('INVALID_REQUEST', 'QR codes can be set for GCash and QRPh only.');
  end if;
  if p_qr_url is not null and p_qr_url !~ '^(https://|/)' then
    perform public.app_error('INVALID_REQUEST', 'The QR image link is not valid.');
  end if;
  v_err := public.qr_password_check(p_password);
  if v_err is not null then return v_err; end if;

  perform set_config('app.qr_publish', 'on', true);
  update public.facility_settings
     set payment_methods = (
       select jsonb_agg(case
         when x ->> 'method' <> p_method then x
         when p_qr_url is null then (x - 'qr_url') || jsonb_build_object('enabled', false)
         else x || jsonb_build_object('qr_url', p_qr_url, 'enabled', true) end)
       from jsonb_array_elements(payment_methods) x)
   where id = 1;
  perform set_config('app.qr_publish', 'off', true);
  return jsonb_build_object('ok', true);
end $$;

-- Guard: QR links only change through publish_payment_qr.
create or replace function public.guard_payment_qr()
returns trigger language plpgsql as $$
begin
  if (select jsonb_object_agg(x ->> 'method', x -> 'qr_url') from jsonb_array_elements(new.payment_methods) x)
     is distinct from
     (select jsonb_object_agg(x ->> 'method', x -> 'qr_url') from jsonb_array_elements(old.payment_methods) x)
     and coalesce(current_setting('app.qr_publish', true), '') <> 'on' then
    perform public.app_error('QR_PASSWORD_REQUIRED', 'Payment QR codes can only be changed with the publishing password.');
  end if;
  return new;
end $$;
drop trigger if exists facility_settings_guard_qr on public.facility_settings;
create trigger facility_settings_guard_qr before update on public.facility_settings
  for each row execute function public.guard_payment_qr();

revoke all on function public.qr_password_is_set() from public, anon;
revoke all on function public.set_qr_publish_password(text, text) from public, anon;
revoke all on function public.publish_payment_qr(text, text, text) from public, anon;
grant execute on function
  public.qr_password_is_set(),
  public.set_qr_publish_password(text, text),
  public.publish_payment_qr(text, text, text)
  to authenticated;
