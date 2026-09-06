'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { useId, type ComponentPropsWithRef, type MouseEvent } from 'react';
import { cn } from '@/lib/ui';
import { ICON_STROKE, type IconComponent } from './icon';
import { Spinner } from './Spinner';

/**
 * Shared button geometry and colour, also used by IconButton.
 *
 * `state` is deliberately part of the variant matrix rather than a set of `disabled:` utilities:
 * an inert button must lose its hover and active treatment entirely, and a soft-disabled button
 * (`aria-disabled`, still focusable) never matches `:disabled` in the first place. Resolving it in
 * TypeScript keeps both paths identical.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center gap-2',
    'rounded-control border font-medium whitespace-nowrap',
    'transition-state',
  ],
  {
    variants: {
      variant: { primary: '', secondary: '', ghost: '', danger: '' },
      size: { sm: 'h-8 px-3 text-meta', md: 'h-10 px-4 text-body' },
      shape: { text: '', square: 'px-0' },
      state: { idle: 'cursor-pointer', inert: '' },
    },
    compoundVariants: [
      // --- idle ------------------------------------------------------------
      {
        variant: 'primary',
        state: 'idle',
        class:
          'border-transparent bg-accent text-accent-ink hover:bg-[color-mix(in_oklch,var(--accent),var(--ink)_16%)] active:bg-[color-mix(in_oklch,var(--accent),var(--bg)_12%)]',
      },
      {
        variant: 'secondary',
        state: 'idle',
        class:
          'border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-[color-mix(in_oklch,var(--surface-2),var(--ink)_6%)] active:bg-surface',
      },
      {
        variant: 'ghost',
        state: 'idle',
        class: 'border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-surface',
      },
      {
        variant: 'danger',
        state: 'idle',
        class: 'border-neg/40 text-neg hover:border-neg/60 hover:bg-neg/12 active:bg-neg/20',
      },
      // --- inert: one flat treatment, legible at 4.76:1, no hover ----------
      { variant: 'primary', state: 'inert', class: 'border-line bg-surface-2 text-ink-3' },
      { variant: 'secondary', state: 'inert', class: 'border-line bg-surface-2 text-ink-3' },
      { variant: 'ghost', state: 'inert', class: 'border-transparent text-ink-3' },
      { variant: 'danger', state: 'inert', class: 'border-line bg-surface-2 text-ink-3' },
      // --- square (icon-only) ----------------------------------------------
      { shape: 'square', size: 'sm', class: 'w-8' },
      { shape: 'square', size: 'md', class: 'w-10' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', shape: 'text', state: 'idle' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'disabled'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, rendered at 16px with a 1.5 stroke. */
  icon?: IconComponent;
  /** Trailing icon: a chevron on a menu trigger, an arrow on a link-like action. */
  iconTrailing?: IconComponent;
  /** Waiting on a signature or a receipt. The label stays in place; the spinner sits over it. */
  loading?: boolean;
  /** What a screen reader hears while `loading`. Defaults to the button's own label. */
  loadingLabel?: string;
  disabled?: boolean;
  /**
   * Why the button cannot be used, in one sentence: "Connect a wallet to ship this strategy."
   *
   * Supplying it switches the button from `disabled` to `aria-disabled`, which keeps it focusable
   * and hoverable so the reason can actually be read — DESIGN.md's "a button that is disabled says
   * why". Clicks are blocked in the handler instead of by the browser.
   */
  disabledReason?: string;
}

/**
 * The app's button. Verb + object labels ("Ship position"), never "Submit".
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconTrailing: IconTrailing,
  loading = false,
  loadingLabel,
  disabled = false,
  disabledReason,
  className,
  children,
  onClick,
  type = 'button',
  ...props
}: ButtonProps) {
  const reasonId = useId();
  const inert = disabled || loading;
  // Loading always stays focusable: pulling focus out from under a maker mid-transaction is worse
  // than a focusable button that ignores clicks.
  const soft = loading || (disabled && Boolean(disabledReason));

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (inert) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  return (
    <>
      <button
        {...props}
        type={type}
        onClick={handleClick}
        disabled={inert && !soft}
        aria-disabled={inert || undefined}
        aria-busy={loading || undefined}
        aria-describedby={disabledReason && inert ? reasonId : props['aria-describedby']}
        title={disabledReason && inert ? disabledReason : props.title}
        className={cn(
          buttonVariants({ variant, size, state: inert ? 'inert' : 'idle' }),
          className,
        )}
      >
        {/* opacity, not visibility: the label must stay in the accessibility tree and keep the
            button exactly as wide while the spinner is up. */}
        <span
          className={cn(
            'inline-flex items-center gap-2 transition-state',
            loading && 'opacity-0',
          )}
        >
          {Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" /> : null}
          {children}
          {IconTrailing ? <IconTrailing size={16} strokeWidth={ICON_STROKE} aria-hidden="true" /> : null}
        </span>
        {loading ? (
          <span className="absolute inset-0 grid place-items-center">
            <Spinner />
            <span className="sr-only">{loadingLabel ?? 'Working'}</span>
          </span>
        ) : null}
      </button>
      {disabledReason && inert ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
