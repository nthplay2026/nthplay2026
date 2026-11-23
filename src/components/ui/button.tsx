import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const baseVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand-700 text-white shadow-sm hover:bg-brand-800 active:bg-brand-900',
        accent: 'bg-ball text-ink-900 shadow-sm hover:bg-[#e08d5f]',
        dark: 'bg-ink-900 text-white hover:bg-ink-800',
        secondary: 'bg-slate-100 text-ink-900 hover:bg-slate-200',
        outline: 'border border-slate-300 bg-white text-ink-900 hover:bg-slate-50',
        'outline-light': 'border border-white/40 bg-white/5 text-white hover:bg-white/15',
        ghost: 'text-ink-800 hover:bg-slate-100',
        danger: 'bg-red-600 text-white hover:bg-red-700',
        'danger-outline': 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
        link: 'h-auto px-0 text-brand-700 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        xl: 'h-14 px-7 text-base sm:text-lg',
        icon: 'size-10',
        'icon-sm': 'size-8 rounded-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

/** Variant classes, with any extra `className` merged so later classes win. */
export const buttonVariants = (opts?: Parameters<typeof baseVariants>[0]) => cn(baseVariants(opts));

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof baseVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
