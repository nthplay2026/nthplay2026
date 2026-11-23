// Tap-to-select time slots. Any available slot can be added or removed, so a
// selection may be several separate blocks (on any court or day). Slots that
// touch on the same court are grouped into one block — one booking each.
import type { AvailabilitySlot } from './types';

export interface SelSlot { court_id: string; start: string; end: string }

export type SelectionNotice = { kind: 'max'; maxSlots: number } | null;

/** One continuous block of selected slots on one court. */
export interface SelRun { courtId: string; start: string; end: string; minutes: number; slots: number }

const t = (iso: string) => Date.parse(iso);
export const selKey = (s: { court_id: string; start: string }) => `${s.court_id}|${t(s.start)}`;

/**
 * Applies one tap to the current selection: a selected slot is removed, any
 * other slot is added. Refuses an addition that would make its block longer
 * than `maxSlots` (the longest single booking allowed).
 */
export function toggleSlot(current: SelSlot[], tapped: AvailabilitySlot, _all: AvailabilitySlot[], maxSlots: number):
  { next: SelSlot[]; notice: SelectionNotice } {
  if (!tapped.slot_start || !tapped.slot_end) return { next: current, notice: null };
  const slot: SelSlot = { court_id: tapped.court_id, start: tapped.slot_start, end: tapped.slot_end };
  const key = selKey(slot);

  if (current.some((s) => selKey(s) === key)) return { next: current.filter((s) => selKey(s) !== key), notice: null };

  const next = sortSel([...current, slot]);
  const run = selectionRuns(next).find((r) => r.courtId === slot.court_id && t(r.start) <= t(slot.start) && t(slot.end) <= t(r.end));
  if (run && run.slots > maxSlots) return { next: current, notice: { kind: 'max', maxSlots } };
  return { next, notice: null };
}

const sortSel = (sel: SelSlot[]) => [...sel].sort((a, b) => a.court_id.localeCompare(b.court_id) || t(a.start) - t(b.start));

/** Groups a selection into continuous blocks, ordered by start time. */
export function selectionRuns(sel: SelSlot[]): SelRun[] {
  const runs: SelRun[] = [];
  for (const s of sortSel(sel)) {
    const last = runs[runs.length - 1];
    if (last && last.courtId === s.court_id && t(last.end) === t(s.start)) {
      last.end = s.end;
      last.slots += 1;
    } else {
      runs.push({ courtId: s.court_id, start: s.start, end: s.end, minutes: 0, slots: 1 });
    }
  }
  for (const r of runs) r.minutes = Math.round((t(r.end) - t(r.start)) / 60000);
  return runs.sort((a, b) => t(a.start) - t(b.start) || a.courtId.localeCompare(b.courtId));
}
