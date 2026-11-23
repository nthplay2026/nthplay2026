import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Check, Eye } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { useStaffFeed } from '@/hooks/useStaffFeed';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/time';
import { money, paymentMethodLabel } from '@/lib/format';
import type { Payment } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { BookingPanel } from '@/components/admin/BookingPanel';
import { Button } from '@/components/ui/button';
import { Alert, Card, EmptyState, ErrorState, Pagination, Skeleton, Tabs } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { PaymentTxnBadge } from '@/components/booking/StatusBadges';
import { useVerifyPayment } from '@/components/admin/VerifyPayment';

type Tab = 'pending' | 'paid' | 'failed' | 'refunded' | '';
const PAGE = 25;

export default function Payments() {
  const { isAdmin } = useAuth();
  const { tz } = useFacility();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab | null) ?? 'pending');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useAsync(() => api.payments({ status: tab, page, pageSize: PAGE }), [tab, page]);
  useStaffFeed(() => { void q.reload(); }, ['payments']);

  // One receipt covering several time blocks is recorded once per block; show it as one payment.
  const rows = useMemo(() => {
    const m = new Map<string, Payment[]>();
    for (const p of q.data?.rows ?? []) {
      const k = p.proof_of_payment_path ? `${p.proof_of_payment_path}|${p.payment_status}` : p.id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.values()];
  }, [q.data]);

  const verifiers = useAsync(() => api.profilesByIds([...new Set((q.data?.rows ?? []).map((p) => p.verified_by).filter(Boolean) as string[])]), [q.data]);
  const verifierName = (id: string | null) => {
    const v = verifiers.data?.find((x) => x.id === id);
    return v ? v.full_name || v.email : null;
  };

  // Verifying a payment also confirms its booking.
  const verifier = useVerifyPayment(() => { void q.reload(); });
  const verify = async (ps: Payment[]) => {
    const p = ps[0];
    setBusy(p.id);
    try {
      await verifier.start({ ids: ps.map((x) => x.id), amount: ps.reduce((s, x) => s + x.amount, 0), currency: p.currency, proofPath: p.proof_of_payment_path });
    }
    catch (e) { toast.error("Couldn't verify", errorMessage(e)); }
    finally { setBusy(null); }
  };

  return (
    <AdminPage title="Payments" description="Verify manual payments against your bank / GCash records. Customers can never mark their own payments as paid.">
      {!isAdmin && <Alert tone="info" className="mb-4">Only administrators can verify, reject or refund payments. Staff can record cash received at the desk from a booking.</Alert>}
      <Tabs label="Payment status" value={tab} onChange={(v) => { setTab(v); setPage(0); }}
        items={[{ value: 'pending', label: 'To verify' }, { value: 'paid', label: 'Verified' }, { value: 'failed', label: 'Rejected' }, { value: 'refunded', label: 'Refunded' }, { value: '', label: 'All' }]} />
      <Card className="mt-4 overflow-hidden">
        {q.error ? <div className="p-4"><ErrorState message={q.error} onRetry={q.reload} /></div> : q.loading && !q.data ? <Skeleton className="m-4 h-64" /> : q.data!.rows.length === 0 ? (
          <EmptyState className="m-4" title={tab === 'pending' ? 'No payments waiting for verification' : 'No payments here yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Submitted</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Booking</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Method · reference</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((ps) => {
                  const p = ps[0];
                  const ref = p.bookings?.group_ref || p.bookings?.booking_reference;
                  const amount = ps.reduce((s, x) => s + x.amount, 0);
                  const bookingTotal = ps.reduce((s, x) => s + (x.bookings?.total_amount ?? 0), 0);
                  return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-4 py-3">{formatDateTime(p.created_at, tz)}</td>
                    <td className="px-4 py-3">
                      <button type="button" className="text-left" onClick={() => setOpen(p.booking_id)}>
                        <span className="font-mono text-xs font-semibold text-brand-700 hover:underline">{ref}</span>
                        <span className="block text-xs text-slate-500">{p.bookings?.customer_name} · booking total {money(bookingTotal, p.currency)}{ps.length > 1 && ` · ${ps.length} time blocks`}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3">{paymentMethodLabel[p.payment_method]}<span className="block font-mono text-xs text-slate-500">{p.transaction_reference ?? p.provider_payment_id ?? '—'}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{money(amount, p.currency)}</td>
                    <td className="px-4 py-3">
                      <PaymentTxnBadge status={p.payment_status} />
                      {p.verified_by && verifierName(p.verified_by) && (
                        <span className="mt-1 block text-xs text-slate-500">
                          {p.payment_status === 'failed' ? 'Rejected' : 'Verified'} by <span className="font-medium text-ink-800">{verifierName(p.verified_by)}</span>
                          {p.verified_at && <> · {formatDateTime(p.verified_at, tz)}</>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {p.proof_of_payment_path && (
                          <Button size="sm" variant="ghost" onClick={async () => { try { window.open(await api.proofUrl(p.proof_of_payment_path!), '_blank', 'noopener'); } catch (e) { toast.error('Could not open file', errorMessage(e)); } }}>
                            <Eye /> Proof
                          </Button>
                        )}
                        {!p.proof_of_payment_path && p.receipt_purged_at && <span className="self-center text-xs text-slate-500">Receipt deleted after 45 days</span>}
                        {isAdmin && p.payment_status === 'pending' && <Button size="sm" loading={busy === p.id} onClick={() => verify(ps)}><Check /> Verify &amp; confirm</Button>}
                        <Button size="sm" variant="outline" onClick={() => setOpen(p.booking_id)}>Open</Button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {q.data && <div className="px-4 pb-4"><Pagination page={page} pageSize={PAGE} total={q.data.count} onPage={setPage} /></div>}
      </Card>
      <BookingPanel bookingId={open} onClose={() => setOpen(null)} onChanged={() => void q.reload()} />
      {verifier.dialog}
    </AdminPage>
  );
}
