# Troubleshooting

**"Supabase is not configured" banner**
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing. Create `.env` from `.env.example` and restart `npm run dev` (Vite reads env vars at start-up). On Vercel/Netlify, add them and redeploy.

**The live indicator stays on "Reconnecting…"**
Realtime can't connect. Check that the migrations ran (`select * from pg_publication_tables where pubname = 'supabase_realtime';` should list `slot_locks`, `bookings`, `payments`, `courts`), that Realtime is enabled for the project, and that no proxy/firewall blocks WebSockets. The calendar keeps working by polling every 10 seconds meanwhile.

**Availability doesn't update on another device**
Same checks as above. Also confirm both devices show the same date — subscriptions are per date.

**"permission denied for function …"**
A migration didn't finish. Re-run `supabase db push`. If you created functions manually, grant `execute` as in `20261009000700_security.sql`.

**"Sorry — that time was just reserved by someone else"**
Working as intended: another customer (or staff) took that time first. The calendar refreshes; pick another slot.

**A customer says a slot shows "Held"**
Someone is in checkout. The hold expires after the configured hold time (default 10 min) and the slot reappears automatically.

**Admin link doesn't appear after promoting myself**
Sign out and back in (the profile is loaded at sign-in). Verify with `select email, role from profiles where email = '…';`.

**Password-reset / confirmation emails don't arrive**
Those come from Supabase Auth, not Nth Play's email worker. Configure custom SMTP (Auth → SMTP) and check Auth → URL Configuration includes your domain in Redirect URLs. Supabase's built-in sender is heavily rate-limited.

**Booking emails stay "queued"**
The `send-notifications` function isn't configured or scheduled. See [SETUP §7](SETUP.md#7-email-notifications). Call it manually to see the reason:
`curl -X POST https://<ref>.supabase.co/functions/v1/send-notifications -H "x-cron-secret: <secret>"` — `503 not configured` means `RESEND_API_KEY`/`EMAIL_FROM` are missing.

**Emails show "failed"**
Open Admin → Settings → Email log for the provider's message (often an unverified sender domain). Fix it; failed messages retry automatically up to 5 times.

**Holds or unpaid bookings never expire**
`pg_cron` isn't running: `select * from cron.job;`. Availability still ignores expired holds, but statuses won't update. Enable pg_cron and re-run the platform migration, or run `select public.expire_stale_records();`.

**"Choose a date range of up to one year" / "That date is outside the booking window"**
Reports are limited to 366 days; customers can only browse up to *max days ahead* (+7) — staff up to a year.

**Times look wrong**
All times display in the facility time zone (Admin → Settings → Facility), not the device's zone. That's deliberate so players abroad see court-local times.

**Deleting a court fails**
Courts with booking history can't be deleted (to keep records). Deactivate it instead.

**Running the database tests**
`npm run test:db` needs a PostgreSQL 15+ server and `psql`. Set `PGHOST/PGPORT/PGUSER` (and `PGPASSWORD`) for your server; the script creates and drops a `nthplay_test` database.
