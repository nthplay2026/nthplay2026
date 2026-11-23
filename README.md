# Nth Play — real-time pickleball court booking

A production-ready booking platform for a small pickleball facility (that can grow to more courts or locations). Customers see live availability, reserve a court and pay; staff run the day from a live schedule; admins control courts, prices, hours, rules, payments and reports — all without touching code.

**Stack:** React 19 + TypeScript + Vite · Tailwind CSS 4 · React Router 7 · React Hook Form + Zod · Lucide · Supabase (Postgres, Auth, Realtime, Storage, Edge Functions).

## How double bookings are made impossible

Every thing that occupies court time — a checkout hold, a pending or confirmed booking, a maintenance block — owns one row in `slot_locks`, protected by a PostgreSQL **exclusion constraint**:

```sql
EXCLUDE USING gist (court_id WITH =, lock_range WITH &&) WHERE (active)
```

The database itself refuses two overlapping active locks on one court, no matter how many requests race. All writes go through `SECURITY DEFINER` functions that re-validate court, hours, rules, price and ownership on the server; the browser can't write booking tables at all. A hold becomes a booking by converting the **same** lock row, so nobody can slip in between. Realtime only tells browsers *when* to refetch — it is never trusted for correctness. Tested with 24 simultaneous sessions racing for one slot: exactly one wins, every time.

## Project structure

```
nthplay/
├── src/
│   ├── pages/                  Customer pages (Home, Book, Court, Checkout, Confirmation,
│   │   │                       My Bookings, Booking details, Auth, Account, Contact, Terms, Privacy)
│   │   └── admin/              Admin dashboard (Overview, Live schedule, Bookings, Calendar,
│   │                           Payments, Customers, Courts, Pricing & rules, Hours, Blocks,
│   │                           Reports, Staff, Settings)
│   ├── components/
│   │   ├── ui/                 Accessible primitives (button, form fields, dialog, toast, …)
│   │   ├── booking/            Slot grid, date strip, summaries, reschedule dialog, …
│   │   ├── admin/              Booking panel, new-booking dialog, conflict review
│   │   └── layout/             Site header/footer, route guards
│   ├── hooks/                  Auth, facility settings, live availability (Realtime), data loading
│   └── lib/                    API layer, time-zone helpers, formatting, validation schemas (+ unit tests)
├── supabase/
│   ├── migrations/             Schema, constraints, functions, RLS, Realtime/Storage/cron wiring
│   ├── functions/              Edge Functions: send-notifications (Resend), payment-webhook
│   ├── tests/                  Database test-suite (SQL + concurrency script)
│   ├── seed.sql                Facility data (1 court, open 24/7, day/night rates)
│   ├── updates/                One-time update scripts for an existing database
│   └── config.toml             Supabase CLI config
├── e2e/                        Playwright browser tests (booking, real-time sync, admin, mobile)
├── scripts/                    DB test runner; local Supabase-compatible stack for E2E
├── docs/                       Setup, deployment, architecture, testing, troubleshooting
└── .env.example
```

## Quick start (local)

Requires Node 20.19+, the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker.

```bash
npm install
supabase start                       # local Postgres/Auth/Realtime/Storage; applies migrations + seed
cp .env.example .env                 # paste the API URL and anon key printed by `supabase start`
npm run dev                          # http://localhost:5173
```

Create your account in the app, then make yourself an administrator (see [docs/SETUP.md](docs/SETUP.md#5-create-the-first-administrator)).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server / production build / preview |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm test` | Unit tests (Vitest): time zones incl. DST, validation, error mapping |
| `npm run test:db` | Database suite: builds a fresh DB from the migrations; 151 checks incl. RLS and race tests |
| `npm run test:e2e` | Playwright browser tests (booking flow, two-browser real-time sync, admin, mobile) |

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — create and configure the Supabase project, first admin, email, cron, payments
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel / Netlify, production checklist
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data model, booking/payment status rules, security model, edge cases
- [docs/TESTING.md](docs/TESTING.md) — how to run every suite, and the actual results
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Feature status

**Working and tested against a real database:** live availability; holds with expiry; atomic booking with database-level conflict prevention; booking rules (hours, durations, intervals, buffers, notice, horizon, same-day cutoff, holidays, maintenance blocks); peak/off-peak pricing with price snapshots; cancellation and rescheduling with deadlines; manual payments (cash, GCash, bank transfer) with admin-only verification and refunds; pay-first mode with automatic expiry; staff bookings, status changes and audit trail; conflict review before admin changes; dashboard metrics and reports from real data; Row Level Security on every table; the email outbox and gateway-webhook functions.

**Needs your credentials / configuration** (documented, not simulated):

| Feature | What's needed |
|---|---|
| Sending emails (confirmations, reminders, alerts) | A [Resend](https://resend.com) API key + verified sender domain; schedule the worker ([SETUP §7](docs/SETUP.md#7-email-notifications)). Until then, emails queue safely and are visible in Admin → Settings → Email log. |
| Online card / e-wallet checkout | A payment provider (e.g. PayMongo, Xendit, Stripe). The webhook endpoint, signature checking and idempotent recording are built; the provider's checkout and payload mapping must be added ([SETUP §8](docs/SETUP.md#8-payments)). |
| Production auth emails (sign-up confirmation, password reset) | Custom SMTP in Supabase Auth settings (Supabase's built-in sender is rate-limited). |
