-- =============================================================================
-- Migration 0200: helpers, validation, pricing, availability
-- Errors are raised with HINT = machine-readable code (see src/lib/errors.ts).
-- =============================================================================

-- ---------------------------------------------------------------- errors ---
create or replace function public.app_error(p_code text, p_message text, p_detail text default null)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code,
                        detail = coalesce(p_detail, '');
end $$;

-- ------------------------------------------------------- touch updated_at --
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger courts_touch before update on public.courts for each row execute function public.touch_updated_at();
create trigger court_pricing_touch before update on public.court_pricing for each row execute function public.touch_updated_at();
create trigger operating_hours_touch before update on public.operating_hours for each row execute function public.touch_updated_at();
create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();
create trigger slot_locks_touch before update on public.slot_locks for each row execute function public.touch_updated_at();
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();
create trigger notifications_touch before update on public.notifications for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- roles & identity --
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'customer'::public.app_role)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('staff', 'admin'))
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.require_auth()
returns uuid language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then
    perform public.app_error('AUTH_REQUIRED', 'Please sign in to continue.');
  end if;
  return v;
end $$;

create or replace function public.require_staff()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid := public.require_auth();
begin
  if not public.is_staff() then
    perform public.app_error('FORBIDDEN', 'Staff access is required for this action.');
  end if;
  return v;
end $$;

create or replace function public.require_admin()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid := public.require_auth();
begin
  if not public.is_admin() then
    perform public.app_error('FORBIDDEN', 'Administrator access is required for this action.');
  end if;
  return v;
end $$;

-- New auth user -> profile (role is always 'customer'; never taken from metadata).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, mobile_number)
  values (
    new.id,
    new.email,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), ''),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'mobile_number', ''), 32), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Keep profiles.email in sync when a user changes their auth email.
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users for each row execute function public.handle_user_email_change();

-- -------------------------------------------------------------- settings ---
create or replace function public.settings()
returns public.facility_settings language sql stable security definer
set search_path = public, pg_temp as $$
  select * from public.facility_settings where id = 1
$$;

create or replace function public.facility_tz()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select timezone from public.facility_settings where id = 1
$$;

create or replace function public.local_date_of(p_ts timestamptz)
returns date language sql stable as $$
  select (p_ts at time zone public.facility_tz())::date
$$;

create or replace function public.local_today()
returns date language sql stable as $$
  select (now() at time zone public.facility_tz())::date
$$;

-- Validate settings on every write.
create or replace function public.validate_facility_settings()
returns trigger language plpgsql as $$
declare m jsonb;
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    perform public.app_error('INVALID_SETTINGS', format('Unknown timezone "%s".', new.timezone));
  end if;
  if new.slot_minutes not in (15, 30, 45, 60, 90, 120) then
    perform public.app_error('INVALID_SETTINGS', 'Slot length must be 15, 30, 45, 60, 90 or 120 minutes.');
  end if;
  if new.booking_interval_minutes < 15 or new.booking_interval_minutes > 240 or new.booking_interval_minutes % 15 <> 0 then
    perform public.app_error('INVALID_SETTINGS', 'Booking interval must be a multiple of 15 minutes (15–240).');
  end if;
  if new.min_duration_minutes < 15 or new.min_duration_minutes % 15 <> 0
     or new.max_duration_minutes % 15 <> 0 or new.max_duration_minutes < new.min_duration_minutes
     or new.max_duration_minutes > 720 then
    perform public.app_error('INVALID_SETTINGS', 'Durations must be multiples of 15 minutes and minimum ≤ maximum ≤ 12 hours.');
  end if;
  if new.buffer_minutes not between 0 and 120 then
    perform public.app_error('INVALID_SETTINGS', 'Buffer must be between 0 and 120 minutes.');
  end if;
  if new.hold_minutes not between 2 and 60 then
    perform public.app_error('INVALID_SETTINGS', 'Hold duration must be between 2 and 60 minutes.');
  end if;
  if new.min_advance_minutes not between 0 and 10080 or new.max_advance_days not between 0 and 365 then
    perform public.app_error('INVALID_SETTINGS', 'Advance-booking limits are out of range.');
  end if;
  if new.cancellation_deadline_hours not between 0 and 720 or new.reschedule_deadline_hours not between 0 and 720
     or new.payment_due_hours not between 1 and 720 or new.reminder_hours_before not between 1 and 168 then
    perform public.app_error('INVALID_SETTINGS', 'Deadline settings are out of range.');
  end if;
  if new.currency !~ '^[A-Z]{3}$' then
    perform public.app_error('INVALID_SETTINGS', 'Currency must be a 3-letter ISO code.');
  end if;
  if jsonb_typeof(new.payment_methods) <> 'array' then
    perform public.app_error('INVALID_SETTINGS', 'Payment methods must be a list.');
  end if;
  for m in select * from jsonb_array_elements(new.payment_methods) loop
    if (m ->> 'method') not in ('cash', 'bank_transfer', 'gcash', 'gateway')
       or jsonb_typeof(m -> 'enabled') <> 'boolean' then
      perform public.app_error('INVALID_SETTINGS', 'Each payment method needs a valid "method" and boolean "enabled".');
    end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(new.payment_methods) x where (x ->> 'enabled')::boolean) then
    perform public.app_error('INVALID_SETTINGS', 'Enable at least one payment method.');
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger facility_settings_validate before insert or update on public.facility_settings
  for each row execute function public.validate_facility_settings();

