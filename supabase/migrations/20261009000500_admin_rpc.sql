-- =============================================================================
-- Migration 0500: administration — schedule changes with conflict review,
-- roles, dashboard metrics and reports.
-- =============================================================================

create or replace function public.admin_get_settings()
returns public.facility_settings language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return public.settings();
end $$;

-- Upcoming live bookings for the given courts (null = all) that would fall
-- outside a proposed schedule. p_hours: [{day_of_week, is_closed, opening_time, closing_time}]
create or replace function public.hours_conflicts(p_court uuid, p_hours jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz text := public.facility_tz();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'booking_id', b.id, 'booking_reference', b.booking_reference, 'court_name', c.name,
             'start_at', b.start_at, 'end_at', b.end_at, 'customer_name', b.customer_name) order by b.start_at)
      from public.bookings b
      join public.courts c on c.id = b.court_id
      join lateral (
        select (x ->> 'is_closed')::boolean as is_closed,
               (x ->> 'opening_time')::time as o, (x ->> 'closing_time')::time as cl
          from jsonb_array_elements(p_hours) x
         where (x ->> 'day_of_week')::int = extract(dow from (b.start_at at time zone tz))::int
      ) n on true
     where b.booking_status in ('pending', 'confirmed') and b.start_at > now()
       and (p_court is null or b.court_id = p_court)
       -- facility-level change only matters for courts without their own weekly row
       and (p_court is not null or not exists (
              select 1 from public.operating_hours oh
               where oh.court_id = b.court_id
                 and oh.day_of_week = extract(dow from (b.start_at at time zone tz))::int))
       and not exists (select 1 from public.special_hours sh
                        where sh.date = (b.start_at at time zone tz)::date
                          and (sh.court_id = b.court_id or sh.court_id is null))
       and (n.is_closed
            or (b.start_at at time zone tz)::time < n.o
            or ((b.end_at at time zone tz)::date = (b.start_at at time zone tz)::date
                and (b.end_at at time zone tz)::time > n.cl and n.cl <> '00:00'))
  ), '[]'::jsonb);
end $$;

-- Save a weekly schedule. If live bookings would fall outside it, nothing is
-- saved unless p_acknowledge = true; acknowledged bookings are kept (honoured).
create or replace function public.save_operating_hours(p_court uuid, p_hours jsonb, p_acknowledge boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid       uuid := public.require_admin();
  v_conflicts jsonb;
  x           jsonb;
begin
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7
     or (select count(distinct (e ->> 'day_of_week')::int) from jsonb_array_elements(p_hours) e
          where (e ->> 'day_of_week')::int between 0 and 6) <> 7 then
    perform public.app_error('INVALID_SETTINGS', 'Provide hours for all seven days.');
  end if;
  v_conflicts := public.hours_conflicts(p_court, p_hours);
  if jsonb_array_length(v_conflicts) > 0 and not coalesce(p_acknowledge, false) then
    return jsonb_build_object('status', 'conflicts', 'conflicts', v_conflicts);
  end if;

  for x in select * from jsonb_array_elements(p_hours) loop
    begin
      insert into public.operating_hours (court_id, day_of_week, opening_time, closing_time, is_closed)
      values (p_court, (x ->> 'day_of_week')::smallint,
              case when (x ->> 'is_closed')::boolean then null else (x ->> 'opening_time')::time end,
              case when (x ->> 'is_closed')::boolean then null else (x ->> 'closing_time')::time end,
              (x ->> 'is_closed')::boolean)
      on conflict (court_id, day_of_week) do update
        set opening_time = excluded.opening_time, closing_time = excluded.closing_time,
            is_closed = excluded.is_closed;
    exception when check_violation then
      perform public.app_error('INVALID_SETTINGS', 'Closing time must be after opening time.');
    end;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_uid, 'hours_change_acknowledged', 'operating_hours', coalesce(p_court::text, 'facility'),
            jsonb_build_object('kept_bookings', v_conflicts));
  end if;
  return jsonb_build_object('status', 'saved', 'kept_bookings', v_conflicts);
