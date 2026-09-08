/**
 * `SurfaceLens`, called from the browser.
 *
 * The lens takes the raw `Shipped` payloads and returns each leg's terms, its live Aqua reserves,
 * the curve's own mark, its delta, the option premium and the accrued theta band — the whole book
 * priced in one `eth_call`, with no oracle anywhere in the path.
 *
 * Two ways to reach it, in order:
 *
 *   1. a deployed address, from the deployment manifest or `NEXT_PUBLIC_SURFACE_LENS`;
 *   2. **deployless** — viem runs the contract's own init code inside the call and throws it away
 *      afterwards. The lens is a pure view contract with no storage and no owner, so there is
 *      nothing to deploy: a fork bootstrapped before this contract existed still prices the book,
 *      and no address ever has to be trusted or kept in sync.
 *
 * If both fail the screen keeps working. Strike, implied vol, expiry, liquidity and the reserves
 * are all *decoded*, not computed, so the surface itself never needed the lens; the mark, the
 * premium and the band are what it adds.
 */
import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem';
import type { LegPricing } from './types';

/** The `Leg` struct, field for field with `SurfaceLens.sol`. Order is load-bearing: it is ABI. */
const LEG_COMPONENTS = [
  { name: 'orderHash', type: 'bytes32' },
  { name: 'maker', type: 'address' },
  { name: 'app', type: 'address' },
  { name: 'tokenRisky', type: 'address' },
  { name: 'tokenStable', type: 'address' },
  { name: 'isLeg', type: 'bool' },
  { name: 'guarded', type: 'bool' },
  { name: 'riskyIsTokenA', type: 'bool' },
  { name: 'strikeWad', type: 'uint128' },
  { name: 'sigmaWad', type: 'uint64' },
  { name: 'maturity', type: 'uint40' },
  { name: 'liquidityWad', type: 'uint128' },
  { name: 'rateRisky', type: 'uint64' },
  { name: 'rateStable', type: 'uint64' },
  { name: 'tokensCount', type: 'uint8' },
  { name: 'live', type: 'bool' },
  { name: 'docked', type: 'bool' },
  { name: 'matured', type: 'bool' },
  { name: 'reserveRisky', type: 'uint256' },
  { name: 'reserveStable', type: 'uint256' },
  { name: 'freeRisky', type: 'uint256' },
  { name: 'freeStable', type: 'uint256' },
  { name: 'deliverableRisky', type: 'uint256' },
  { name: 'deliverableStable', type: 'uint256' },
  { name: 'priced', type: 'bool' },
  { name: 'tauWad', type: 'uint256' },
  { name: 'markWad', type: 'uint256' },
  { name: 'deltaWad', type: 'uint256' },
  { name: 'premiumWad', type: 'int256' },
  { name: 'valueWad', type: 'uint256' },
  { name: 'minRiskyIn', type: 'uint256' },
  { name: 'minStableIn', type: 'uint256' },
] as const;

export const surfaceLensAbi = [
  {
    type: 'function',
    name: 'book',
    stateMutability: 'view',
    inputs: [{ name: 'strategies', type: 'bytes[]' }],
    outputs: [{ name: 'legs', type: 'tuple[]', components: LEG_COMPONENTS }],
  },
  {
    type: 'function',
    name: 'legOfStrategy',
    stateMutability: 'view',
    inputs: [{ name: 'strategy', type: 'bytes' }],
    outputs: [{ name: '', type: 'tuple', components: LEG_COMPONENTS }],
  },
  { type: 'function', name: 'AQUA', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'APP', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'error', name: 'NotAStrikelineLeg', inputs: [] },
  { type: 'error', name: 'ProgramMalformed', inputs: [{ name: 'pc', type: 'uint256' }] },
  { type: 'error', name: 'RmmOutOfDomain', inputs: [] },
  { type: 'error', name: 'ZeroRate', inputs: [] },
] as const;

/** The constructor's arguments, in order. */
export const surfaceLensConstructorAbi = [{ type: 'address' }, { type: 'address' }] as const;

