import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, CalendarDays, CalendarRange, CalendarX2, ChevronLeft, ChevronRight, Hand, Info, LogIn, X } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAuth } from '@/hooks/useAuth';
import { useLiveAvailability } from '@/hooks/useLiveAvailability';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { addDays, diffDays, formatCalendarDate, formatDateLong, formatDuration, formatTime, isValidDate } from '@/lib/time';
import { money } from '@/lib/format';
import { errorMessage, isAppError } from '@/lib/errors';
import { selectionRuns, selKey, toggleSlot, type SelSlot } from '@/lib/selection';
import type { AvailabilitySlot, Quote } from '@/lib/types';
import { cn } from '@/lib/utils';
import { DateStrip } from '@/components/booking/DateStrip';
import { Legend, SlotGrid, WeekGrid, isSelectable } from '@/components/booking/SlotGrid';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, Card, EmptyState, ErrorState, Skeleton, Tabs } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

type View = 'day' | 'week';

export default function BookPage() {
  const { settings, courts, tz, currency, today, loading: facilityLoading } = useFacility();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const maxDays = settings?.max_advance_days ?? 30;
  const rawDate = params.get('date') ?? '';
  const date = isValidDate(rawDate) && diffDays(rawDate, today) >= 0 && diffDays(rawDate, today) <= maxDays ? rawDate : today;
  const view: View = params.get('view') === 'week' ? 'week' : 'day';
  const courtFilter = params.get('court') ?? 'all';
  // The week grid shows one court at a time.
  const weekCourt = courts.find((c) => c.id === courtFilter) ?? courts[0];
  const dates = useMemo(() => {
    if (view === 'day') return [date];
    const last = addDays(today, maxDays);
    return Array.from({ length: 7 }, (_, i) => addDays(date, i)).filter((d) => d <= last);
  }, [view, date, today, maxDays]);

  const { slots, loading, error, justTaken, announcement, reload } =
    useLiveAvailability(dates, view === 'week' ? weekCourt?.id ?? null : courtFilter === 'all' ? null : courtFilter);

  const rules = useAsync(() => api.pricingRules(), []);
  const [sel, setSel] = useState<SelSlot[]>([]);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'info'; title: string; text: string } | null>(null);
  const [reserving, setReserving] = useState(false);
  const restored = useRef(false);

  const update = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
    setParams(next, { replace });
  };

  const slotMinutes = settings?.slot_minutes ?? 60;
  const runs = useMemo(() => selectionRuns(sel), [sel]);
  const runsKey = runs.map((r) => `${r.courtId}|${r.start}|${r.minutes}`).join(',');
  const maxMinutes = Math.max(...(weekCourt?.allowed_durations ?? [settings?.max_duration_minutes ?? 180]));
  const maxSlots = Math.max(1, Math.floor(maxMinutes / slotMinutes));
  const minMinutes = settings?.min_duration_minutes ?? slotMinutes;
  const selectedKeys = useMemo(() => new Set(sel.map(selKey)), [sel]);
  const isSelected = (s: AvailabilitySlot) => !!s.slot_start && selectedKeys.has(selKey({ court_id: s.court_id, start: s.slot_start }));

  // Restore a selection from the URL (e.g. after logging in to reserve).
  useEffect(() => {
    if (restored.current || loading || !slots.length) return;
    restored.current = true;
    const wanted = new Set((params.get('sel') ?? '').split('.').filter(Boolean).map((k) => k.replace('_', '|')));
    if (!wanted.size) return;
    const picked = slots.filter((s) => s.slot_start && isSelectable(s.status) && wanted.has(selKey({ court_id: s.court_id, start: s.slot_start })));
    setSel(picked.map((s) => ({ court_id: s.court_id, start: s.slot_start!, end: s.slot_end! })));
  }, [loading, slots, params]);

  // If someone else takes any selected slot, drop the selection and say so.
  useEffect(() => {
    if (!sel.length || loading) return;
    const lost = sel.find((x) => {
      const s = slots.find((y) => y.slot_start && selKey({ court_id: y.court_id, start: y.slot_start }) === selKey(x));
      return s && !isSelectable(s.status);
    });
    if (lost) {
      setNotice({ tone: 'warning', title: 'That time is no longer available',
        text: `${formatDateLong(lost.start, tz)} at ${formatTime(lost.start, tz)} was just reserved by someone else, so your selection was cleared. Please choose again.` });
      setSel([]);
    }
  }, [slots, sel, loading, tz]);

  const tooShort = runs.some((r) => r.minutes < minMinutes);
  const quoteState = useAsync<{ key: string; list: Quote[] }>(
    async () => ({ key: runsKey, list: await Promise.all(runs.map((r) => api.quote(r.courtId, r.start, r.minutes))) }),
    [runsKey],
    { enabled: runs.length > 0 && !tooShort },
  );
  // Only show prices that belong to the current selection (the previous result lingers while reloading).
  const quotes = { ...quoteState, data: quoteState.data?.key === runsKey ? quoteState.data.list : undefined };
  const total = quotes.data?.reduce((sum, q) => sum + Number(q.total), 0) ?? null;

  const onSelect = (s: AvailabilitySlot) => {
    const { next, notice: n } = toggleSlot(sel, s, slots, maxSlots);
    setSel(next);
    if (n?.kind === 'max') setNotice({ tone: 'info', title: 'Maximum booking length', text: `Each continuous block can be up to ${formatDuration(n.maxSlots * slotMinutes)}. Choose a separate time to add more.` });
    else setNotice(null);
  };

  const reserve = async () => {
    if (!runs.length) return;
    if (!user) {
      const back = `/book?${new URLSearchParams({ date, view, court: courtFilter, sel: sel.map((x) => selKey(x).replace('|', '_')).join('.') })}`;
      navigate(`/login?next=${encodeURIComponent(back)}&reason=book`);
      return;
    }
    setReserving(true);
    try {
      const holds = await api.createHolds(runs.map((r) => ({ courtId: r.courtId, start: r.start, duration: r.minutes })));
      navigate(`/checkout/${holds.map((h) => h.hold_id).join(',')}`);
    } catch (e) {
      const code = isAppError(e) ? e.code : '';
      toast.error(code === 'SLOT_TAKEN' ? 'Just missed it' : "Couldn't reserve that time", errorMessage(e));
      void reload();
    } finally {
      setReserving(false);
    }
  };

  const shownCourts = courtFilter === 'all' ? courts : courts.filter((c) => c.id === courtFilter);
  const allClosed = slots.length > 0 && slots.every((s) => s.status === 'closed');
  const noneLeft = slots.length > 0 && !allClosed && !slots.some((s) => isSelectable(s.status));
  const lastDate = addDays(today, maxDays);
  const hours = runs.reduce((m, r) => m + r.minutes, 0) / 60;
  const hoursLabel = runs.length ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'}` : '';
  const courtName = (id: string) => courts.find((c) => c.id === id)?.name ?? 'Court';

  return (
    <div className={cn('container-page py-8 sm:py-10', runs.length > 0 && 'pb-28 lg:pb-10')}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">Book a court</h1>
          <p className="mt-1 text-slate-600">Tap the time slots you want to play. Availability updates live.</p>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Tabs label="Availability view" value={view} onChange={(v) => update({ view: v === 'day' ? null : v })}
            items={[
              { value: 'day', label: <span className="flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden /> Day</span> },
              { value: 'week', label: <span className="flex items-center gap-1.5"><CalendarRange className="size-4" aria-hidden /> Week</span> },
            ]} />

          <Card className="p-4 sm:p-5">
            {view === 'day' ? (
              <DateStrip value={date} today={today} maxDays={maxDays} onChange={(d) => { setNotice(null); update({ date: d }); }} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="icon" aria-label="Previous week" disabled={date <= today}
                    onClick={() => update({ date: diffDays(addDays(date, -7), today) < 0 ? today : addDays(date, -7) })}><ChevronLeft /></Button>
                  <Button variant="outline" size="icon" aria-label="Next week" disabled={addDays(date, 7) > lastDate}
                    onClick={() => update({ date: addDays(date, 7) })}><ChevronRight /></Button>
                  <h2 className="ml-2 text-lg font-semibold text-ink-900" aria-live="polite">
                    {formatCalendarDate(dates[0], 'short')} – {formatCalendarDate(dates[dates.length - 1], 'short')}
                  </h2>
                </div>
                {date !== today && <Button variant="ghost" size="sm" onClick={() => update({ date: today })}>This week</Button>}
              </div>
            )}
          </Card>

          {courts.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Choose court">
              {[...(view === 'day' ? [{ id: 'all', name: 'All courts' }] : []), ...courts].map((c) => {
                const active = view === 'week' ? weekCourt?.id === c.id : courtFilter === c.id;
                return (
                  <button key={c.id} type="button" aria-pressed={active} onClick={() => update({ court: c.id === 'all' ? null : c.id })}
                    className={cn('rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                      active ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white text-ink-800 hover:border-slate-400')}>
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}

          {notice && (
            <Alert tone={notice.tone} title={notice.title}>
              <div className="flex items-start justify-between gap-3">
                <span>{notice.text}</span>
                <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X className="size-4" /></button>
              </div>
            </Alert>
          )}

          <Card className="p-3 sm:p-4">
            {error ? (
              <ErrorState message={error} onRetry={() => void reload()} />
            ) : (loading && !slots.length) || facilityLoading ? (
              <div className="grid grid-cols-3 gap-2 md:grid-cols-4">{Array.from({ length: 16 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : courts.length === 0 ? (
              <EmptyState icon={<CalendarX2 />} title="No courts are open for booking yet">Please check back soon.</EmptyState>
            ) : allClosed ? (
              <EmptyState icon={<CalendarX2 />} title={view === 'day' ? "We're closed on this day" : "We're closed this week"}
                action={<Button variant="outline" onClick={() => update({ date: addDays(date, view === 'day' ? 1 : 7) })}>Check the next {view}</Button>}>
                Choose another date to see open times.
              </EmptyState>
            ) : (
              <>
                {noneLeft && (
                  <Alert tone="info" className="mb-3" title="Fully booked">
                    No times left {view === 'day' ? 'on this day' : 'this week'}. Try another {view === 'day' ? 'date' : 'week'}.
                  </Alert>
                )}
                <p className="mb-3 flex items-center gap-2 text-sm text-slate-600">
                  <Hand className="size-4 shrink-0 text-brand-700" aria-hidden />
                  Tap every hour you want to play — they don't have to be next to each other. Tap a selected slot again to remove it.
                </p>
                {view === 'day' ? (
                  <SlotGrid courts={shownCourts} slots={slots} rules={rules.data ?? []} tz={tz} currency={currency} isSelected={isSelected}
                    justTaken={justTaken} onSelect={onSelect} />
                ) : weekCourt && (
                  <WeekGrid court={weekCourt} dates={dates} slots={slots} tz={tz} currency={currency} isSelected={isSelected}
                    justTaken={justTaken} onSelect={onSelect} today={today} />
                )}
              </>
            )}
          </Card>
          <Legend />
        </div>

        {/* Selection panel */}
        <aside id="selection" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start" aria-label="Your selection">
          <Card className="p-5">
            {!runs.length ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-brand-50 text-brand-700"><Info className="size-6" /></div>
                <p className="font-semibold text-ink-900">Tap the time slots you want</p>
                <p className="mt-1 text-sm text-slate-600">
                  Each slot is one hour. Pick as many <span className="font-semibold text-brand-700">available</span> slots as you like, even at different times. You'll see the total before you confirm.
                </p>
                {settings && (
                  <p className="mt-4 text-xs text-slate-500">
                    Book up to {settings.max_advance_days} days ahead
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Your selection</p>
                    <h2 className="mt-1 text-xl font-bold" data-testid="selection-hours">{hoursLabel}</h2>
                    <p className="text-sm text-slate-600">{runs.length} time block{runs.length === 1 ? '' : 's'}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setSel([]); setNotice(null); }}>Clear</Button>
                </div>

                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                  {runs.map((r, i) => (
                    <li key={`${r.courtId}|${r.start}`} className="flex items-start justify-between gap-3 px-4 py-3">
                      <span>
                        <span className="block font-semibold text-ink-900 tabular-nums">{formatTime(r.start, tz)} – {formatTime(r.end, tz)}</span>
                        <span className="block text-xs text-slate-500">
                          {formatDateLong(r.start, tz)}{courts.length > 1 && ` · ${courtName(r.courtId)}`}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums">
                        {quotes.data?.[i] ? money(Number(quotes.data[i].total), currency) : quotes.loading ? '…' : ''}
                      </span>
                    </li>
                  ))}
                </ul>

                {tooShort ? (
                  <Alert tone="info">The minimum booking is {formatDuration(minMinutes)}. Add a slot next to the shorter block.</Alert>
                ) : total != null && (
                  <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
                    <span className="font-semibold">Total</span>
                    <span className="text-2xl font-bold tabular-nums">{money(total, currency)}</span>
                  </div>
                )}
                {quotes.error && <Alert tone="error">{quotes.error}</Alert>}

                <Button size="lg" className="w-full" onClick={reserve} loading={reserving} disabled={tooShort || !quotes.data}>
                  {user ? <>Reserve {hoursLabel} <ArrowRight /></> : <><LogIn /> Log in to reserve</>}
                </Button>
                <p className="text-center text-xs text-slate-500">
                  We'll hold these slots for {settings?.hold_minutes ?? 10} minutes while you pay.
                </p>
              </div>
            )}
          </Card>
          {!user && (
            <p className="mt-3 text-center text-sm text-slate-600">
              New here? <Link className={buttonVariants({ variant: 'link' })} to="/register">Create an account</Link>
            </p>
          )}
        </aside>
      </div>

      {/* Phones: the selection panel sits below the grid, so surface the next step. */}
      {runs.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 shadow-lift backdrop-blur lg:hidden">
          <div className="container-page flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold">
              {hoursLabel} · {runs.length === 1 ? `${formatTime(runs[0].start, tz)}–${formatTime(runs[0].end, tz)}` : `${runs.length} blocks`}
              {total != null && <span className="font-normal text-slate-600"> · {money(total, currency)}</span>}
            </p>
            <Button size="sm" onClick={() => document.getElementById('selection')?.scrollIntoView({ behavior: 'smooth' })}>Review <ArrowRight /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

