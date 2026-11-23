import type { ReactNode } from 'react';
import type { BookingGroup } from '@/lib/bookingGroups';
import { formatDateLong, formatTime } from '@/lib/time';
import { money } from '@/lib/format';
import { BookingSummary } from './Summary';
import { BookingStatusBadge } from './StatusBadges';

/** One booking's details: the usual summary for a single block, or every block of a group. */
export function GroupSummary({ group, tz, extra }: { group: BookingGroup; tz: string; extra?: ReactNode }) {
  const [first] = group.bookings;
  if (group.bookings.length === 1) {
    return (
      <BookingSummary courtName={first.courts?.name ?? 'Court'} courtType={first.courts?.court_type} start={first.start_at} end={first.end_at}
        minutes={first.duration_minutes} hourlyRate={first.hourly_rate_snapshot} breakdown={first.price_breakdown} total={first.total_amount}
        currency={first.currency} tz={tz} extra={extra} />
    );
  }
  const showStatus = new Set(group.bookings.map((b) => b.booking_status)).size > 1;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{first.courts?.name ?? 'Court'}</p>
        <p className="mt-1 text-sm text-slate-600">{group.bookings.length} time blocks</p>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
        {group.bookings.map((b) => (
          <li key={b.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <span>
              <span className="block font-semibold text-ink-900 tabular-nums">{formatTime(b.start_at, tz)} – {formatTime(b.end_at, tz)}</span>
              <span className="block text-xs text-slate-500">{formatDateLong(b.start_at, tz)}</span>
              {showStatus && <span className="mt-1 block"><BookingStatusBadge status={b.booking_status} /></span>}
            </span>
            <span className="whitespace-nowrap font-semibold tabular-nums">{money(b.total_amount, b.currency)}</span>
          </li>
        ))}
      </ul>
      {extra && <div className="divide-y divide-slate-100 text-sm">{extra}</div>}
      <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
        <span className="font-semibold">Total</span>
        <span className="text-2xl font-bold tabular-nums">{money(group.total, group.currency)}</span>
      </div>
    </div>
  );
}
