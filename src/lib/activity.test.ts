import { describe, expect, it } from 'vitest';
import { describeBookingAudit } from './activity';
import type { AuditLog } from './types';

const entry = (action: string, changes?: Record<string, { from: unknown; to: unknown }>): AuditLog =>
  ({ id: 1, actor_id: null, action, entity_type: 'bookings', entity_id: 'b', metadata: changes ? { changes } : {}, created_at: '2026-11-03T06:00:00Z' });

describe('booking activity', () => {
  it('describes the usual steps in words', () => {
    expect(describeBookingAudit(entry('insert'), 'Asia/Manila')).toEqual(['Booked']);
    expect(describeBookingAudit(entry('update', { payment_status: { from: 'unpaid', to: 'pending' } }), 'Asia/Manila')).toEqual(['Receipt uploaded']);
    expect(describeBookingAudit(entry('update', {
      booking_status: { from: 'pending', to: 'confirmed' }, confirmed_at: { from: null, to: 'x' }, payment_due_at: { from: 'y', to: null },
    }), 'Asia/Manila')).toEqual(['Booking confirmed']);
  });
  it('includes the cancellation reason and the new time when rescheduled', () => {
    expect(describeBookingAudit(entry('update', { booking_status: { from: 'confirmed', to: 'cancelled' }, cancellation_reason: { from: null, to: 'rain' } }), 'Asia/Manila'))
      .toEqual(['Booking cancelled — "rain"']);
    const r = describeBookingAudit(entry('update', { start_at: { from: 'a', to: '2026-11-04T08:00:00Z' }, end_at: { from: 'b', to: '2026-11-04T09:00:00Z' }, total_amount: { from: 1, to: 2 } }), 'Asia/Manila');
    expect(r[0]).toMatch(/^Rescheduled to .*4:00.*5:00/);
  });
  it('hides changes with nothing worth showing', () => {
    expect(describeBookingAudit(entry('update', { updated_at: { from: 'a', to: 'b' } }), 'Asia/Manila')).toEqual([]);
  });
});
