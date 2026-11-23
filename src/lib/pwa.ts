// Installable-app support: service worker registration and the browser's
// install prompt (Android / desktop Chrome, Edge, Samsung Internet, ...).
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  // Must be registered early: browsers fire this once, soon after load.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not critical */ });
  });
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export type Platform = 'ios' | 'android' | 'desktop';
export type Browser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'samsung' | 'other';

export function detect(): { platform: Platform; browser: Browser } {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const browser: Browser =
    /SamsungBrowser/i.test(ua) ? 'samsung'
      : /EdgiOS|EdgA|Edg\//i.test(ua) ? 'edge'
        : /FxiOS|Firefox/i.test(ua) ? 'firefox'
          : /CriOS|Chrome/i.test(ua) ? 'chrome'
            : /Safari/i.test(ua) ? 'safari' : 'other';
  return { platform: ios ? 'ios' : android ? 'android' : 'desktop', browser };
}

export function useInstall() {
  const [, force] = useState(0);
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onMode = () => setStandalone(isStandalone());
    mq?.addEventListener?.('change', onMode);
    return () => { listeners.delete(l); mq?.removeEventListener?.('change', onMode); };
  }, []);
  return {
    canPrompt: !!deferred,
    installed: installed || standalone,
    standalone,
    ...detect(),
    async promptInstall(): Promise<boolean> {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      await e.prompt();
      const { outcome } = await e.userChoice;
      emit();
      return outcome === 'accepted';
    },
  };
}
