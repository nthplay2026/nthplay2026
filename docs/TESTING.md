# Testing

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| Database | `npm run test:db` | PostgreSQL 15+ and `psql` | Builds a fresh DB from the migrations; booking rules, pricing, holds, payments, statuses, RLS, admin operations, and real concurrent sessions racing for slots |
| Integration | `npm run test:integration` | Postgres + the local stack (below) | Edge Functions (email worker, payment webhook) and Realtime over real HTTP/WebSocket with real Supabase Auth and PostgREST |
| Unit | `npm test` | Node | Time-zone maths incl. DST, validation schemas, error mapping, money formatting |
| Browser (E2E) | `npm run test:e2e` | the local stack or a Supabase project | Guest browsing, sign-up, full booking, cancellation, two-browser real-time sync, simultaneous reserve clicks, admin flows, mobile layout |

### Local stack for integration / E2E tests (no Docker needed)

`scripts/e2e/stack.sh` builds a database with the **real Supabase Auth (GoTrue) schema** plus our migrations, then starts the real **PostgREST** and **Supabase Auth** servers and a gateway on `:54321` that serves `/rest/v1`, `/auth/v1`, `/functions/v1` and `/realtime/v1`. The Realtime endpoint is a small Phoenix-protocol server (`scripts/e2e/gateway.mjs`) fed by PostgreSQL logical replication, applying the same visibility rules as the RLS policies. It speaks the same wire format as Supabase Realtime but is not Supabase's server — run the E2E suite against a real Supabase project (`supabase start`, or set `E2E_SUPABASE_URL`/`E2E_SUPABASE_ANON_KEY`) before launch as well. Binaries: PostgREST and Supabase Auth from their GitHub releases, in `$TOOLS` (default `/home/claude/tools`).

## Results (October 9, 2026)

Environment: PostgreSQL 16.15, PostgREST 12.2.3, Supabase Auth v2.180.0, Node 22.22.

| Suite | Result |
|---|---|
| Database | **151 / 151 passed** — 4 consecutive clean runs (incl. the 24-session race tests) |
| Edge Functions | **19 / 19 passed** — 4 fresh stacks + 2 re-runs on the same database |
| Realtime integration | **14 / 14 passed** — first change reached the second client 12 ms after the request |
| Unit (time zones, schemas, errors, money) | **27 / 27 passed** (run with Node's test runner via esbuild because Vitest could not be installed — see below) |
| Frontend compile check | All 60+ source files bundle with esbuild with **0 errors**; TypeScript strict check (with stand-in declarations for the uninstallable packages) **0 errors** in project code |
| Production build (`vite build`), `vitest`, ESLint, Playwright E2E | **Not yet run.** This sandbox's network policy blocked `registry.npmjs.org`, so Vite, supabase-js, React Router, React Hook Form and Lucide could not be installed. Run `npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e` once on a machine with npm access. |

## Required tests → where they are

| # | Requirement | Tests |
|---|---|---|
| 1 | Customer can book an available court | DB T01a–h · E2E `booking.spec` "books an available court end-to-end" |
| 2 | Overlapping booking rejected | DB T02a (same slot), T02b (different start, overlapping), T02c (staff too) |
| 3 | Simultaneous requests can't conflict | DB T03a–f: 24 parallel sessions on one slot → 1 winner; overlapping different starts → 1 winner, 0 overlaps; concurrent double-submit → 1 booking; staff vs customers → 1 winner; global no-overlap invariant · Realtime R9 · E2E "simultaneous reserve clicks" |
| 4 | Different courts at the same time | DB T04 |
| 5 | Adjacent bookings with buffer rules | DB T05a (0 buffer allowed), T05b (15-min buffer blocks), T05c |
| 6 | Cancellation releases availability | DB T06a–g, deadline T06h–i, staff reason + audit T06j–l · Realtime R14 · E2E "cancels a booking" |
| 7 | Active holds block | DB T07a–c · Realtime R3/R5 |
| 8 | Expired holds stop blocking | DB T08a–h (incl. cleanup job, re-validation, one hold per customer) |
| 9 | No access to others' bookings | DB T09a–i · Realtime R11 |
| 10 | Can't change own role / payment status | DB T10a–j |
| 11 | Unauthenticated users can't do protected operations | DB T11a–g |
| 12 | Invalid hours / past dates rejected | DB T12a–o (hours, past, horizon, duration, interval, notice, malformed, holiday, terms, contact, method) |
| 13 | Totals calculated correctly | DB T13a–e (peak/off-peak split, weekend, outdoor, breakdown, extended hours) · unit money |
| 14 | Historical prices unchanged | DB T14a–b |
| 15 | Only admins verify payments | DB T15a–n (customer and staff refused; idempotent; reject needs reason; refunds) |
| 16 | Realtime reflected in clients | Realtime R1–R14 · E2E `realtime.spec` (two browsers) |
| 17 | Duplicate payment events | DB T17a–e · Functions W6–W8 (signature, replay, tamper, duplicates) |
| 18 | Invalid / expired sessions | DB T18a–d · unit `errors.test` (expired JWT → sign-out flow) |

Additional: pay-first mode and automatic expiry (T20), blocks (T21), court deactivation / hours changes with acknowledgement and settings validation (T22), status transitions (T23), reports from real data (T24), unique references (T25), staff detail edits audited (T26), email worker guarantees (N1–N10).

## Manual QA checklist (before launch)

- [ ] Book on a phone and a laptop at the same time; watch each other's calendar update
- [ ] Hold a slot, wait for the hold to expire, confirm the slot reappears for others
- [ ] Pay-first mode: book, submit a GCash reference, verify as admin, see the customer page update
- [ ] Change hours over an existing booking — confirm the warning appears and nothing changes until you accept
- [ ] Keyboard-only: book a court using Tab / Enter / Space only
- [ ] Screen reader spot-check: slot buttons announce court, time, status and price
- [ ] Password reset email arrives and the link works on the production domain
