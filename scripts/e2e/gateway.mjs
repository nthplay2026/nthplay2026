// Local Supabase-compatible gateway for end-to-end tests.
//
//   /rest/v1/*        -> PostgREST (real)
//   /auth/v1/*        -> Supabase Auth / GoTrue (real)
//   /functions/v1/*   -> our Edge Function handlers (run in Node)
//   /realtime/v1/websocket -> a Phoenix-protocol server speaking the
//                        Supabase Realtime `postgres_changes` wire format, fed by
//                        PostgreSQL logical replication (pg_recvlogical +
//                        test_decoding). It applies the same visibility rules as
//                        our RLS policies for the tables in the publication.
//
// This only exists so the app can be exercised end-to-end in a sandbox with
// no Docker. In production the app talks to a real Supabase project.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require(process.env.WS_MODULE || '/opt/npm-tools/node_modules/ws');

const keys = JSON.parse(readFileSync(new URL('./.keys.json', import.meta.url), 'utf8'));
const PORT = Number(process.env.GATEWAY_PORT || 54321);
const DB = process.env.E2E_DB || 'nthplay_e2e';
const PG = { host: process.env.PGHOST || 'localhost', port: process.env.PGPORT || '54322', user: process.env.PGUSER || 'postgres' };
const UPSTREAM = { rest: 'http://127.0.0.1:3000', auth: 'http://127.0.0.1:9999' };
const FUNCTIONS_DIR = new URL('../../supabase/functions/', import.meta.url);
const log = (...a) => process.env.QUIET ? null : console.log(new Date().toISOString().slice(11, 23), ...a);

// ------------------------------------------------------------------ JWT ----
function verifyJwt(token) {
  try {
    const [h, p, s] = token.split('.');
    const expect = createHmac('sha256', keys.jwtSecret).update(`${h}.${p}`).digest('base64url');
    if (expect !== s) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch { return null; }
}
function psqlValue(sql) {
  const r = spawnSync('psql', ['-X', '-q', '-t', '-A', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', DB, '-c', sql], { encoding: 'utf8' });
  return r.stdout.trim();
}
const uuidRe = /^[0-9a-f-]{36}$/i;
function roleOf(sub) {
  if (!sub || !uuidRe.test(sub)) return 'anon';
  return psqlValue(`select role from public.profiles where id = '${sub}'`) || 'customer';
}

// ----------------------------------------------------------- HTTP proxy ----
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, range, x-supabase-api-version, x-signature, x-cron-secret',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-total-count',
};

async function proxy(req, res, base, path) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host; delete headers.connection; delete headers['content-length'];
  const r = await fetch(base + path, {
    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: 'manual',
  });
  const out = { ...cors };
  r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}

const fnCache = new Map();
async function runFunction(req, res, name) {
  if (!/^[a-z0-9-]+$/.test(name)) { res.writeHead(404, cors).end(); return; }
  let mod = fnCache.get(name);
  if (!mod) { mod = await import(new URL(`${name}/handler.ts`, FUNCTIONS_DIR)); fnCache.set(name, mod); }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const env = (k) => process.env[k] ?? { SUPABASE_URL: `http://127.0.0.1:${PORT}`, SUPABASE_SERVICE_ROLE_KEY: keys.serviceKey, SUPABASE_ANON_KEY: keys.anonKey }[k];
  const response = await mod.handle(request, env);
  const out = { ...cors };
  response.headers.forEach((v, k) => { out[k] = v; });
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const url = req.url || '/';
    if (url.startsWith('/rest/v1')) return await proxy(req, res, UPSTREAM.rest, url.slice('/rest/v1'.length) || '/');
    if (url.startsWith('/auth/v1')) return await proxy(req, res, UPSTREAM.auth, url.slice('/auth/v1'.length) || '/');
    if (url.startsWith('/functions/v1/')) return await runFunction(req, res, url.slice('/functions/v1/'.length).split(/[/?]/)[0]);
    if (url === '/health') { res.writeHead(200, cors).end('ok'); return; }
    res.writeHead(404, cors).end('not found');
  } catch (e) {
    log('proxy error', e.message);
    if (!res.headersSent) res.writeHead(502, cors);
    res.end(JSON.stringify({ message: 'gateway error', detail: e.message }));
  }
});

