# Setting up Supabase

This takes about 20 minutes. You need the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase` or `brew install supabase/tap/supabase`).

## 1. Create the project

1. In the [Supabase dashboard](https://supabase.com/dashboard) create a project. Pick the region closest to your players (e.g. **Southeast Asia (Singapore)** for the Philippines) and save the database password.
2. Link this repository to it:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

## 2. Apply the database migrations

```bash
supabase db push
```

This creates every table, constraint, function, Row Level Security policy, the Realtime publication, the private `payment-proofs` storage bucket and two `pg_cron` jobs:

| Job | Schedule | Purpose |
|---|---|---|
| `nthplay-expire-stale` | every minute | expires abandoned checkout holds, releases unpaid pending bookings after their due time, marks finished sessions completed |
| `nthplay-reminders` | every 15 min | queues reminder emails |

> If `pg_cron` isn't enabled, enable it under **Database → Extensions** and run `supabase db push` again (the migration is safe to re-run). Even without the job, expired holds never block anyone: availability and booking checks ignore them.

**Sample data (optional, for testing):** paste `supabase/seed.sql` into **SQL Editor** and run it (or `psql "<connection string>" -f supabase/seed.sql`). It adds three courts, peak/weekend prices and facility details — all editable in the admin dashboard. Don't load it in production if you'll enter your own courts.

## 3. Configure Auth

**Authentication → URL Configuration**
- *Site URL*: your app's URL, e.g. `https://book.yourclub.com`
- *Redirect URLs*: add `https://book.yourclub.com/**` (and `http://localhost:5173/**` for development)

**Authentication → Providers → Email**
- Keep Email enabled. Turn **Confirm email** on for production.

**Authentication → SMTP** (recommended for production): connect your email provider so confirmation and password-reset emails are delivered reliably.

**Authentication → Sessions** (optional): adjust session length / inactivity timeout to your policy.

## 4. Environment variables (frontend)

**Project Settings → API**: copy the *Project URL* and the *anon public* key into `.env`:

```env
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

The anon key is meant to be public — it only grants what Row Level Security allows. **Never** put the `service_role` key in the frontend or in any `VITE_` variable.

## 5. Create the first administrator

Roles can't be granted from the app by a non-admin, and sign-up metadata is ignored, so the first admin is created once with SQL:

1. Open the app and sign up with the email you want to use.
2. In **SQL Editor** run:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@yourclub.com';
   ```

3. Sign out and back in — the **Admin** link appears in the header.

From then on, add staff and admins in **Admin → Staff & Permissions** (the person signs up first, then you promote them). The last administrator can't be demoted.

| Role | Can do |
|---|---|
| customer | book, pay, cancel/reschedule own bookings within policy |
| staff | live schedule, bookings (create/edit/cancel with reason/reschedule/status), walk-ins, blocks, record cash, customers |
| admin | everything staff can, plus courts, pricing & rules, hours, settings, reports & revenue, payment verification & refunds, roles, audit log |

## 6. Make it yours (no code needed)

In the admin dashboard:
- **Settings → Facility**: name, headline, introduction, contact details, address, map link, amenities, admin alert email, time zone (default Asia/Manila), currency (default PHP).
- **Courts**: add/edit courts, photos (image URL), standard rate, allowed booking lengths, per-court notice/horizon.
- **Pricing & Rules**: peak/off-peak/weekend rates; slot length (default 60 min), start-time interval, min/max duration, buffer, minimum notice, max days ahead, same-day cutoff, hold length (default 10 min), cancellation and reschedule deadlines, confirm-immediately vs pay-first.
- **Operating Hours**: weekly hours, per-court hours, holidays/special days.
- **Settings → Payment methods**: enable cash / GCash / bank transfer and write the instructions customers see.

## 7. Email notifications

Bookings, cancellations, reschedules, payment results, reminders and admin alerts are written to a `notifications` outbox inside the same database transaction as the change. The `send-notifications` Edge Function delivers them through [Resend](https://resend.com).

1. Create a Resend account, verify your sending domain and create an API key.
2. Deploy the function and set its secrets:

   ```bash
   supabase functions deploy send-notifications --no-verify-jwt
   supabase secrets set RESEND_API_KEY=re_xxx \
     EMAIL_FROM="Nth Play <bookings@yourclub.com>" \
     APP_URL=https://book.yourclub.com \
     CRON_SECRET=$(openssl rand -hex 32)
   ```

3. Schedule it every minute. Enable the **pg_net** extension (Database → Extensions), then in the SQL editor (store the URL and secret in Vault, not in plain SQL):

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-notifications', 'nthplay_notify_url');
   select vault.create_secret('<the CRON_SECRET value you set above>', 'nthplay_cron_secret');

   select cron.schedule('nthplay-send-notifications', '* * * * *', $$
     select net.http_post(
       url     := (select decrypted_secret from vault.decrypted_secrets where name = 'nthplay_notify_url'),
       headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nthplay_cron_secret')),
       body    := '{}'::jsonb)
   $$);
   ```

4. Check **Admin → Settings → Email log**: messages move from *queued* to *sent*.

Guarantees: a message is marked *sent* only when Resend returns success; failures retry with exponential backoff (up to 5 attempts) and show the error in the log; each send carries the outbox idempotency key so retries never produce duplicates; stale messages (e.g. a reminder for a session that already started) are skipped. Without credentials the function returns `503 not configured` and leaves everything queued.

## 8. Payments

**Built in (no provider needed):**
- *Cash at the facility* — staff record it from the booking (**Record cash**).
- *GCash* and *bank transfer* — the customer pays outside the app, then submits the reference number (and optionally a receipt image) from **My Bookings**. It stays **pending** until an **admin** verifies or rejects it in **Admin → Payments**. Customers can never mark anything as paid.
- *Pay-first mode* (Pricing & Rules → Confirmation mode): bookings stay pending until fully paid and are released automatically after the due time.

**Online gateway (optional):** `supabase/functions/payment-webhook` is a provider-neutral, signature-verified, idempotent webhook that records payments server-side. To go live with a provider:
1. Implement that provider's checkout (create a payment for a booking reference) — e.g. a small Edge Function the checkout page calls.
2. Adapt `verifySignature()` and `normalize()` in `payment-webhook/handler.ts` to the provider's signature header and event payload.
3. `supabase functions deploy payment-webhook --no-verify-jwt` and `supabase secrets set PAYMENT_WEBHOOK_SECRET=… PAYMENT_PROVIDER_NAME=paymongo`.
4. Register `https://<ref>.supabase.co/functions/v1/payment-webhook` in the provider dashboard, then enable **Online payment** in Settings → Payment methods.

Card numbers and gateway secret keys never touch the frontend or the database.

## 9. Run the app

```bash
npm install
npm run dev
```

See [DEPLOYMENT.md](DEPLOYMENT.md) to put it online.
