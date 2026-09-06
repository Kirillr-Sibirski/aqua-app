'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { useRef, type ComponentPropsWithRef, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { useFieldControl } from './Field';

/**
 * The shared shell for text-like controls.
 *
 * The focus ring lives on the shell rather than on the `<input>` because leading and trailing
 * slots sit inside the same border: a ring drawn on the input alone would cut through them.
 * `has-[input:focus-visible]` keeps the ring keyboard-only, exactly as the global rule does.
 */
export const controlShell = cva(
  [
    'flex w-full cursor-text items-center gap-2 rounded-control border bg-surface-2 px-3',
    'transition-state has-[input:focus-visible]:focus-ring',
  ],
  {
    variants: {
      size: { sm: 'h-8 text-meta', md: 'h-10 text-body' },
      state: {
        idle: 'border-line hover:border-line-strong',
        invalid: 'border-neg/60 hover:border-neg',
        inert: 'cursor-not-allowed border-line bg-surface',
      },
    },
    defaultVariants: { size: 'md', state: 'idle' },
  },
);

export type ControlSize = NonNullable<VariantProps<typeof controlShell>['size']>;

export interface ControlShellProps {
  size?: ControlSize;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  /** Clicking the padding around the input focuses it, the way a native input behaves. */
  onShellPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}

export function ControlShell({
  size = 'md',
  invalid = false,
  disabled = false,
  className,
  children,
  onShellPointerDown,
}: ControlShellProps) {
  return (
    <div
      className={cn(
        controlShell({ size, state: disabled ? 'inert' : invalid ? 'invalid' : 'idle' }),
        className,
      )}
      onPointerDown={onShellPointerDown}
    >
      {children}
    </div>
  );
}

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'prefix'> {
  size?: ControlSize;
  invalid?: boolean;
  /** Rendered inside the border, before the text: an icon or a unit. */
  leading?: ReactNode;
  /** Rendered inside the border, after the text: a unit, a clear button, a Kbd hint. */
  trailing?: ReactNode;
  /** Addresses, hashes and amounts are mono; prose is not. */
  mono?: boolean;
  /** Wrapper class; `className` goes to the `<input>` itself. */
  shellClassName?: string;
}

/**
 * A single-line text control. Numbers do not belong here — use NumberInput, which is bigint-safe.
 */
export function Input({
  size = 'md',
  invalid,
  leading,
  trailing,
  mono = false,
  className,
  shellClassName,
  disabled,
  id,
  required,
  ref,
  ...props
}: InputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const aria = useFieldControl({
    id,
    'aria-describedby': props['aria-describedby'],
    'aria-invalid': invalid,
    required,
  });

  return (
    <ControlShell
      size={size}
      invalid={aria.invalid}
      disabled={disabled}
      className={shellClassName}
      onShellPointerDown={(event) => {
        if (event.target === event.currentTarget) innerRef.current?.focus();
      }}
    >
      {leading ? (
        <span className="flex shrink-0 items-center text-ink-3" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <input
        {...props}
        id={aria.id}
        required={aria.required}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        disabled={disabled}
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-ink outline-none',
          'disabled:cursor-not-allowed disabled:text-ink-3',
          mono && 'font-mono tnum',
          className,
        )}
      />
      {trailing ? <span className="flex shrink-0 items-center gap-1">{trailing}</span> : null}
    </ControlShell>
  );
}
