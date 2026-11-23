# Architecture

```
Browser (React SPA)                     Supabase
───────────────────                     ─────────────────────────────────────────────────────
 pages / hooks ──supabase-js──▶  PostgREST ─▶ SECURITY DEFINER functions ─▶ tables (RLS)
     ▲                                                     │
     └──── Realtime (postgres_changes) ◀── publication ◀───┘  slot_locks · bookings · payments · courts
                                         pg_cron ─▶ expire_stale_records() · enqueue_reminders()
                                         Edge Fn send-notifications ─▶ Resend
                                         Edge Fn payment-webhook ◀── payment provider
```

## Data model

| Table | Purpose |
|---|---|
| `profiles` | one per auth user: name, email, mobile, role (`customer`/`staff`/`admin`) |
| `facility_settings` | single row: name, contact, time zone, currency, every booking rule, payment methods |
| `courts` | name, type, photo, standard rate, active flag, allowed durations, per-court notice/horizon |
| `court_pricing` | rate windows (label, court or all, weekdays, time range, validity dates, priority) |
| `operating_hours` / `special_hours` | weekly hours (facility or per court) / date overrides (holidays) |
| `bookings` | the reservation: reference, court, UTC start/end, statuses, **price snapshot + breakdown**, contact |
| `booking_holds` | checkout holds with expiry and the quoted price |
| `blocked_slots` | maintenance / private events |
| `slot_locks` | **one row per thing occupying court time**; carries the exclusion constraint; the public Realtime feed (no personal data) |
| `payments` / `payment_events` | payment records (amount, method, reference, proof, verifier, refunds) / raw gateway events for idempotency |
| `notifications` | email outbox with idempotency keys and delivery status |
| `audit_logs` | append-only change history written by triggers |

Money is `numeric(10,2)`; timestamps are `timestamptz` (UTC); IDs are UUIDs; booking references are unique (`PB-YYYYMMDD-NNNN`, per-day counter, facility-local date).

## Conflict prevention

1. `slot_locks` has `EXCLUDE USING gist (court_id WITH =, lock_range WITH &&) WHERE (active)`. `lock_range` is `[start, end + buffer)`, so the buffer rule is enforced by the same constraint.
2. `create_hold` validates the request, then inserts a lock. If another active lock overlaps, Postgres raises `exclusion_violation`, translated to `SLOT_TAKEN`.
3. `confirm_booking` locks the hold row (`FOR UPDATE`), re-validates every rule, inserts the booking and **converts the hold's lock in place** — no gap for anyone else. If the hold had expired and the lock was swept, it tries to acquire a fresh lock; the constraint arbitrates (`HOLD_EXPIRED_SLOT_TAKEN` if someone else got there first). The whole function is one transaction.
4. Expired holds are ignored by availability checks immediately (`expires_at > now()`), swept lazily inside booking transactions, and cleaned every minute by `pg_cron`.
5. Clients have no `INSERT/UPDATE/DELETE` on `bookings`, `slot_locks`, `payments` or `booking_holds`; only the functions write them.

Which states block time: **active hold (unexpired), pending booking, confirmed booking, block**. Cancelled, expired, completed and no-show bookings release their lock (completed/no-show are in the past anyway).

## Booking status

| From → To | Who | How |
|---|---|---|
| *(new)* → `confirmed` | customer (confirm-immediately mode), staff | `confirm_booking`, `admin_create_booking` |
| *(new)* → `pending` | customer (pay-first mode), staff | same |
| `pending` → `confirmed` | admin verifying full payment, gateway webhook, staff | `review_payment`, `record_gateway_payment`, `set_booking_status` |
| `pending` → `expired` | system, after `payment_due_at` with no payment under review | `expire_stale_records` (cron) |
| `expired` → `confirmed`/`pending` | system, when a late payment arrives **and** the slot is still free (else flagged for refund) | `apply_verified_payment` |
| `pending`/`confirmed` → `cancelled` | customer before the cancellation deadline; staff any time **with a reason** | `cancel_booking` |
| `confirmed` → `completed`/`no_show` | staff, once the session has started; system marks `completed` 12 h after the end | `set_booking_status`, cron |
| `completed` ↔ `no_show` | staff (correction) | `set_booking_status` |

Rescheduling (`reschedule_booking`) keeps the status, moves the lock atomically, re-prices, and is limited by the reschedule deadline for customers.

## Payment status (separate from booking status)

