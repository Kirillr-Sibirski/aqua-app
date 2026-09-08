/**
 * Shared plumbing for the scripted demo: state, labels, decoded receipts, decoded reverts.
 *
 * The demo is a sequence of independent processes (`make story-1`, `make story-2`, ...) so a presenter can
 * re-run one scene without replaying the others, and so a scene that goes wrong on camera can be repeated
 * from a snapshot. Everything that has to survive between them lives in `.story-state.json`.
 *
 * Every number this file prints is read back from the chain after the fact. Nothing is echoed from the
 * arguments a scene passed in, because echoing the input is how a demo ends up showing a number the chain
 * never agreed to.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeErrorResult,
  decodeEventLog,
  formatUnits,
  getAddress,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from 'viem';
import { aquaAbi, erc20Abi as swapVmErc20Abi, swapVmAbi } from '../../web/src/lib/swapvm/index.ts';
import { ADDR, erc20Abi, loadDeployments, publicClient, short, type Deployments } from '../fork/lib.ts';

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/story

export const PATHS = {
  storyDir: HERE,
  state: resolve(HERE, '.story-state.json'),
  dumpDir: resolve(HERE, 'state'),
  dump: resolve(HERE, 'state/demo.json'),
  snapshot: resolve(HERE, 'state/snapshot.json'),
  storyStateBackup: resolve(HERE, 'state/story-state.json'),
} as const;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type LegId = 'call2600' | 'call2800' | 'call3000' | 'put2300';

export interface StoredOrder {
  maker: Address;
  /** MakerTraits, decimal string (JSON has no bigints). */
  traits: string;
  data: Hex;
}

export interface StoredLeg {
  id: LegId;
  kind: 'call' | 'put';
  label: string;
  strikeWad: string;
  liquidityWad: string;
  sigmaWad: string;
  maturity: number;
  salt: string;
  /** Normalised reserves actually shipped (after raw rounding). */
  xWad: string;
  yWad: string;
  tokenA: Address;
  tokenB: Address;
  amountA: string;
  amountB: string;
  order: StoredOrder;
  hash: Hex;
  shipTx: Hex;
  shipBlock: number;
  docked?: boolean;
}

export interface StoryState {
  version: 2;
  router: Address;
  maker: Address;
  arb: Address;
  taker: Address;
  /** Fork second <-> tape second, fixed at setup and never moved again. */
  anchor: { forkTs: number; seriesTs: number };
  /** Set by scene 1; scenes 2-5 read it. */
  maturity?: number;
  /** Spot the book was written against, WAD, from the replayed tape. */
  spotWadAtShip?: string;
  legs: StoredLeg[];
  /**
   * The last RMM fill before maturity, recorded by scene 2 so that scene 5 can put the gas of a
   * settlement fill next to the gas of a live-curve one. Both are real receipts from the same
   * instruction on the same router; the difference is the `tau == 0` branch skipping the Gaussian.
   */
  lastFill?: { scene: string; label: string; tx: Hex; gas: string; blockNumber: number; tauWad: string };
  /** Append-only log of what each scene did, so a re-run can tell the presenter where they are. */
  history: Array<{ scene: string; at: string; forkTs: number; note: string }>;
}

export function loadState(): StoryState {
  if (!existsSync(PATHS.state)) {
    throw new Error(`${PATHS.state} not found -- run \`make story-setup\` first`);
  }
  return JSON.parse(readFileSync(PATHS.state, 'utf8')) as StoryState;
}

export function saveState(state: StoryState): void {
  writeFileSync(PATHS.state, JSON.stringify(state, null, 2) + '\n');
}

