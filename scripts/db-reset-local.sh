#!/usr/bin/env bash
# Rebuild a throwaway PostgreSQL database from the Supabase migrations.
# Used by the SQL test-suite and the local end-to-end harness.
# Usage: scripts/db-reset-local.sh [dbname]   (env: PGHOST, PGPORT, PGUSER)
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${1:-nthplay_test}"
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-54322}" PGUSER="${PGUSER:-postgres}"
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
PSQL1=(psql -X -q -1 -v ON_ERROR_STOP=1 -d "$DB")

psql -X -q -d postgres -c "drop database if exists $DB with (force)" >/dev/null
psql -X -q -d postgres -c "create database $DB" >/dev/null
# Roles are cluster-wide: create them once, ignore "already exists".
psql -X -q -d postgres -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end \$\$; grant anon, authenticated, service_role to authenticator; grant anon, authenticated, service_role to current_user;" >/dev/null

# Shim minus the role creation (already done above).
sed -e '/^create role /d' -e '/^grant anon, authenticated, service_role to current_user;/d' \
  supabase/tests/00_supabase_shim.sql | "${PSQL[@]}" >/dev/null

for f in supabase/migrations/*.sql; do
  out=$("${PSQL1[@]}" -f "$f" 2>&1) || { echo "FAILED: $f"; echo "$out" | grep -E 'ERROR|LINE' | head -5; exit 1; }
done
"${PSQL[@]}" -f supabase/tests/05_fixture_seed.sql >/dev/null
echo "database $DB ready"
