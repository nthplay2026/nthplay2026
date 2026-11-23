-- =============================================================================
-- Time blocks booked in one checkout share one reference for the customer.
-- Each block is still its own booking row (own slot, price and status); group_ref
-- holds the first block's booking_reference on every block of the group.
-- =============================================================================

alter table public.bookings add column if not exists group_ref text;
create index if not exists bookings_group_ref_idx on public.bookings (group_ref) where group_ref is not null;

create or replace function public.confirm_bookings(
  p_holds uuid[], p_name text, p_email text, p_phone text,
  p_players int default null, p_notes text default null,
  p_payment_method public.payment_method default 'cash',
  p_accept_terms boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hold uuid;
  v_out  jsonb := '[]'::jsonb;
  v_ref  text;
begin
  perform public.require_auth();
  if p_holds is null or cardinality(p_holds) = 0 then
    perform public.app_error('HOLD_NOT_FOUND', 'We could not find your reservation hold. Please select a time again.');
  end if;
  foreach v_hold in array p_holds loop
    v_out := v_out || jsonb_build_array(public.confirm_booking(
      v_hold, p_name, p_email, p_phone, p_players, p_notes, p_payment_method, p_accept_terms));
  end loop;

  if jsonb_array_length(v_out) > 1 then
    v_ref := v_out -> 0 ->> 'booking_reference';
    update public.bookings set group_ref = v_ref
     where id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_out) x);
    v_out := (select jsonb_agg(x || jsonb_build_object('group_ref', v_ref)) from jsonb_array_elements(v_out) x);
  end if;
  return v_out;
end $$;
