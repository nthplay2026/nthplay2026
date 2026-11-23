-- =============================================================================
-- Short payment window for online bookings.
-- Checkout already holds the slots for hold_minutes. If a booking is made but no
-- receipt arrives, it now stays pending for only payment_due_minutes (instead of
-- payment_due_hours) before expire_stale_records releases the time. Bookings
-- with a receipt awaiting review are never released by that job.
-- =============================================================================

alter table public.facility_settings
  add column if not exists payment_due_minutes int
  check (payment_due_minutes is null or payment_due_minutes between 5 and 1440);

comment on column public.facility_settings.payment_due_minutes is
  'Minutes a pending online booking waits for a receipt before it is released. Overrides payment_due_hours when set.';

create or replace function public.apply_payment_window()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mins int;
begin
  if new.source = 'online' and new.booking_status = 'pending' and new.payment_due_at is not null then
    select payment_due_minutes into v_mins from public.facility_settings where id = 1;
    if v_mins is not null then
      new.payment_due_at := least(new.payment_due_at, now() + make_interval(mins => v_mins));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bookings_payment_window on public.bookings;
create trigger bookings_payment_window before insert on public.bookings
  for each row execute function public.apply_payment_window();

update public.facility_settings set payment_due_minutes = 10, hold_minutes = 10 where id = 1;
