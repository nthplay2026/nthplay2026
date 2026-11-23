import { RefreshCw } from 'lucide-react';
import type { LiveStatus } from '@/hooks/useLiveAvailability';
import { cn } from '@/lib/utils';

export function LiveIndicator({ status, lastUpdated, onRefresh }: { status: LiveStatus; lastUpdated: number | null; onRefresh?: () => void }) {
  const label = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  return (
    <div className="flex items-center gap-2 text-xs text-slate-600" data-testid="live-indicator" data-status={status}>
      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ring-1 ring-inset',
        status === 'live' ? 'bg-brand-50 text-brand-800 ring-brand-200' : 'bg-amber-50 text-amber-800 ring-amber-200')}>
        <span className={cn('size-2 rounded-full', status === 'live' ? 'bg-brand-500 animate-pulse-soft' : 'bg-amber-500')} aria-hidden />
        {label}
      </span>
      {lastUpdated && (
        <span className="hidden sm:inline">
          Updated {new Date(lastUpdated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
      {onRefresh && (
        <button type="button" onClick={onRefresh} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-ink-900" aria-label="Refresh availability">
          <RefreshCw className="size-3.5" />
        </button>
      )}
    </div>
  );
}
