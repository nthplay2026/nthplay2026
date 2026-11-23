-- =============================================================================
-- Booking, holds, pricing, rules, policies, payments and RLS tests.
-- Every block impersonates a user exactly as PostgREST would (JWT claims +
-- SET ROLE), so RLS and function grants are exercised for real.
-- Dates: a Tuesday ≥ 2 days out (weekday pricing) and a Saturday (weekend).
-- =============================================================================
\set ON_ERROR_STOP 1
select tests.put('tue', tests.next_dow(2)::text);
select tests.put('wed', tests.next_dow(3)::text);
select tests.put('sat', tests.next_dow(6)::text);

-- ------------------------------------------------- T01 / T13 / double submit
select tests.login(tests.fx('alice')); set role authenticated;
do $$
declare d date := tests.get('tue'); h jsonb; b jsonb; b2 jsonb;
begin
  h := public.create_hold(tests.fx('court1'), tests.at(d, '09:00'), 60);
  perform tests.ok('T01a hold returns quote of 500.00 (weekday off-peak)', (h ->> 'total')::numeric = 500, h::text);
  perform tests.ok('T01b hold expires after hold_minutes',
    (h ->> 'expires_at')::timestamptz between now() + interval '9 minutes' and now() + interval '11 minutes');
  b := public.confirm_booking((h ->> 'hold_id')::uuid, 'Alice Cruz', 'alice@example.com', '+63 917 000 0001', 4, 'Bring balls', 'cash', true);
  perform tests.ok('T01c customer can book an available court',
    b ->> 'booking_status' = 'confirmed' and b ->> 'booking_reference' ~ ('^PB-' || to_char(tests.today(), 'YYYYMMDD') || '-\d{4}$'), b::text);
  perform tests.ok('T01d booking persisted with price snapshot',
    (select total_amount = 500 and hourly_rate_snapshot = 500 and payment_status = 'unpaid'
       from public.bookings where id = (b ->> 'id')::uuid));
  -- Double submit of the same hold returns the same booking, never a second one.
  b2 := public.confirm_booking((h ->> 'hold_id')::uuid, 'Alice Cruz', 'alice@example.com', '+63 917 000 0001', 4, null, 'cash', true);
  perform tests.ok('T01e double submit is idempotent (same reference, no duplicate)',
    b2 ->> 'id' = b ->> 'id' and (b2 ->> 'idempotent_replay')::boolean
    and (select count(*) from public.bookings where customer_id = tests.fx('alice')) = 1);
  perform tests.put('alice_b1', b ->> 'id');
  perform tests.put('alice_ref1', b ->> 'booking_reference');
end $$;
reset role;

select tests.ok('T01f exactly one active lock exists for the booking',
  (select count(*) = 1 from public.slot_locks where ref_id = tests.uget('alice_b1') and active and kind = 'booking'));
select tests.ok('T01g confirmation notification queued once',
  (select count(*) = 1 from public.notifications where booking_id = tests.uget('alice_b1') and notification_type = 'booking_confirmed'));
select tests.ok('T01h admin alert queued for online booking',
  (select count(*) = 1 from public.notifications where booking_id = tests.uget('alice_b1') and notification_type = 'admin_new_booking'));

-- ------------------------------------------------------------- T02 / T04 ----
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T02a same slot on same court is rejected',
  format($q$select public.create_hold(%L, tests.at(%L, '09:00'), 60)$q$, tests.fx('court1'), tests.get('tue')), 'SLOT_TAKEN');
select tests.throws('T02b overlapping interval with a different start is rejected (08:00 for 2h)',
  format($q$select public.create_hold(%L, tests.at(%L, '08:00'), 120)$q$, tests.fx('court1'), tests.get('tue')), 'SLOT_TAKEN');
do $$
declare h jsonb;
begin
  h := public.create_hold(tests.fx('court2'), tests.at(tests.get('tue'), '09:00'), 60);
  perform tests.ok('T04 a different court can be booked at the same time', h ? 'hold_id');
  perform public.release_hold((h ->> 'hold_id')::uuid);
end $$;
reset role;
select tests.ok('T04b released hold frees its lock',
  (select count(*) = 0 from public.slot_locks where court_id = tests.fx('court2') and active));

select tests.login(tests.fx('staff')); set role authenticated;
select tests.throws('T02c staff/admin booking uses the same conflict check',
  format($q$select public.admin_create_booking(%L, tests.at(%L, '09:00'), 60, 'Walk In')$q$, tests.fx('court1'), tests.get('tue')), 'SLOT_TAKEN');
reset role;

-- --------------------------------------------------------------- T05 --------
select tests.login(tests.fx('carol')); set role authenticated;
do $$
declare h jsonb;
begin
  h := public.create_hold(tests.fx('court1'), tests.at(tests.get('tue'), '10:00'), 60);
  perform tests.ok('T05a adjacent booking (10:00 right after 09:00) is allowed with 0 buffer', h ? 'hold_id');
  perform public.release_hold((h ->> 'hold_id')::uuid);
end $$;
reset role;

update public.facility_settings set buffer_minutes = 15;
select tests.login(tests.fx('staff')); set role authenticated;
select tests.put('buf_b', (public.admin_create_booking(tests.fx('court3'), tests.at(tests.get('tue'), '12:00'), 60, 'Buffer Test')) ->> 'id');
reset role;
select tests.login(tests.fx('carol')); set role authenticated;
select tests.throws('T05b with a 15-min buffer the slot right after a booking is blocked',
  format($q$select public.create_hold(%L, tests.at(%L, '13:00'), 60)$q$, tests.fx('court3'), tests.get('tue')), 'SLOT_TAKEN');
