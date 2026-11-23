-- =============================================================================
-- Email payloads list each time block as a date + time pair, so emails can group
-- blocks by day and read cleanly on phones ("Sun, Nov 8, 2026" · "1:00 AM – 2:00 AM").
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
    'blocks', (select jsonb_agg(jsonb_build_object(
                 'date', to_char(x.start_at at time zone s.timezone, 'Dy, Mon FMDD, YYYY'),
                 'time', to_char(x.start_at at time zone s.timezone, 'FMHH12:MI AM') || ' – ' || to_char(x.end_at at time zone s.timezone, 'FMHH12:MI AM'))
                 order by x.start_at) from counted x),
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
