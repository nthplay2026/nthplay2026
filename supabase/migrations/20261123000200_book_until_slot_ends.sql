-- Let customers book a slot that has already started, as long as it hasn't ended
-- (e.g. 4:00-5:00 PM stays bookable until 5:00 PM). Changes only the timing rules in
-- validate_booking_request and get_availability; minimum notice now applies only to
-- slots that haven't started, and defaults to 0 for Nth Play.
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

  -- A slot stays bookable until it ends (e.g. 4-5 PM can be booked at 4:30 PM).
  if v_end <= now() then
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
    -- Minimum notice only applies to slots that haven't started yet.
    if p_start > now() and p_start < now() + make_interval(mins => coalesce(c.min_advance_minutes, s.min_advance_minutes)) then
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

      -- 'past' only once the slot has ended; a slot in progress can still be booked.
      if slot_end <= now() then
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
                (t > now() and t < now() + make_interval(mins => v_adv))
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

-- A pending booking for a slot already in progress would otherwise get a payment
-- deadline in the past (deadlines are capped at the start time) and be released by
-- expire_stale_records within a minute. Give it at least the normal payment window.
create or replace function public.apply_payment_window()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mins int;
begin
  if new.source = 'online' and new.booking_status = 'pending' and new.payment_due_at is not null then
    select payment_due_minutes into v_mins from public.facility_settings where id = 1;
    if v_mins is not null then
      new.payment_due_at := least(new.payment_due_at, now() + make_interval(mins => v_mins));
    end if;
    new.payment_due_at := greatest(new.payment_due_at, now() + make_interval(mins => coalesce(v_mins, 10)));
  end if;
  return new;
end $$;

update public.facility_settings set min_advance_minutes = 0 where id = 1;