// ------------------------------------------------- Realtime (Phoenix) ------
const REALTIME_TABLES = new Set(['public.slot_locks', 'public.bookings', 'public.payments', 'public.courts']);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/realtime/v1/websocket')) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

let bindingSeq = 1;
const clients = new Set();

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const v2 = params.get('vsn') === '2.0.0';
  const client = { ws, v2, channels: new Map(), claims: verifyJwt(params.get('apikey') || '') };
  clients.add(client);
  const send = (topic, event, payload, ref = null, joinRef = null) => {
    if (ws.readyState !== 1) return;
    ws.send(v2 ? JSON.stringify([joinRef, ref, topic, event, payload]) : JSON.stringify({ topic, event, payload, ref, join_ref: joinRef }));
  };
  client.send = send;

  ws.on('message', (raw) => {
    let m;
    try {
      const d = JSON.parse(raw.toString());
      m = Array.isArray(d) ? { join_ref: d[0], ref: d[1], topic: d[2], event: d[3], payload: d[4] } : d;
    } catch { return; }
    const { topic, event, payload = {}, ref, join_ref } = m;
    if (topic === 'phoenix' && event === 'heartbeat') return send('phoenix', 'phx_reply', { status: 'ok', response: {} }, ref);
    if (event === 'phx_join') {
      const token = payload.access_token || params.get('apikey');
      const claims = verifyJwt(token || '');
      if (!claims) return send(topic, 'phx_reply', { status: 'error', response: { reason: 'Invalid JWT' } }, ref, join_ref);
      const changes = (payload.config?.postgres_changes || []).map((c) => ({ ...c, id: bindingSeq++ }));
      client.channels.set(topic, { joinRef: join_ref, changes, claims, role: claims.role === 'service_role' ? 'admin' : roleOf(claims.sub) });
      send(topic, 'phx_reply', { status: 'ok', response: { postgres_changes: changes } }, ref, join_ref);
      if (changes.length) send(topic, 'system', { status: 'ok', message: 'Subscribed to PostgreSQL', extension: 'postgres_changes', channel: topic.replace(/^realtime:/, '') }, null, join_ref);
      log('rt join', topic, changes.map((c) => `${c.table}${c.filter ? '?' + c.filter : ''}`).join(','));
      return;
    }
    if (event === 'access_token') {
      const ch = client.channels.get(topic);
      const claims = verifyJwt(payload.access_token || '');
      if (ch && claims) { ch.claims = claims; ch.role = claims.role === 'service_role' ? 'admin' : roleOf(claims.sub); }
      return;
    }
    if (event === 'phx_leave') {
      client.channels.delete(topic);
      return send(topic, 'phx_reply', { status: 'ok', response: {} }, ref, join_ref);
    }
    if (event === 'broadcast' || event === 'presence') return send(topic, 'phx_reply', { status: 'ok', response: {} }, ref, join_ref);
  });
  ws.on('close', () => clients.delete(client));
});

function matchFilter(filter, row) {
  if (!filter) return true;
  const m = /^([a-z_]+)=(eq|neq|lt|lte|gt|gte|in)\.(.*)$/.exec(filter);
  if (!m || !row) return false;
  const [, col, op, raw] = m;
  const v = row[col] == null ? null : String(row[col]);
  switch (op) {
    case 'eq': return v === raw;
    case 'neq': return v !== raw;
    case 'in': return raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim()).includes(v);
    case 'lt': return v < raw; case 'lte': return v <= raw; case 'gt': return v > raw; case 'gte': return v >= raw;
  }
  return false;
}

// Mirrors the SELECT policies in migration 0700 for realtime visibility.
function visible(ch, table, row) {
  if (table === 'slot_locks') return true;
  if (table === 'courts') return row.is_active || ch.role === 'staff' || ch.role === 'admin';
  const sub = ch.claims?.sub;
  if (ch.role === 'staff' || ch.role === 'admin') return true;
  if (!sub) return false;
  if (table === 'bookings') return row.customer_id === sub;
  if (table === 'payments') return psqlValue(`select 1 from public.bookings where id = '${row.booking_id}' and customer_id = '${sub}'`) === '1';
  return false;
}

