-- =============================================================================
-- Migration 0300: transactional booking operations (holds, bookings, blocks)
-- Every function here is SECURITY DEFINER, re-validates on the server and
-- relies on the slot_locks exclusion constraint as the final arbiter.
-- =============================================================================

-- Insert a lock; translate exclusion violations into a clean SLOT_TAKEN error.
create or replace function public.acquire_lock(
  p_court uuid, p_kind public.lock_kind, p_ref uuid,
  p_start timestamptz, p_end timestamptz, p_expires timestamptz default null,
  p_conflict_code text default 'SLOT_TAKEN')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id    uuid;
  v_range tstzrange := public.lock_range_for(p_start, p_end, p_kind);
begin
  perform public.sweep_expired_holds(p_court, v_range);
  begin
    insert into public.slot_locks (court_id, kind, ref_id, start_at, end_at, lock_range, local_date, expires_at)
    values (p_court, p_kind, p_ref, p_start, p_end, v_range, public.local_date_of(p_start), p_expires)
    returning id into v_id;
  exception when exclusion_violation then
    perform public.app_error(p_conflict_code,
      case p_conflict_code
        when 'HOLD_EXPIRED_SLOT_TAKEN' then 'Your hold expired and someone else has since reserved this time. Please choose another slot.'
        else 'Sorry — that time was just reserved by someone else. Please pick another slot.'
      end);
  end;
  return v_id;
end $$;

create or replace function public.release_lock(p_ref uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.slot_locks set active = false where ref_id = p_ref and active
$$;

-- Recompute derived payment fields on a booking.
create or replace function public.refresh_booking_payment(p_booking uuid)
returns public.payment_status language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total    numeric;
  v_paid     numeric;
  v_refunded numeric;
  v_pending  boolean;
  v_failed   boolean;
  v_status   public.payment_status;
begin
  select total_amount into v_total from public.bookings where id = p_booking;
  select coalesce(sum(amount) filter (where payment_status in ('paid', 'refunded')), 0)
           - coalesce(sum(refunded_amount), 0),
         coalesce(sum(refunded_amount), 0),
         bool_or(payment_status = 'pending'),
         bool_or(payment_status = 'failed')
    into v_paid, v_refunded, v_pending, v_failed
    from public.payments where booking_id = p_booking;

  v_status := case
    when coalesce(v_pending, false)          then 'pending'
    when v_refunded > 0 and v_paid <= 0      then 'refunded'
    when v_refunded > 0                      then 'partially_refunded'
    when v_paid >= v_total and v_total > 0   then 'paid'
    when v_paid > 0                          then 'partially_paid'
    when coalesce(v_failed, false)           then 'failed'
    else 'unpaid'
  end::public.payment_status;

  update public.bookings set amount_paid = v_paid, payment_status = v_status where id = p_booking;
  return v_status;
end $$;

create or replace function public.booking_json(b public.bookings)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', b.id, 'booking_reference', b.booking_reference, 'court_id', b.court_id,
    'court_name', (select name from public.courts where id = b.court_id),
    'start_at', b.start_at, 'end_at', b.end_at, 'duration_minutes', b.duration_minutes,
    'booking_status', b.booking_status, 'payment_status', b.payment_status,
    'hourly_rate_snapshot', b.hourly_rate_snapshot, 'total_amount', b.total_amount,
    'amount_paid', b.amount_paid, 'currency', b.currency, 'price_breakdown', b.price_breakdown,
    'payment_method', b.payment_method, 'payment_due_at', b.payment_due_at)
$$;

