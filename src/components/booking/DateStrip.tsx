import { useEffect, useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, diffDays, formatCalendarDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Date selector: previous/next day, a scrollable strip of upcoming days with a
 * "Today" marker, and a native calendar picker for jumping further ahead.
 * `compact` shows just the slim top row (used while a sticky bar is scrolled).
 */
export function DateStrip({ value, onChange, today, maxDays, days = 14, compact = false }: {
  value: string; onChange: (d: string) => void; today: string; maxDays: number; days?: number; compact?: boolean;
}) {
  const max = addDays(today, maxDays);
  const offset = Math.max(0, diffDays(value, today));
  const start = offset >= days - 2 ? addDays(value, -Math.floor(days / 2)) : today;
  const list = Array.from({ length: days }, (_, i) => addDays(start, i)).filter((d) => diffDays(d, max) <= 0);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [value]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size={compact ? 'icon-sm' : 'icon'} aria-label="Previous day" disabled={value <= today} onClick={() => onChange(addDays(value, -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size={compact ? 'icon-sm' : 'icon'} aria-label="Next day" disabled={value >= max} onClick={() => onChange(addDays(value, 1))}>
            <ChevronRight />
          </Button>
          <h2 className={cn('ml-2 font-semibold text-ink-900', compact ? 'text-base' : 'text-lg')} aria-live="polite">
            {formatCalendarDate(value)}
            {value === today && <span className="ml-2 rounded-full bg-ball px-2 py-0.5 align-middle text-xs font-bold text-ink-900">Today</span>}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {value !== today && <Button variant="ghost" size="sm" onClick={() => onChange(today)}>Today</Button>}
          <label className={cn('relative inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-ink-800 hover:bg-slate-50 focus-within:outline-2 focus-within:outline-brand-600', compact ? 'h-8' : 'h-10')}>
            <CalendarDays className="size-4" aria-hidden />
            <span>Pick a date</span>
            <input type="date" className="absolute inset-0 cursor-pointer text-base opacity-0" min={today} max={max} value={value}
              aria-label="Choose a date" onChange={(e) => e.target.value && onChange(e.target.value)} />
          </label>
        </div>
      </div>
      <div className={cn('-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0', compact && 'hidden')} role="listbox" aria-label="Upcoming dates">
        <div className="flex gap-2">
          {list.map((d) => {
            const selected = d === value;
            const isToday = d === today;
            const [, , dd] = d.split('-');
            return (
              <button key={d} ref={selected ? selectedRef : undefined} type="button" role="option" aria-selected={selected}
                onClick={() => onChange(d)}
                className={cn('relative flex w-15 shrink-0 flex-col items-center rounded-xl border py-2 transition-colors',
                  selected ? 'border-ink-900 bg-ink-900 text-white shadow-sm' : 'border-slate-200 bg-white text-ink-800 hover:border-slate-300')}>
                <span className={cn('text-[11px] font-semibold uppercase tracking-wide', selected ? 'text-ball' : 'text-slate-500')}>
                  {isToday ? 'Today' : formatCalendarDate(d, 'weekday')}
                </span>
                <span className="text-lg font-bold tabular-nums">{Number(dd)}</span>
                <span className="sr-only">{formatCalendarDate(d)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
