-- =============================================================================
-- The admin "payment to verify" alert shows the whole receipt amount, even though
-- a receipt covering several time blocks is saved as one payment row per block.
-- =============================================================================

create or replace function public.enqueue_notification(
  p_type text, p_key text, p_booking uuid, p_payment uuid, p_email text, p_recipient uuid,
  p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_group text;
  v_key   text := p_key;
  v_extra jsonb := coalesce(p_extra, '{}'::jsonb);
  v_proof text;
begin
  if p_email is null or btrim(p_email) = '' then
    return;   -- nobody to notify (e.g. walk-in without email)
  end if;
  if p_type not like 'admin\_%' and p_type not in ('booking_confirmed', 'payment_verified', 'payment_rejected', 'booking_rescheduled', 'booking_cancelled') then
    return;   -- no "booking received" or reminder emails for customers
  end if;

  -- Blocks booked together: one email for the whole booking.
  select group_ref into v_group from public.bookings where id = p_booking;
  if v_group is not null and p_type in ('booking_confirmed', 'payment_verified', 'payment_rejected') then
    v_key := p_type || ':group:' || v_group || ':' || lower(btrim(p_email));
    if p_payment is not null then
      select proof_of_payment_path into v_proof from public.payments where id = p_payment;
      if v_proof is not null then
        v_extra := v_extra || jsonb_build_object('payment_amount', (
          select sum(p.amount) from public.payments p join public.bookings g on g.id = p.booking_id
           where g.group_ref = v_group and p.proof_of_payment_path = v_proof));
      end if;
    end if;
  end if;

  insert into public.notifications (recipient_id, recipient_email, booking_id, payment_id,
                                    notification_type, idempotency_key, payload)
  values (p_recipient, p_email, p_booking, p_payment, p_type, v_key,
          coalesce(public.notification_payload(p_booking), '{}'::jsonb) || v_extra)
  on conflict (idempotency_key) do update set payload = excluded.payload
    -- an admin alert not sent yet is refreshed (e.g. as more blocks of one receipt are saved)
    where notifications.delivery_status = 'queued' and notifications.notification_type = 'admin_payment_submitted';
end $$;

create or replace function public.payment_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b       public.bookings;
  v_admin text := (select nullif(admin_alert_email, '') from public.facility_settings where id = 1);
  v_key   text;
  v_amount numeric;
  r       record;
begin
  select * into b from public.bookings where id = new.booking_id;
  if tg_op = 'INSERT' and new.payment_status = 'pending' then
    v_key := 'payment_submitted:' || coalesce(new.proof_of_payment_path, new.id::text);
    -- One receipt covering several time blocks is saved as one payment row per block:
    -- the alert shows the whole receipt.
    v_amount := case when new.proof_of_payment_path is null then new.amount else
      (select sum(amount) from public.payments where proof_of_payment_path = new.proof_of_payment_path and payment_status = 'pending') end;
    for r in
      select lower(e) as email, min(id::text)::uuid as id from (
        select email as e, id from public.profiles where role = 'admin' and email is not null
        union all select v_admin, null::uuid where v_admin is not null
      ) x group by lower(e)
    loop
      perform public.enqueue_notification('admin_payment_submitted', v_key || ':' || r.email,
        b.id, new.id, r.email, r.id,
        jsonb_build_object('payment_amount', v_amount, 'payment_method', new.payment_method,
                           'transaction_reference', new.transaction_reference));
    end loop;
  elsif tg_op = 'UPDATE' and new.payment_status is distinct from old.payment_status then
    if new.payment_status = 'paid' then
      perform public.enqueue_notification('payment_verified', 'payment_verified:' || new.id,
        b.id, new.id, b.customer_email, b.customer_id, jsonb_build_object('payment_amount', new.amount));
    elsif new.payment_status = 'failed' then
      perform public.enqueue_notification('payment_rejected', 'payment_rejected:' || new.id,
        b.id, new.id, b.customer_email, b.customer_id,
        jsonb_build_object('payment_amount', new.amount, 'review_note', new.review_note));
    end if;
  end if;
  return new;
end $$;