do $$
declare h jsonb;
begin
  h := public.create_hold(tests.fx('court3'), tests.at(tests.get('tue'), '14:00'), 60);
  perform tests.ok('T05c the following free slot is still bookable with buffer', h ? 'hold_id');
  perform public.release_hold((h ->> 'hold_id')::uuid);
end $$;
reset role;
update public.facility_settings set buffer_minutes = 0;

-- --------------------------------------------------------------- T07 / T08 --
select tests.login(tests.fx('carol')); set role authenticated;
select tests.put('carol_h', (public.create_hold(tests.fx('court1'), tests.at(tests.get('tue'), '14:00'), 60)) ->> 'hold_id');
select tests.ok('T07c holder sees held_by_you',
  (select status = 'held_by_you' from public.get_availability(tests.get('tue')::date, tests.fx('court1'))
    where slot_start = tests.at(tests.get('tue'), '14:00')));
reset role;
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T07a an active hold blocks other customers',
  format($q$select public.create_hold(%L, tests.at(%L, '14:00'), 60)$q$, tests.fx('court1'), tests.get('tue')), 'SLOT_TAKEN');
select tests.ok('T07b others see the slot as held (with expiry)',
  (select status = 'held' and hold_expires_at is not null from public.get_availability(tests.get('tue')::date, tests.fx('court1'))
    where slot_start = tests.at(tests.get('tue'), '14:00')));
reset role;

-- Simulate the hold timing out.
update public.booking_holds set expires_at = now() - interval '1 second', created_at = now() - interval '11 minutes' where id = tests.uget('carol_h');
update public.slot_locks set expires_at = now() - interval '1 second' where ref_id = tests.uget('carol_h');

select tests.login(tests.fx('bob')); set role authenticated;
select tests.ok('T08a expired hold no longer shows as held',
  (select status = 'available' from public.get_availability(tests.get('tue')::date, tests.fx('court1'))
    where slot_start = tests.at(tests.get('tue'), '14:00')));
do $$
declare h jsonb;
begin
  h := public.create_hold(tests.fx('court1'), tests.at(tests.get('tue'), '14:00'), 60);
  perform tests.ok('T08b expired hold stops blocking: another customer can take the slot', h ? 'hold_id');
  perform tests.put('bob_h14', h ->> 'hold_id');
end $$;
reset role;
select tests.ok('T08c the expired hold was marked expired',
  (select status = 'expired' from public.booking_holds where id = tests.uget('carol_h')));

select tests.login(tests.fx('carol')); set role authenticated;
select tests.throws('T08d confirming an expired hold whose slot was taken fails cleanly',
  format($q$select public.confirm_booking(%L, 'Carol Tan', 'carol@example.com', '09170000003', null, null, 'cash', true)$q$,
         tests.get('carol_h')), 'HOLD_EXPIRED_SLOT_TAKEN');
reset role;
select tests.ok('T08e ...and created no booking', (select count(*) = 0 from public.bookings where customer_id = tests.fx('carol')));

-- An expired hold whose slot is still free can still be confirmed (re-validated + re-locked).
select tests.login(tests.fx('carol')); set role authenticated;
select tests.put('carol_h2', (public.create_hold(tests.fx('court2'), tests.at(tests.get('tue'), '15:00'), 60)) ->> 'hold_id');
reset role;
update public.booking_holds set expires_at = now() - interval '1 second' where id = tests.uget('carol_h2');
update public.slot_locks set expires_at = now() - interval '1 second' where ref_id = tests.uget('carol_h2');
select public.expire_stale_records();
select tests.ok('T08f cleanup job expires stale holds and frees their locks',
  (select status = 'expired' from public.booking_holds where id = tests.uget('carol_h2'))
  and (select count(*) = 0 from public.slot_locks where ref_id = tests.uget('carol_h2') and active));
select tests.login(tests.fx('carol')); set role authenticated;
do $$
declare b jsonb;
begin
  b := public.confirm_booking(tests.uget('carol_h2'), 'Carol Tan', 'carol@example.com', '09170000003', 2, null, 'cash', true);
  perform tests.ok('T08g expired-but-still-free hold is re-validated and booked', b ->> 'booking_status' = 'confirmed', b::text);
  perform tests.put('carol_b1', b ->> 'id');
end $$;
reset role;

-- Hold cannot be extended indefinitely: a new hold always replaces the old one.
select tests.login(tests.fx('bob')); set role authenticated;
do $$
declare h jsonb;
begin
  h := public.create_hold(tests.fx('court2'), tests.at(tests.get('tue'), '18:00'), 60);
  perform tests.ok('T08h one active hold per customer (previous hold released)',
    (select status = 'released' from public.booking_holds where id = tests.uget('bob_h14'))
    and (select count(*) = 1 from public.booking_holds where customer_id = tests.fx('bob') and status = 'active'));
  perform tests.put('bob_h18', h ->> 'hold_id');
end $$;
reset role;

-- ------------------------------------------------------------- T12 rules ----
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T12a before opening hours is rejected',
  format($q$select public.create_hold(%L, tests.at(%L, '05:00'), 60)$q$, tests.fx('court1'), tests.get('wed')), 'OUTSIDE_HOURS');
select tests.throws('T12b running past closing is rejected',
  format($q$select public.create_hold(%L, tests.at(%L, '21:00'), 120)$q$, tests.fx('court1'), tests.get('wed')), 'OUTSIDE_HOURS');
