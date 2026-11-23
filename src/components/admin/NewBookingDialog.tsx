import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useLiveAvailability } from '@/hooks/useLiveAvailability';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDuration, formatTime, localDate } from '@/lib/time';
import { money, paymentMethodLabel } from '@/lib/format';
import type { CustomerRow, PaymentMethod } from '@/lib/types';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

/**
 * Staff booking on behalf of a customer (phone / walk-in). Uses the same
 * server-side conflict check as online bookings; staff may bypass the
 * advance-notice and horizon limits but never operating hours or overlaps.
 */
export function NewBookingDialog({ open, onClose, onCreated, initial }: {
  open: boolean; onClose: () => void; onCreated: (ref: string) => void;
  initial?: { courtId?: string; start?: string };
}) {
  const { courts, settings, tz, today, currency } = useFacility();
  const toast = useToast();
  const [courtId, setCourtId] = useState(initial?.courtId ?? courts[0]?.id ?? '');
  const [date, setDate] = useState(initial?.start ? localDate(initial.start, tz) : today);
  const [start, setStart] = useState(initial?.start ?? '');
  const [duration, setDuration] = useState<number | null>(null);
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [form, setForm] = useState({ name: '', email: '', phone: '', players: '', notes: '' });
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [status, setStatus] = useState<'confirmed' | 'pending'>('confirmed');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCourtId(initial?.courtId ?? courts[0]?.id ?? '');
    setDate(initial?.start ? localDate(initial.start, tz) : today);
    setStart(initial?.start ?? '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.courtId, initial?.start]);

  const live = useLiveAvailability(open && courtId ? date : null, courtId || null);
  const free = useMemo(() => live.slots.filter((s) => s.slot_start && s.status === 'available'), [live.slots]);
  const options = useAsync(() => (start && courtId ? api.bookingOptions(courtId, start) : Promise.resolve([])), [start, courtId, live.lastUpdated], { enabled: !!(start && courtId) });
  useEffect(() => {
    const ok = (options.data ?? []).filter((o) => o.available);
    if (!ok.some((o) => o.duration_minutes === duration)) setDuration(ok[0]?.duration_minutes ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data]);
  const people = useAsync(() => (debounced.trim().length >= 2 ? api.searchCustomers(debounced.trim(), 6, 0) : Promise.resolve([])), [debounced]);

  const pick = (c: CustomerRow) => {
    setCustomer(c);
    setForm((f) => ({ ...f, name: c.full_name ?? '', email: c.email ?? '', phone: c.mobile_number ?? '' }));
    setSearch('');
  };

  const save = async () => {
    if (!start || !duration) return;
    setSaving(true); setError(null);
    try {
      const b = await api.adminCreateBooking({
        courtId, start, duration, name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null,
        customerId: customer?.id ?? null, players: form.players ? Number(form.players) : null, notes: form.notes || null,
        paymentMethod: method, status,
      });
      toast.success('Booking created', b.booking_reference);
      onCreated(b.booking_reference);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      void live.reload();
    } finally {
      setSaving(false);
    }
  };

  const enabledMethods = (settings?.payment_methods ?? []).filter((m) => m.enabled);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const opt = options.data?.find((o) => o.duration_minutes === duration);

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="New booking" description="Create a reservation for a customer or walk-in."
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!start || !duration || form.name.trim().length < 2}>
          Create booking{opt?.total != null && ` · ${money(opt.total, currency)}`}
        </Button>
      </>}>
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Court" required>
            <Select value={courtId} onChange={(e) => { setCourtId(e.target.value); setStart(''); }}>
              {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={date} min={today} onChange={(e) => { setDate(e.target.value); setStart(''); }} />
          </Field>
          <Field label="Start time" required hint={live.loading ? 'Loading…' : free.length === 0 ? 'No free times on this date.' : undefined}>
            <Select value={start} onChange={(e) => setStart(e.target.value)}>
              <option value="">Choose…</option>
              {free.map((s) => <option key={s.slot_start} value={s.slot_start!}>{formatTime(s.slot_start!, tz)}</option>)}
            </Select>
          </Field>
        </div>
        {start && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Duration">
            {(options.data ?? []).map((o) => (
              <button key={o.duration_minutes} type="button" disabled={!o.available} aria-pressed={duration === o.duration_minutes}
                onClick={() => setDuration(o.duration_minutes)} title={o.reason ?? undefined}
                className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 ${duration === o.duration_minutes ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300'}`}>
                {formatDuration(o.duration_minutes)}{o.total != null && ` · ${money(o.total, currency)}`}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-3 text-sm font-semibold">Customer</p>
          {customer ? (
            <p className="mb-3 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm">
              <span>Linked to account <strong>{customer.email}</strong> — they'll see it in My Bookings.</span>
              <button type="button" className="font-medium text-brand-700" onClick={() => setCustomer(null)}>Unlink</button>
            </p>
          ) : (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden />
              <Input className="pl-9" placeholder="Search existing customers by name, email or phone (optional)" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
              {(people.data ?? []).length > 0 && search && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lift">
                  {people.data!.map((p) => (
                    <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => pick(p)}>
                      <span className="font-medium">{p.full_name ?? '—'}</span> <span className="text-slate-500">{p.email} · {p.mobile_number}</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required><Input value={form.name} onChange={set('name')} /></Field>
            <Field label="Mobile"><Input type="tel" value={form.phone} onChange={set('phone')} /></Field>
            <Field label="Email" hint="Optional — used for the confirmation email."><Input type="email" value={form.email} onChange={set('email')} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {enabledMethods.map((m) => <option key={m.method} value={m.method}>{m.label || paymentMethodLabel[m.method]}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as 'confirmed' | 'pending')}>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending (awaiting payment)</option>
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
