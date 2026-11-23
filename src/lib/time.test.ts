import { describe, expect, it } from 'vitest';
import {
  addDays, dayOfWeek, diffDays, formatClock, formatDuration, formatTime, fromLocalInput, isValidDate, localDate,
  localMinutes, toLocalInput, zonedParts, zonedTimeToUtc,
} from './time';

describe('zonedTimeToUtc', () => {
  it('converts Manila wall-clock time (UTC+8, no DST) to UTC', () => {
    expect(zonedTimeToUtc('2026-10-13', '18:00', 'Asia/Manila').toISOString()).toBe('2026-10-13T10:00:00.000Z');
    expect(zonedTimeToUtc('2026-10-13', '06:00', 'Asia/Manila').toISOString()).toBe('2026-10-12T22:00:00.000Z');
  });

  it('round-trips with zonedParts', () => {
    const d = zonedTimeToUtc('2026-12-31', '23:45', 'Asia/Manila');
    const p = zonedParts(d, 'Asia/Manila');
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([2026, 12, 31, 23, 45]);
  });

  it('handles a DST spring-forward gap (time that does not exist)', () => {
    // 2026-03-08 02:30 does not exist in New York; result must be a real instant on that day.
    const d = zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York');
    expect(localDate(d, 'America/New_York')).toBe('2026-03-08');
    expect([1, 3]).toContain(zonedParts(d, 'America/New_York').hour);
  });

  it('handles a DST fall-back overlap deterministically', () => {
    const d = zonedTimeToUtc('2026-11-01', '01:30', 'America/New_York');
    const p = zonedParts(d, 'America/New_York');
    expect([p.hour, p.minute]).toEqual([1, 30]);
  });

  it('keeps an 8 AM wall-clock time across a DST change', () => {
    expect(zonedTimeToUtc('2026-03-07', '08:00', 'America/New_York').toISOString()).toBe('2026-03-07T13:00:00.000Z');
    expect(zonedTimeToUtc('2026-03-09', '08:00', 'America/New_York').toISOString()).toBe('2026-03-09T12:00:00.000Z');
  });
});

describe('local dates', () => {
  it('uses the facility time zone, not the browser zone', () => {
    // 16:30 UTC is already the next day in Manila.
    expect(localDate('2026-10-13T16:30:00Z', 'Asia/Manila')).toBe('2026-10-14');
    expect(localDate('2026-10-13T15:59:00Z', 'Asia/Manila')).toBe('2026-10-13');
    expect(localMinutes('2026-10-13T10:00:00Z', 'Asia/Manila')).toBe(18 * 60);
  });

  it('adds and diffs calendar days across month and year ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-11-09', '2026-10-09')).toBe(31);
  });

  it('computes weekdays', () => {
    expect(dayOfWeek('2026-10-09')).toBe(5); // Friday
    expect(dayOfWeek('2026-10-11')).toBe(0); // Sunday
  });

  it('validates dates strictly', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
  });

  it('round-trips datetime-local input values in the facility zone', () => {
    const d = fromLocalInput('2026-10-20T07:15', 'Asia/Manila');
    expect(d.toISOString()).toBe('2026-10-19T23:15:00.000Z');
    expect(toLocalInput(d, 'Asia/Manila')).toBe('2026-10-20T07:15');
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(120)).toBe('2 hrs');
    expect(formatDuration(90)).toBe('1 hr 30 min');
    expect(formatDuration(45)).toBe('45 min');
  });
  it('formats database clock times', () => {
    expect(formatClock('06:00:00')).toBe('6:00 AM');
    expect(formatClock('17:30')).toBe('5:30 PM');
    expect(formatClock('00:00')).toBe('12:00 AM');
    expect(formatClock('24:00:00')).toBe('12:00 AM (midnight)');
  });
  it('formats instants in the facility zone', () => {
    expect(formatTime('2026-10-13T10:00:00Z', 'Asia/Manila')).toMatch(/^6:00\s?PM$/);
  });
});
