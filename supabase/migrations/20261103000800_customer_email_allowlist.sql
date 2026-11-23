-- =============================================================================
-- Customers get: booking confirmed, payment verified, payment rejected,
-- booking rescheduled and booking cancelled. "Booking received" and reminder
-- emails are no longer queued. Admin alerts (types starting with admin_) are
-- unaffected.
-- =============================================================================

create or replace function public.enqueue_notification(
  p_type text, p_key text, p_booking uuid, p_payment uuid, p_email text, p_recipient uuid,
  p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_email is null or btrim(p_email) = '' then
    return;   -- nobody to notify (e.g. walk-in without email)
  end if;
  if p_type not like 'admin\_%' and p_type not in ('booking_confirmed', 'payment_verified', 'payment_rejected', 'booking_rescheduled', 'booking_cancelled') then
    return;   -- no "booking received" or reminder emails for customers
  end if;
  insert into public.notifications (recipient_id, recipient_email, booking_id, payment_id,
                                    notification_type, idempotency_key, payload)
  values (p_recipient, p_email, p_booking, p_payment, p_type, p_key,
          coalesce(public.notification_payload(p_booking), '{}'::jsonb) || coalesce(p_extra, '{}'::jsonb))
  on conflict (idempotency_key) do nothing;
end $$;

-- Anything of those types still waiting in the queue is skipped.
update public.notifications
   set delivery_status = 'skipped', last_error = 'Skipped: this email type is turned off for customers'
 where delivery_status in ('queued', 'failed')
   and notification_type not like 'admin\_%'
   and notification_type not in ('booking_confirmed', 'payment_verified', 'payment_rejected', 'booking_rescheduled', 'booking_cancelled');
