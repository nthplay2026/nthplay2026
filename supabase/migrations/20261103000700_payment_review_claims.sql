-- =============================================================================
-- Payment verification by several admins.
-- * Every admin gets the "payment submitted" alert (one per receipt, even when a
--   receipt covers several time blocks).
-- * An admin "claims" a payment while checking it; others see who is on it.
-- * A payment can only be verified once; a late second attempt says who did it.
-- =============================================================================

alter table public.payments
  add column if not exists reviewing_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewing_at timestamptz;

create or replace function public.profile_display_name(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(full_name), ''), email, 'Another admin') from public.profiles where id = p_id
$$;

-- Starts checking a payment. Fails (without raising) when someone else is on it
-- or it has already been reviewed, naming that admin.
create or replace function public.start_payment_review(p_payment uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  p     public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then
    perform public.app_error('NOT_FOUND', 'Payment not found.');
  end if;
  if p.payment_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_REVIEWED', 'message',
      format('%s already %s this payment.', coalesce(public.profile_display_name(p.verified_by), 'Another admin'),
             case when p.payment_status = 'paid' then 'verified' else 'reviewed' end));
  end if;
  if p.reviewing_by is not null and p.reviewing_by <> v_uid and p.reviewing_at > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'code', 'IN_REVIEW', 'message',
      format('%s is already verifying this payment.', public.profile_display_name(p.reviewing_by)));
  end if;
  update public.payments set reviewing_by = v_uid, reviewing_at = now() where id = p_payment;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.release_payment_review(p_payment uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_admin();
begin
  update public.payments set reviewing_by = null, reviewing_at = null
   where id = p_payment and reviewing_by = v_uid;
end $$;

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
    if p.verified_by is distinct from v_uid then
      perform public.app_error('PAYMENT_ALREADY_REVIEWED',
        format('%s already %s this payment.', coalesce(public.profile_display_name(p.verified_by), 'Another admin'),
               case when p.payment_status = 'paid' then 'verified' else 'reviewed' end));
    end if;
    if (p_approve and p.payment_status = 'paid') or (not p_approve and p.payment_status = 'failed') then
      return to_jsonb(p) || jsonb_build_object('idempotent_replay', true);
    end if;
    perform public.app_error('PAYMENT_ALREADY_REVIEWED', format('This payment is already %s.', p.payment_status));
  end if;
  if p.reviewing_by is not null and p.reviewing_by <> v_uid and p.reviewing_at > now() - interval '10 minutes' then
    perform public.app_error('IN_REVIEW', format('%s is already verifying this payment.', public.profile_display_name(p.reviewing_by)));
  end if;
  if not p_approve and (p_note is null or char_length(btrim(p_note)) < 3) then
    perform public.app_error('REASON_REQUIRED', 'Please say why the payment was rejected.');
  end if;

  update public.payments
     set payment_status = case when p_approve then 'paid' else 'failed' end::public.payment_txn_status,
         verified_by = v_uid, verified_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewing_by = null, reviewing_at = null
   where id = p_payment returning * into p;

  if p_approve then
    v_res := public.apply_verified_payment(p.booking_id);
  else
    perform public.refresh_booking_payment(p.booking_id);
  end if;
  return to_jsonb(p) || jsonb_build_object('booking', v_res);
end $$;

-- Payment alerts go to every administrator (plus the optional alert address),
-- once per receipt.
create or replace function public.payment_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b       public.bookings;
  v_admin text := (select nullif(admin_alert_email, '') from public.facility_settings where id = 1);
  v_key   text;
  r       record;
begin
  select * into b from public.bookings where id = new.booking_id;
  if tg_op = 'INSERT' and new.payment_status = 'pending' then
    v_key := 'payment_submitted:' || coalesce(new.proof_of_payment_path, new.id::text);
    for r in
      select lower(e) as email, min(id::text)::uuid as id from (
        select email as e, id from public.profiles where role = 'admin' and email is not null
        union all select v_admin, null::uuid where v_admin is not null
      ) x group by lower(e)
    loop
      perform public.enqueue_notification('admin_payment_submitted', v_key || ':' || r.email,
        b.id, new.id, r.email, r.id,
        jsonb_build_object('payment_amount', new.amount, 'payment_method', new.payment_method,
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

revoke all on function public.profile_display_name(uuid) from public, anon;
revoke all on function public.start_payment_review(uuid) from public, anon;
revoke all on function public.release_payment_review(uuid) from public, anon;
grant execute on function public.profile_display_name(uuid), public.start_payment_review(uuid), public.release_payment_review(uuid) to authenticated;
