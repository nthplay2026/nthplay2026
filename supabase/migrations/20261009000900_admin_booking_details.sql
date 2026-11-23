-- =============================================================================
-- Migration 0900: staff can correct a booking's contact details / notes.
-- Time, court and price changes go through reschedule_booking (conflict-safe);
-- status changes through set_booking_status / cancel_booking. Every change is
-- captured by the audit trigger on bookings.
-- =============================================================================
create or replace function public.admin_update_booking_details(
  p_booking uuid, p_name text, p_email text default null, p_phone text default null,
  p_players int default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  b     public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    perform public.app_error('NOT_FOUND', 'Booking not found.');
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 then
    perform public.app_error('INVALID_CONTACT', 'Please enter the customer''s name.');
  end if;
  if p_email is not null and btrim(p_email) <> '' and p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform public.app_error('INVALID_CONTACT', 'Please enter a valid email address.');
  end if;
  if p_phone is not null and btrim(p_phone) <> '' and regexp_replace(p_phone, '[\s\-\(\)]', '', 'g') !~ '^\+?[0-9]{7,15}$' then
    perform public.app_error('INVALID_CONTACT', 'Please enter a valid mobile number.');
  end if;
  if p_players is not null and p_players not between 1 and 8 then
    perform public.app_error('INVALID_CONTACT', 'Number of players must be between 1 and 8.');
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    perform public.app_error('INVALID_CONTACT', 'Notes must be 500 characters or fewer.');
  end if;

  update public.bookings
     set customer_name = btrim(p_name),
         customer_email = nullif(lower(btrim(coalesce(p_email, ''))), ''),
         customer_phone = nullif(btrim(coalesce(p_phone, '')), ''),
         players = p_players,
         notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_booking
  returning * into b;
  return public.booking_json(b);
end $$;

revoke execute on function public.admin_update_booking_details(uuid, text, text, text, int, text) from public, anon;
grant execute on function public.admin_update_booking_details(uuid, text, text, text, int, text) to authenticated;