select tests.throws('T12c past date is rejected',
  format($q$select public.create_hold(%L, tests.at(tests.today() - 1, '10:00'), 60)$q$, tests.fx('court1')), 'PAST_TIME');
select tests.throws('T12d beyond the advance-booking horizon is rejected',
  format($q$select public.create_hold(%L, tests.at(tests.today() + 45, '10:00'), 60)$q$, tests.fx('court1')), 'TOO_FAR');
select tests.throws('T12e unsupported duration is rejected',
  format($q$select public.create_hold(%L, tests.at(%L, '10:00'), 45)$q$, tests.fx('court1'), tests.get('wed')), 'INVALID_DURATION');
select tests.throws('T12f off-interval start time is rejected',
  format($q$select public.create_hold(%L, tests.at(%L, '10:30'), 60)$q$, tests.fx('court1'), tests.get('wed')), 'INVALID_TIME');
-- Clock-independent: raise the notice to just under 24 h and use an in-hours start within the next 23 h.
reset role;
update public.facility_settings set min_advance_minutes = 1439;
select tests.put('t12g', (select t::text from generate_series(date_trunc('hour', now()) + interval '2 hours', now() + interval '23 hours', interval '1 hour') t
                           where extract(hour from t at time zone public.facility_tz()) between 7 and 20 limit 1));
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T12g bookings inside the minimum notice are rejected',
  format($q$select public.create_hold(%L, %L::timestamptz, 60)$q$, tests.fx('court1'), tests.get('t12g')), 'TOO_SOON');
reset role;
update public.facility_settings set min_advance_minutes = 60;
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T12h invalid court id is rejected',
  format($q$select public.create_hold(%L, tests.at(%L, '10:00'), 60)$q$, gen_random_uuid(), tests.get('wed')), 'COURT_NOT_FOUND');
select tests.throws('T12i malformed request (null start) is rejected',
  format($q$select public.create_hold(%L, null, 60)$q$, tests.fx('court1')), 'INVALID_REQUEST');
select tests.throws('T12j confirmation without accepting terms is rejected',
  format($q$select public.confirm_booking(%L, 'Bob Reyes', 'bob@example.com', '09170000002', null, null, 'cash', false)$q$, tests.get('bob_h18')), 'TERMS_REQUIRED');
select tests.throws('T12k invalid contact email is rejected',
  format($q$select public.confirm_booking(%L, 'Bob Reyes', 'not-an-email', '09170000002', null, null, 'cash', true)$q$, tests.get('bob_h18')), 'INVALID_CONTACT');
select tests.throws('T12l invalid mobile number is rejected',
  format($q$select public.confirm_booking(%L, 'Bob Reyes', 'bob@example.com', '12', null, null, 'cash', true)$q$, tests.get('bob_h18')), 'INVALID_CONTACT');
select tests.throws('T12m disabled payment method is rejected',
  format($q$select public.confirm_booking(%L, 'Bob Reyes', 'bob@example.com', '09170000002', null, null, 'gateway', true)$q$, tests.get('bob_h18')), 'PAYMENT_METHOD_UNAVAILABLE');
reset role;

-- Holiday closure and maintenance block.
select tests.login(tests.fx('admin')); set role authenticated;
select public.save_special_hours(null, tests.get('wed')::date + 7, true, null, null, 'Holiday');
reset role;
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T12n closed (holiday) dates are rejected',
  format($q$select public.create_hold(%L, tests.at(%L::date + 7, '10:00'), 60)$q$, tests.fx('court1'), tests.get('wed')), 'CLOSED');
select tests.ok('T12o availability shows the holiday as closed',
  (select bool_and(status = 'closed') from public.get_availability(tests.get('wed')::date + 7, null)));
reset role;

-- ---------------------------------------------------------- T13 pricing -----
select tests.login(tests.fx('bob')); set role authenticated;
select tests.ok('T13a 16:00–18:00 weekday spans off-peak + peak = 500 + 650',
  (public.get_quote(tests.fx('court1'), tests.at(tests.get('wed'), '16:00'), 120) ->> 'total')::numeric = 1150);
select tests.ok('T13b weekend rate applies all day (2h × 650)',
  (public.get_quote(tests.fx('court1'), tests.at(tests.get('sat'), '08:00'), 120) ->> 'total')::numeric = 1300);
select tests.ok('T13c outdoor court weekday off-peak (3h × 350)',
  (public.get_quote(tests.fx('court2'), tests.at(tests.get('wed'), '08:00'), 180) ->> 'total')::numeric = 1050);
select tests.ok('T13d quote breakdown lists both rate bands',
  jsonb_array_length(public.get_quote(tests.fx('court1'), tests.at(tests.get('wed'), '16:00'), 120) -> 'breakdown') = 2);
select tests.ok('T13e weekend extended hours (Sat 22:00) are bookable',
  (public.get_quote(tests.fx('court2'), tests.at(tests.get('sat'), '22:00'), 60) ->> 'total')::numeric = 450);
reset role;

-- ------------------------------------------------- T14 historical prices ----
update public.courts set base_hourly_rate = 999 where id = tests.fx('court1');
select tests.ok('T14a existing booking keeps its price snapshot after a price change',
  (select total_amount = 500 and hourly_rate_snapshot = 500 from public.bookings where id = tests.uget('alice_b1')));
select tests.login(tests.fx('bob')); set role authenticated;
select tests.ok('T14b new quotes use the new price',
  (public.get_quote(tests.fx('court1'), tests.at(tests.get('wed'), '09:00'), 60) ->> 'total')::numeric = 999);
