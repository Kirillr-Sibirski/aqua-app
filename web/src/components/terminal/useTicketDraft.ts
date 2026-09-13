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
import { useCallback, useState } from 'react';
import type { Address } from 'viem';
import {
  dateStringFor,
  earliestMaturity,
  expiryClock,
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
  type OfferSide,
  type SizedOffer,
} from '@/components/sell';
import { floorToTokenDigits, tokenFractionDigits } from '@/components/token';
import { aquaFork } from '@/lib/chain';
import type { Deployments } from '@/lib/contracts';
import { formatTenor, formatUnits, parseDecimalInput, toDecimalString } from '@/lib/ui';

/**
 * How far from today's price the ticket opens: above it to sell, below it to buy. A sell priced
 * under spot, or a buy priced over it, would be taken the moment it was published.
 */
const DEFAULT_OVER_SPOT = 0.05;

/** The strike a side opens at, before anything is typed. */
export function defaultStrike(spot: number, side: OfferSide): number {
  return strikeFrom(spot, side === 'buy' ? -DEFAULT_OVER_SPOT : DEFAULT_OVER_SPOT);
}

/**
 * Why a strike is refused for this side, or undefined when it is on the right side of spot.
 * Sell must be above spot and buy below it; at spot either would fill on publish.
 */
export function strikeRefusal(strike: number, spot: number | undefined, side: OfferSide): string | undefined {
  if (spot === undefined || !Number.isFinite(strike) || !(strike > 0)) return undefined;
  if (side === 'sell' && strike <= spot) return 'Strike below spot';
  if (side === 'buy' && strike >= spot) return 'Strike above spot';
  return undefined;
}

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
  /** The wallet's balance of the stable token, raw units. What a buy offer spends. */
  stableBalance?: bigint;
  hydrated: boolean;
  wrongNetwork?: boolean;
}

