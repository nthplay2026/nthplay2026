-- =============================================================================
-- Nth Play — Pickleball Court Booking
-- Migration 0100: extensions, types, tables, constraints, indexes
--
-- Conflict prevention model
-- -------------------------
-- Every thing that occupies court time (an active checkout hold, a pending or
-- confirmed booking, an admin block) owns exactly one row in `slot_locks`.
-- `slot_locks` carries a PostgreSQL EXCLUSION constraint:
--
--     EXCLUDE USING gist (court_id WITH =, lock_range WITH &&) WHERE (active)
--
-- so the database itself refuses two active, overlapping locks on one court,
-- no matter how many requests race. Holds are converted to bookings by
-- updating the SAME lock row, so there is never a gap another request could
-- slip into. `slot_locks` holds no personal data and is the public Realtime
-- feed that drives every connected calendar.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------- enums ----
create type public.app_role as enum ('customer', 'staff', 'admin');
create type public.court_type as enum ('indoor', 'outdoor');
create type public.booking_status as enum
  ('pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired');
create type public.payment_status as enum
  ('unpaid', 'pending', 'partially_paid', 'paid', 'failed', 'refunded', 'partially_refunded');
create type public.payment_txn_status as enum ('pending', 'paid', 'failed', 'refunded');
create type public.payment_method as enum ('cash', 'bank_transfer', 'gcash', 'gateway');
create type public.hold_status as enum ('active', 'converted', 'released', 'expired');
create type public.lock_kind as enum ('hold', 'booking', 'block');
create type public.notification_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');

-- ------------------------------------------------------------- profiles ----
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text check (char_length(full_name) <= 120),
  email         extensions.citext,
  mobile_number text check (char_length(mobile_number) <= 32),
  role          public.app_role not null default 'customer',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role);
create index profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------- facility settings ----
-- Single row (id = 1). Validated by trigger in migration 0200.
create table public.facility_settings (
  id                          smallint primary key default 1 check (id = 1),
  facility_name               text not null default 'Nth Play',
  tagline                     text not null default 'Your Court. Your Time. Your Game.',
  description                 text not null default '',
  timezone                    text not null default 'Asia/Manila',
  currency                    char(3) not null default 'PHP',
  slot_minutes                int  not null default 60,   -- grid row length
  booking_interval_minutes    int  not null default 60,   -- allowed start-time step
  min_duration_minutes        int  not null default 60,
  max_duration_minutes        int  not null default 180,
  buffer_minutes              int  not null default 0,    -- gap enforced after each booking
  min_advance_minutes         int  not null default 60,
  max_advance_days            int  not null default 30,
  same_day_cutoff             time,                       -- null = no cutoff
  cancellation_deadline_hours int  not null default 24,
  reschedule_deadline_hours   int  not null default 24,
  hold_minutes                int  not null default 10,
  booking_confirmation_mode   text not null default 'auto'
                              check (booking_confirmation_mode in ('auto', 'after_payment')),
  payment_due_hours           int  not null default 24,
  allow_cross_midnight        boolean not null default false,
  reminder_hours_before       int  not null default 24,
  contact_email               text not null default '',
  contact_phone               text not null default '',
  address                     text not null default '',
  map_url                     text not null default '',
  amenities                   text[] not null default '{}',
  admin_alert_email           text not null default '',   -- private (not exposed to the public)
  payment_methods             jsonb not null default '[
     {"method":"cash","enabled":true,"label":"Cash at the facility","instructions":"Pay at the front desk before your session."},
     {"method":"bank_transfer","enabled":false,"label":"Bank transfer","instructions":""},
     {"method":"gcash","enabled":false,"label":"GCash","instructions":""},
     {"method":"gateway","enabled":false,"label":"Online payment","instructions":""}
  ]'::jsonb,
  updated_at                  timestamptz not null default now()
);

-- --------------------------------------------------------------- courts ----
create table public.courts (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 80),
  description         text not null default '' check (char_length(description) <= 2000),
  court_type          public.court_type not null default 'outdoor',
  image_url           text check (image_url is null or image_url ~ '^https?://'),
  base_hourly_rate    numeric(10,2) not null check (base_hourly_rate >= 0),
  is_active           boolean not null default true,
  allowed_durations   int[] check (allowed_durations is null or
                                   (cardinality(allowed_durations) > 0
                                    and 0 < all (allowed_durations))),
  min_advance_minutes int check (min_advance_minutes is null or min_advance_minutes >= 0),
  max_advance_days    int check (max_advance_days is null or max_advance_days between 0 and 365),
  sort_order          int not null default 0,
  features            text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index courts_name_uq on public.courts (lower(name));

