/**
 * Find the book the way a resolver would: out of Aqua's event log.
 *
 * The bot is given no privileged knowledge of what the maker shipped. It reads every `Shipped` event on
 * the official registry, keeps the ones whose `app` is the Strikeline router, decodes `strategy` back
 * into an order, disassembles the program, and keeps the legs that carry `RmmSwap` (0x55) and are still
 * active. Everything it needs -- K, sigma, T, L, the rate multipliers, the current reserves -- is public,
 * because `Aqua.ship` takes the strategy unhashed "for data availability" and `Shipped` carries the bytes.
 *
 * That is worth saying out loud in the demo: an option written this way needs no off-chain order book
 * and no API. The terms *are* the strategy hash.
 */
import { decodeAbiParameters, decodeEventLog, getAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import { ORDER_TUPLE_ABI, aquaAbi, decodeOrder, orderHashAqua, type Order } from '../../web/src/lib/swapvm/index.ts';
import { findRmmArgs } from '../../web/src/components/curve/program.ts';
import { decodeRmmSwapArgs, type RmmArgs } from '../../web/src/components/curve/rmm.ts';
import type { CurveParams } from './rmm.ts';

const shippedEvent = getAbiItem({ abi: aquaAbi, name: 'Shipped' });
/** `Balance.tokensCount` for a docked strategy. */
const DOCKED = 0xff;

export interface DiscoveredLeg {
  hash: Hex;
  maker: Address;
  order: Order;
  program: Hex;
  args: RmmArgs;
  params: CurveParams;
  tokenA: Address;
  tokenB: Address;
  /** The risky asset is `tokenA` (`RmmSwap.FLAG_RISKY_IS_TOKEN_A`). */
  riskyIsTokenA: boolean;
  risky: Address;
  stable: Address;
  /** Raw Aqua virtual balances, and the same lifted into normalised WAD space. */
  rawRisky: bigint;
  rawStable: bigint;
  xWad: bigint;
  yWad: bigint;
  shippedAtBlock: bigint;
}

export interface DiscoverOptions {
  client: PublicClient;
  aqua: Address;
  /** Only strategies shipped to this app. */
  app: Address;
  fromBlock: bigint;
  toBlock?: bigint;
  maker?: Address;
}

export async function discoverLegs(o: DiscoverOptions): Promise<DiscoveredLeg[]> {
  const logs = await o.client.getLogs({
    address: o.aqua,
    event: shippedEvent,
    fromBlock: o.fromBlock,
    ...(o.toBlock === undefined ? {} : { toBlock: o.toBlock }),
  });

  const legs: DiscoveredLeg[] = [];
  for (const log of logs) {
    const decoded = decodeEventLog({ abi: aquaAbi, data: log.data, topics: log.topics });
    if (decoded.eventName !== 'Shipped') continue;
    const e = decoded.args as { maker: Address; app: Address; strategyHash: Hex; strategy: Hex };
    if (e.app.toLowerCase() !== o.app.toLowerCase()) continue;
    if (o.maker && e.maker.toLowerCase() !== o.maker.toLowerCase()) continue;

    let order: Order;
    try {
      [order] = decodeAbiParameters(ORDER_TUPLE_ABI, e.strategy) as unknown as [Order];
    } catch {
      continue; // not an ISwapVM.Order; some other app's payload
    }
    if (orderHashAqua(order) !== e.strategyHash) continue;

    const split = decodeOrder(order);
    const rmmArgs = findRmmArgs(split.program);
    if (!rmmArgs) continue; // shipped to our router, but not an option leg

    const args = decodeRmmSwapArgs(rmmArgs);
    const riskyIsTokenA = (args.flags & 1) !== 0;
    const [risky, stable] = riskyIsTokenA ? [split.tokenA, split.tokenB] : [split.tokenB, split.tokenA];

    const [balA, balB] = await Promise.all([
      o.client.readContract({ address: o.aqua, abi: aquaAbi, functionName: 'rawBalances', args: [e.maker, o.app, e.strategyHash, split.tokenA] }),
      o.client.readContract({ address: o.aqua, abi: aquaAbi, functionName: 'rawBalances', args: [e.maker, o.app, e.strategyHash, split.tokenB] }),
    ]);
    if (balA[1] === 0 || balA[1] === DOCKED || balB[1] === 0 || balB[1] === DOCKED) continue; // docked or never shipped

    const rawRisky = riskyIsTokenA ? balA[0] : balB[0];
    const rawStable = riskyIsTokenA ? balB[0] : balA[0];
    legs.push({
      hash: e.strategyHash,
      maker: e.maker,
      order,
      program: split.program,
      args,
      params: {
        strikeWad: args.strikeWad,
        sigmaWad: args.sigmaWad,
        maturity: args.maturity,
        liquidityWad: args.liquidityWad,
        rateRisky: args.rateRisky,
        rateStable: args.rateStable,
      },
      tokenA: split.tokenA,
      tokenB: split.tokenB,
      riskyIsTokenA,
      risky,
      stable,
      rawRisky,
      rawStable,
      xWad: rawRisky * args.rateRisky,
      yWad: rawStable * args.rateStable,
      shippedAtBlock: log.blockNumber ?? 0n,
    });
  }
  return legs;
}

/** `K=2,600 L=12` -- how a leg is named in the bot's output, derived from its own bytes. */
export function legName(leg: DiscoveredLeg): string {
  const k = Number(leg.args.strikeWad) / 1e18;
  const l = Number(leg.args.liquidityWad) / 1e18;
  return `K=${k.toLocaleString('en-US')} L=${l}`;
}

/**
 * Does `--leg 2600` name this leg?
 *
 * Matched on digits alone, so the presenter can type the strike the way they say it out loud
 * (`2600`, `2,600`, `K=2600`) and still hit `K=2,600 L=12`. A demo argument that only works with the
 * thousands separator in the right place is an argument that fails on camera.
 */
export function legMatches(leg: DiscoveredLeg, filter: string): boolean {
  const digits = (s: string) => s.replace(/[^0-9]/g, '');
  return digits(legName(leg)).includes(digits(filter));
}
