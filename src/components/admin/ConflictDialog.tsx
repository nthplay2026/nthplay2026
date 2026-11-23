import { TriangleAlert } from 'lucide-react';
import type { ConflictBooking } from '@/lib/types';
import { useFacility } from '@/hooks/useFacility';
import { formatDateLong, formatTime } from '@/lib/time';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Shown when an admin change (hours, closures, deactivation, blocks) would affect
 * existing bookings. Nothing is changed until the admin makes an explicit choice;
 * bookings are never deleted silently.
 */
export function ConflictDialog({ open, conflicts, title, body, confirmLabel, onConfirm, onClose, busy, blocking = false }: {
  open: boolean; conflicts: ConflictBooking[]; title: string; body: string; confirmLabel?: string;
  onConfirm?: () => void; onClose: () => void; busy?: boolean; blocking?: boolean;
}) {
  const { tz } = useFacility();
  return (
    <Dialog open={open} onClose={onClose} title={title} size="lg"
      footer={<>
        <Button variant="outline" onClick={onClose}>{blocking ? 'Close' : 'Cancel change'}</Button>
        {!blocking && onConfirm && <Button variant="danger" onClick={onConfirm} loading={busy}>{confirmLabel ?? 'Apply and keep these bookings'}</Button>}
      </>}>
      <div className="flex gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p>{body}</p>
      </div>
      <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
        {conflicts.map((c) => (
          <li key={c.booking_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <div>
              <p className="font-semibold">{c.customer_name} <code className="ml-1 text-xs text-slate-500">{c.booking_reference}</code></p>
              <p className="text-slate-600">{c.court_name ? `${c.court_name} · ` : ''}{formatDateLong(c.start_at, tz)}, {formatTime(c.start_at, tz)} – {formatTime(c.end_at, tz)}</p>
            </div>
            <a href={`/admin/bookings?ref=${encodeURIComponent(c.booking_reference)}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 hover:underline">Open</a>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
