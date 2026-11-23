import { Ban, Check, Clock, Hourglass, Lock, Wrench } from 'lucide-react';
import type { AvailabilitySlot, Court, PricingRule, SlotStatus } from '@/lib/types';
import { dayOfWeek, formatCalendarDate, formatDateLong, formatTime, localDate, localMinutes } from '@/lib/time';
import { moneyShort, slotStatusLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { slotKey } from '@/hooks/useLiveAvailability';

const style: Record<SlotStatus, string> = {
  available: 'border-brand-200 bg-white text-ink-900 hover:border-brand-500 hover:bg-brand-50 cursor-pointer',
  held_by_you: 'border-sky-300 bg-sky-50 text-sky-900 cursor-pointer',
  held: 'border-amber-200 bg-amber-50 text-amber-900',
  pending: 'border-orange-200 bg-orange-50 text-orange-900',
  booked: 'border-slate-200 bg-slate-100 text-slate-500',
  blocked: 'border-slate-200 bg-slate-100 text-slate-500 hatch',
  unavailable: 'border-slate-200 bg-slate-50 text-slate-400 hatch',
  closed: 'border-slate-200 bg-slate-50 text-slate-400',
  past: 'border-slate-200 bg-slate-100 text-slate-400',
};

const Icon: Partial<Record<SlotStatus, typeof Check>> = {
  held: Hourglass, held_by_you: Hourglass, pending: Clock, booked: Lock, blocked: Wrench, unavailable: Ban,
};

export function isSelectable(s: SlotStatus) {
  return s === 'available' || s === 'held_by_you';
}

export function SlotButton({ slot, court, tz, currency, selected, flash, onSelect, compact, hideTime, noPrice }: {
  slot: AvailabilitySlot; court: Court; tz: string; currency: string; selected: boolean; flash: boolean;
  onSelect: (s: AvailabilitySlot) => void; compact?: boolean; hideTime?: boolean; noPrice?: boolean;
}) {
  const st = slot.status;
  const I = selected ? undefined : Icon[st];
  const selectable = isSelectable(st);
  const time = `${formatTime(slot.slot_start!, tz)} – ${formatTime(slot.slot_end!, tz)}`;
  const status = selected ? 'Selected' : slotStatusLabel[st];
  const aria = `${court.name}, ${hideTime ? formatDateLong(slot.slot_start!, tz) + ', ' : ''}${formatTime(slot.slot_start!, tz)} to ${formatTime(slot.slot_end!, tz)}: ${status}${
    st === 'available' && slot.price != null ? `, ${moneyShort(slot.price, currency)} per hour` : ''}`;
  return (
    <button type="button" disabled={!selectable} aria-pressed={selectable ? selected : undefined} aria-label={aria}
      data-slot-status={selected ? 'selected' : st} data-slot-start={slot.slot_start} data-court={court.name}
      onClick={() => onSelect(slot)}
      className={cn('group relative flex w-full flex-col items-start rounded-xl border px-2.5 text-left sm:px-3 transition-all disabled:cursor-not-allowed',
        compact ? 'py-2' : 'py-2.5', style[st],
        selected && 'border-ink-900 bg-ink-900 text-white ring-2 ring-ink-900 ring-offset-1 hover:border-ink-900 hover:bg-ink-900',
        flash && 'animate-pulse ring-2 ring-red-400')}>
      {!hideTime && (
        <span className="flex w-full items-center justify-between gap-1">
          <span className="whitespace-nowrap text-xs font-bold tabular-nums min-[400px]:text-[13px] sm:text-sm">{time}</span>
          {I && <I className={cn('hidden size-3.5 shrink-0 sm:block', selected ? 'text-ball' : '')} aria-hidden />}
        </span>
      )}
      <span className={cn('flex w-full items-center justify-between gap-1 text-[11px] font-medium leading-tight', selected ? 'text-white/80' : '', hideTime && 'justify-center')}>
        {st === 'available' && !selected && !noPrice && slot.price != null ? moneyShort(slot.price, currency) + (hideTime ? '' : '/hr') : status}
        {hideTime && I && st !== 'available' && <I className={cn('size-3 shrink-0', selected ? 'text-ball' : '')} aria-hidden />}
      </span>
    </button>
  );
}

export function Legend() {
  const items: { s: SlotStatus | 'selected'; label: string }[] = [
    { s: 'available', label: 'Available' }, { s: 'selected', label: 'Selected' }, { s: 'held', label: 'On hold (checkout in progress)' },
    { s: 'pending', label: 'Pending confirmation' }, { s: 'booked', label: 'Booked' }, { s: 'blocked', label: 'Closed / maintenance' },
    { s: 'unavailable', label: 'Unavailable' },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600" aria-label="Slot status legend">
      {items.map(({ s, label }) => {
        const I = s === 'selected' ? undefined : Icon[s];
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn('grid size-5 place-items-center rounded-md border', s === 'selected' ? 'border-ink-900 bg-ink-900 text-ball' : style[s])} aria-hidden>
              {I && <I className="size-3" />}
            </span>
            {label}
          </li>
        );
      })}
    </ul>
  );
}