end $$;

-- Remove a court-specific weekly schedule (court falls back to facility hours).
create or replace function public.clear_court_hours(p_court uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  delete from public.operating_hours where court_id = p_court;
end $$;

-- Date override (holiday / special hours) with the same conflict review.
create or replace function public.save_special_hours(
  p_court uuid, p_date date, p_is_closed boolean, p_open time, p_close time, p_reason text,
  p_acknowledge boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid       uuid := public.require_admin();
  tz          text := public.facility_tz();
  v_conflicts jsonb;
begin
  if p_date is null or p_date < public.local_today() then
    perform public.app_error('INVALID_RANGE', 'Choose today or a future date.');
  end if;
  if not p_is_closed and (p_open is null or p_close is null or p_close <= p_open) then
    perform public.app_error('INVALID_SETTINGS', 'Closing time must be after opening time.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', b.id, 'booking_reference', b.booking_reference, 'court_name', c.name,
           'start_at', b.start_at, 'end_at', b.end_at, 'customer_name', b.customer_name) order by b.start_at), '[]'::jsonb)
    into v_conflicts
    from public.bookings b join public.courts c on c.id = b.court_id
   where b.booking_status in ('pending', 'confirmed')
     and (b.start_at at time zone tz)::date = p_date
     and (p_court is null or b.court_id = p_court)
     and (p_is_closed
          or (b.start_at at time zone tz)::time < p_open
          or (b.end_at at time zone tz)::time > p_close);

  if jsonb_array_length(v_conflicts) > 0 and not coalesce(p_acknowledge, false) then
    return jsonb_build_object('status', 'conflicts', 'conflicts', v_conflicts);
  end if;

  insert into public.special_hours (court_id, date, is_closed, opening_time, closing_time, reason)
  values (p_court, p_date, p_is_closed,
          case when p_is_closed then null else p_open end,
          case when p_is_closed then null else p_close end, coalesce(btrim(p_reason), ''))
  on conflict (court_id, date) do update
    set is_closed = excluded.is_closed, opening_time = excluded.opening_time,
        closing_time = excluded.closing_time, reason = excluded.reason;

  if jsonb_array_length(v_conflicts) > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_uid, 'special_hours_acknowledged', 'special_hours', p_date::text,
            jsonb_build_object('kept_bookings', v_conflicts));
  end if;
  return jsonb_build_object('status', 'saved', 'kept_bookings', v_conflicts);
end $$;

