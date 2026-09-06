/**
 * Shipped-strategy discovery, framework-free so the React hook and the vitest fork test share it.
 *
 * Aqua's `Shipped(maker, app, strategyHash, strategy)` event has NO indexed params, so we pull every
 * Shipped log from the deployment block and filter client-side by maker and app (== our router).
 * `strategy` is `abi.encode(ISwapVM.Order)`; we decode it back into an Order, split `order.data` with
 * `decodeOrder()` (tokenA ‖ tokenB ‖ hooks ‖ program) and attach live `Aqua.rawBalances` via multicall.
 */
import {
  decodeAbiParameters,
  getAbiItem,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { aquaAbi } from './abis';
import { MULTICALL3_ADDRESS } from '../chain/chains';
import { decodeOrder, orderHashAqua, ORDER_TUPLE_ABI, type Order, type OrderDecoded } from '../swapvm';

/** `tokensCount` value Aqua stores for a docked strategy (`_DOCKED`). */
export const DOCKED_TOKENS_COUNT = 0xff;

export const shippedEvent = getAbiItem({ abi: aquaAbi, name: 'Shipped' });
export const dockedEvent = getAbiItem({ abi: aquaAbi, name: 'Docked' });

export interface AquaTokenBalance {
  token: Address;
  /** uint248 virtual balance. */
  balance: bigint;
  /** 0 = never shipped, 1..254 = active (number of tokens), 255 = docked. */
  tokensCount: number;
}

export interface ShippedStrategy {
  strategyHash: Hex;
  maker: Address;
  app: Address;
  /** Raw `abi.encode(order)` bytes as shipped. */
  strategy: Hex;
  order: Order;
  decoded: OrderDecoded;
  tokens: readonly [Address, Address];
  program: Hex;
  /** True when keccak256(strategy) recomputed from the decoded order equals the event's strategyHash. */
  hashMatches: boolean;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
  balances: AquaTokenBalance[];
  /** tokensCount == 0xff for every token. */
  docked: boolean;
  /** Not docked and every token has tokensCount in 1..254. */
  active: boolean;
}

export interface SkippedShippedLog {
  strategyHash: Hex;
  transactionHash: Hex;
  reason: string;
}

export interface FetchShippedStrategiesParams {
  aqua: Address;
  /** App filter (our router). */
  app: Address;
  /** Maker filter; omit to return every strategy shipped to `app`. */
  maker?: Address;
  fromBlock: bigint;
  toBlock?: bigint | 'latest';
  /** Multicall3 address (defaults to the canonical one, present on the Base fork). */
  multicallAddress?: Address;
}

export interface FetchShippedStrategiesResult {
  strategies: ShippedStrategy[];
  skipped: SkippedShippedLog[];
  fromBlock: bigint;
  toBlock: bigint;
}

/** `abi.decode(strategy, (Order))` — inverse of `encodeStrategyForShip`. */
export function decodeStrategyBytes(strategy: Hex): Order {
  const [order] = decodeAbiParameters(ORDER_TUPLE_ABI, strategy);
  return { maker: order.maker, traits: order.traits, data: order.data };
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Read `Aqua.rawBalances` for several (strategyHash, token) pairs in one multicall. */
export async function readRawBalances(
  client: PublicClient,
  params: { aqua: Address; app: Address; maker: Address; items: readonly { strategyHash: Hex; token: Address }[]; multicallAddress?: Address },
): Promise<AquaTokenBalance[]> {
  if (params.items.length === 0) return [];
  const results = await client.multicall({
    allowFailure: false,
    multicallAddress: params.multicallAddress ?? MULTICALL3_ADDRESS,
    contracts: params.items.map((it) => ({
      address: params.aqua,
      abi: aquaAbi,
      functionName: 'rawBalances',
      args: [params.maker, params.app, it.strategyHash, it.token],
    })),
  });
  return results.map((r, i) => {
    const [balance, tokensCount] = r as readonly [bigint, number];
    return { token: params.items[i].token, balance, tokensCount: Number(tokensCount) };
  });
}

/** Full pipeline: Shipped logs → filter → decode → live rawBalances → docked/active flags. */
export async function fetchShippedStrategiesDetailed(
  client: PublicClient,
  params: FetchShippedStrategiesParams,
): Promise<FetchShippedStrategiesResult> {
  const toBlock = params.toBlock === undefined || params.toBlock === 'latest' ? await client.getBlockNumber() : params.toBlock;
  const logs = await client.getLogs({
    address: params.aqua,
    event: shippedEvent,
    fromBlock: params.fromBlock,
    toBlock,
    strict: true,
  });

  const skipped: SkippedShippedLog[] = [];
  const partial: Omit<ShippedStrategy, 'balances' | 'docked' | 'active'>[] = [];

  for (const log of logs) {
    const { maker, app, strategyHash, strategy } = log.args;
    if (!sameAddress(app, params.app)) continue;
    if (params.maker && !sameAddress(maker, params.maker)) continue;
    try {
      const order = decodeStrategyBytes(strategy);
      const decoded = decodeOrder(order);
      // `decodeOrder` slices the addresses out of `order.data`, so they come back lowercase.
      const tokens: [Address, Address] = [getAddress(decoded.tokenA), getAddress(decoded.tokenB)];
      partial.push({
        strategyHash,
        maker,
        app,
        strategy,
        order,
        decoded,
        tokens,
        program: decoded.program,
        hashMatches: orderHashAqua(order).toLowerCase() === strategyHash.toLowerCase(),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
      });
    } catch (e) {
      skipped.push({ strategyHash, transactionHash: log.transactionHash, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // Balances: group by maker so each multicall uses a single maker argument.
  const strategies: ShippedStrategy[] = [];
  const byMaker = new Map<string, typeof partial>();
  for (const p of partial) {
    const key = p.maker.toLowerCase();
    const list = byMaker.get(key) ?? [];
    list.push(p);
    byMaker.set(key, list);
  }
  for (const list of byMaker.values()) {
    const items = list.flatMap((p) => p.tokens.map((token) => ({ strategyHash: p.strategyHash, token })));
    const balances = await readRawBalances(client, {
      aqua: params.aqua,
      app: params.app,
      maker: list[0].maker,
      items,
      multicallAddress: params.multicallAddress,
    });
    list.forEach((p, i) => {
      const own = balances.slice(i * 2, i * 2 + 2);
      const docked = own.every((b) => b.tokensCount === DOCKED_TOKENS_COUNT);
      const active = !docked && own.every((b) => b.tokensCount >= 1 && b.tokensCount < DOCKED_TOKENS_COUNT);
      strategies.push({ ...p, balances: own, docked, active });
    });
  }

  strategies.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1));
  return { strategies, skipped, fromBlock: params.fromBlock, toBlock };
}

/** Convenience: strategies only (newest first). */
export async function fetchShippedStrategies(client: PublicClient, params: FetchShippedStrategiesParams): Promise<ShippedStrategy[]> {
  return (await fetchShippedStrategiesDetailed(client, params)).strategies;
}

/** JSON-friendly view (bigint → string) for route handlers / logging. */
export function serializeStrategy(s: ShippedStrategy) {
  return {
    strategyHash: s.strategyHash,
    maker: s.maker,
    app: s.app,
    tokens: s.tokens,
    program: s.program,
    hashMatches: s.hashMatches,
    docked: s.docked,
    active: s.active,
    blockNumber: s.blockNumber.toString(),
    transactionHash: s.transactionHash,
    logIndex: s.logIndex,
    balances: s.balances.map((b) => ({ token: b.token, balance: b.balance.toString(), tokensCount: b.tokensCount })),
    order: { maker: s.order.maker, traits: s.order.traits.toString(), data: s.order.data },
    strategy: s.strategy,
  };
}

export type SerializedStrategy = ReturnType<typeof serializeStrategy>;
