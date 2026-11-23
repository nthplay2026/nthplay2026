-- =============================================================================
-- Migration 0700: Row Level Security, table privileges, function privileges
--
-- Principle: clients never write booking/payment/lock tables directly. All
-- mutations go through SECURITY DEFINER functions above, which re-validate on
-- the server. Direct table access is read-only and filtered by RLS, except for
-- admin catalogue tables (courts, pricing) and a customer's own profile fields.
-- =============================================================================

-- ---------------------------------------------------- reset privileges -----
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

-- ------------------------------------------------------------ enable RLS ---
alter table public.profiles             enable row level security;
alter table public.facility_settings    enable row level security;
alter table public.courts               enable row level security;
alter table public.court_pricing        enable row level security;
alter table public.operating_hours      enable row level security;
alter table public.special_hours        enable row level security;
alter table public.booking_ref_counters enable row level security;
alter table public.bookings             enable row level security;
alter table public.booking_holds        enable row level security;
alter table public.blocked_slots        enable row level security;
alter table public.slot_locks           enable row level security;
alter table public.payments             enable row level security;
alter table public.payment_events       enable row level security;
alter table public.notifications        enable row level security;
alter table public.audit_logs           enable row level security;

-- ------------------------------------------------------------- profiles ----
grant select on public.profiles to authenticated;
grant update (full_name, mobile_number) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ----------------------------------------------------- facility settings ---
-- Public columns only; admin_alert_email is read via admin_get_settings().
grant select (id, facility_name, tagline, description, timezone, currency, slot_minutes,
              booking_interval_minutes, min_duration_minutes, max_duration_minutes, buffer_minutes,
              min_advance_minutes, max_advance_days, same_day_cutoff, cancellation_deadline_hours,
              reschedule_deadline_hours, hold_minutes, booking_confirmation_mode, payment_due_hours,
              allow_cross_midnight, reminder_hours_before, contact_email, contact_phone, address,
              map_url, amenities, payment_methods, updated_at)
  on public.facility_settings to anon, authenticated;
grant update (facility_name, tagline, description, timezone, currency, slot_minutes,
              booking_interval_minutes, min_duration_minutes, max_duration_minutes, buffer_minutes,
              min_advance_minutes, max_advance_days, same_day_cutoff, cancellation_deadline_hours,
              reschedule_deadline_hours, hold_minutes, booking_confirmation_mode, payment_due_hours,
              allow_cross_midnight, reminder_hours_before, contact_email, contact_phone, address,
              map_url, amenities, admin_alert_email, payment_methods)
  on public.facility_settings to authenticated;
create policy settings_read on public.facility_settings for select to anon, authenticated using (true);
create policy settings_admin_update on public.facility_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------- courts ----
grant select on public.courts to anon, authenticated;
grant insert, delete on public.courts to authenticated;
-- is_active is deliberately excluded: it changes through set_court_active() (conflict review)
grant update (name, description, court_type, image_url, base_hourly_rate, allowed_durations,
              min_advance_minutes, max_advance_days, sort_order, features)
  on public.courts to authenticated;
create policy courts_read on public.courts for select to anon, authenticated
  using (is_active or public.is_staff());
create policy courts_admin_insert on public.courts for insert to authenticated with check (public.is_admin());
create policy courts_admin_update on public.courts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- courts with booking history cannot be deleted (FK is RESTRICT); deactivate them instead
create policy courts_admin_delete on public.courts for delete to authenticated
  using (public.is_admin());

-- -------------------------------------------------------- court pricing ----
grant select on public.court_pricing to anon, authenticated;
grant insert, update, delete on public.court_pricing to authenticated;
create policy pricing_read on public.court_pricing for select to anon, authenticated
  using (is_active or public.is_staff());
create policy pricing_admin_write on public.court_pricing for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------- operating & special hours -----
-- Writes go through save_operating_hours / save_special_hours (conflict review).
grant select on public.operating_hours, public.special_hours to anon, authenticated;
create policy hours_read on public.operating_hours for select to anon, authenticated using (true);
create policy special_read on public.special_hours for select to anon, authenticated using (true);

