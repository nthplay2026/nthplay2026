import { describe, expect, it } from 'vitest';
import { selectionRuns, toggleSlot, type SelSlot } from './selection';
import type { AvailabilitySlot, SlotStatus } from './types';

const C = 'court-1';
const H = 3600_000;
const base = Date.parse('2026-10-15T00:00:00Z');
const slot = (h: number, status: SlotStatus = 'available', court = C): AvailabilitySlot => ({
  court_id: court, slot_start: new Date(base + h * H).toISOString(), slot_end: new Date(base + (h + 1) * H).toISOString(),
  status, price: 400, hold_expires_at: null,
});
const day = Array.from({ length: 24 }, (_, h) => slot(h));
const tap = (sel: SelSlot[], h: number, all = day, max = 12) => toggleSlot(sel, all.find((s) => Date.parse(s.slot_start!) === base + h * H)!, all, max);
const hours = (sel: SelSlot[]) => sel.map((s) => (Date.parse(s.start) - base) / H);

describe('tap-to-select time slots', () => {
  it('first tap selects one slot', () => {
    expect(hours(tap([], 18).next)).toEqual([18]);
  });
  it('slots next to each other form one block', () => {
    let s = tap([], 18).next;
    s = tap(s, 19).next;
    s = tap(s, 17).next;
    expect(hours(s)).toEqual([17, 18, 19]);
    expect(selectionRuns(s)).toHaveLength(1);
    expect(selectionRuns(s)[0].minutes).toBe(180);
    expect(selectionRuns(s)[0].slots).toBe(3);
  });
  it('non-consecutive slots are kept as separate blocks', () => {
    const s = [9, 12, 13, 20].reduce((acc, h) => tap(acc, h).next, [] as SelSlot[]);
    expect(hours(s)).toEqual([9, 12, 13, 20]);
    expect(selectionRuns(s).map((r) => r.slots)).toEqual([1, 2, 1]);
  });
  it('tapping a selected slot removes only that slot, splitting its block', () => {
    const s = [9, 10, 11].reduce((acc, h) => tap(acc, h).next, [] as SelSlot[]);
    const r = tap(s, 10).next;
    expect(hours(r)).toEqual([9, 11]);
    expect(selectionRuns(r)).toHaveLength(2);
  });
  it('no single block goes beyond the maximum booking length', () => {
    const s = [1, 2, 3].reduce((acc, h) => tap(acc, h, day, 3).next, [] as SelSlot[]);
    const r = tap(s, 4, day, 3);
    expect(hours(r.next)).toEqual([1, 2, 3]);
    expect(r.notice).toEqual({ kind: 'max', maxSlots: 3 });
    expect(hours(tap(s, 6, day, 3).next)).toEqual([1, 2, 3, 6]);
  });
  it('a block can run past midnight (week view)', () => {
    const nextDay = Array.from({ length: 3 }, (_, h) => slot(24 + h));
    const all = [...day, ...nextDay];
    const s = tap(tap([], 23, all).next, 24, all).next;
    expect(selectionRuns(s)).toHaveLength(1);
    expect(selectionRuns(s)[0].minutes).toBe(120);
  });
  it('slots on different courts are separate blocks', () => {
    const other = slot(18, 'available', 'court-2');
    const r = toggleSlot(tap([], 18).next, other, [...day, other], 12);
    expect(r.next).toHaveLength(2);
    expect(selectionRuns(r.next)).toHaveLength(2);
  });
});