create or replace function public.delete_special_hours(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  delete from public.special_hours where id = p_id;
end $$;

-- Activate / deactivate a court. Deactivation never touches existing bookings,
-- but upcoming ones must be acknowledged first.
create or replace function public.set_court_active(p_court uuid, p_active boolean, p_acknowledge boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_conflicts jsonb;
begin
  perform public.require_admin();
  if not exists (select 1 from public.courts where id = p_court) then
    perform public.app_error('NOT_FOUND', 'Court not found.');
  end if;
  if not p_active then
    select coalesce(jsonb_agg(jsonb_build_object(
             'booking_id', id, 'booking_reference', booking_reference, 'start_at', start_at,
             'end_at', end_at, 'customer_name', customer_name) order by start_at), '[]'::jsonb)
      into v_conflicts
      from public.bookings
     where court_id = p_court and booking_status in ('pending', 'confirmed') and start_at > now();
    if jsonb_array_length(v_conflicts) > 0 and not coalesce(p_acknowledge, false) then
      return jsonb_build_object('status', 'conflicts', 'conflicts', v_conflicts);
    end if;
  end if;
  update public.courts set is_active = p_active where id = p_court;
  return jsonb_build_object('status', 'saved', 'kept_bookings', coalesce(v_conflicts, '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ roles --
create or replace function public.set_user_role(p_user uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_admin();
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    perform public.app_error('NOT_FOUND', 'User not found.');
  end if;
  if p_role <> 'admin' and (select role from public.profiles where id = p_user) = 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    perform public.app_error('LAST_ADMIN', 'You cannot remove the last administrator.');
  end if;
  perform set_config('app.role_change', 'on', true);
  update public.profiles set role = p_role where id = p_user;
end $$;

-- Guard: role can only change through set_user_role (or by service role / SQL editor).
create or replace function public.guard_profile_role()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('app.role_change', true), '') <> 'on'
     and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception using errcode = '42501', message = 'Role changes are not allowed.', hint = 'FORBIDDEN';
  end if;
  return new;
end $$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

create or replace function public.search_customers(p_query text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, full_name text, email text, mobile_number text, role public.app_role,
               created_at timestamptz, total_bookings bigint, upcoming_bookings bigint,
               last_booking_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_staff();
  return query
  select p.id, p.full_name, p.email::text, p.mobile_number, p.role, p.created_at,
         count(b.id), count(b.id) filter (where b.start_at > now() and b.booking_status in ('pending', 'confirmed')),
         max(b.start_at), count(*) over ()
    from public.profiles p
    left join public.bookings b on b.customer_id = p.id
   where p_query is null or btrim(p_query) = ''
      or p.full_name ilike '%' || p_query || '%' or p.email::text ilike '%' || p_query || '%'
      or p.mobile_number ilike '%' || p_query || '%'
   group by p.id
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

-- -------------------------------------------------------------- overview ---
-- Definitions:
--   paid revenue    = verified payment amounts minus refunds, by payment verification date
--   booking value   = total_amount of non-cancelled/expired bookings, by session date
--   pending payment = amounts awaiting admin verification
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
    'todays_bookings', (select count(*) from public.bookings
                         where start_at >= d_start and start_at < d_end
                           and booking_status in ('pending', 'confirmed', 'completed', 'no_show')),
    'upcoming_bookings', (select count(*) from public.bookings
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
    'cancellations_today', (select count(*) from public.bookings where cancelled_at >= d_start and cancelled_at < d_end),
    'pending_reservations', (select count(*) from public.bookings where booking_status = 'pending'),
    'pending_payment_verifications', (select count(*) from public.payments where payment_status = 'pending'),
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

-- ---------------------------------------------------------------- reports --
create or replace function public.admin_report(p_from date, p_to date, p_court uuid default null,
                                               p_status public.booking_status default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz      text := public.facility_tz();
  r_start timestamptz;
  r_end   timestamptz;
  v_open  numeric := 0;
  c record; h record; d date;
begin
  perform public.require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform public.app_error('INVALID_RANGE', 'Choose a date range of up to one year.');
  end if;
  r_start := p_from::timestamp at time zone tz;
  r_end   := (p_to + 1)::timestamp at time zone tz;

  for c in select id from public.courts where (p_court is null or id = p_court) loop
    for d in select generate_series(p_from, p_to, interval '1 day')::date loop
      select * into h from public.court_hours(c.id, d);
      if not h.is_closed then v_open := v_open + extract(epoch from h.close_at - h.open_at) / 60; end if;
    end loop;
  end loop;

  return (
    with bk as (
      select b.*, (b.start_at at time zone tz) as lstart
        from public.bookings b
       where b.start_at >= r_start and b.start_at < r_end
         and (p_court is null or b.court_id = p_court)
         and (p_status is null or b.booking_status = p_status)
    ), pay as (
      select p.*, (p.verified_at at time zone tz)::date as vday
        from public.payments p join public.bookings b on b.id = p.booking_id
       where p.verified_at >= r_start and p.verified_at < r_end
         and p.payment_status in ('paid', 'refunded')
         and (p_court is null or b.court_id = p_court)
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'currency', (select currency from public.facility_settings where id = 1),
      'totals', jsonb_build_object(
         'bookings', (select count(*) from bk),
         'confirmed', (select count(*) from bk where booking_status = 'confirmed'),
         'completed', (select count(*) from bk where booking_status = 'completed'),
         'pending', (select count(*) from bk where booking_status = 'pending'),
         'cancelled', (select count(*) from bk where booking_status = 'cancelled'),
         'no_show', (select count(*) from bk where booking_status = 'no_show'),
         'expired', (select count(*) from bk where booking_status = 'expired'),
         'booking_value', (select coalesce(sum(total_amount), 0) from bk
                            where booking_status in ('pending', 'confirmed', 'completed', 'no_show')),
         'paid_revenue', (select coalesce(sum(amount - refunded_amount), 0) from pay),
         'refunds', (select coalesce(sum(refunded_amount), 0) from pay),
         'outstanding', (select coalesce(sum(total_amount - amount_paid), 0) from bk
                          where booking_status in ('pending', 'confirmed', 'completed') and total_amount > amount_paid),
         'paid_bookings', (select count(*) from bk where payment_status = 'paid'),
         'unpaid_bookings', (select count(*) from bk where payment_status in ('unpaid', 'failed', 'partially_paid', 'pending')
                              and booking_status in ('pending', 'confirmed', 'completed')),
         'booked_minutes', (select coalesce(sum(duration_minutes), 0) from bk
                             where booking_status in ('pending', 'confirmed', 'completed')),
         'open_minutes', round(v_open),
         'utilization_pct', case when v_open = 0 then 0 else round(100 * (select coalesce(sum(duration_minutes), 0) from bk
                             where booking_status in ('pending', 'confirmed', 'completed')) / v_open, 1) end,
         'cancellation_rate_pct', case when (select count(*) from bk) = 0 then 0
                                  else round(100.0 * (select count(*) from bk where booking_status = 'cancelled') / (select count(*) from bk), 1) end
      ),
      'by_day', coalesce((select jsonb_agg(row_to_json(x) order by x.day) from (
          select g.day::date as day,
                 (select count(*) from bk where bk.lstart::date = g.day::date) as bookings,
                 (select count(*) from bk where bk.lstart::date = g.day::date and booking_status = 'cancelled') as cancelled,
                 (select coalesce(sum(total_amount), 0) from bk where bk.lstart::date = g.day::date
                     and booking_status in ('pending', 'confirmed', 'completed', 'no_show')) as booking_value,
                 (select coalesce(sum(amount - refunded_amount), 0) from pay where pay.vday = g.day::date) as paid_revenue
            from generate_series(p_from, p_to, interval '1 day') g(day)) x), '[]'::jsonb),
      'by_court', coalesce((select jsonb_agg(row_to_json(x) order by x.court_name) from (
          select ct.id as court_id, ct.name as court_name,
                 count(bk.id) filter (where bk.booking_status in ('pending', 'confirmed', 'completed')) as bookings,
                 coalesce(sum(bk.duration_minutes) filter (where bk.booking_status in ('pending', 'confirmed', 'completed')), 0) as booked_minutes,
                 coalesce(sum(bk.total_amount) filter (where bk.booking_status in ('pending', 'confirmed', 'completed', 'no_show')), 0) as booking_value
            from public.courts ct left join bk on bk.court_id = ct.id
           where p_court is null or ct.id = p_court
           group by ct.id, ct.name) x), '[]'::jsonb),
      'by_hour', coalesce((select jsonb_agg(row_to_json(x) order by x.hour) from (
          select extract(hour from lstart)::int as hour, count(*) as bookings
            from bk where booking_status in ('pending', 'confirmed', 'completed', 'no_show')
           group by 1) x), '[]'::jsonb),
      'by_weekday', coalesce((select jsonb_agg(row_to_json(x) order by x.dow) from (
          select extract(dow from lstart)::int as dow, count(*) as bookings
            from bk where booking_status in ('pending', 'confirmed', 'completed', 'no_show')
           group by 1) x), '[]'::jsonb)
    )
  );
end $$;