reset role;
update public.courts set base_hourly_rate = 500 where id = tests.fx('court1');

-- -------------------------------------------- T09 / T10 / T11 isolation -----
select tests.login(tests.fx('bob')); set role authenticated;
select tests.ok('T09a customer cannot read another customer''s bookings',
  (select count(*) = 0 from public.bookings where customer_id = tests.fx('alice')));
select tests.ok('T09b customer cannot read another customer''s holds',
  (select count(*) = 0 from public.booking_holds where customer_id = tests.fx('carol')));
select tests.ok('T09c get_my_hold does not reveal another customer''s hold',
  public.get_my_hold(tests.uget('carol_h2')) is null);
select tests.throws('T09d customer cannot cancel another customer''s booking',
  format($q$select public.cancel_booking(%L)$q$, tests.get('alice_b1')), 'NOT_FOUND');
select tests.throws('T09e customer cannot reschedule another customer''s booking',
  format($q$select public.reschedule_booking(%L, tests.at(%L, '11:00'))$q$, tests.get('alice_b1'), tests.get('tue')), 'NOT_FOUND');
select tests.ok('T09f customer sees only their own profile',
  (select count(*) = 1 from public.profiles));
select tests.ok('T09g slot_locks feed exposes no personal data',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'slot_locks'
               and column_name in ('customer_id', 'customer_name', 'customer_email', 'customer_phone')));
select tests.ok('T09h customer cannot read audit logs', (select count(*) = 0 from public.audit_logs));
select tests.ok('T09i customer cannot read the notification outbox', (select count(*) = 0 from public.notifications));
select tests.throws('T10a customer cannot change their own role',
  format($q$update public.profiles set role = 'admin' where id = %L$q$, tests.fx('bob')), '42501');
select tests.throws('T10b customer cannot write booking payment status',
  format($q$update public.bookings set payment_status = 'paid' where customer_id = %L$q$, tests.fx('bob')), '42501');
select tests.throws('T10c customer cannot insert payment records directly',
  format($q$insert into public.payments (booking_id, amount, currency, payment_method, payment_status) values (%L, 1, 'PHP', 'cash', 'paid')$q$, tests.get('alice_b1')), '42501');
select tests.throws('T10d customer cannot insert bookings directly (bypassing conflict checks)',
  $q$insert into public.bookings (booking_reference, court_id, start_at, end_at, duration_minutes, booking_status, hourly_rate_snapshot, total_amount, currency, customer_name) values ('X', gen_random_uuid(), now(), now() + interval '1h', 60, 'confirmed', 0, 0, 'PHP', 'Hacker')$q$, '42501');
select tests.throws('T10e customer cannot write slot locks directly',
  $q$delete from public.slot_locks$q$, '42501');
select tests.throws('T10f customer cannot edit audit logs',
  $q$delete from public.audit_logs$q$, '42501');
-- RLS turns this into a 0-row update; verify the price is intact afterwards.
update public.courts set base_hourly_rate = 1 where id = tests.fx('court1');
reset role;
select tests.ok('T10g customer cannot change court prices (row unchanged)',
  (select base_hourly_rate = 500 from public.courts where id = tests.fx('court1')));
select tests.login(tests.fx('bob')); set role authenticated;
update public.profiles set full_name = 'Bob R. Reyes' where id = tests.fx('bob');
reset role;
select tests.ok('T10h customer can update their own name',
  (select full_name = 'Bob R. Reyes' from public.profiles where id = tests.fx('bob')));
select tests.ok('T10i signup metadata cannot grant a role (role stays customer)',
  (select role = 'customer' from public.profiles where id = tests.fx('alice')));
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T10j customer cannot call set_user_role',
  format($q$select public.set_user_role(%L, 'admin')$q$, tests.fx('bob')), 'FORBIDDEN');
reset role;

select tests.login(null); set role anon;
select tests.ok('T11a guests can browse availability',
  (select count(*) > 0 from public.get_availability(tests.get('wed')::date, null)));
select tests.ok('T11b guests can read active courts', (select count(*) = 3 from public.courts));
select tests.throws('T11c guests cannot create holds',
  format($q$select public.create_hold(%L, tests.at(%L, '10:00'), 60)$q$, tests.fx('court1'), tests.get('wed')), '42501');
select tests.throws('T11d guests cannot read bookings', 'select count(*) from public.bookings', '42501');
select tests.throws('T11e guests cannot read profiles', 'select count(*) from public.profiles', '42501');
select tests.throws('T11f guests cannot call admin functions', 'select public.admin_overview()', '42501');
select tests.ok('T11g guests cannot see the private admin alert email',
  not has_column_privilege('anon', 'public.facility_settings', 'admin_alert_email', 'select'));
reset role;

-- T18: a token for a user that no longer exists / was never staff.
select tests.login(gen_random_uuid()); set role authenticated;
select tests.throws('T18a unknown/stale session cannot perform staff actions', 'select public.admin_overview()', 'FORBIDDEN');
select tests.throws('T18b unknown/stale session cannot verify payments',
  format($q$select public.review_payment(%L, true)$q$, gen_random_uuid()), 'FORBIDDEN');
reset role;
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T18c customer cannot create bookings on behalf of others',
  format($q$select public.admin_create_booking(%L, tests.at(%L, '10:00'), 60, 'X')$q$, tests.fx('court1'), tests.get('wed')), 'FORBIDDEN');
