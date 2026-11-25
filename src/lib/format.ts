import type { BookingStatus, PaymentMethod, PaymentMethodConfig, PaymentStatus, PaymentTxnStatus, SlotStatus } from './types';

const moneyCache = new Map<string, Intl.NumberFormat>();

export function money(amount: number | string | null | undefined, currency = 'PHP'): string {
  const n = Number(amount ?? 0);
  let f = moneyCache.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-PH', { style: 'currency', currency, minimumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyCache.set(currency, f);
  }
  return f.format(Number.isFinite(n) ? n : 0);
}

/** Whole-number money for compact UI ("₱500"). */
export function moneyShort(amount: number | null | undefined, currency = 'PHP'): string {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return String(n);
  }
}

export const bookingStatusLabel: Record<BookingStatus, string> = {
  pending: 'Pending', confirmed: 'Confirmed', cancelled: 'Cancelled',
  completed: 'Completed', no_show: 'No-show', expired: 'Expired',
};

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid', pending: 'Payment pending review', partially_paid: 'Partially paid', paid: 'Paid',
  failed: 'Payment failed', refunded: 'Refunded', partially_refunded: 'Partially refunded',
};

export const paymentTxnStatusLabel: Record<PaymentTxnStatus, string> = {
  pending: 'Awaiting verification', paid: 'Verified', failed: 'Rejected', refunded: 'Refunded',
};

/** Built-in names, used only when the admin hasn't named a method (Settings > Payment methods). */
export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: 'Cash at the facility', bank_transfer: 'Bank transfer', gcash: 'GCash', gateway: 'Online payment',
};

/** The name customers and staff see for a payment method: the admin's label, or the built-in name. */
export function methodName(method: PaymentMethod | null | undefined, methods?: PaymentMethodConfig[] | null): string {
  if (!method) return '—';
  return methods?.find((m) => m.method === method)?.label?.trim() || paymentMethodLabel[method];
}

export const slotStatusLabel: Record<SlotStatus, string> = {
  available: 'Available', held: 'On hold', held_by_you: 'Your hold', pending: 'Pending', booked: 'Booked',
  blocked: 'Maintenance', unavailable: 'Unavailable', closed: 'Closed', past: 'Past',
};

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function initials(name: string | null | undefined): string {
  return (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('') || '?';
}
