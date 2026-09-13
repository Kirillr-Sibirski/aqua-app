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
import { explainProgram, findRmmArgs } from '../../web/src/components/curve/program.ts';
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
  /** SwapVM `FeeProtocol` on the leg, if any: total flat fee (1e7 == 100%) and which side it charges. */
  fee: LegFee;
}

export interface LegFee {
  bps: bigint;
  isTokenIn: boolean;
}

/** `FeeProtocol` units, as `FeeReceiverLib.BPS`. */
export const FEE_SCALE = 10_000_000n;

/**
 * Read the flat protocol fee out of a program's `FeeProtocol` instruction, the way `FeeProtocol.exec`
 * parses it: header byte (bit 7 = isTokenIn, low nibble = count), then per receiver a flags byte
 * (bit 7 provider, bit 6 flat fee, bit 5 surplus fee), a 20-byte target, and a 3-byte bps per taken fee.
 * A fee-less program returns 0 bps, so legs shipped without a fee size exactly as before.
 */
export function parseLegFee(program: Hex): LegFee {
  let args: Hex | undefined;
  try {
    args = explainProgram(program).find((i) => i.name === 'FeeProtocol')?.args;
  } catch {
    args = undefined;
  }
  if (!args || args === '0x') return { bps: 0n, isTokenIn: true };
  const bytes = Buffer.from(args.slice(2), 'hex');
  const header = bytes[0];
  const isTokenIn = (header & 0x80) !== 0;
  let count = header & 0x0f;
  let shift = 1;
  let total = 0n;
  while (count-- > 0 && shift < bytes.length) {
    const flags = bytes[shift];
    const isProvider = (flags & 0x80) !== 0;
    const flat = (flags & 0x40) !== 0;
    const surplus = (flags & 0x20) !== 0;
    shift += 21;
    if (isProvider) throw new Error('FeeProtocol provider receivers are not supported by the bot');
    if (flat) {
      total += BigInt((bytes[shift] << 16) | (bytes[shift + 1] << 8) | bytes[shift + 2]);
      shift += 3;
    }
    if (surplus) shift += 3;
  }
  return { bps: total, isTokenIn };
}

/** What reaches the curve from a gross exact-in amount: `amountIn - floor(amountIn * bps / 1e7)`. */
export function netOfFee(gross: bigint, bps: bigint): bigint {
  return gross - (gross * bps) / FEE_SCALE;
}

/** The smallest gross input whose net, after `FeeProtocol`'s floor-division fee, is at least `net`. */
export function grossForNet(net: bigint, bps: bigint): bigint {
  if (bps === 0n) return net;
  let gross = (net * FEE_SCALE + (FEE_SCALE - bps) - 1n) / (FEE_SCALE - bps);
  while (gross > 0n && netOfFee(gross - 1n, bps) >= net) gross--;
  while (netOfFee(gross, bps) < net) gross++;
  return gross;
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
      fee: parseLegFee(split.program),
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
