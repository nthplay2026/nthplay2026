import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { money } from '@/lib/format';
import { formatClock } from '@/lib/time';
import type { FacilitySettings, PricingRule } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Pricing() {
  return (
    <AdminPage title="Pricing & rules" description="Peak / off-peak rates and the rules every booking is checked against on the server.">
      <div className="space-y-6">
        <PricingRules />
        <BookingRules />
      </div>
    </AdminPage>
  );
}

interface RuleDraft { id?: string; court_id: string; label: string; days: number[]; start_time: string; end_time: string; rate: string; priority: string; effective_from: string; effective_to: string; is_active: boolean }

function PricingRules() {
  const { courts, currency } = useFacility();
  const toast = useToast();
  const q = useAsync(() => api.pricingRules(), []);
  const [d, setD] = useState<RuleDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const open = (r?: PricingRule) => {
    setErr(null);
    setD(r ? {
      id: r.id, court_id: r.court_id ?? '', label: r.label, days: r.days_of_week ?? [], start_time: r.start_time.slice(0, 5), end_time: r.end_time.slice(0, 5),
      rate: String(r.rate), priority: String(r.priority), effective_from: r.effective_from ?? '', effective_to: r.effective_to ?? '', is_active: r.is_active,
    } : { court_id: '', label: 'Peak', days: [1, 2, 3, 4, 5], start_time: '17:00', end_time: '22:00', rate: '', priority: '0', effective_from: '', effective_to: '', is_active: true });
  };

  const save = async () => {
    if (!d) return;
    if (!d.label.trim()) return setErr('Give the rule a label (e.g. Peak).');
    if (!(Number(d.rate) >= 0) || d.rate === '') return setErr('Enter a valid rate.');
    if (d.end_time <= d.start_time) return setErr('End time must be after start time.');
    if (d.effective_from && d.effective_to && d.effective_to < d.effective_from) return setErr('"Until" must be on or after "From".');
    setSaving(true); setErr(null);
    try {
      await api.savePricingRule({
        id: d.id, court_id: d.court_id || null, label: d.label.trim(), days_of_week: d.days.length && d.days.length < 7 ? d.days : null,
        start_time: d.start_time, end_time: d.end_time, rate: Number(d.rate), currency, priority: Number(d.priority) || 0,
        effective_from: d.effective_from || null, effective_to: d.effective_to || null, is_active: d.is_active,
      });
      toast.success('Pricing rule saved', 'Applies to new bookings and quotes. Existing bookings keep their price.');
      setD(null);
      await q.reload();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  };

  const remove = async (r: PricingRule) => {
    if (!window.confirm(`Delete the "${r.label}" rule?`)) return;
    try { await api.deletePricingRule(r.id); await q.reload(); toast.success('Rule deleted'); } catch (e) { toast.error("Couldn't delete", errorMessage(e)); }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div><CardTitle>Rate rules</CardTitle><CardDescription>Time windows that override a court's standard rate. Prices are calculated in 15-minute steps, so a session spanning off-peak and peak is billed proportionally.</CardDescription></div>
        <Button size="sm" onClick={() => open()}><Plus /> Add rule</Button>
      </CardHeader>
      <CardContent>
        {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : q.loading ? <Skeleton className="h-40" /> : q.data!.length === 0 ? <p className="text-sm text-slate-600">No rules — every court uses its standard rate.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500"><tr>
                <th className="py-2 pr-4">Rule</th><th className="py-2 pr-4">Court</th><th className="py-2 pr-4">Days</th><th className="py-2 pr-4">Time</th><th className="py-2 pr-4 text-right">Rate/hr</th><th className="py-2 pr-4">Status</th><th className="py-2" />
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {q.data!.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 pr-4 font-medium">{r.label}{r.priority !== 0 && <span className="ml-1 text-xs text-slate-500">(priority {r.priority})</span>}</td>
                    <td className="py-2.5 pr-4">{r.court_id ? courts.find((c) => c.id === r.court_id)?.name ?? 'Inactive court' : 'All courts'}</td>
                    <td className="py-2.5 pr-4">{r.days_of_week ? r.days_of_week.map((x) => DAYS[x]).join(', ') : 'Every day'}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">{formatClock(r.start_time)} – {formatClock(r.end_time)}{(r.effective_from || r.effective_to) && <span className="block text-xs text-slate-500">{r.effective_from ?? '…'} → {r.effective_to ?? '…'}</span>}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">{money(r.rate, currency)}</td>
                    <td className="py-2.5 pr-4"><Badge tone={r.is_active ? 'green' : 'neutral'}>{r.is_active ? 'Active' : 'Off'}</Badge></td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <Button size="icon-sm" variant="ghost" onClick={() => open(r)} aria-label={`Edit ${r.label}`}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => remove(r)} aria-label={`Delete ${r.label}`}><Trash2 /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <Dialog open={!!d} onClose={() => setD(null)} title={d?.id ? 'Edit rate rule' : 'Add rate rule'} size="lg"
        footer={<><Button variant="outline" onClick={() => setD(null)}>Cancel</Button><Button onClick={save} loading={saving}>Save rule</Button></>}>
        {d && (
          <div className="grid gap-4 sm:grid-cols-2">
            {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
            <Field label="Label" required><Input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} maxLength={40} /></Field>
            <Field label="Court"><Select value={d.court_id} onChange={(e) => setD({ ...d, court_id: e.target.value })}><option value="">All courts</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Days</legend>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((name, i) => (
                  <label key={name} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm has-[:checked]:border-ink-900 has-[:checked]:bg-ink-900 has-[:checked]:text-white">
                    <input type="checkbox" className="sr-only" checked={d.days.includes(i)} onChange={(e) => setD({ ...d, days: e.target.checked ? [...d.days, i].sort() : d.days.filter((x) => x !== i) })} />
                    {name}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">None or all selected = every day.</p>
            </fieldset>
            <Field label="From" required><Input type="time" step={900} value={d.start_time} onChange={(e) => setD({ ...d, start_time: e.target.value })} /></Field>
            <Field label="Until" required><Input type="time" step={900} value={d.end_time} onChange={(e) => setD({ ...d, end_time: e.target.value })} /></Field>
            <Field label={`Rate per hour (${currency})`} required><Input type="number" min={0} step="0.01" value={d.rate} onChange={(e) => setD({ ...d, rate: e.target.value })} /></Field>
            <Field label="Priority" hint="Higher wins when rules overlap."><Input type="number" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value })} /></Field>
            <Field label="Valid from" optional><Input type="date" value={d.effective_from} onChange={(e) => setD({ ...d, effective_from: e.target.value })} /></Field>
            <Field label="Valid until" optional><Input type="date" value={d.effective_to} onChange={(e) => setD({ ...d, effective_to: e.target.value })} /></Field>
            <Checkbox className="sm:col-span-2" label="Active" checked={d.is_active} onChange={(e) => setD({ ...d, is_active: e.target.checked })} />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

type RuleKey = 'slot_minutes' | 'booking_interval_minutes' | 'min_duration_minutes' | 'max_duration_minutes' | 'buffer_minutes' | 'min_advance_minutes' | 'max_advance_days'
  | 'cancellation_deadline_hours' | 'reschedule_deadline_hours' | 'hold_minutes' | 'payment_due_hours' | 'reminder_hours_before';

const NUMERIC: { key: RuleKey; label: string; hint: string }[] = [
  { key: 'slot_minutes', label: 'Calendar slot length (min)', hint: '15, 30, 45, 60, 90 or 120. Default 60.' },
  { key: 'booking_interval_minutes', label: 'Start-time interval (min)', hint: 'Bookings start every N minutes from opening.' },
  { key: 'min_duration_minutes', label: 'Minimum booking (min)', hint: 'Multiple of 15.' },
  { key: 'max_duration_minutes', label: 'Maximum booking (min)', hint: 'Up to 1440 (24 hours).' },
  { key: 'buffer_minutes', label: 'Buffer after each booking (min)', hint: 'Cleaning / changeover gap. 0 = back-to-back.' },
  { key: 'min_advance_minutes', label: 'Minimum notice (min)', hint: 'How soon before start a customer can book.' },
  { key: 'max_advance_days', label: 'Book up to (days ahead)', hint: '0–365.' },
  { key: 'hold_minutes', label: 'Checkout hold (min)', hint: 'How long a selected slot is reserved during checkout (2–60).' },
  { key: 'cancellation_deadline_hours', label: 'Cancellation deadline (hours)', hint: 'Customers can cancel online until this many hours before start.' },
  { key: 'reschedule_deadline_hours', label: 'Reschedule deadline (hours)', hint: 'Same, for rescheduling.' },
  { key: 'payment_due_hours', label: 'Payment due within (hours)', hint: 'Pay-first mode: unpaid bookings are released after this.' },
  { key: 'reminder_hours_before', label: 'Reminder email (hours before)', hint: '1–168.' },
];

function BookingRules() {
  const { reload } = useFacility();
  const toast = useToast();
  const q = useAsync(() => api.adminSettings(), []);
  const [form, setForm] = useState<Partial<FacilitySettings> | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);

  const save = async () => {
    if (!form) return;
    setSaving(true); setErr(null);
    try {
      const patch: Partial<FacilitySettings> = {
        booking_confirmation_mode: form.booking_confirmation_mode, allow_cross_midnight: form.allow_cross_midnight,
        same_day_cutoff: form.same_day_cutoff || null,
      };
      for (const { key } of NUMERIC) (patch as Record<string, unknown>)[key] = Number(form[key]);
      await api.saveSettings(patch);
      toast.success('Booking rules saved', 'They apply immediately to new bookings. Existing bookings are not changed.');
      await Promise.all([q.reload(), reload()]);
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Booking rules</CardTitle><CardDescription>Checked by the database on every hold, booking and reschedule — not just in the browser.</CardDescription></CardHeader>
      <CardContent>
        {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !form ? <Skeleton className="h-64" /> : (
          <div className="space-y-5">
            {err && <Alert tone="error">{err}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {NUMERIC.map(({ key, label, hint }) => (
                <Field key={key} label={label} hint={hint}>
                  <Input type="number" min={0} value={String(form[key] ?? '')} onChange={(e) => setForm({ ...form, [key]: e.target.value as unknown as number })} />
                </Field>
              ))}
              <Field label="Same-day booking cutoff" optional hint="After this time, today can no longer be booked online.">
                <Input type="time" value={form.same_day_cutoff?.slice(0, 5) ?? ''} onChange={(e) => setForm({ ...form, same_day_cutoff: e.target.value || null })} />
              </Field>
              <Field label="Confirmation mode" hint="Pay-first keeps bookings pending until payment is verified.">
                <Select value={form.booking_confirmation_mode} onChange={(e) => setForm({ ...form, booking_confirmation_mode: e.target.value as 'auto' | 'after_payment' })}>
                  <option value="auto">Confirm immediately</option><option value="after_payment">Pending until paid</option>
                </Select>
              </Field>
            </div>
            <Checkbox label="Allow bookings that run past midnight (when both days are open)" checked={!!form.allow_cross_midnight} onChange={(e) => setForm({ ...form, allow_cross_midnight: e.target.checked })} />
            <Button onClick={save} loading={saving}>Save booking rules</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
