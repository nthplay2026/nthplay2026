#!/usr/bin/env bash
# Concurrency tests: many real, simultaneous database sessions race for the
# same court time. Each session holds its transaction open briefly so the
# attempts genuinely overlap. Exactly one may win.
set -euo pipefail
DB="${1:-nthplay_test}"
export PGOPTIONS="-c client_min_messages=warning"
Q() { psql -X -q -t -A -d "$DB" -c "$1"; }
N=24

# Fresh customers for the race.
for i in $(seq 1 $N); do
  Q "insert into tests.fx select 'racer$i', tests.create_user('racer$i@example.com', 'customer', 'Racer $i') on conflict do nothing" >/dev/null
done
DAY=$(Q "select tests.next_dow(4)")   # a Thursday ≥ 2 days out

race() { # $1 = user key, $2 = SQL to run as that user, $3 = outfile
  psql -X -q -t -A -d "$DB" >"$3" 2>&1 <<SQL || true
select tests.login(tests.fx('$1'));
set role authenticated;
begin;
$2;
select pg_sleep(0.3);
commit;
SQL
}

# --- C1: N customers hold the exact same slot at the same moment ------------
tmp=$(mktemp -d)
for i in $(seq 1 $N); do
  race "racer$i" "select 'WIN' from public.create_hold(tests.fx('court2'), tests.at('$DAY', '10:00'), 60)" "$tmp/c1_$i" &
done
wait
wins=$(cat "$tmp"/c1_* | grep -c '^WIN$' || true)
taken=$(grep -l 'just reserved by someone else' "$tmp"/c1_* | wc -l)
locks=$(Q "select count(*) from public.slot_locks where court_id = tests.fx('court2') and active and start_at = tests.at('$DAY', '10:00')")
Q "select tests.ok('T03a $N simultaneous holds on one slot: exactly one wins', $wins = 1 and $locks = 1, 'wins=$wins locks=$locks')" >/dev/null
Q "select tests.ok('T03b every loser gets a clear SLOT_TAKEN message', $taken = $N - 1, 'taken=$taken')" >/dev/null

# --- C2: overlapping intervals with different starts, simultaneously --------
for i in $(seq 1 $N); do
  if (( i % 2 )); then sql="select 'WIN' from public.create_hold(tests.fx('court3'), tests.at('$DAY', '14:00'), 120)"
  else sql="select 'WIN' from public.create_hold(tests.fx('court3'), tests.at('$DAY', '15:00'), 60)"; fi
  race "racer$i" "$sql" "$tmp/c2_$i" &
done
wait
wins=$(cat "$tmp"/c2_* | grep -c '^WIN$' || true)
overlaps=$(Q "select count(*) from public.slot_locks a join public.slot_locks b on a.court_id = b.court_id and a.id < b.id and a.lock_range && b.lock_range where a.active and b.active")
Q "select tests.ok('T03c overlapping different-start races: exactly one wins, zero overlaps', $wins = 1 and $overlaps = 0, 'wins=$wins overlaps=$overlaps')" >/dev/null

# --- C3: double-submit race — the same hold confirmed twice concurrently -----
HOLD=$(psql -X -q -t -A -d "$DB" -c "select tests.login(tests.fx('racer1'))" -c "set role authenticated" \
        -c "select (public.create_hold(tests.fx('court1'), tests.at('$DAY', '18:00'), 60)) ->> 'hold_id'" | tail -1)
for k in 1 2 3 4; do
  race "racer1" "select 'BID:' || (public.confirm_booking('$HOLD', 'Racer One', 'racer1@example.com', '09171234567', null, null, 'cash', true) ->> 'id')" "$tmp/c3_$k" &
done
wait
ids=$(cat "$tmp"/c3_* | grep '^BID:' | sort -u | wc -l)
rows=$(Q "select count(*) from public.bookings where customer_id = tests.fx('racer1')")
Q "select tests.ok('T03d concurrent double-submit creates exactly one booking', $ids = 1 and $rows = 1, 'distinct_ids=$ids rows=$rows')" >/dev/null

# --- C4: staff desk bookings race customers for the same slot ----------------
Q "insert into tests.fx select 'staff2', tests.create_user('staff2@example.com', 'staff', 'Desk Two') on conflict do nothing" >/dev/null
for i in $(seq 1 8); do
  race "staff" "select 'WIN' from public.admin_create_booking(tests.fx('court1'), tests.at('$DAY', '20:00'), 60, 'Walk-in $i')" "$tmp/c4_s$i" &
  race "racer$((i+2))" "select 'WIN' from public.create_hold(tests.fx('court1'), tests.at('$DAY', '20:00'), 60)" "$tmp/c4_c$i" &
done
wait
wins=$(cat "$tmp"/c4_* | grep -c '^WIN$' || true)
Q "select tests.ok('T03e staff and customer racing for one slot: exactly one wins', $wins = 1, 'wins=$wins')" >/dev/null

# --- C5: global invariant ----------------------------------------------------
bad=$(Q "select count(*) from public.bookings a join public.bookings b on a.court_id = b.court_id and a.id < b.id
          and tstzrange(a.start_at, a.end_at) && tstzrange(b.start_at, b.end_at)
         where a.booking_status in ('pending','confirmed') and b.booking_status in ('pending','confirmed')")
Q "select tests.ok('T03f invariant: no two live bookings overlap on any court', $bad = 0, 'overlapping pairs=$bad')" >/dev/null
rm -rf "$tmp"
