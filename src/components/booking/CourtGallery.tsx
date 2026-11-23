import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { CourtPhoto } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Court photos, laid out by how many there are:
 *   0      nothing at all (no placeholder)
 *   1      one wide photo
 *   2      side by side
 *   3      one large + two stacked
 *   4      2 x 2 grid
 *   5+     swipeable carousel with arrows, dots and a counter
 * Tapping any photo opens a full-screen viewer (swipe / arrow keys / Esc).
 */
export function CourtGallery({ photos, name, className }: { photos: CourtPhoto[]; name: string; className?: string }) {
  const [viewer, setViewer] = useState<number | null>(null);
  if (!photos.length) return null;

  const tile = (p: CourtPhoto, i: number, extra?: string) => (
    <button key={p.path} type="button" onClick={() => setViewer(i)}
      className={cn('group relative block overflow-hidden rounded-2xl bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600', extra)}
      aria-label={`View photo ${i + 1} of ${photos.length} of ${name}`}>
      <img src={p.url} alt="" loading={i === 0 ? 'eager' : 'lazy'} decoding="async"
        className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
    </button>
  );

  let layout: ReactNode;
  if (photos.length === 1) {
    layout = tile(photos[0], 0, 'aspect-[16/9] w-full shadow-card');
  } else if (photos.length === 2) {
    layout = <div className="grid grid-cols-2 gap-2 sm:gap-3">{photos.map((p, i) => tile(p, i, 'aspect-[4/3]'))}</div>;
  } else if (photos.length === 3) {
    layout = (
      <div className="grid grid-cols-3 grid-rows-2 gap-2 sm:gap-3 aspect-[16/9]">
        {tile(photos[0], 0, 'col-span-2 row-span-2')}
        {tile(photos[1], 1)}
        {tile(photos[2], 2)}
      </div>
    );
  } else if (photos.length === 4) {
    layout = <div className="grid grid-cols-2 gap-2 sm:gap-3">{photos.map((p, i) => tile(p, i, 'aspect-[4/3]'))}</div>;
  } else {
    layout = <Carousel photos={photos} name={name} onOpen={setViewer} />;
  }

  return (
    <div className={className}>
      {layout}
      {viewer !== null && <Viewer photos={photos} name={name} start={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

/** Horizontal scroll-snap strip: native swipe on phones, arrows on desktop. */
function Carousel({ photos, name, onOpen }: { photos: CourtPhoto[]; name: string; onOpen: (i: number) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const go = (i: number) => {
    const el = strip.current;
    if (!el) return;
    const next = (i + photos.length) % photos.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  };
  const onScroll = () => {
    const el = strip.current;
    if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <div className="relative" role="region" aria-roledescription="carousel" aria-label={`${name} photos`}>
      <div ref={strip} onScroll={onScroll}
        className="flex aspect-[16/9] snap-x snap-mandatory overflow-x-auto rounded-2xl shadow-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {photos.map((p, i) => (
          <button key={p.path} type="button" onClick={() => onOpen(i)} className="relative h-full w-full shrink-0 snap-center bg-slate-100"
            aria-label={`View photo ${i + 1} of ${photos.length}`}>
            <img src={p.url} alt="" loading={i < 2 ? 'eager' : 'lazy'} decoding="async" className="size-full object-cover" />
          </button>
        ))}
      </div>
      <button type="button" onClick={() => go(index - 1)} aria-label="Previous photo"
        className="absolute left-3 top-1/2 hidden -translate-y-1/2 place-items-center rounded-full bg-white/90 p-2 text-ink-900 shadow-lift hover:bg-white sm:grid">
        <ChevronLeft className="size-5" />
      </button>
      <button type="button" onClick={() => go(index + 1)} aria-label="Next photo"
        className="absolute right-3 top-1/2 hidden -translate-y-1/2 place-items-center rounded-full bg-white/90 p-2 text-ink-900 shadow-lift hover:bg-white sm:grid">
        <ChevronRight className="size-5" />
      </button>
      <span className="absolute right-3 top-3 rounded-full bg-ink-950/60 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">
        {index + 1} / {photos.length}
      </span>
      <div className="mt-3 flex justify-center gap-1.5">
        {photos.map((p, i) => (
          <button key={p.path} type="button" onClick={() => go(i)} aria-label={`Go to photo ${i + 1}`} aria-current={i === index}
            className={cn('h-2 rounded-full transition-all', i === index ? 'w-5 bg-brand-700' : 'w-2 bg-slate-300 hover:bg-slate-400')} />
        ))}
      </div>
    </div>
  );
}

/** Full-screen photo viewer: swipe on phones, arrows / keyboard elsewhere. */
function Viewer({ photos, name, start, onClose }: { photos: CourtPhoto[]; name: string; start: number; onClose: () => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);

  const go = useCallback((i: number) => {
    const el = strip.current;
    if (!el) return;
    const next = (i + photos.length) % photos.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  }, [photos.length]);

  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = start * el.clientWidth;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950/95" role="dialog" aria-modal="true" aria-label={`${name} photos`}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-semibold tabular-nums">{index + 1} / {photos.length}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-white/10"><X className="size-6" /></button>
      </div>
      <div ref={strip} onScroll={() => { const el = strip.current; if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth)); }}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {photos.map((p, i) => (
          <div key={p.path} className="grid h-full w-full shrink-0 snap-center place-items-center p-2 sm:p-6">
            <img src={p.url} alt={`${name}, photo ${i + 1}`} className="max-h-full max-w-full rounded-lg object-contain" />
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" onClick={() => go(index - 1)} aria-label="Previous photo"
            className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 p-3 text-white hover:bg-white/25 sm:block"><ChevronLeft className="size-6" /></button>
          <button type="button" onClick={() => go(index + 1)} aria-label="Next photo"
            className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 p-3 text-white hover:bg-white/25 sm:block"><ChevronRight className="size-6" /></button>
        </>
      )}
    </div>
  );
}
