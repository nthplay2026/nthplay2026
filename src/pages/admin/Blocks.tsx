import { useState } from 'react';
import { Trash2, Wrench } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { useStaffFeed } from '@/hooks/useStaffFeed';
import { api } from '@/lib/api';
import { errorMessage, isAppError } from '@/lib/errors';
import { formatDateLong, formatDateTime, formatTime, fromLocalInput } from '@/lib/time';
import type { ConflictBooking } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { ConflictDialog } from '@/components/admin/ConflictDialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

export default function Blocks() {
  const { courts, tz, today } = useFacility();
  const toast = useToast();
  const q = useAsync(() => api.blockedSlots(new Date().toISOString()), []);
  useStaffFeed(() => { void q.reload(); }, ['slot_locks']);
  const [sel, setSel] = useState<string[]>([]);
  const [start, setStart] = useState(`${today}T12:00`);
  const [end, setEnd] = useState(`${today}T14:00`);
  const [reason, setReason] = useState('Maintenance');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictBooking[] | null>(null);

  const create = async () => {
    setErr(null);
    if (!sel.length) return setErr('Choose at least one court.');
    if (!start || !end || end <= start) return setErr('The block must end after it starts.');
    if (!reason.trim()) return setErr('Give a reason (customers see "Maintenance").');
    setSaving(true);
    try {
      await api.createBlock(sel, fromLocalInput(start, tz).toISOString(), fromLocalInput(end, tz).toISOString(), reason.trim());
      toast.success('Time blocked', 'Those slots are now unavailable to customers.');
      await q.reload();
    } catch (e) {
      if (isAppError(e) && e.code === 'BLOCK_CONFLICT' && Array.isArray(e.detail)) setConflicts(e.detail as ConflictBooking[]);
      else setErr(errorMessage(e));
    } finally { setSaving(false); }
  };

  return (
    <AdminPage title="Maintenance & blocked slots" description="Close courts for maintenance, coaching or private events. Blocks never override existing bookings.">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="size-5" /> Block time</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {err && <Alert tone="error">{err}</Alert>}
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Courts</legend>
              <div className="flex flex-wrap gap-2">
                {courts.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm has-[:checked]:border-ink-900 has-[:checked]:bg-ink-900 has-[:checked]:text-white">
                    <input type="checkbox" className="sr-only" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />{c.name}
                  </label>
                ))}
                <button type="button" className="text-sm font-medium text-brand-700" onClick={() => setSel(courts.map((c) => c.id))}>Select all</button>
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From" required hint="Facility time"><Input type="datetime-local" step={900} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="Until" required><Input type="datetime-local" step={900} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <Field label="Reason" required><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
            <p className="text-xs text-slate-500">Any customer currently holding one of these slots in checkout will be told the time is no longer available.</p>
            <Button onClick={create} loading={saving}>Block time</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Upcoming blocks</CardTitle></CardHeader>
          <CardContent>
            {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : q.loading ? <Skeleton className="h-40" /> : (q.data ?? []).length === 0 ? (
              <EmptyState title="No blocked time" className="py-8" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {q.data!.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span>
                      <span className="font-medium">{courts.find((c) => c.id === b.court_id)?.name ?? 'Court'} · {b.reason}</span>
                      <span className="block text-slate-500">{formatDateLong(b.start_at, tz)} {formatTime(b.start_at, tz)} → {formatDateTime(b.end_at, tz)}</span>
                    </span>
                    <Button size="icon-sm" variant="ghost" aria-label="Remove block" onClick={async () => { try { await api.deleteBlock(b.id); toast.success('Block removed', 'The time is bookable again.'); await q.reload(); } catch (e) { toast.error("Couldn't remove", errorMessage(e)); } }}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <ConflictDialog open={!!conflicts} conflicts={conflicts ?? []} onClose={() => setConflicts(null)} blocking
        title="Bookings overlap this block"
        body="Nothing was blocked. Cancel or reschedule these bookings first (open each one), then try again — or choose a different time." />
    </AdminPage>
  );
}
