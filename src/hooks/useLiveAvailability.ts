import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { AvailabilitySlot } from '@/lib/types';
import { addDays } from '@/lib/time';
import { watchTopic } from '@/lib/liveTopics';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export const slotKey = (s: Pick<AvailabilitySlot, 'court_id' | 'slot_start'>) => `${s.court_id}|${s.slot_start}`;

const TAKEN = new Set(['held', 'pending', 'booked', 'blocked', 'unavailable']);

/**
 * Live slot grid for one facility-local date.
 *
 * Source of truth is always the server (`get_availability`). Realtime only
 * tells us *when* to refetch: the database broadcasts every slot change for a
 * date (a hold, booking, cancellation, block or expiry), which triggers a
 * debounced reload.
 * If the socket drops we poll until it reconnects, then reload once more so
 * nothing is missed. Responses that arrive out of order are discarded.
 */
export function useLiveAvailability(dateOrDates: string | string[] | null, courtId?: string | null, opts: { extraTables?: ('bookings' | 'payments')[] } = {}) {
  // One date (day view) or several (week view). A stable string key keeps effects from re-running needlessly.
  const date = Array.isArray(dateOrDates) ? (dateOrDates.length ? dateOrDates.join(',') : null) : dateOrDates;
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  /** Slots that just became unavailable because of someone else (for highlighting + announcements). */
  const [justTaken, setJustTaken] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');

  const seq = useRef(0);
  const prev = useRef<Map<string, string>>(new Map());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extra = (opts.extraTables ?? []).join(',');

  const load = useCallback(async (reason: 'initial' | 'change' | 'poll' = 'change') => {
    if (!date) return;
    const id = ++seq.current;
    if (reason === 'initial') setLoading(true);
    try {
      const rows = (await Promise.all(date.split(',').map((d) => api.availability(d, courtId)))).flat();
      if (id !== seq.current) return; // a newer request is in flight
      // Detect slots that flipped from available to taken since the last load.
      const flipped = new Set<string>();
      if (reason !== 'initial') {
        for (const r of rows) {
          if (!r.slot_start) continue;
          const k = slotKey(r);
          const before = prev.current.get(k);
          if ((before === 'available' || before === 'held_by_you') && TAKEN.has(r.status)) flipped.add(k);
        }
      }
      prev.current = new Map(rows.filter((r) => r.slot_start).map((r) => [slotKey(r), r.status]));
      setSlots(rows);
      setError(null);
      setLastUpdated(Date.now());
      if (flipped.size) {
        setJustTaken(flipped);
        setAnnouncement(`${flipped.size} time slot${flipped.size > 1 ? 's were' : ' was'} just reserved by someone else.`);
        setTimeout(() => setJustTaken(new Set()), 4000);
      }
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [date, courtId]);

  const scheduleReload = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void load('change'); }, 120);
  }, [load]);

  // Initial load whenever the date / court changes.
  useEffect(() => {
    prev.current = new Map();
    setSlots([]);
    void load('initial');
  }, [load]);

  // Live updates for these dates. The database broadcasts "availability:<date>"
  // on every slot change; one shared channel per date fans out to all viewers,
  // which scales to many people watching at once (each just reloads its grid).
  useEffect(() => {
    if (!date) return;
    setStatus('connecting');
    const dates = date.split(',');
    // Include the day before: a booking that starts late can run past midnight into the first date.
    const watched = [addDays(dates[0], -1), ...dates];
    const ok = new Map<string, boolean>();
    const stops = watched.map((d) => watchTopic(`availability:${d}`, {
      onChange: scheduleReload,
      onStatus: (up, reconnected) => {
        ok.set(d, up);
        const allUp = watched.every((x) => ok.get(x));
        setStatus(allUp ? 'live' : up ? 'connecting' : 'reconnecting');
        // After a reconnect, catch up on anything missed while offline.
        if (up && reconnected) scheduleReload();
      },
    }));

    // Staff screens also follow booking/payment rows (few viewers, so row changes are fine).
    let channel: RealtimeChannel | null = null;
    if (extra) {
      channel = supabase.channel(`staff-availability:${dates[0]}+${dates.length}:${courtId ?? 'all'}:${Math.random().toString(36).slice(2, 8)}`);
      for (const t of extra.split(',')) channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, scheduleReload);
      channel.subscribe();
    }
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      stops.forEach((stop) => stop());
      if (channel) void supabase.removeChannel(channel);
    };
  }, [date, courtId, extra, scheduleReload]);

  // Fallback polling: fast while disconnected, slow safety net while live
  // (also turns slots into "past" and drops expired holds as time passes).
  useEffect(() => {
    if (!date) return;
    const t = setInterval(() => { void load('poll'); }, status === 'live' ? 30_000 : 10_000);
    return () => clearInterval(t);
  }, [date, status, load]);

  // Reload exactly when the next visible hold expires.
  useEffect(() => {
    const next = slots
      .map((s) => (s.hold_expires_at ? Date.parse(s.hold_expires_at) : Infinity))
      .reduce((a, b) => Math.min(a, b), Infinity);
    if (!Number.isFinite(next)) return;
    const t = setTimeout(() => { void load('poll'); }, Math.max(500, next - Date.now() + 750));
    return () => clearTimeout(t);
  }, [slots, load]);

  // Refresh when the tab becomes visible or the network comes back.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load('poll'); };
    const onOnline = () => void load('poll');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [load]);

  return { slots, loading, error, status, lastUpdated, justTaken, announcement, reload: () => load('poll') };
}
