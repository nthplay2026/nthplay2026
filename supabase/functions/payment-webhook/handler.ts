// Payment gateway webhook (provider-neutral).
//
// Security
// - Signature: header `x-signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` over
//   `${t}.${rawBody}` with PAYMENT_WEBHOOK_SECRET; constant-time comparison.
// - Replay protection: timestamps older/newer than 5 minutes are rejected, and
//   every event id is stored once (payment_events unique key), so duplicate or
//   delayed deliveries never create a second payment.
// - Payments are only ever recorded here, server-side, with the service role.
//
// Expected body (map your provider's payload to this in `normalize` below):
//   { "id": "evt_123", "type": "payment.paid",
//     "data": { "booking_reference": "PB-20261009-0042", "amount": 650, "payment_id": "pay_abc" } }
//
// NOTE: no specific gateway (PayMongo, Xendit, Stripe, ...) is wired up. To go
// live, implement that provider's checkout + signature scheme here and enable
// the "gateway" payment method in Admin → Settings.
import { type Env, hmacHex, json, RpcError, safeEqual, serviceRpc } from '../_shared/db.ts';

const TOLERANCE_S = 300;

interface NormalizedEvent { id: string; type: string; bookingReference: string; amount: number; paymentId: string }

function normalize(body: any): NormalizedEvent | null {
  if (!body || typeof body.id !== 'string' || typeof body.type !== 'string') return null;
  const d = body.data ?? {};
  if (body.type === 'payment.paid' && (typeof d.booking_reference !== 'string' || typeof d.payment_id !== 'string' || !(Number(d.amount) > 0))) {
    return null;
  }
  return { id: body.id, type: body.type, bookingReference: d.booking_reference ?? '', amount: Number(d.amount ?? 0), paymentId: d.payment_id ?? '' };
}

export async function verifySignature(secret: string, header: string, raw: string, nowS = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t)) return false;
  if (Math.abs(nowS - t) > TOLERANCE_S) return false;
  return safeEqual(await hmacHex(secret, `${t}.${raw}`), parts.v1);
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const secret = env('PAYMENT_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Payment gateway is not configured.' }, 503);

  const raw = await req.text();
  if (raw.length > 64 * 1024) return json({ error: 'Payload too large' }, 413);
  const sig = req.headers.get('x-signature') ?? '';
  if (!(await verifySignature(secret, sig, raw))) return json({ error: 'Invalid signature' }, 401);

  let event: NormalizedEvent | null = null;
  try { event = normalize(JSON.parse(raw)); } catch { /* fallthrough */ }
  if (!event) return json({ error: 'Malformed event' }, 400);

  try {
    const result = await serviceRpc(env)('record_gateway_payment', {
      p_provider: env('PAYMENT_PROVIDER_NAME') ?? 'gateway',
      p_event_id: event.id,
      p_event_type: event.type,
      p_booking_reference: event.bookingReference,
      p_amount: event.amount,
      p_provider_payment_id: event.paymentId,
      p_payload: JSON.parse(raw),
    });
    return json({ received: true, result });
  } catch (e) {
    // Unknown booking or invalid amount: acknowledge (retrying will not help) but report it.
    if (e instanceof RpcError && (e.hint === 'NOT_FOUND' || e.hint === 'INVALID_AMOUNT')) {
      return json({ received: true, error: e.message }, 422);
    }
    // Anything else: 500 so the provider retries later (the event id dedupes it).
    return json({ error: 'Temporary failure, please retry.' }, 500);
  }
}
