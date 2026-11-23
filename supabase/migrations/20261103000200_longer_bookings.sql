-- =============================================================================
-- Let customers book long continuous blocks: raise the duration ceiling from
-- 12 hours to 24 hours (one full day of a 24/7 schedule), and set the facility
-- maximum to that ceiling. Separate blocks have no combined limit.
-- =============================================================================

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
     or new.max_duration_minutes > 1440 then
    perform public.app_error('INVALID_SETTINGS', 'Durations must be multiples of 15 minutes and minimum ≤ maximum ≤ 24 hours.');
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

create or replace function public.validate_court()
returns trigger language plpgsql as $$
begin
  if new.allowed_durations is not null and exists (
       select 1 from unnest(new.allowed_durations) d where d % 15 <> 0 or d > 1440) then
    perform public.app_error('INVALID_SETTINGS', 'Court durations must be multiples of 15 minutes, up to 24 hours.');
  end if;
  return new;
end $$;

update public.facility_settings set max_duration_minutes = 1440 where id = 1;
