'use client';

/**
 * Sizing a book through the chain.
 *
 * This is the highest-consequence code in the writer, so it is worth being explicit about the split:
 *
 *  - **`x` is chosen here.** `L*(1 - Phi(d1))` says where on the curve the leg starts. Any nearby
 *    value is a legitimate, differently-moneyed leg, so a float is fine and the arithmetic is
 *    documented in `moneyness.ts`.
 *  - **`y` is read from the chain.** `StrikelineViews.stableFor(K, sigma, T, L, x)` returns the
 *    stable reserve the curve requires at that `x`, computed with the router's own approximated
 *    `Phi` and rounded the way the instruction rounds it. One wei low and every quote on the leg
 *    reverts for the rest of its life; one wei high and the surplus goes to the first taker. And
 *    because `Aqua.ship` requires `tokensCount == 0` and `dock` writes `0xff` permanently, a leg
 *    shipped wrong cannot be re-shipped under the same hash. There is no recovery, so there is no
 *    float.
 *
 * The `x` handed to `stableFor` is the *rounded* one — the reserve that will actually be shipped
 * after the risky token's decimals have had their say — not the one the model asked for. Asking
 * about a reserve you are not going to ship is the same bug wearing a different hat.
 */
import { useMemo } from 'react';
import { keccak256, type Address, type Hex } from 'viem';
import { useReadContracts } from 'wagmi';
import {
  ASSIGNMENT_WINDOW_SECONDS,
  FLAG_RISKY_IS_TOKEN_A,
  buildLegProgram,
  expiryFlagsFor,
  rateFor,
  strikelineReadAbi,
  toRawReserve,
  type RmmArgs,
} from '@/components/curve';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { buildAquaOrder, encodeStrategyForShip } from '@/lib/swapvm';
import { riskyReserveWad } from './moneyness';
import type { LegDraft, SizedLeg, WritePair } from './types';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export interface UseLegSizingParams {
  router?: Address;
  maker?: Address;
  pair?: WritePair;
  legs: readonly LegDraft[];
  /** Annualised implied vol, WAD. The maker's choice; no oracle supplies it. */
  sigmaWad?: bigint;
  maturity?: number;
  /** Spot in stable per risky, from the price feed. Picks the moneyness, nothing else. */
  spot?: number;
  /** `tau` in years, derived from the chain's clock. Picks the moneyness, nothing else. */
  tau?: number;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

export interface UseLegSizingResult {
  sized: SizedLeg[];
  /** Totals in raw token units, for the margin preview. */
  riskyNeeded: bigint;
  stableNeeded: bigint;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/** The `x` a leg starts at, already rounded to what the risky token can represent. */
function chosenReserve(
  leg: LegDraft,
  pair: WritePair,
  sigma: number,
  tau: number,
  spot: number,
): { xWad: bigint; riskyRaw: bigint } {
  const rateRisky = rateFor(pair.risky.decimals);
  const wanted = riskyReserveWad(leg.liquidityWad, {
    spot,
    strike: leg.strike,
    sigma,
    tau,
  });
  const { raw, normalised } = toRawReserve(wanted, rateRisky);
  return { xWad: normalised, riskyRaw: raw };
}

export function useLegSizing({
  router,
  maker,
  pair,
  legs,
  sigmaWad,
  maturity,
  spot,
  tau,
  chainId = aquaFork.id,
  enabled = true,
}: UseLegSizingParams): UseLegSizingResult {
  const sigma = sigmaWad === undefined ? undefined : Number(sigmaWad) / 1e18;

  const chosen = useMemo(() => {
    if (!pair || sigma === undefined || tau === undefined || spot === undefined) return [];
    return legs
      .filter((leg) => leg.liquidityWad > BigInt(0))
      .map((leg) => ({ leg, ...chosenReserve(leg, pair, sigma, tau, spot) }));
  }, [legs, pair, sigma, tau, spot]);

  const ready =
    enabled &&
    !!router &&
    !!maker &&
    !!pair &&
    sigmaWad !== undefined &&
    maturity !== undefined &&
    chosen.length > 0;

  const contracts = useMemo(
    () =>
      chosen.map(
        ({ leg, xWad }) =>
          ({
            address: router ?? ZERO_ADDRESS,
            abi: strikelineReadAbi,
            functionName: 'stableFor',
            args: [leg.strikeWad, sigmaWad ?? BigInt(0), maturity ?? 0, leg.liquidityWad, xWad],
            chainId,
          }) as const,
      ),
    [chosen, router, sigmaWad, maturity, chainId],
  );

  const query = useReadContracts({
    contracts,
    allowFailure: false,
    query: {
      enabled: ready,
      // Sized against a maturity and a spot that both move; a stale reserve is a wrong reserve.
      staleTime: 4_000,
      retry: false,
    },
  });

  const sized = useMemo<SizedLeg[]>(() => {
    if (!query.data || !pair || sigmaWad === undefined || maturity === undefined || !maker) return [];

    const rateRisky = rateFor(pair.risky.decimals);
    const rateStable = rateFor(pair.stable.decimals);
    const tokenA = pair.riskyIsTokenA ? pair.risky.address : pair.stable.address;
    const tokenB = pair.riskyIsTokenA ? pair.stable.address : pair.risky.address;

    return chosen.map(({ leg, xWad, riskyRaw }, i) => {
      const yWanted = query.data[i] as bigint;
      const { raw: stableRaw, normalised: yWad } = toRawReserve(yWanted, rateStable);

      const rmm: RmmArgs = {
        flags: (pair.riskyIsTokenA ? FLAG_RISKY_IS_TOKEN_A : 0) | expiryFlagsFor(leg.kind),
        sigmaWad,
        maturity,
        strikeWad: leg.strikeWad,
        liquidityWad: leg.liquidityWad,
        rateRisky,
        rateStable,
      };

      const program = buildLegProgram({
        rmm,
        deadline: maturity + ASSIGNMENT_WINDOW_SECONDS,
        salt: leg.salt,
      });

      const order = buildAquaOrder({ maker, tokenA, tokenB, program });
      const strategyHash = keccak256(encodeStrategyForShip(order));

      const amounts: readonly [bigint, bigint] = pair.riskyIsTokenA
        ? [riskyRaw, stableRaw]
        : [stableRaw, riskyRaw];

      return {
        draft: leg,
        rmm,
        program,
        order,
        strategyHash: strategyHash as Hex,
        xWad,
        yWad,
        tokens: [tokenA, tokenB] as const,
        amounts,
        riskyRaw,
        stableRaw,
      };
    });
  }, [query.data, chosen, pair, sigmaWad, maturity, maker]);

  const riskyNeeded = sized.reduce((sum, leg) => sum + leg.riskyRaw, BigInt(0));
  const stableNeeded = sized.reduce((sum, leg) => sum + leg.stableRaw, BigInt(0));

  return {
    sized,
    riskyNeeded,
    stableNeeded,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
