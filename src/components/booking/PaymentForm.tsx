import { useState, type FormEvent } from 'react';
import { Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { PaymentMethod, PaymentMethodConfig } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { QrPayment } from './Summary';
import { ReceiptInput } from './ReceiptInput';

/**
 * Customer pays with a QR code and uploads a photo of the receipt for staff to
 * verify. For blocks booked together, one receipt covers all of them.
 */
export function PaymentForm({ targets, userId, currency, methods, defaultMethod, onDone, title = 'Pay with a QR code, then upload your receipt' }: {
  targets: { bookingId: string; amount: number }[]; userId: string; currency: string; title?: string;
  methods: PaymentMethodConfig[]; defaultMethod?: 'gcash' | 'bank_transfer'; onDone: () => void;
}) {
  const toast = useToast();
  const withQr = methods.filter((m) => !!m.qr_url);
  const [method, setMethod] = useState<PaymentMethod>(
    withQr.some((m) => m.method === defaultMethod) ? defaultMethod! : (withQr[0]?.method as PaymentMethod) ?? 'gcash');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = targets.reduce((s, t) => s + t.amount, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!receipt) { setError('Please upload a photo or screenshot of your payment receipt.'); return; }
    setBusy(true);
    try {
      const failed = await api.submitReceiptForMany(targets, userId, receipt, method);
      if (failed) throw failed;
      toast.success('Receipt received', 'Our staff will verify your payment shortly.');
      setReceipt(null);
      onDone();
    } catch (err) {
      toast.error("Couldn't upload your receipt", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold">{title}</p>
      {withQr.length > 0 && <QrPayment methods={withQr} selected={method} onSelect={(m) => setMethod(m)} amount={total} currency={currency} />}
      <ReceiptInput value={receipt} onChange={(f) => { setReceipt(f); if (f) setError(null); }} error={error}
        label="Photo of your payment receipt" />
      <Button type="submit" loading={busy}><Upload /> Submit receipt</Button>
      <p className="text-xs text-slate-500">Your booking is marked as paid once our staff have checked the receipt against our records.</p>
    </form>
  );
}
