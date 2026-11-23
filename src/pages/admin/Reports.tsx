import { useState } from 'react';
import { Download } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { addDays, formatCalendarDate, formatClock } from '@/lib/time';
import { bookingStatusLabel, money } from '@/lib/format';
import { downloadCsv } from '@/lib/utils';
import type { BookingStatus } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Skeleton, StatCard } from '@/components/ui/misc';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Hours from the first to the last hour with bookings (inclusive). */
function hourRange(rows: { hour: number }[]): number[] {
  if (!rows.length) return [];
  const hs = rows.map((r) => r.hour);
  const lo = Math.min(...hs);
  const hi = Math.max(...hs);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

function Bars({ data, label, format }: { data: { key: string; label: string; value: number; sub?: string }[]; label: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={label} className="overflow-x-auto">
      <div className="flex h-48 min-w-fit items-end gap-1.5 pt-6">
        {data.map((d) => (
          <div key={d.key} className="group flex w-8 shrink-0 flex-col items-center gap-1 sm:w-10">
            <span className="text-[10px] font-semibold text-slate-600 opacity-0 group-hover:opacity-100">{format ? format(d.value) : d.value}</span>
            <div className="w-full rounded-t-md bg-brand-500 transition-colors group-hover:bg-brand-700" style={{ height: `${(d.value / max) * 150 + (d.value ? 4 : 1)}px` }} title={`${d.label}: ${format ? format(d.value) : d.value}`} />
            <span className="text-[10px] text-slate-500">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Reports() {
  const { courts, today, currency } = useFacility();
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [court, setCourt] = useState('');
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const q = useAsync(() => api.report(from, to, court || null, status || null), [from, to, court, status]);
  const r = q.data;
  const cur = r?.currency ?? currency;

  const preset = (days: number) => { setFrom(addDays(today, -(days - 1))); setTo(today); };
  const monthToDate = () => { setFrom(`${today.slice(0, 7)}-01`); setTo(today); };

  const exportCsv = () => {
    if (!r) return;
    downloadCsv(`report-${from}-to-${to}.csv`, [
      ['Report', `${from} to ${to}`, court ? courts.find((c) => c.id === court)?.name ?? '' : 'All courts', status ? bookingStatusLabel[status] : 'All statuses'],
      [],
      ['Summary'], ...Object.entries(r.totals).map(([k, v]) => [k, v]),
      [],
      ['Date', 'Bookings', 'Cancelled', 'Booking value', 'Paid revenue'],
      ...r.by_day.map((d) => [d.day, d.bookings, d.cancelled, Number(d.booking_value).toFixed(2), Number(d.paid_revenue).toFixed(2)]),
      [],
      ['Court', 'Bookings', 'Booked hours', 'Booking value'],
      ...r.by_court.map((c) => [c.court_name, c.bookings, (c.booked_minutes / 60).toFixed(1), Number(c.booking_value).toFixed(2)]),
      [],
      ['Hour', 'Bookings'], ...r.by_hour.map((h) => [`${h.hour}:00`, h.bookings]),
    ]);
  };

  return (
    <AdminPage title="Reports" description="Every figure is computed from the database for the selected range."
      actions={<Button variant="outline" onClick={exportCsv} disabled={!r}><Download /> Export CSV</Button>}>
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Court"><Select value={court} onChange={(e) => setCourt(e.target.value)}><option value="">All courts</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Booking status"><Select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | '')}><option value="">All statuses</option>{(Object.keys(bookingStatusLabel) as BookingStatus[]).map((s) => <option key={s} value={s}>{bookingStatusLabel[s]}</option>)}</Select></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => preset(7)}>Last 7 days</Button>
          <Button size="sm" variant="secondary" onClick={() => preset(30)}>Last 30 days</Button>
          <Button size="sm" variant="secondary" onClick={monthToDate}>Month to date</Button>
          <Button size="sm" variant="secondary" onClick={() => { setFrom(today); setTo(addDays(today, 13)); }}>Next 14 days</Button>
        </div>
      </Card>

      {q.error ? <ErrorState className="mt-4" message={q.error} onRetry={q.reload} /> : !r ? <Skeleton className="mt-4 h-96" /> : (
        <div className="mt-4 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Bookings" value={r.totals.bookings} hint={`${r.totals.confirmed} confirmed · ${r.totals.completed} completed · ${r.totals.pending} pending`} />
            <StatCard label="Paid revenue" value={money(r.totals.paid_revenue, cur)} tone="brand" hint={`Verified payments minus ${money(r.totals.refunds, cur)} refunds, by verification date`} />
            <StatCard label="Booking value" value={money(r.totals.booking_value, cur)} hint={`Outstanding (unpaid): ${money(r.totals.outstanding, cur)}`} />
            <StatCard label="Court utilisation" value={`${r.totals.utilization_pct}%`} hint={`${(r.totals.booked_minutes / 60).toFixed(1)} of ${(r.totals.open_minutes / 60).toFixed(0)} open court-hours`} />
            <StatCard label="Paid vs unpaid" value={`${r.totals.paid_bookings} / ${r.totals.unpaid_bookings}`} hint="Fully paid bookings / not fully paid (active)" />
            <StatCard label="Cancellations" value={r.totals.cancelled} hint={`${r.totals.cancellation_rate_pct}% of bookings`} />
            <StatCard label="No-shows" value={r.totals.no_show} />
            <StatCard label="Expired (unpaid)" value={r.totals.expired} />
          </div>

          <Card>
            <CardHeader><CardTitle>Bookings per day</CardTitle><CardDescription>By session date. Hover a bar for the exact value.</CardDescription></CardHeader>
            <CardContent>
              <Bars label="Bookings per day" data={r.by_day.map((d) => ({ key: d.day, label: d.day.slice(8), value: Number(d.bookings) }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Paid revenue per day</CardTitle><CardDescription>By the day the payment was verified.</CardDescription></CardHeader>
            <CardContent>
              <Bars label="Paid revenue per day" format={(n) => money(n, cur)} data={r.by_day.map((d) => ({ key: d.day, label: d.day.slice(8), value: Number(d.paid_revenue) }))} />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Peak booking times</CardTitle><CardDescription>Bookings by start hour.</CardDescription></CardHeader>
              <CardContent>
                <Bars label="Bookings by start hour" data={hourRange(r.by_hour).map((h) => ({ key: String(h), label: String(h), value: Number(r.by_hour.find((x) => x.hour === h)?.bookings ?? 0) }))} />
                {r.by_hour.length > 0 && (() => {
                  const top = [...r.by_hour].sort((a, b) => b.bookings - a.bookings)[0];
                  return <p className="mt-2 text-sm text-slate-600">Busiest start time: <strong>{formatClock(`${top.hour}:00`)}</strong> ({top.bookings} bookings)</p>;
                })()}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>By weekday</CardTitle></CardHeader>
              <CardContent>
                <Bars label="Bookings by weekday" data={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ key: String(d), label: WEEK[d], value: Number(r.by_weekday.find((x) => x.dow === d)?.bookings ?? 0) }))} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>By court</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-4">Court</th><th className="py-2 pr-4 text-right">Bookings</th><th className="py-2 pr-4 text-right">Booked hours</th><th className="py-2 text-right">Booking value</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {r.by_court.map((c) => (
                    <tr key={c.court_id}><td className="py-2.5 pr-4 font-medium">{c.court_name}</td><td className="py-2.5 pr-4 text-right tabular-nums">{c.bookings}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{(c.booked_minutes / 60).toFixed(1)}</td><td className="py-2.5 text-right tabular-nums">{money(c.booking_value, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500">Range: {formatCalendarDate(from, 'short')} – {formatCalendarDate(to, 'short')}. Booking value excludes cancelled and expired bookings.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </AdminPage>
  );
}
