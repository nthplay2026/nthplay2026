import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { useStaffFeed } from '@/hooks/useStaffFeed';
import { api } from '@/lib/api';
import { addDays, dayOfWeek, localDate, zonedTimeToUtc } from '@/lib/time';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AdminPage } from '@/components/admin/AdminPage';
import { Button } from '@/components/ui/button';
import { Card, ErrorState, Skeleton } from '@/components/ui/misc';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Month overview: bookings per day; click a day to open its live schedule. */
export default function CalendarPage() {
  const { tz, today, currency } = useFacility();
  const [month, setMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const first = `${month}-01`;
  const gridStart = addDays(first, -dayOfWeek(first));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const q = useAsync(() => api.bookingsBetween(zonedTimeToUtc(gridStart, '00:00', tz).toISOString(), zonedTimeToUtc(addDays(gridStart, 42), '00:00', tz).toISOString(),
    { statuses: ['pending', 'confirmed', 'completed', 'no_show'] }), [gridStart, tz]);
  useStaffFeed(() => { void q.reload(); }, ['bookings']);

  const byDay = new Map<string, { n: number; value: number; pending: number }>();
  for (const b of q.data ?? []) {
    const d = localDate(b.start_at, tz);
    const e = byDay.get(d) ?? { n: 0, value: 0, pending: 0 };
    e.n++; e.value += b.total_amount; if (b.booking_status === 'pending') e.pending++;
    byDay.set(d, e);
  }
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T12:00:00Z`));

  return (
    <AdminPage title="Calendar" description="Bookings per day. Select a day to open its schedule."
      actions={<div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft /></Button>
        <span className="min-w-36 text-center font-semibold" aria-live="polite">{label}</span>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}><ChevronRight /></Button>
        <Button variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
      </div>}>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : q.loading && !q.data ? <Skeleton className="h-[480px]" /> : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase text-slate-500">
            {WEEK.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const e = byDay.get(d);
              const inMonth = d.startsWith(month);
              return (
                <Link key={d} to={`/admin/schedule?date=${d}`}
                  className={cn('min-h-20 border-b border-r border-slate-100 p-2 text-left transition-colors hover:bg-brand-50 sm:min-h-24', !inMonth && 'bg-slate-50/60 text-slate-400')}>
                  <span className={cn('inline-grid size-7 place-items-center rounded-full text-sm font-semibold', d === today && 'bg-ink-900 text-white')}>{Number(d.slice(8))}</span>
                  {e && (
                    <span className="mt-1 block text-xs">
                      <span className="font-semibold text-ink-900">{e.n} booking{e.n > 1 ? 's' : ''}</span>
                      <span className="hidden text-slate-500 sm:block">{money(e.value, currency)}</span>
                      {e.pending > 0 && <span className="block font-medium text-amber-700">{e.pending} pending</span>}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </AdminPage>
  );
}