-- -------------------------------------------------------- court pricing ----
-- Time-window rate overrides (peak / off-peak). Anything not covered by a rule
-- uses courts.base_hourly_rate. court_id NULL = applies to every court.
create table public.court_pricing (
  id             uuid primary key default gen_random_uuid(),
  court_id       uuid references public.courts (id) on delete cascade,
  label          text not null default 'Peak' check (char_length(label) between 1 and 40),
  days_of_week   smallint[] check (days_of_week is null or days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  start_time     time not null,
  end_time       time not null,
  rate           numeric(10,2) not null check (rate >= 0),
  currency       char(3) not null default 'PHP',
  effective_from date,
  effective_to   date,
  priority       int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_time > start_time),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index court_pricing_court_idx on public.court_pricing (court_id) where is_active;

-- ------------------------------------------------------ operating hours ----
-- Weekly schedule. court_id NULL = facility default; a court row overrides it.
create table public.operating_hours (
  id           uuid primary key default gen_random_uuid(),
  court_id     uuid references public.courts (id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),  -- 0 = Sunday
  opening_time time,
  closing_time time,          -- '24:00' allowed (closes at midnight)
  is_closed    boolean not null default false,
  updated_at   timestamptz not null default now(),
  check (is_closed or (opening_time is not null and closing_time is not null and closing_time > opening_time)),
  unique nulls not distinct (court_id, day_of_week)
);

-- Date-specific overrides: holidays, special events, reduced hours.
create table public.special_hours (
  id           uuid primary key default gen_random_uuid(),
  court_id     uuid references public.courts (id) on delete cascade,
  date         date not null,
  is_closed    boolean not null default true,
  opening_time time,
  closing_time time,
  reason       text not null default '' check (char_length(reason) <= 200),
  created_at   timestamptz not null default now(),
  check (is_closed or (opening_time is not null and closing_time is not null and closing_time > opening_time)),
  unique nulls not distinct (court_id, date)
);

-- ---------------------------------------------------- reference counter ----
create table public.booking_ref_counters (
  day  date primary key,
  last int not null
);

-- ------------------------------------------------------------- bookings ----
create table public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  booking_reference    text not null unique,
  customer_id          uuid references public.profiles (id) on delete set null,
  court_id             uuid not null references public.courts (id) on delete restrict,
  start_at             timestamptz not null,
  end_at               timestamptz not null,
  duration_minutes     int not null check (duration_minutes > 0),
  booking_status       public.booking_status not null,
  payment_status       public.payment_status not null default 'unpaid',
  hourly_rate_snapshot numeric(10,2) not null check (hourly_rate_snapshot >= 0),
  total_amount         numeric(10,2) not null check (total_amount >= 0),
  amount_paid          numeric(10,2) not null default 0,
  currency             char(3) not null,
  price_breakdown      jsonb not null default '[]'::jsonb,
  customer_name        text not null check (char_length(customer_name) between 2 and 120),
  customer_email       extensions.citext,
  customer_phone       text check (char_length(customer_phone) <= 32),
  players              smallint check (players is null or players between 1 and 8),
  notes                text check (char_length(notes) <= 500),
  payment_method       public.payment_method,
  payment_due_at       timestamptz,
  source               text not null default 'online' check (source in ('online', 'admin')),
  created_by           uuid references public.profiles (id) on delete set null,
  confirmed_at         timestamptz,
  cancellation_reason  text check (char_length(cancellation_reason) <= 500),
  cancelled_at         timestamptz,
  cancelled_by         uuid references public.profiles (id) on delete set null,
  rescheduled_count    int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (end_at > start_at)
);
create index bookings_customer_idx on public.bookings (customer_id, start_at desc);
create index bookings_court_time_idx on public.bookings (court_id, start_at);
create index bookings_start_idx on public.bookings (start_at);
create index bookings_status_idx on public.bookings (booking_status, start_at);
create index bookings_pending_due_idx on public.bookings (payment_due_at) where booking_status = 'pending';

