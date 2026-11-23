-- =============================================================================
-- Backup reminders. Admins choose how often (Settings > Backup); the database
-- records when a backup was last downloaded (by any admin, on any device), and
-- every morning at 9:00 AM Manila a "Time to back up" notification (in-app +
-- phone push) goes to each admin while a backup is due. It repeats daily until
-- someone downloads one.
-- =============================================================================
alter table public.facility_settings
  add column if not exists backup_reminder_days int
    check (backup_reminder_days is null or backup_reminder_days between 1 and 90),
  add column if not exists last_backup_at timestamptz;
-- Private: not granted to anon/authenticated; read through admin_backup_status().

update public.facility_settings set backup_reminder_days = 7 where id = 1 and backup_reminder_days is null;
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
    when 'backup_reminder' then
      v_title := 'Time to back up';
      v_body  := case when nullif(p_payload ->> 'last_backup_local', '') is null
                      then 'No backup has been downloaded yet. Download one from Settings > Backup.'
                      else format('The last backup was on %s. Download a new one from Settings > Backup.', p_payload ->> 'last_backup_local') end;
      v_link  := '/admin/settings?tab=backup';
    else
      return;   -- other types are email-only (or switched off)
  end case;

  insert into public.user_notifications (user_id, kind, title, body, link, booking_id, dedupe_key)
  values (p_user, p_type, v_title, v_body, v_link, p_booking, 'app:' || p_key)
  on conflict (dedupe_key) do update set title = excluded.title, body = excluded.body
    where user_notifications.read_at is null and user_notifications.pushed_at is null;
end $$;

revoke all on function public.add_user_notification(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Downloading a backup now also records when it happened.
create or replace function public.admin_export_backup()
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  if not public.is_admin() then
    perform public.app_error('FORBIDDEN', 'Only administrators can download a backup.');
  end if;
  v_out := jsonb_build_object(
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
  update public.facility_settings set last_backup_at = now() where id = 1;
  return v_out;
end $$;
revoke all on function public.admin_export_backup() from public, anon;
grant execute on function public.admin_export_backup() to authenticated;

-- What the Backup tab shows.
create or replace function public.admin_backup_status()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.facility_settings := public.settings();
begin
  if not public.is_admin() then
    perform public.app_error('FORBIDDEN', 'Only administrators can see backup settings.');
  end if;
  return jsonb_build_object(
    'reminder_days', s.backup_reminder_days,
    'last_backup_at', s.last_backup_at,
    'next_due_at', case when s.backup_reminder_days is null then null
                        else coalesce(s.last_backup_at + make_interval(days => s.backup_reminder_days), now()) end);
end $$;

create or replace function public.admin_set_backup_reminder(p_days int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    perform public.app_error('FORBIDDEN', 'Only administrators can change backup reminders.');
  end if;
  if p_days is not null and p_days not between 1 and 90 then
    perform public.app_error('INVALID_REQUEST', 'Choose a reminder between 1 and 90 days, or turn it off.');
  end if;
  update public.facility_settings set backup_reminder_days = p_days where id = 1;
  return public.admin_backup_status();
end $$;

revoke all on function public.admin_backup_status(), public.admin_set_backup_reminder(int) from public, anon;
grant execute on function public.admin_backup_status(), public.admin_set_backup_reminder(int) to authenticated;

-- Daily job: remind every admin while a backup is due (one reminder per admin per day).
create or replace function public.send_backup_reminders()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.facility_settings := public.settings();
  r record;
  n int := 0;
begin
  if s.backup_reminder_days is null then return 0; end if;
  if s.last_backup_at is not null and s.last_backup_at > now() - make_interval(days => s.backup_reminder_days) then
    return 0;
  end if;
  for r in select id from public.profiles where role = 'admin' loop
    perform public.add_user_notification(r.id, 'backup_reminder',
      'backup_reminder:' || public.local_today() || ':' || r.id, null,
      jsonb_build_object('last_backup_local', to_char(s.last_backup_at at time zone s.timezone, 'Mon DD, YYYY')));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.send_backup_reminders() from public, anon, authenticated;

-- 9:00 AM Manila = 01:00 UTC.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nthplay-backup-reminder';
    perform cron.schedule('nthplay-backup-reminder', '0 1 * * *', 'select public.send_backup_reminders()');
  end if;
end $$;