import { Link, useParams } from 'react-router';
import { ArrowLeft, Check } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { useLiveAvailability } from '@/hooks/useLiveAvailability';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { dayOfWeek, formatTimeShort } from '@/lib/time';
import { buttonVariants } from '@/components/ui/button';
import { Card, EmptyState, PageLoader, Skeleton } from '@/components/ui/misc';
import { CourtImage } from '@/components/booking/CourtVisual';
import { HoursTable } from '@/components/booking/HoursTable';
import { RateList, lowestRate } from '@/components/booking/RateList';
import { isVideoUrl } from '@/components/booking/CourtVisual';
import { CourtGallery } from '@/components/booking/CourtGallery';

export default function CourtDetailsPage() {
  const { id = '' } = useParams();
  const { settings, tz, currency, today } = useFacility();
  const court = useAsync(() => api.court(id), [id]);
  const rules = useAsync(() => api.pricingRules(id), [id]);
  const live = useLiveAvailability(court.data?.is_active ? today : null, id);

  if (court.loading) return <PageLoader />;
  const c = court.data;
  if (!c || !c.is_active) {
    return (
      <div className="container-page py-16">
        <EmptyState title="Court not available" action={<Link className={buttonVariants()} to="/book">See other courts</Link>}>
          This court doesn't exist or isn't taking bookings right now.
        </EmptyState>
      </div>
    );
  }
  const openToday = live.slots.filter((s) => s.status === 'available');

  return (
    <div className="container-page py-8 sm:py-10">
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-ink-900"><ArrowLeft className="size-4" /> All courts</Link>
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div>
          {c.photos?.length ? <CourtGallery photos={c.photos} name={c.name} /> : (
          <div className={isVideoUrl(c.image_url)
            ? 'mx-auto aspect-[9/16] w-full max-w-sm overflow-hidden rounded-3xl bg-slate-100 shadow-card'
            : 'aspect-[5/3] overflow-hidden rounded-3xl bg-slate-100 shadow-card'}>
            <CourtImage src={c.image_url} type={c.court_type} name={c.name} />
          </div>
          )}
          <h1 className="mt-6 text-3xl font-bold text-ink-900 sm:text-4xl">{c.name}</h1>
          {!c.name.toLowerCase().includes(c.court_type) && <p className="mt-1 capitalize text-slate-500">{c.court_type} court</p>}
          <p className="mt-4 leading-relaxed text-ink-800">{c.description}</p>
          {c.features.length > 0 && (
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {c.features.map((f) => <li key={f} className="flex items-center gap-2 text-sm"><Check className="size-4 text-brand-600" aria-hidden />{f}</li>)}
            </ul>
          )}
          {(settings?.amenities ?? []).length > 0 && (
            <>
              <h2 className="mt-8 font-semibold text-ink-900">Everything you need on game day</h2>
              <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {settings!.amenities.map((a) => <li key={a} className="flex gap-2 text-sm text-ink-800"><Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />{a}</li>)}
              </ul>
            </>
          )}
        </div>
        <div className="space-y-5">
          <Card className="p-6">
            <p className="text-sm text-slate-600">From</p>
            <p className="text-3xl font-bold">{money(lowestRate(rules.data ?? [], c.base_hourly_rate, c.id), currency)}<span className="text-base font-medium text-slate-500"> / hour</span></p>
            <RateList className="mt-4" rules={rules.data ?? []} courtId={c.id} currency={currency} baseRate={c.base_hourly_rate} />
            <Link to={`/book?court=${c.id}`} className={buttonVariants({ size: 'lg', className: 'mt-5 w-full' })}>Book Now</Link>
          </Card>
          <Card className="p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Open today</h2>
            </div>
            {live.loading ? <Skeleton className="mt-3 h-16" /> : openToday.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No more open times today.</p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {openToday.slice(0, 12).map((s) => (
                  <li key={s.slot_start}>
                    <Link to={`/book?date=${today}&court=${c.id}&sc=${c.id}&start=${encodeURIComponent(s.slot_start!)}`}
                      className="inline-block rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-sm font-semibold text-brand-800 hover:border-brand-500">
                      {formatTimeShort(s.slot_start!, tz)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-6"><h2 className="mb-3 font-semibold">Operating hours</h2><HoursTable courtId={c.id} todayDow={dayOfWeek(today)} /></Card>
        </div>
      </div>
    </div>
  );
}
