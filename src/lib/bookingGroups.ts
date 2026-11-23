// Time blocks booked in one checkout share a group reference. Customers see
// each group as one booking; staff still manage the blocks individually.
import type { Booking, BookingStatus, Payment, PaymentStatus } from './types';

export interface BookingGroup {
  reference: string;
  bookings: Booking[];
  start_at: string;
  end_at: string;
  total: number;
  paid: number;
  currency: string;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
}

export const groupRef = (b: Pick<Booking, 'group_ref' | 'booking_reference'>) => b.group_ref || b.booking_reference;

// The status shown for the whole group: the first one (in this order) any block has.
const BOOKING_ORDER: BookingStatus[] = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled', 'expired'];
const PAYMENT_ORDER: PaymentStatus[] = ['failed', 'pending', 'unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded'];
const pick = <T,>(order: T[], values: T[]) => order.find((s) => values.includes(s)) ?? values[0];

export function toGroup(bookings: Booking[]): BookingGroup {
  const sorted = [...bookings].sort((a, b) => a.start_at.localeCompare(b.start_at));
  // Cancelled/expired blocks don't change what's still owed or played.
  const live = sorted.filter((b) => b.booking_status !== 'cancelled' && b.booking_status !== 'expired');
  const counted = live.length ? live : sorted;
  return {
    reference: groupRef(sorted[0]),
    bookings: sorted,
    start_at: sorted[0].start_at,
    end_at: sorted[sorted.length - 1].end_at,
    total: counted.reduce((s, b) => s + b.total_amount, 0),
    paid: counted.reduce((s, b) => s + b.amount_paid, 0),
    currency: sorted[0].currency,
    booking_status: pick(BOOKING_ORDER, sorted.map((b) => b.booking_status)),
    payment_status: pick(PAYMENT_ORDER, counted.map((b) => b.payment_status)),
  };
}

/** Groups bookings, keeping the order of each group's first appearance. */
export function groupBookings(rows: Booking[]): BookingGroup[] {
  const map = new Map<string, Booking[]>();
  for (const b of rows) {
    const k = groupRef(b);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(b);
  }
  return [...map.values()].map(toGroup);
}

/**
 * One receipt covering several time blocks is recorded as one payment row per block.
 * Merges those rows into one payment (amounts added up), keeping the first row's details.
 * Payments with no receipt image (e.g. cash) stay separate.
 */
export function mergeReceiptPayments<P extends Pick<Payment, 'id' | 'amount' | 'proof_of_payment_path' | 'payment_status'>>(rows: P[]): P[] {
  const map = new Map<string, P>();
  for (const p of rows) {
    const k = p.proof_of_payment_path ? `${p.proof_of_payment_path}|${p.payment_status}` : p.id;
    const cur = map.get(k);
    map.set(k, cur ? { ...cur, amount: Number(cur.amount) + Number(p.amount) } : p);
  }
  return [...map.values()];
}