/** One row of `book()`, as the ABI returns it. */
export type LensLeg = {
  orderHash: Hex;
  maker: Address;
  app: Address;
  tokenRisky: Address;
  tokenStable: Address;
  isLeg: boolean;
  guarded: boolean;
  riskyIsTokenA: boolean;
  strikeWad: bigint;
  sigmaWad: bigint;
  maturity: number;
  liquidityWad: bigint;
  rateRisky: bigint;
  rateStable: bigint;
  tokensCount: number;
  live: boolean;
  docked: boolean;
  matured: boolean;
  reserveRisky: bigint;
  reserveStable: bigint;
  freeRisky: bigint;
  freeStable: bigint;
  deliverableRisky: bigint;
  deliverableStable: bigint;
  priced: boolean;
  tauWad: bigint;
  markWad: bigint;
  deltaWad: bigint;
  premiumWad: bigint;
  valueWad: bigint;
  minRiskyIn: bigint;
  minStableIn: bigint;
};

export interface ReadBookParams {
  aqua: Address;
  /** The app whose strategies these are: our router. */
  app: Address;
  /** Raw `abi.encode(order)` payloads, straight from the `Shipped` logs. */
  strategies: readonly Hex[];
  /** A deployed lens. Omit to run the init code inside the call instead. */
  address?: Address;
  /** Pin the read to the same block the rest of the screen used. */
  blockNumber?: bigint;
}

export interface ReadBookResult {
  legs: LensLeg[];
  /** How the lens was reached, so the screen can say so. */
  via: 'deployed' | 'deployless';
}

/** `book(strategies)` — the whole ladder priced at one block. */
export async function readBook(client: PublicClient, params: ReadBookParams): Promise<ReadBookResult> {
  const data = encodeFunctionData({
    abi: surfaceLensAbi,
    functionName: 'book',
    args: [params.strategies as Hex[]],
  });

  if (params.address) {
    const returned = await client.call({ to: params.address, data, blockNumber: params.blockNumber });
    return { legs: decodeBook(returned.data), via: 'deployed' };
  }

  // Deployless: `code` is the init code with the constructor arguments appended, so the node runs
  // the constructor and the call in one frame and discards the contract. Nothing is written.
  const { SURFACE_LENS_BYTECODE } = await import('./lensBytecode');
  const { encodeAbiParameters } = await import('viem');
  const code = (SURFACE_LENS_BYTECODE +
    encodeAbiParameters(surfaceLensConstructorAbi, [params.aqua, params.app]).slice(2)) as Hex;

  const returned = await client.call({ code, data, blockNumber: params.blockNumber });
  return { legs: decodeBook(returned.data), via: 'deployless' };
}

function decodeBook(data: Hex | undefined): LensLeg[] {
  if (!data || data === '0x') throw new Error('SurfaceLens returned no data');
  return decodeFunctionResult({
    abi: surfaceLensAbi,
    functionName: 'book',
    data,
  }) as unknown as LensLeg[];
}

/** The pricing half of a lens row, or `undefined` when the lens could not price that leg. */
export function pricingOf(leg: LensLeg): LegPricing | undefined {
  if (!leg.isLeg || !leg.priced) return undefined;
  return {
    tauWad: leg.tauWad,
    markWad: leg.markWad,
    deltaWad: leg.deltaWad,
    premiumWad: leg.premiumWad,
    valueWad: leg.valueWad,
    minRiskyIn: leg.minRiskyIn,
    minStableIn: leg.minStableIn,
    freeRisky: leg.freeRisky,
    freeStable: leg.freeStable,
    deliverableRisky: leg.deliverableRisky,
    deliverableStable: leg.deliverableStable,
    matured: leg.matured,
  };
}

/**
 * The lens's own error names, decoded.
 *
 * `book()` isolates every entry, so these only surface from `legOfStrategy`. They are still worth
 * naming: "NotAStrikelineLeg" is an answer, and "something went wrong" is not.
 */
export function describeLensRevert(error: unknown): string | undefined {
  const data = extractRevertData(error);
  if (!data) return undefined;
  try {
    const decoded = decodeErrorResult({ abi: surfaceLensAbi, data });
    return decoded.errorName;
  } catch {
    return undefined;
  }
}

function extractRevertData(error: unknown): Hex | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 8 && cursor; depth += 1) {
    const record = cursor as { data?: unknown; cause?: unknown };
    if (typeof record.data === 'string' && record.data.startsWith('0x')) return record.data as Hex;
    cursor = record.cause;
  }
  return undefined;
}