export interface TicketDraft {
  /** Sell WETH (a covered call) or buy WETH (a cash-secured put). */
  side: OfferSide;
  setSide: (next: OfferSide) => void;
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
  /**
   * The same balance at the token's own display precision, for the one place it is printed.
   *
   * `maxAmount` is what the field is set to and is deliberately deep — eight places, so nothing is
   * rounded up into a quote the wallet cannot cover. Printing that string put `10.4` on screen
   * beside `10.4000` in the positions column and `10.40` in the promised ratio: four conventions
   * for one asset. Every WETH figure on this screen now comes from `tokenFractionDigits`.
   */
  maxAmountLabel?: string;
  /** True when more was typed than the wallet holds. The quote is clamped; the button refuses. */
  overBalance: boolean;
  /** True when the strike is on the wrong side of the feed's answer for this side, where the offer is taken instantly. */
  belowSpot: boolean;
  /** The refusal for that case, as the button reads it. */
  strikeRefusal?: string;
  /** `(strike - spot) / spot`. Undefined until the feed answers. */
  moneyness?: number;
  /** Unix seconds, 08:00 UTC on the chosen day. */
  maturity?: number;
  /** What expiries count from: the later of the chain's clock and the browser's. */
  clockSeconds?: number;
  /** The first day the picker allows, `YYYY-MM-DD`. */
  minDate?: string;
  /** True while the IV field is showing a measurement rather than the maker's own number. */
  volIsMeasured: boolean;
  /**
   * The feed's own trailing realised volatility, as the field's percentage string, when the chain
   * served enough history to measure one. The IV legend prints it and adopts it on click — the
   * chain's number as the affordance, the way the SELL legend prints the balance.
   */
  measuredVol?: string;
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
  stableBalance,
  hydrated,
}: UseTicketDraftParams): TicketDraft {
  const realised = useRealisedVol(pair?.feed, { chainId: aquaFork.id });

  const [amountDraft, setAmountDraft] = useState<string>();
  const [strikeDraft, setStrikeDraft] = useState<string>();
  const [dateDraft, setDateDraft] = useState<string | null>();
  const [volDraft, setVolDraft] = useState<string>();
  const [side, setSideState] = useState<OfferSide>('sell');
  /** The token the amount field is denominated in: what this side puts on offer. */
  const offered = pair ? (side === 'buy' ? pair.stable : pair.risky) : undefined;
  const offeredBalance = side === 'buy' ? stableBalance : riskyBalance;
  /** The browser's clock, read once per mount so the default date cannot move under the maker. */
  const [wallAnchor] = useState(() => Math.floor(Date.now() / 1000));

  /*
   * MAX, and the field it fills, at the precision this token is printed to everywhere else.
   *
   * It used to truncate at the eighth place, so a wallet holding 10.71161043 WETH opened the ticket
   * with `10.71161043` in a 380px field — eleven characters that tripped the field's own shrink to
   * 13px — under a legend reading `MAX 10.7116` and above a positions column reading `10.4346`.
   * Three renderings of one asset in 400 vertical pixels, which is the exact failure
   * `tokenFractionDigits` exists to prevent.
   *
   * Truncating at the token's own display precision instead makes the string in the field, the
   * string in the legend and the string in the column one string. It is a truncation, never a
   * rounding, so the amount can only be under the balance; the cost is the dust below the fourth
   * place, which for WETH is three cents and is not worth a second decimal convention.
   *
   * The eight-place floor survives as the fallback for the one case where four places would round a
   * real balance to nothing — a wallet holding 0.00003 WETH would otherwise be handed `0.0000` and
   * a button reading `Enter an amount`.
   */
  const displayPlaces = offered ? tokenFractionDigits(offered.symbol) : 4;
  const maxParts = (() => {
    if (offeredBalance === undefined || !offered) return undefined;
    const d = offered.decimals;
    /* The truncation is `floorToTokenDigits`, not four lines of step arithmetic written here.
       It used to be written here, and the positions strip's promised-over-held ratio — the only
       other place on this screen that prints this same wallet balance — reached for the default
       formatter instead and rounded it, so `MAX 10.3302` sat above `… / 10.3303 WETH`. Both call
       sites now ask the token registry, which owns how many places a token gets and which way the
       digits past them go. */
    const floored = floorToTokenDigits(offeredBalance, d, offered.symbol);
    /* The one balance four places cannot express. It keeps the eight-place floor rather than being
       handed `0.0000` and a button reading `Enter an amount`. */
    if (offeredBalance > BigInt(0) && floored === BigInt(0)) {
      const deep = roundedDown(offeredBalance, d, 8);
      return { field: deep, label: deep };
    }
    const fixed = {
      significantDigits: 18,
      minFractionDigits: displayPlaces,
      maxFractionDigits: displayPlaces,
    } as const;
    /* One quantity, two renderings that differ only in the separators the field is about to put
       back for itself. Both parse to the same bigint and print the same four places. */
    return {
      field: formatUnits(floored, d, { ...fixed, group: false }),
      label: formatUnits(floored, d, fixed),
    };
  })();
  const maxAmount = maxParts?.field;
  const maxAmountLabel = maxParts?.label;
  const maxRaw =
    maxAmount !== undefined && offered
      ? (parseDecimalInput(maxAmount, offered.decimals) ?? BigInt(0))
      : undefined;

  // Derived, never copied into state on arrival: there is no render in which a field disagrees with
  // the read it came from, and no effect that overwrites something typed a frame earlier.
  const amount = amountDraft ?? maxAmount ?? (side === 'buy' ? '2500' : '1');
  const strike = strikeDraft ?? (spot === undefined ? '' : String(defaultStrike(spot, side)));
  /* Expiries count from the later of the chain's clock and the browser's, so nobody is offered a day
     that has gone: on the demo fork the chain runs days behind the calendar. A draft that has fallen
     behind that floor is pulled up to the first day allowed rather than refused. */
  const clockSeconds = nowSeconds === undefined ? undefined : expiryClock(nowSeconds, wallAnchor);
  const minMaturity = clockSeconds === undefined ? undefined : earliestMaturity(clockSeconds);
  const pickedDate =
    dateDraft ?? (clockSeconds === undefined ? null : dateStringFor(nextFridayAfter(clockSeconds)));
  const pickedMaturity = maturityForDateString(pickedDate);
  const date =
    pickedMaturity !== undefined && minMaturity !== undefined && pickedMaturity < minMaturity
      ? dateStringFor(minMaturity)
      : pickedDate;
  const maturity = maturityForDateString(date);

  const volSpanIsEnough = !!realised.vol && realised.vol.spanSeconds >= MIN_VOL_SPAN_SECONDS;
  const measuredVol = volSpanIsEnough && realised.vol ? (realised.vol.sigma * 100).toFixed(1) : undefined;
  const vol = volDraft ?? measuredVol ?? FALLBACK_VOL;

  const amountRaw = offered ? (parseDecimalInput(amount, offered.decimals) ?? BigInt(0)) : BigInt(0);
  const overBalance = maxRaw !== undefined && amountRaw > maxRaw;
  /* Never price an offer that cannot be published: the quote is clamped to the balance, so the most
     motivating figure on the screen can never describe a trade the button is already refusing. */
  const quotedRaw = overBalance && maxRaw !== undefined ? maxRaw : amountRaw;

  const strikeWad = parseDecimalInput(strike, 18) ?? undefined;
  const volWad = parseDecimalInput(vol, 18);
  const sigmaWad = volWad === null || volWad <= BigInt(0) ? undefined : volWad / BigInt(100);

  const strikeNumber = Number(strike);
  const refusal = strikeRefusal(strikeNumber, spot, side);
  const belowSpot = refusal !== undefined;
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
    side,
    amountRaw: quotedRaw,
    strikeWad,
    sigmaWad,
    maturity,
    spot,
    nowSeconds,
    salt: saltAnchor * BigInt(1_000) + BigInt(nonce),
  });

  const publisher = usePublishOffer();
  const { isRunning: publishing, reset: resetPublisher } = publisher;
  const resetSteps = useCallback(() => {
    if (!publishing) resetPublisher();
  }, [publishing, resetPublisher]);

  const blocked = ((): string | undefined => {
    if (!hydrated || !deployments) return 'Loading';
    if (!pair) return 'No deployment';
    if (amountRaw <= BigInt(0)) return 'Enter an amount';
    if (overBalance && maxAmount !== undefined) return `Max ${maxAmount}`;
    if (strikeWad === undefined || strikeWad <= BigInt(0)) return 'Enter a strike';
    if (refusal) return refusal;
    if (sigmaWad === undefined) return 'Enter an IV';
    // Without a spot there is no reserve point to choose `L` at, so no offer is ever produced and a
    // "Pricing" label would describe an activity that is not happening.
    if (spot === undefined) return 'No price';
    if (!sizing.offer) return sizing.isLoading || !sizing.error ? 'Pricing' : 'Cannot price';
    return undefined;
  })();

  return {
    side,
    /* Switching side starts the two figures that mean something different on each side over: an
       amount of WETH is not an amount of USDC, and a strike above spot is refused on the buy side. */
    setSide: (next: OfferSide) => {
      if (next === side) return;
      resetSteps();
      setSideState(next);
      setAmountDraft(undefined);
      setStrikeDraft(undefined);
    },
    amount,
    strike,
    date,
    vol,
    /* Mantine groups the digits for reading; `parseDecimalInput` takes a decimal string. The
       separator is stripped on the way in so the two never disagree about what was typed.

       Each setter clears the last run's step strip. That strip is the receipt of a publish that has
       already landed, and the moment a maker starts typing the next offer it is three stale rows
       between the figures and the button — on a 900px screen, three rows the ticket has to be
       scrolled past to reach its own primary action. The row it wrote is still lit in the strip
       below, which is where a landed offer belongs. */
    setAmount: (next: string) => {
      resetSteps();
      setAmountDraft(ungroup(next));
    },
    setStrike: (next: string) => {
      resetSteps();
      setStrikeDraft(ungroup(next));
    },
    setDate: (next: string | null) => {
      resetSteps();
      setDateDraft(next);
    },
    setVol: (next: string) => {
      resetSteps();
      setVolDraft(next);
    },
    maxAmount,
    maxAmountLabel,
    overBalance,
    belowSpot,
    strikeRefusal: refusal,
    moneyness,
    maturity,
    clockSeconds,
    minDate: minMaturity === undefined ? undefined : dateStringFor(minMaturity),
    volIsMeasured: volDraft === undefined && measuredVol !== undefined,
    measuredVol,
    // A measurement shorter than a day is not allowed to set the default, and it is never coming
    // back longer on this fork, so it is reported as unavailable rather than left loading.
    volUnavailable:
      realised.unavailable ??
      (realised.vol && !volSpanIsEnough
        ? `The feed's readable history spans ${formatTenor(realised.vol.spanSeconds)}, less than the day a measurement needs.`
        : undefined),
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
 * A balance as an amount someone would type: truncated, never rounded up.
 *
 * Rounding up produces a default the wallet cannot cover, and the failure would land as a refused
 * quote rather than as a message now. `places` is the token's own display precision at the call
 * site above, so what MAX writes into the field is the string the legend beside it prints.
 */
function roundedDown(raw: bigint, decimals: number, places = 8): string {
  const step = BigInt(10) ** BigInt(Math.max(0, decimals - places));
  return toDecimalString((raw / step) * step, decimals);
}
