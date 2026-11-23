import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { checkoutSchema, type CheckoutOutput, type CheckoutValues } from '@/lib/schemas';
import { errorMessage, isAppError } from '@/lib/errors';
import { formatDateLong, formatTime, localDate } from '@/lib/time';
import { money } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Alert, Card, CardContent, CardHeader, CardTitle, EmptyState, PageLoader } from '@/components/ui/misc';
import { BookingSummary, HoldCountdown, QrPayment } from '@/components/booking/Summary';
import { ReceiptInput } from '@/components/booking/ReceiptInput';

export default function CheckoutPage() {
  const { holdId = '' } = useParams();
  // Several separate time blocks arrive as comma-separated hold ids.
  const holdIds = holdId.split(',').filter(Boolean);
  const { user, profile } = useAuth();
  const { settings, courts, tz, currency } = useFacility();
  const navigate = useNavigate();
  const holdsState = useAsync(() => Promise.all(holdIds.map((id) => api.myHold(id))), [holdId]);
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const methods = (settings?.payment_methods ?? []).filter((m) => m.enabled && m.method !== 'gateway' && !!m.qr_url);

  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm<CheckoutValues, unknown, CheckoutOutput>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { name: '', email: '', phone: '', notes: '', paymentMethod: undefined, acceptTerms: false as unknown as true },
    mode: 'onTouched',
  });

  // Prefill from the account once it's loaded.
  useEffect(() => {
    reset((v) => ({
      ...v,
      name: v.name || profile?.full_name || '',
      email: v.email || profile?.email || user?.email || '',
      phone: v.phone || profile?.mobile_number || '',
      paymentMethod: v.paymentMethod ?? (methods[0]?.method as CheckoutValues['paymentMethod']),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, user, settings]);

  // Already-converted holds mean this checkout already succeeded (e.g. back button).
  useEffect(() => {
    const first = holdsState.data?.[0];
    if (first && holdsState.data!.every((x) => x?.status === 'converted') && first.booking_id) {
      api.bookingById(first.booking_id).then((b) => b && navigate(`/booking/${b.booking_reference}/confirmed`, { replace: true }));
    }
  }, [holdsState.data, navigate]);

  const selectedMethod = methods.find((m) => m.method === watch('paymentMethod'));

  const online = (m?: string) => m === 'gcash' || m === 'bank_transfer';
  const needsReceipt = online(watch('paymentMethod'));

  const save = handleSubmit(async (v) => {
    if (online(v.paymentMethod) && !receipt) return;
    setSubmitError(null);
    try {
      const details = { name: v.name, email: v.email, phone: v.phone, players: null,
        notes: v.notes || null, paymentMethod: v.paymentMethod, acceptTerms: v.acceptTerms };
      // All blocks are confirmed together: if one is no longer available, none are booked.
      const booked = holdIds.length === 1
        ? [await api.confirmBooking({ holdId: holdIds[0], ...details })]
        : await api.confirmBookings({ holdIds, ...details });
      // Upload the receipt right away (an admin verifies it), recorded against each
      // booking for its own amount. If that fails, the bookings still stand and the
      // confirmation page asks for the receipt again.
      let paymentFlag = '';
      if (receipt && online(v.paymentMethod) && user) {
        try {
          const pe = await api.submitReceiptForMany(booked.map((b) => ({ bookingId: b.id, amount: b.total_amount })), user.id, receipt, v.paymentMethod);
          if (pe && !(isAppError(pe) && pe.code === 'PAYMENT_ALREADY_PENDING')) paymentFlag = `?payment=failed&reason=${encodeURIComponent(errorMessage(pe))}`;
        } catch (pe) {
          paymentFlag = `?payment=failed&reason=${encodeURIComponent(errorMessage(pe))}`;
        }
      }
      // Blocks booked together share the first block's reference.
      navigate(`/booking/${booked[0].booking_reference}/confirmed${paymentFlag}`, { replace: true });
    } catch (e) {
      setSubmitError(isAppError(e) ? { code: e.code, message: e.message } : { code: 'UNKNOWN', message: errorMessage(e) });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    setReceiptError(needsReceipt && !receipt ? 'Please upload a photo or screenshot of your payment receipt.' : null);
    void save(e);
  };

  const cancel = async () => {
    setLeaving(true);
    await Promise.all(holdIds.map((id) => api.releaseHold(id).catch(() => { /* the hold will expire on its own */ })));
    const first = holdsState.data?.[0];
    navigate(first ? `/book?date=${localDate(first.start_at, tz)}` : '/book');
  };

  if (holdsState.loading && !holdsState.data) return <PageLoader />;
  if (holdsState.error) return <div className="container-page py-12"><Alert tone="error" title="We couldn't load your reservation">{holdsState.error}</Alert></div>;
  const holds = (holdsState.data ?? []).filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const h = holds[0];
  if (!h || holds.length !== holdIds.length || holds.some((x) => x.status === 'released')) {
    return (
      <div className="container-page py-16">
        <EmptyState icon={<Lock />} title="This reservation is no longer active"
          action={<Link to="/book" className={buttonVariants()}>Choose a time</Link>}>
          It may have been released or replaced by another selection.
        </EmptyState>
      </div>
    );
  }
  const court = courts.find((c) => c.id === h.court_id);
  const total = holds.reduce((sum, x) => sum + Number(x.total), 0);
  const expiresAt = holds.map((x) => x.expires_at).sort()[0];
  const courtName = (id: string, name?: string | null) => name ?? courts.find((c) => c.id === id)?.name ?? 'Court';
  const lostSlot = submitError && ['HOLD_EXPIRED_SLOT_TAKEN', 'SLOT_TAKEN', 'HOLD_RELEASED', 'HOLD_NOT_FOUND', 'COURT_INACTIVE', 'CLOSED', 'OUTSIDE_HOURS', 'PAST_TIME', 'TOO_SOON'].includes(submitError.code);

  return (
    <div className="container-page py-8 sm:py-10">
      <button type="button" onClick={cancel} disabled={leaving} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-ink-900">
        <ArrowLeft className="size-4" /> Change time
      </button>
      <h1 className="text-3xl font-bold text-ink-900">Checkout</h1>
      <p className="mt-1 text-slate-600">Confirm your details to complete the reservation.</p>

      {submitError && (
        <Alert tone="error" className="mt-6" title={lostSlot ? 'This time is no longer available' : "We couldn't complete your booking"}
          action={lostSlot && <Link className={buttonVariants({ size: 'sm' })} to={`/book?date=${localDate(h.start_at, tz)}`}>Choose another time</Link>}>
          {submitError.message}
        </Alert>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <form onSubmit={onSubmit} noValidate className="space-y-6" aria-label="Checkout">
          <Card>
            <CardHeader><CardTitle>Your details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={errors.name?.message} className="sm:col-span-2">
                <Input autoComplete="name" {...register('name')} />
              </Field>
              <Field label="Email" required error={errors.email?.message} hint="Your confirmation is sent here.">
                <Input type="email" autoComplete="email" {...register('email')} />
              </Field>
              <Field label="Mobile number" required error={errors.phone?.message}>
                <Input type="tel" autoComplete="tel" inputMode="tel" placeholder="0917 123 4567" {...register('phone')} />
              </Field>
              <Field label="Notes for the facility" optional error={errors.notes?.message} className="sm:col-span-2">
                <Textarea rows={3} maxLength={500} placeholder="e.g. We'd like to rent 4 paddles." {...register('notes')} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Payment</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {methods.length === 0 ? (
                <Alert tone="warning">No payment methods are available right now. Please contact the facility.</Alert>
              ) : (
                <>
                  <input type="hidden" {...register('paymentMethod')} />
                  <QrPayment methods={methods} selected={selectedMethod?.method} amount={total} currency={currency}
                    onSelect={(m) => setValue('paymentMethod', m as CheckoutValues['paymentMethod'], { shouldValidate: true })} />
                  {errors.paymentMethod && <p className="text-sm text-red-600" role="alert">{errors.paymentMethod.message}</p>}
                  <ReceiptInput value={receipt} onChange={(f) => { setReceipt(f); if (f) setReceiptError(null); }} error={receiptError}
                    label="Photo of your payment receipt" />
                </>
              )}

              <p className="text-sm text-slate-600">
                {settings?.booking_confirmation_mode === 'after_payment'
                  ? <>You have <strong>{settings.hold_minutes} minutes</strong> to pay and upload your receipt — after that, the time is released for other players. Once our staff check your payment, they <strong>confirm your booking</strong>; until then it shows as pending under <strong>My Bookings</strong>.</>
                  : <>Your court is <strong>confirmed</strong> as soon as you book. Payment is marked as received only after our staff verify it.</>}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-ink-800">
                <p className="font-semibold">Booking policy</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
                  <li><strong>No cancellations.</strong> Bookings can't be cancelled once made.</li>
                  <li>Need to <strong>change the time</strong>? Contact us and we'll reschedule it for you, subject to availability (the price is recalculated for the new time).</li>
                  <li>Arriving 10 minutes before your scheduled booking is recommended to ensure you make the most of your time. Please note that late arrivals will not be given an extension beyond the booked end time.</li>
                </ul>
              </div>
              <Checkbox {...register('acceptTerms')}
                label={<>I agree to the <Link to="/terms" target="_blank" className="font-semibold text-brand-700 underline">booking policy</Link> and the <Link to="/privacy" target="_blank" className="font-semibold text-brand-700 underline">privacy policy</Link>.</>} />
              {errors.acceptTerms && <p className="text-sm text-red-600" role="alert">{errors.acceptTerms.message}</p>}
              <Button type="submit" size="xl" className="w-full" loading={isSubmitting} disabled={methods.length === 0}>
                <ShieldCheck /> Confirm booking
              </Button>
              <p className="text-center text-xs text-slate-500">You'll only see a confirmation once the booking is saved.</p>
            </CardContent>
          </Card>
        </form>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <HoldCountdown expiresAt={expiresAt} className="mb-4" />
            {holds.length === 1 ? (
              <BookingSummary courtName={courtName(h.court_id, h.court_name)} courtType={court?.court_type} start={h.start_at} end={h.end_at}
                minutes={h.duration_minutes} hourlyRate={Number(h.hourly_rate)} breakdown={h.breakdown} total={Number(h.total)} currency={currency} tz={tz} />
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Your booking</p>
                  <p className="mt-1 text-sm text-slate-600">{holds.length} separate time blocks · one booking each</p>
                </div>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                  {holds.map((x) => (
                    <li key={x.hold_id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <span>
                        <span className="block font-semibold text-ink-900 tabular-nums">{formatTime(x.start_at, tz)} – {formatTime(x.end_at, tz)}</span>
                        <span className="block text-xs text-slate-500">{formatDateLong(x.start_at, tz)} · {courtName(x.court_id, x.court_name)}</span>
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums">{money(Number(x.total), currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
                  <span className="font-semibold">Total</span>
                  <span className="text-2xl font-bold tabular-nums">{money(total, currency)}</span>
                </div>
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
