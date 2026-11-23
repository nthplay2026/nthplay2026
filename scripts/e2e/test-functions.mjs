// Integration tests for the Edge Function handlers, run against the local
// stack (gateway on :54321) with a mock email provider.
//   node scripts/e2e/test-functions.mjs
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const keys = JSON.parse(readFileSync(new URL('./.keys.json', import.meta.url), 'utf8'));
const BASE = 'http://127.0.0.1:54321';
const DB = process.env.E2E_DB || 'nthplay_e2e';
const sql = (q) => execFileSync('psql', ['-X', '-q', '-t', '-A', '-h', 'localhost', '-p', '54322', '-U', 'postgres', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const notifications = await import('../../supabase/functions/send-notifications/handler.ts');
const webhook = await import('../../supabase/functions/payment-webhook/handler.ts');

const RUN = Date.now().toString(36);
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${cond ? '' : ' | ' + detail}`); };

// --- mock Resend ------------------------------------------------------------
const sent = [];
let failNext = 0;
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  if (failNext > 0) { failNext--; res.writeHead(500, { 'content-type': 'application/json' }).end('{"message":"provider down"}'); return; }
  const key = req.headers['idempotency-key'];
  const prior = sent.find((s) => s.key === key);
  const id = prior ? prior.id : `re_${RUN}_${sent.length + 1}`;
  if (!prior) sent.push({ key, id, auth: req.headers.authorization, body: JSON.parse(body) });
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id }));
}).listen(4010);

const baseEnv = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: keys.serviceKey, CRON_SECRET: 'cron-test-secret', APP_URL: 'http://localhost:5173' };
const envOf = (extra = {}) => (k) => ({ ...baseEnv, ...extra })[k];
const call = (handler, env, headers = {}, body = '') => handler(new Request('http://x/fn', { method: 'POST', headers, body }), env);

// --- fixture: a real booking made over HTTP --------------------------------
async function api(path, { method = 'POST', token = keys.anonKey, body } = {}) {
  const r = await fetch(BASE + path, { method, headers: { apikey: keys.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null };
}
const email = `fn-${Date.now()}@example.com`;
const signup = await api('/auth/v1/signup', { body: { email, password: 'Passw0rd!x', data: { full_name: 'Fn Tester' } } });
const token = signup.body.access_token;
// Find a free slot (the suite may run repeatedly against the same database).
let hold;
outer: for (let d = 5; d < 25; d++) {
  const day = sql(`select (public.local_today() + ${d})::text`);
  for (let h = 6; h <= 20; h++) {
    hold = await api('/rest/v1/rpc/create_hold', { token, body: { p_court: '33333333-3333-4333-8333-333333333333', p_start: `${day}T${String(h).padStart(2, '0')}:00:00+08:00`, p_duration: 60 } });
    if (hold.status === 200) break outer;
  }
}
const booking = await api('/rest/v1/rpc/confirm_booking', { token, body: { p_hold: hold.body.hold_id, p_name: 'Fn Tester', p_email: email, p_phone: '09171112222', p_payment_method: 'cash', p_accept_terms: true } });
ok('fixture booking created over HTTP', booking.status === 200 && booking.body.booking_reference, JSON.stringify(booking.body));
const ref = booking.body.booking_reference;

// --- send-notifications ------------------------------------------------------
let r = await call(notifications.handle, envOf({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.c', RESEND_API_BASE: 'http://127.0.0.1:4010' }), {});
ok('N1 worker rejects unauthenticated calls (401)', r.status === 401);
r = await call(notifications.handle, envOf({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.c' }), { 'x-cron-secret': 'wrong' });
ok('N2 worker rejects a wrong cron secret (401)', r.status === 401);

const queuedBefore = Number(sql(`select count(*) from notifications where delivery_status = 'queued'`));
r = await call(notifications.handle, envOf(), { 'x-cron-secret': 'cron-test-secret' });
const queuedAfter = Number(sql(`select count(*) from notifications where delivery_status = 'queued'`));
ok('N3 without email credentials: 503, nothing claimed or marked sent', r.status === 503 && queuedBefore > 0 && queuedAfter === queuedBefore, `${r.status} ${queuedBefore}->${queuedAfter}`);

const env = envOf({ RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Nth Play <bookings@example.com>', RESEND_API_BASE: 'http://127.0.0.1:4010' });
failNext = 1;
r = await call(notifications.handle, env, { 'x-cron-secret': 'cron-test-secret' });
let out = await r.json();
ok('N4 provider error is recorded as failed, never as sent', out.failed === 1 && out.sent === queuedBefore - 1, JSON.stringify(out));
const failedRow = sql(`select delivery_status || '|' || attempts || '|' || (next_attempt_at > now()) || '|' || (sent_at is null) from notifications where delivery_status = 'failed' limit 1`);
ok('N5 failed row: attempts=1, retry scheduled with backoff, no sent_at', failedRow === 'failed|1|true|true', failedRow);
ok('N6 emails carry the outbox idempotency key and the API key', sent.length > 0 && sent.every((s) => s.key && s.auth === 'Bearer re_test_key'));
const runIds = sent.map((x) => `'${x.id}'`).join(',') || "''";
ok('N8 sent rows store the provider message id', Number(sql(`select count(*) from notifications where delivery_status = 'sent' and provider_message_id in (${runIds})`)) === sent.length);

const sentBefore = sent.length;
sql(`update notifications set next_attempt_at = now() where delivery_status = 'failed'`);
r = await call(notifications.handle, env, { Authorization: `Bearer ${keys.serviceKey}` });
out = await r.json();
ok('N9 retry sends the failed message once; already-sent ones are not resent', out.sent === 1 && sent.length === sentBefore + 1, JSON.stringify(out));
const confirm = sent.find((s) => s.body.to[0] === email);
ok('N7 customer confirmation email has reference, court and link',
  confirm && confirm.body.subject.includes(ref) && confirm.body.html.includes('Court 3') && confirm.body.text.includes(`/my-bookings/${ref}`), confirm?.body.subject);
r = await call(notifications.handle, env, { 'x-cron-secret': 'cron-test-secret' });
out = await r.json();
ok('N10 a further run has nothing to send', out.claimed === 0 && sent.length === sentBefore + 1, JSON.stringify(out));

// --- payment-webhook ---------------------------------------------------------
const whSecret = 'whsec_test';
const wenv = envOf({ PAYMENT_WEBHOOK_SECRET: whSecret, PAYMENT_PROVIDER_NAME: 'testgw' });
const sign = (body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', whSecret).update(`${t}.${body}`).digest('hex')}`;
const evt = (id, payId, amount = 350) => JSON.stringify({ id: `${RUN}_${id}`, type: 'payment.paid', data: { booking_reference: ref, amount, payment_id: `${RUN}_${payId}` } });

r = await call(webhook.handle, envOf(), { 'x-signature': sign(evt('e0', 'p0')) }, evt('e0', 'p0'));
ok('W1 webhook refuses to run without a configured secret (503)', r.status === 503);
r = await call(webhook.handle, wenv, { 'x-signature': 't=1,v1=deadbeef' }, evt('e1', 'p1'));
ok('W2 invalid signature is rejected (401)', r.status === 401);
r = await call(webhook.handle, wenv, { 'x-signature': sign(evt('e1', 'p1'), Math.floor(Date.now() / 1000) - 3600) }, evt('e1', 'p1'));
ok('W3 replayed/old signature timestamp is rejected (401)', r.status === 401);
const tampered = evt('e1', 'p1', 1);
r = await call(webhook.handle, wenv, { 'x-signature': sign(evt('e1', 'p1')) }, tampered);
ok('W4 tampered body fails signature check (401)', r.status === 401);
r = await call(webhook.handle, wenv, { 'x-signature': sign('{"nope":1}') }, '{"nope":1}');
ok('W5 malformed event is rejected (400)', r.status === 400);

r = await call(webhook.handle, wenv, { 'x-signature': sign(evt('e1', 'p1')) }, evt('e1', 'p1'));
out = await r.json();
ok('W6 valid signed event records the payment and marks the booking paid',
  r.status === 200 && sql(`select payment_status from bookings where booking_reference = '${ref}'`) === 'paid', JSON.stringify(out));
r = await call(webhook.handle, wenv, { 'x-signature': sign(evt('e1', 'p1')) }, evt('e1', 'p1'));
const r2 = await call(webhook.handle, wenv, { 'x-signature': sign(evt('e2', 'p1')) }, evt('e2', 'p1'));
ok('W7 duplicate / re-sent events do not create extra payments',
  r.status === 200 && r2.status === 200 && sql(`select count(*) from payments p join bookings b on b.id = p.booking_id where b.booking_reference = '${ref}'`) === '1');
const unk = JSON.stringify({ id: `${RUN}_e9`, type: 'payment.paid', data: { booking_reference: 'PB-00000000-0000', amount: 10, payment_id: `${RUN}_p9` } });
r = await call(webhook.handle, wenv, { 'x-signature': sign(unk) }, unk);
ok('W8 unknown booking reference is acknowledged with 422 and not recorded', r.status === 422 && sql(`select count(*) from payment_events where event_id = '${RUN}_e9'`) === '0');

mock.close();
const failed = results.filter((x) => !x.ok).length;
console.log(`----\n${results.length} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