-- ------------------------------------------------------------- bookings ----
grant select on public.bookings to authenticated;
create policy bookings_read on public.bookings for select to authenticated
  using (customer_id = auth.uid() or public.is_staff());

grant select on public.booking_holds to authenticated;
create policy holds_read on public.booking_holds for select to authenticated
  using (customer_id = auth.uid() or public.is_staff());

grant select on public.blocked_slots to authenticated;
create policy blocks_read on public.blocked_slots for select to authenticated using (public.is_staff());

-- Public availability feed: no personal data in this table.
grant select on public.slot_locks to anon, authenticated;
create policy locks_read on public.slot_locks for select to anon, authenticated using (true);

-- ------------------------------------------------------------- payments ----
grant select on public.payments to authenticated;
create policy payments_read on public.payments for select to authenticated
  using (public.is_staff()
         or exists (select 1 from public.bookings b where b.id = payments.booking_id and b.customer_id = auth.uid()));

grant select on public.payment_events to authenticated;
create policy payment_events_read on public.payment_events for select to authenticated using (public.is_admin());

-- ------------------------------------------------- notifications & audit ---
grant select on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated using (public.is_admin());

grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated using (public.is_admin());

-- booking_ref_counters: no client access at all (no grants, no policies).

-- ------------------------------------------------- function privileges -----
-- Helpers used inside RLS policies, and the error helper that validation
-- triggers (which run as the calling user) raise through. app_error only
-- raises an exception, so exposing it grants nothing.
grant execute on function public.is_staff(), public.is_admin(), public.current_app_role(),
  public.app_error(text, text, text)
  to anon, authenticated;

-- Public (guests may browse availability and prices).
grant execute on function
  public.get_availability(date, uuid),
  public.get_booking_options(uuid, timestamptz),
  public.get_quote(uuid, timestamptz, int)
  to anon, authenticated;

-- Signed-in customers (each function checks ownership itself).
grant execute on function
  public.create_hold(uuid, timestamptz, int),
  public.release_hold(uuid),
  public.get_my_hold(uuid),
  public.confirm_booking(uuid, text, text, text, int, text, public.payment_method, boolean),
  public.cancel_booking(uuid, text),
  public.reschedule_booking(uuid, timestamptz, int),
  public.submit_payment(uuid, public.payment_method, text, numeric, text)
  to authenticated;

-- Staff / admin (each function checks the role itself).
grant execute on function
  public.admin_create_booking(uuid, timestamptz, int, text, text, text, uuid, int, text, public.payment_method, public.booking_status),
  public.set_booking_status(uuid, public.booking_status, text),
  public.create_blocked_slot(uuid[], timestamptz, timestamptz, text),
  public.delete_blocked_slot(uuid),
  public.review_payment(uuid, boolean, text),
  public.record_cash_payment(uuid, numeric, text),
  public.refund_payment(uuid, numeric, text),
  public.admin_get_settings(),
  public.save_operating_hours(uuid, jsonb, boolean),
  public.clear_court_hours(uuid),
  public.save_special_hours(uuid, date, boolean, time, time, text, boolean),
  public.delete_special_hours(uuid),
  public.set_court_active(uuid, boolean, boolean),
  public.set_user_role(uuid, public.app_role),
  public.search_customers(text, int, int),
  public.admin_overview(date),
  public.admin_report(date, date, uuid, public.booking_status)
  to authenticated;

-- Server-only (Edge Functions with the service role key, and pg_cron).
grant execute on function
  public.record_gateway_payment(text, text, text, text, numeric, text, jsonb),
  public.claim_notifications(int),
  public.complete_notification(uuid, boolean, text, text, boolean),
  public.expire_stale_records(),
  public.enqueue_reminders()
  to service_role;
