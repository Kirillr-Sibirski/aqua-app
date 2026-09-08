'use client';

import {
  cn,
  formatTokenAmount,
  formatUsd,
  toDecimalString,
  type SignDisplay,
} from '@/lib/ui';

export interface TokenAmountProps {
  /** The raw chain value. Never a `number`: an 18-decimal balance does not survive one. */
  value: bigint;
  decimals: number;
  symbol?: string;
  /** Optional USD figure, already priced by the caller from a chain read. */
  usd?: { value: bigint; decimals: number };
  /** `inline` puts USD in brackets after the amount; `stacked` puts it on a second line. */
  usdPlacement?: 'inline' | 'stacked';
  sign?: SignDisplay;
  /** `K`/`M`/`B` notation above 1,000. Off by default — a terminal wants the real number. */
  compact?: boolean;
  /** Significant digits kept from the first non-zero digit. Default 6. */
  significantDigits?: number;
  /** `md` (14px) in prose, `sm` (13px) in a table cell, `lg` (16px) for a figure. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * A token amount with its symbol, and optionally what it is worth.
 *
 * The exact value is on `title`, because the visible figure is rounded to a readable number of
 * significant digits and a maker reconciling against a receipt needs the digits the chain returned.
 * A non-zero balance too small to render never collapses to `0` — `formatUnits` emits a `<` bound
 * instead, so the screen never claims an amount is gone when it is not.
 */
export function TokenAmount({
  value,
  decimals,
  symbol,
  usd,
  usdPlacement = 'stacked',
  sign = 'auto',
  compact = false,
  significantDigits = 6,
  size = 'md',
  className,
}: TokenAmountProps) {
  const amount = formatTokenAmount(value, decimals, { sign, compact, significantDigits });
  const exact = `${toDecimalString(value, decimals)}${symbol ? ` ${symbol}` : ''}`;
  const type = size === 'sm' ? 'text-meta' : size === 'lg' ? 'text-lead' : 'text-body';
  const usdText = usd ? formatUsd(usd.value, usd.decimals, { compact }) : undefined;

  const figure = (
    <span className={cn('font-mono tnum leading-num text-ink', type)} title={exact}>
      {amount}
      {symbol ? <span className="ml-1 text-ink-3">{symbol}</span> : null}
    </span>
  );

  if (!usdText) return <span className={className}>{figure}</span>;

  if (usdPlacement === 'inline') {
    return (
      <span className={cn('inline-flex items-baseline gap-1.5', className)}>
        {figure}
        <span className="font-mono text-mini tnum text-ink-3">({usdText})</span>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex flex-col items-end leading-num', className)}>
      {figure}
      <span className="font-mono text-mini tnum text-ink-3">{usdText}</span>
    </span>
  );
}