-- --------------------------------------------------------------- holds -----
create or replace function public.create_hold(p_court uuid, p_start timestamptz, p_duration int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := public.require_auth();
  s       public.facility_settings := public.settings();
  v_end   timestamptz;
  v_quote jsonb;
  v_hold  uuid := gen_random_uuid();
  v_exp   timestamptz;
begin
  -- simple abuse protection: at most 20 holds per user per 10 minutes
  if (select count(*) from public.booking_holds
       where customer_id = v_uid and created_at > now() - interval '10 minutes') >= 20 then
    perform public.app_error('RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
  end if;

  v_end   := public.validate_booking_request(p_court, p_start, p_duration, false);
  v_quote := public.compute_price(p_court, p_start, v_end);
  v_exp   := now() + make_interval(mins => s.hold_minutes);

  -- one active hold per customer: release any previous one
  update public.slot_locks l set active = false
    from public.booking_holds h
   where h.customer_id = v_uid and h.status = 'active' and l.ref_id = h.id and l.active;
  update public.booking_holds set status = 'released'
   where customer_id = v_uid and status = 'active';

  insert into public.booking_holds (id, customer_id, court_id, start_at, end_at, expires_at, quote)
  values (v_hold, v_uid, p_court, p_start, v_end, v_exp, v_quote);

  perform public.acquire_lock(p_court, 'hold', v_hold, p_start, v_end, v_exp);

  return v_quote || jsonb_build_object(
    'hold_id', v_hold, 'court_id', p_court, 'start_at', p_start, 'end_at', v_end,
    'duration_minutes', p_duration, 'expires_at', v_exp);
end $$;

create or replace function public.release_hold(p_hold uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_auth();
begin
  update public.booking_holds set status = 'released'
   where id = p_hold and customer_id = v_uid and status = 'active';
  if found then perform public.release_lock(p_hold); end if;
end $$;

create or replace function public.get_my_hold(p_hold uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare h public.booking_holds;
begin
  select * into h from public.booking_holds where id = p_hold and customer_id = auth.uid();
  if not found then return null; end if;
  return h.quote || jsonb_build_object(
    'hold_id', h.id, 'court_id', h.court_id,
    'court_name', (select name from public.courts where id = h.court_id),
    'start_at', h.start_at, 'end_at', h.end_at,
    'duration_minutes', (extract(epoch from h.end_at - h.start_at) / 60)::int,
    'expires_at', h.expires_at,
    'status', case when h.status = 'active' and h.expires_at <= now() then 'expired' else h.status::text end,
    'booking_id', h.booking_id);
end $$;

-- ----------------------------------------------------- contact validation --
create or replace function public.validate_contact(p_name text, p_email text, p_phone text, p_players int, p_notes text)
returns void language plpgsql immutable as $$
begin
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 then
    perform public.app_error('INVALID_CONTACT', 'Please enter your full name (2–120 characters).');
  end if;
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_email) > 254 then
    perform public.app_error('INVALID_CONTACT', 'Please enter a valid email address.');
  end if;
  if p_phone is null or regexp_replace(p_phone, '[\s\-\(\)]', '', 'g') !~ '^\+?[0-9]{7,15}$' then
    perform public.app_error('INVALID_CONTACT', 'Please enter a valid mobile number.');
  end if;
  if p_players is not null and p_players not between 1 and 8 then
    perform public.app_error('INVALID_CONTACT', 'Number of players must be between 1 and 8.');
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    perform public.app_error('INVALID_CONTACT', 'Notes must be 500 characters or fewer.');
  end if;
end $$;

-- ---------------------------------------------------------- confirmation ---
-- Converts the caller's hold into a booking. Idempotent: calling it again for
-- an already-converted hold returns the same booking (double-submit safe).
create or replace function public.confirm_booking(
  p_hold uuid, p_name text, p_email text, p_phone text,
  p_players int default null, p_notes text default null,
  p_payment_method public.payment_method default 'cash',
  p_accept_terms boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := public.require_auth();
  s         public.facility_settings := public.settings();
  h         public.booking_holds;
  b         public.bookings;
  v_quote   jsonb;
  v_end     timestamptz;
  v_lock    uuid;
  v_status  public.booking_status;
  v_booking uuid := gen_random_uuid();
begin
  select * into h from public.booking_holds where id = p_hold for update;
  if not found or h.customer_id <> v_uid then
    perform public.app_error('HOLD_NOT_FOUND', 'We could not find your reservation hold. Please select a time again.');
  end if;

  if h.status = 'converted' then
    select * into b from public.bookings where id = h.booking_id;
    return public.booking_json(b) || jsonb_build_object('idempotent_replay', true);
  end if;
  if h.status = 'released' then
    perform public.app_error('HOLD_RELEASED', 'This hold was released. Please select a time again.');
  end if;

  if not coalesce(p_accept_terms, false) then
    perform public.app_error('TERMS_REQUIRED', 'Please agree to the booking and cancellation policy.');
  end if;
  perform public.validate_contact(p_name, p_email, p_phone, p_players, p_notes);
  if p_payment_method is null or not public.payment_method_enabled(p_payment_method) then
    perform public.app_error('PAYMENT_METHOD_UNAVAILABLE', 'That payment method is not available.');
  end if;

  -- Re-validate everything: rules, hours, court status may have changed.
  v_end := public.validate_booking_request(h.court_id, h.start_at,
             (extract(epoch from h.end_at - h.start_at) / 60)::int, false);

  if h.status = 'active' and h.expires_at > now() then
    v_quote := h.quote;                         -- honour the quoted price
  else
    v_quote := public.compute_price(h.court_id, h.start_at, v_end);
  end if;

  v_status := case when s.booking_confirmation_mode = 'auto' then 'confirmed' else 'pending' end;

  insert into public.bookings (
    id, booking_reference, customer_id, court_id, start_at, end_at, duration_minutes,
    booking_status, payment_status, hourly_rate_snapshot, total_amount, currency, price_breakdown,
    customer_name, customer_email, customer_phone, players, notes, payment_method,
    payment_due_at, source, created_by, confirmed_at)
  values (
    v_booking, public.next_booking_reference(), v_uid, h.court_id, h.start_at, v_end,
    (extract(epoch from v_end - h.start_at) / 60)::int,
    v_status, 'unpaid', (v_quote ->> 'hourly_rate')::numeric, (v_quote ->> 'total')::numeric,
    v_quote ->> 'currency', v_quote -> 'breakdown',
    btrim(p_name), lower(btrim(p_email)), btrim(p_phone), p_players, nullif(btrim(p_notes), ''),
    p_payment_method,
    case when v_status = 'pending'
         then least(now() + make_interval(hours => s.payment_due_hours), h.start_at) end,
    'online', v_uid, case when v_status = 'confirmed' then now() end)
  returning * into b;

  -- Convert the hold's lock in place. If it was swept (hold expired and
  -- someone else took the slot) the update matches nothing and we try to
  -- acquire a fresh lock, which the exclusion constraint arbitrates.
  update public.slot_locks
     set kind = 'booking', ref_id = v_booking, expires_at = null
   where ref_id = h.id and active
  returning id into v_lock;
  if v_lock is null then
    perform public.acquire_lock(h.court_id, 'booking', v_booking, h.start_at, v_end, null, 'HOLD_EXPIRED_SLOT_TAKEN');
  end if;

  update public.booking_holds set status = 'converted', booking_id = v_booking where id = h.id;

  -- remember contact details on the profile if missing
  update public.profiles
     set full_name = coalesce(full_name, btrim(p_name)),
         mobile_number = coalesce(mobile_number, btrim(p_phone))
   where id = v_uid;

  return public.booking_json(b);
end $$;

-- ----------------------------------------------------------- cancellation --
create or replace function public.cancel_booking(p_booking uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := public.require_auth();
  v_staff boolean := public.is_staff();
  s       public.facility_settings := public.settings();
  b       public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or (b.customer_id is distinct from v_uid and not v_staff) then
    perform public.app_error('NOT_FOUND', 'Booking not found.');
  end if;
  if b.booking_status not in ('pending', 'confirmed') then
    perform public.app_error('INVALID_STATUS', format('A %s booking cannot be cancelled.', replace(b.booking_status::text, '_', '-')));
  end if;
  if v_staff then
    if p_reason is null or char_length(btrim(p_reason)) < 3 then
      perform public.app_error('REASON_REQUIRED', 'Please enter a cancellation reason for the audit log.');
    end if;
  elsif now() > b.start_at - make_interval(hours => s.cancellation_deadline_hours) then
    perform public.app_error('CANCEL_DEADLINE_PASSED',
      format('Online cancellation closes %s hours before the booking. Please contact the facility.', s.cancellation_deadline_hours));
  end if;

  update public.bookings
     set booking_status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
         cancellation_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
   where id = p_booking
  returning * into b;
  perform public.release_lock(p_booking);
  return public.booking_json(b);
end $$;

-- ----------------------------------------------------------- rescheduling --
create or replace function public.reschedule_booking(p_booking uuid, p_new_start timestamptz, p_new_duration int default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := public.require_auth();
  v_staff boolean := public.is_staff();
  s       public.facility_settings := public.settings();
  b       public.bookings;
  v_dur   int;
  v_end   timestamptz;
  v_quote jsonb;
  v_range tstzrange;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or (b.customer_id is distinct from v_uid and not v_staff) then
    perform public.app_error('NOT_FOUND', 'Booking not found.');
  end if;
  if b.booking_status not in ('pending', 'confirmed') then
    perform public.app_error('INVALID_STATUS', 'Only upcoming bookings can be rescheduled.');
  end if;
  if not v_staff and now() > b.start_at - make_interval(hours => s.reschedule_deadline_hours) then
    perform public.app_error('RESCHEDULE_DEADLINE_PASSED',
      format('Online rescheduling closes %s hours before the booking.', s.reschedule_deadline_hours));
  end if;

  v_dur   := coalesce(p_new_duration, b.duration_minutes);
  v_end   := public.validate_booking_request(b.court_id, p_new_start, v_dur, v_staff);
  v_quote := public.compute_price(b.court_id, p_new_start, v_end);
  v_range := public.lock_range_for(p_new_start, v_end, 'booking');

  perform public.sweep_expired_holds(b.court_id, v_range);
  begin
    update public.slot_locks
       set start_at = p_new_start, end_at = v_end, lock_range = v_range,
           local_date = public.local_date_of(p_new_start)
     where ref_id = p_booking and active;
    if not found then
      perform public.acquire_lock(b.court_id, 'booking', p_booking, p_new_start, v_end);
    end if;
  exception when exclusion_violation then
    perform public.app_error('SLOT_TAKEN', 'That new time is not available. Please choose another slot.');
  end;

  update public.bookings
     set start_at = p_new_start, end_at = v_end, duration_minutes = v_dur,
         hourly_rate_snapshot = (v_quote ->> 'hourly_rate')::numeric,
         total_amount = (v_quote ->> 'total')::numeric,
         price_breakdown = v_quote -> 'breakdown',
         rescheduled_count = rescheduled_count + 1,
         payment_due_at = case when booking_status = 'pending' then least(payment_due_at, p_new_start) end
   where id = p_booking;
  perform public.refresh_booking_payment(p_booking);

  select * into b from public.bookings where id = p_booking;
  return public.booking_json(b);
end $$;

-- ------------------------------------------------------- admin bookings ----
create or replace function public.admin_create_booking(
  p_court uuid, p_start timestamptz, p_duration int,
  p_name text, p_email text default null, p_phone text default null,
  p_customer_id uuid default null, p_players int default null, p_notes text default null,
  p_payment_method public.payment_method default 'cash',
  p_status public.booking_status default 'confirmed')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := public.require_staff();
  s       public.facility_settings := public.settings();
  v_end   timestamptz;
  v_quote jsonb;
  v_id    uuid := gen_random_uuid();
  b       public.bookings;
begin
  if p_status not in ('pending', 'confirmed') then
    perform public.app_error('INVALID_STATUS', 'New bookings must be pending or confirmed.');
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 then
    perform public.app_error('INVALID_CONTACT', 'Please enter the customer''s name.');
  end if;
  if p_email is not null and btrim(p_email) <> '' and p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform public.app_error('INVALID_CONTACT', 'Please enter a valid email address.');
  end if;
  if p_customer_id is not null and not exists (select 1 from public.profiles where id = p_customer_id) then
    perform public.app_error('NOT_FOUND', 'Customer account not found.');
  end if;

  v_end   := public.validate_booking_request(p_court, p_start, p_duration, true);
  v_quote := public.compute_price(p_court, p_start, v_end);

  insert into public.bookings (
    id, booking_reference, customer_id, court_id, start_at, end_at, duration_minutes,
    booking_status, hourly_rate_snapshot, total_amount, currency, price_breakdown,
    customer_name, customer_email, customer_phone, players, notes, payment_method,
    payment_due_at, source, created_by, confirmed_at)
  values (
    v_id, public.next_booking_reference(), p_customer_id, p_court, p_start, v_end, p_duration,
    p_status, (v_quote ->> 'hourly_rate')::numeric, (v_quote ->> 'total')::numeric,
    v_quote ->> 'currency', v_quote -> 'breakdown',
    btrim(p_name), nullif(lower(btrim(coalesce(p_email, ''))), ''), nullif(btrim(coalesce(p_phone, '')), ''),
    p_players, nullif(btrim(coalesce(p_notes, '')), ''), p_payment_method,
    case when p_status = 'pending' then least(now() + make_interval(hours => s.payment_due_hours), p_start) end,
    'admin', v_uid, case when p_status = 'confirmed' then now() end)
  returning * into b;

  perform public.acquire_lock(p_court, 'booking', v_id, p_start, v_end);
  return public.booking_json(b);
end $$;

-- Allowed staff transitions (cancellation goes through cancel_booking):
--   pending   -> confirmed
--   confirmed -> completed | no_show   (only once the session has started)
--   completed <-> no_show              (corrections)
create or replace function public.set_booking_status(p_booking uuid, p_status public.booking_status, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  b     public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    perform public.app_error('NOT_FOUND', 'Booking not found.');
  end if;
  if b.booking_status = p_status then
    return public.booking_json(b);
  end if;
  if not (
       (b.booking_status = 'pending'   and p_status = 'confirmed')
    or (b.booking_status = 'confirmed' and p_status in ('completed', 'no_show'))
    or (b.booking_status = 'completed' and p_status = 'no_show')
    or (b.booking_status = 'no_show'   and p_status = 'completed')) then
    perform public.app_error('INVALID_TRANSITION',
      format('Cannot change a %s booking to %s.', b.booking_status, p_status));
  end if;
  if p_status in ('completed', 'no_show') and b.start_at > now() then
    perform public.app_error('INVALID_TRANSITION', 'A booking can only be completed or marked no-show after it starts.');
  end if;

  update public.bookings
     set booking_status = p_status,
         confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
         payment_due_at = case when p_status = 'confirmed' then null else payment_due_at end
   where id = p_booking returning * into b;
  return public.booking_json(b);
end $$;

-- ---------------------------------------------------------- blocked slots --
-- Blocks never override existing bookings: conflicts are returned to the admin
-- who must resolve them explicitly (cancel/reschedule) first.
create or replace function public.create_blocked_slot(
  p_court_ids uuid[], p_start timestamptz, p_end timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid       uuid := public.require_staff();
  v_court     uuid;
  v_conflicts jsonb;
  v_ids       uuid[] := '{}';
  v_id        uuid;
begin
  if p_court_ids is null or cardinality(p_court_ids) = 0 then
    perform public.app_error('INVALID_REQUEST', 'Choose at least one court.');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    perform public.app_error('INVALID_RANGE', 'The block must end after it starts.');
  end if;
  if p_end - p_start > interval '31 days' then
    perform public.app_error('INVALID_RANGE', 'Blocks are limited to 31 days at a time.');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    perform public.app_error('REASON_REQUIRED', 'Please give a reason for the block.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', b.id, 'booking_reference', b.booking_reference, 'court_id', b.court_id,
           'court_name', c.name, 'start_at', b.start_at, 'end_at', b.end_at,
           'customer_name', b.customer_name, 'booking_status', b.booking_status) order by b.start_at), '[]'::jsonb)
    into v_conflicts
    from public.bookings b join public.courts c on c.id = b.court_id
   where b.court_id = any (p_court_ids) and b.booking_status in ('pending', 'confirmed')
     and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(p_start, p_end, '[)');
  if jsonb_array_length(v_conflicts) > 0 then
    perform public.app_error('BLOCK_CONFLICT',
      'Existing bookings overlap this block. Cancel or reschedule them first.', v_conflicts::text);
  end if;

  foreach v_court in array p_court_ids loop
    -- live holds yield to staff blocks (the customer sees a clear error at checkout)
    update public.booking_holds h set status = 'released'
      from public.slot_locks l
     where l.ref_id = h.id and l.court_id = v_court and l.active and l.kind = 'hold'
       and tstzrange(l.start_at, l.end_at, '[)') && tstzrange(p_start, p_end, '[)')
       and h.status = 'active';
    update public.slot_locks set active = false
     where court_id = v_court and active and kind = 'hold'
       and tstzrange(start_at, end_at, '[)') && tstzrange(p_start, p_end, '[)');

    insert into public.blocked_slots (court_id, start_at, end_at, reason, created_by)
    values (v_court, p_start, p_end, btrim(p_reason), v_uid) returning id into v_id;
    perform public.acquire_lock(v_court, 'block', v_id, p_start, p_end, null, 'SLOT_TAKEN');
    v_ids := v_ids || v_id;
  end loop;
  return jsonb_build_object('blocked_slot_ids', to_jsonb(v_ids));
end $$;

create or replace function public.delete_blocked_slot(p_block uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_staff();
begin
  perform public.release_lock(p_block);
  delete from public.blocked_slots where id = p_block;
  if not found then
    perform public.app_error('NOT_FOUND', 'Blocked slot not found.');
  end if;
end $$;

-- ------------------------------------------------------ background upkeep --
-- Run every minute (pg_cron, migration 0800). Safe to run concurrently.
create or replace function public.expire_stale_records()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n_holds    int;
  n_pending  int;
  n_complete int;
  n_purged   int;
begin
  with x as (
    update public.slot_locks set active = false
     where active and kind = 'hold' and expires_at <= now()
    returning ref_id)
  update public.booking_holds h set status = 'expired' from x
   where h.id = x.ref_id and h.status = 'active';
  get diagnostics n_holds = row_count;
  update public.booking_holds set status = 'expired' where status = 'active' and expires_at <= now();

  -- Pending bookings whose payment window lapsed, unless a payment is awaiting review.
  with x as (
    update public.bookings b set booking_status = 'expired'
     where b.booking_status = 'pending' and b.payment_due_at is not null and b.payment_due_at <= now()
       and b.payment_status not in ('pending', 'paid', 'partially_paid')
    returning b.id)
  update public.slot_locks l set active = false from x where l.ref_id = x.id and l.active;
  get diagnostics n_pending = row_count;

  -- Confirmed sessions that ended more than 12 hours ago become completed.
  update public.bookings set booking_status = 'completed'
   where booking_status = 'confirmed' and end_at < now() - interval '12 hours';
  get diagnostics n_complete = row_count;

  delete from public.slot_locks where not active and updated_at < now() - interval '30 days';
  get diagnostics n_purged = row_count;

  return jsonb_build_object('holds_expired', n_holds, 'pending_expired', n_pending,
                            'completed', n_complete, 'locks_purged', n_purged);
end $$;
