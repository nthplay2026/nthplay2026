-- =============================================================================
-- Only staff/admins can reschedule (cancelling was already staff-only).
-- Rescheduling moves the booking's slot lock, so the old time frees up at once;
-- cancelling releases the lock (see cancel_booking).
-- =============================================================================

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
  if not v_staff then
    perform public.app_error('NO_RESCHEDULE',
      'Bookings can only be changed by the facility. Please contact us to reschedule.');
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
