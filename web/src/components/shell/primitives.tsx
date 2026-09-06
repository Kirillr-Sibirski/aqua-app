'use client';

/**
 * Shell-local primitives.
 *
 * These are the minimum the shell and the wallet flow need — a button, a status pill, a skeleton,
 * a callout, an empty state, a copy button and an address. They exist because the shared primitive
 * set at `@/components/ui/*` is being built in parallel and had not landed when this shell was
 * written. They are deliberately named `Shell*` so the reconciliation is mechanical: when
 * `@/components/ui` ships, re-export its Button/Pill/Skeleton/Callout/CopyButton/Address from this
 * file and delete the bodies. Nothing outside this file hard-codes a variant class.
 *
 * Every colour is a token class; the only literals are `color-mix()` expressions that derive a
 * hover/press step from an existing token, so the palette stays auditable from `globals.css`.
 */
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { cn, truncateAddress, truncateHash } from '@/lib/ui';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ShellButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ShellButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium ' +
  'whitespace-nowrap transition-state select-none ' +
  'disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45';

const BUTTON_VARIANT: Record<ShellButtonVariant, string> = {
  // The one filled surface in the app. Hover/press steps are mixed from the accent itself.
  primary:
    'bg-accent text-accent-ink ' +
    'hover:bg-[color-mix(in_oklch,var(--accent)_86%,var(--ink))] ' +
    'active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--bg))]',
  secondary: 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'border border-line bg-surface text-neg hover:border-neg/40 hover:bg-neg/10',
};

const BUTTON_SIZE: Record<ShellButtonSize, string> = {
  sm: 'h-8 px-3 text-meta',
  md: 'h-9 px-4 text-body',
};

export interface ShellButtonProps extends ComponentProps<'button'> {
  variant?: ShellButtonVariant;
  size?: ShellButtonSize;
  /** Marks the control busy: disables it and announces the state. Swap the label yourself. */
  busy?: boolean;
}

export function ShellButton({
  variant = 'secondary',
  size = 'md',
  busy = false,
  className,
  disabled,
  type = 'button',
  ...props
}: ShellButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...props}
    />
  );
}

/** Square button for an icon alone. `label` is mandatory — it becomes the accessible name. */
export interface ShellIconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label'> {
  label: string;
  variant?: ShellButtonVariant;
}

export function ShellIconButton({
  label,
  variant = 'ghost',
  className,
  type = 'button',
  ...props
}: ShellIconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], 'size-8 p-0', className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Pill
// ---------------------------------------------------------------------------

export type ShellPillTone = 'neutral' | 'accent' | 'pos' | 'neg' | 'warn';

const PILL_TONE: Record<ShellPillTone, string> = {
  neutral: 'border-line text-ink-2',
  accent: 'border-accent-dim text-accent',
  pos: 'border-pos/35 text-pos',
  neg: 'border-neg/35 text-neg',
  warn: 'border-warn/35 text-warn',
};

export interface ShellPillProps extends ComponentProps<'span'> {
  tone?: ShellPillTone;
}

/** Status pill: 999px radius, 11px uppercase label, four words at most. */
export function ShellPill({ tone = 'neutral', className, ...props }: ShellPillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-pill border bg-surface px-2 text-micro uppercase',
        PILL_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * Loading placeholder. `globals.css` collapses every animation to 1ms under
 * `prefers-reduced-motion: reduce`, so this settles into a flat block instead of pulsing.
 */
export function ShellSkeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-control bg-surface-2', className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

export type ShellCalloutTone = 'info' | 'warn' | 'error';

const CALLOUT_TONE: Record<ShellCalloutTone, { wrap: string; icon: string }> = {
  info: { wrap: 'border-line bg-surface', icon: 'text-accent' },
  warn: { wrap: 'border-warn/30 bg-warn/8', icon: 'text-warn' },
  error: { wrap: 'border-neg/30 bg-neg/8', icon: 'text-neg' },
};

export interface ShellCalloutProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: ShellCalloutTone;
  icon?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
}

