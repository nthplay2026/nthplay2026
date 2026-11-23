// Time blocks booked in one checkout share a group reference. Customers see
// each group as one booking; staff still manage the blocks individually.
import type { Booking, BookingStatus, PaymentStatus } from './types';

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
