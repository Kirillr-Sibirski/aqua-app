'use client';

/**
 * Step one: the terms every leg in the book shares.
 *
 * The pair, the expiry and the implied vol. Strike is per leg and lives in the next section; these
 * three are the book's, because a ladder written at four different vols is four books.
 *
 * The vol field is the one with an opinion. It tracks the asset's trailing realised vol — read
 * either from the feed's own rounds or, when the feed keeps none, from the price at past blocks —
 * and turns warning when the maker types a number below it. Selling vol under realised is a
 * legitimate position and the field does not block it, but it should be a decision, and the screen
 * says which side of realised the book is on. It also says which of the three the number on screen
 * is: the measurement, the maker's, or the value the form opened at.
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
  /**
   * Where the number in the field came from. `unmeasured` is the honest name for the value the
   * field opens at before anything has been read, and the screen says so rather than letting a
   * plausible figure pass for a measurement.
   */
  ivSource?: 'realised' | 'maker' | 'unmeasured';
  /**
   * Hand the field back to realised. Distinct from typing the realised number: the field goes on
   * tracking the estimate as the feed moves, which is what `ivSource: 'realised'` means.
   */
  onUseRealised?: () => void;

  realised?: RealisedVol;
  realisedUnavailable?: string;
  realisedLoading?: boolean;

  spot?: number;
  spotSymbol?: string;
  className?: string;
}

/**
 * Within this much of realised, in ratio terms, the book is charging realised and not a spread.
 *
 * Also the tolerance the "below realised" warning uses, so the three states are disjoint against one
 * threshold: below, at, above. 0.0005 is half of the last digit the field and the message both show,
 * which is what stops the app defaulting the field from realised and then warning that the number it
 * just wrote is below realised.
 */
const AT_REALISED = 0.0005;

/**
 * The largest vol this can be shipped with, as a percent.
 *
 * `sigmaWad` is a `uint64`, so anything above ~1844% fails to encode -- and it fails late, inside
 * `uintN(a.sigmaWad, 8)`, surfacing as "the router could not size these legs" with an encoder
 * message rather than as a bad value in the field that produced it. 1000% is well inside the
 * encodable range and already far outside anything a maker would write.
 */
export const IV_MAX_PERCENT = 1000;

/** The maker's vol, as a ratio. `undefined` while the field is empty, mid-edit, or unshippable. */
export function ivRatio(iv: string): number | undefined {
  const value = Number(iv);
  if (!Number.isFinite(value) || value <= 0 || value > IV_MAX_PERCENT) return undefined;
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
  ivSource = 'maker',
  onUseRealised,
  realised,
  realisedUnavailable,
  realisedLoading = false,
  spot,
  spotSymbol,
  className,
}: TermsProps) {
  const chosen = ivRatio(iv);
  // Out of the encodable range, so `ivRatio` refused it. Named here rather than left to fail inside
  // the SwapVM encoder, where it arrives as a byte-width error about a field the maker never saw.
  const typed = Number(iv);
  const outOfRange = iv.trim() !== '' && Number.isFinite(typed) && typed > IV_MAX_PERCENT;
  // Compared at the precision the message itself prints, and never against a value the app supplied.
  // `realised.sigma` is full precision while the field holds at most two decimals of a percent, so a
  // raw `<` fired on numbers that are equal as far as anyone can see -- including the app's own
  // default, which rounded realised into the field and then failed its own check against the
  // unrounded value: "Below trailing realised (33.9%)" in the negative colour under a field reading
  // 33.9, on the first frame of the write flow, with nothing typed.
  const under =
    ivSource !== 'realised' &&
    chosen !== undefined &&
    realised !== undefined &&
    chosen < realised.sigma - AT_REALISED;

  const hint = useMemo(() => {
    if (realisedLoading) return 'Reading the feed history…';
    if (realised) {
      const where =
        realised.source === 'rounds'
          ? `${realised.moves} price changes in the feed's own rounds`
          : `${realised.moves} price changes across ${realised.observations} readings taken at past blocks`;
      return `Trailing realised is ${formatPercent(realised.sigma, { fractionDigits: 1 })}, from ${where} over ${formatDuration(realised.spanSeconds)}.`;
    }
    const why = realisedUnavailable ?? 'No realised vol to compare against.';
    return ivSource === 'unmeasured'
      ? `${why} The number in the field is a starting point, not a measurement.`
      : why;
  }, [realised, realisedLoading, realisedUnavailable, ivSource]);

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
          outOfRange
            ? `Above ${IV_MAX_PERCENT}%, which is past what a leg can carry: the curve stores sigma in 64 bits.`
            : under
              ? `Below trailing realised (${formatPercent(realised.sigma, { fractionDigits: 1 })}). The book would be selling vol into a market moving faster than that.`
              : undefined
        }
        aside={
          !realised ? null : ivSource === 'realised' ? (
            <Pill tone="neutral" size="sm">
              defaulted from realised
            </Pill>
          ) : (
            <button
              type="button"
              onClick={() =>
                onUseRealised ? onUseRealised() : onIvChange((realised.sigma * 100).toFixed(1))
              }
              className="rounded-control text-accent transition-state hover:underline"
            >
              Use realised
            </button>
          )
        }
      >
        <NumberInput
          value={iv}
          onValueChange={onIvChange}
          decimals={2}
          symbol="%"
          invalid={under || outOfRange}
          aria-label="Implied volatility in percent"
        />
      </Field>

      {realised && chosen !== undefined && !under ? (
        chosen - realised.sigma > AT_REALISED ? (
          <p className="text-mini leading-prose text-ink-3">
            <Pill tone="positive" size="sm">
              {formatPercent(chosen - realised.sigma, { fractionDigits: 1, sign: 'always' })} over
              realised
            </Pill>{' '}
            <span className="ml-1.5">
              The spread between what the book charges and what the asset has been doing. It is the
              reason the position is expected to pay, and it is not a guarantee.
            </span>
          </p>
        ) : (
          <p className="text-mini leading-prose text-ink-3">
            <Pill tone="neutral" size="sm">
              at realised
            </Pill>{' '}
            <span className="ml-1.5">
              The book would charge exactly what the asset has been doing, which is the break-even
              assumption rather than an edge. Whether that is enough depends on the move you expect
              next, which is the one thing no history measures.
            </span>
          </p>
        )
      ) : null}

      {!realised && !realisedLoading ? (
        <Callout tone="info" title="No realised vol to default from">
          {realisedUnavailable} The field opens at {iv}% so the form has somewhere to start, and that
          figure is the one thing on this screen that was not read from the chain. Set it against
          your own view of the asset, not against the number that is sitting there.
        </Callout>
      ) : null}
    </div>
  );
}
