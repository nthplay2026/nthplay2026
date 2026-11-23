// Shared Realtime Broadcast subscriptions. The database broadcasts a tiny
// "availability:<date>" message whenever a slot changes (see migration
// 20261123001100). Several parts of a page can watch the same date: they share
// one channel per topic (joining the same topic twice on one connection fails).
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type Listener = { onChange: () => void; onStatus?: (ok: boolean, reconnected: boolean) => void };
interface Topic { channel: RealtimeChannel; listeners: Set<Listener>; subscribed: boolean; everSubscribed: boolean }
const topics = new Map<string, Topic>();

/** Calls onChange when the topic broadcasts; returns an unsubscribe function. */
export function watchTopic(topic: string, listener: Listener): () => void {
  let t = topics.get(topic);
  if (!t) {
    const channel = supabase.channel(topic, { config: { broadcast: { self: false } } });
    const entry: Topic = { channel, listeners: new Set(), subscribed: false, everSubscribed: false };
    channel.on('broadcast', { event: 'change' }, () => entry.listeners.forEach((l) => l.onChange()));
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const reconnected = entry.everSubscribed;
        entry.subscribed = true;
        entry.everSubscribed = true;
        entry.listeners.forEach((l) => l.onStatus?.(true, reconnected));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        entry.subscribed = false;
        entry.listeners.forEach((l) => l.onStatus?.(false, false));
      }
    });
    topics.set(topic, entry);
    t = entry;
  }
  t.listeners.add(listener);
  if (t.subscribed) listener.onStatus?.(true, false);
  const entry = t;
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      topics.delete(topic);
      void supabase.removeChannel(entry.channel);
    }
  };
}
