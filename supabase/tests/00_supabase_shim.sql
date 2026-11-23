-- =============================================================================
-- Minimal stand-in for the parts of Supabase that the migrations depend on,
-- so the database test-suite runs on any plain PostgreSQL 15+ server.
-- (On a real Supabase project these objects already exist; do not apply this.)
--
-- auth.uid() / auth.role() read the same `request.jwt.claims` GUC that
-- PostgREST sets, so RLS behaves exactly as it does behind the Supabase API.
-- =============================================================================

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant anon, authenticated, service_role to current_user;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'role'
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default privileges (the security migration narrows them down).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
