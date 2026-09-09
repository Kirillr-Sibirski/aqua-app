'use client';

/**
 * The offer being drafted, held once for the whole screen.
 *
 * The chart and the ticket are two views of one thing: the chart draws the curve the ticket is
 * about to publish, with its reserve point on it, and both have to be looking at the same leg or
 * the picture is of a different offer than the button ships. So the draft lives here, above both,
 * rather than inside the ticket with a callback pushing it sideways — no effect, no second copy,
 * and no frame in which the two disagree.
 *
 * Everything consequential is still `sell/useOffer`: `x` is what was typed, `L` is chosen by
 * `liquidityForRisky`, and `y` is `StrikelineViews.stableFor` read from the router. This file adds
 * defaults and validation and nothing else. There is no option maths in it.
 */
import { useState } from 'react';
import type { Address } from 'viem';
import {
  dateStringFor,
  moneynessOf,
  nextFridayAfter,
  strikeFrom,
  useOffer,
  usePublishOffer,
  useRealisedVol,
  maturityForDateString,
  FALLBACK_VOL,
  MIN_VOL_SPAN_SECONDS,
  type OfferPair,
  type SizedOffer,
} from '@/components/sell';
import { aquaFork } from '@/lib/chain';
import type { Deployments } from '@/lib/contracts';
import { parseDecimalInput, toDecimalString } from '@/lib/ui';

/** How far above today's price the ticket opens. A price below it would be taken immediately. */
const DEFAULT_OVER_SPOT = 0.05;

export interface UseTicketDraftParams {
  pair?: OfferPair;
  deployments?: Deployments;
  /** The feed's answer as a float. Picks where on the curve the offer starts, and nothing else. */
  spot?: number;
  address?: Address;
  /** The chain's clock, seconds, from the block every other figure was read at. */
  nowSeconds?: number;
  /** The wallet's balance of the risky token, raw units. */
  riskyBalance?: bigint;
  hydrated: boolean;
  wrongNetwork?: boolean;
}

export interface TicketDraft {
  /** Field values, always a string, never blank once the chain has answered. */
  amount: string;
  strike: string;
  /** `YYYY-MM-DD`, the picker's own vocabulary. */
  date: string | null;
  /** Implied volatility as a percentage string: `62.0`. */
  vol: string;

  setAmount: (next: string) => void;
  setStrike: (next: string) => void;
  setDate: (next: string | null) => void;
  setVol: (next: string) => void;

  /** The balance floored at the eighth place: what MAX sets and what the quote is clamped to. */
  maxAmount?: string;
  /** True when more was typed than the wallet holds. The quote is clamped; the button refuses. */
  overBalance: boolean;
  /** True when the strike is at or under the feed's answer, where the offer is taken instantly. */
  belowSpot: boolean;
  /** `(strike - spot) / spot`. Undefined until the feed answers. */
  moneyness?: number;
  /** Unix seconds, 08:00 UTC on the chosen day. */
  maturity?: number;
  /** True while the IV field is showing a measurement rather than the maker's own number. */
  volIsMeasured: boolean;
  /** Why there is no measurement, when there is none. */
  volUnavailable?: string;
  volSpanSeconds?: number;

  offer?: SizedOffer;
  sizing: { isLoading: boolean; error: Error | null };

  /** The one thing stopping a publish, as a button label. Undefined when nothing is. */
  blocked?: string;
  publish: () => Promise<void>;
  publisher: ReturnType<typeof usePublishOffer>;
}

