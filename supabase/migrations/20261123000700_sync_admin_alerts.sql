-- =============================================================================
-- Admin alerts follow the payment. Once nothing in a checkout is waiting for
-- review any more (its receipt was verified or rejected, or the booking was
-- cancelled / expired), the "Payment to verify" and "New booking" alerts for that
-- checkout are marked as read for every admin, so the bell's unread count drops
-- on all devices (the bell listens for changes live).
-- =============================================================================

-- Marks a checkout's admin alerts as read when it has no payment left to review.
create or replace function public.settle_admin_alerts(p_booking uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref text;
  n     int;
begin
  select coalesce(group_ref, booking_reference) into v_ref from public.bookings where id = p_booking;
  if v_ref is null then return 0; end if;

  -- still something to verify in this checkout (and it's still live): keep the alerts
  if exists (select 1 from public.payments p join public.bookings b on b.id = p.booking_id
              where coalesce(b.group_ref, b.booking_reference) = v_ref
                and p.payment_status = 'pending'
                and b.booking_status in ('pending', 'confirmed')) then
    return 0;
  end if;

  update public.user_notifications u set read_at = now()
   where u.read_at is null
     and u.kind in ('admin_payment_submitted', 'admin_new_booking')
     and u.booking_id in (select id from public.bookings where coalesce(group_ref, booking_reference) = v_ref);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.settle_admin_alerts(uuid) from public, anon, authenticated;

create or replace function public.payments_settle_admin_alerts()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.payment_status = 'pending' and new.payment_status <> 'pending' then
    perform public.settle_admin_alerts(new.booking_id);
  end if;
  return null;
end $$;
revoke all on function public.payments_settle_admin_alerts() from public, anon, authenticated;

drop trigger if exists payments_settle_admin_alerts on public.payments;
create trigger payments_settle_admin_alerts after update of payment_status on public.payments
  for each row execute function public.payments_settle_admin_alerts();

create or replace function public.bookings_settle_admin_alerts()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.booking_status in ('cancelled', 'expired') and old.booking_status is distinct from new.booking_status then
    perform public.settle_admin_alerts(new.id);
  end if;
  return null;
end $$;
revoke all on function public.bookings_settle_admin_alerts() from public, anon, authenticated;

drop trigger if exists bookings_settle_admin_alerts on public.bookings;
create trigger bookings_settle_admin_alerts after update of booking_status on public.bookings
  for each row execute function public.bookings_settle_admin_alerts();

-- Catch up: alerts for checkouts that were already reviewed before this change.
do $$
declare r record;
begin
  for r in select distinct booking_id from public.user_notifications
            where read_at is null and booking_id is not null
              and kind in ('admin_payment_submitted', 'admin_new_booking') loop
    perform public.settle_admin_alerts(r.booking_id);
  end loop;
end $$;
