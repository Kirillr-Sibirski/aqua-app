'use client';

import { useId, type ComponentPropsWithRef, type MouseEvent } from 'react';
import { cn } from '@/lib/ui';
import { buttonVariants, type ButtonSize, type ButtonVariant } from './Button';
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon';
import { Spinner } from './Spinner';

export interface IconButtonProps
  extends Omit<ComponentPropsWithRef<'button'>, 'disabled' | 'children' | 'aria-label'> {
  /** The icon component itself, so size and stroke stay on-system. */
  icon: IconComponent;
  /**
   * The accessible name, required by the type — an icon-only button without one is unusable with a
   * screen reader, so this is not left to a lint rule. Verb + object: "Copy strategy hash".
   */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Replaces `label` in the native tooltip while the button is inert. */
  disabledReason?: string;
}

/**
 * A square button carrying one icon and no text. `label` doubles as the `title`, so the meaning is
 * available to a mouse user hovering as well as to assistive technology.
 */
export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  disabled = false,
  disabledReason,
  className,
  onClick,
  type = 'button',
  ...props
}: IconButtonProps) {
  const reasonId = useId();
  const inert = disabled || loading;
  const soft = loading || (disabled && Boolean(disabledReason));
  const iconPx = size === 'sm' ? ICON_SIZE.sm : ICON_SIZE.md;

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
        aria-label={label}
        aria-describedby={disabledReason && inert ? reasonId : props['aria-describedby']}
        title={inert && disabledReason ? disabledReason : label}
        className={cn(
          buttonVariants({ variant, size, shape: 'square', state: inert ? 'inert' : 'idle' }),
          className,
        )}
      >
        {loading ? (
          <Spinner size={iconPx === ICON_SIZE.sm ? 16 : 20} />
        ) : (
          <Icon size={iconPx} strokeWidth={ICON_STROKE} aria-hidden="true" />
        )}
      </button>
      {disabledReason && inert ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
