import { cloneElement, forwardRef, isValidElement, useId, type ComponentProps, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
  'block w-full rounded-xl border border-slate-300 bg-white px-3.5 text-base text-ink-900 sm:text-[15px] shadow-xs placeholder:text-slate-400 transition-colors focus:border-brand-600 focus:outline-none focus:ring-3 focus:ring-brand-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(control, 'h-11', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-24 py-2.5', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(control, 'h-11 cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2020%2020%27%20fill=%27%2364748b%27%3E%3Cpath%20d=%27M5.23%207.21a.75.75%200%20011.06.02L10%2011.17l3.71-3.94a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%27/%3E%3C/svg%3E")] bg-[length:1.25rem] bg-[right_0.75rem_center] bg-no-repeat pr-10', className)} {...p}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Label({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-medium text-ink-800', className)} {...p} />;
}

/**
 * Accessible field wrapper: wires label, hint and error to the control via ids.
 * Pass exactly one form control as the child.
 */
export function Field({ label, hint, error, required, className, children, optional }: {
  label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; optional?: boolean; className?: string; children: ReactElement;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
        'aria-required': required || undefined,
      })
    : children;
  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
        {optional && <span className="ml-1.5 text-xs font-normal text-slate-500">(optional)</span>}
      </Label>
      {child}
      {hint && !error && <p id={hintId} className="mt-1.5 text-xs text-slate-500">{hint}</p>}
      {error && <p id={errId} className="mt-1.5 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}

export function Checkbox({ label, className, ...p }: Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border-slate-300 accent-brand-700" {...p} />
      <label htmlFor={id} className="cursor-pointer text-sm leading-6 text-ink-800">{label}</label>
    </div>
  );
}
