import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Receipt, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { toGroup } from '@/lib/bookingGroups';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/time';
import { money, paymentMethodLabel } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, Card, CardContent, CardHeader, CardTitle, EmptyState, PageLoader } from '@/components/ui/misc';
import { SummaryRow } from '@/components/booking/Summary';
import { GroupSummary } from '@/components/booking/GroupSummary';
import { PaymentForm } from '@/components/booking/PaymentForm';
import { BookingStatusBadge, PaymentStatusBadge, PaymentTxnBadge } from '@/components/booking/StatusBadges';
import { CopyReference } from '@/components/booking/CopyReference';
import { FacebookButton, InstagramButton, PhoneButton } from '@/components/layout/ContactButtons';

export default function BookingDetailsPage() {
  const { reference = '' } = useParams();
  const { user } = useAuth();
  const { settings, tz } = useFacility();
  const q = useAsync(() => api.bookingGroup(reference), [reference]);
  const ids = (q.data ?? []).map((b) => b.id);
  const idsKey = ids.join(',');
  const pays = useAsync(() => api.groupPayments(ids), [idsKey, (q.data ?? []).map((b) => b.updated_at).join(',')], { enabled: ids.length > 0 });

  // Reflect staff actions (payment verified, status changes) live.
  useEffect(() => {
    if (!ids.length) return;
    const ch = supabase.channel(`booking:${reference}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=in.(${idsKey})` }, () => { void q.reload(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `booking_id=in.(${idsKey})` }, () => { void pays.reload(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (q.loading && !q.data) return <PageLoader />;
  if (q.error) return <div className="container-page py-12"><Alert tone="error" title="We couldn't load this booking">{q.error}</Alert></div>;
  if (!q.data?.length) {
    return (
      <div className="container-page py-16">
        <EmptyState title="Booking not found" action={<Link className={buttonVariants()} to="/my-bookings">Back to My Bookings</Link>}>
          There's no booking {reference} on your account.
        </EmptyState>
      </div>
    );
  }

  const g = toGroup(q.data);
  const b = g.bookings[0];
  const live = g.booking_status === 'pending' || g.booking_status === 'confirmed';
  const hasPending = (pays.data ?? []).some((p) => p.payment_status === 'pending');
  const owing = g.bookings.filter((x) => (x.booking_status === 'pending' || x.booking_status === 'confirmed') && x.total_amount > x.amount_paid)
    .map((x) => ({ bookingId: x.id, amount: x.total_amount - x.amount_paid }));
  const manualMethods = (settings?.payment_methods ?? []).filter((m) => m.enabled && (m.method === 'gcash' || m.method === 'bank_transfer'));
  const canSubmitPayment = live && owing.length > 0 && !hasPending && manualMethods.length > 0;
  const dueAt = g.bookings.filter((x) => x.booking_status === 'pending').map((x) => x.payment_due_at).filter(Boolean).sort()[0];
  const allCancelled = g.bookings.every((x) => x.booking_status === 'cancelled');

  return (
    <div className="container-page max-w-4xl py-8 sm:py-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link to="/my-bookings" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-ink-900">
          <ArrowLeft className="size-4" /> My bookings
        </Link>
        <Button variant="outline" size="sm" onClick={() => { void q.reload(); void pays.reload(); }} loading={q.loading && !!q.data} aria-label="Refresh this booking">
          <RefreshCw /> Refresh
        </Button>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-ink-900">{b.courts?.name ?? 'Court'} booking</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={g.booking_status} />
            <PaymentStatusBadge status={g.payment_status} />
          </div>
        </div>
        <CopyReference value={g.reference} />
      </div>

      {g.booking_status === 'pending' && (hasPending ? (
        <Alert tone="info" className="mt-5" title="Receipt received">
          Our staff will verify your receipt. Once it's confirmed, they'll confirm your booking.
        </Alert>
      ) : dueAt && (
        <Alert tone="warning" className="mt-5" title="Payment needed to confirm">
          Pay and upload your receipt by {formatDateTime(dueAt, tz)}, or this time is released automatically.
        </Alert>
      ))}
      {allCancelled && (
        <Alert tone="info" className="mt-5" title="This booking was cancelled">
          {b.cancellation_reason ? `Reason: ${b.cancellation_reason}` : 'The time has been released.'}
        </Alert>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <GroupSummary group={g} tz={tz}
              extra={<>
                <SummaryRow label="Name">{b.customer_name}</SummaryRow>
                {b.notes && <SummaryRow label="Notes">{b.notes}</SummaryRow>}
                <SummaryRow label="Payment method">{b.payment_method ? paymentMethodLabel[b.payment_method] : '—'}</SummaryRow>
                <SummaryRow label="Paid so far">{money(g.paid, g.currency)}</SummaryRow>
              </>} />
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="size-5 text-brand-700" /> Payments</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {(pays.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-600">No payments recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {pays.data!.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <div>
                        <p className="font-medium">{paymentMethodLabel[p.payment_method]} · {money(p.amount, p.currency)}</p>
                        <p className="text-xs text-slate-500">
                          {p.transaction_reference ? <>Ref {p.transaction_reference} · </> : p.proof_of_payment_path ? <>Receipt uploaded · </> : null}submitted {formatDateTime(p.created_at, tz)}
                          {p.review_note && p.payment_status === 'failed' && <> · {p.review_note}</>}
                        </p>
                      </div>
                      <PaymentTxnBadge status={p.payment_status} />
                    </li>
                  ))}
                </ul>
              )}
              {canSubmitPayment && user && (
                <PaymentForm targets={owing} userId={user.id} currency={g.currency} methods={manualMethods}
                  defaultMethod={b.payment_method === 'gcash' || b.payment_method === 'bank_transfer' ? b.payment_method : undefined}
                  onDone={() => { void pays.reload(); void q.reload(); }} />
              )}
            </CardContent>
          </Card>
        </div>

        {live && (
          <aside className="space-y-3">
            <Card className="p-5">
              <h2 className="font-semibold">Need to change this booking?</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Message or call us and we'll move or cancel it for you. Any time you give up opens for other players right away.
              </p>
              <div className="mt-4 flex gap-2">
                <FacebookButton />
                <InstagramButton />
                {settings?.contact_phone && <PhoneButton phone={settings.contact_phone} />}
              </div>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}
