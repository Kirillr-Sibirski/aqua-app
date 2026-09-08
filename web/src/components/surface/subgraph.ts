/**
 * The Graph as the primary read path.
 *
 * The subgraph in `subgraph/` indexes Aqua's `Shipped`/`Docked`/`Pushed`/`Pulled` and our router's
 * `Swapped`, decoding each strategy in the mapping so the terms of every option are queryable
 * instead of scannable. That matters at any real depth: a direct log read has to pull and decode
 * every `Shipped` since the router's deployment block on every page load, and Aqua's events carry
 * no indexed parameters, so the filtering cannot be pushed into the node.
 *
 * It is a preference, not a dependency. `useSurface` falls back to reading the same logs through
 * viem, with the same decoder, and says on screen which path answered.
 */
import { getAddress, type Address, type Hex } from 'viem';
import type { SurfaceLeg } from './types';

export const SUBGRAPH_URL: string | undefined = process.env.NEXT_PUBLIC_SUBGRAPH_URL;

const QUERY = `query Surface($first: Int!) {
  _meta { block { number } hasIndexingErrors }
  legs(first: $first, orderBy: shippedAtBlock, orderDirection: desc) {
    id
    app
    maker { id }
    tokenRisky
    tokenStable
    riskyIsTokenA
    strikeWad
    sigmaWad
    maturity
    liquidityWad
    rateRisky
    rateStable
    flags
    guarded
    strategy
    reserveRisky
    reserveStable
    docked
    shippedAtBlock
  }
}`;

interface RawLeg {
  id: string;
  app: string;
  maker: { id: string };
  tokenRisky: string;
  tokenStable: string;
  riskyIsTokenA: boolean;
  strikeWad: string;
  sigmaWad: string;
  maturity: string;
  liquidityWad: string;
  rateRisky: string;
  rateStable: string;
  flags: number;
  guarded: boolean;
  strategy: string;
  reserveRisky: string;
  reserveStable: string;
  docked: boolean;
  shippedAtBlock: string;
}

export interface SubgraphSurface {
  legs: SurfaceLeg[];
  /** Raw shipped bytes by strategy hash, so the lens can price what the subgraph indexed. */
  strategies: Map<string, Hex>;
  /** How far the index has caught up. Shown next to the source, because a stale index is a lie. */
  indexedBlock: bigint;
  hasIndexingErrors: boolean;
}

export class SubgraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubgraphError';
  }
}

/** One request, no client library: a POST with a query string is the whole protocol. */
export async function fetchSubgraphSurface(
  url: string,
  connected: Address | undefined,
  options: { first?: number; signal?: AbortSignal } = {},
): Promise<SubgraphSurface> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { first: options.first ?? 1000 } }),
    signal: options.signal,
  });
  if (!response.ok) throw new SubgraphError(`HTTP ${response.status}`);

  const body = (await response.json()) as {
    data?: { _meta?: { block?: { number?: number }; hasIndexingErrors?: boolean }; legs?: RawLeg[] };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new SubgraphError(body.errors[0].message);
  if (!body.data?.legs) throw new SubgraphError('response carried no legs');

  const me = connected?.toLowerCase();
  const strategies = new Map<string, Hex>();
  const legs = body.data.legs.map((raw): SurfaceLeg => {
    strategies.set(raw.id.toLowerCase(), raw.strategy as Hex);
    return {
      strategyHash: raw.id as Hex,
      maker: getAddress(raw.maker.id),
      app: getAddress(raw.app),
      tokenRisky: getAddress(raw.tokenRisky),
      tokenStable: getAddress(raw.tokenStable),
      riskyIsTokenA: raw.riskyIsTokenA,
      strikeWad: BigInt(raw.strikeWad),
      sigmaWad: BigInt(raw.sigmaWad),
      maturity: Number(raw.maturity),
      liquidityWad: BigInt(raw.liquidityWad),
      rateRisky: BigInt(raw.rateRisky),
      rateStable: BigInt(raw.rateStable),
      flags: raw.flags,
      guarded: raw.guarded,
      reserveRisky: BigInt(raw.reserveRisky),
      reserveStable: BigInt(raw.reserveStable),
      docked: raw.docked,
      shippedAtBlock: BigInt(raw.shippedAtBlock),
      mine: !!me && raw.maker.id.toLowerCase() === me,
    };
  });

  return {
    legs,
    strategies,
    indexedBlock: BigInt(body.data._meta?.block?.number ?? 0),
    hasIndexingErrors: body.data._meta?.hasIndexingErrors ?? false,
  };
}