function dispatch(change) {
  const table = change.table;
  for (const c of clients) {
    for (const [topic, ch] of c.channels) {
      const ids = ch.changes.filter((b) =>
        (b.schema || 'public') === change.schema && b.table === table &&
        (b.event === '*' || b.event === change.eventType) &&
        matchFilter(b.filter, change.eventType === 'DELETE' ? change.old : change.new)).map((b) => b.id);
      if (!ids.length) continue;
      const row = change.eventType === 'DELETE' ? change.old : change.new;
      if (!visible(ch, table, row)) continue;
      c.send(topic, 'postgres_changes', { data: { ...change, type: change.eventType, errors: null }, ids }, null, ch.joinRef);
    }
  }
}

// ----------------------------------------- logical replication (WAL) -------
// test_decoding line: table public.slot_locks: UPDATE: old-key: a[uuid]:'x' ... new-tuple: a[uuid]:'y' ...
function parseTuple(s) {
  const out = {};
  const re = /([a-z_][a-z0-9_]*)\[(.+?)\]:('(?:[^']|'')*'|\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    const [, col, type, rawv] = m;
    if (rawv === 'unchanged-toast-datum') continue;
    let v = rawv === 'null' ? null : rawv.startsWith("'") ? rawv.slice(1, -1).replace(/''/g, "'") : rawv;
    if (v !== null) {
      if (/^(integer|smallint|bigint|numeric|double precision|real)$/.test(type)) v = Number(v);
      else if (type === 'boolean') v = v === 'true';
      else if (type === 'jsonb' || type === 'json') { try { v = JSON.parse(v); } catch { /* keep */ } }
      else if (type.startsWith('timestamp with time zone')) v = v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
    }
    out[col] = v;
  }
  return out;
}

function startReplication() {
  const base = ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', DB, '--slot', 'nthplay_realtime'];
  spawnSync('pg_recvlogical', [...base, '--drop-slot'], { stdio: 'ignore' });
  spawnSync('pg_recvlogical', [...base, '--create-slot', '-P', 'test_decoding'], { stdio: 'inherit' });
  const p = spawn('pg_recvlogical', [...base, '--start', '-f', '-', '-s', '1', '-F', '0', '-o', 'include-timestamp=1', '-o', 'include-xids=0']);
  let buf = '';
  let pending = [];
  p.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.startsWith('BEGIN')) { pending = []; continue; }
      if (line.startsWith('COMMIT')) {
        const ts = (/\(at (.+)\)/.exec(line) || [])[1];
        for (const c of pending) dispatch({ ...c, commit_timestamp: ts ? new Date(ts).toISOString() : new Date().toISOString() });
        pending = [];
        continue;
      }
      const m = /^table ([a-z_]+)\.([a-z_]+): (INSERT|UPDATE|DELETE): (.*)$/.exec(line);
      if (!m || !REALTIME_TABLES.has(`${m[1]}.${m[2]}`)) continue;
      const [, schema, table, op, rest] = m;
      let oldRow = {}, newRow = {};
      if (op === 'INSERT') newRow = parseTuple(rest);
      else if (op === 'DELETE') oldRow = parseTuple(rest.replace(/^old-key: /, ''));
      else if (rest.startsWith('old-key:')) {
        const j = rest.indexOf(' new-tuple: ');
        oldRow = parseTuple(rest.slice(8, j)); newRow = parseTuple(rest.slice(j + 12));
      } else newRow = parseTuple(rest);
      pending.push({ schema, table, eventType: op, new: newRow, old: oldRow, columns: [] });
    }
  });
  p.stderr.on('data', (d) => log('pg_recvlogical:', d.toString().trim()));
  p.on('exit', (code) => { log('replication stopped', code, '- restarting'); setTimeout(startReplication, 1000); });
}

server.listen(PORT, '0.0.0.0', () => {
  log(`gateway listening on http://localhost:${PORT}`);
  startReplication();
});
