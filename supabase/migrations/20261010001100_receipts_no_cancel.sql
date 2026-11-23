-- =============================================================================
-- Migration 1100
-- 1. Customers pay by GCash and upload a photo of the receipt: a payment may be
--    submitted with a receipt image instead of a typed reference number.
-- 2. No cancellations by customers — only rescheduling. Staff can still cancel
--    (e.g. weather or maintenance), with a reason that is audited.
-- =============================================================================

create or replace function public.submit_payment(
  p_booking uuid, p_method public.payment_method, p_reference text,
  p_amount numeric default null, p_proof_path text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_auth();
  b     public.bookings;
  v_amt numeric;
  v_due numeric;
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
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
  if v_ref is null and p_proof_path is null then
    perform public.app_error('PROOF_REQUIRED', 'Please upload a photo of your GCash receipt.');
  end if;
  if v_ref is not null and v_ref !~ '^[A-Za-z0-9\-_ ]{4,64}$' then
    perform public.app_error('INVALID_REFERENCE', 'Enter the transaction reference number (4–64 letters or digits).');
  end if;
  if p_proof_path is not null and (split_part(p_proof_path, '/', 1) <> v_uid::text or char_length(p_proof_path) > 300) then
    perform public.app_error('INVALID_REQUEST', 'Invalid receipt file.');
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
    values (p_booking, round(v_amt, 2), b.currency, p_method, 'pending', v_ref, p_proof_path, v_uid)
    returning * into p;
  exception when unique_violation then
    perform public.app_error('DUPLICATE_REFERENCE', 'That transaction reference has already been submitted.');
  end;

  perform public.refresh_booking_payment(p_booking);
  return to_jsonb(p);
end $$;

create or replace function public.cancel_booking(p_booking uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := public.require_auth();
  v_staff boolean := public.is_staff();
  s       public.facility_settings := public.settings();
  b       public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or (b.customer_id is distinct from v_uid and not v_staff) then
    perform public.app_error('NOT_FOUND', 'Booking not found.');
  end if;
  if not v_staff then
    perform public.app_error('NO_CANCELLATION',
      format('Bookings can''t be cancelled. You can reschedule online up to %s hours before your start time.', s.reschedule_deadline_hours));
  end if;
  if b.booking_status not in ('pending', 'confirmed') then
    perform public.app_error('INVALID_STATUS', format('A %s booking cannot be cancelled.', replace(b.booking_status::text, '_', '-')));
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    perform public.app_error('REASON_REQUIRED', 'Please enter a cancellation reason for the audit log.');
  end if;

  update public.bookings
     set booking_status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
         cancellation_reason = left(btrim(p_reason), 500)
   where id = p_booking
  returning * into b;
  perform public.release_lock(p_booking);
  return public.booking_json(b);
end $$;

-- Receipt photos: allow common phone formats (incl. HEIC from iPhones) up to 10 MB.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    update storage.buckets
       set file_size_limit = 10485760,
           allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
     where id = 'payment-proofs';
  end if;
end $$;
