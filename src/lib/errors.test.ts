import { describe, expect, it } from 'vitest';
import { errorMessage, toAppError } from './errors';

describe('toAppError', () => {
  it('maps coded database errors and keeps their customer-facing message', () => {
    const e = toAppError({ code: 'P0001', hint: 'SLOT_TAKEN', message: 'Sorry — that time was just reserved by someone else. Please pick another slot.', details: '' });
    expect(e.code).toBe('SLOT_TAKEN');
    expect(e.message).toMatch(/just reserved/);
    expect(e.retryable).toBe(false);
  });

  it('parses structured conflict details (e.g. BLOCK_CONFLICT)', () => {
    const detail = [{ booking_id: 'b1', booking_reference: 'PB-20261009-0001', start_at: '2026-10-10T02:00:00Z', end_at: '2026-10-10T03:00:00Z', customer_name: 'Ana' }];
    const e = toAppError({ code: 'P0001', hint: 'BLOCK_CONFLICT', message: 'Existing bookings overlap this block.', details: JSON.stringify(detail) });
    expect(e.code).toBe('BLOCK_CONFLICT');
    expect(e.detail).toEqual(detail);
  });

  it('maps permission errors, exclusion violations and FK violations', () => {
    expect(toAppError({ code: '42501', message: 'permission denied for function create_hold' }).code).toBe('FORBIDDEN');
    expect(toAppError({ code: '23P01', message: 'conflicting key value violates exclusion constraint' }).code).toBe('SLOT_TAKEN');
    expect(toAppError({ code: '23503', message: 'violates foreign key constraint' }).code).toBe('IN_USE');
  });

  it('detects expired sessions', () => {
    expect(toAppError({ code: 'PGRST303', message: 'JWT expired' }).code).toBe('SESSION_EXPIRED');
    expect(toAppError({ status: 401, message: 'JWT expired' }).code).toBe('SESSION_EXPIRED');
  });

  it('treats fetch failures as retryable network errors', () => {
    const e = toAppError(new TypeError('Failed to fetch'));
    expect(e.code).toBe('NETWORK');
    expect(e.retryable).toBe(true);
  });

  it('never returns an empty message', () => {
    expect(errorMessage(null)).toBeTruthy();
    expect(errorMessage({})).toBeTruthy();
  });
});
