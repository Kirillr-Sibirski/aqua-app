'use client';

/**
 * Step one: the terms every leg in the book shares.
 *
 * The pair, the expiry and the implied vol. Strike is per leg and lives in the next section; these
 * three are the book's, because a ladder written at four different vols is four books.
 *
 * The vol field is the one with an opinion. It defaults to the asset's trailing realised vol, read
 * from the price feed's own round history, and turns warning when the maker types a number below
 * it. Selling vol under realised is a legitimate position and the field does not block it — but it
 * should be a decision, and the screen says which side of realised the book is on.
 */
import { useMemo } from 'react';
import { Callout, Field, NumberInput, Pill, SegmentedControl, Skeleton } from '@/components/ui';
import { formatDuration } from '@/components/curve';
import { formatChartNumber } from '@/components/charts/format';
import { cn, formatPercent } from '@/lib/ui';
import { EXPIRY_PRESETS, formatExpiry } from './expiry';
import type { RealisedVol } from './useRealisedVol';
import type { WritePair } from './types';

export interface TermsProps {
  pairs: readonly { key: string; label: string; pair: WritePair }[];
  pairKey: string;
  onPairChange: (key: string) => void;

  expiryDays: number;
  onExpiryChange: (days: number) => void;
  /** Resolved maturity, from the chain's clock. Undefined until the block arrives. */
  maturity?: number;

  /** Implied vol as the maker typed it, in percent. */
  iv: string;
  onIvChange: (next: string) => void;

  realised?: RealisedVol;
  realisedUnavailable?: string;
  realisedLoading?: boolean;

  spot?: number;
  spotSymbol?: string;
  className?: string;
}

/** The maker's vol, as a ratio. `undefined` while the field is empty or mid-edit. */
export function ivRatio(iv: string): number | undefined {
  const value = Number(iv);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value / 100;
}

export function Terms({
  pairs,
  pairKey,
  onPairChange,
  expiryDays,
  onExpiryChange,
  maturity,
  iv,
  onIvChange,
  realised,
  realisedUnavailable,
  realisedLoading = false,
  spot,
  spotSymbol,
  className,
}: TermsProps) {
  const chosen = ivRatio(iv);
  const under = chosen !== undefined && realised !== undefined && chosen < realised.sigma;

  const hint = useMemo(() => {
    if (realisedLoading) return 'Reading the feed history…';
    if (realised) {
      return `Trailing realised is ${formatPercent(realised.sigma, { fractionDigits: 1 })}, from ${realised.returns} price updates over ${formatDuration(realised.spanSeconds)}.`;
    }
    return realisedUnavailable ?? 'No realised vol to compare against.';
  }, [realised, realisedLoading, realisedUnavailable]);

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <Field
        label="Pair"
        hint="One risky asset against one stable. The risky side is what the calls are written on."
      >
        <SegmentedControl
          label="Pair"
          items={pairs.map((p) => ({ value: p.key, label: p.label }))}
          value={pairKey}
          onValueChange={onPairChange}
        />
      </Field>

      <Field
        label="Expiry"
        hint={
          maturity
            ? `${formatExpiry(maturity)}. The assignment window closes 30 minutes later.`
            : 'Read from the block clock, not the browser clock.'
        }
        aside={
          spot !== undefined ? (
            <span className="font-mono tnum">
              spot {formatChartNumber(spot, { significantDigits: 10, maxFractionDigits: 2 })}
              {spotSymbol ? <span className="ml-1 text-ink-3">{spotSymbol}</span> : null}
            </span>
          ) : (
            <Skeleton className="h-3.5 w-24" />
          )
        }
      >
        <SegmentedControl
          label="Expiry"
          items={EXPIRY_PRESETS.map((p) => ({ value: String(p.days), label: p.label }))}
          value={String(expiryDays)}
          onValueChange={(next) => onExpiryChange(Number(next))}
        />
      </Field>

      <Field
        label="Implied volatility"
        hint={hint}
        error={
          under
            ? `Below trailing realised (${formatPercent(realised.sigma, { fractionDigits: 1 })}). The book would be selling vol into a market moving faster than that.`
            : undefined
        }
        aside={
          realised ? (
            <button
              type="button"
              onClick={() => onIvChange((realised.sigma * 100).toFixed(1))}
              className="rounded-control text-accent transition-state hover:underline"
            >
              Use realised
            </button>
          ) : null
        }
      >
        <NumberInput
          value={iv}
          onValueChange={onIvChange}
          decimals={2}
          symbol="%"
          invalid={under}
          aria-label="Implied volatility in percent"
        />
      </Field>

      {realised && chosen !== undefined && !under ? (
        <p className="text-mini leading-prose text-ink-3">
          <Pill tone="positive" size="sm">
            {formatPercent(chosen - realised.sigma, { fractionDigits: 1, sign: 'always' })} over realised
          </Pill>{' '}
          <span className="ml-1.5">
            The spread between what the book charges and what the asset has been doing. It is the reason
            the position is expected to pay, and it is not a guarantee.
          </span>
        </p>
      ) : null}

      {!realised && !realisedLoading ? (
        <Callout tone="info" title="No realised vol to default from">
          {realisedUnavailable} The field is yours to set; nothing is filled in for you, because a
          plausible-looking default that came from nowhere is worse than an empty box.
        </Callout>
      ) : null}
    </div>
  );
}
