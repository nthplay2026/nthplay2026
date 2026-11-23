import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Modal built on the native <dialog> element: focus is trapped and restored by
 * the browser, Escape closes it, and the rest of the page becomes inert.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', className }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  // On phones, every dialog bigger than a small confirmation fills the screen
  // (a centred box gets clipped by the browser bars); desktop keeps the centred card.
  const fullOnPhone = size !== 'sm';

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn(
        'm-auto w-[calc(100%-1.5rem)] rounded-2xl bg-white p-0 text-ink-900 shadow-lift backdrop:bg-transparent open:flex open:flex-col max-h-[calc(100dvh-2rem)]',
        { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size],
        fullOnPhone && 'max-sm:m-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:shadow-none',
        className,
      )}
    >
      {open && (
        <>
          <div className={cn('flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6',
            fullOnPhone && 'max-sm:pt-[max(1rem,env(safe-area-inset-top))]')}>
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
              {description && <p id={descId} className="mt-0.5 text-sm text-slate-600">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="-mr-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-ink-900" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6',
            fullOnPhone && !footer && 'max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]')}>{children}</div>
          {footer && <div className={cn('flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4 sm:px-6',
            fullOnPhone && 'max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]')}>{footer}</div>}
        </>
      )}
    </dialog>
  );
}