interface RateGroup { key: string; label: string; rate: number | null; windows: string[]; slots: AvailabilitySlot[] }

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clockLabel = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/**
 * Splits one court's slots for a day into its rate groups (e.g. Day rate /
 * Night rate), using the pricing rule each slot's start time falls under.
 */
function groupByRate(list: AvailabilitySlot[], rules: PricingRule[], court: Court, tz: string): RateGroup[] {
  const groups = new Map<string, RateGroup>();
  const applicable = rules.filter((r) => r.is_active && (r.court_id === null || r.court_id === court.id))
    .sort((a, b) => b.priority - a.priority);
  for (const s of list) {
    const m = localMinutes(s.slot_start!, tz);
    const dow = dayOfWeek(localDate(s.slot_start!, tz));
    const rule = applicable.find((r) => (!r.days_of_week || r.days_of_week.includes(dow))
      && m >= toMin(r.start_time) && m < (r.end_time.startsWith('24:00') ? 1440 : toMin(r.end_time)));
    const rate = rule ? Number(rule.rate) : s.price;
    const key = rule ? `${rule.label}|${rate}` : `base|${rate}`;
    if (!groups.has(key)) groups.set(key, { key, label: rule?.label ?? 'Standard rate', rate, windows: [], slots: [] });
    groups.get(key)!.slots.push(s);
  }
  // Describe each group's time window(s), joining ones that wrap past midnight.
  for (const g of groups.values()) {
    const mins = applicable.filter((r) => `${r.label}|${Number(r.rate)}` === g.key)
      .map((r) => [toMin(r.start_time), r.end_time.startsWith('24:00') ? 1440 : toMin(r.end_time)] as const)
      .sort((a, b) => a[0] - b[0]);
    const wraps = mins.length > 1 && mins[0][0] === 0 && mins[mins.length - 1][1] === 1440;
    const parts = wraps ? [[mins[mins.length - 1][0], mins[0][1]] as const, ...mins.slice(1, -1)] : mins;
    g.windows = parts.map(([a, b]) => `${clockLabel(a)} – ${clockLabel(b)}`);
  }
  return [...groups.values()].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
}

