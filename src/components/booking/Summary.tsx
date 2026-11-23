import { useState, type ReactNode } from 'react';
import { CalendarDays, Clock, Download, MapPin, Maximize2, Timer } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import type { PaymentMethodConfig, PriceLine } from '@/lib/types';
import { formatDateLong, formatDuration, formatTime, relativeCountdown } from '@/lib/time';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useNow } from '@/hooks/useAsync';

export function SummaryRow({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      {icon && <span className="mt-0.5 text-slate-400 [&_svg]:size-4.5" aria-hidden>{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-4">
        <dt className="text-sm text-slate-600">{label}</dt>
        <dd className="text-sm font-semibold text-ink-900">{children}</dd>
      </div>
    </div>
  );
}

export function BookingSummary({ courtName, courtType, start, end, minutes, hourlyRate, breakdown, total, currency, tz, extra }: {
  courtName: string; courtType?: string; start: string; end: string; minutes: number; hourlyRate?: number;
  breakdown?: PriceLine[]; total: number; currency: string; tz: string; extra?: ReactNode;
}) {
  const multiRate = (breakdown?.length ?? 0) > 1;
  return (
    <div>
      <dl className="divide-y divide-slate-100">
        <SummaryRow icon={<MapPin />} label="Court">{courtName}{courtType && <span className="ml-1 font-normal capitalize text-slate-500">· {courtType}</span>}</SummaryRow>
        <SummaryRow icon={<CalendarDays />} label="Date">{formatDateLong(start, tz)}</SummaryRow>
        <SummaryRow icon={<Clock />} label="Time">{formatTime(start, tz)} – {formatTime(end, tz)}</SummaryRow>
        <SummaryRow icon={<Timer />} label="Duration">{formatDuration(minutes)}</SummaryRow>
        {!multiRate && hourlyRate != null && <SummaryRow label="Hourly rate">{money(hourlyRate, currency)}</SummaryRow>}
        {extra}
      </dl>
      {multiRate && (
        <div className="mt-2 rounded-xl bg-slate-50 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Price breakdown</p>
          <ul className="space-y-1 text-sm">
            {breakdown!.map((l) => (
              <li key={`${l.label}-${l.rate}`} className="flex justify-between gap-3">
                <span className="text-slate-700">{l.label} · {formatDuration(l.minutes)} × {money(l.rate, currency)}/hr</span>
                <span className="font-medium tabular-nums">{money(l.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold text-ink-900">Total</span>
        <span className="text-2xl font-bold tracking-tight text-ink-900 tabular-nums" data-testid="total">{money(total, currency)}</span>
      </div>
    </div>
  );
}

export function HoldCountdown({ expiresAt, className }: { expiresAt: string; className?: string }) {
  const now = useNow(1000);
  const left = Date.parse(expiresAt) - now;
  const urgent = left < 120_000;
  return (
    <div className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium',
      left <= 0 ? 'bg-red-50 text-red-800' : urgent ? 'bg-amber-50 text-amber-900' : 'bg-sky-50 text-sky-900', className)}
      role="timer" aria-live={urgent ? 'polite' : 'off'}>
      <Timer className="size-4" aria-hidden />
      {left > 0
        ? <>Slot held for you · <span className="font-bold tabular-nums">{relativeCountdown(left)}</span> left</>
        : <>Your hold has expired — we'll re-check the slot when you confirm.</>}
    </div>
  );
}

/**
 * The facility's payment QR codes side by side. The customer scans whichever
 * suits their app and taps it, so staff know which account to check.
 */
export function QrPayment({ methods, selected, onSelect, amount, currency = 'PHP' }: {
  methods: PaymentMethodConfig[]; selected?: string; onSelect: (method: PaymentMethodConfig['method']) => void;
  amount?: number; currency?: string;
}) {
  const choosable = methods.length > 1;
  const [zoom, setZoom] = useState<PaymentMethodConfig | null>(null);
  return (
    <div className="space-y-4 text-sm leading-relaxed text-ink-800">
      <div className={cn('grid gap-3', choosable && 'sm:grid-cols-2')}>
        {methods.map((m) => {
          const active = !choosable || selected === m.method;
          return (
            <div key={m.method} role={choosable ? 'button' : undefined} tabIndex={choosable ? 0 : undefined} aria-pressed={choosable ? active : undefined}
              onClick={() => onSelect(m.method)} onKeyDown={(e) => { if (choosable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(m.method); } }}
              className={cn('flex flex-col items-center gap-2 rounded-xl border bg-white p-4 transition-colors',
                choosable && 'cursor-pointer hover:border-brand-500',
                active && choosable ? 'border-ink-900 ring-2 ring-ink-900' : 'border-slate-200')}>
              <p className="flex items-center gap-2 font-semibold text-ink-900">
                {choosable && <span className={cn('grid size-4 place-items-center rounded-full border', active ? 'border-ink-900 bg-ink-900' : 'border-slate-400')} aria-hidden>
                  {active && <span className="size-1.5 rounded-full bg-white" />}
                </span>}
                {m.label}
              </p>
              {m.qr_url && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(m.method); setZoom(m); }}
                  className="group relative rounded-lg focus-visible:outline-2 focus-visible:outline-brand-600" aria-label={`Enlarge ${m.label}`}>
                  <img src={m.qr_url} alt={`${m.label} to pay`} className="size-52 object-contain sm:size-48" />
                  <span className="absolute inset-x-0 bottom-1 mx-auto flex w-max items-center gap-1 rounded-full bg-ink-900/80 px-2 py-0.5 text-[11px] font-medium text-white">
                    <Maximize2 className="size-3" aria-hidden /> Tap to enlarge
                  </span>
                </button>
              )}
              {m.qr_url && (
                <a href={m.qr_url} download={`${m.label.toLowerCase().replace(/\s+/g, '-')}.jpg`} onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                  <Download className="size-3.5" aria-hidden /> Save QR image
                </a>
              )}
              {(m.account_name || m.account_number) && (
                <p className="text-center text-xs text-slate-600">{m.account_name}{m.account_name && m.account_number && ' · '}{m.account_number && <span className="font-mono font-semibold">{m.account_number}</span>}</p>
              )}
            </div>
          );
        })}
      </div>
      <Dialog open={!!zoom} onClose={() => setZoom(null)} size="lg" title={zoom?.label ?? 'QR code'}
        description={amount != null ? `Scan to pay ${money(amount, currency)}` : 'Scan to pay'}>
        {zoom?.qr_url && (
          <div className="flex flex-col items-center gap-3">
            <img src={zoom.qr_url} alt={`${zoom.label} to pay`} className="max-h-[70vh] w-full max-w-xl object-contain" />
            <a href={zoom.qr_url} download={`${zoom.label.toLowerCase().replace(/\s+/g, '-')}.jpg`}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50">
              <Download className="size-4" aria-hidden /> Save QR image
            </a>
          </div>
        )}
      </Dialog>
      <ol className="list-decimal space-y-1.5 rounded-xl bg-slate-50 py-3 pl-9 pr-4 text-slate-700">
        <li>{choosable ? 'Choose a QR code and scan it' : 'Scan the QR code'} with GCash, Maya or your bank's app. On your phone, tap <strong>Save QR image</strong> and use <strong>Upload QR</strong> in the app.</li>
        {amount != null && <li>Pay exactly <strong className="text-ink-900">{money(amount, currency)}</strong>.</li>}
        <li>Take a <strong>screenshot of your receipt</strong> and upload it below.</li>
      </ol>
    </div>
  );
}
