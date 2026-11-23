import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { CourtType } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Top-down pickleball court illustration (used when no photo or video is set). */
export function CourtArt({ type, className, label }: { type: CourtType; className?: string; label?: string }) {
  const indoor = type === 'indoor';
  // Colours of the real Nth Play court: burnt-orange service boxes, with the
  // kitchen (non-volley zone) the same sand colour as the surround.
  const surround = indoor ? '#bfa98c' : '#d6c3a7';
  const court = indoor ? '#b8582a' : '#c8642c';
  const kitchen = surround;
  return (
    <svg viewBox="0 0 400 240" className={cn('h-full w-full', className)} role="img" aria-label={label ?? `${type} pickleball court illustration`} preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="240" fill={surround} />
      <rect x="40" y="30" width="320" height="180" rx="2" fill={court} />
      <rect x="166" y="30" width="68" height="180" fill={kitchen} />
      <g stroke="#fff" strokeWidth="3" fill="none" opacity="0.95">
        <rect x="40" y="30" width="320" height="180" />
        <line x1="166" y1="30" x2="166" y2="210" />
        <line x1="234" y1="30" x2="234" y2="210" />
        <line x1="40" y1="120" x2="166" y2="120" />
        <line x1="234" y1="120" x2="360" y2="120" />
      </g>
      <line x1="200" y1="22" x2="200" y2="218" stroke="#161412" strokeWidth="5" />
      {indoor && <g fill="#fff" opacity="0.18">{[70, 160, 250, 340].map((x) => <rect key={x} x={x - 20} y="4" width="40" height="8" rx="4" />)}</g>}
    </svg>
  );
}

export const isVideoUrl = (src: string | null | undefined) => !!src && /\.(mp4|webm|m4v|mov)(\?.*)?$/i.test(src);

/** For site-hosted videos, '/media/x.mp4' has its still frame at '/media/x-poster.jpg'. */
const posterFor = (src: string) => (src.startsWith('/media/') ? src.replace(/\.(mp4|webm|m4v|mov)(\?.*)?$/i, '-poster.jpg') : undefined);

/**
 * Silent, looping background video. Always muted (the site's own file also has
 * no audio track), plays inline on phones, and has a pause button. Visitors who
 * prefer reduced motion see the still frame until they press play.
 */
export function CourtVideo({ src, label, className }: { src: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;            // React doesn't reliably set the muted attribute
    v.defaultMuted = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [src]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { v.muted = true; void v.play().then(() => setPlaying(true)); } else { v.pause(); setPlaying(false); }
  };

  return (
    <div className={cn('relative h-full w-full', className)}>
      <video ref={ref} src={src} poster={posterFor(src)} muted loop playsInline preload="metadata" aria-label={label}
        className="h-full w-full object-cover" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      <button type="button" onClick={toggle}
        className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-ink-950/60 text-white backdrop-blur transition-colors hover:bg-ink-950/80"
        aria-label={playing ? 'Pause video' : 'Play video'}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
    </div>
  );
}

/** A court's photo or video, falling back to an illustration. */
export function CourtImage({ src, type, name, className }: { src: string | null; type: CourtType; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <CourtArt type={type} className={className} label={`${name} (${type})`} />;
  if (isVideoUrl(src)) return <CourtVideo src={src} label={`Video of ${name}, ${type} court`} className={className} />;
  return <img src={src} alt={`${name} — ${type} court`} loading="lazy" onError={() => setFailed(true)} className={cn('h-full w-full object-cover', className)} />;
}