select tests.throws('T18d customer cannot block slots',
  format($q$select public.create_blocked_slot(array[%L]::uuid[], tests.at(%L, '10:00'), tests.at(%L, '11:00'), 'x')$q$, tests.fx('court1'), tests.get('wed'), tests.get('wed')), 'FORBIDDEN');
reset role;

-- --------------------------------------------------------- T06 cancel -------
-- Policy: customers can't cancel (only reschedule); staff can, with a reason.
select tests.login(tests.fx('alice')); set role authenticated;
select tests.throws('T06a customers cannot cancel their own booking (reschedule only)',
  format($q$select public.cancel_booking(%L, 'Change of plans')$q$, tests.get('alice_b1')), 'NO_CANCELLATION');
reset role;
select tests.login(tests.fx('staff')); set role authenticated;
do $$
declare b jsonb;
begin
  b := public.cancel_booking(tests.uget('alice_b1'), 'Rained out');
  perform tests.ok('T06a2 staff can cancel a booking with a reason', b ->> 'booking_status' = 'cancelled');
end $$;
select tests.throws('T06b a cancelled booking cannot be cancelled again',
  format($q$select public.cancel_booking(%L, 'again')$q$, tests.get('alice_b1')), 'INVALID_STATUS');
reset role;
select tests.ok('T06c cancellation releases the lock', (select count(*) = 0 from public.slot_locks where ref_id = tests.uget('alice_b1') and active));
select tests.ok('T06d cancellation notification queued', (select count(*) = 1 from public.notifications where booking_id = tests.uget('alice_b1') and notification_type = 'booking_cancelled'));
select tests.login(tests.fx('bob')); set role authenticated;
do $$
declare h jsonb; b jsonb;
begin
  h := public.create_hold(tests.fx('court1'), tests.at(tests.get('tue'), '09:00'), 60);
  b := public.confirm_booking((h ->> 'hold_id')::uuid, 'Bob Reyes', 'bob@example.com', '09170000002', null, null, 'gcash', true);
  perform tests.ok('T06e the cancelled slot becomes bookable again', b ->> 'booking_status' = 'confirmed');
  perform tests.put('bob_b1', b ->> 'id');
  perform tests.ok('T06f another customer cannot see the cancelled booking', (select count(*) = 0 from public.bookings where id = tests.uget('alice_b1')));
end $$;
reset role;
select tests.ok('T06g cancelled booking is retained in the database', (select booking_status = 'cancelled' from public.bookings where id = tests.uget('alice_b1')));

-- Cancellation deadline: booking within 24h cannot be cancelled online by the customer.
-- A start time 2–23 hours away that is inside opening hours (so the test passes at any time of day).
select tests.put('soon_t', (select t::text from generate_series(date_trunc('hour', now()) + interval '2 hours', now() + interval '23 hours', interval '1 hour') t
                             where extract(hour from t at time zone public.facility_tz()) between 7 and 20 limit 1));
select tests.login(tests.fx('staff')); set role authenticated;
select tests.put('soon_b', (public.admin_create_booking(tests.fx('court2'), tests.get('soon_t')::timestamptz, 60,
  'Alice Cruz', 'alice@example.com', '09170000001', tests.fx('alice'))) ->> 'id');
reset role;
select tests.login(tests.fx('alice')); set role authenticated;
select tests.throws('T06h customer cancellation is rejected close to the session too',
  format($q$select public.cancel_booking(%L)$q$, tests.get('soon_b')), 'NO_CANCELLATION');
select tests.throws('T06i customer reschedule after the deadline is rejected',
  format($q$select public.reschedule_booking(%L, tests.at(%L, '11:00'))$q$, tests.get('soon_b'), tests.get('wed')), 'RESCHEDULE_DEADLINE_PASSED');
reset role;
select tests.login(tests.fx('staff')); set role authenticated;
select tests.throws('T06j staff cancellation requires a reason (audit trail)',
  format($q$select public.cancel_booking(%L)$q$, tests.get('soon_b')), 'REASON_REQUIRED');
select tests.ok('T06k staff can cancel after the customer deadline',
  (public.cancel_booking(tests.uget('soon_b'), 'Customer called the desk') ->> 'booking_status') = 'cancelled');
reset role;
select tests.ok('T06l staff cancellation is in the audit log with the actor',
  (select count(*) >= 1 from public.audit_logs where entity_type = 'bookings' and entity_id = tests.get('soon_b')
     and actor_id = tests.fx('staff') and metadata -> 'changes' ? 'booking_status'));

-- ------------------------------------------------------- reschedule ---------
select tests.login(tests.fx('staff')); set role authenticated;
select public.admin_create_booking(tests.fx('court2'), tests.at(tests.get('tue'), '11:00'), 60, 'Occupier');
reset role;
select tests.login(tests.fx('carol')); set role authenticated;
select tests.throws('T19a reschedule into an occupied slot is rejected',
  format($q$select public.reschedule_booking(%L, tests.at(%L, '11:00'))$q$, tests.get('carol_b1'), tests.get('tue')), 'SLOT_TAKEN');
reset role;
-- carol_b1 is court2 15:00; move to court2 16:00 → 17:00 straddles peak? 16:00-17:00 off-peak 350.
select tests.login(tests.fx('carol')); set role authenticated;
do $$
declare b jsonb;
begin
  b := public.reschedule_booking(tests.uget('carol_b1'), tests.at(tests.get('tue'), '17:00'), 120);
  perform tests.ok('T19b reschedule to a free slot succeeds and reprices (2h peak × 450)',
    (b ->> 'total_amount')::numeric = 900 and (b ->> 'duration_minutes')::int = 120, b::text);
