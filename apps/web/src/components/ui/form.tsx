import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';

/** Inputs: 12px corners, a 3:1 boundary, and an accent border plus soft halo on focus. */
const control =
  'w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 text-sm text-fg ' +
  'shadow-[inset_0_1px_1px_rgb(16_42_44/0.04)] placeholder:text-fg-subtle ' +
  'transition-[border-color,box-shadow,background-color] duration-200 ease-[var(--ease-out)] ' +
  'hover:border-fg-subtle focus-visible:border-accent focus-visible:outline-none ' +
  'focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_18%,transparent)] ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--danger)_18%,transparent)]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, 'h-10', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea ref={ref} className={cn(control, 'min-h-24 py-2.5 leading-relaxed', className)} {...props} />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, 'h-10 pr-9', className)} {...props}>
      {children}
    </select>
  );
});

export const Checkbox = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }
>(function Checkbox({ label, description, className, id, ...props }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4.5 w-4.5 shrink-0 cursor-pointer rounded-[5px] border-border-strong accent-[var(--accent)]"
        {...props}
      />
      <div>
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
    </div>
  );
});

interface FieldProps {
  label: ReactNode;
  /** Renders the control; receives the ids needed for accessible labelling. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  hint?: ReactNode;
  error?: string | string[];
  required?: boolean;
  className?: string;
}

/** Label above, hint below the label, error below the control, all wired with aria attributes. */
export function Field({ label, children, hint, error, required, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-[0.8125rem] text-fg-muted">
          {hint}
        </p>
      )}
      {children({
        id,
        describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined,
        invalid: Boolean(message),
      })}
      {message && (
        <p id={errorId} className="text-[0.8125rem] font-medium text-danger" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-control)] bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_25%,transparent)]"
    >
      {message}
    </div>
  );
}
