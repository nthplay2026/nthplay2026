-- =============================================================================
-- Book several separate time blocks in one checkout.
-- A customer can tap non-consecutive slots; each continuous run becomes its own
-- hold (and later its own booking), but they are held and confirmed together.
-- =============================================================================

-- Holds every block in p_items atomically: [{"court": uuid, "start": timestamptz, "duration": int}, …]
-- Replaces the customer's previous active hold(s), like create_hold.
create or replace function public.create_holds(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := public.require_auth();
  s       public.facility_settings := public.settings();
  v_n     int;
  item    jsonb;
  v_court uuid;
  v_start timestamptz;
  v_dur   int;
  v_end   timestamptz;
  v_quote jsonb;
  v_hold  uuid;
  v_exp   timestamptz := now() + make_interval(mins => s.hold_minutes);
  v_out   jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform public.app_error('INVALID_REQUEST', 'Please choose at least one time slot.');
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n > 24 then
    perform public.app_error('INVALID_REQUEST', 'You can book up to 24 separate time blocks at once.');
  end if;

  -- same abuse protection as create_hold, counted per block
  if (select count(*) from public.booking_holds
       where customer_id = v_uid and created_at > now() - interval '10 minutes') + v_n > 60 then
    perform public.app_error('RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
  end if;

  -- one active selection per customer: release any previous holds
  update public.slot_locks l set active = false
    from public.booking_holds h
   where h.customer_id = v_uid and h.status = 'active' and l.ref_id = h.id and l.active;
  update public.booking_holds set status = 'released'
   where customer_id = v_uid and status = 'active';

  for item in select value from jsonb_array_elements(p_items) loop
    v_court := (item ->> 'court')::uuid;
    v_start := (item ->> 'start')::timestamptz;
    v_dur   := (item ->> 'duration')::int;

    v_end   := public.validate_booking_request(v_court, v_start, v_dur, false);
    v_quote := public.compute_price(v_court, v_start, v_end);
    v_hold  := gen_random_uuid();

    insert into public.booking_holds (id, customer_id, court_id, start_at, end_at, expires_at, quote)
    values (v_hold, v_uid, v_court, v_start, v_end, v_exp, v_quote);

    -- fails with SLOT_TAKEN (rolling back every block) if any block overlaps
    perform public.acquire_lock(v_court, 'hold', v_hold, v_start, v_end, v_exp);

    v_out := v_out || jsonb_build_array(v_quote || jsonb_build_object(
      'hold_id', v_hold, 'court_id', v_court, 'start_at', v_start, 'end_at', v_end,
      'duration_minutes', v_dur, 'expires_at', v_exp));
  end loop;

  return v_out;
end $$;

-- Confirms several holds with the same customer details. All or nothing:
-- if any block can no longer be booked, none are.
create or replace function public.confirm_bookings(
  p_holds uuid[], p_name text, p_email text, p_phone text,
  p_players int default null, p_notes text default null,
  p_payment_method public.payment_method default 'cash',
  p_accept_terms boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hold uuid;
  v_out  jsonb := '[]'::jsonb;
begin
  perform public.require_auth();
  if p_holds is null or cardinality(p_holds) = 0 then
    perform public.app_error('HOLD_NOT_FOUND', 'We could not find your reservation hold. Please select a time again.');
  end if;
  foreach v_hold in array p_holds loop
    v_out := v_out || jsonb_build_array(public.confirm_booking(
      v_hold, p_name, p_email, p_phone, p_players, p_notes, p_payment_method, p_accept_terms));
  end loop;
  return v_out;
end $$;

revoke all on function public.create_holds(jsonb) from public, anon;
revoke all on function public.confirm_bookings(uuid[], text, text, text, int, text, public.payment_method, boolean) from public, anon;
grant execute on function
  public.create_holds(jsonb),
  public.confirm_bookings(uuid[], text, text, text, int, text, public.payment_method, boolean)
  to authenticated;