`unpaid → pending` (submission awaiting review) `→ paid / partially_paid / failed`, and `paid → partially_refunded / refunded`. The booking's `payment_status` and `amount_paid` are **derived** from its payment rows by `refresh_booking_payment` — never set directly. Only admins verify (`review_payment`), reject (reason required) and refund (note required); staff can record cash; gateway payments are recorded only by the service role after signature verification. Submitted references are unique per method (duplicate submissions rejected).

## Pricing

`compute_price` walks the session in 15-minute steps; each step takes the highest-priority active rule matching the court (court-specific beats all-courts), weekday, time and validity dates, else the court's standard rate. The quote (total + breakdown) is stored on the hold and honoured at confirmation if the hold is still valid; the booking stores `hourly_rate_snapshot`, `total_amount` and `price_breakdown`, so later price changes never alter it.

## Time zones

The facility time zone (default `Asia/Manila`) is a setting. The database does all rule checks in it (`court_hours`, `local_date_of`, …). The frontend formats every time with `Intl` in the facility zone (`src/lib/time.ts`), so a customer abroad still sees court-local times. DST-aware conversion is unit-tested.

## Security model

- RLS is enabled on **every** table. Clients get column-level grants only where needed (e.g. customers can update `profiles.full_name` and `mobile_number`, nothing else).
- Public (anon) can read active courts, active pricing, hours, public settings columns and `slot_locks` — enough to browse availability, nothing personal.
- Customers read only their own bookings, holds and payments (RLS); staff read all; payment events, notifications and audit logs are admin-only.
- Every function checks identity itself (`require_auth/require_staff/require_admin`) and ownership; function `EXECUTE` is revoked from `public` and granted per role. Server-only functions (gateway, email worker, cron) are granted to `service_role` only.
- Roles change only through `set_user_role` (admin-only, can't remove the last admin); a trigger blocks role changes from client sessions; sign-up metadata can't set a role.
- Abuse protection: max 20 holds per user per 10 minutes; one active hold per customer (new hold releases the old one, so holds can't be extended indefinitely); Supabase Auth rate limits for sign-in/sign-up.
- Proof-of-payment files live in a private bucket under `<user id>/…`; owners and staff read them via short-lived signed URLs.
- The service-role key, Resend key and webhook secret exist only as Edge Function secrets.

## Realtime

The booking calendar subscribes to `slot_locks` changes filtered to the selected facility-local date (`local_date=eq.YYYY-MM-DD`). Any change triggers a debounced re-fetch of `get_availability` (the server stays the source of truth); out-of-order responses are discarded. If the socket drops, the page polls every 10 s until it reconnects, then re-fetches once more; it also re-fetches on tab focus, network recovery and exactly when the next visible hold expires. A selected slot that someone else takes is cleared with an explanation, and slots that flip are highlighted and announced to screen readers. Staff views also subscribe to `bookings`/`payments` (RLS-filtered: customers only ever receive their own rows).

## Edge cases (spec §16)

| Case | Handling |
|---|---|
| Simultaneous / overlapping requests | exclusion constraint; tested with 24 parallel sessions (same start and different overlapping starts) |
| Double submit | `confirm_booking` is idempotent per hold (returns the same booking); button disabled while pending |
| Hold expires during checkout | re-validated on confirm; succeeds if still free, else `HOLD_EXPIRED_SLOT_TAKEN` and nothing is written |
| Payment after hold/booking expiry | revives the booking if the slot is still free, otherwise flagged `needs_refund` |
| Cancelled booking | lock released immediately; slot reappears live |
| Court deactivated with bookings | admin must review/acknowledge the list; bookings kept; no new bookings |
| Admin blocks booked time | refused with the conflicting bookings listed (resolve explicitly first); active holds yield to the block |
| Hours / holiday change over bookings | nothing saved until the admin acknowledges; bookings are kept and the decision is audited |
| Midnight crossing | off by default; when enabled, both days' hours are checked |
| DST | facility-zone wall-clock conversion handles gaps/overlaps (unit-tested) |
| Duplicate / delayed webhooks | `payment_events` unique (provider, event id) + unique (provider, provider payment id) |
| Invalid / malformed input | validated in SQL (coded errors) and in the UI (Zod) |
| Network / DB failures | coded errors with retry actions; realtime falls back to polling |
| Email failure | recorded as failed with error; retried with backoff; never shown as sent |
| Expired / invalid session | PostgREST rejects the JWT; the app signs out and returns to login with a message |
