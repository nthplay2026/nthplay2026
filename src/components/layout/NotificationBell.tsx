import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

/** Bell with unread count; opens the user's notifications and phone-alert switch. */
export function NotificationBell({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const { user } = useAuth();
  const { settings, tz } = useFacility();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useAsync(() => api.myNotifications(30), [user?.id], { enabled: !!user });
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  // Each bell (desktop + phone header) needs its own live channel: reusing one name crashes.
  const instance = useId();

  // New notifications arrive live.
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`notifications:${user.id}:${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, () => { void q.reload(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, instance]);

  useEffect(() => { if (open) void pushState().then(setPush); }, [open]);

  if (!user) return null;
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  const openItem = async (id: string, link: string | null) => {
    setOpen(false);
    await api.markNotificationsRead([id]).catch(() => {});
    void q.reload();
    if (link) navigate(link);
  };
  const markAll = async () => { await api.markNotificationsRead().catch(() => {}); void q.reload(); };
  const togglePush = async () => {
    setBusy(true);
    try {
      if (push === 'on') setPush(await disablePush());
      else if (settings?.push_public_key) {
        const s = await enablePush(settings.push_public_key);
        setPush(s);
        if (s === 'on') toast.success('Phone alerts on', "You'll get a notification on this device.");
        if (s === 'blocked') toast.error('Notifications are blocked', 'Allow notifications for this site in your phone or browser settings.');
      }
    } catch (e) {
      toast.error("Couldn't turn on phone alerts", errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications"
        className={cn('relative rounded-lg p-2', tone === 'dark' ? 'text-slate-300 hover:bg-white/10' : 'text-ink-800 hover:bg-slate-100', className)}>
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 grid min-w-4.5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4.5 text-white">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} size="md" title="Notifications"
        footer={unread > 0 ? <Button variant="ghost" size="sm" onClick={() => void markAll()}>Mark all as read</Button> : undefined}>
        <div className="space-y-4">
          {push && push !== 'unsupported' && settings?.push_public_key && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <span className="flex items-center gap-2">
                {push === 'on' ? <BellRing className="size-4 text-brand-700" /> : <BellOff className="size-4 text-slate-500" />}
                {push === 'on' ? 'Phone alerts are on for this device.'
                  : push === 'needs-install' ? 'To get phone alerts on iPhone, add this site to your Home Screen and open it from there.'
                  : push === 'blocked' ? 'Notifications are blocked. Allow them in your phone or browser settings.'
                  : 'Get an alert on this device even when the app is closed.'}
              </span>
              {(push === 'on' || push === 'off') && (
                <Button size="sm" variant={push === 'on' ? 'ghost' : 'primary'} loading={busy} onClick={() => void togglePush()}>
                  {push === 'on' ? 'Turn off' : 'Turn on phone alerts'}
                </Button>
              )}
            </div>
          )}
          {q.loading && !q.data ? <Skeleton className="h-40" /> : items.length === 0 ? (
            <EmptyState className="py-8" icon={<Bell />} title="No notifications yet">Updates about your bookings and payments show up here.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => void openItem(n.id, n.link)} className={cn('flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50', !n.read_at && 'bg-brand-50/50')}>
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-ink-900">{n.title}</span>
                        <span className="shrink-0 text-xs text-slate-500">{formatDateTime(n.created_at, tz)}</span>
                      </span>
                      <span className="mt-0.5 block text-slate-600">{n.body}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </>
  );
}