/** One court per block; its slots split into rate columns side by side. */
export function SlotGrid({ courts, slots, rules, tz, currency, isSelected, justTaken, onSelect }: {
  courts: Court[]; slots: AvailabilitySlot[]; rules: PricingRule[]; tz: string; currency: string;
  isSelected: (s: AvailabilitySlot) => boolean; justTaken: Set<string>; onSelect: (s: AvailabilitySlot) => void;
}) {
  const byCourt = new Map<string, AvailabilitySlot[]>();
  for (const s of slots) {
    const arr = byCourt.get(s.court_id) ?? [];
    arr.push(s);
    byCourt.set(s.court_id, arr);
  }
  const shown = courts.filter((c) => byCourt.has(c.id));
  const nowIso = new Date().toISOString();

  return (
    <div className="space-y-8">
      {shown.map((c) => {
        const list = byCourt.get(c.id)!;
        const closed = list.some((s) => s.status === 'closed');
        // Every slot of the day, in order; ones that have ended show as Past.
        const visible = list.filter((s) => s.slot_start && s.slot_end)
          .map((s) => (s.slot_end! <= nowIso && s.status !== 'past' ? { ...s, status: 'past' as const } : s))
          .sort((a, b) => a.slot_start!.localeCompare(b.slot_start!));
        const groups = groupByRate(visible, rules, c, tz);
        return (
          <section key={c.id} aria-label={c.name}>
            {shown.length > 1 && (
              <h3 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-ink-900">
                {c.name} <span className="text-xs font-normal capitalize text-slate-500">{c.court_type}</span>
              </h3>
            )}
            {closed ? (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 hatch">Closed this day</p>
            ) : visible.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No more times today.</p>
            ) : (
              <div className={cn('grid gap-3 sm:gap-4', groups.length > 1 && 'grid-cols-2')}>
                {groups.map((g) => (
                  <div key={g.key} className="min-w-0">
                    <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2.5">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-sm font-semibold text-ink-900">{g.label}</span>
                        {g.rate != null && <span className="text-sm font-bold text-brand-700 tabular-nums">{moneyShort(g.rate, currency)}/hr</span>}
                      </p>
                      {g.windows.length > 0 && <p className="text-xs text-slate-500">{g.windows.join(', ')}</p>}
                    </div>
                    <div className="gap-1.5 xl:columns-2 [&>*]:mb-1.5 [&>*]:break-inside-avoid">
                      {g.slots.map((s) => (
                        <SlotButton key={slotKey(s)} slot={s} court={c} tz={tz} currency={currency} compact noPrice selected={isSelected(s)}
                          flash={justTaken.has(slotKey(s))} onSelect={onSelect} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Week view for one court: days across, hours down. Every cell is a tappable
 * slot showing its price (or status), so customers can scan a whole week.
 */
export function WeekGrid({ court, dates, slots, tz, currency, isSelected, justTaken, onSelect, today }: {
  court: Court; dates: string[]; slots: AvailabilitySlot[]; tz: string; currency: string;
  isSelected: (s: AvailabilitySlot) => boolean; justTaken: Set<string>; onSelect: (s: AvailabilitySlot) => void; today: string;
}) {
  const mine = slots.filter((s) => s.court_id === court.id);
  const byDay = new Map<string, Map<number, AvailabilitySlot>>();
  const rows = new Set<number>();
  for (const s of mine) {
    if (!s.slot_start) continue; // a closed day has no slots; its cells render as closed
    const d = localDate(s.slot_start, tz);
    const m = localMinutes(s.slot_start, tz);
    rows.add(m);
    if (!byDay.has(d)) byDay.set(d, new Map());
    byDay.get(d)!.set(m, s);
  }
  const minutes = [...rows].sort((a, b) => a - b);
  const length = mine.find((s) => s.slot_start && s.slot_end);
  const slotMins = length ? (Date.parse(length.slot_end!) - Date.parse(length.slot_start!)) / 60000 : 60;
  const clock = (m: number) => {
    const h = Math.floor(m / 60) % 24;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  const label = (m: number) => `${clock(m)} – ${clock(m + slotMins)}`;
  const nowIso = new Date().toISOString();

  return (
    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[680px] border-separate border-spacing-1">
        <caption className="sr-only">{court.name} availability for the week</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-32 bg-white text-left text-[11px] font-semibold text-slate-500">Time</th>
            {dates.map((d) => (
              <th key={d} scope="col" className={cn('rounded-lg px-1 py-1.5 text-center text-xs font-semibold', d === today ? 'bg-ink-900 text-white' : 'text-ink-800')}>
                <span className="block">{d === today ? 'Today' : formatCalendarDate(d, 'weekday')}</span>
                <span className={cn('block text-[11px] font-normal', d === today ? 'text-ball' : 'text-slate-500')}>{formatCalendarDate(d, 'short').split(', ')[1]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {minutes.map((m) => (
            <tr key={m}>
              <th scope="row" className="sticky left-0 z-10 bg-white pr-1 text-left text-[11px] font-semibold text-slate-500 tabular-nums whitespace-nowrap">{label(m)}</th>
              {dates.map((d) => {
                const s = byDay.get(d)?.get(m);
                if (!s) return <td key={d}><span className="block h-9 rounded-lg bg-slate-50 hatch" aria-label="Closed" /></td>;
                const shown = s.status !== 'past' && s.slot_end && s.slot_end <= nowIso ? { ...s, status: 'past' as const } : s;
                return (
                  <td key={d}>
                    <SlotButton slot={shown} court={court} tz={tz} currency={currency} compact hideTime selected={isSelected(s)}
                      flash={justTaken.has(slotKey(s))} onSelect={onSelect} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
