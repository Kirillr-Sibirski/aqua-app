'use client';

import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/ui';
import { useFieldControl } from './Field';
import { ICON_STROKE } from './icon';
import type { ControlSize } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'size' | 'children'> {
  options: SelectOption[];
  size?: ControlSize;
  invalid?: boolean;
  /** A non-selectable first row, for "choose one" states. Renders disabled so it cannot be picked. */
  placeholder?: string;
  /** Wrapper class; `className` goes to the `<select>`. */
  shellClassName?: string;
  children?: never;
}

/**
 * A native `<select>`, restyled.
 *
 * Deliberately not a custom listbox: the native control is keyboard- and screen-reader-correct in
 * every browser for free, opens as a real OS menu on touch, and its popup follows `color-scheme:
 * dark` from globals.css. A custom one would be a lot of ARIA to re-earn the same behaviour. When
 * an option needs an icon, a balance or a search box, that is a Popover with a listbox inside, not
 * this component.
 */
export function Select({
  options,
  size = 'md',
  invalid,
  placeholder,
  className,
  shellClassName,
  disabled,
  id,
  required,
  ...props
}: SelectProps) {
  const aria = useFieldControl({
    id,
    'aria-describedby': props['aria-describedby'],
    'aria-invalid': invalid,
    required,
  });

  return (
    <div className={cn('relative flex w-full items-center', shellClassName)}>
      <select
        {...props}
        id={aria.id}
        required={aria.required}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        disabled={disabled}
        className={cn(
          'w-full appearance-none rounded-control border bg-surface-2 pl-3 pr-9 text-ink transition-state',
          'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:text-ink-3',
          size === 'sm' ? 'h-8 text-meta' : 'h-10 text-body',
          aria.invalid ? 'border-neg/60 hover:border-neg' : 'border-line hover:border-line-strong',
          className,
        )}
      >
        {placeholder ? (
          <option value="" disabled className="bg-surface text-ink-3">
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="bg-surface text-ink"
          >
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={ICON_STROKE}
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute right-3',
          disabled ? 'text-ink-3' : 'text-ink-2',
        )}
      />
    </div>
  );
}
