-- =============================================================================
-- One booking per checkout, confirmed only after the payment is verified.
-- * Online bookings now stay "pending" until an admin verifies the receipt
--   (booking_confirmation_mode = after_payment); verifying confirms every time
--   block of the checkout and the customer gets one "Booking confirmed".
-- * No separate "Payment received" message when that verification is what
--   confirms the booking.
-- * Admins get one alert per GCash/bank booking ("Payment to verify").
-- * Overview figures count checkouts (and receipts), not individual time blocks.
-- =============================================================================
create or replace function public.admin_overview(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz      text := public.facility_tz();
  d       date := coalesce(p_date, public.local_today());
  d_start timestamptz := d::timestamp at time zone tz;
  d_end   timestamptz := (d + 1)::timestamp at time zone tz;
  m_start timestamptz := date_trunc('month', d)::timestamp at time zone tz;
  m_end   timestamptz := (date_trunc('month', d) + interval '1 month')::timestamp at time zone tz;
  v_courts int;
  v_open_minutes numeric := 0;
  c record;
  h record;
begin
  perform public.require_staff();
  select count(*) into v_courts from public.courts where is_active;
  for c in select id from public.courts where is_active loop
    select * into h from public.court_hours(c.id, d);
    if not h.is_closed then
      v_open_minutes := v_open_minutes + extract(epoch from h.close_at - h.open_at) / 60;
    end if;
  end loop;

  return jsonb_build_object(
    'date', d,
    'todays_bookings', (select count(distinct coalesce(group_ref, booking_reference)) from public.bookings
                         where start_at >= d_start and start_at < d_end
                           and booking_status in ('pending', 'confirmed', 'completed', 'no_show')),
    'upcoming_bookings', (select count(distinct coalesce(group_ref, booking_reference)) from public.bookings
                           where start_at > now() and booking_status in ('pending', 'confirmed')),
    'active_courts', v_courts,
    'courts_free_now', (select count(*) from public.courts ct where ct.is_active and not exists (
                          select 1 from public.slot_locks l where l.court_id = ct.id and l.active
                             and l.kind in ('booking', 'block') and l.start_at <= now() and l.end_at > now())),
    'occupied_court_hours', round(coalesce((select sum(extract(epoch from least(end_at, d_end) - greatest(start_at, d_start)) / 3600)
                                     from public.bookings
                                    where start_at < d_end and end_at > d_start
                                      and booking_status in ('pending', 'confirmed', 'completed')), 0), 1),
    'open_court_hours', round(v_open_minutes / 60, 1),
    'cancellations_today', (select count(distinct coalesce(group_ref, booking_reference)) from public.bookings where cancelled_at >= d_start and cancelled_at < d_end),
    'pending_reservations', (select count(distinct coalesce(group_ref, booking_reference)) from public.bookings where booking_status = 'pending'),
    'pending_payment_verifications', (select count(distinct coalesce(proof_of_payment_path, id::text)) from public.payments where payment_status = 'pending'),
    'pending_payment_amount', (select coalesce(sum(amount), 0) from public.payments where payment_status = 'pending'),
    'revenue_today', case when public.is_admin() then
        (select coalesce(sum(amount - refunded_amount), 0) from public.payments
          where payment_status in ('paid', 'refunded') and verified_at >= d_start and verified_at < d_end) end,
    'revenue_month', case when public.is_admin() then
        (select coalesce(sum(amount - refunded_amount), 0) from public.payments
          where payment_status in ('paid', 'refunded') and verified_at >= m_start and verified_at < m_end) end,
    'booking_value_today', (select coalesce(sum(total_amount), 0) from public.bookings
                             where start_at >= d_start and start_at < d_end
                               and booking_status in ('pending', 'confirmed', 'completed', 'no_show')),
    'currency', (select currency from public.facility_settings where id = 1)
  );
end $$;

create or replace function public.payment_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b       public.bookings;
  v_admin text := (select nullif(admin_alert_email, '') from public.facility_settings where id = 1);
  v_key   text;
  v_amount numeric;
  r       record;
begin
  select * into b from public.bookings where id = new.booking_id;
  if tg_op = 'INSERT' and new.payment_status = 'pending' then
    v_key := 'payment_submitted:' || coalesce(new.proof_of_payment_path, new.id::text);
    -- One receipt covering several time blocks is saved as one payment row per block:
    -- the alert shows the whole receipt.
    v_amount := case when new.proof_of_payment_path is null then new.amount else
      (select sum(amount) from public.payments where proof_of_payment_path = new.proof_of_payment_path and payment_status = 'pending') end;
    for r in
      select lower(e) as email, min(id::text)::uuid as id from (
        select email as e, id from public.profiles where role = 'admin' and email is not null
        union all select v_admin, null::uuid where v_admin is not null
      ) x group by lower(e)
    loop
      perform public.enqueue_notification('admin_payment_submitted', v_key || ':' || r.email,
        b.id, new.id, r.email, r.id,
        jsonb_build_object('payment_amount', v_amount, 'payment_method', new.payment_method,
                           'transaction_reference', new.transaction_reference));
    end loop;
  elsif tg_op = 'UPDATE' and new.payment_status is distinct from old.payment_status then
    -- When this verification is what confirms a pending booking, the customer gets
    -- one "Booking confirmed" (from booking_notifications) instead of two messages.
    if new.payment_status = 'paid' and b.booking_status <> 'pending' then
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

  -- A pending GCash/bank booking is announced to admins by the "Payment to verify
  -- alert when its receipt is uploaded (during checkout), so it isn't announced twice.
  if b.source = 'online'
     and not (b.booking_status = 'pending' and b.payment_method in ('gcash', 'bank_transfer')) then
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

update public.facility_settings set booking_confirmation_mode = 'after_payment' where id = 1;