export function ShellCallout({
  tone = 'info',
  icon,
  title,
  action,
  className,
  children,
  ...props
}: ShellCalloutProps) {
  const t = CALLOUT_TONE[tone];
  return (
    <div className={cn('rounded-card border px-4 py-3', t.wrap, className)} {...props}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {icon ? <span className={cn('mt-0.5 shrink-0', t.icon)}>{icon}</span> : null}
        <div className="min-w-56 flex-1 leading-prose">
          {title ? <p className="font-medium text-ink">{title}</p> : null}
          {children ? <div className="text-meta text-ink-2">{children}</div> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export interface ShellEmptyStateProps {
  title: ReactNode;
  /** One or two sentences saying what is missing and why. */
  description?: ReactNode;
  /** The single action that resolves the state. */
  action?: ReactNode;
  /** Small print under the action — a constraint, a prerequisite, a reason. */
  note?: ReactNode;
  className?: string;
}

/**
 * Left-aligned on purpose: a centred block in a terminal reads as a marketing panel, and the eye
 * has to travel back to the left rule for the next screen anyway.
 */
export function ShellEmptyState({
  title,
  description,
  action,
  note,
  className,
}: ShellEmptyStateProps) {
  return (
    <div className={cn('rounded-card border border-line bg-surface px-6 py-10', className)}>
      <div className="max-w-prose">
        <h2 className="text-lead text-ink">{title}</h2>
        {description ? <p className="mt-2 text-body leading-prose text-ink-2">{description}</p> : null}
        {action ? <div className="mt-6 flex flex-wrap items-center gap-3">{action}</div> : null}
        {note ? <p className="mt-3 text-mini leading-prose text-ink-3">{note}</p> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

export interface ShellCopyButtonProps {
  value: string;
  /** Names the thing being copied: 'address', 'strategy hash'. Used in the accessible name. */
  what?: string;
  className?: string;
}

export function ShellCopyButton({ value, what = 'value', className }: ShellCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => setCopied(false));
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `Copied ${what}` : `Copy ${what}`}
      title={copied ? 'Copied' : `Copy ${what}`}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-control text-ink-3 transition-state hover:bg-surface-2 hover:text-ink-2',
        copied && 'text-pos hover:text-pos',
        className,
      )}
    >
      {copied ? (
        <Check size={14} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Explorer link
// ---------------------------------------------------------------------------

export interface ShellExplorerLinkProps {
  href: string;
  /** Reads on its own out of context: 'WETH on Basescan', not 'here'. */
  children: ReactNode;
  className?: string;
}

export function ShellExplorerLink({ href, children, className }: ShellExplorerLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        'inline-flex items-center gap-1 rounded-control text-accent transition-state hover:underline hover:underline-offset-2',
        className,
      )}
    >
      {children}
      <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Address / hash
// ---------------------------------------------------------------------------

export interface ShellAddressProps {
  value: string;
  /** Hashes get a wider truncation than addresses, because a hash is read as an identity. */
  kind?: 'address' | 'hash';
  /** Explorer URL. Omit for fork-local state that exists on no explorer. */
  href?: string;
  copy?: boolean;
  className?: string;
}

/**
 * Mono, tabular, middle-ellipsised. The full value is on the element's `title` and on the
 * clipboard, so nothing a maker needs to compare is lost to the ellipsis.
 */
export function ShellAddress({ value, kind = 'address', href, copy = true, className }: ShellAddressProps) {
  const short = kind === 'hash' ? truncateHash(value) : truncateAddress(value);
  const label = kind === 'hash' ? 'hash' : 'address';
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={value}
          className="rounded-control font-mono text-meta tnum text-ink-2 transition-state hover:text-accent hover:underline hover:underline-offset-2"
        >
          {short}
        </a>
      ) : (
        <span title={value} className="font-mono text-meta tnum text-ink-2">
          {short}
        </span>
      )}
      {copy ? <ShellCopyButton value={value} what={label} /> : null}
    </span>
  );
}