create or replace function public.validate_court()
returns trigger language plpgsql as $$
begin
  if new.allowed_durations is not null and exists (
       select 1 from unnest(new.allowed_durations) d where d % 15 <> 0 or d > 720) then
    perform public.app_error('INVALID_SETTINGS', 'Court durations must be multiples of 15 minutes, up to 12 hours.');
  end if;
  return new;
end $$;
create trigger courts_validate before insert or update on public.courts
  for each row execute function public.validate_court();

create or replace function public.payment_method_enabled(p_method public.payment_method)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.facility_settings s, jsonb_array_elements(s.payment_methods) m
    where s.id = 1 and m ->> 'method' = p_method::text and (m ->> 'enabled')::boolean
  )
$$;

-- ----------------------------------------------------------- court hours ---
-- Resolution order: court special day > facility special day > court weekly > facility weekly.
create or replace function public.court_hours(p_court uuid, p_date date)
returns table (is_closed boolean, open_at timestamptz, close_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz  text := public.facility_tz();
  r   record;
  dow int  := extract(dow from p_date)::int;
begin
  select sh.is_closed, sh.opening_time, sh.closing_time into r
    from public.special_hours sh
   where sh.date = p_date and (sh.court_id = p_court or sh.court_id is null)
   order by (sh.court_id is null) limit 1;
  if not found then
    select oh.is_closed, oh.opening_time, oh.closing_time into r
      from public.operating_hours oh
     where oh.day_of_week = dow and (oh.court_id = p_court or oh.court_id is null)
     order by (oh.court_id is null) limit 1;
  end if;
  if not found or r.is_closed then
    return query select true, null::timestamptz, null::timestamptz;
  else
    return query select false, (p_date + r.opening_time) at time zone tz, (p_date + r.closing_time) at time zone tz;
  end if;
end $$;

-- ------------------------------------------------------------- durations ---
create or replace function public.court_durations(p_court uuid)
returns int[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select c.allowed_durations from public.courts c where c.id = p_court),
    (select array_agg(d order by d)
       from public.facility_settings s,
            generate_series(s.min_duration_minutes, s.max_duration_minutes, s.slot_minutes) d
      where s.id = 1)
  )
$$;

