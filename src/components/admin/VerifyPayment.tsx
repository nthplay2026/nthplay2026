import { useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

interface Target { ids: string[]; amount: number; currency: string; proofPath?: string | null }

/**
 * Verifying a payment: the admin first claims it (others then see who is on it),
 * checks the receipt, and confirms. Several payment rows can share one receipt.
 */
export function useVerifyPayment(onVerified: () => void) {
  const toast = useToast();
  const [target, setTarget] = useState<Target | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (t: Target) => {
    const claimed: string[] = [];
    try {
      for (const id of t.ids) {
        const r = await api.startPaymentReview(id);
        if (!r.ok) {
          await Promise.all(claimed.map((c) => api.releasePaymentReview(c).catch(() => {})));
          toast.error(r.code === 'IN_REVIEW' ? 'Someone is already on it' : 'Already handled', r.message);
          onVerified();
          return;
        }
        claimed.push(id);
      }
    } catch (e) {
      toast.error("Couldn't start verifying", errorMessage(e));
      return;
    }
    setProof(null);
    setTarget(t);
    if (t.proofPath) api.proofUrl(t.proofPath).then(setProof).catch(() => setProof(''));
  };

  const cancel = async () => {
    const t = target;
    setTarget(null);
    if (t) await Promise.all(t.ids.map((id) => api.releasePaymentReview(id).catch(() => {})));
  };

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      for (const id of target.ids) await api.reviewPayment(id, true);
      toast.success('Payment verified', 'The booking is confirmed and the customer has been emailed.');
      setTarget(null);
      onVerified();
    } catch (e) {
      toast.error("Couldn't verify", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <Dialog open={!!target} onClose={() => void cancel()} size="md" title="Verify payment & confirm booking"
      description={target ? `Check that ${money(target.amount, target.currency)} arrived in your account, then confirm.` : undefined}>
      {target && (
        <div className="space-y-4">
          {target.proofPath && (proof === null ? <Skeleton className="h-72" /> : proof ? (
            <a href={proof} target="_blank" rel="noreferrer" className="block">
              <img src={proof} alt="Customer's payment receipt" className="mx-auto max-h-[60vh] rounded-lg border border-slate-200 object-contain" />
            </a>
          ) : <p className="text-sm text-slate-600">The receipt couldn't be loaded.</p>)}
          <p className="text-xs text-slate-500">Other admins see that you're verifying this payment until you confirm or cancel.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={confirm} loading={busy}><Check /> Payment received — confirm booking</Button>
            <Button variant="ghost" onClick={() => void cancel()}>Cancel</Button>
          </div>
        </div>
      )}
    </Dialog>
  );

  return { start, dialog };
}
