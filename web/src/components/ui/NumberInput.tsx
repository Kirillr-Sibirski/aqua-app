'use client';

import { useRef, type ChangeEvent, type ComponentPropsWithRef } from 'react';
import { cn, toDecimalString } from '@/lib/ui';
import { ControlShell, type ControlSize } from './Input';
import { useFieldControl } from './Field';

const TWO = BigInt(2);

/**
 * Constrain a keystroke to something that can become a fixed-point bigint.
 *
 * Returns the value to display, or `null` when the edit must be rejected outright (a letter, a
 * second decimal point, a minus sign — amounts are never negative). Fraction digits past
 * `decimals` are dropped rather than rounded, because rounding up an amount a maker typed would
 * silently ship more inventory than they asked for.
 *
 * Intermediate states a person types through are all valid: `''`, `'0.'`, `'.5'`.
 */
export function sanitizeDecimalInput(raw: string, decimals: number): string | null {
  const cleaned = raw.replace(/[\s_,]/g, '');
  if (cleaned === '') return '';
  if (!/^\d*(?:\.\d*)?$/.test(cleaned)) return null;
  if (decimals === 0 && cleaned.includes('.')) return null;

  const [int = '', frac] = cleaned.split('.');
  const trimmedInt = int.replace(/^0+(?=\d)/, '');
  if (frac === undefined) return trimmedInt;
  return `${trimmedInt}.${frac.slice(0, decimals)}`;
}

export interface NumberInputProps
  extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'value' | 'onChange' | 'type'> {
  /**
   * The amount as the maker typed it, not a number. Keeping it a string is what makes this control
   * bigint-safe: `parseDecimalInput(value, decimals)` is the only conversion, and it happens once,
   * at submit time. A `number` here would round 18-decimal values before they reached the chain.
   */
  value: string;
  onValueChange: (next: string) => void;
  /** Token decimals. Fraction digits past this are truncated as they are typed. */
  decimals: number;
  /** Rendered inside the border after the amount, in `--ink-3`. */
  symbol?: string;
  /** Enables the Half and Max shortcuts, and is the value they write. */
  balance?: bigint;
  size?: ControlSize;
  invalid?: boolean;
}

/**
 * The amount control. Right-aligned mono with tabular figures so a column of amounts lines up,
 * `type="text"` so the browser never renders spinners or applies its own locale parsing, and
 * `inputMode="decimal"` so a phone keyboard still opens on the digits.
 */
export function NumberInput({
  value,
  onValueChange,
  decimals,
  symbol,
  balance,
  size = 'md',
  invalid,
  disabled,
  className,
  id,
  required,
  ref,
  ...props
}: NumberInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const aria = useFieldControl({
    id,
    'aria-describedby': props['aria-describedby'],
    'aria-invalid': invalid,
    required,
  });

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = sanitizeDecimalInput(event.target.value, decimals);
    if (next === null) return; // rejected: the field keeps its previous value
    onValueChange(next);
  }

  function write(amount: bigint) {
    onValueChange(toDecimalString(amount, decimals));
    innerRef.current?.focus();
  }

  const shortcuts = balance !== undefined;

  return (
    <ControlShell
      size={size}
      invalid={aria.invalid}
      disabled={disabled}
      onShellPointerDown={(event) => {
        if (event.target === event.currentTarget) innerRef.current?.focus();
      }}
    >
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
        value={value}
        onChange={handleChange}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={props.placeholder ?? '0'}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-right font-mono tnum text-ink outline-none',
          'disabled:cursor-not-allowed disabled:text-ink-3',
          className,
        )}
      />
      {symbol ? (
        <span className="shrink-0 font-mono text-ink-3" aria-hidden="true">
          {symbol}
        </span>
      ) : null}
      {shortcuts ? (
        <span className="flex shrink-0 items-center gap-1">
          <ShortcutButton
            onClick={() => write(balance / TWO)}
            disabled={disabled}
            label={`Fill half the available balance${symbol ? `, in ${symbol}` : ''}`}
          >
            HALF
          </ShortcutButton>
          <ShortcutButton
            onClick={() => write(balance)}
            disabled={disabled}
            label={`Fill the entire available balance${symbol ? `, in ${symbol}` : ''}`}
          >
            MAX
          </ShortcutButton>
        </span>
      ) : null}
    </ControlShell>
  );
}

function ShortcutButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'h-6 rounded-control px-1.5 text-micro text-ink-2 transition-state',
        'hover:bg-surface hover:text-ink',
        'disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}
