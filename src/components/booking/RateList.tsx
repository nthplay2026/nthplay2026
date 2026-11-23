import type { PricingRule } from '@/lib/types';
import { formatClock } from '@/lib/time';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Week order starting Monday, so "Fri, Sat, Sun" reads as one run. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const weekPos = (d: number) => WEEK.indexOf(d);

/** [1,2,3,4] → "Mon–Thu", [5,6,0] → "Fri–Sun", [1,3] → "Mon, Wed". */
function dayLabel(days: number[] | null): string {
  if (!days || days.length >= 7) return 'Every day';
  const sorted = [...days].sort((a, b) => weekPos(a) - weekPos(b));
  const consecutive = sorted.every((d, i) => i === 0 || weekPos(d) === weekPos(sorted[i - 1]) + 1);
  if (consecutive && sorted.length > 2) return `${DAY[sorted[0]]}–${DAY[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => DAY[d]).join(', ');
}
const firstDay = (days: number[] | null) => (days?.length ? Math.min(...days.map(weekPos)) : -1);

interface RateRow { key: string; label: string; days: string; from: string; to: string; rate: number }

/**
 * Active rate rules for a court, with windows that wrap past midnight shown as
 * one line (e.g. "Night rate · 5:00 PM – 7:00 AM" rather than two rows).
 */
export function rateRows(rules: PricingRule[], courtId?: string): RateRow[] {
  const applicable = rules
    .filter((r) => r.is_active && (r.court_id === null || r.court_id === courtId))
    .sort((a, b) => firstDay(a.days_of_week) - firstDay(b.days_of_week) || a.start_time.localeCompare(b.start_time));
  const sameDays = (a: PricingRule, b: PricingRule) => JSON.stringify(a.days_of_week) === JSON.stringify(b.days_of_week);
  // Pass 1: pair each window ending at midnight with its matching window starting at midnight.
  const endOf = new Map<string, string>();
  const absorbed = new Set<string>();
  for (const r of applicable) {
    if (!r.end_time.startsWith('24:00')) continue;
    const next = applicable.find((x) => x.id !== r.id && !absorbed.has(x.id) && x.start_time.startsWith('00:00')
      && x.label === r.label && Number(x.rate) === Number(r.rate) && sameDays(x, r));
    if (next) { absorbed.add(next.id); endOf.set(r.id, next.end_time); }
  }
  // Pass 2: one row per remaining window, in start-time order.
  return applicable.filter((r) => !absorbed.has(r.id)).map((r) => {
    const end = endOf.get(r.id) ?? r.end_time;
    return {
      key: r.id, label: r.label, rate: Number(r.rate),
      days: dayLabel(r.days_of_week),
      from: formatClock(r.start_time), to: formatClock(end.startsWith('24:00') ? '00:00' : end),
    };
  });
}

export function lowestRate(rules: PricingRule[], baseRate: number, courtId?: string): number {
  const rates = rules.filter((r) => r.is_active && (r.court_id === null || r.court_id === courtId)).map((r) => Number(r.rate));
  return Math.min(baseRate, ...rates);
}

export function RateList({ rules, courtId, currency, baseRate, className, dark = false }: {
  rules: PricingRule[]; courtId?: string; currency: string; baseRate: number; className?: string; dark?: boolean;
}) {
  const rows = rateRows(rules, courtId);
  if (!rows.length) {
    return <p className={cn('text-sm', dark ? 'text-slate-300' : 'text-slate-600', className)}>{money(baseRate, currency)} per hour, any time.</p>;
  }
  return (
    <ul className={cn('divide-y rounded-xl border text-sm', dark ? 'divide-white/10 border-white/15' : 'divide-slate-100 border-slate-200', className)}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className={cn('block font-semibold', dark ? 'text-white' : 'text-ink-900')}>{r.label}</span>
            <span className={cn('block text-xs', dark ? 'text-slate-300' : 'text-slate-500')}>{r.from} – {r.to}{r.days !== 'Every day' && ` · ${r.days}`}</span>
          </span>
          <span className={cn('whitespace-nowrap text-right', dark ? 'text-white' : 'text-ink-900')}>
            <span className="text-lg font-bold tabular-nums">{money(r.rate, currency).replace(/\.00$/, '')}</span>
            <span className={cn('text-xs', dark ? 'text-slate-300' : 'text-slate-500')}> / hr</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
