'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/ui';

interface FieldContextValue {
  controlId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  /** Sentence case, not a colon-terminated form label. "Amount", "Fee", "Deadline". */
  label: string;
  /** One line under the control. Suppressed while `error` is showing. */
  hint?: ReactNode;
  /** A decoded reason, not "Invalid input". Replaces the hint and is announced. */
  error?: ReactNode;
  /** Right of the label: a balance readout, a unit toggle, a "Use max" link. */
  aside?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Label, hint and error wiring for one control.
 *
 * The control does not have to be told its id: `Input`, `NumberInput` and `Select` read this
 * context, so `aria-describedby`, `aria-invalid` and the `label`/`for` association cannot drift
 * apart by hand. A control rendered outside a Field keeps whatever ids the caller passes.
 */
export function Field({
  label,
  hint,
  error,
  aside,
  required = false,
  className,
  children,
}: FieldProps) {
  const base = useId();
  const controlId = `${base}-control`;
  const messageId = `${base}-message`;
  const message = error ?? hint;

  return (
    <FieldContext.Provider
      value={{
        controlId,
        describedBy: message ? messageId : undefined,
        invalid: Boolean(error),
        required,
      }}
    >
      <div className={cn('flex flex-col gap-2', className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={controlId} className="text-mini text-ink-2">
            {label}
            {required ? (
              <>
                <span aria-hidden="true" className="text-ink-3">
                  {' '}
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </>
            ) : null}
          </label>
          {aside ? <div className="text-mini text-ink-3">{aside}</div> : null}
        </div>
        {children}
        {message ? (
          <p
            id={messageId}
            className={cn('text-mini', error ? 'text-neg' : 'text-ink-3')}
            role={error ? 'alert' : undefined}
          >
            {message}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export interface ControlAria {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}

/**
 * Merge a control's own aria props with the surrounding Field. The control's explicit props win,
 * so a caller can always override the wiring.
 */
export function useFieldControl(own: ControlAria): ControlAria & { invalid: boolean } {
  const field = useContext(FieldContext);
  if (!field) {
    return { ...own, invalid: own['aria-invalid'] === true };
  }
  const describedBy = [own['aria-describedby'], field.describedBy].filter(Boolean).join(' ');
  const invalid = own['aria-invalid'] ?? field.invalid;
  return {
    id: own.id ?? field.controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': invalid || undefined,
    required: own.required ?? field.required,
    invalid,
  };
}
