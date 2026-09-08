'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { cn, formatPercent, formatTokenAmount, toDecimalString } from '@/lib/ui';
import { ICON_STROKE } from './icon';

const ZERO = BigInt(0);

export interface DeltaProps {
  /** A change in token units. Mutually exclusive with `percent`. */
  value?: bigint;
  decimals?: number;
  symbol?: string;
  /** A change as a ratio: `0.0512` renders `+5.12%`. Mutually exclusive with `value`. */
  percent?: number;
  /**
   * Which direction is good. Default `up`. Set `down` for a figure where falling is the win — gas
   * spent, slippage, a coverage shortfall.
   */
  goodDirection?: 'up' | 'down';
  /** Colour the figure at all. Off for a neutral change that carries no judgement. */
  tone?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A signed change: arrow, explicit sign, then the figure.
 *
 * Three redundant signals, on purpose. DESIGN.md forbids colour as the only carrier of meaning, and
 * a red-vs-green delta is exactly the case that breaks for the ~8% of men with a red/green
 * deficiency — so the arrow glyph and the `+`/`-` character both stay, and the colour is the third
 * cue rather than the first. A change of exactly zero gets a horizontal bar and no colour at all.
 */
export function Delta({
  value,
  decimals = 18,
  symbol,
  percent,
  goodDirection = 'up',
  tone = true,
  size = 'md',
  className,
}: DeltaProps) {
  const direction =
    value !== undefined
      ? value > ZERO
        ? 1
        : value < ZERO
          ? -1
          : 0
      : percent !== undefined && Number.isFinite(percent)
        ? Math.sign(percent)
        : 0;

  const good = goodDirection === 'up' ? direction > 0 : direction < 0;
  const bad = direction !== 0 && !good;

  const Icon = direction > 0 ? ArrowUp : direction < 0 ? ArrowDown : Minus;

  const text =
    value !== undefined
      ? formatTokenAmount(value, decimals, { sign: 'always', symbol, significantDigits: 5 })
      : percent !== undefined
        ? formatPercent(percent, { sign: 'always' })
        : '—';

  const exact = value !== undefined ? toDecimalString(value, decimals) : undefined;

  return (
    <span
      title={exact}
      className={cn(
        'inline-flex items-center gap-1 font-mono tnum leading-num',
        size === 'sm' ? 'text-mini' : 'text-meta',
        tone && good && 'text-pos',
        tone && bad && 'text-neg',
        (!tone || direction === 0) && 'text-ink-2',
        className,
      )}
    >
      <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0" />
      <span className="sr-only">{direction > 0 ? 'up ' : direction < 0 ? 'down ' : 'unchanged '}</span>
      {text}
    </span>
  );
}