export function useTicketDraft({
  pair,
  deployments,
  spot,
  address,
  nowSeconds,
  riskyBalance,
  hydrated,
}: UseTicketDraftParams): TicketDraft {
  const realised = useRealisedVol(pair?.feed, { chainId: aquaFork.id });

  const [amountDraft, setAmountDraft] = useState<string>();
  const [strikeDraft, setStrikeDraft] = useState<string>();
  const [dateDraft, setDateDraft] = useState<string | null>();
  const [volDraft, setVolDraft] = useState<string>();

  const maxAmount =
    riskyBalance !== undefined && pair ? roundedDown(riskyBalance, pair.risky.decimals) : undefined;
  const maxRaw =
    maxAmount !== undefined && pair
      ? (parseDecimalInput(maxAmount, pair.risky.decimals) ?? BigInt(0))
      : undefined;

  // Derived, never copied into state on arrival: there is no render in which a field disagrees with
  // the read it came from, and no effect that overwrites something typed a frame earlier.
  const amount = amountDraft ?? maxAmount ?? '1';
  const strike = strikeDraft ?? (spot === undefined ? '' : String(strikeFrom(spot, DEFAULT_OVER_SPOT)));
  const date = dateDraft ?? (nowSeconds === undefined ? null : dateStringFor(nextFridayAfter(nowSeconds)));
  const maturity = maturityForDateString(date);

  const volSpanIsEnough = !!realised.vol && realised.vol.spanSeconds >= MIN_VOL_SPAN_SECONDS;
  const measuredVol = volSpanIsEnough && realised.vol ? (realised.vol.sigma * 100).toFixed(1) : undefined;
  const vol = volDraft ?? measuredVol ?? FALLBACK_VOL;

  const amountRaw = pair ? (parseDecimalInput(amount, pair.risky.decimals) ?? BigInt(0)) : BigInt(0);
  const overBalance = maxRaw !== undefined && amountRaw > maxRaw;
  /* Never price an offer that cannot be published: the quote is clamped to the balance, so the most
     motivating figure on the screen can never describe a trade the button is already refusing. */
  const quotedRaw = overBalance && maxRaw !== undefined ? maxRaw : amountRaw;

  const strikeWad = parseDecimalInput(strike, 18) ?? undefined;
  const volWad = parseDecimalInput(vol, 18);
  const sigmaWad = volWad === null || volWad <= BigInt(0) ? undefined : volWad / BigInt(100);

  const strikeNumber = Number(strike);
  const belowSpot =
    spot !== undefined && Number.isFinite(strikeNumber) && strikeNumber > 0 && strikeNumber <= spot;
  const moneyness =
    spot !== undefined && Number.isFinite(strikeNumber) ? moneynessOf(strikeNumber, spot) : undefined;

  /*
   * The salt, anchored once per mount and bumped once a publish lands.
   *
   * A maker-owned nonce is what makes the strategy hash unique, and `Aqua.dock` writes a docked hash
   * off permanently — so it must never repeat, and it must not move while the offer is on screen or
   * the leg under the chart would change every block. This is the one place the browser's clock is
   * allowed near a shipped byte, and it is allowed because a salt is an arbitrary number.
   */
  const [saltAnchor] = useState(() => BigInt(Date.now()));
  const [nonce, setNonce] = useState(0);

  const sizing = useOffer({
    router: deployments?.router,
    maker: address,
    pair,
    amountRaw: quotedRaw,
    strikeWad,
    sigmaWad,
    maturity,
    spot,
    nowSeconds,
    salt: saltAnchor * BigInt(1_000) + BigInt(nonce),
  });

  const publisher = usePublishOffer();

  const blocked = ((): string | undefined => {
    if (!hydrated || !deployments) return 'Loading';
    if (!pair) return 'No deployment';
    if (amountRaw <= BigInt(0)) return 'Enter an amount';
    if (overBalance && maxAmount !== undefined) return `Max ${maxAmount}`;
    if (strikeWad === undefined || strikeWad <= BigInt(0)) return 'Enter a strike';
    if (belowSpot) return 'Strike below spot';
    if (sigmaWad === undefined) return 'Enter an IV';
    // Without a spot there is no reserve point to choose `L` at, so no offer is ever produced and a
    // "Pricing" label would describe an activity that is not happening.
    if (spot === undefined) return 'No price';
    if (!sizing.offer) return sizing.isLoading || !sizing.error ? 'Pricing' : 'Cannot price';
    return undefined;
  })();

  return {
    amount,
    strike,
    date,
    vol,
    /* Mantine groups the digits for reading; `parseDecimalInput` takes a decimal string. The
       separator is stripped on the way in so the two never disagree about what was typed. */
    setAmount: (next: string) => setAmountDraft(ungroup(next)),
    setStrike: (next: string) => setStrikeDraft(ungroup(next)),
    setDate: setDateDraft,
    setVol: setVolDraft,
    maxAmount,
    overBalance,
    belowSpot,
    moneyness,
    maturity,
    volIsMeasured: volDraft === undefined && measuredVol !== undefined,
    volUnavailable: realised.unavailable,
    volSpanSeconds: realised.vol?.spanSeconds,
    offer: sizing.offer,
    sizing: { isLoading: sizing.isLoading, error: sizing.error },
    blocked,
    publisher,
    publish: async () => {
      if (!deployments || !pair || !sizing.offer) return;
      try {
        await publisher.publish({
          aqua: deployments.aqua,
          router: deployments.router,
          pair,
          offer: sizing.offer,
        });
        setNonce((n) => n + 1);
      } catch {
        // `useTxFlow` recorded which step failed and why; the strip under the button renders it.
      }
    },
  };
}

/** Drops the thousands separators a grouped input hands back. */
function ungroup(value: string): string {
  return value.replace(/,/g, '');
}

/**
 * A balance as an amount someone would type: truncated at the eighth place, never rounded up.
 * Rounding up produces a default the wallet cannot cover, and the failure would land as a refused
 * quote rather than as a message now.
 */
function roundedDown(raw: bigint, decimals: number, places = 8): string {
  const step = BigInt(10) ** BigInt(Math.max(0, decimals - places));
  return toDecimalString((raw / step) * step, decimals);
}
