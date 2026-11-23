// Notification worker: drains the `notifications` outbox and sends email via Gmail
// (GMAIL_USER + GMAIL_APP_PASSWORD) or Resend (RESEND_API_KEY + EMAIL_FROM).
//
// Triggered every minute by pg_cron + pg_net (see docs/DEPLOYMENT.md), or manually.
// Auth: `x-cron-secret: <CRON_SECRET>` or `Authorization: Bearer <service role key>`.
//
// Guarantees
// - A message is only marked `sent` when the provider returns 2xx.
// - Rows are claimed with SKIP LOCKED, so parallel runs never double-send, and
//   each send carries the outbox idempotency key as Resend's `Idempotency-Key`,
//   so a retry after a timeout cannot produce a second email.
// - Failures are retried with exponential backoff (max 5 attempts).
// - Stale messages (e.g. a reminder for a session that already started) are skipped.
import { type Env, json, safeEqual, serviceRpc } from '../_shared/db.ts';
import { type NotificationRow, render } from './templates.ts';

const STALE_MS = 3 * 24 * 3600 * 1000;

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const cronSecret = env('CRON_SECRET');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const givenSecret = req.headers.get('x-cron-secret') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const authorized = (cronSecret && givenSecret && safeEqual(givenSecret, cronSecret)) || (serviceKey && bearer && safeEqual(bearer, serviceKey));
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  const gmailUser = env('GMAIL_USER');
  const gmailPass = env('GMAIL_APP_PASSWORD');
  const useGmail = !!(gmailUser && gmailPass);
  const apiKey = env('RESEND_API_KEY');
  const from = env('EMAIL_FROM') ?? (useGmail ? `Nth Play <${gmailUser}>` : undefined);
  if (!useGmail && (!apiKey || !from)) {
    // Do not claim or mark anything: messages stay queued until email is configured.
    return json({ configured: false, message: 'Email is not configured (set GMAIL_USER and GMAIL_APP_PASSWORD, or RESEND_API_KEY and EMAIL_FROM). Notifications remain queued.' }, 503);
  }
  const apiBase = env('RESEND_API_BASE') ?? 'https://api.resend.com';
  const appUrl = env('APP_URL') ?? '';
  const rpc = serviceRpc(env);

  const reminders = await rpc<number>('enqueue_reminders');
  const batch = await rpc<NotificationRow[]>('claim_notifications', { p_limit: 25 });

  const result = { reminders_enqueued: reminders, claimed: batch.length, sent: 0, failed: 0, skipped: 0, errors: [] as string[] };
  const gmail = useGmail && batch.length
    ? (await import('./smtp.ts')).gmailSender({ user: gmailUser!, password: gmailPass!.replace(/\s+/g, ''), from: from! })
    : null;

  for (const n of batch) {
    try {
      const startsAt = n.payload?.start_at ? Date.parse(String(n.payload.start_at)) : NaN;
      const stale = Date.now() - Date.parse(n.created_at) > STALE_MS ||
        (n.notification_type === 'booking_reminder' && !Number.isNaN(startsAt) && startsAt < Date.now());
      if (stale) {
        await rpc('complete_notification', { p_id: n.id, p_success: false, p_error: 'Skipped: no longer relevant', p_skip: true });
        result.skipped++;
        continue;
      }

      const email = render(n, appUrl);
      if (gmail) {
        await gmail.send(n.recipient_email, email.subject, email.html, email.text);
        await rpc('complete_notification', { p_id: n.id, p_success: true, p_provider_message_id: `gmail:${n.idempotency_key}` });
        result.sent++;
        continue;
      }
      const res = await fetch(`${apiBase}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': n.idempotency_key },
        body: JSON.stringify({ from, to: [n.recipient_email], subject: email.subject, html: email.html, text: email.text }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.id) {
        await rpc('complete_notification', { p_id: n.id, p_success: true, p_provider_message_id: body.id });
        result.sent++;
      } else {
        const msg = `Provider ${res.status}: ${body?.message ?? body?.error ?? 'no message'}`;
        await rpc('complete_notification', { p_id: n.id, p_success: false, p_error: msg });
        result.failed++;
        result.errors.push(`${n.id}: ${msg}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await rpc('complete_notification', { p_id: n.id, p_success: false, p_error: msg }).catch(() => {});
      result.failed++;
      result.errors.push(`${n.id}: ${msg}`);
    }
  }
  await gmail?.close();

  // Phone/desktop push for in-app notifications (only once push keys are set).
  const vapidPublic = env('VAPID_PUBLIC_KEY');
  const vapidPrivate = env('VAPID_PRIVATE_KEY');
  if (vapidPublic && vapidPrivate) {
    const pushes = await rpc<import('./push.ts').PushItem[]>('claim_pushes', { p_limit: 50 });
    if (pushes.length) {
      const sender = (await import('./push.ts')).pushSender({ publicKey: vapidPublic, privateKey: vapidPrivate, subject: env('VAPID_SUBJECT') ?? 'mailto:admin@example.com' });
      let pushed = 0;
      for (const item of pushes) {
        const r = await sender.send(item).catch(() => ({ sent: 0, gone: [] as string[] }));
        pushed += r.sent;
        for (const endpoint of r.gone) await rpc('drop_push_subscription', { p_endpoint: endpoint }).catch(() => {});
      }
      Object.assign(result, { pushes: pushes.length, push_deliveries: pushed });
    }
  }

  // Once an hour: delete receipt images older than 45 days (keeps free-plan storage small).
  // Files go through the Storage API (direct SQL deletes are blocked); the payment rows
  // are kept and only lose their image link.
  if (new Date().getUTCMinutes() === 7 || new URL(req.url).searchParams.has('purge')) {
    try {
      const paths = await rpc<string[]>('receipts_to_purge', { p_days: 45, p_limit: 100 });
      if (paths.length) {
        const res = await fetch(`${env('SUPABASE_URL')}/storage/v1/object/payment-proofs`, {
          method: 'DELETE',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: paths }),
        });
        if (!res.ok) throw new Error(`Storage ${res.status}: ${await res.text()}`);
        const marked = await rpc<number>('mark_receipts_purged', { p_paths: paths });
        Object.assign(result, { receipts_deleted: paths.length, payments_updated: marked });
      }
    } catch (e) {
      result.errors.push(`receipt cleanup: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return json(result);
}
