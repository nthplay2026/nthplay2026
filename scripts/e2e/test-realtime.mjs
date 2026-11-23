// Realtime integration test against the local stack (gateway on :54321).
// Two independent socket clients watch the same date; a booking made over
// HTTP by customer A must reach client B within 2 seconds, and B's next
// availability fetch must show the slot as booked. Private rows (bookings)
// must reach staff but never another customer.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const WebSocket = require(process.env.WS_MODULE || '/opt/npm-tools/node_modules/ws');
const keys = JSON.parse(readFileSync(new URL('./.keys.json', import.meta.url), 'utf8'));
const BASE = 'http://127.0.0.1:54321';
const sql = (q) => execFileSync('psql', ['-X', '-q', '-t', '-A', '-h', 'localhost', '-p', '54322', '-U', 'postgres', '-d', process.env.E2E_DB || 'nthplay_e2e', '-c', q], { encoding: 'utf8' }).trim();
const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${cond ? '' : ' | ' + detail}`); };

async function api(path, { token = keys.anonKey, body, method = 'POST' } = {}) {
  const r = await fetch(BASE + path, { method, headers: { apikey: keys.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null };
}
async function user(tag, role) {
  const email = `rt-${tag}-${Date.now()}@example.com`;
  const s = await api('/auth/v1/signup', { body: { email, password: 'Passw0rd!x' } });
  if (role) {
    sql(`update profiles set role = '${role}' where email = '${email}'`);
  }
  return { email, token: s.body.access_token, id: s.body.user.id };
}

function client(token, changes, label) {
  const events = [];
  const ws = new WebSocket(`ws://127.0.0.1:54321/realtime/v1/websocket?apikey=${keys.anonKey}&vsn=1.0.0`);
  const ready = new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ topic: `realtime:${label}`, event: 'phx_join', ref: '1', join_ref: '1', payload: { config: { postgres_changes: changes }, access_token: token } })));
    ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d.event === 'phx_reply' && d.ref === '1') d.payload.status === 'ok' ? resolve() : reject(new Error(JSON.stringify(d.payload)));
      if (d.event === 'postgres_changes') events.push({ at: Date.now(), ...d.payload.data });
    });
    setTimeout(() => reject(new Error('join timeout')), 5000);
  });
  return { ws, events, ready };
}
const waitFor = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };

const a = await user('a');
const b = await user('b');
const staff = await user('staff', 'staff');
// Pick a free slot.
let date, start, hold;
outer: for (let d = 3; d < 25; d++) {
  date = sql(`select (public.local_today() + ${d})::text`);
  for (let h = 6; h <= 20; h++) {
    start = `${date}T${String(h).padStart(2, '0')}:00:00+08:00`;
    const free = await api('/rest/v1/rpc/get_availability', { body: { p_date: date, p_court: '11111111-1111-4111-8111-111111111111' } });
    const s = free.body.find((x) => x.slot_start && Date.parse(x.slot_start) === Date.parse(start));
    if (s?.status === 'available') break outer;
  }
}

const filter = `local_date=eq.${date}`;
const cA = client(a.token, [{ event: '*', schema: 'public', table: 'slot_locks', filter }], 'a');
const cB = client(b.token, [{ event: '*', schema: 'public', table: 'slot_locks', filter }, { event: '*', schema: 'public', table: 'bookings' }], 'b');
const cG = client(keys.anonKey, [{ event: '*', schema: 'public', table: 'slot_locks', filter }], 'guest');
const cS = client(staff.token, [{ event: '*', schema: 'public', table: 'bookings' }], 'staff');
const cOther = client(b.token, [{ event: '*', schema: 'public', table: 'slot_locks', filter: `local_date=eq.2000-01-01` }], 'otherdate');
await Promise.all([cA.ready, cB.ready, cG.ready, cS.ready, cOther.ready]);
ok('R1 customers, guests and staff can subscribe', true);

const t0 = Date.now();
hold = await api('/rest/v1/rpc/create_hold', { token: a.token, body: { p_court: '11111111-1111-4111-8111-111111111111', p_start: start, p_duration: 60 } });
ok('R2 customer A creates a hold', hold.status === 200, JSON.stringify(hold.body));
ok('R3 customer B is notified of A\'s hold in < 2 s', await waitFor(() => cB.events.some((e) => e.table === 'slot_locks' && e.eventType === 'INSERT')), `events=${cB.events.length}`);
ok('R4 a guest (not signed in) is notified too', await waitFor(() => cG.events.some((e) => e.table === 'slot_locks')));
const heldView = await api('/rest/v1/rpc/get_availability', { token: b.token, body: { p_date: date, p_court: '11111111-1111-4111-8111-111111111111' } });
ok('R5 B\'s refetch shows the slot as held', heldView.body.find((x) => x.slot_start && Date.parse(x.slot_start) === Date.parse(start))?.status === 'held');

const conf = await api('/rest/v1/rpc/confirm_booking', { token: a.token, body: { p_hold: hold.body.hold_id, p_name: 'Rt A', p_email: a.email, p_phone: '09171112222', p_payment_method: 'cash', p_accept_terms: true } });
ok('R6 A confirms the booking', conf.status === 200, JSON.stringify(conf.body));
ok('R7 B is notified of the confirmation (lock converted)', await waitFor(() => cB.events.some((e) => e.table === 'slot_locks' && e.eventType === 'UPDATE' && e.new.kind === 'booking')));
const latency = (cB.events.find((e) => e.table === 'slot_locks')?.at ?? Infinity) - t0;
const bookedView = await api('/rest/v1/rpc/get_availability', { token: b.token, body: { p_date: date, p_court: '11111111-1111-4111-8111-111111111111' } });
ok('R8 B\'s refetch shows the slot as booked', bookedView.body.find((x) => x.slot_start && Date.parse(x.slot_start) === Date.parse(start))?.status === 'booked');
ok('R9 B tries the same slot: the server rejects it with SLOT_TAKEN',
  (await api('/rest/v1/rpc/create_hold', { token: b.token, body: { p_court: '11111111-1111-4111-8111-111111111111', p_start: start, p_duration: 60 } })).body?.hint === 'SLOT_TAKEN');

ok('R10 staff receive the private booking row', await waitFor(() => cS.events.some((e) => e.table === 'bookings' && e.new.id === conf.body.id)));
ok('R11 another customer never receives A\'s booking row (RLS)', !cB.events.some((e) => e.table === 'bookings'));
ok('R12 subscriptions are scoped by date (other-date client got nothing)', cOther.events.length === 0);
ok('R13 slot_locks events carry no personal data', cB.events.filter((e) => e.table === 'slot_locks').every((e) => !('customer_name' in e.new) && !('customer_email' in e.new)));

await api('/rest/v1/rpc/cancel_booking', { token: staff.token, body: { p_booking: conf.body.id, p_reason: 'Rained out' } }); // customers can't cancel; staff can
ok('R14 cancellation is pushed to B', await waitFor(() => cB.events.some((e) => e.table === 'slot_locks' && e.eventType === 'UPDATE' && e.new.active === false)));
console.log(`(first event reached B ${latency} ms after the hold request was sent)`);

for (const c of [cA, cB, cG, cS, cOther]) c.ws.close();
const failed = results.filter((x) => !x).length;
console.log(`----\n${results.length} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
