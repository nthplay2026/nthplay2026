-- =============================================================================
-- One email per booking, even when it has several time blocks.
-- * notification_payload describes the whole group: its shared reference, every
--   time block (when_local) and the combined total.
-- * "Booking confirmed", "payment verified" and "payment rejected" are queued once
--   per group (later blocks hit the same idempotency key), and the payment amount
--   is the whole receipt.
-- =============================================================================

create or replace function public.notification_payload(p_booking uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with b as (select * from public.bookings where id = p_booking),
  grp as (
    select g.* from public.bookings g, b
     where g.id = b.id or (b.group_ref is not null and g.group_ref = b.group_ref)
  ),
  live as (select * from grp where booking_status not in ('cancelled', 'expired')),
  counted as (select * from live union all select * from grp where not exists (select 1 from live))
  select jsonb_build_object(
    'booking_reference', coalesce(b.group_ref, b.booking_reference),
    'start_at', b.start_at,
    'customer_name', b.customer_name,
    'court_name', c.name,
    'start_local', to_char(b.start_at at time zone s.timezone, 'Dy, Mon DD YYYY HH12:MI AM'),
    'end_local', to_char(b.end_at at time zone s.timezone, 'HH12:MI AM'),
    'when_local', (select string_agg(to_char(x.start_at at time zone s.timezone, 'Dy, Mon DD YYYY HH12:MI AM') || ' – '
                                     || to_char(x.end_at at time zone s.timezone, 'HH12:MI AM'), '; ' order by x.start_at) from counted x),
    'blocks_count', (select count(*) from counted),
    'duration_minutes', (select sum(duration_minutes) from counted),
    'total_amount', (select sum(total_amount) from counted),
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
  from b join public.courts c on c.id = b.court_id, public.facility_settings s
  where s.id = 1
$$;

create or replace function public.enqueue_notification(
  p_type text, p_key text, p_booking uuid, p_payment uuid, p_email text, p_recipient uuid,
  p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_group text;
  v_key   text := p_key;
  v_extra jsonb := coalesce(p_extra, '{}'::jsonb);
  v_proof text;
begin
  if p_email is null or btrim(p_email) = '' then
    return;   -- nobody to notify (e.g. walk-in without email)
  end if;
  if p_type not like 'admin\_%' and p_type not in ('booking_confirmed', 'payment_verified', 'payment_rejected', 'booking_rescheduled', 'booking_cancelled') then
    return;   -- no "booking received" or reminder emails for customers
  end if;

  -- Blocks booked together: one email for the whole booking.
  select group_ref into v_group from public.bookings where id = p_booking;
  if v_group is not null and p_type in ('booking_confirmed', 'payment_verified', 'payment_rejected') then
    v_key := p_type || ':group:' || v_group || ':' || lower(btrim(p_email));
    if p_payment is not null then
      select proof_of_payment_path into v_proof from public.payments where id = p_payment;
      if v_proof is not null then
        v_extra := v_extra || jsonb_build_object('payment_amount', (
          select sum(p.amount) from public.payments p join public.bookings g on g.id = p.booking_id
           where g.group_ref = v_group and p.proof_of_payment_path = v_proof));
      end if;
    end if;
  end if;

  insert into public.notifications (recipient_id, recipient_email, booking_id, payment_id,
                                    notification_type, idempotency_key, payload)
  values (p_recipient, p_email, p_booking, p_payment, p_type, v_key,
          coalesce(public.notification_payload(p_booking), '{}'::jsonb) || v_extra)
  on conflict (idempotency_key) do nothing;
end $$;
