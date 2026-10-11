import { Loader2 } from './icons';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'icon';

/** Pill buttons with a physical press: they settle down slightly on :active and spring back. */
const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium select-none ' +
  'transition-[background-color,color,box-shadow,transform,opacity] duration-200 ease-[var(--ease-spring)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(10_70_70/0.25),0_6px_16px_-6px_rgb(10_70_70/0.45)] ' +
    'dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_6px_18px_-8px_rgb(86_184_180/0.45)]',
  secondary:
    'bg-surface text-fg hover:bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong),0_1px_2px_rgb(16_42_44/0.06)] ' +
    'dark:shadow-[inset_0_0_0_1px_var(--border-strong)]',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger:
    'bg-danger text-white hover:opacity-90 dark:text-[#1d0705] ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_6px_16px_-6px_rgb(180_35_24/0.45)]',
  link: 'text-accent underline-offset-4 hover:underline px-0 h-auto active:scale-100 rounded-[var(--radius-badge)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-sm',
  md: 'h-10 px-5 text-sm',
  icon: 'h-9 w-9 p-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button (prevents duplicate submissions). */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], variant !== 'link' && sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: LinkProps & { variant?: Variant; size?: Size }) {
  return (
    <Link className={cn(base, variants[variant], variant !== 'link' && sizes[size], className)} {...props} />
  );
}
