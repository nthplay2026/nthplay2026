import { useEffect, useState } from 'react';
import { Ban, CalendarClock, Check, CheckCheck, Eye, Pencil, Receipt, RotateCcw, UserX, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateLong, formatDateTime, formatDuration, formatTime } from '@/lib/time';
import { money, paymentMethodLabel } from '@/lib/format';
import { toGroup } from '@/lib/bookingGroups';
import { describeBookingAudit } from '@/lib/activity';
import { cn } from '@/lib/utils';
import type { Booking, BookingStatus, Payment } from '@/lib/types';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Alert, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { BookingStatusBadge, PaymentStatusBadge, PaymentTxnBadge } from '@/components/booking/StatusBadges';
import { CopyReference } from '@/components/booking/CopyReference';
import { RescheduleDialog } from '@/components/booking/RescheduleDialog';
import { useVerifyPayment } from './VerifyPayment';

type Mode = null | 'cancel' | 'cash' | 'edit' | 'reschedule' | 'rejectAll' | { reject: Payment } | { refund: Payment };

/** Staff view of one booking with every allowed action. */
export function BookingPanel({ bookingId, onClose, onChanged }: { bookingId: string | null; onClose: () => void; onChanged?: () => void }) {
  const { isAdmin } = useAuth();
  const { tz } = useFacility();
  const toast = useToast();
  // Blocks booked together are one booking: the panel shows the group and one block at a time.
  const [currentId, setCurrentId] = useState(bookingId);
  useEffect(() => setCurrentId(bookingId), [bookingId]);
  const q = useAsync(() => (currentId ? api.bookingById(currentId) : Promise.resolve(null)), [currentId], { enabled: !!currentId });
  const b = q.data ?? null;
  const group = useAsync(() => (b?.group_ref ? api.bookingGroup(b.group_ref) : Promise.resolve(b ? [b] : [])),
    [b?.id, b?.group_ref, b?.updated_at], { enabled: !!b });
  const blocks = group.data ?? [];
  const groupPays = useAsync(() => api.groupPayments(blocks.map((x) => x.id)),
    [blocks.map((x) => `${x.id}:${x.updated_at}`).join(',')], { enabled: blocks.length > 1 });
  const pays = useAsync(() => (b ? api.bookingPayments(b.id) : Promise.resolve([])), [b?.id, b?.updated_at], { enabled: !!b });
  const audit = useAsync(() => (b && isAdmin ? api.auditFor('bookings', b.id) : Promise.resolve([])), [b?.id, b?.updated_at], { enabled: !!b && isAdmin });
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');

  const refresh = async () => { await Promise.all([q.reload(), group.reload(), groupPays.reload(), pays.reload()]); onChanged?.(); };
  const verifier = useVerifyPayment(() => { void refresh(); });
  const actorIds = [...new Set((audit.data ?? []).map((a) => a.actor_id).filter(Boolean) as string[])];
  const actors = useAsync(() => api.profilesByIds(actorIds), [actorIds.join(',')], { enabled: actorIds.length > 0 });
  // No actor means the system did it (e.g. an unpaid booking released automatically).
  const actorName = (id: string | null) => {
    if (!id) return 'the system';
    const p = actors.data?.find((x) => x.id === id);
    return p ? p.full_name || p.email : '…';
  };
  const verifierIds = [...new Set([...(pays.data ?? []), ...(groupPays.data ?? [])].map((p) => p.verified_by).filter(Boolean) as string[])];
  const verifiers = useAsync(() => api.profilesByIds(verifierIds), [verifierIds.join(',')], { enabled: verifierIds.length > 0 });
  const verifierName = (id: string | null) => {
    const v = verifiers.data?.find((x) => x.id === id);
    return v ? v.full_name || v.email : null;
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setMode(null); setText(''); setAmount('');
      await refresh();
    } catch (e) {
      toast.error('Action failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // A booking waiting for its payment check shows only verification; everything
  // else (reschedule, edit, cancel…) appears once it's confirmed.
  const allBlocks = blocks.length ? blocks : b ? [b] : [];
  const grp = allBlocks.length ? toGroup(allBlocks) : null;
  const awaiting = grp?.booking_status === 'pending';
  const allPays = blocks.length > 1 ? groupPays.data ?? [] : pays.data ?? [];
  const pendingPays = allPays.filter((p) => p.payment_status === 'pending');
  const started = b ? Date.parse(b.start_at) <= Date.now() : false;
  const live = b && (b.booking_status === 'pending' || b.booking_status === 'confirmed');
  const balance = b ? Math.max(0, b.total_amount - b.amount_paid) : 0;

  const statusBtn = (s: BookingStatus, label: string, Icon: typeof Check, variant: 'outline' | 'primary' = 'outline') => (
    <Button size="sm" variant={variant} disabled={busy} onClick={() => act(() => api.setBookingStatus(b!.id, s), `Booking marked ${label.toLowerCase()}`)}>
      <Icon /> {label}
    </Button>
  );

  return (
    <Dialog open={!!bookingId} onClose={onClose} size="lg" title={b ? `${b.customer_name}` : 'Booking'}
      description={b ? `${b.courts?.name ?? 'Court'} · ${formatDateLong(b.start_at, tz)}, ${formatTime(b.start_at, tz)} – ${formatTime(b.end_at, tz)}` : undefined}>
      {q.loading && !b ? <Skeleton className="h-64" /> : q.error ? <Alert tone="error">{q.error}</Alert> : !b ? <Alert tone="warning">Booking not found.</Alert> : (
        <div className="space-y-6">
          {awaiting && grp && (
            <section className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{pendingPays.length ? 'Payment to verify' : 'Waiting for payment'}</p>
                  <p className="mt-1 text-sm"><span className="font-mono text-xs font-semibold">{grp.reference}</span> · {allBlocks.length} time block{allBlocks.length === 1 ? '' : 's'} · total <span className="font-semibold">{money(grp.total, grp.currency)}</span></p>
                </div>
                <PaymentStatusBadge status={grp.payment_status} />
              </div>
              <ul className="space-y-1 text-sm">
                {allBlocks.map((x) => (
                  <li key={x.id} className="tabular-nums">{formatDateLong(x.start_at, tz)} · <span className="font-medium">{formatTime(x.start_at, tz)} – {formatTime(x.end_at, tz)}</span></li>
                ))}
              </ul>
              <p className="text-xs text-slate-600">{b.customer_email ?? '—'} · {b.customer_phone ?? '—'}</p>
              {pendingPays.length > 0 ? (
                isAdmin ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button loading={busy}
                        onClick={() => void verifier.start({ ids: pendingPays.map((p) => p.id), amount: pendingPays.reduce((sum, p) => sum + p.amount, 0), currency: grp.currency, proofPath: pendingPays[0].proof_of_payment_path })}>
                        <CheckCheck /> Verify payment &amp; confirm booking
                      </Button>
                      <Button variant="danger-outline" onClick={() => { setText(''); setMode('rejectAll'); }}><Ban /> Reject payment</Button>
                    </div>
                    {mode === 'rejectAll' && (
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="Why is it rejected? (emailed to the customer)" required className="min-w-60 flex-1"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
                        <Button variant="danger" loading={busy} disabled={text.trim().length < 3}
                          onClick={() => act(async () => { for (const p of pendingPays) await api.reviewPayment(p.id, false, text.trim()); }, 'Payment rejected')}>Reject</Button>
                        <Button variant="ghost" onClick={() => setMode(null)}>Back</Button>
                      </div>
                    )}
                  </div>
                ) : <p className="text-sm text-slate-600">An administrator needs to verify this payment.</p>
              ) : (
                <p className="text-sm text-slate-600">The customer hasn't uploaded a receipt yet.{b.payment_due_at && <> Unpaid bookings are released at {formatDateTime(b.payment_due_at, tz)}.</>}</p>
              )}
            </section>
          )}
          {!awaiting && blocks.length > 1 && grp && (
            <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
              <p className="text-sm"><span className="font-semibold">One booking · {blocks.length} time blocks</span> · reference <span className="font-mono text-xs font-semibold">{grp.reference}</span> · total <span className="font-semibold">{money(grp.total, grp.currency)}</span></p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Time blocks">
                {blocks.map((x) => (
                  <button key={x.id} type="button" onClick={() => { setMode(null); setCurrentId(x.id); }} aria-pressed={x.id === b.id}
                    className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums',
                      x.id === b.id ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white text-ink-800 hover:border-slate-400')}>
                    {formatTime(x.start_at, tz)} – {formatTime(x.end_at, tz)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">Pick a time block to reschedule or cancel just that one.</p>
            </div>
          )}
          {!awaiting && (<>
          <div className="flex flex-wrap items-center gap-2">
            <CopyReference value={b.booking_reference} />
            <BookingStatusBadge status={b.booking_status} />
            <PaymentStatusBadge status={b.payment_status} />
            {b.source === 'admin' && <span className="text-xs text-slate-500">Created by staff</span>}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">Duration</dt><dd className="font-medium">{formatDuration(b.duration_minutes)}</dd></div>
            <div><dt className="text-slate-500">Total</dt><dd className="font-medium">{money(b.total_amount, b.currency)}</dd></div>
            <div><dt className="text-slate-500">Paid</dt><dd className="font-medium">{money(b.amount_paid, b.currency)}</dd></div>
            <div><dt className="text-slate-500">Email</dt><dd className="truncate font-medium">{b.customer_email ?? '—'}</dd></div>
            <div><dt className="text-slate-500">Mobile</dt><dd className="font-medium">{b.customer_phone ?? '—'}</dd></div>
            <div><dt className="text-slate-500">Method</dt><dd className="font-medium">{b.payment_method ? paymentMethodLabel[b.payment_method] : '—'}</dd></div>
            <div><dt className="text-slate-500">Booked</dt><dd className="font-medium">{formatDateTime(b.created_at, tz)}</dd></div>
            {b.payment_due_at && b.booking_status === 'pending' && <div><dt className="text-slate-500">Payment due</dt><dd className="font-medium">{formatDateTime(b.payment_due_at, tz)}</dd></div>}
            {b.notes && <div className="col-span-full"><dt className="text-slate-500">Notes</dt><dd className="font-medium">{b.notes}</dd></div>}
            {b.cancellation_reason && <div className="col-span-full"><dt className="text-slate-500">Cancellation reason</dt><dd className="font-medium">{b.cancellation_reason}</dd></div>}
          </dl>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 border-y border-slate-100 py-4">
            {b.booking_status === 'confirmed' && started && statusBtn('completed', 'Completed', CheckCheck)}
            {b.booking_status === 'confirmed' && started && statusBtn('no_show', 'No-show', UserX)}
            {b.booking_status === 'completed' && statusBtn('no_show', 'Change to no-show', UserX)}
            {b.booking_status === 'no_show' && statusBtn('completed', 'Change to completed', CheckCheck)}
            {live && <Button size="sm" variant="outline" onClick={() => setMode('reschedule')}><CalendarClock /> Reschedule</Button>}
            <Button size="sm" variant="outline" onClick={() => setMode('edit')}><Pencil /> Edit details</Button>
            {b.booking_status !== 'cancelled' && b.booking_status !== 'expired' && balance > 0 && (
              <Button size="sm" variant="outline" onClick={() => { setAmount(balance.toFixed(2)); setMode('cash'); }}><Receipt /> Record cash</Button>
            )}
            {live && <Button size="sm" variant="danger-outline" onClick={() => setMode('cancel')}><XCircle /> Cancel booking</Button>}
          </div>

          {mode === 'cancel' && (
            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/50 p-4">
              <Field label="Reason (kept in the audit log and emailed to the customer)" required>
                <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" loading={busy} disabled={text.trim().length < 3} onClick={() => act(() => api.cancelBooking(b.id, text.trim()), 'Booking cancelled')}>Cancel booking</Button>
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Back</Button>
              </div>
            </div>
          )}
          {mode === 'cash' && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={`Amount received (${b.currency})`} required><Input type="number" step="0.01" min="0.01" max={balance} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="Note" optional><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Paid at desk, receipt #123" /></Field>
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={busy} disabled={!(Number(amount) > 0)} onClick={() => act(() => api.recordCash(b.id, Number(amount), text || null), 'Cash payment recorded')}>Record payment</Button>
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Back</Button>
              </div>
            </div>
          )}
          {mode === 'edit' && <EditDetails booking={b} busy={busy} onCancel={() => setMode(null)}
            onSave={(d) => act(() => api.adminUpdateDetails(b.id, d), 'Details updated')} />}
          </>)}

          {/* Payments */}
          <section>
            <h3 className="text-sm font-semibold">Payments</h3>
            {(pays.data ?? []).length === 0 ? <p className="mt-2 text-sm text-slate-600">No payments recorded.</p> : (
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {pays.data!.map((p) => (
                  <li key={p.id} className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{paymentMethodLabel[p.payment_method]} · {money(p.amount, p.currency)}{p.refunded_amount > 0 && <span className="text-violet-700"> (refunded {money(p.refunded_amount, p.currency)})</span>}</p>
                        <p className="text-xs text-slate-500">{p.transaction_reference && <>Ref {p.transaction_reference} · </>}{formatDateTime(p.created_at, tz)}{p.review_note && <> · {p.review_note}</>}</p>
                        {p.verified_by && verifierName(p.verified_by) && (
                          <p className="text-xs text-slate-500">{p.payment_status === 'failed' ? 'Rejected' : 'Verified'} by <span className="font-medium text-ink-800">{verifierName(p.verified_by)}</span>{p.verified_at && <> · {formatDateTime(p.verified_at, tz)}</>}</p>
                        )}
                      </div>
                      <PaymentTxnBadge status={p.payment_status} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.proof_of_payment_path && (
                        <Button size="sm" variant="ghost" onClick={async () => { try { window.open(await api.proofUrl(p.proof_of_payment_path!), '_blank', 'noopener'); } catch (e) { toast.error('Could not open file', errorMessage(e)); } }}>
                          <Eye /> View proof
                        </Button>
                      )}
                      {!p.proof_of_payment_path && p.receipt_purged_at && <span className="self-center text-xs text-slate-500">Receipt deleted after 45 days</span>}
                      {isAdmin && !awaiting && p.payment_status === 'pending' && <>
                        <Button size="sm" loading={busy} onClick={() => void verifier.start({ ids: [p.id], amount: p.amount, currency: p.currency, proofPath: p.proof_of_payment_path })}><Check /> Verify</Button>
                        <Button size="sm" variant="danger-outline" onClick={() => { setText(''); setMode({ reject: p }); }}><Ban /> Reject</Button>
                      </>}
                      {isAdmin && p.payment_status === 'paid' && p.refunded_amount < p.amount && (
                        <Button size="sm" variant="ghost" onClick={() => { setText(''); setAmount((p.amount - p.refunded_amount).toFixed(2)); setMode({ refund: p }); }}><RotateCcw /> Refund</Button>
                      )}
                    </div>
                    {typeof mode === 'object' && mode && 'reject' in mode && mode.reject.id === p.id && (
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="Why is it rejected?" required className="min-w-60 flex-1"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
                        <Button size="sm" variant="danger" loading={busy} disabled={text.trim().length < 3} onClick={() => act(() => api.reviewPayment(p.id, false, text.trim()), 'Payment rejected')}>Reject</Button>
                      </div>
                    )}
                    {typeof mode === 'object' && mode && 'refund' in mode && mode.refund.id === p.id && (
                      <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-end">
                        <Field label="Amount"><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                        <Field label="Refund note" required><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. GCash refund ref 123" /></Field>
                        <Button size="sm" loading={busy} disabled={!(Number(amount) > 0) || text.trim().length < 3} onClick={() => act(() => api.refundPayment(p.id, Number(amount), text.trim()), 'Refund recorded')}>Record refund</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Who did what, in plain words (admins only). */}
          {isAdmin && (() => {
            const items = (audit.data ?? []).map((a) => ({ a, what: describeBookingAudit(a, tz) })).filter((x) => x.what.length > 0);
            return (
              <section>
                <h3 className="text-sm font-semibold">Activity</h3>
                {items.length === 0 ? <p className="mt-2 text-sm text-slate-600">No activity recorded yet.</p> : (
                  <ol className="mt-2 space-y-1.5 text-sm">
                    {items.map(({ a, what }) => (
                      <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-slate-50 px-3 py-2">
                        <span>{what.join(' · ')} <span className="text-slate-500">by</span> <span className="font-semibold text-ink-900">{actorName(a.actor_id)}</span></span>
                        <span className="text-xs text-slate-500">{formatDateTime(a.created_at, tz)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })()}
        </div>
      )}
      {b && mode === 'reschedule' && (
        <RescheduleDialog booking={b} open staff onClose={() => setMode(null)} onDone={() => { toast.success('Booking moved'); void refresh(); }} />
      )}
      {verifier.dialog}
    </Dialog>
  );
}

function EditDetails({ booking, busy, onSave, onCancel }: {
  booking: Booking; busy: boolean; onCancel: () => void;
  onSave: (d: { name: string; email: string | null; phone: string | null; players: number | null; notes: string | null }) => void;
}) {
  const [d, setD] = useState({
    name: booking.customer_name, email: booking.customer_email ?? '', phone: booking.customer_phone ?? '',
    players: booking.players?.toString() ?? '', notes: booking.notes ?? '',
  });
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required><Input value={d.name} onChange={set('name')} /></Field>
        <Field label="Email"><Input type="email" value={d.email} onChange={set('email')} /></Field>
        <Field label="Mobile"><Input value={d.phone} onChange={set('phone')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={d.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={() => onSave({ name: d.name, email: d.email || null, phone: d.phone || null, players: d.players ? Number(d.players) : null, notes: d.notes || null })}>Save details</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Back</Button>
      </div>
    </div>
  );
}
