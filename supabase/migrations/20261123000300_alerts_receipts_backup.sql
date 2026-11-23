-- =============================================================================
-- 1. Booking alerts, once per checkout
--    A checkout with several hours saves one booking row per hour and only then
--    gives them a shared group_ref. Announcing at INSERT time sent one
--    "Booking confirmed" (and one admin alert) per hour. Now new bookings are
--    announced by a DEFERRED trigger that runs at commit, when group_ref is set,
--    so every hour of a checkout maps to the same notification key.
--    * customer: "Booking confirmed" (in-app + phone push + email)
--    * every admin: "New booking" (in-app + phone push + email), plus the
--      optional admin alert email from Settings
-- =============================================================================
create or replace function public.add_user_notification(p_user uuid, p_type text, p_key text, p_booking uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref    text := coalesce(p_payload ->> 'booking_reference', '');
  v_amount text := '₱' || to_char(coalesce((p_payload ->> 'payment_amount')::numeric, (p_payload ->> 'total_amount')::numeric, 0), 'FM999,999,990.00');
  v_when   text := coalesce(p_payload ->> 'start_local', '');
  v_title  text;
  v_body   text;
  v_link   text := '/my-bookings/' || v_ref;
begin
  if p_user is null then return; end if;
  case p_type
    when 'admin_payment_submitted' then
      v_title := 'Payment to verify';
      v_body  := format('%s uploaded a receipt for %s · %s', coalesce(p_payload ->> 'customer_name', 'A customer'), v_amount, v_ref);
      v_link  := '/admin/bookings?ref=' || v_ref;
    when 'booking_confirmed' then
      v_title := 'Booking confirmed';
      v_body  := format('Your booking %s is confirmed. See you on the court!', v_ref);
    when 'payment_verified' then
      v_title := 'Payment verified';
      v_body  := format('We received your payment of %s for %s.', v_amount, v_ref);
    when 'payment_rejected' then
      v_title := 'Payment not verified';
      v_body  := format('We couldn''t verify your payment for %s.%s', v_ref,
                        coalesce(' ' || nullif(p_payload ->> 'review_note', ''), ''));
    when 'booking_rescheduled' then
      v_title := 'Booking rescheduled';
      v_body  := format('Your booking %s moved to %s.', v_ref, v_when);
    when 'booking_cancelled' then
      v_title := 'Booking cancelled';
      v_body  := format('Your booking %s (%s) was cancelled.%s', v_ref, v_when,
                        coalesce(' Reason: ' || nullif(p_payload ->> 'cancellation_reason', ''), ''));
    when 'admin_new_booking' then
      v_title := 'New booking';
      v_body  := format('%s booked %s%s · %s', coalesce(p_payload ->> 'customer_name', 'A customer'),
                        coalesce(nullif(p_payload ->> 'when_local', ''), v_when),
                        case when coalesce((p_payload ->> 'blocks_count')::int, 1) > 1
                             then format(' (%s hours)', p_payload ->> 'blocks_count') else '' end, v_ref);
      v_link  := '/admin/bookings?ref=' || v_ref;
    else
      return;   -- other types are email-only (or switched off)
  end case;

  insert into public.user_notifications (user_id, kind, title, body, link, booking_id, dedupe_key)
  values (p_user, p_type, v_title, v_body, v_link, p_booking, 'app:' || p_key)
  on conflict (dedupe_key) do update set title = excluded.title, body = excluded.body
    where user_notifications.read_at is null and user_notifications.pushed_at is null;
end $$;

revoke all on function public.add_user_notification(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.booking_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin text := (select nullif(admin_alert_email, '') from public.facility_settings where id = 1);
begin
  -- New bookings are announced by booking_created_notifications() at commit,
  -- once the blocks of a checkout share their group reference.
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.booking_status is distinct from old.booking_status then
    if new.booking_status = 'confirmed' and old.booking_status in ('pending', 'expired') then
      perform public.enqueue_notification('booking_confirmed', 'booking_confirmed:' || new.id,
                                          new.id, null, new.customer_email, new.customer_id);
    elsif new.booking_status = 'cancelled' then
      perform public.enqueue_notification('booking_cancelled', 'booking_cancelled:' || new.id,
                                          new.id, null, new.customer_email, new.customer_id);
    elsif new.booking_status = 'expired' then
      perform public.enqueue_notification('booking_expired', 'booking_expired:' || new.id,
                                          new.id, null, new.customer_email, new.customer_id);
    end if;
  end if;
  if new.rescheduled_count > old.rescheduled_count then
    perform public.enqueue_notification('booking_rescheduled',
      'booking_rescheduled:' || new.id || ':' || new.rescheduled_count,
      new.id, null, new.customer_email, new.customer_id,
      jsonb_build_object('previous_start_local',
        to_char(old.start_at at time zone public.facility_tz(), 'Dy, Mon DD YYYY HH12:MI AM')));
  end if;
  return new;
end $$;

create or replace function public.booking_created_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b       public.bookings;
  v_admin text := (select nullif(admin_alert_email, '') from public.facility_settings where id = 1);
  v_ref   text;
  r       record;
begin
  select * into b from public.bookings where id = new.id;   -- state at commit, group_ref included
  if not found then return null; end if;
  v_ref := coalesce(b.group_ref, b.booking_reference);

  perform public.enqueue_notification(
    case when b.booking_status = 'confirmed' then 'booking_confirmed' else 'booking_received' end,
    'booking_created:' || b.id, b.id, null, b.customer_email, b.customer_id);

  if b.source = 'online' then
    for r in
      select lower(e) as email, min(id::text)::uuid as id from (
        select email as e, id from public.profiles where role = 'admin' and email is not null
        union all select v_admin, null::uuid where v_admin is not null
      ) x group by lower(e)
    loop
      perform public.enqueue_notification('admin_new_booking', 'admin_new_booking:' || v_ref || ':' || r.email,
                                          b.id, null, r.email, r.id);
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.booking_created_notifications() from public, anon, authenticated;

drop trigger if exists bookings_created_notify on public.bookings;
create constraint trigger bookings_created_notify after insert on public.bookings
  deferrable initially deferred
  for each row execute function public.booking_created_notifications();

-- =============================================================================
-- 2. Receipt images are deleted 45 days after upload (storage stays small on the
--    free plan). Payment and booking records are kept; the payment just loses its
--    image link and records when it was removed. Receipts still waiting for
--    verification are never deleted. The send-notifications worker does the
--    actual file deletion through the Storage API once an hour.
-- =============================================================================
alter table public.payments add column if not exists receipt_purged_at timestamptz;

create or replace function public.receipts_to_purge(p_days int default 45, p_limit int default 100)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(x.name), '{}') from (
    select o.name from storage.objects o
     where o.bucket_id = 'payment-proofs'
       and o.created_at < now() - make_interval(days => p_days)
       and not exists (select 1 from public.payments p
                        where p.proof_of_payment_path = o.name and p.payment_status = 'pending')
     order by o.created_at
     limit p_limit) x
$$;

create or replace function public.mark_receipts_purged(p_paths text[])
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.payments set proof_of_payment_path = null, receipt_purged_at = now()
   where proof_of_payment_path = any (p_paths);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.receipts_to_purge(int, int) from public, anon, authenticated;
revoke all on function public.mark_receipts_purged(text[]) from public, anon, authenticated;
grant execute on function public.receipts_to_purge(int, int), public.mark_receipts_purged(text[]) to service_role;

-- =============================================================================
-- 3. Backup: admins download all business data as one JSON file from
--    Admin -> Settings. Secrets (QR publishing password hash, push device keys)
--    and transient data (email outbox, holds, locks) are left out.
-- =============================================================================
create or replace function public.admin_export_backup()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    perform public.app_error('FORBIDDEN', 'Only administrators can download a backup.');
  end if;
  return jsonb_build_object(
    'format', 'nthplay-backup',
    'version', 1,
    'created_at', now(),
    'facility_settings', (select to_jsonb(s) from public.facility_settings s where id = 1),
    'courts',            (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order, t.name), '[]') from public.courts t),
    'court_pricing',     (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.court_pricing t),
    'operating_hours',   (select coalesce(jsonb_agg(to_jsonb(t) order by t.day_of_week), '[]') from public.operating_hours t),
    'special_hours',     (select coalesce(jsonb_agg(to_jsonb(t) order by t.date), '[]') from public.special_hours t),
    'blocked_slots',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.blocked_slots t),
    'profiles',          (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.profiles t),
    'bookings',          (select coalesce(jsonb_agg(to_jsonb(t) order by t.start_at), '[]') from public.bookings t),
    'payments',          (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.payments t),
    'payment_events',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.payment_events t),
    'booking_ref_counters', (select coalesce(jsonb_agg(to_jsonb(t) order by t.day), '[]') from public.booking_ref_counters t),
    'audit_logs',        (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.audit_logs t)
  );
end $$;
revoke all on function public.admin_export_backup() from public, anon;
grant execute on function public.admin_export_backup() to authenticated;