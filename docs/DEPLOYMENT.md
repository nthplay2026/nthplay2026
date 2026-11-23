# Deployment

The frontend is a static single-page app; everything server-side lives in Supabase.

## Vercel

1. Import the repository in Vercel. `vercel.json` already sets the build command, output folder, SPA rewrites and security headers.
2. **Settings → Environment Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Production and Preview).
3. Deploy. Add your custom domain.
4. In Supabase **Auth → URL Configuration**, set the Site URL to the production domain and add `https://<domain>/**` to Redirect URLs (plus your preview domain pattern if you use previews).

## Netlify

1. New site from Git. `netlify.toml` sets the build, SPA redirect and headers.
2. **Site configuration → Environment variables**: add the two `VITE_` variables.
3. Deploy, then update Supabase Auth URLs as above.

## Any static host

`npm run build` produces `dist/`. Serve it with a fallback that returns `index.html` for unknown paths (needed for deep links such as `/my-bookings/PB-…`).

## Production checklist

- [ ] `supabase db push` applied all migrations to the production project (no seed data unless intended)
- [ ] First administrator created ([SETUP §5](SETUP.md#5-create-the-first-administrator)); test accounts removed
- [ ] Facility details, courts, prices, hours, holidays and payment instructions entered in the admin
- [ ] Auth: Site URL + Redirect URLs set; **Confirm email** on; custom SMTP configured
- [ ] Email: `send-notifications` deployed, secrets set, cron scheduled; a test booking shows *sent* in the Email log
- [ ] `pg_cron` jobs present: `select jobname, schedule from cron.job;`
- [ ] Realtime: open the booking page on two devices, book on one, and watch the other update
- [ ] Terms and Privacy pages reviewed by the owner (they are templates)
- [ ] Database backups / Point-in-Time Recovery enabled on your Supabase plan

## Updating

1. Add a new migration file in `supabase/migrations/` (never edit applied ones in production).
2. `npm run test:db` locally, then `supabase db push`.
3. Redeploy functions if they changed: `supabase functions deploy <name> --no-verify-jwt`.
4. Push the frontend; the host rebuilds automatically.

## Maintenance

- **Expired holds / unpaid bookings** are cleaned every minute by `nthplay-expire-stale`. To run it manually: `select public.expire_stale_records();`
- **Inactive lock rows** older than 30 days are purged by the same job.
- **Email failures**: check Admin → Settings → Email log. Rows that failed 5 times stop retrying; fix the cause, then `update notifications set attempts = 0, next_attempt_at = now(), delivery_status = 'queued' where delivery_status = 'failed';`
- **Audit log** grows over time; archive old rows yearly if needed.
