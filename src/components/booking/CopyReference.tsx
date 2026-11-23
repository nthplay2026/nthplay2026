import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText, cn } from '@/lib/utils';

export function CopyReference({ value, className, large }: { value: string; className?: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white pl-3 pr-1 py-1', className)}>
      <code className={cn('font-mono font-bold tracking-wide text-ink-900', large ? 'text-lg sm:text-xl' : 'text-sm')} data-testid="booking-reference">{value}</code>
      <button type="button" onClick={async () => { if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
        aria-label={copied ? 'Copied' : `Copy booking reference ${value}`}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </span>
  );
}