export function note(state: StoryState, scene: string, forkTs: bigint | number, text: string): void {
  state.history.push({ scene, at: new Date().toISOString(), forkTs: Number(forkTs), note: text });
  saveState(state);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const labels = new Map<string, string>();

export function label(address: string, name: string): void {
  labels.set(getAddress(address as Address), name);
}

export function named(address: string): string {
  const key = getAddress(address as Address);
  const name = labels.get(key);
  return name ? `${name} (${short(key)})` : short(key);
}

/** Register the fixed cast: everything a receipt can plausibly emit from. */
export function labelDeployment(d: Deployments, state?: Pick<StoryState, 'maker' | 'arb' | 'taker' | 'router'>): void {
  label(ADDR.aqua, 'Aqua');
  label(ADDR.officialRouter, 'official router v1.0.2');
  label(d.router, 'StrikelineRouter');
  label(d.weth, 'WETH');
  label(d.usdc, 'USDC');
  label(d.chainlink.ethUsd, 'Chainlink ETH/USD');
  if (state) {
    label(state.router, 'StrikelineRouter');
    label(state.maker, 'maker');
    label(state.arb, 'arb bot');
    label(state.taker, 'taker');
  }
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const WIDTH = 96;

export function out(line = ''): void {
  process.stdout.write(line + '\n');
}

export function scene(number: string, title: string, subtitle?: string): void {
  out();
  out('='.repeat(WIDTH));
  out(`SCENE ${number}  ${title}`);
  if (subtitle) out(subtitle);
  out('='.repeat(WIDTH));
}

export function step(title: string): void {
  out();
  out(`-- ${title} ${'-'.repeat(Math.max(0, WIDTH - 4 - title.length))}`);
}

export function kv(rows: Array<[string, string]>): void {
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) out(`  ${k.padEnd(w)}  ${v}`);
}

/** Assert and print. A demo that silently shows a wrong number is worse than one that stops. */
export function check(ok: boolean, text: string): void {
  if (!ok) throw new Error(`CHECK FAILED: ${text}`);
  out(`  ok   ${text}`);
}

export function fail(message: string): never {
  process.stderr.write(`\nerror: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Amount formatting
// ---------------------------------------------------------------------------

export const WAD = 10n ** 18n;

export function amount(value: bigint, decimals: number, symbol: string, digits = 4): string {
  const s = formatUnits(value, decimals);
  const [int, frac = ''] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const kept = frac.slice(0, digits).replace(/0+$/, '');
  return `${grouped}${kept ? '.' + kept : ''} ${symbol}`;
}

export const weth = (v: bigint, digits = 6) => amount(v, 18, 'WETH', digits);
export const usdc = (v: bigint, digits = 2) => amount(v, 6, 'USDC', digits);
export const wad = (v: bigint, digits = 6) => amount(v, 18, '', digits).trim();

export function usd(priceWad: bigint): string {
  return `$${amount(priceWad, 18, '', 2).trim()}`;
}

export function signed(value: bigint, fmt: (v: bigint) => string): string {
  return value < 0n ? `-${fmt(-value)}` : `+${fmt(value)}`;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface DecodedLog {
  emitter: Address;
  name: string;
  args: Record<string, unknown>;
  isTransfer: boolean;
}

export function decodeLog(log: Log): DecodedLog {
  for (const abi of [aquaAbi, swapVmAbi, swapVmErc20Abi] as const) {
    try {
      const e = decodeEventLog({ abi, data: log.data, topics: log.topics });
      return {
        emitter: log.address,
        name: e.eventName as string,
        args: (e.args ?? {}) as Record<string, unknown>,
        isTransfer: log.topics[0] === ERC20_TRANSFER_TOPIC,
      };
    } catch {
      /* try the next abi */
    }
  }
  return {
    emitter: log.address,
    name: `unknown ${log.topics[0]?.slice(0, 10) ?? '0x'}`,
    args: {},
    isTransfer: log.topics[0] === ERC20_TRANSFER_TOPIC,
  };
}

function formatArg(key: string, value: unknown): string {
  if (typeof value === 'bigint') return `${key}=${value}`;
  if (typeof value === 'string' && value.length === 42 && value.startsWith('0x')) return `${key}=${named(value)}`;
  if (typeof value === 'string' && value.length > 26) return `${key}=${value.slice(0, 12)}..${value.slice(-6)}`;
  return `${key}=${String(value)}`;
}

export interface ReceiptSummary {
  hash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  logs: DecodedLog[];
  counts: Record<string, number>;
  transferCount: number;
}

/** Fetch, decode and print one transaction's receipt. */
export async function printReceipt(hash: Hex, title: string): Promise<ReceiptSummary> {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${title}: transaction ${hash} reverted`);
  return printReceiptOf(r, title);
}

export function printReceiptOf(r: TransactionReceipt, title: string): ReceiptSummary {
  const logs = r.logs.map(decodeLog);
  const counts: Record<string, number> = {};
  for (const l of logs) counts[l.name] = (counts[l.name] ?? 0) + 1;
  out(`  ${title}: block ${r.blockNumber}  gas ${r.gasUsed}  tx ${r.transactionHash}`);
  for (const l of logs) {
    const args = Object.entries(l.args)
      .map(([k, v]) => formatArg(k, v))
      .join(' ');
    out(`    ${named(l.emitter).padEnd(34)} ${l.name.padEnd(9)} ${args}`);
  }
  return {
    hash: r.transactionHash,
    blockNumber: r.blockNumber,
    gasUsed: r.gasUsed,
    logs,
    counts,
    transferCount: logs.filter((l) => l.isTransfer).length,
  };
}

/** Aggregate several receipts and print the event tally the scene is actually about. */
export function tally(summaries: ReceiptSummary[]): { counts: Record<string, number>; transferCount: number; gas: bigint } {
  const counts: Record<string, number> = {};
  let transferCount = 0;
  let gas = 0n;
  for (const s of summaries) {
    for (const [k, v] of Object.entries(s.counts)) counts[k] = (counts[k] ?? 0) + v;
    transferCount += s.transferCount;
    gas += s.gasUsed;
  }
  return { counts, transferCount, gas };
}

export function tallyLine(counts: Record<string, number>): string {
  const order = ['Shipped', 'Pushed', 'Pulled', 'Docked', 'Swapped', 'Transfer'];
  const keys = Object.keys(counts).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((k) => `${k} x${counts[k]}`).join('   ') || '(no events)';
}

// ---------------------------------------------------------------------------
// Reverts
// ---------------------------------------------------------------------------

/**
 * The custom errors a Strikeline leg can refuse with. These are the demo's punchlines -- "the quote
 * refuses rather than lying, and the error carries both numbers" -- so they are decoded by name and
 * arguments, never printed as a raw selector.
 */
export const strikelineErrorsAbi = [
  { type: 'error', name: 'NotCovered', inputs: [{ name: 'needed', type: 'uint256' }, { name: 'free', type: 'uint256' }] },
  { type: 'error', name: 'RmmInsideSpread', inputs: [{ name: 'shortfall', type: 'uint256' }] },
  {
    type: 'error',
    name: 'RmmExceedsReserve',
    inputs: [{ name: 'requested', type: 'uint256' }, { name: 'available', type: 'uint256' }],
  },
  { type: 'error', name: 'RmmSettlementOneWay', inputs: [] },
  { type: 'error', name: 'RmmOutOfDomain', inputs: [] },
  { type: 'error', name: 'DeadlineReached', inputs: [{ name: 'deadline', type: 'uint256' }] },
  {
    type: 'error',
    name: 'TakerTraitsInsufficientMinOutputAmount',
    inputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }],
  },
  {
    type: 'error',
    name: 'SafeBalancesForTokenNotInActiveStrategy',
    inputs: [
      { name: 'maker', type: 'address' },
      { name: 'app', type: 'address' },
      { name: 'strategyHash', type: 'bytes32' },
      { name: 'token', type: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'StrategiesMustBeImmutable',
    inputs: [{ name: 'app', type: 'address' }, { name: 'strategyHash', type: 'bytes32' }],
  },
  { type: 'error', name: 'TxOriginTokenBalanceIsZero', inputs: [{ name: 'txOrigin', type: 'address' }, { name: 'token', type: 'address' }] },
  { type: 'error', name: 'UnknownOpcode', inputs: [{ name: 'opcode', type: 'uint256' }] },
  // @1inch/solidity-utils SafeERC20, which is what `Aqua.pull` transfers through. This is the error an
  // over-allocated book fails with WITHOUT `Coverage`: not at quote time and not with a number, but from
  // inside the settlement transfer, after the depth has already been published. Scene 4 ships that leg
  // deliberately, so the selector has to have a name here.
  { type: 'error', name: 'SafeTransferFromFailed', inputs: [] },
  { type: 'error', name: 'SafeTransferFailed', inputs: [] },
] as const;

export interface DecodedRevert {
  name: string;
  args: readonly unknown[];
  /** `NotCovered(needed=6000000000000000000, free=5400000000000000000)`. */
  pretty: string;
  raw?: Hex;
}

function revertData(error: unknown): Hex | undefined {
  // viem nests the raw revert bytes; walk the chain rather than pattern-matching one shape.
  let e: unknown = error;
  for (let i = 0; i < 8 && e && typeof e === 'object'; i++) {
    const o = e as { data?: unknown; cause?: unknown; raw?: unknown };
    if (typeof o.data === 'string' && o.data.startsWith('0x') && o.data.length >= 10) return o.data as Hex;
    if (o.data && typeof o.data === 'object' && 'data' in (o.data as object)) {
      const inner = (o.data as { data?: unknown }).data;
      if (typeof inner === 'string' && inner.startsWith('0x')) return inner as Hex;
    }
    if (typeof o.raw === 'string' && o.raw.startsWith('0x')) return o.raw as Hex;
    e = o.cause;
  }
  return undefined;
}

/** Decode a revert into its custom error name and arguments, or say plainly that we could not. */
export function decodeRevert(error: unknown): DecodedRevert {
  const data = revertData(error);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: strikelineErrorsAbi, data });
      const args = (decoded.args ?? []) as readonly unknown[];
      const names = strikelineErrorsAbi.find((e) => e.name === decoded.errorName)?.inputs ?? [];
      const pretty = `${decoded.errorName}(${args
        .map((a, i) => `${names[i]?.name ?? i}=${typeof a === 'string' ? a : String(a)}`)
        .join(', ')})`;
      return { name: decoded.errorName as string, args, pretty, raw: data };
    } catch {
      return { name: 'unknown', args: [], pretty: `undecodable revert ${data.slice(0, 10)}`, raw: data };
    }
  }
  const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
  return { name: 'unknown', args: [], pretty: message };
}

/** Run `fn`, require it to revert, and print the decoded error. */
export async function expectRevert(what: string, fn: () => Promise<unknown>): Promise<DecodedRevert> {
  try {
    const value = await fn();
    throw new Error(`CHECK FAILED: ${what} was expected to revert but returned ${JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('CHECK FAILED')) throw e;
    const decoded = decodeRevert(e);
    out(`  ok   ${what} reverted: ${decoded.pretty}`);
    return decoded;
  }
}

// ---------------------------------------------------------------------------
// Chain reads used by more than one scene
// ---------------------------------------------------------------------------

export async function balanceOf(token: Address, who: Address): Promise<bigint> {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who] });
}

export async function forkNow(): Promise<{ blockNumber: bigint; timestamp: bigint }> {
  const b = await publicClient.getBlock({ blockTag: 'latest' });
  return { blockNumber: b.number, timestamp: b.timestamp };
}

export function deployments(): Deployments {
  return loadDeployments();
}

export const iso = (ts: bigint | number) => new Date(Number(ts) * 1000).toISOString().replace('.000Z', 'Z');
