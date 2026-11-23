import { cn } from '@/lib/utils';

/** The Nth Play "N" mark, on its cream tile (public/brand/logo-mark.png). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img src="/brand/logo-mark.png" alt="" aria-hidden width={32} height={32}
      className={cn('size-8 shrink-0 rounded-lg object-cover', className)} />
  );
}

export function Logo({ name, dark = false }: { name: string; dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={dark ? 'ring-1 ring-white/15' : 'ring-1 ring-ink-900/10'} />
      <span className={cn('text-[17px] leading-tight font-extrabold tracking-tight', dark ? 'text-white' : 'text-ink-900')}>
        {name}
      </span>
    </span>
  );
}
