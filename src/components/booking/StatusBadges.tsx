import { Badge, type Tone } from '@/components/ui/misc';
import { bookingStatusLabel, paymentStatusLabel, paymentTxnStatusLabel } from '@/lib/format';
import type { BookingStatus, PaymentStatus, PaymentTxnStatus } from '@/lib/types';

const bookingTone: Record<BookingStatus, Tone> = {
  pending: 'amber', confirmed: 'green', cancelled: 'red', completed: 'blue', no_show: 'violet', expired: 'neutral',
};
const paymentTone: Record<PaymentStatus, Tone> = {
  unpaid: 'neutral', pending: 'amber', partially_paid: 'amber', paid: 'green', failed: 'red', refunded: 'violet', partially_refunded: 'violet',
};
const txnTone: Record<PaymentTxnStatus, Tone> = { pending: 'amber', paid: 'green', failed: 'red', refunded: 'violet' };

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge tone={bookingTone[status]} dot>{bookingStatusLabel[status]}</Badge>;
}
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={paymentTone[status]}>{paymentStatusLabel[status]}</Badge>;
}
export function PaymentTxnBadge({ status }: { status: PaymentTxnStatus }) {
  return <Badge tone={txnTone[status]}>{paymentTxnStatusLabel[status]}</Badge>;
}
