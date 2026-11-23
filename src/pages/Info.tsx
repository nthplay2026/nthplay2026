import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Clock, ExternalLink, Mail, MapPin } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { dayOfWeek, formatDuration } from '@/lib/time';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { HoursTable } from '@/components/booking/HoursTable';
import { FacebookButton, FacebookIcon, InstagramButton, InstagramIcon, PhoneButton } from '@/components/layout/ContactButtons';
import { FACEBOOK_NAME, FACEBOOK_URL, INSTAGRAM_HANDLE, INSTAGRAM_URL } from '@/lib/contact';

export function ContactPage() {
  const { settings, today } = useFacility();
  const mapQuery = settings?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}` : null;
  return (
    <div className="container-page py-10 sm:py-14">
      <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">Contact &amp; location</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Questions about a booking, private events or coaching? Get in touch.</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="text-xl font-bold">{settings?.facility_name}</h2>
          <ul className="mt-5 space-y-4 text-ink-800">
            {settings?.address && <li className="flex gap-3"><MapPin className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden /><a className="hover:underline" href={settings.map_url || mapQuery!} target="_blank" rel="noreferrer">{settings.address}</a></li>}
            <li className="flex gap-3"><FacebookIcon className="mt-0.5 size-5 shrink-0 text-brand-700" /><span>Facebook page: <a className="font-medium hover:underline" href={FACEBOOK_URL} target="_blank" rel="noreferrer">{FACEBOOK_NAME}</a></span></li>
            <li className="flex gap-3"><InstagramIcon className="mt-0.5 size-5 shrink-0 text-brand-700" /><span>Instagram: <a className="font-medium hover:underline" href={INSTAGRAM_URL} target="_blank" rel="noreferrer">{INSTAGRAM_HANDLE}</a></span></li>
            {settings?.contact_email && <li className="flex gap-3"><Mail className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden /><a className="hover:underline" href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a></li>}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            {(settings?.map_url || mapQuery) && (
              <a href={settings?.map_url || mapQuery!} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
                <MapPin /> Get directions <ExternalLink />
              </a>
            )}
            <Link to="/book" className={buttonVariants()}>Book Now</Link>
            <FacebookButton />
            <InstagramButton />
            {settings?.contact_phone && <PhoneButton phone={settings.contact_phone} />}
          </div>
          {settings?.amenities && settings.amenities.length > 0 && (
            <>
              <h3 className="mt-8 font-semibold">Everything you need on game day</h3>
              <ul className="mt-3 grid gap-2.5 text-sm text-ink-800 sm:grid-cols-2">
                {settings.amenities.map((a) => <li key={a} className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />{a}</li>)}
              </ul>
            </>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold"><Clock className="size-5 text-brand-700" aria-hidden /> Operating hours</h2>
          <div className="mt-4"><HoursTable todayDow={dayOfWeek(today)} /></div>
          <p className="mt-4 text-xs text-slate-500">Any closures are announced here and in the booking calendar, which always shows the latest schedule.</p>
        </Card>
      </div>
    </div>
  );
}

function Legal({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="container-page max-w-3xl py-10 sm:py-14">
      <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated {updated}</p>
      <div className="mt-8 space-y-6 leading-relaxed text-ink-800 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">{children}</div>
    </div>
  );
}

export function TermsPage() {
  const { settings } = useFacility();
  const s = settings;
  const name = s?.facility_name ?? 'the facility';
  return (
    <Legal title="Terms & booking policy" updated="October 2026">
      <p>These terms apply to every court reservation made with {name}. By booking you agree to them. The facility owner should review this text and adapt it to local law before going live.</p>
      <h2>Reservations</h2>
      <ul>
        <li>Bookings can be made up to {s?.max_advance_days ?? 30} days in advance and at least {s ? formatDuration(s.min_advance_minutes) : '1 hour'} before the start time.</li>
        <li>Sessions run from {s ? formatDuration(s.min_duration_minutes) : '1 hour'} to {s ? formatDuration(s.max_duration_minutes) : '3 hours'}.</li>
        <li>When you select a time we hold it for {s?.hold_minutes ?? 10} minutes while you check out. Unconfirmed holds are released automatically.</li>
        <li>A booking is only valid once you receive a booking reference on screen and by email.</li>
      </ul>
      <h2>Payment</h2>
      <ul>
        {s?.booking_confirmation_mode === 'after_payment'
          ? <li>Reservations stay pending until payment is verified and must be paid within {s.payment_due_hours} hours (or before the session starts, whichever is sooner). Unpaid reservations are released.</li>
          : <li>Reservations are confirmed immediately. Payment is due before your session starts.</li>}
        <li>GCash payments are marked paid only after our staff check your receipt against our records.</li>
        <li>Prices shown at checkout are final for that booking; later price changes do not affect existing bookings.</li>
      </ul>
      <h2>Changes and cancellations</h2>
      <ul>
        <li>Bookings can't be cancelled or moved online. Payments aren't refunded for change of plans.</li>
        <li>To reschedule, contact the facility. We'll move your booking to another available time, and the price is recalculated for the new time.</li>
        <li>If we have to close the court (for example for safety, maintenance or weather), we'll offer you a new time or a full refund.</li>
      </ul>
      <h2>On court</h2>
      <ul>
        <li>Arriving 10 minutes before your scheduled booking is recommended to ensure you make the most of your time. Please note that late arrivals will not be given an extension beyond the booked end time.</li>
        <li>Non-marking court shoes are required. Players use the facility at their own risk.</li>
      </ul>
    </Legal>
  );
}

export function PrivacyPage() {
  const { settings } = useFacility();
  return (
    <Legal title="Privacy policy" updated="October 2026">
      <p>{settings?.facility_name ?? 'We'} collect only what we need to run your bookings. The facility owner should review this policy against applicable data-protection law (for example, the Philippine Data Privacy Act of 2012) before going live.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email address, mobile number and a securely hashed password.</li>
        <li>Booking details: court, date and time, notes, price and status.</li>
        <li>Payment details you submit: method, amount and a photo of your receipt. We never collect or store card numbers.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To reserve courts, send confirmations, reminders and changes, and verify payments.</li>
        <li>To keep an audit trail of changes to bookings and payments, and to prevent abuse.</li>
        <li>To produce aggregated reports (for example, how busy each court is).</li>
      </ul>
      <h2>Who can see it</h2>
      <ul>
        <li>Only you and authorised facility staff can see your bookings. Other customers only see whether a time is free.</li>
        <li>We use service providers for hosting (Supabase) and email delivery; they process data on our behalf.</li>
      </ul>
      <h2>Your choices</h2>
      <ul>
        <li>You can update your name and mobile number in your account at any time.</li>
        <li>To access or delete your data, contact us{settings?.contact_email ? ` at ${settings.contact_email}` : ''}. Booking and payment records may be kept as required for accounting.</li>
      </ul>
    </Legal>
  );
}

export function NotFoundPage() {
  return (
    <div className="container-page py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">404</p>
      <h1 className="mt-2 text-3xl font-bold">Out of bounds</h1>
      <p className="mt-2 text-slate-600">We couldn't find that page.</p>
      <Link to="/" className={buttonVariants({ className: 'mt-6' })}>Back to home</Link>
    </div>
  );
}
