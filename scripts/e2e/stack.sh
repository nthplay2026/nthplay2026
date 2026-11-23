#!/usr/bin/env bash
# (Re)start the local Supabase-compatible stack used for end-to-end tests:
#   Postgres (must already run on :54322) -> fresh DB from migrations
#   PostgREST :3000, Supabase Auth :9999, gateway (+Realtime, Functions) :54321
# Binaries are expected in $TOOLS (see docs/TESTING.md for download links).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="${TOOLS:-/home/claude/tools}"
LOGS="${LOGS:-/home/claude/e2elogs}"
DB="${E2E_DB:-nthplay_e2e}"
mkdir -p "$LOGS"

pkill -f "postgrest" 2>/dev/null || true
pkill -f "auth serve" 2>/dev/null || true
pkill -f "gateway.mjs" 2>/dev/null || true
pkill -f "pg_recvlogical" 2>/dev/null || true
sleep 0.5

"$HERE/db.sh"
node "$HERE/keys.mjs" >/dev/null
SECRET=$(node -p "require('$HERE/.keys.json').jwtSecret")

PGRST_DB_URI="postgres://authenticator@localhost:54322/$DB" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_PORT=3000 PGRST_DB_MAX_ROWS=1000 \
  nohup "$TOOLS/postgrest" >"$LOGS/postgrest.log" 2>&1 &

( cd "$TOOLS/gotrue" && GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin@localhost:54322/$DB?sslmode=disable" \
  GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP="${JWT_EXP:-3600}" GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_SITE_URL="${SITE_URL:-http://localhost:5173}" \
  GOTRUE_URI_ALLOW_LIST="${SITE_URL:-http://localhost:5173}/**" GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
  GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_DISABLE_SIGNUP=false \
  GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_DB_MIGRATIONS_PATH="$TOOLS/gotrue/migrations" \
  GOTRUE_SMTP_HOST="${SMTP_HOST:-127.0.0.1}" GOTRUE_SMTP_PORT="${SMTP_PORT:-2525}" GOTRUE_SMTP_ADMIN_EMAIL=noreply@nthplay.local \
  GOTRUE_SMTP_USER=x GOTRUE_SMTP_PASS=x GOTRUE_SMTP_SENDER_NAME=Nth Play \
  nohup ./auth serve >"$LOGS/gotrue.log" 2>&1 & )

QUIET=1 nohup node "$HERE/gateway.mjs" >"$LOGS/gateway.log" 2>&1 &

for i in $(seq 1 40); do
  if curl -sf localhost:54321/health >/dev/null && curl -sf localhost:3000/ >/dev/null && curl -sf localhost:9999/health >/dev/null; then
    echo "stack ready: http://localhost:54321"; exit 0
  fi
  sleep 0.25
done
echo "stack failed to start; see $LOGS"; exit 1
