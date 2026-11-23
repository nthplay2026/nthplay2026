import { Clock } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { formatClock } from '@/lib/time';
import type { OperatingHours } from '@/lib/types';
import { Skeleton } from '@/components/ui/misc';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const is24h = (h?: OperatingHours) => !!h && !h.is_closed && h.opening_time?.startsWith('00:00') && h.closing_time?.startsWith('24:00');

/** Facility operating hours (or a court's own hours when it has them). */
export function HoursTable({ courtId, todayDow }: { courtId?: string; todayDow?: number }) {
  const q = useAsync(() => api.operatingHours(), []);
  if (q.loading) return <Skeleton className="h-48" />;
  if (q.error || !q.data) return <p className="text-sm text-slate-600">Operating hours are unavailable right now.</p>;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rowFor = (d: number) =>
    q.data!.find((h) => h.court_id === (courtId ?? null) && h.day_of_week === d) ?? q.data!.find((h) => h.court_id === null && h.day_of_week === d);

  if (order.every((d) => is24h(rowFor(d)))) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-brand-50 p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-700 text-white"><Clock className="size-5" aria-hidden /></span>
        <div>
          <p className="text-lg font-bold text-ink-900">Open 24/7</p>
          <p className="text-sm text-slate-600">24 hours a day, every day of the week — including holidays unless announced.</p>
        </div>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Operating hours</caption>
      <tbody>
        {order.map((d) => {
          const row = rowFor(d);
          return (
            <tr key={d} className={d === todayDow ? 'font-semibold text-ink-900' : 'text-slate-700'}>
              <th scope="row" className="py-1.5 pr-4 text-left font-medium">{DAYS[d]}{d === todayDow && <span className="sr-only"> (today)</span>}</th>
              <td className="py-1.5 text-right tabular-nums">
                {!row || row.is_closed ? 'Closed' : is24h(row) ? 'Open 24 hours' : `${formatClock(row.opening_time)} – ${formatClock(row.closing_time)}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
