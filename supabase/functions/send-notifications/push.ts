// Sends Web Push notifications to users' installed apps/browsers.
// Loaded only when VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set.
import webpush from 'npm:web-push@3.6.7';

export interface PushItem {
  id: string;
  title: string;
  body: string;
  link: string | null;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
}

export function pushSender(cfg: { publicKey: string; privateKey: string; subject: string }) {
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return {
    /** Returns endpoints that are gone (uninstalled / permission removed) so they can be deleted. */
    async send(item: PushItem): Promise<{ sent: number; gone: string[] }> {
      const payload = JSON.stringify({ title: item.title, body: item.body, link: item.link ?? '/', tag: item.id });
      let sent = 0;
      const gone: string[] = [];
      for (const s of item.subscriptions) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) gone.push(s.endpoint);
        }
      }
      return { sent, gone };
    },
  };
}
