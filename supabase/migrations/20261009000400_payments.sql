-- =============================================================================
-- Migration 0400: payments
-- A payment row is never marked paid by the customer. Manual payments stay
-- 'pending' until an administrator reviews them; gateway payments are only
-- recorded by the server (service role) after webhook signature verification.
-- =============================================================================

-- Customer submits a manual payment (bank transfer / GCash) for review.
create or replace function public.submit_payment(
  p_booking uuid, p_method public.payment_method, p_reference text,
  p_amount numeric default null, p_proof_path text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_auth();
  b     public.bookings;
  v_amt numeric;
  v_due numeric;
  p     public.payments;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.customer_id is distinct from v_uid then
    perform public.app_error('NOT_FOUND', 'Booking not found.');
  end if;
  if b.booking_status not in ('pending', 'confirmed') then
    perform public.app_error('INVALID_STATUS', 'Payments can only be submitted for upcoming bookings.');
  end if;
  if p_method not in ('bank_transfer', 'gcash') or not public.payment_method_enabled(p_method) then
    perform public.app_error('PAYMENT_METHOD_UNAVAILABLE', 'That payment method cannot be submitted online.');
  end if;
  if p_reference is null or btrim(p_reference) !~ '^[A-Za-z0-9\-_ ]{4,64}$' then
    perform public.app_error('INVALID_REFERENCE', 'Enter the transaction reference number (4–64 letters or digits).');
  end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_uid::text then
    perform public.app_error('INVALID_REQUEST', 'Invalid proof-of-payment file.');
  end if;
  if exists (select 1 from public.payments where booking_id = p_booking and payment_status = 'pending') then
    perform public.app_error('PAYMENT_ALREADY_PENDING', 'A payment for this booking is already awaiting verification.');
  end if;

  v_due := b.total_amount - b.amount_paid;
  v_amt := coalesce(p_amount, v_due);
  if v_due <= 0 then
    perform public.app_error('INVALID_AMOUNT', 'This booking is already fully paid.');
  end if;
  if v_amt <= 0 or v_amt > v_due then
    perform public.app_error('INVALID_AMOUNT', format('Amount must be between 0.01 and %s.', v_due));
  end if;

  begin
    insert into public.payments (booking_id, amount, currency, payment_method, payment_status,
                                 transaction_reference, proof_of_payment_path, submitted_by)
    values (p_booking, round(v_amt, 2), b.currency, p_method, 'pending',
            btrim(p_reference), p_proof_path, v_uid)
    returning * into p;
  exception when unique_violation then
    perform public.app_error('DUPLICATE_REFERENCE', 'That transaction reference has already been submitted.');
  end;

  perform public.refresh_booking_payment(p_booking);
  return to_jsonb(p);
end $$;

-- Apply a verified payment to its booking (confirm pending; revive expired if still free).
create or replace function public.apply_verified_payment(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b      public.bookings;
  v_note text := null;
begin
  perform public.refresh_booking_payment(p_booking);
  select * into b from public.bookings where id = p_booking for update;

  if b.booking_status = 'pending' and b.amount_paid >= b.total_amount then
    update public.bookings set booking_status = 'confirmed', confirmed_at = now(), payment_due_at = null
     where id = p_booking;
  elsif b.booking_status = 'expired' and b.start_at > now() then
    -- Payment arrived after the booking expired: re-reserve if the slot is still free.
    begin
      perform public.acquire_lock(b.court_id, 'booking', b.id, b.start_at, b.end_at);
      update public.bookings
         set booking_status = case when b.amount_paid >= b.total_amount then 'confirmed' else 'pending' end::public.booking_status,
             confirmed_at = case when b.amount_paid >= b.total_amount then now() end,
             payment_due_at = case when b.amount_paid >= b.total_amount then null
                                   else least(now() + interval '24 hours', b.start_at) end
       where id = p_booking;
      v_note := 'revived';
    exception when others then
      v_note := 'needs_refund';   -- slot was taken meanwhile; staff must refund
    end;
  elsif b.booking_status in ('cancelled', 'expired') then
    v_note := 'needs_refund';
  end if;

  select * into b from public.bookings where id = p_booking;
  return public.booking_json(b) || jsonb_build_object('note', v_note);
end $$;

-- Administrator approves or rejects a pending manual payment. Idempotent.
create or replace function public.review_payment(p_payment uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  p     public.payments;
  v_res jsonb;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then
    perform public.app_error('NOT_FOUND', 'Payment not found.');
  end if;
  if p.payment_status <> 'pending' then
    if (p_approve and p.payment_status = 'paid') or (not p_approve and p.payment_status = 'failed') then
      return to_jsonb(p) || jsonb_build_object('idempotent_replay', true);
    end if;
    perform public.app_error('PAYMENT_ALREADY_REVIEWED', format('This payment is already %s.', p.payment_status));
  end if;
  if not p_approve and (p_note is null or char_length(btrim(p_note)) < 3) then
    perform public.app_error('REASON_REQUIRED', 'Please say why the payment was rejected.');
  end if;

  update public.payments
     set payment_status = case when p_approve then 'paid' else 'failed' end::public.payment_txn_status,
         verified_by = v_uid, verified_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_payment returning * into p;

  if p_approve then
    v_res := public.apply_verified_payment(p.booking_id);
  else
    perform public.refresh_booking_payment(p.booking_id);
  end if;
  return to_jsonb(p) || jsonb_build_object('booking', v_res);
end $$;

-- Staff records cash received at the desk.
create or replace function public.record_cash_payment(p_booking uuid, p_amount numeric default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  b     public.bookings;
  v_amt numeric;
  p     public.payments;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    perform public.app_error('NOT_FOUND', 'Booking not found.');
  end if;
  if b.booking_status in ('cancelled', 'expired') then
    perform public.app_error('INVALID_STATUS', 'Cannot take payment for a cancelled or expired booking.');
  end if;
  v_amt := coalesce(p_amount, b.total_amount - b.amount_paid);
  if v_amt <= 0 or v_amt > b.total_amount - b.amount_paid then
    perform public.app_error('INVALID_AMOUNT', format('Amount must be between 0.01 and %s.', b.total_amount - b.amount_paid));
  end if;
  insert into public.payments (booking_id, amount, currency, payment_method, payment_status,
                               submitted_by, verified_by, verified_at, review_note)
  values (p_booking, round(v_amt, 2), b.currency, 'cash', 'paid', v_uid, v_uid, now(),
          nullif(btrim(coalesce(p_note, '')), ''))
  returning * into p;
  return to_jsonb(p) || jsonb_build_object('booking', public.apply_verified_payment(p_booking));
end $$;

-- Administrator records a (full or partial) refund against a paid payment.
create or replace function public.refund_payment(p_payment uuid, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  p     public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then
    perform public.app_error('NOT_FOUND', 'Payment not found.');
  end if;
  if p.payment_status not in ('paid', 'refunded') then
    perform public.app_error('INVALID_STATUS', 'Only paid payments can be refunded.');
  end if;
  if p_amount is null or p_amount <= 0 or p.refunded_amount + p_amount > p.amount then
    perform public.app_error('INVALID_AMOUNT', format('Refund must be between 0.01 and %s.', p.amount - p.refunded_amount));
  end if;
  if p_note is null or char_length(btrim(p_note)) < 3 then
    perform public.app_error('REASON_REQUIRED', 'Please add a refund note.');
  end if;
  update public.payments
     set refunded_amount = refunded_amount + round(p_amount, 2),
         payment_status = case when refunded_amount + round(p_amount, 2) >= amount then 'refunded' else 'paid' end::public.payment_txn_status,
         review_note = left(coalesce(review_note || ' | ', '') || 'Refund: ' || btrim(p_note), 500)
   where id = p_payment returning * into p;
  perform public.refresh_booking_payment(p.booking_id);
  return to_jsonb(p);
end $$;

-- Gateway webhook entry point (service role only, after signature verification
-- in the Edge Function). Duplicate or replayed events are no-ops.
create or replace function public.record_gateway_payment(
  p_provider text, p_event_id text, p_event_type text, p_booking_reference text,
  p_amount numeric, p_provider_payment_id text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event uuid;
  b       public.bookings;
  p       public.payments;
begin
  insert into public.payment_events (provider, event_id, event_type, payload)
  values (p_provider, p_event_id, p_event_type, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing
  returning id into v_event;
  if v_event is null then
    return jsonb_build_object('duplicate', true);
  end if;

  if p_event_type <> 'payment.paid' then
    update public.payment_events set processed_at = now() where id = v_event;
    return jsonb_build_object('ignored', true);
  end if;

  select * into b from public.bookings where booking_reference = p_booking_reference for update;
  if not found then
    perform public.app_error('NOT_FOUND', 'Unknown booking reference in payment event.');
  end if;
  if p_amount is null or p_amount <= 0 then
    perform public.app_error('INVALID_AMOUNT', 'Payment event has an invalid amount.');
  end if;

  insert into public.payments (booking_id, amount, currency, payment_method, payment_status,
                               provider, provider_payment_id, verified_at)
  values (b.id, round(p_amount, 2), b.currency, 'gateway', 'paid', p_provider, p_provider_payment_id, now())
  on conflict (provider, provider_payment_id) do nothing
  returning * into p;

  update public.payment_events set processed_at = now() where id = v_event;
  if p.id is null then
    return jsonb_build_object('duplicate', true, 'reason', 'payment already recorded');
  end if;
  return jsonb_build_object('payment', to_jsonb(p), 'booking', public.apply_verified_payment(b.id));
end $$;
