import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, Wrench } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { useLiveAvailability } from '@/hooks/useLiveAvailability';
import { api } from '@/lib/api';
import { addDays, formatTime, formatTimeShort, isValidDate, localMinutes, zonedTimeToUtc } from '@/lib/time';
import { bookingStatusLabel } from '@/lib/format';
import type { AvailabilitySlot, Booking, BookingStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AdminPage } from '@/components/admin/AdminPage';
import { BookingPanel } from '@/components/admin/BookingPanel';
import { NewBookingDialog } from '@/components/admin/NewBookingDialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Card, ErrorState, Skeleton } from '@/components/ui/misc';
import { DateStrip } from '@/components/booking/DateStrip';
import { LiveIndicator } from '@/components/booking/LiveIndicator';

const PX_PER_MIN = 1.1;
const statusCls: Record<BookingStatus, string> = {
  confirmed: 'bg-brand-600 text-white border-brand-700',
  pending: 'bg-amber-100 text-amber-900 border-amber-300 border-dashed',
  completed: 'bg-sky-100 text-sky-900 border-sky-300',
  no_show: 'bg-violet-100 text-violet-900 border-violet-300',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function Schedule() {
  const { courts, tz, today } = useFacility();
  const [params, setParams] = useSearchParams();
  const date = isValidDate(params.get('date') ?? '') ? params.get('date')! : today;
  const [courtFilter, setCourtFilter] = useState('all');
  // The date bar sticks to the top; once scrolled it shrinks to one slim row.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const onScroll = () => setCompact((c) => (c ? window.scrollY > 120 : window.scrollY > 220));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const [statusFilter, setStatusFilter] = useState<'live' | 'all' | BookingStatus>('live');
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState<{ courtId?: string; start?: string } | null>(null);

  // Slot grid (holds, blocks, open/closed) is live; bookings refetch on every change.
  const live = useLiveAvailability(date, null, { extraTables: ['bookings'] });
  const dayStart = zonedTimeToUtc(date, '00:00', tz).toISOString();
  const dayEnd = zonedTimeToUtc(addDays(date, 1), '00:00', tz).toISOString();
  const bookings = useAsync(() => api.bookingsBetween(dayStart, dayEnd), [dayStart, dayEnd, live.lastUpdated]);
  const blocks = useAsync(() => api.blockedSlots(dayStart, dayEnd), [dayStart, dayEnd, live.lastUpdated]);

  const shown = courts.filter((c) => courtFilter === 'all' || c.id === courtFilter);
  const slotsByCourt = useMemo(() => {
    const m = new Map<string, AvailabilitySlot[]>();
    for (const s of live.slots) m.set(s.court_id, [...(m.get(s.court_id) ?? []), s]);
    return m;
  }, [live.slots]);
  const times = live.slots.filter((s) => s.slot_start).map((s) => localMinutes(s.slot_start!, tz));
  const ends = live.slots.filter((s) => s.slot_end).map((s) => localMinutes(s.slot_end!, tz) || 1440);
  const dayOpen = times.length ? Math.min(...times) : 6 * 60;
  const dayClose = ends.length ? Math.max(...ends) : 22 * 60;
  const height = (dayClose - dayOpen) * PX_PER_MIN;
  const hours = Array.from({ length: Math.ceil((dayClose - dayOpen) / 60) }, (_, i) => dayOpen + i * 60);
  const nowMin = date === today ? localMinutes(new Date(), tz) : -1;

  const visible = (b: Booking) =>
    statusFilter === 'all' ? true : statusFilter === 'live' ? ['pending', 'confirmed', 'completed', 'no_show'].includes(b.booking_status) : b.booking_status === statusFilter;
  const top = (iso: string) => (Math.max(dayOpen, localMinutes(iso, tz)) - dayOpen) * PX_PER_MIN;
  const span = (s: string, e: string) => {
    const a = Math.max(dayOpen, localMinutes(s, tz));
    const bEnd = localMinutes(e, tz) || 1440;
    return Math.max(18, (Math.min(dayClose, bEnd) - a) * PX_PER_MIN);
  };

  return (
    <AdminPage title="Live court schedule" description="Every court, every booking — updates the moment anything changes."
      actions={<>
        <LiveIndicator status={live.status} lastUpdated={live.lastUpdated} onRefresh={() => void live.reload()} />
        <Button onClick={() => setCreate({})}><Plus /> New booking</Button>
      </>}>
      <div className="sticky top-14 z-20 lg:top-0">
      <Card className={cn('transition-[padding,box-shadow]', compact ? 'p-2 shadow-lift sm:px-3' : 'p-4')}>
        <DateStrip value={date} today={today} maxDays={365} days={14} compact={compact}
          onChange={(d) => { const p = new URLSearchParams(params); p.set('date', d); setParams(p); }} />
        <div className={cn('mt-4 flex flex-wrap gap-3', compact && 'hidden')}>
          <Select aria-label="Filter by court" className="w-auto" value={courtFilter} onChange={(e) => setCourtFilter(e.target.value)}>
            <option value="all">All courts</option>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Filter by status" className="w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="live">Active (pending, confirmed, played)</option>
            <option value="all">All statuses</option>
            {(Object.keys(bookingStatusLabel) as BookingStatus[]).map((s) => <option key={s} value={s}>{bookingStatusLabel[s]} only</option>)}
          </Select>
        </div>
      </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        {live.error ? <div className="p-4"><ErrorState message={live.error} onRetry={() => void live.reload()} /></div> : live.loading && !live.slots.length ? <Skeleton className="m-4 h-96" /> : (
          <div className="overflow-x-auto">
            <div className="flex min-w-fit">
              {/* time axis */}
              <div className="sticky left-0 z-10 w-16 shrink-0 border-r border-slate-100 bg-white">
                <div className="h-12 border-b border-slate-100" />
                <div className="relative" style={{ height }}>
                  {hours.map((m) => (
                    <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-slate-500 tabular-nums" style={{ top: (m - dayOpen) * PX_PER_MIN }}>
                      {formatTimeShort(zonedTimeToUtc(date, `${Math.floor(m / 60)}:${m % 60}`, tz), tz)}
                    </span>
                  ))}
                </div>
              </div>
              {shown.map((c) => {
                const cs = slotsByCourt.get(c.id) ?? [];
                const closed = cs.some((s) => s.status === 'closed');
                const courtBookings = (bookings.data ?? []).filter((b) => b.court_id === c.id && visible(b));
                const courtBlocks = (blocks.data ?? []).filter((b) => b.court_id === c.id);
                const holds = cs.filter((s) => s.status === 'held');
                return (
                  <div key={c.id} className="w-56 shrink-0 border-r border-slate-100 last:border-r-0 sm:w-64">
                    <div className="flex h-12 flex-col justify-center border-b border-slate-100 px-3">
                      <p className="text-sm font-semibold">{c.name}</p>
                      <p className="text-xs capitalize text-slate-500">{c.court_type}</p>
                    </div>
                    <div className={cn('relative', closed && 'bg-neutral-100')} style={{ height }}>
                      {hours.map((m) => <div key={m} className="absolute inset-x-0 border-t border-slate-100" style={{ top: (m - dayOpen) * PX_PER_MIN }} aria-hidden />)}
                      {closed && <p className="absolute inset-x-0 top-6 text-center text-sm font-medium text-slate-500">Closed</p>}
                      {/* empty slots: click to book */}
                      {!closed && cs.filter((s) => s.status === 'available').map((s) => (
                        <button key={s.slot_start} type="button" onClick={() => setCreate({ courtId: c.id, start: s.slot_start! })}
                          className="group absolute inset-x-1 rounded-md text-left text-[11px] text-transparent hover:bg-brand-50 hover:text-brand-800 focus-visible:bg-brand-50 focus-visible:text-brand-800"
                          style={{ top: top(s.slot_start!), height: span(s.slot_start!, s.slot_end!) }}
                          aria-label={`Book ${c.name} at ${formatTime(s.slot_start!, tz)}`}>
                          <span className="px-2">+ Book {formatTimeShort(s.slot_start!, tz)}</span>
                        </button>
                      ))}
                      {holds.map((s) => (
                        <div key={`h${s.slot_start}`} className="absolute inset-x-1 rounded-md border border-dashed border-amber-300 bg-amber-50/80 px-2 py-1 text-[11px] font-medium text-amber-900"
                          style={{ top: top(s.slot_start!), height: span(s.slot_start!, s.slot_end!) }}>
                          Held · checkout in progress
                        </div>
                      ))}
                      {courtBlocks.map((bl) => (
                        <div key={bl.id} className="absolute inset-x-1 flex items-start gap-1 overflow-hidden rounded-md border border-neutral-300 bg-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-700"
                          style={{ top: top(bl.start_at), height: span(bl.start_at, bl.end_at) }}>
                          <Wrench className="mt-0.5 size-3 shrink-0" aria-hidden /> {bl.reason}
                        </div>
                      ))}
                      {courtBookings.map((b) => (
                        <button key={b.id} type="button" onClick={() => setOpen(b.id)} data-testid="schedule-booking"
                          className={cn('absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-left text-xs shadow-sm transition-transform hover:z-10 hover:scale-[1.02]', statusCls[b.booking_status])}
                          style={{ top: top(b.start_at), height: span(b.start_at, b.end_at) }}>
                          <span className="block truncate font-semibold">{b.customer_name}</span>
                          <span className="block truncate opacity-85">{formatTime(b.start_at, tz)}–{formatTime(b.end_at, tz)} · {bookingStatusLabel[b.booking_status]}</span>
                          <span className="block truncate opacity-75">{b.payment_status.replace('_', ' ')}</span>
                        </button>
                      ))}
                      {nowMin >= dayOpen && nowMin <= dayClose && (
                        <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: (nowMin - dayOpen) * PX_PER_MIN }} aria-hidden />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
      <ul className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-brand-600" /> Confirmed</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded border border-dashed border-amber-400 bg-amber-100" /> Pending / held</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-sky-100 ring-1 ring-sky-300" /> Completed</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-violet-100 ring-1 ring-violet-300" /> No-show</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-neutral-200" /> Blocked / closed</li>
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-red-500" /> Now</li>
      </ul>
      <BookingPanel bookingId={open} onClose={() => setOpen(null)} onChanged={() => void live.reload()} />
      <NewBookingDialog open={!!create} initial={create ?? undefined} onClose={() => setCreate(null)} onCreated={() => void live.reload()} />
    </AdminPage>
  );
}
