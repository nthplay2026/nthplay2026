-- Test helpers (installed into the throwaway test database only).
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create table tests.results (id serial, name text, ok boolean, detail text);
grant all on tests.results to anon, authenticated, service_role;
grant usage on sequence tests.results_id_seq to anon, authenticated, service_role;

create function tests.create_user(p_email text, p_role public.app_role default 'customer', p_name text default 'Test User')
returns uuid language plpgsql security definer as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v, p_email, jsonb_build_object('full_name', p_name, 'role', 'admin')); -- metadata role must be ignored
  update public.profiles set role = p_role where id = v;
  return v;
end $$;

-- Impersonate a user (or anon when p_user is null) the way PostgREST does.
create function tests.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '{"role":"anon"}'
         else jsonb_build_object('sub', p_user, 'role', 'authenticated')::text end, false)
$$;
create function tests.login_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false)
$$;

create function tests.ok(p_name text, p_cond boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into tests.results (name, ok, detail) values (p_name, coalesce(p_cond, false), p_detail);
end $$;

-- Run SQL, expect it to fail with the given HINT code (or SQLSTATE when it starts with a digit).
create function tests.throws(p_name text, p_sql text, p_expect text)
returns void language plpgsql as $$
declare v_hint text; v_state text; v_msg text;
begin
  begin
    execute p_sql;
    perform tests.ok(p_name, false, 'expected ' || p_expect || ' but statement succeeded');
    return;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate, v_msg = message_text;
  end;
  perform tests.ok(p_name, coalesce(v_hint, '') = p_expect or v_state = p_expect,
                   format('got hint=%s state=%s msg=%s', v_hint, v_state, v_msg));
end $$;

-- Facility-local timestamp for (date, 'HH:MI').
create function tests.at(p_date date, p_time text) returns timestamptz language sql stable security definer as $$
  select (p_date + p_time::time) at time zone public.facility_tz()
$$;

-- Next date (>= today + p_min_days) falling on the given weekday (0 = Sunday).
create function tests.next_dow(p_dow int, p_min_days int default 2) returns date language sql stable security definer as $$
  select d::date from generate_series(public.local_today() + p_min_days, public.local_today() + p_min_days + 6, interval '1 day') d
   where extract(dow from d)::int = p_dow limit 1
$$;

-- Key/value scratch space shared between test steps (and roles).
create table tests.state (k text primary key, v text);
grant all on tests.state to anon, authenticated, service_role;
create function tests.put(p_k text, p_v text) returns void language sql as $$
  insert into tests.state values (p_k, p_v) on conflict (k) do update set v = excluded.v
$$;
create function tests.get(p_k text) returns text language sql stable as $$ select v from tests.state where k = p_k $$;
create function tests.uget(p_k text) returns uuid language sql stable as $$ select v::uuid from tests.state where k = p_k $$;

create function tests.at(p_date text, p_time text) returns timestamptz language sql stable security definer as $$ select tests.at(p_date::date, p_time) $$;
create function tests.today() returns date language sql stable security definer as $$ select public.local_today() $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Fixed fixtures
create table tests.fx (k text primary key, v uuid);
grant select on tests.fx to anon, authenticated, service_role;
insert into tests.fx values
  ('court1', '11111111-1111-4111-8111-111111111111'),
  ('court2', '22222222-2222-4222-8222-222222222222'),
  ('court3', '33333333-3333-4333-8333-333333333333');
insert into tests.fx select 'alice', tests.create_user('alice@example.com', 'customer', 'Alice Cruz');
insert into tests.fx select 'bob', tests.create_user('bob@example.com', 'customer', 'Bob Reyes');
insert into tests.fx select 'carol', tests.create_user('carol@example.com', 'customer', 'Carol Tan');
insert into tests.fx select 'staff', tests.create_user('staff@example.com', 'staff', 'Sam Staff');
insert into tests.fx select 'admin', tests.create_user('admin@example.com', 'admin', 'Ada Admin');
create function tests.fx(p text) returns uuid language sql stable as $$ select v from tests.fx where k = p $$;
grant execute on function tests.fx(text) to anon, authenticated, service_role;
