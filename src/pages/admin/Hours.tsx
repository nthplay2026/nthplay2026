import { useEffect, useState } from 'react';
import { CalendarOff, Trash2 } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatCalendarDate, formatClock } from '@/lib/time';
import type { ConflictBooking } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { ConflictDialog } from '@/components/admin/ConflictDialog';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
interface DayRow { day_of_week: number; is_closed: boolean; opening_time: string; closing_time: string }

export default function Hours() {
  return (
    <AdminPage title="Operating hours" description="Weekly hours, per-court exceptions and holiday closures. Changes that would affect existing bookings ask you first.">
      <div className="space-y-6">
        <WeeklyHours />
        <SpecialDays />
      </div>
    </AdminPage>
  );
}

function WeeklyHours() {
  const { courts } = useFacility();
  const toast = useToast();
  const q = useAsync(() => api.operatingHours(), []);
  const [scope, setScope] = useState<string>(''); // '' = facility
  const [rows, setRows] = useState<DayRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictBooking[] | null>(null);

  const courtHasOwn = scope !== '' && (q.data ?? []).some((h) => h.court_id === scope);
  useEffect(() => {
    if (!q.data) return;
    const src = (cid: string | null) => q.data!.filter((h) => h.court_id === cid);
    const base = scope && courtHasOwn ? src(scope) : src(null);
    setRows(ORDER.map((d) => {
      const h = base.find((x) => x.day_of_week === d);
      return { day_of_week: d, is_closed: h?.is_closed ?? false, opening_time: h?.opening_time?.slice(0, 5) ?? '06:00', closing_time: h?.closing_time?.slice(0, 5) ?? '22:00' };
    }));
  }, [q.data, scope, courtHasOwn]);

  const save = async (acknowledge = false) => {
    setErr(null);
    for (const r of rows) {
      if (!r.is_closed && (!r.opening_time || !r.closing_time || (r.closing_time !== '00:00' && r.closing_time <= r.opening_time))) {
        setErr(`${DAYS[r.day_of_week]}: closing time must be after opening time.`); return;
      }
    }
    setSaving(true);
    try {
      const payload = rows.map((r) => ({
        day_of_week: r.day_of_week, is_closed: r.is_closed,
        opening_time: r.is_closed ? null : r.opening_time, closing_time: r.is_closed ? null : (r.closing_time === '00:00' ? '24:00' : r.closing_time),
      }));
      const res = await api.saveOperatingHours(scope || null, payload, acknowledge);
      if (res.status === 'conflicts') { setConflicts(res.conflicts ?? []); return; }
      setConflicts(null);
      toast.success('Hours saved', res.kept_bookings?.length ? `${res.kept_bookings.length} existing booking(s) outside the new hours were kept.` : undefined);
      await q.reload();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  };

  const resetCourt = async () => {
    try { await api.clearCourtHours(scope); toast.success('Court now follows the facility hours'); await q.reload(); }
    catch (e) { toast.error("Couldn't reset", errorMessage(e)); }
  };

  const upd = (i: number, patch: Partial<DayRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader><CardTitle>Weekly hours</CardTitle><CardDescription>All times are in the facility time zone. Use 00:00 as a closing time for midnight.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <Field label="Applies to" className="max-w-xs">
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">All courts (facility default)</option>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}
          </Select>
        </Field>
        {scope && !courtHasOwn && <Alert tone="info">This court currently follows the facility hours. Saving creates its own schedule.</Alert>}
        {err && <Alert tone="error">{err}</Alert>}
        {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : q.loading ? <Skeleton className="h-64" /> : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {rows.map((r, i) => (
              <div key={r.day_of_week} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[140px_120px_1fr]">
                <span className="font-medium">{DAYS[r.day_of_week]}</span>
                <Checkbox label="Closed" checked={r.is_closed} onChange={(e) => upd(i, { is_closed: e.target.checked })} />
                <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                  <Input type="time" step={900} aria-label={`${DAYS[r.day_of_week]} opening time`} disabled={r.is_closed} value={r.opening_time} onChange={(e) => upd(i, { opening_time: e.target.value })} className="max-w-36" />
                  <span className="text-slate-500">to</span>
                  <Input type="time" step={900} aria-label={`${DAYS[r.day_of_week]} closing time`} disabled={r.is_closed} value={r.closing_time === '24:00' ? '00:00' : r.closing_time} onChange={(e) => upd(i, { closing_time: e.target.value })} className="max-w-36" />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save(false)} loading={saving}>Save hours</Button>
          {courtHasOwn && <Button variant="outline" onClick={resetCourt}>Use facility hours for this court</Button>}
        </div>
      </CardContent>
      <ConflictDialog open={!!conflicts} conflicts={conflicts ?? []} onClose={() => setConflicts(null)} busy={saving}
        title="Existing bookings fall outside the new hours"
        body="Nothing has been saved yet. If you continue, the new hours apply to future bookings and these existing reservations are kept as booked. To move or cancel any of them, open them from the list."
        confirmLabel="Save hours and keep these bookings" onConfirm={() => void save(true)} />
    </Card>
  );
}

function SpecialDays() {
  const { courts, today } = useFacility();
  const toast = useToast();
  const q = useAsync(() => api.specialHours(today), [today]);
  const [f, setF] = useState({ court: '', date: '', closed: true, open: '09:00', close: '18:00', reason: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictBooking[] | null>(null);

  const save = async (acknowledge = false) => {
    setErr(null);
    if (!f.date) return setErr('Choose a date.');
    if (!f.closed && f.close <= f.open) return setErr('Closing time must be after opening time.');
    setSaving(true);
    try {
      const res = await api.saveSpecialHours({ courtId: f.court || null, date: f.date, isClosed: f.closed, open: f.closed ? null : f.open, close: f.closed ? null : f.close, reason: f.reason }, acknowledge);
      if (res.status === 'conflicts') { setConflicts(res.conflicts ?? []); return; }
      setConflicts(null);
      toast.success('Special day saved');
      setF({ ...f, date: '', reason: '' });
      await q.reload();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><CalendarOff className="size-5" /> Holidays &amp; special hours</CardTitle><CardDescription>Override the weekly hours for specific dates.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <Field label="Date" required><Input type="date" min={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Court"><Select value={f.court} onChange={(e) => setF({ ...f, court: e.target.value })}><option value="">All courts</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Hours"><Select value={f.closed ? 'closed' : 'open'} onChange={(e) => setF({ ...f, closed: e.target.value === 'closed' })}><option value="closed">Closed all day</option><option value="open">Special hours</option></Select></Field>
          {!f.closed && <>
            <Field label="Open"><Input type="time" step={900} value={f.open} onChange={(e) => setF({ ...f, open: e.target.value })} /></Field>
            <Field label="Close"><Input type="time" step={900} value={f.close} onChange={(e) => setF({ ...f, close: e.target.value })} /></Field>
          </>}
          <Field label="Reason" className={f.closed ? 'lg:col-span-3' : ''}><Input value={f.reason} maxLength={200} placeholder="e.g. Christmas Day" onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
        <Button onClick={() => save(false)} loading={saving}>Add special day</Button>
        {q.loading ? <Skeleton className="h-24" /> : (q.data ?? []).length === 0 ? <p className="text-sm text-slate-600">No upcoming special days.</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {q.data!.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{formatCalendarDate(s.date)}</span> · {s.court_id ? courts.find((c) => c.id === s.court_id)?.name ?? 'Court' : 'All courts'} ·{' '}
                  {s.is_closed ? 'Closed' : `${formatClock(s.opening_time)} – ${formatClock(s.closing_time)}`}{s.reason && <span className="text-slate-500"> · {s.reason}</span>}
                </span>
                <Button size="icon-sm" variant="ghost" aria-label="Remove special day" onClick={async () => { try { await api.deleteSpecialHours(s.id); await q.reload(); } catch (e) { toast.error("Couldn't remove", errorMessage(e)); } }}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConflictDialog open={!!conflicts} conflicts={conflicts ?? []} onClose={() => setConflicts(null)} busy={saving}
        title="Bookings exist on that date"
        body="Nothing has been saved yet. If you continue, these reservations are kept (you'll need to contact the customers, or cancel/reschedule each one). New bookings will follow the special hours."
        confirmLabel="Save and keep these bookings" onConfirm={() => void save(true)} />
    </Card>
  );
}
