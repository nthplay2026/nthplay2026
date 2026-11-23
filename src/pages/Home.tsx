import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/misc';
import { CourtImage } from '@/components/booking/CourtVisual';
import { CourtGallery } from '@/components/booking/CourtGallery';
import { RateList, rateRows } from '@/components/booking/RateList';
import { InstallBanner } from '@/components/layout/InstallApp';

export default function HomePage() {
  const { settings, courts, currency, loading } = useFacility();
  const rules = useAsync(() => api.pricingRules(), []);
  const single = courts.length === 1 ? courts[0] : null;

  return (
    <>
      <InstallBanner />
      {/* Hero */}
      <section className="relative overflow-hidden bg-ink-900 text-white">
        <div className="court-lines absolute inset-0" aria-hidden />
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-ball/20 blur-3xl" aria-hidden />
        <div className="absolute -bottom-32 -left-20 size-96 rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
        <div className="container-page relative grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <h1 className="text-4xl leading-[1.05] font-extrabold sm:text-5xl lg:text-6xl">
              {settings?.tagline || 'Your Court. Your Time. Your Game.'}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
              {settings?.description || 'Book a pickleball court in seconds and see real-time availability.'}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/book" className={buttonVariants({ variant: 'accent', size: 'xl' })}>
                Book Now <ArrowRight />
              </Link>
              <Link to="/contact" className={buttonVariants({ variant: 'outline-light', size: 'xl' })}>
                Hours &amp; location
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">
              <li className="flex items-center gap-2"><Check className="size-4 text-ball" aria-hidden />Instant confirmation</li>
              <li className="flex items-center gap-2"><Check className="size-4 text-ball" aria-hidden />No double bookings</li>
            </ul>
            {rateRows(rules.data ?? [], courts[0]?.id).length > 0 && (
              <div className="mt-6 max-w-md">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Court rates</p>
                <RateList dark className="mt-2" rules={rules.data ?? []} courtId={courts[0]?.id} currency={currency} baseRate={courts[0]?.base_hourly_rate ?? 0} />
              </div>
            )}
          </div>
          <div className="relative hidden justify-self-center lg:block">
            <div className="h-[560px] max-h-[70vh] aspect-[9/16] overflow-hidden rounded-[2rem] shadow-2xl ring-4 ring-white/10">
              <CourtImage src={courts[0]?.image_url ?? null} type={courts[0]?.court_type ?? 'outdoor'} name={courts[0]?.name ?? 'Court'} />
            </div>
            <div className="absolute -bottom-5 -left-8 rounded-2xl bg-white px-4 py-3 text-ink-900 shadow-lift">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operating hours</p>
              <p className="text-xl font-extrabold">6 AM – 10 PM daily</p>
            </div>
          </div>
        </div>
      </section>

      {/* Intro + court(s) */}
      {single ? (
        <section className="container-page py-16 sm:py-20" aria-labelledby="courts-heading">
          {/* Uploaded court photos (Admin > Courts > Photos); nothing is shown when there are none. */}
          <CourtGallery photos={single.photos ?? []} name={single.name} className="mb-10" />
          <div className="grid max-w-3xl items-start gap-8">
            {/* On large screens the illustration is in the hero; on phones show it here, unless there are photos. */}
            {!(single.photos?.length) && (
              <div className="mx-auto aspect-[9/16] w-full max-w-xs overflow-hidden rounded-3xl shadow-lift lg:hidden">
                <CourtImage src={single.image_url} type={single.court_type} name={single.name} />
              </div>
            )}
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">Our court</p>
              <h2 id="courts-heading" className="mt-1 text-3xl font-bold text-ink-900 sm:text-4xl">{single.name}</h2>
              {!single.name.toLowerCase().includes(single.court_type) && <p className="mt-1 text-sm capitalize text-slate-500">{single.court_type} court</p>}
              <p className="mt-4 leading-relaxed text-ink-800">{single.description}</p>
              {single.features.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2">{single.features.map((f) => <li key={f} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{f}</li>)}</ul>
              )}
              {(settings?.amenities ?? []).length > 0 && (
                <>
                  <h3 className="mt-6 font-semibold text-ink-900">Everything you need on game day</h3>
                  <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                    {settings!.amenities.map((a) => <li key={a} className="flex gap-2 text-sm text-ink-800"><Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />{a}</li>)}
                  </ul>
                </>
              )}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link to={`/book?court=${single.id}`} className={buttonVariants({ size: 'lg' })}>Book Now <ArrowRight /></Link>
                <Link to={`/courts/${single.id}`} className={buttonVariants({ size: 'lg', variant: 'outline' })}>Court details</Link>
              </div>
            </div>
          </div>
        </section>
      ) : (
      <section className="container-page py-16 sm:py-20" aria-labelledby="courts-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">Our courts</p>
            <h2 id="courts-heading" className="mt-1 text-3xl font-bold text-ink-900 sm:text-4xl">Pick your court</h2>
          </div>
          <Link to="/book" className={buttonVariants({ variant: 'outline' })}>See all availability</Link>
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-80" />) : courts.map((c) => (
            <Card key={c.id} className="group overflow-hidden">
              <Link to={`/courts/${c.id}`} className="block aspect-[5/3] overflow-hidden bg-slate-100" tabIndex={-1} aria-hidden>
                <CourtImage src={c.photos?.[0]?.url ?? c.image_url} type={c.court_type} name={c.name} className="transition-transform duration-500 group-hover:scale-105" />
              </Link>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold"><Link to={`/courts/${c.id}`} className="hover:underline">{c.name}</Link></h3>
                    <p className="text-sm capitalize text-slate-500">{c.court_type}</p>
                  </div>
                  <p className="text-right"><span className="text-lg font-bold">{money(c.base_hourly_rate, currency)}</span><span className="block text-xs text-slate-500">per hour</span></p>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-slate-600">{c.description}</p>
                {c.features.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5">{c.features.slice(0, 3).map((f) => <li key={f} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{f}</li>)}</ul>
                )}
                <Link to={`/book?court=${c.id}`} className={buttonVariants({ className: 'mt-5 w-full' })}>Book {c.name}</Link>
              </div>
            </Card>
          ))}
        </div>
      </section>
      )}

      <section className="container-page">
        <div className="relative overflow-hidden rounded-3xl bg-brand-700 px-6 py-12 text-center text-white sm:px-12">
          <div className="court-lines absolute inset-0 opacity-60" aria-hidden />
          <h2 className="relative text-3xl font-bold sm:text-4xl">Ready to play?</h2>
          <p className="relative mx-auto mt-2 max-w-lg text-brand-50">See which courts are open right now and lock in your time.</p>
          <Link to="/book" className={buttonVariants({ variant: 'accent', size: 'xl', className: 'relative mt-6' })}>Book Now <ArrowRight /></Link>
        </div>
      </section>
    </>
  );
}
