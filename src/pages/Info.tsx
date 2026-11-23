import { Link } from 'react-router';
import { CheckCircle2, Clock, ExternalLink, Mail, MapPin } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { dayOfWeek, formatDateLong } from '@/lib/time';
import { defaultPrivacyText, defaultTermsText } from '@/lib/legal';
import { LegalText } from '@/components/layout/LegalText';
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

function Legal({ title, updated, text }: { title: string; updated: string | null; text: string }) {
  const { tz } = useFacility();
  return (
    <div className="container-page max-w-3xl py-10 sm:py-14">
      <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">{title}</h1>
      {updated && <p className="mt-2 text-sm text-slate-500">Last updated {formatDateLong(updated, tz)}</p>}
      <div className="mt-8 space-y-6 leading-relaxed text-ink-800 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        <LegalText text={text} />
      </div>
    </div>
  );
}

/** Admin-edited text (Settings > Legal pages), or the built-in default. */
export function TermsPage() {
  const { settings } = useFacility();
  return <Legal title="Terms & booking policy" updated={settings?.terms_content ? settings.terms_updated_at ?? null : null}
    text={settings?.terms_content || defaultTermsText(settings)} />;
}

export function PrivacyPage() {
  const { settings } = useFacility();
  return <Legal title="Privacy policy" updated={settings?.privacy_content ? settings.privacy_updated_at ?? null : null}
    text={settings?.privacy_content || defaultPrivacyText(settings)} />;
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
