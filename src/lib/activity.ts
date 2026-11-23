// Turns a booking's audit-log entries into plain sentences for staff:
// what happened, in words, without the raw field changes.
import type { AuditLog, BookingStatus, PaymentStatus } from './types';
import { formatDateLong, formatTime } from './time';

type Changes = Record<string, { from: unknown; to: unknown }>;

const STATUS: Partial<Record<BookingStatus, string>> = {
  confirmed: 'Booking confirmed', cancelled: 'Booking cancelled', completed: 'Marked as played',
  no_show: 'Marked as no-show', expired: 'Released (not paid in time)', pending: 'Set back to pending',
};
const PAYMENT: Partial<Record<PaymentStatus, string>> = {
  pending: 'Receipt uploaded', paid: 'Payment verified', partially_paid: 'Partly paid', failed: 'Payment rejected',
  refunded: 'Payment refunded', partially_refunded: 'Payment partly refunded', unpaid: 'Payment marked unpaid',
};
const DETAILS = ['customer_name', 'customer_email', 'customer_phone', 'notes', 'players'];

/** The actions in one audit entry, as short phrases; empty when nothing worth showing changed. */
export function describeBookingAudit(a: AuditLog, tz: string): string[] {
  if (a.action === 'insert') return ['Booked'];
  if (a.action === 'delete') return [];
  const ch = (a.metadata?.changes ?? {}) as Changes;
  const out: string[] = [];
  const status = ch.booking_status?.to as BookingStatus | undefined;
  if (status && STATUS[status]) {
    const reason = typeof ch.cancellation_reason?.to === 'string' ? ch.cancellation_reason.to : '';
    out.push(status === 'cancelled' && reason ? `${STATUS[status]} — "${reason}"` : STATUS[status]!);
  }
  if (ch.start_at && typeof ch.start_at.to === 'string') {
    const end = typeof ch.end_at?.to === 'string' ? ch.end_at.to : null;
    out.push(`Rescheduled to ${formatDateLong(ch.start_at.to, tz)}, ${formatTime(ch.start_at.to, tz)}${end ? `–${formatTime(end, tz)}` : ''}`);
  }
  const pay = ch.payment_status?.to as PaymentStatus | undefined;
  if (pay && PAYMENT[pay]) out.push(PAYMENT[pay]!);
  if (DETAILS.some((k) => k in ch)) out.push('Customer details edited');
  return out;
}
