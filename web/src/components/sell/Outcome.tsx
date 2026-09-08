'use client';

/**
 * The two lines a newcomer needs, and the one they would otherwise learn the hard way.
 *
 * Both numbers are chain reads. `useOffer` asks `StrikelineViews.stableFor` twice in one multicall:
 * once at the offer's own date, which is the reserve that ships, and once with the date set to zero,
 * which puts the curve in its settlement branch where it is `K*(L - x)` in closed form. The gap
 * between them is what a taker has to pay on top of the price to be assigned the whole amount, and
 * dividing it by the amount gives the price the sale actually works out at. Nothing here is
 * modelled; there is no option maths in this file, or anywhere else in the app.
 *
 * The third line is the disclosed risk the README calls the largest in the design: the payment
 * accrues inside the quote and is only realised when somebody crosses it. An offer nobody takes
 * earns nothing, and the card says so before the button rather than after the transaction.
 */
import { Skeleton } from '@mantine/core';
import { formatUnits } from '@/lib/ui';
import classes from './sell.module.css';
import type { SizedOffer } from './types';

export interface OutcomeProps {
  offer?: SizedOffer;
  /** Symbols for the two sides, from the deployment manifest. */
  riskySymbol: string;
  stableSymbol: string;
  riskyDecimals: number;
  /** The price named, WAD, so the note can restate it. */
  strikeWad?: bigint;
  loading?: boolean;
  /**
   * True when the amount typed is more than the wallet holds, so what is quoted below is the
   * largest offer that could actually be published rather than the number in the field.
   *
   * This used to price the typed amount, which meant an over-balance entry printed a green
   * five-figure payout for a trade the button was refusing in the same frame. No number on this
   * card is allowed to describe something that cannot happen.
   */
  clamped?: boolean;
}

export function Outcome({
  offer,
  riskySymbol,
  stableSymbol,
  riskyDecimals,
  strikeWad,
  loading,
  clamped,
}: OutcomeProps) {
  if (!offer || strikeWad === undefined) {
    return (
      <div className={classes.outcome}>
        <div className={classes.outcomeRow}>
          <span className={classes.outcomeLabel}>If it is taken in full</span>
          {loading ? <Skeleton height={14} width={112} radius="sm" /> : <span className={classes.outcomeValue}>—</span>}
        </div>
        <div className={classes.outcomeRow}>
          <span className={classes.outcomeLabel}>What you give up</span>
          {loading ? <Skeleton height={14} width={148} radius="sm" /> : <span className={classes.outcomeValue}>—</span>}
        </div>
      </div>
    );
  }

  const amount = formatUnits(offer.xWad, 18, { significantDigits: 12, maxFractionDigits: riskyDecimals });
  const earned = formatUnits(offer.earnedWad, 18, { significantDigits: 12, maxFractionDigits: 2, minFractionDigits: 2 });
  const each = formatUnits(offer.effectivePriceWad, 18, { significantDigits: 12, maxFractionDigits: 2, minFractionDigits: 2 });
  const named = formatUnits(strikeWad, 18, { significantDigits: 12, maxFractionDigits: 2, minFractionDigits: 2 });
  // The price alone, plus what the wait paid: the two add up to what the taker hands over, and
  // showing both is what makes the earned figure checkable rather than asserted.
  const total = formatUnits((strikeWad * offer.xWad) / WAD + offer.earnedWad, 18, {
    significantDigits: 14,
    maxFractionDigits: 2,
    minFractionDigits: 2,
  });

  return (
    <div className={classes.outcome} data-clamped={clamped || undefined}>
      {clamped ? (
        <p className={classes.outcomeNote} style={{ marginTop: 0, marginBottom: '0.25rem' }}>
          That is more than you hold. Below is the largest offer you could publish.
        </p>
      ) : null}
      <div className={classes.outcomeRow}>
        <span className={classes.outcomeLabel}>If it is taken in full</span>
        <span className={`${classes.outcomeValue} ${classes.mono} ${classes.earned}`}>
          +{earned} {stableSymbol}
        </span>
      </div>
      <p className={classes.outcomeNote}>
        You sell {amount} {riskySymbol} for {total} {stableSymbol}. That is {each} each, against the{' '}
        {named} you named.
      </p>

      <div className={classes.outcomeRow}>
        <span className={classes.outcomeLabel}>What you give up</span>
        <span className={`${classes.outcomeValue} ${classes.mono}`}>above {each}</span>
      </div>
    </div>
  );
}

const WAD = BigInt(10) ** BigInt(18);

