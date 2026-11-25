// Time-zone helpers. All instants are stored in UTC; everything shown to people
// or entered by them is in the FACILITY's time zone (not the browser's).
// Calendar dates are plain 'YYYY-MM-DD' strings in the facility time zone.

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function zonedParts(instant: Date | string | number, tz: string): ZonedParts {
  const d = instant instanceof Date ? instant : new Date(instant);
  const p: Record<string, string> = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(d)) p[type] = value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Facility-local calendar date ('YYYY-MM-DD') of an instant. */
export function localDate(instant: Date | string | number, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function todayIn(tz: string): string {
  return localDate(new Date(), tz);
}

/** Minutes since local midnight. */
export function localMinutes(instant: Date | string, tz: string): number {
  const p = zonedParts(instant, tz);
  return p.hour * 60 + p.minute;
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(instant: number, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant for a wall-clock time in `tz`. Handles DST: for a time that
 * does not exist (spring forward) it returns the shifted instant, for an
 * ambiguous one (fall back) the earlier instant.
 */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

/** Add whole days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// --------------------------------------------------------------- formatting --
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }); fmtCache.set(key, f); }
  return f;
}

/** "6:00 PM" */
export function formatTime(instant: string | Date, tz: string): string {
  return fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(instant));
}

/** "6 PM" when on the hour, else "6:30 PM" */
export function formatTimeShort(instant: string | Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return p.minute === 0 ? fmt(tz, { hour: 'numeric' }).format(new Date(instant)) : formatTime(instant, tz);
}

/** "Tue, Oct 13, 2026" */
export function formatDateLong(instant: string | Date, tz: string): string {
  return fmt(tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(instant));
}

/** "Oct 13, 6:00 PM" */
export function formatDateTime(instant: string | Date, tz: string): string {
  return fmt(tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(instant));
}

/** Label for a 'YYYY-MM-DD' date: "Tuesday, October 13". */
export function formatCalendarDate(date: string, style: 'long' | 'short' | 'weekday' = 'long'): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  const opts: Intl.DateTimeFormatOptions =
    style === 'long' ? { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }
      : style === 'short' ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
        : { weekday: 'short', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('en-US', opts).format(t);
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${m} min`;
}

/** "HH:MM:SS" or "HH:MM" from the database → "6:00 AM". */
export function formatClock(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (h === 24) return '12:00 AM (midnight)';
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

/** 'YYYY-MM-DDTHH:MM' (datetime-local input value) in tz for an instant. */
export function toLocalInput(instant: string | Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function fromLocalInput(value: string, tz: string): Date {
  const [date, time] = value.split('T');
  return zonedTimeToUtc(date, time, tz);
}

export function relativeCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** "06:00" -> "6 AM", "22:30" -> "10:30 PM", "24:00" -> "12 MN". */
export function shortClock(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (h === 24 || (h === 0 && m === 0 && time.startsWith('24'))) return '12 MN';
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${pad(m)} ${suffix}` : `${h12} ${suffix}`;
}

/**
 * One-line summary of the facility's weekly hours, e.g. "6 AM – 11 PM daily".
 * Returns null when days differ (the full table then says it better).
 */
export function dailyHoursSummary(rows: { court_id: string | null; day_of_week: number; is_closed: boolean; opening_time: string | null; closing_time: string | null }[]): string | null {
  const week = rows.filter((r) => r.court_id === null);
  if (week.length !== 7 || week.some((r) => r.is_closed)) return null;
  const key = (r: (typeof week)[number]) => `${r.opening_time}|${r.closing_time}`;
  if (new Set(week.map(key)).size !== 1) return null;
  const [o, c] = [week[0].opening_time, week[0].closing_time];
  if (o?.startsWith('00:00') && c?.startsWith('24:00')) return 'Open 24 hours';
  return `${shortClock(o)} – ${shortClock(c)} daily`;
}