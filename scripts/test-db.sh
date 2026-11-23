#!/usr/bin/env bash
# Database test-suite: builds a fresh database from the migrations and runs
# every test in supabase/tests. Requires PostgreSQL 15+ (psql on PATH).
#   PGHOST=localhost PGPORT=54322 PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-nthplay_test}"
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-54322}" PGUSER="${PGUSER:-postgres}"
export PGOPTIONS="-c client_min_messages=warning"

scripts/db-reset-local.sh "$DB" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/10_helpers.sql >/dev/null

for f in supabase/tests/2*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "test file crashed: $f"; exit 1; }
done
for f in supabase/tests/3*.sh; do bash "$f" "$DB"; done

psql -X -q -t -A -d "$DB" -F ' | ' -c "select case when ok then 'PASS' else 'FAIL' end, name, coalesce(case when not ok then detail end, '') from tests.results order by id"
read -r total failed < <(psql -X -q -t -A -F ' ' -d "$DB" -c "select count(*), count(*) filter (where not ok) from tests.results")
echo "----"
echo "$total checks, $failed failed"
[ "$failed" -eq 0 ]
