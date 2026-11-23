import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Calls `onChange` (debounced) whenever bookings, payments or slot locks change.
 * Staff receive every row (RLS); customers would only receive their own.
 */
export function useStaffFeed(onChange: () => void, tables: ('bookings' | 'payments' | 'slot_locks')[] = ['bookings', 'payments', 'slot_locks']) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(',');
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const fire = () => { if (t) clearTimeout(t); t = setTimeout(() => cb.current(), 200); };
    const ch = supabase.channel(`staff-feed:${key}:${Math.random().toString(36).slice(2, 7)}`);
    for (const table of key.split(',')) ch.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
    ch.subscribe((s) => { if (s === 'SUBSCRIBED') fire(); });
    const poll = setInterval(fire, 60_000);
    return () => { if (t) clearTimeout(t); clearInterval(poll); void supabase.removeChannel(ch); };
  }, [key]);
}
