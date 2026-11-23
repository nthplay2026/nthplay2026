import { Link, useParams, useSearchParams } from 'react-router';
import { CalendarPlus, CheckCircle2, Clock3, ListChecks, Receipt } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { api } from '@/lib/api';
import { toGroup } from '@/lib/bookingGroups';
import { buttonVariants } from '@/components/ui/button';
import { Alert, Card, EmptyState, PageLoader } from '@/components/ui/misc';
import { SummaryRow } from '@/components/booking/Summary';
import { GroupSummary } from '@/components/booking/GroupSummary';
import { PaymentForm } from '@/components/booking/PaymentForm';
import { CopyReference } from '@/components/booking/CopyReference';
import { BookingStatusBadge, PaymentStatusBadge } from '@/components/booking/StatusBadges';
import { formatDateTime } from '@/lib/time';

export default function ConfirmationPage() {
  const { reference = '' } = useParams();
  const { settings, tz } = useFacility();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const q = useAsync(() => api.bookingGroup(reference), [reference]);
  const ids = (q.data ?? []).map((b) => b.id);
  const pays = useAsync(() => api.groupPayments(ids), [ids.join(','), (q.data ?? []).map((b) => b.updated_at).join(',')], { enabled: ids.length > 0 });

  if (q.loading && !q.data) return <PageLoader />;
  if (q.error) return <div className="container-page py-12"><Alert tone="error" title="We couldn't load your booking">{q.error}</Alert></div>;
  if (!q.data?.length) {
    return (
      <div className="container-page py-16">
        <EmptyState title="Booking not found" action={<Link className={buttonVariants()} to="/my-bookings">Go to My Bookings</Link>}>
          We couldn't find a booking with reference {reference} on your account.
        </EmptyState>
      </div>
    );
  }
  const g = toGroup(q.data);
  const b = g.bookings[0];
  const pending = g.booking_status === 'pending';
  const manual = b.payment_method === 'gcash' || b.payment_method === 'bank_transfer';
  const manualMethods = (settings?.payment_methods ?? []).filter((m) => m.enabled && (m.method === 'gcash' || m.method === 'bank_transfer'));
  const submitted = (pays.data ?? []).some((p) => p.payment_status === 'pending' || p.payment_status === 'paid');
  const owing = g.bookings.filter((x) => (x.booking_status === 'pending' || x.booking_status === 'confirmed') && x.total_amount > x.amount_paid)
    .map((x) => ({ bookingId: x.id, amount: x.total_amount - x.amount_paid }));
  const needsPayment = manual && !submitted && owing.length > 0 && !pays.loading;
  const dueAt = g.bookings.map((x) => x.payment_due_at).filter(Boolean).sort()[0];

  return (
    <div className="container-page max-w-3xl py-10 sm:py-14">
      <div className="text-center">
        <div className={`mx-auto grid size-16 place-items-center rounded-full ${pending ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700'}`}>
          {pending ? <Clock3 className="size-8" /> : <CheckCircle2 className="size-8" />}
        </div>
        <h1 className="mt-5 text-3xl font-bold text-ink-900 sm:text-4xl">{pending ? 'Reservation received' : "You're booked!"}</h1>
        <p className="mx-auto mt-2 max-w-lg text-slate-600">
          {!pending
            ? <>Your court is confirmed. We've emailed the details to <strong>{b.customer_email}</strong>.</>
            : submitted || pays.loading
              ? <>Thanks for your payment! Our staff will check your receipt, and once it's verified they'll <strong>confirm your booking</strong>.</>
              : <>Please pay and upload your receipt{dueAt ? <> by <strong>{formatDateTime(dueAt, tz)}</strong></> : ''}, or this time will be released for other players.</>}
        </p>
        <div className="mt-6 flex flex-col items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Booking reference</span>
          <CopyReference value={g.reference} large />
        </div>
      </div>

      <Card className="mt-8 p-5 sm:p-6">
        <GroupSummary group={g} tz={tz}
          extra={<>
            <SummaryRow label="Booking status"><BookingStatusBadge status={g.booking_status} /></SummaryRow>
            <SummaryRow label="Payment"><PaymentStatusBadge status={g.payment_status} /></SummaryRow>
          </>} />
      </Card>

      {manual && (
        <Card className="mt-4 p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Receipt className="size-5 text-brand-700" /> Payment</h2>
          {submitted ? (
            <Alert tone="success" className="mt-3" title="Receipt received">
              Our staff will verify your receipt. Once it's confirmed, they'll confirm your booking and you'll see it under My Bookings. You don't need to do anything else.
            </Alert>
          ) : needsPayment && user ? (
            <>
              {params.get('payment') === 'failed' && (
                <Alert tone="warning" className="mt-3" title="We saved your booking, but your receipt didn't upload">
                  {params.get('reason') || 'Please upload your receipt again below.'}
                </Alert>
              )}
              <div className="mt-3">
                <PaymentForm targets={owing} userId={user.id} currency={g.currency} methods={manualMethods}
                  defaultMethod={b.payment_method === 'bank_transfer' ? 'bank_transfer' : 'gcash'}
                  title="Pay now with a QR code, then upload your receipt"
                  onDone={() => { void pays.reload(); void q.reload(); }} />
              </div>
            </>
          ) : null}
        </Card>
      )}

      <Card className="mt-4 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><ListChecks className="size-5 text-brand-700" /> Next steps</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-800">
          {manual && !submitted && <li>Pay with a QR code above and upload a photo of your receipt so we can verify it.</li>}
          {manual && submitted && pending && <li>Wait for our staff to verify your receipt and confirm your booking.</li>}
          <li>Arrive about 10 minutes early and show your booking reference at the desk.</li>
          <li>Need to change plans? Message or call us and we'll move your booking to another available time.</li>
        </ol>
      </Card>

      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <Link to={`/my-bookings/${g.reference}`} className={buttonVariants({ size: 'lg' })}>View booking</Link>
        <Link to="/book" className={buttonVariants({ size: 'lg', variant: 'outline' })}><CalendarPlus /> Book another court</Link>
      </div>
    </div>
  );
}