-- -------------------------------------------------------- booking holds ----
create table public.booking_holds (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles (id) on delete cascade,
  court_id     uuid not null references public.courts (id) on delete cascade,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  expires_at   timestamptz not null,
  status       public.hold_status not null default 'active',
  quote        jsonb not null,                   -- price honoured while the hold is valid
  booking_id   uuid references public.bookings (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (end_at > start_at)
);
create index booking_holds_customer_idx on public.booking_holds (customer_id, created_at desc);
create index booking_holds_active_idx on public.booking_holds (expires_at) where status = 'active';

-- --------------------------------------------------------- blocked slots ---
create table public.blocked_slots (
  id         uuid primary key default gen_random_uuid(),
  court_id   uuid not null references public.courts (id) on delete cascade,
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  reason     text not null default 'Maintenance' check (char_length(reason) between 1 and 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index blocked_slots_court_time_idx on public.blocked_slots (court_id, start_at);

-- ----------------------------------------------------------- slot locks ----
create table public.slot_locks (
  id          uuid primary key default gen_random_uuid(),
  court_id    uuid not null references public.courts (id) on delete cascade,
  kind        public.lock_kind not null,
  ref_id      uuid not null,                    -- hold / booking / blocked slot id
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  lock_range  tstzrange not null,               -- [start_at, end_at + buffer)
  local_date  date not null,                    -- facility-local date of start_at (Realtime filter)
  expires_at  timestamptz,                      -- holds only
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_at > start_at),
  check ((kind = 'hold') = (expires_at is not null)),
  constraint slot_locks_no_overlap
    exclude using gist (court_id with =, lock_range with &&) where (active)
);
create unique index slot_locks_ref_active_uq on public.slot_locks (ref_id) where active;
create index slot_locks_date_idx on public.slot_locks (local_date, court_id) where active;
create index slot_locks_expiry_idx on public.slot_locks (expires_at) where active and kind = 'hold';
alter table public.slot_locks replica identity full;

-- ------------------------------------------------------------- payments ----
create table public.payments (
  id                     uuid primary key default gen_random_uuid(),
  booking_id             uuid not null references public.bookings (id) on delete restrict,
  amount                 numeric(10,2) not null check (amount > 0),
  refunded_amount        numeric(10,2) not null default 0 check (refunded_amount >= 0),
  currency               char(3) not null,
  payment_method         public.payment_method not null,
  payment_status         public.payment_txn_status not null default 'pending',
  transaction_reference  text check (char_length(transaction_reference) <= 64),
  proof_of_payment_path  text check (char_length(proof_of_payment_path) <= 300),
  provider               text,
  provider_payment_id    text,
  submitted_by           uuid references public.profiles (id) on delete set null,
  verified_by            uuid references public.profiles (id) on delete set null,
  verified_at            timestamptz,
  review_note            text check (char_length(review_note) <= 500),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (refunded_amount <= amount),
  unique (provider, provider_payment_id)
);
create index payments_booking_idx on public.payments (booking_id);
create index payments_status_idx on public.payments (payment_status, created_at);
create unique index payments_reference_uq on public.payments (payment_method, lower(transaction_reference))
  where transaction_reference is not null and payment_status <> 'failed';

-- Raw gateway events for idempotent webhook processing.
create table public.payment_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  event_type   text not null,
  payload      jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- -------------------------------------------------------- notifications ----
create table public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  recipient_id        uuid references public.profiles (id) on delete set null,
  recipient_email     text,
  booking_id          uuid references public.bookings (id) on delete cascade,
  payment_id          uuid references public.payments (id) on delete cascade,
  notification_type   text not null,
  idempotency_key     text not null unique,
  payload             jsonb not null default '{}'::jsonb,
  delivery_status     public.notification_status not null default 'queued',
  attempts            int not null default 0,
  last_error          text,
  provider_message_id text,
  next_attempt_at     timestamptz not null default now(),
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index notifications_queue_idx on public.notifications (next_attempt_at)
  where delivery_status in ('queued', 'failed', 'sending');

-- ----------------------------------------------------------- audit logs ----
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ------------------------------------------------------- default config ----
insert into public.facility_settings (id) values (1);

-- Facility default hours: 06:00–22:00 every day (editable in Admin → Operating Hours).
insert into public.operating_hours (court_id, day_of_week, opening_time, closing_time)
select null, d, '06:00', '22:00' from generate_series(0, 6) d;
