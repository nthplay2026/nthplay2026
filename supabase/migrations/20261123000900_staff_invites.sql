-- =============================================================================
-- Invite staff by email (Admin > Staff & permissions).
-- * If the email already has an account, the role is given right away.
-- * Otherwise the invite is saved and an invitation email is sent; when that
--   person signs up with the same email, they get the role automatically.
--   (Sign-ups must confirm their email before they can log in, so only the
--   owner of the address can use the invite.)
-- * Admins see pending invites and can cancel them.
-- =============================================================================

create table if not exists public.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  email       extensions.citext not null unique,
  role        public.app_role not null check (role in ('staff', 'admin')),
  invited_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.staff_invites enable row level security;
revoke all on public.staff_invites from public, anon, authenticated;   -- only through the functions below

create or replace function public.admin_invite_staff(p_email text, p_role public.app_role)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := public.require_admin();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  uuid;
  s       public.facility_settings := public.settings();
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    perform public.app_error('INVALID_EMAIL', 'Enter a valid email address.');
  end if;
  if p_role not in ('staff', 'admin') then
    perform public.app_error('INVALID_REQUEST', 'Choose Staff or Admin.');
  end if;

  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is not null then
    perform public.set_user_role(v_user, p_role);
    delete from public.staff_invites where email = v_email;
    return jsonb_build_object('status', 'role_set');
  end if;

  insert into public.staff_invites (email, role, invited_by) values (v_email, p_role, v_uid)
  on conflict (email) do update set role = excluded.role, invited_by = excluded.invited_by, created_at = now();

  insert into public.notifications (recipient_email, notification_type, idempotency_key, payload)
  values (v_email, 'staff_invite', 'staff_invite:' || v_email || ':' || extract(epoch from now())::bigint,
          jsonb_build_object('role', p_role, 'facility_name', s.facility_name,
                             'invited_by', public.profile_display_name(v_uid), 'email', v_email))
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('status', 'invited');
end $$;

create or replace function public.admin_staff_invites()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role,
            'invited_by', public.profile_display_name(i.invited_by), 'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
            from public.staff_invites i);
end $$;

create or replace function public.admin_cancel_staff_invite(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  delete from public.staff_invites where id = p_id;
end $$;

revoke all on function public.admin_invite_staff(text, public.app_role), public.admin_staff_invites(),
  public.admin_cancel_staff_invite(uuid) from public, anon;
grant execute on function public.admin_invite_staff(text, public.app_role), public.admin_staff_invites(),
  public.admin_cancel_staff_invite(uuid) to authenticated;

-- New accounts: create the profile as before, then apply a pending invite for that email.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_invite public.staff_invites;
begin
  insert into public.profiles (id, email, full_name, mobile_number)
  values (
    new.id,
    new.email,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), ''),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'mobile_number', ''), 32), '')
  )
  on conflict (id) do nothing;

  select * into v_invite from public.staff_invites where email = lower(new.email);
  if found then
    perform set_config('app.role_change', 'on', true);
    update public.profiles set role = v_invite.role where id = new.id;
    perform set_config('app.role_change', '', true);
    delete from public.staff_invites where id = v_invite.id;
  end if;
  return new;
end $$;
