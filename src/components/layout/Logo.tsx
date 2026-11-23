import { cn } from '@/lib/utils';

/** The full Nth Play logo (the N mark with "Play" under it) on its cream tile (public/brand/logo-full.png, 3:4). */
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  return (
    <img src="/brand/logo-full.png" alt={label ?? ''} aria-hidden={label ? undefined : true} width={36} height={48}
      className={cn('h-12 w-9 shrink-0 rounded-lg object-contain', className)} />
  );
}

/** Header/footer/sidebar logo: the full logo with the facility name beside it. */
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
