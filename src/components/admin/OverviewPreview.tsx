import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import type { BookingGroup } from '@/lib/bookingGroups';
import { formatDateLong, formatDateTime, formatTime } from '@/lib/time';
import { money } from '@/lib/format';
import type { Payment } from '@/lib/types';
import { buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { BookingStatusBadge, PaymentStatusBadge, PaymentTxnBadge } from '@/components/booking/StatusBadges';

export type PreviewItems = { kind: 'bookings'; rows: BookingGroup[] } | { kind: 'payments'; rows: Payment[] };

export interface PreviewSpec {
  title: string;
  description?: string;
  /** Full page with the same filter. */
  link: string;
  linkLabel: string;
  load: () => Promise<PreviewItems>;
}

/** A quick look at what's behind a dashboard card, with a way to open the full page. */
export function OverviewPreview({ spec, onClose, onOpenBooking }: {
  spec: PreviewSpec | null; onClose: () => void; onOpenBooking: (bookingId: string) => void;
}) {
  const { tz } = useFacility();
  const q = useAsync(() => (spec ? spec.load() : Promise.resolve(null)), [spec], { enabled: !!spec });
  const data = q.data;

  return (
    <Dialog open={!!spec} onClose={onClose} size="lg" title={spec?.title ?? ''} description={spec?.description}
      footer={spec && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonVariants({ variant: 'outline' })}><ArrowLeft /> Back</button>
          <Link to={spec.link} className={buttonVariants()}>{spec.linkLabel} <ArrowRight /></Link>
        </div>
      )}>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : q.loading || !data ? <Skeleton className="h-56" /> : data.rows.length === 0 ? (
        <EmptyState className="py-8" title="Nothing here right now" />
      ) : data.kind === 'bookings' ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {data.rows.map((g) => {
            const b = g.bookings[0];
            return (
              <li key={g.reference}>
                <button type="button" onClick={() => onOpenBooking(b.id)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block font-medium text-ink-900">{b.customer_name}</span>
                    <span className="block text-xs text-slate-500">
                      {formatDateLong(g.start_at, tz)} · {g.bookings.map((x) => `${formatTime(x.start_at, tz)}–${formatTime(x.end_at, tz)}`).join(', ')} · <span className="font-mono">{g.reference}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <BookingStatusBadge status={g.booking_status} />
                    <PaymentStatusBadge status={g.payment_status} />
                    <span className="w-24 text-right font-semibold tabular-nums">{money(g.total, g.currency)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {data.rows.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onOpenBooking(p.booking_id)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50">
                <span>
                  <span className="block font-medium text-ink-900">{p.bookings?.customer_name}</span>
                  <span className="block text-xs text-slate-500">
                    <span className="font-mono">{p.bookings?.group_ref || p.bookings?.booking_reference}</span> · submitted {formatDateTime(p.created_at, tz)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <PaymentTxnBadge status={p.payment_status} />
                  <span className="w-24 text-right font-semibold tabular-nums">{money(p.amount, p.currency)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
