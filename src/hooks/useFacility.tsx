import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import type { Court, FacilitySettings } from '@/lib/types';
import { todayIn } from '@/lib/time';

interface FacilityState {
  settings: FacilitySettings | null;
  courts: Court[];
  loading: boolean;
  error: string | null;
  tz: string;
  currency: string;
  today: string;
  reload: () => Promise<void>;
}

const Ctx = createContext<FacilityState | null>(null);

/** Facility settings + active courts, kept live via Realtime. */
export function FacilityProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<FacilitySettings | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => todayIn('Asia/Manila'));

  const reload = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.settings(), api.courts()]);
      setSettings(s);
      setCourts(c);
      setToday(todayIn(s.timezone));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Courts added / deactivated by staff appear without a refresh.
  useEffect(() => {
    const ch = supabase.channel('facility-courts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courts' }, () => {
        api.courts().then(setCourts).catch(() => {});
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // Roll "today" over at facility midnight.
  useEffect(() => {
    if (!settings) return;
    const t = setInterval(() => setToday(todayIn(settings.timezone)), 60_000);
    return () => clearInterval(t);
  }, [settings]);

  const value = useMemo<FacilityState>(() => ({
    settings, courts, loading, error, reload, today,
    tz: settings?.timezone ?? 'Asia/Manila',
    currency: settings?.currency ?? 'PHP',
  }), [settings, courts, loading, error, reload, today]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFacility(): FacilityState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFacility must be used inside <FacilityProvider>');
  return v;
}
