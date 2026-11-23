#!/usr/bin/env bash
# Build the end-to-end database the way a Supabase project looks:
# real Supabase Auth (GoTrue) schema + Supabase default grants + our migrations.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${TOOLS:-/home/claude/tools}"
DB="${E2E_DB:-nthplay_e2e}"
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-54322}" PGUSER="${PGUSER:-postgres}"
export PGOPTIONS="-c client_min_messages=warning"
P=(psql -X -q -v ON_ERROR_STOP=1)

"${P[@]}" -d postgres <<SQL >/dev/null
drop database if exists $DB with (force);
create database $DB;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login superuser; end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
alter role supabase_auth_admin set search_path = auth;
SQL

"${P[@]}" -d "$DB" -c "create schema auth authorization supabase_auth_admin" >/dev/null
( cd "$TOOLS/gotrue" && GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://supabase_auth_admin@$PGHOST:$PGPORT/$DB?sslmode=disable" \
  GOTRUE_JWT_SECRET=unused API_EXTERNAL_URL=http://localhost GOTRUE_SITE_URL=http://localhost \
  GOTRUE_DB_MIGRATIONS_PATH="$TOOLS/gotrue/migrations" ./auth migrate >/dev/null 2>&1 )

# Supabase platform defaults (what a new project already has).
"${P[@]}" -d "$DB" <<'SQL' >/dev/null
create schema if not exists extensions;
grant usage on schema public, extensions, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL

for f in "$ROOT"/supabase/migrations/*.sql; do
  "${P[@]}" -1 -d "$DB" -f "$f" >/dev/null
done
"${P[@]}" -d "$DB" -f "$ROOT/supabase/tests/05_fixture_seed.sql" >/dev/null
echo "e2e database $DB ready"