end $$;
reset role;
select tests.ok('T19c old time is released, new time is locked',
  (select count(*) = 1 from public.slot_locks where ref_id = tests.uget('carol_b1') and active
     and start_at = tests.at(tests.get('tue'), '17:00') and end_at = tests.at(tests.get('tue'), '19:00')));
select tests.ok('T19d reschedule notification queued',
  (select count(*) = 1 from public.notifications where booking_id = tests.uget('carol_b1') and notification_type = 'booking_rescheduled'));

-- -------------------------------------------------- T15 / payments ---------
select tests.login(tests.fx('bob')); set role authenticated;
do $$
declare p jsonb;
begin
  p := public.submit_payment(tests.uget('bob_b1'), 'gcash', 'GC 1234 5678');
  perform tests.ok('T15a customer submission stays pending (never auto-paid)', p ->> 'payment_status' = 'pending');
  perform tests.put('bob_p1', p ->> 'id');
end $$;
select tests.ok('T15b booking payment status becomes pending',
  (select payment_status = 'pending' from public.bookings where id = tests.uget('bob_b1')));
select tests.throws('T15c second pending submission is rejected',
  format($q$select public.submit_payment(%L, 'gcash', 'GC99999')$q$, tests.get('bob_b1')), 'PAYMENT_ALREADY_PENDING');
reset role;
select tests.login(tests.fx('carol')); set role authenticated;
select tests.throws('T15c2 a payment needs a receipt photo or a reference',
  format($q$select public.submit_payment(%L, 'gcash', null)$q$, tests.get('carol_b1')), 'PROOF_REQUIRED');
select tests.throws('T15c3 a receipt must be in the customer''s own upload folder',
  format($q$select public.submit_payment(%L, 'gcash', null, null, %L)$q$, tests.get('carol_b1'), tests.get('bob_b1') || '/r.jpg'), 'INVALID_REQUEST');
reset role;
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T15d customer cannot verify their own payment',
  format($q$select public.review_payment(%L, true)$q$, tests.get('bob_p1')), 'FORBIDDEN');
reset role;
select tests.login(tests.fx('staff')); set role authenticated;
select tests.throws('T15e staff (non-admin) cannot verify payments',
  format($q$select public.review_payment(%L, true)$q$, tests.get('bob_p1')), 'FORBIDDEN');
reset role;
select tests.login(tests.fx('admin')); set role authenticated;
do $$
declare r jsonb; r2 jsonb;
begin
  r := public.review_payment(tests.uget('bob_p1'), true, null);
  perform tests.ok('T15f admin verification marks the payment paid', r ->> 'payment_status' = 'paid');
  r2 := public.review_payment(tests.uget('bob_p1'), true, null);
  perform tests.ok('T15g repeated verification is idempotent', (r2 ->> 'idempotent_replay')::boolean);
end $$;
reset role;
select tests.ok('T15h booking is fully paid and records the verifier',
  (select b.payment_status = 'paid' and b.amount_paid = 500 and p.verified_by = tests.fx('admin')
     from public.bookings b join public.payments p on p.booking_id = b.id where b.id = tests.uget('bob_b1')));
select tests.ok('T15i payment verified notification queued',
  (select count(*) = 1 from public.notifications where payment_id = tests.uget('bob_p1') and notification_type = 'payment_verified'));

-- Rejected payment must not mark paid.
select tests.login(tests.fx('carol')); set role authenticated;
select tests.put('carol_p1', (public.submit_payment(tests.uget('carol_b1'), 'bank_transfer', 'BT-0001')) ->> 'id');
select tests.throws('T15j duplicate transaction reference is rejected',
  format($q$select public.submit_payment(%L, 'bank_transfer', 'bt-0001')$q$, tests.get('carol_b1')), 'PAYMENT_ALREADY_PENDING');
reset role;
select tests.login(tests.fx('admin')); set role authenticated;
select tests.throws('T15k rejecting requires a reason',
  format($q$select public.review_payment(%L, false)$q$, tests.get('carol_p1')), 'REASON_REQUIRED');
select public.review_payment(tests.uget('carol_p1'), false, 'Reference not found in bank statement');
reset role;
select tests.ok('T15l rejected payment leaves booking unpaid/failed, not paid',
  (select payment_status = 'failed' and amount_paid = 0 from public.bookings where id = tests.uget('carol_b1')));
select tests.login(tests.fx('carol')); set role authenticated;
select tests.ok('T15l2 a GCash payment with only a receipt photo is accepted for review',
  (public.submit_payment(tests.uget('carol_b1'), 'gcash', null, null, tests.fx('carol')::text || '/receipt.jpg') ->> 'payment_status') = 'pending');
reset role;

-- Refund.
select tests.login(tests.fx('admin')); set role authenticated;
select public.refund_payment(tests.uget('bob_p1'), 200, 'Partial goodwill refund');
reset role;
select tests.ok('T15m partial refund updates booking to partially_refunded',
  (select payment_status = 'partially_refunded' and amount_paid = 300 from public.bookings where id = tests.uget('bob_b1')));
select tests.login(tests.fx('admin')); set role authenticated;
select tests.throws('T15n refund larger than remaining amount is rejected',
  format($q$select public.refund_payment(%L, 400, 'too much')$q$, tests.get('bob_p1')), 'INVALID_AMOUNT');
reset role;

