import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-slate-200/80 bg-white shadow-card', className)} {...p} />;
}
export function CardHeader({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-0 sm:p-6 sm:pb-0', className)} {...p} />;
}
export function CardTitle({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold text-ink-900', className)} {...p} />;
}
export function CardDescription({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-slate-600', className)} {...p} />;
}
export function CardContent({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 sm:p-6', className)} {...p} />;
}

const tones = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-brand-50 text-brand-800 ring-brand-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  dark: 'bg-ink-900 text-white ring-ink-900',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', className, children, dot }: { tone?: Tone; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

const alertTones = {
  info: { cls: 'border-sky-200 bg-sky-50 text-sky-900', Icon: Info },
  success: { cls: 'border-brand-200 bg-brand-50 text-brand-900', Icon: CheckCircle2 },
  warning: { cls: 'border-amber-200 bg-amber-50 text-amber-900', Icon: TriangleAlert },
  error: { cls: 'border-red-200 bg-red-50 text-red-900', Icon: AlertCircle },
};

export function Alert({ tone = 'info', title, children, className, action }: {
  tone?: keyof typeof alertTones; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode;
}) {
  const { cls, Icon } = alertTones[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border p-4 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-1', 'leading-relaxed')}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-slate-500', className)}>
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="size-7 animate-spin text-brand-600" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-200/70', className)} aria-hidden />;
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center', className)}>
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-full bg-slate-100 text-slate-500 [&_svg]:size-6">{icon}</div>}
      <p className="text-base font-semibold text-ink-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <Alert tone="error" title="Something went wrong" className={className}
      action={onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}>
      {message}
    </Alert>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="flex items-center justify-between gap-3 pt-4 text-sm" aria-label="Pagination">
      <p className="text-slate-600">
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className, label }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex rounded-xl bg-slate-100 p-1', className)}>
      {items.map((it) => (
        <button key={it.value} role="tab" type="button" aria-selected={value === it.value}
          className={cn('inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
            value === it.value ? 'bg-white text-ink-900 shadow-sm' : 'text-slate-600 hover:text-ink-900')}
          onClick={() => onChange(it.value)}>
          {it.label}
          {it.count != null && <span className="rounded-full bg-slate-200 px-1.5 text-xs">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'default', to, onClick }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'default' | 'warning' | 'brand'; to?: string; onClick?: () => void }) {
  const card = (
    <Card className={cn('h-full p-5', (to || onClick) && 'transition-shadow group-hover:shadow-lift group-hover:ring-1 group-hover:ring-brand-300')}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {icon && <span className={cn('grid size-9 place-items-center rounded-xl [&_svg]:size-4.5',
          tone === 'warning' ? 'bg-amber-50 text-amber-700' : tone === 'brand' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-ink-700')}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-ink-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} className="group block w-full rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-brand-600" aria-label={`${label}: preview`}>{card}</button>;
  }
  return to ? <Link to={to} className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-brand-600" aria-label={`${label}: open details`}>{card}</Link> : card;
}
