-- =============================================================================
-- In-app notifications (the bell) + phone push subscriptions.
-- Every email-worthy event for a signed-in user (customer or admin) also becomes
-- a short in-app notification; the email worker later pushes unsent ones to the
-- user's installed apps.
-- =============================================================================

create table if not exists public.user_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null,
  link        text,
  booking_id  uuid references public.bookings (id) on delete set null,
  dedupe_key  text unique,
  read_at     timestamptz,
  pushed_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists user_notifications_user_idx on public.user_notifications (user_id, created_at desc);
create index if not exists user_notifications_push_idx on public.user_notifications (created_at) where pushed_at is null;
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public, anon, authenticated;
grant select on public.user_notifications to authenticated;
drop policy if exists user_notifications_own on public.user_notifications;
create policy user_notifications_own on public.user_notifications for select to authenticated using (user_id = auth.uid());

-- Phones/browsers that asked for push notifications.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

-- Public VAPID key the browser needs to subscribe (the private key is a function secret).
alter table public.facility_settings add column if not exists push_public_key text;
grant select (push_public_key) on public.facility_settings to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'user_notifications') then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;

-- Short title/body/link for each notification type.
create or replace function public.add_user_notification(p_user uuid, p_type text, p_key text, p_booking uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref    text := coalesce(p_payload ->> 'booking_reference', '');
  v_amount text := '₱' || to_char(coalesce((p_payload ->> 'payment_amount')::numeric, (p_payload ->> 'total_amount')::numeric, 0), 'FM999,999,990.00');
  v_when   text := coalesce(p_payload ->> 'start_local', '');
  v_title  text;
  v_body   text;
  v_link   text := '/my-bookings/' || v_ref;
begin
  if p_user is null then return; end if;
  case p_type
    when 'admin_payment_submitted' then
      v_title := 'Payment to verify';
      v_body  := format('%s uploaded a receipt for %s · %s', coalesce(p_payload ->> 'customer_name', 'A customer'), v_amount, v_ref);
      v_link  := '/admin/bookings?ref=' || v_ref;
    when 'booking_confirmed' then
      v_title := 'Booking confirmed';
      v_body  := format('Your booking %s is confirmed. See you on the court!', v_ref);
    when 'payment_verified' then
      v_title := 'Payment verified';
      v_body  := format('We received your payment of %s for %s.', v_amount, v_ref);
    when 'payment_rejected' then
      v_title := 'Payment not verified';
      v_body  := format('We couldn''t verify your payment for %s.%s', v_ref,
                        coalesce(' ' || nullif(p_payload ->> 'review_note', ''), ''));
    when 'booking_rescheduled' then
      v_title := 'Booking rescheduled';
      v_body  := format('Your booking %s moved to %s.', v_ref, v_when);
    when 'booking_cancelled' then
      v_title := 'Booking cancelled';
      v_body  := format('Your booking %s (%s) was cancelled.%s', v_ref, v_when,
                        coalesce(' Reason: ' || nullif(p_payload ->> 'cancellation_reason', ''), ''));
    else
      return;   -- other types are email-only (or switched off)
  end case;

  insert into public.user_notifications (user_id, kind, title, body, link, booking_id, dedupe_key)
  values (p_user, p_type, v_title, v_body, v_link, p_booking, 'app:' || p_key)
  on conflict (dedupe_key) do update set title = excluded.title, body = excluded.body
    where user_notifications.read_at is null and user_notifications.pushed_at is null;
end $$;
revoke all on function public.add_user_notification(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Email outbox + in-app notification in one place.
create or replace function public.enqueue_notification(
  p_type text, p_key text, p_booking uuid, p_payment uuid, p_email text, p_recipient uuid,
  p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_group   text;
  v_key     text := p_key;
  v_extra   jsonb := coalesce(p_extra, '{}'::jsonb);
  v_proof   text;
  v_payload jsonb;
begin
  if p_type not like 'admin\_%' and p_type not in ('booking_confirmed', 'payment_verified', 'payment_rejected', 'booking_rescheduled', 'booking_cancelled') then
    return;   -- no "booking received" or reminder notifications for customers
  end if;

  -- Blocks booked together: one notification for the whole booking.
  select group_ref into v_group from public.bookings where id = p_booking;
  if v_group is not null and p_type in ('booking_confirmed', 'payment_verified', 'payment_rejected') then
    v_key := p_type || ':group:' || v_group || ':' || lower(btrim(coalesce(p_email, p_recipient::text, '')));
    if p_payment is not null then
      select proof_of_payment_path into v_proof from public.payments where id = p_payment;
      if v_proof is not null then
        v_extra := v_extra || jsonb_build_object('payment_amount', (
          select sum(p.amount) from public.payments p join public.bookings g on g.id = p.booking_id
           where g.group_ref = v_group and p.proof_of_payment_path = v_proof));
      end if;
    end if;
  end if;
  v_payload := coalesce(public.notification_payload(p_booking), '{}'::jsonb) || v_extra;

  perform public.add_user_notification(p_recipient, p_type, v_key, p_booking, v_payload);

  if p_email is null or btrim(p_email) = '' then
    return;   -- nobody to email (e.g. walk-in without email)
  end if;
  insert into public.notifications (recipient_id, recipient_email, booking_id, payment_id,
                                    notification_type, idempotency_key, payload)
  values (p_recipient, p_email, p_booking, p_payment, p_type, v_key, v_payload)
  on conflict (idempotency_key) do update set payload = excluded.payload
    -- an admin alert not sent yet is refreshed (e.g. as more blocks of one receipt are saved)
    where notifications.delivery_status = 'queued' and notifications.notification_type = 'admin_payment_submitted';
end $$;

-- Customer actions on their own notifications / devices.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_auth();
begin
  update public.user_notifications set read_at = now()
   where user_id = v_uid and read_at is null and (p_ids is null or id = any (p_ids));
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_auth();
begin
  if p_endpoint !~ '^https://' then perform public.app_error('INVALID_REQUEST', 'Invalid push endpoint.'); end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_auth();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid;
end $$;

-- For the worker (service role): notifications still to push, with their devices.
create or replace function public.claim_pushes(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  with picked as (
    select n.* from public.user_notifications n
     where n.pushed_at is null and n.created_at > now() - interval '1 day'
     order by n.created_at limit p_limit for update skip locked
  ), marked as (
    update public.user_notifications u set pushed_at = now() from picked where u.id = picked.id returning u.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'body', m.body, 'link', m.link,
           'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                              from public.push_subscriptions s where s.user_id = m.user_id))), '[]'::jsonb)
    into v_out from marked m;
  return v_out;
end $$;

create or replace function public.drop_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.push_subscriptions where endpoint = p_endpoint
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.claim_pushes(int) from public, anon, authenticated;
revoke all on function public.drop_push_subscription(text) from public, anon, authenticated;
grant execute on function public.mark_notifications_read(uuid[]), public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text) to authenticated;
grant execute on function public.claim_pushes(int), public.drop_push_subscription(text) to service_role;