-- ------------------------------------- after_payment mode + expiry + T17 ----
update public.facility_settings set booking_confirmation_mode = 'after_payment', payment_due_hours = 1;
select tests.login(tests.fx('alice')); set role authenticated;
do $$
declare h jsonb; b jsonb;
begin
  h := public.create_hold(tests.fx('court3'), tests.at(tests.get('wed'), '19:00'), 60);
  b := public.confirm_booking((h ->> 'hold_id')::uuid, 'Alice Cruz', 'alice@example.com', '09170000001', null, null, 'cash', true);
  perform tests.ok('T20a in pay-first mode new bookings start as pending with a due time',
    b ->> 'booking_status' = 'pending' and b ->> 'payment_due_at' is not null);
  perform tests.put('alice_pend', b ->> 'id');
  perform tests.put('alice_pend_ref', b ->> 'booking_reference');
end $$;
select tests.ok('T20b pending bookings show as pending (still blocking) in availability',
  (select status = 'pending' from public.get_availability(tests.get('wed')::date, tests.fx('court3'))
    where slot_start = tests.at(tests.get('wed'), '19:00')));
reset role;
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T20c a pending booking blocks other customers',
  format($q$select public.create_hold(%L, tests.at(%L, '19:00'), 60)$q$, tests.fx('court3'), tests.get('wed')), 'SLOT_TAKEN');
reset role;
update public.bookings set payment_due_at = now() - interval '1 minute' where id = tests.uget('alice_pend');
select public.expire_stale_records();
select tests.ok('T20d unpaid pending booking expires after its due time and frees the slot',
  (select booking_status = 'expired' from public.bookings where id = tests.uget('alice_pend'))
  and (select count(*) = 0 from public.slot_locks where ref_id = tests.uget('alice_pend') and active));

-- Gateway payment arriving after expiry revives the booking when the slot is still free.
select tests.login_service(); set role service_role;
do $$
declare r jsonb; r2 jsonb; r3 jsonb;
begin
  r := public.record_gateway_payment('testpay', 'evt_1', 'payment.paid', tests.get('alice_pend_ref'), 650, 'pay_1', '{}');
  perform tests.ok('T17a late gateway payment revives an expired booking when the slot is free',
    r -> 'booking' ->> 'booking_status' = 'confirmed' and r -> 'booking' ->> 'note' = 'revived', r::text);
  r2 := public.record_gateway_payment('testpay', 'evt_1', 'payment.paid', tests.get('alice_pend_ref'), 650, 'pay_1', '{}');
  perform tests.ok('T17b duplicate webhook event is ignored', (r2 ->> 'duplicate')::boolean);
  r3 := public.record_gateway_payment('testpay', 'evt_2', 'payment.paid', tests.get('alice_pend_ref'), 650, 'pay_1', '{}');
  perform tests.ok('T17c a different event for the same provider payment is not double-counted', (r3 ->> 'duplicate')::boolean);
end $$;
reset role;
select tests.ok('T17d exactly one payment row and amount_paid = 650',
  (select count(*) = 1 from public.payments where booking_id = tests.uget('alice_pend'))
  and (select amount_paid = 650 and payment_status = 'paid' from public.bookings where id = tests.uget('alice_pend')));
select tests.login(tests.fx('alice')); set role authenticated;
select tests.throws('T17e gateway recording is not callable by customers',
  $q$select public.record_gateway_payment('x', 'e', 'payment.paid', 'PB', 1, 'p', '{}')$q$, '42501');
reset role;
update public.facility_settings set booking_confirmation_mode = 'auto', payment_due_hours = 24;

-- ------------------------------------------------------- admin ops ---------
select tests.login(tests.fx('staff')); set role authenticated;
select tests.throws('T21a blocking over an existing booking requires explicit resolution',
  format($q$select public.create_blocked_slot(array[%L]::uuid[], tests.at(%L, '08:00'), tests.at(%L, '12:00'), 'Resurfacing')$q$,
         tests.fx('court1'), tests.get('tue'), tests.get('tue')), 'BLOCK_CONFLICT');
select tests.ok('T21b ...and leaves the booking untouched',
  (select booking_status = 'confirmed' from public.bookings where id = tests.uget('bob_b1')));
do $$
declare r jsonb;
begin
  r := public.create_blocked_slot(array[tests.fx('court2'), tests.fx('court3')], tests.at(tests.get('wed'), '06:00'), tests.at(tests.get('wed'), '08:00'), 'Clinic');
  perform tests.ok('T21c staff can block free time on several courts', jsonb_array_length(r -> 'blocked_slot_ids') = 2);
  perform tests.put('block1', r -> 'blocked_slot_ids' ->> 0);
end $$;
reset role;
select tests.login(tests.fx('bob')); set role authenticated;
select tests.ok('T21d blocked time shows as blocked',
  (select status = 'blocked' from public.get_availability(tests.get('wed')::date, tests.fx('court2')) where slot_start = tests.at(tests.get('wed'), '06:00')));
select tests.throws('T21e blocked time cannot be booked',
  format($q$select public.create_hold(%L, tests.at(%L, '07:00'), 60)$q$, tests.fx('court2'), tests.get('wed')), 'SLOT_TAKEN');
reset role;
select tests.login(tests.fx('staff')); set role authenticated;
select public.delete_blocked_slot(tests.uget('block1'));
reset role;
select tests.login(tests.fx('bob')); set role authenticated;
select tests.ok('T21f removing a block frees the time',
  (select status = 'available' from public.get_availability(tests.get('wed')::date, tests.fx('court2')) where slot_start = tests.at(tests.get('wed'), '07:00')));
reset role;

-- Court deactivation needs acknowledgement when bookings exist; history is kept.
select tests.login(tests.fx('admin')); set role authenticated;
select tests.ok('T22a deactivating a court with upcoming bookings returns them for review first',
  (public.set_court_active(tests.fx('court1'), false) ->> 'status') = 'conflicts');
