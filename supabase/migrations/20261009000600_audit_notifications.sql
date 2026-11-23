-- =============================================================================
-- Migration 0600: audit trail + notification outbox
-- =============================================================================

-- ------------------------------------------------------------------ audit --
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'amount_paid') and (v_old -> k) is distinct from (v_new -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    case tg_op
      when 'INSERT' then jsonb_build_object('new', v_new)
      when 'DELETE' then jsonb_build_object('old', v_old)
      else jsonb_build_object('changes', v_changes) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_bookings after insert or update on public.bookings
  for each row execute function public.audit_row_change();
create trigger audit_payments after insert or update on public.payments
  for each row execute function public.audit_row_change();
create trigger audit_courts after insert or update or delete on public.courts
  for each row execute function public.audit_row_change();
create trigger audit_court_pricing after insert or update or delete on public.court_pricing
  for each row execute function public.audit_row_change();
create trigger audit_operating_hours after insert or update or delete on public.operating_hours
  for each row execute function public.audit_row_change();
create trigger audit_special_hours after insert or update or delete on public.special_hours
  for each row execute function public.audit_row_change();
create trigger audit_blocked_slots after insert or delete on public.blocked_slots
  for each row execute function public.audit_row_change();
create trigger audit_facility_settings after update on public.facility_settings
  for each row execute function public.audit_row_change();
create trigger audit_profiles_role after update of role on public.profiles
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------- notifications --
create or replace function public.notification_payload(p_booking uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'booking_reference', b.booking_reference,
    'start_at', b.start_at,
    'customer_name', b.customer_name,
    'court_name', c.name,
    'start_local', to_char(b.start_at at time zone s.timezone, 'Dy, Mon DD YYYY HH12:MI AM'),
    'end_local', to_char(b.end_at at time zone s.timezone, 'HH12:MI AM'),
    'duration_minutes', b.duration_minutes,
    'total_amount', b.total_amount,
    'currency', b.currency,
    'booking_status', b.booking_status,
    'payment_status', b.payment_status,
    'payment_method', b.payment_method,
    'payment_due_local', to_char(b.payment_due_at at time zone s.timezone, 'Dy, Mon DD HH12:MI AM'),
    'cancellation_reason', b.cancellation_reason,
    'facility_name', s.facility_name,
    'facility_phone', s.contact_phone,
    'facility_email', s.contact_email,
    'facility_address', s.address)
  from public.bookings b join public.courts c on c.id = b.court_id, public.facility_settings s
  where b.id = p_booking and s.id = 1
$$;

create or replace function public.enqueue_notification(
  p_type text, p_key text, p_booking uuid, p_payment uuid, p_email text, p_recipient uuid,
  p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_email is null or btrim(p_email) = '' then
    return;   -- nobody to notify (e.g. walk-in without email)
  end if;
  insert into public.notifications (recipient_id, recipient_email, booking_id, payment_id,
                                    notification_type, idempotency_key, payload)
  values (p_recipient, p_email, p_booking, p_payment, p_type, p_key,
          coalesce(public.notification_payload(p_booking), '{}'::jsonb) || coalesce(p_extra, '{}'::jsonb))
  on conflict (idempotency_key) do nothing;
end $$;

create or replace function public.booking_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin text := (select nullif(admin_alert_email, '') from public.facility_settings where id = 1);
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_notification(
      case when new.booking_status = 'confirmed' then 'booking_confirmed' else 'booking_received' end,
      'booking_created:' || new.id, new.id, null, new.customer_email, new.customer_id);
    if new.source = 'online' then
      perform public.enqueue_notification('admin_new_booking', 'admin_new_booking:' || new.id,
                                          new.id, null, v_admin, null);
    end if;
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

create trigger bookings_notify after insert or update on public.bookings
  for each row execute function public.booking_notifications();

create or replace function public.payment_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.bookings;
  v_admin text := (select nullif(admin_alert_email, '') from public.facility_settings where id = 1);
begin
  select * into b from public.bookings where id = new.booking_id;
  if tg_op = 'INSERT' and new.payment_status = 'pending' then
    perform public.enqueue_notification('admin_payment_submitted', 'payment_submitted:' || new.id,
      b.id, new.id, v_admin, null,
      jsonb_build_object('payment_amount', new.amount, 'payment_method', new.payment_method,
                         'transaction_reference', new.transaction_reference));
  elsif tg_op = 'UPDATE' and new.payment_status is distinct from old.payment_status then
    if new.payment_status = 'paid' then
      perform public.enqueue_notification('payment_verified', 'payment_verified:' || new.id,
        b.id, new.id, b.customer_email, b.customer_id, jsonb_build_object('payment_amount', new.amount));
    elsif new.payment_status = 'failed' then
      perform public.enqueue_notification('payment_rejected', 'payment_rejected:' || new.id,
        b.id, new.id, b.customer_email, b.customer_id,
        jsonb_build_object('payment_amount', new.amount, 'review_note', new.review_note));
    end if;
  end if;
  return new;
end $$;

create trigger payments_notify after insert or update on public.payments
  for each row execute function public.payment_notifications();

-- Reminders: enqueue once per booking start time (re-scheduling gets a new one).
create or replace function public.enqueue_reminders()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int := 0;
  b record;
  v_hours int := (select reminder_hours_before from public.facility_settings where id = 1);
begin
  for b in select * from public.bookings
            where booking_status = 'confirmed'
              and start_at > now()
              and start_at <= now() + make_interval(hours => v_hours)
              and customer_email is not null loop
    perform public.enqueue_notification('booking_reminder',
      'reminder:' || b.id || ':' || extract(epoch from b.start_at)::bigint,
      b.id, null, b.customer_email, b.customer_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Worker API (service role only). Claims a batch with SKIP LOCKED so parallel
-- workers never send the same message; stuck 'sending' rows are reclaimed.
create or replace function public.claim_notifications(p_limit int default 25)
returns setof public.notifications language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.notifications n
     set delivery_status = 'sending', attempts = n.attempts + 1
   where n.id in (
     select id from public.notifications
      where ((delivery_status in ('queued', 'failed') and next_attempt_at <= now())
          or (delivery_status = 'sending' and updated_at < now() - interval '10 minutes'))
        and attempts < 5
      order by created_at
      limit least(greatest(p_limit, 1), 100)
      for update skip locked)
  returning n.*;
end $$;

create or replace function public.complete_notification(
  p_id uuid, p_success boolean, p_provider_message_id text default null,
  p_error text default null, p_skip boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.notifications
     set delivery_status = case when p_skip then 'skipped'
                                when p_success then 'sent' else 'failed' end::public.notification_status,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         sent_at = case when p_success then now() else sent_at end,
         last_error = case when p_success then null else left(p_error, 1000) end,
         next_attempt_at = case when p_success or p_skip then next_attempt_at
                                else now() + make_interval(mins => (power(2, least(attempts, 6)))::int) end
   where id = p_id;
end $$;
