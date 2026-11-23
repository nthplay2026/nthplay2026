import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info';
interface Toast { id: number; tone: ToastTone; title: string; description?: string }

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((tone: ToastTone, title: string, description?: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, tone, title, description }]);
    setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    success: (t, d) => push('success', t, d),
    error: (t, d) => push('error', t, d),
    info: (t, d) => push('info', t, d),
  }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertCircle : Info;
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
              className={cn('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white p-4 shadow-lift',
                t.tone === 'error' ? 'border-red-200' : 'border-slate-200')}>
              <Icon className={cn('mt-0.5 size-5 shrink-0', t.tone === 'success' ? 'text-brand-600' : t.tone === 'error' ? 'text-red-600' : 'text-sky-600')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm text-slate-600">{t.description}</p>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="rounded p-1 text-slate-400 hover:text-ink-900" aria-label="Dismiss">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
