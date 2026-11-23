import { useState, type ReactNode } from 'react';
import { Download, MoreVertical, Menu, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { useInstall, type Browser, type Platform } from '@/lib/pwa';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const Kbd = ({ children }: { children: ReactNode }) => (
  <span className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 align-middle text-xs font-semibold text-ink-900 [&_svg]:size-3.5">{children}</span>
);

function steps(platform: Platform, browser: Browser): { title: string; items: ReactNode[] } {
  if (platform === 'ios') {
    const share = <Kbd><Share /> Share</Kbd>;
    const add = <Kbd><PlusSquare /> Add to Home Screen</Kbd>;
    if (browser === 'chrome') return { title: 'Chrome on iPhone / iPad', items: [<>Tap {share} in the address bar (top right).</>, <>Scroll down and tap {add}.</>, <>Tap <Kbd>Add</Kbd>.</>] };
    if (browser === 'firefox') return { title: 'Firefox on iPhone / iPad', items: [<>Tap the menu <Kbd><Menu /></Kbd> then {share}.</>, <>Tap {add}.</>, <>Tap <Kbd>Add</Kbd>.</>] };
    if (browser === 'edge') return { title: 'Edge on iPhone / iPad', items: [<>Tap the menu <Kbd>⋯</Kbd> then {share}.</>, <>Tap {add}.</>, <>Tap <Kbd>Add</Kbd>.</>] };
    return { title: 'Safari on iPhone / iPad', items: [<>Tap {share} at the bottom of the screen.</>, <>Scroll down and tap {add}.</>, <>Tap <Kbd>Add</Kbd>.</>] };
  }
  if (platform === 'android') {
    if (browser === 'samsung') return { title: 'Samsung Internet', items: [<>Tap the menu <Kbd><Menu /></Kbd> at the bottom.</>, <>Tap <Kbd>Add page to</Kbd> then <Kbd>Home screen</Kbd>.</>, <>Tap <Kbd>Add</Kbd>.</>] };
    if (browser === 'firefox') return { title: 'Firefox for Android', items: [<>Tap the menu <Kbd><MoreVertical /></Kbd>.</>, <>Tap <Kbd>Add app to Home screen</Kbd> (or <Kbd>Install</Kbd>).</>, <>Confirm with <Kbd>Add</Kbd>.</>] };
    return { title: browser === 'edge' ? 'Edge for Android' : 'Chrome for Android', items: [<>Tap the menu <Kbd><MoreVertical /></Kbd> (top right).</>, <>Tap <Kbd>Add to Home screen</Kbd> or <Kbd>Install app</Kbd>.</>, <>Tap <Kbd>Install</Kbd>.</>] };
  }
  return { title: 'On a computer', items: [<>In Chrome or Edge, click the install icon <Kbd><Download /></Kbd> at the right end of the address bar.</>, <>Or open this site on your phone to add it to your home screen.</>] };
}

/** "Get the app" button + instructions dialog. Hidden once the app is installed. */
export function InstallAppButton({ className, variant = 'ghost', label = 'Get the app' }: { className?: string; variant?: 'ghost' | 'outline' | 'primary' | 'accent'; label?: string }) {
  const install = useInstall();
  const [open, setOpen] = useState(false);
  if (install.installed) return null;
  const onClick = async () => {
    if (install.canPrompt && (await install.promptInstall())) return;
    setOpen(true);
  };
  return (
    <>
      <Button variant={variant} size="sm" className={className} onClick={onClick}><Smartphone /> {label}</Button>
      <InstallDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function InstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const install = useInstall();
  const s = steps(install.platform, install.browser);
  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Install the Nth Play app"
      description="Add Nth Play to your home screen — it opens full-screen like a regular app.">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" className="size-14 rounded-2xl shadow-sm" />
          <div>
            <p className="font-semibold">Nth Play</p>
            <p className="text-sm text-slate-500">Book the court in seconds</p>
          </div>
        </div>
        {install.canPrompt && (
          <Button className="w-full" onClick={async () => { if (await install.promptInstall()) onClose(); }}><Download /> Install app</Button>
        )}
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-semibold">{install.canPrompt ? 'Or add it manually' : s.title}</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-800">
            {s.items.map((it, i) => <li key={i}>{it}</li>)}
          </ol>
        </div>
        {install.platform === 'ios' && install.browser !== 'safari' && (
          <p className="text-xs text-slate-500">Adding to the Home Screen from Chrome, Edge or Firefox needs iOS 16.4 or newer. On older iPhones, open this site in Safari.</p>
        )}
      </div>
    </Dialog>
  );
}

/** A dismissible card on phones, shown on the home page until installed or dismissed. */
export function InstallBanner() {
  const install = useInstall();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem('nthplay:install-dismissed') === '1'; } catch { return false; }
  });
  const [open, setOpen] = useState(false);
  if (install.installed || hidden || install.platform === 'desktop') return null;
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem('nthplay:install-dismissed', '1'); } catch { /* ignore */ }
  };
  return (
    <div className={cn('container-page pt-4')}>
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-card">
        <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-900">Get the Nth Play app</p>
          <p className="truncate text-xs text-slate-500">Book faster from your home screen.</p>
        </div>
        <Button size="sm" onClick={async () => { if (install.canPrompt && (await install.promptInstall())) return; setOpen(true); }}>Install</Button>
        <button type="button" onClick={dismiss} className="rounded-lg p-1.5 text-slate-400 hover:text-ink-900" aria-label="Dismiss"><X className="size-4" /></button>
      </div>
      <InstallDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
