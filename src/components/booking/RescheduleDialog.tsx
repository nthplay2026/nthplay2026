import { useEffect, useState } from 'react';
import { useFacility } from '@/hooks/useFacility';
import { slotKey, useLiveAvailability } from '@/hooks/useLiveAvailability';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateLong, formatDuration, formatTime, localDate } from '@/lib/time';
import { money } from '@/lib/format';
import type { AvailabilitySlot, Booking } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/misc';
import { DateStrip } from './DateStrip';
import { SlotGrid } from './SlotGrid';
import { LiveIndicator } from './LiveIndicator';

/** Pick a new time on the same court. The server re-validates and re-prices. */
export function RescheduleDialog({ booking, open, onClose, onDone, staff = false }: {
  booking: Booking; open: boolean; onClose: () => void; onDone: () => void; staff?: boolean;
}) {
  const { settings, courts, tz, today } = useFacility();
  const [date, setDate] = useState(() => localDate(booking.start_at, tz));
  const [sel, setSel] = useState<AvailabilitySlot | null>(null);
  const [duration, setDuration] = useState(booking.duration_minutes);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const live = useLiveAvailability(open ? date : null, booking.court_id);
  const court = courts.find((c) => c.id === booking.court_id);
  const rules = useAsync(() => api.pricingRules(), []);
  const options = useAsync(() => (sel?.slot_start ? api.bookingOptions(booking.court_id, sel.slot_start) : Promise.resolve([])), [sel?.slot_start, live.lastUpdated], { enabled: !!sel });

  useEffect(() => { setSel(null); }, [date]);
  useEffect(() => {
    if (sel && !live.slots.some((s) => slotKey(s) === slotKey(sel) && s.status === 'available')) setSel(null);
  }, [live.slots, sel]);

  const save = async () => {
    if (!sel?.slot_start) return;
    setSaving(true);
    setError(null);
    try {
      await api.rescheduleBooking(booking.id, sel.slot_start, duration);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      void live.reload();
    } finally {
      setSaving(false);
    }
  };

  const opt = options.data?.find((o) => o.duration_minutes === duration);

  return (
    <Dialog open={open} onClose={onClose} size="xl" title="Reschedule booking"
      description={`Currently ${court?.name ?? 'Court'} · ${formatDateLong(booking.start_at, tz)}, ${formatTime(booking.start_at, tz)} – ${formatTime(booking.end_at, tz)}`}
      footer={<>
        <Button variant="outline" onClick={onClose}>Keep current time</Button>
        <Button onClick={save} loading={saving} disabled={!sel || (opt ? !opt.available : false)}>Move booking</Button>
      </>}>
      <div className="space-y-4">
        {!staff && settings && (
          <Alert tone="info">Rescheduling is available up to {settings.reschedule_deadline_hours} hours before your booking. The price is recalculated for the new time.</Alert>
        )}
        <div className="flex justify-end"><LiveIndicator status={live.status} lastUpdated={live.lastUpdated} /></div>
        <DateStrip value={date} onChange={setDate} today={today} maxDays={staff ? 365 : settings?.max_advance_days ?? 30} days={10} />
        {live.error ? <Alert tone="error">{live.error}</Alert> : live.loading ? <Skeleton className="h-40" /> : court && (
          <SlotGrid courts={[court]} slots={live.slots} rules={rules.data ?? []} tz={tz} currency={booking.currency} isSelected={(s) => !!sel && slotKey(s) === slotKey(sel)}
            justTaken={live.justTaken} onSelect={(s) => setSel(s)} />
        )}
        {sel && (
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-ink-800">New time: <strong>{formatDateLong(sel.slot_start!, tz)}, {formatTime(sel.slot_start!, tz)}</strong></p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Duration">
              {(options.data ?? []).map((o) => (
                <button key={o.duration_minutes} type="button" disabled={!o.available} aria-pressed={duration === o.duration_minutes}
                  onClick={() => setDuration(o.duration_minutes)}
                  className={cn('rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50',
                    duration === o.duration_minutes ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300')}>
                  {formatDuration(o.duration_minutes)}{o.total != null && ` · ${money(o.total, booking.currency)}`}
                </button>
              ))}
            </div>
            {opt && !opt.available && <p className="mt-2 text-sm text-red-700">{opt.reason ?? 'That length is not available at this time.'}</p>}
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
}