select tests.ok('T22b court is still active until acknowledged',
  (select is_active from public.courts where id = tests.fx('court1')));
select public.set_court_active(tests.fx('court1'), false, true);
reset role;
select tests.ok('T22c acknowledged deactivation keeps existing bookings',
  (select booking_status = 'confirmed' from public.bookings where id = tests.uget('bob_b1')));
select tests.login(tests.fx('carol')); set role authenticated;
select tests.throws('T22d an inactive court accepts no new bookings',
  format($q$select public.create_hold(%L, tests.at(%L, '10:00'), 60)$q$, tests.fx('court1'), tests.get('wed')), 'COURT_INACTIVE');
select tests.ok('T22e inactive court is hidden from customers', (select count(*) = 2 from public.courts));
reset role;
select tests.login(tests.fx('admin')); set role authenticated;
select public.set_court_active(tests.fx('court1'), true);
-- Operating hours change that would orphan a booking needs acknowledgement.
select tests.ok('T22f shrinking hours over an existing booking is held for review',
  (public.save_operating_hours(null,
     (select jsonb_agg(jsonb_build_object('day_of_week', d, 'is_closed', false, 'opening_time', '10:00', 'closing_time', '22:00')) from generate_series(0,6) d))
   ->> 'status') = 'conflicts');
select tests.ok('T22g ...and nothing was saved',
  (select opening_time = '06:00' from public.operating_hours where court_id is null and day_of_week = 2));
select tests.throws('T22h invalid settings are rejected (bad timezone)',
  $q$update public.facility_settings set timezone = 'Mars/Olympus' where id = 1$q$, 'INVALID_SETTINGS');
select tests.throws('T22i invalid settings are rejected (hold duration)',
  $q$update public.facility_settings set hold_minutes = 0 where id = 1$q$, 'INVALID_SETTINGS');
select tests.throws('T22j staff role changes are guarded: cannot remove the last admin',
  format($q$select public.set_user_role(%L, 'customer')$q$, tests.fx('admin')), 'LAST_ADMIN');
reset role;
select tests.login(tests.fx('staff')); set role authenticated;
select tests.throws('T22k staff cannot change facility settings (RLS: 0 rows)',
  $q$do $x$ begin update public.facility_settings set hold_minutes = 5 where id = 1; if not found then raise exception using hint = 'BLOCKED'; end if; end $x$$q$, 'BLOCKED');
select tests.throws('T22l staff cannot see revenue', $q$do $x$ begin if (public.admin_overview() ->> 'revenue_today') is null then raise exception using hint='HIDDEN'; end if; end $x$$q$, 'HIDDEN');
reset role;

-- Status transitions.
select tests.login(tests.fx('staff')); set role authenticated;
select tests.throws('T23a cannot complete a booking before it starts',
  format($q$select public.set_booking_status(%L, 'completed')$q$, tests.get('bob_b1')), 'INVALID_TRANSITION');
select tests.throws('T23b cannot revive a cancelled booking via status change',
  format($q$select public.set_booking_status(%L, 'confirmed')$q$, tests.get('alice_b1')), 'INVALID_TRANSITION');
reset role;

-- ------------------------------------------------------- reports ------------
select tests.login(tests.fx('admin')); set role authenticated;
do $$
declare o jsonb; r jsonb;
begin
  o := public.admin_overview(tests.get('tue')::date);
  perform tests.ok('T24a overview counts real bookings for the day', (o ->> 'todays_bookings')::int >= 3, o::text);
  r := public.admin_report(tests.today(), tests.today() + 14, null, null);
  perform tests.ok('T24b report totals reflect real data',
    (r -> 'totals' ->> 'bookings')::int = (select count(*) from public.bookings
       where start_at >= tests.at(tests.today(), '00:00') and start_at < tests.at(tests.today() + 15, '00:00')), r -> 'totals' ->> 'bookings');
  perform tests.ok('T24c paid revenue = verified payments minus refunds (300 + 650)',
    (r -> 'totals' ->> 'paid_revenue')::numeric = 950, r -> 'totals' ->> 'paid_revenue');
end $$;
reset role;

-- --------------------------------------------- reference format & counter ---
select tests.ok('T25 booking references are unique and sequential per day',
  (select count(distinct booking_reference) = count(*) from public.bookings));

-- ----------------------------------------------------- staff detail edits ---
select tests.login(tests.fx('bob')); set role authenticated;
select tests.throws('T26a customers cannot use the staff detail editor',
  format($q$select public.admin_update_booking_details(%L, 'X Y')$q$, tests.get('bob_b1')), 'FORBIDDEN');
reset role;
select tests.login(tests.fx('staff')); set role authenticated;
select tests.throws('T26b staff detail edits are validated',
  format($q$select public.admin_update_booking_details(%L, 'Bob Reyes', 'bad-email')$q$, tests.get('bob_b1')), 'INVALID_CONTACT');
select public.admin_update_booking_details(tests.uget('bob_b1'), 'Robert Reyes', 'bob@example.com', '09170000002', 4, 'Needs paddles');
reset role;
select tests.ok('T26c staff can correct contact details, and it is audited',
  (select customer_name = 'Robert Reyes' and players = 4 from public.bookings where id = tests.uget('bob_b1'))
  and exists (select 1 from public.audit_logs where entity_id = tests.get('bob_b1') and actor_id = tests.fx('staff') and metadata -> 'changes' ? 'customer_name'));
