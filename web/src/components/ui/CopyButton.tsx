'use client';

import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/ui';
import { ICON_STROKE } from './icon';
import type { ButtonSize, ButtonVariant } from './Button';
import { buttonVariants } from './Button';

export interface CopyButtonProps {
  /** The full, untruncated value. What is on screen may be elided; what is copied never is. */
  value: string;
  /** Names the thing in the accessible label: "Copy strategy hash". Default "value". */
  what?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  /** 24px, for sitting inline beside a mono value in a table cell. */
  compact?: boolean;
  className?: string;
}

/**
 * Copy one value to the clipboard, with the result announced rather than only drawn.
 *
 * The check mark is a colour change, so on its own it would fail DESIGN.md's rule against colour as
 * the only signal. The accessible name flips to "Copied …" and a polite live region carries the
 * same word, which is what a screen reader and a colour-blind maker actually get.
 */
export function CopyButton({
  value,
  what = 'value',
  size = 'sm',
  variant = 'ghost',
  compact = false,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(() => {
    const settle = (ok: boolean) => {
      setCopied(ok);
      setFailed(!ok);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
        setFailed(false);
      }, 1600);
    };

    if (!navigator.clipboard) {
      settle(false);
      return;
    }
    void navigator.clipboard.writeText(value).then(
      () => settle(true),
      () => settle(false),
    );
  }, [value]);

  const label = failed ? `Could not copy ${what}` : copied ? `Copied ${what}` : `Copy ${what}`;

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={label}
        className={cn(
          compact
            ? cn(
                'inline-flex size-6 shrink-0 items-center justify-center rounded-control',
                'text-ink-3 transition-state hover:bg-surface-2 hover:text-ink',
              )
            : buttonVariants({ variant, size, shape: 'square' }),
          copied && 'text-pos hover:text-pos',
          failed && 'text-neg hover:text-neg',
          className,
        )}
      >
        {copied ? (
          <Check size={compact ? 14 : 16} strokeWidth={ICON_STROKE} aria-hidden="true" />
        ) : (
          <Copy size={compact ? 14 : 16} strokeWidth={ICON_STROKE} aria-hidden="true" />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `Copied ${what}` : failed ? `Could not copy ${what}` : ''}
      </span>
    </>
  );
}