-- ---------------------------------------------------------------- pricing --
-- Prices are integrated in 15-minute chunks; each chunk takes the highest
-- priority matching rule (court-specific beats facility-wide), else base rate.
create or replace function public.compute_price(p_court uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz       text := public.facility_tz();
  v_base   numeric;
  v_cur    text;
  v_total  numeric;
  v_mins   int;
  v_lines  jsonb;
  v_rates  int;
begin
  select c.base_hourly_rate into v_base from public.courts c where c.id = p_court;
  if v_base is null then
    perform public.app_error('COURT_NOT_FOUND', 'That court does not exist.');
  end if;
  select currency into v_cur from public.facility_settings where id = 1;
  if extract(epoch from (p_end - p_start))::int % 900 <> 0 or p_end <= p_start then
    perform public.app_error('INVALID_DURATION', 'Duration must be a positive multiple of 15 minutes.');
  end if;

  with chunks as (
    select t, (t at time zone tz) as lt
      from generate_series(p_start, p_end - interval '15 minutes', interval '15 minutes') t
  ), priced as (
    select coalesce(r.rate, v_base) as rate, coalesce(r.label, 'Standard') as label
      from chunks c
      left join lateral (
        select cp.rate, cp.label from public.court_pricing cp
         where cp.is_active
           and (cp.court_id = p_court or cp.court_id is null)
           and (cp.days_of_week is null or extract(dow from c.lt)::smallint = any (cp.days_of_week))
           and c.lt::time >= cp.start_time and c.lt::time < cp.end_time
           and (cp.effective_from is null or c.lt::date >= cp.effective_from)
           and (cp.effective_to is null or c.lt::date <= cp.effective_to)
         order by cp.priority desc, (cp.court_id is null), cp.created_at desc
         limit 1
      ) r on true
  ), grouped as (
    select label, rate, count(*) * 15 as minutes, sum(rate) / 4 as amount
      from priced group by label, rate
  )
  select coalesce(sum(amount), 0), coalesce(sum(minutes), 0)::int, count(*),
         coalesce(jsonb_agg(jsonb_build_object('label', label, 'rate', rate, 'minutes', minutes,
                                               'amount', round(amount, 2)) order by rate), '[]'::jsonb)
    into v_total, v_mins, v_rates, v_lines
    from grouped;

  v_total := round(v_total, 2);
  return jsonb_build_object(
    'total', v_total,
    'currency', v_cur,
    'minutes', v_mins,
    'hourly_rate', case when v_mins = 0 then v_base else round(v_total / (v_mins / 60.0), 2) end,
    'breakdown', v_lines
  );
end $$;

-- ------------------------------------------------------------- validation --
-- Validates a requested booking window against all configurable rules.
-- Staff bypass advance-notice / horizon / same-day cutoff (not hours or past).
-- Returns the computed end time.
create or replace function public.validate_booking_request(
  p_court uuid, p_start timestamptz, p_duration int, p_staff boolean)
returns timestamptz language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s        public.facility_settings := public.settings();
  c        public.courts;
  v_end    timestamptz;
  v_day    date;
  v_first  date;
  h        record;
  seg_s    timestamptz;
  seg_e    timestamptz;
  v_first_open timestamptz;
begin
  if p_court is null or p_start is null or p_duration is null then
    perform public.app_error('INVALID_REQUEST', 'Court, start time and duration are required.');
  end if;

  select * into c from public.courts where id = p_court;
  if not found then
    perform public.app_error('COURT_NOT_FOUND', 'That court does not exist.');
  end if;
  if not c.is_active then
    perform public.app_error('COURT_INACTIVE', 'This court is not accepting bookings right now.');
  end if;

  if not (p_duration = any (public.court_durations(p_court))) then
    perform public.app_error('INVALID_DURATION', 'That booking length is not offered for this court.');
  end if;

  if p_start <> date_trunc('minute', p_start) then
    perform public.app_error('INVALID_TIME', 'Start time must be on the minute.');
  end if;

  v_end := p_start + make_interval(mins => p_duration);

  if p_start <= now() then
    perform public.app_error('PAST_TIME', 'That time has already passed.');
  end if;

  v_first := public.local_date_of(p_start);
  v_day   := v_first;
  loop
    seg_s := greatest(p_start, v_day::timestamp at time zone s.timezone);
    seg_e := least(v_end, (v_day + 1)::timestamp at time zone s.timezone);
    exit when seg_s >= v_end;
    if v_day > v_first and not s.allow_cross_midnight then
      perform public.app_error('OUTSIDE_HOURS', 'Bookings cannot run past midnight.');
    end if;
    select * into h from public.court_hours(p_court, v_day);
    if h.is_closed then
      perform public.app_error('CLOSED', 'The court is closed on that date.');
    end if;
    if seg_s < h.open_at or seg_e > h.close_at then
      perform public.app_error('OUTSIDE_HOURS', 'That time is outside operating hours.');
    end if;
    if v_day = v_first then v_first_open := h.open_at; end if;
    v_day := v_day + 1;
  end loop;

  if (extract(epoch from (p_start - v_first_open))::int / 60) % s.booking_interval_minutes <> 0 then
    perform public.app_error('INVALID_TIME', format('Bookings start every %s minutes from opening time.', s.booking_interval_minutes));
  end if;

  if not p_staff then
    if p_start < now() + make_interval(mins => coalesce(c.min_advance_minutes, s.min_advance_minutes)) then
      perform public.app_error('TOO_SOON', format('Bookings must be made at least %s minutes in advance.',
                                                  coalesce(c.min_advance_minutes, s.min_advance_minutes)));
    end if;
    if v_first > public.local_today() + coalesce(c.max_advance_days, s.max_advance_days) then
      perform public.app_error('TOO_FAR', format('Bookings open %s days in advance.',
                                                 coalesce(c.max_advance_days, s.max_advance_days)));
    end if;
    if s.same_day_cutoff is not null and v_first = public.local_today()
       and (now() at time zone s.timezone)::time > s.same_day_cutoff then
      perform public.app_error('SAME_DAY_CLOSED', 'Same-day booking has closed for today.');
    end if;
  end if;

  return v_end;
end $$;

-- ----------------------------------------------------------------- locks ---
create or replace function public.lock_range_for(p_start timestamptz, p_end timestamptz, p_kind public.lock_kind)
returns tstzrange language sql stable security definer set search_path = public, pg_temp as $$
  select tstzrange(p_start,
                   case when p_kind = 'block' then p_end
                        else p_end + make_interval(mins => (select buffer_minutes from public.facility_settings where id = 1))
                   end, '[)')
$$;

-- Deactivate expired holds that overlap a range (called inside booking txns).
create or replace function public.sweep_expired_holds(p_court uuid, p_range tstzrange)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with swept as (
    update public.slot_locks l set active = false
     where l.court_id = p_court and l.active and l.kind = 'hold'
       and l.expires_at <= now() and l.lock_range && p_range
    returning l.ref_id
  )
  update public.booking_holds h set status = 'expired'
    from swept where h.id = swept.ref_id and h.status = 'active';
  get diagnostics n = row_count;
  return n;
end $$;

-- True when no *live* lock (other than p_ignore_ref) overlaps the range.
create or replace function public.range_is_free(p_court uuid, p_range tstzrange, p_ignore_ref uuid default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (
    select 1 from public.slot_locks l
     where l.court_id = p_court and l.active and l.lock_range && p_range
       and (l.expires_at is null or l.expires_at > now())
       and (p_ignore_ref is null or l.ref_id <> p_ignore_ref)
  )
$$;

-- ---------------------------------------------------------- availability ---
-- Public: slot grid for one date (optionally one court). No personal data.
create or replace function public.get_availability(p_date date, p_court uuid default null)
returns table (court_id uuid, slot_start timestamptz, slot_end timestamptz, status text,
               price numeric, hold_expires_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s       public.facility_settings := public.settings();
  v_staff boolean := public.is_staff();
  v_uid   uuid := auth.uid();
  v_today date := public.local_today();
  c       public.courts;
  h       record;
  t       timestamptz;
  v_min   int;
  v_adv   int;
  v_days  int;
  l       record;
  v_status text;
begin
  if p_date is null or p_date < v_today - 1
     or p_date > v_today + (case when v_staff then 366 else s.max_advance_days + 7 end) then
    perform public.app_error('INVALID_RANGE', 'That date is outside the booking window.');
  end if;

  for c in select * from public.courts cc
            where cc.is_active and (p_court is null or cc.id = p_court)
            order by cc.sort_order, cc.name loop
    select * into h from public.court_hours(c.id, p_date);
    if h.is_closed then
      court_id := c.id; slot_start := null; slot_end := null; status := 'closed';
      price := null; hold_expires_at := null;
      return next;
      continue;
    end if;

    v_min  := (select min(d) from unnest(public.court_durations(c.id)) d);
    v_adv  := coalesce(c.min_advance_minutes, s.min_advance_minutes);
    v_days := coalesce(c.max_advance_days, s.max_advance_days);

    t := h.open_at;
    while t + make_interval(mins => s.slot_minutes) <= h.close_at loop
      court_id := c.id;
      slot_start := t;
      slot_end := t + make_interval(mins => s.slot_minutes);
      hold_expires_at := null;
      v_status := null;

      if t < now() then
        v_status := 'past';
      else
        select lk.kind, lk.expires_at, lk.ref_id, b.booking_status, bh.customer_id as holder
          into l
          from public.slot_locks lk
          left join public.bookings b on lk.kind = 'booking' and b.id = lk.ref_id
          left join public.booking_holds bh on lk.kind = 'hold' and bh.id = lk.ref_id
         where lk.court_id = c.id and lk.active
           and (lk.expires_at is null or lk.expires_at > now())
           and tstzrange(lk.start_at, lk.end_at, '[)') && tstzrange(t, slot_end, '[)')
         order by lk.kind limit 1;
        if found then
          if l.kind = 'block' then v_status := 'blocked';
          elsif l.kind = 'booking' then
            v_status := case when l.booking_status = 'pending' then 'pending' else 'booked' end;
          else
            v_status := case when v_uid is not null and l.holder = v_uid then 'held_by_you' else 'held' end;
            hold_expires_at := l.expires_at;
          end if;
        end if;
      end if;

      if v_status is null then
        if t + make_interval(mins => v_min) > h.close_at
           or not public.range_is_free(c.id, public.lock_range_for(t, t + make_interval(mins => v_min), 'booking')) then
          v_status := 'unavailable';
        elsif not v_staff and (
                t < now() + make_interval(mins => v_adv)
             or p_date > v_today + v_days
             or (s.same_day_cutoff is not null and p_date = v_today
                 and (now() at time zone s.timezone)::time > s.same_day_cutoff)) then
          v_status := 'unavailable';
        else
          v_status := 'available';
        end if;
      end if;

      status := v_status;
      price := ((public.compute_price(c.id, t, slot_end)) ->> 'hourly_rate')::numeric;
      return next;
      t := t + make_interval(mins => s.booking_interval_minutes);
    end loop;
  end loop;
end $$;

-- Durations the customer can choose for a given start, with live prices.
create or replace function public.get_booking_options(p_court uuid, p_start timestamptz)
returns table (duration_minutes int, end_at timestamptz, total numeric, available boolean, reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d       int;
  v_end   timestamptz;
  v_staff boolean := public.is_staff();
  v_hold  uuid;
begin
  -- the caller's own active hold should not block their own options
  select h.id into v_hold from public.booking_holds h
   where h.customer_id = auth.uid() and h.status = 'active' and h.expires_at > now()
     and h.court_id = p_court limit 1;

  foreach d in array public.court_durations(p_court) loop
    duration_minutes := d;
    end_at := p_start + make_interval(mins => d);
    total := null; available := false; reason := null;
    begin
      v_end := public.validate_booking_request(p_court, p_start, d, v_staff);
      if not public.range_is_free(p_court, public.lock_range_for(p_start, v_end, 'booking'), v_hold) then
        reason := 'This length overlaps another reservation.';
      else
        available := true;
      end if;
      total := ((public.compute_price(p_court, p_start, v_end)) ->> 'total')::numeric;
    exception when others then
      reason := sqlerrm;
    end;
    return next;
  end loop;
end $$;

-- Validated price quote (no reservation made).
create or replace function public.get_quote(p_court uuid, p_start timestamptz, p_duration int)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_end timestamptz;
begin
  v_end := public.validate_booking_request(p_court, p_start, p_duration, public.is_staff());
  return public.compute_price(p_court, p_start, v_end)
         || jsonb_build_object('court_id', p_court, 'start_at', p_start, 'end_at', v_end,
                               'duration_minutes', p_duration);
end $$;

-- ----------------------------------------------------- booking reference ---
create or replace function public.next_booking_reference()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d date := public.local_today();
  n int;
begin
  insert into public.booking_ref_counters as c (day, last) values (d, 1)
  on conflict (day) do update set last = c.last + 1
  returning c.last into n;
  return 'PB-' || to_char(d, 'YYYYMMDD') || '-' ||
         case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
end $$;
