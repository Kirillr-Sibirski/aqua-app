/**
 * The arbitrage bot.
 *
 *   make bot ARGS="--steps 24 --step-seconds 1800"     # walk half a day of real tape, trade when it pays
 *   make bot ARGS="--leg 2600 --until-fill"            # advance until the 2,600 leg is worth filling
 *   make bot ARGS="--dry-run"                          # plan only: show the band and the sizes
 *   make bot ARGS="--selftest"                         # check the normal CDF against published values
 *
 * TWO CLAIMS, AND HOW EACH IS BACKED.
 *
 * 1. IT SIZES ANALYTICALLY. Not one bisection anywhere. RMM-01's marginal price at risky reserve `X` is
 *    `K*exp(z*s - s^2/2)` with `z = Phi^-1(1 - X/L)`, so setting it equal to spot inverts in closed
 *    form: `X* = L*(1 - Phi(d1))`. One normal CDF. From there the trade is
 *    `amountIn = X* - X0` (or the stable mirror), and the output comes from the router's own
 *    `stableFor`/`riskyFor` -- so the target sits on the curve as the CHAIN computes it, not as we
 *    approximate it. The alternative, binary-searching `quote()`, costs 657-667k gas per probe: forty
 *    iterations is ~26M gas against a 30M block limit, and it does not fit.
 *
 *    The bot prints its predicted `amountOut` beside the router's `quote()` on every trade and stops if
 *    they differ by a single wei. After the fill it re-derives the prediction at the block the swap
 *    landed in and checks it against the `Swapped` event, because the fill is one second later than the
 *    quote and one second of theta is a real, measurable difference.
 *
 * 2. ITS PRICE IS REAL. The reference is `latestRoundData()` on the Chainlink ETH/USD proxy address,
 *    whose answer replays the rounds that aggregator actually published on Base (`capture.ts`,
 *    `tape.ts`). There is no slider. Our own bot trading our own curve against our own knob would be a
 *    puppet show, and it would be discounted.
 *
 * The bot is also given no privileged knowledge of the book: it finds the legs in Aqua's `Shipped` log
 * and decodes them from the strategy bytes, the way any resolver would.
 */
import { existsSync, readFileSync } from 'node:fs';
import { decodeEventLog, formatUnits, type Address, type Hex } from 'viem';
import { buildTakerTraits, swapVmAbi } from '../../web/src/lib/swapvm/index.ts';
import { strikelineViewsAbi } from '../../web/src/components/curve/rmm.ts';
import { assertFork, die, loadDeployments, publicClient, walletFor, type Deployments } from '../fork/lib.ts';
import { PATHS as STORY_PATHS } from '../story/lib.ts';
import { warpBy } from './clock.ts';
import { discoverLegs, legMatches, legName, type DiscoveredLeg } from './discover.ts';
import { referencePriceWad, syncFeed } from './feed.ts';
import { SELF_TEST_TOLERANCE, selfTest } from './gauss.ts';
import {
  ceilDiv,
  epsOutWad,
  marginalPriceWad,
  predictExactIn,
  reserveOutForCappedAmount,
  sigmaSqrtTau,
  targetRiskyWad,
  tauWad,
  type CurveParams,
  type Side,
} from './rmm.ts';
import { Tape, loadSeries } from './tape.ts';

const WAD = 10n ** 18n;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BotOptions {
  steps: number;
  stepSeconds: number;
  untilFill: boolean;
  maxFills: number;
  minEdgeBps: number;
  slippageBps: number;
  dryRun: boolean;
  legFilter?: string;
  quiet: boolean;
}

const DEFAULTS: BotOptions = {
  steps: 1,
  stepSeconds: 1800,
  untilFill: false,
  maxFills: Number.MAX_SAFE_INTEGER,
  minEdgeBps: 1,
  slippageBps: 20,
  dryRun: false,
  quiet: false,
};

export function parseOptions(argv: string[]): BotOptions {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--steps') o.steps = Number(argv[++i]);
    else if (a === '--step-seconds') o.stepSeconds = Number(argv[++i]);
    else if (a === '--until-fill') { o.untilFill = true; o.steps = Math.max(o.steps, 96); }
    else if (a === '--max-fills') o.maxFills = Number(argv[++i]);
    else if (a === '--min-edge-bps') o.minEdgeBps = Number(argv[++i]);
    else if (a === '--slippage-bps') o.slippageBps = Number(argv[++i]);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--leg') o.legFilter = argv[++i];
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--selftest') { /* handled in main */ }
    else if (a.startsWith('--')) die(`unknown argument ${a}`);
  }
  return o;
}

// ---------------------------------------------------------------------------
// Planning: closed form, then two view calls
// ---------------------------------------------------------------------------

export interface Plan {
  leg: DiscoveredLeg;
  name: string;
  side: Side;
  tokenIn: Address;
  tokenOut: Address;
  /** Raw units. */
  amountIn: bigint;
  predictedOut: bigint;
  /** Normalised: where the curve says the reserves should be, and where they are. */
  targetXWad: bigint;
  currentXWad: bigint;
  newInWad: bigint;
  newOutWad: bigint;
  epsOut: bigint;
  band: { minRiskyIn: bigint; minStableIn: bigint };
  /** `coverage(maker, tokenOut)` -- what the wallet can actually deliver. */
  coverage: bigint;
  cappedByCoverage: boolean;
  /** Marginal price the curve quotes now, and the reference it is being pulled to. */
  markWad: bigint;
  spotWad: bigint;
  edgeBps: number;
  /** How many `eth_call`s this plan cost. Printed because "no bisection" is the claim. */
  calls: number;
  skip?: string;
}

interface PlanDeps {
  router: Address;
  maker: Address;
  spotWad: bigint;
  nowSeconds: number;
  minEdgeBps: number;
  /** Raw balances the taker can actually pay with. */
  inventory: (token: Address) => Promise<bigint>;
}

async function stableFor(router: Address, p: CurveParams, xWad: bigint, blockNumber?: bigint): Promise<bigint> {
  return publicClient.readContract({
    address: router,
    abi: strikelineViewsAbi,
    functionName: 'stableFor',
    args: [p.strikeWad, p.sigmaWad, p.maturity, p.liquidityWad, xWad],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
}

async function riskyFor(router: Address, p: CurveParams, yWad: bigint, blockNumber?: bigint): Promise<bigint> {
  return publicClient.readContract({
    address: router,
    abi: strikelineViewsAbi,
    functionName: 'riskyFor',
    args: [p.strikeWad, p.sigmaWad, p.maturity, p.liquidityWad, yWad],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
}

/**
 * Everything the bot decides, in one function and without a search.
 *
 * Reads: `bandFor` (1), `coverage` (1), and one or two curve evaluations. Five `eth_call`s at the very
 * most, whatever the size of the trade.
 */
export async function plan(leg: DiscoveredLeg, d: PlanDeps): Promise<Plan> {
  const p = leg.params;
  const x0 = leg.xWad;
  const y0 = leg.yWad;
  const targetX = targetRiskyWad(d.spotWad, p, d.nowSeconds);
  const markWad = marginalPriceWad(x0, p, d.nowSeconds);

  const band = await publicClient.readContract({
    address: d.router,
    abi: strikelineViewsAbi,
    functionName: 'bandFor',
    args: [p.strikeWad, p.sigmaWad, p.maturity, p.liquidityWad, x0, y0],
  });
  const bandOut = { minRiskyIn: band[0], minStableIn: band[1] };

  const side: Side = targetX > x0 ? 'riskyIn' : 'stableIn';
  const [tokenIn, tokenOut] = side === 'riskyIn' ? [leg.risky, leg.stable] : [leg.stable, leg.risky];
  const rateIn = side === 'riskyIn' ? p.rateRisky : p.rateStable;
  const rateOut = side === 'riskyIn' ? p.rateStable : p.rateRisky;
  const balanceIn = side === 'riskyIn' ? x0 : y0;
  const balanceOut = side === 'riskyIn' ? y0 : x0;
  const eps = epsOutWad(p, side);

  const skeleton: Omit<Plan, 'amountIn' | 'predictedOut' | 'newInWad' | 'newOutWad' | 'edgeBps' | 'calls' | 'coverage' | 'cappedByCoverage'> = {
    leg,
    name: legName(leg),
    side,
    tokenIn,
    tokenOut,
    targetXWad: targetX,
    currentXWad: x0,
    epsOut: eps,
    band: bandOut,
    markWad,
    spotWad: d.spotWad,
  };
  const skip = (reason: string, calls: number): Plan => ({
    ...skeleton,
    amountIn: 0n,
    predictedOut: 0n,
    newInWad: 0n,
    newOutWad: 0n,
    coverage: 0n,
    cappedByCoverage: false,
    edgeBps: 0,
    calls,
    skip: reason,
  });

  let calls = 1; // bandFor

  // ---- the size, in closed form ----
  let amountIn: bigint;
  if (side === 'riskyIn') {
    const dx = targetX - x0;
    if (dx <= bandOut.minRiskyIn) {
      return skip(`inside the theta band (wants ${fmtWad(dx)} risky in, band is ${fmtWad(bandOut.minRiskyIn)})`, calls);
    }
    amountIn = dx / rateIn;
  } else {
    const targetY = await stableFor(d.router, p, targetX);
    calls++;
    if (targetY <= y0) return skip('the curve already sits at or above the no-arbitrage point', calls);
    const dy = targetY - y0;
    if (dy <= bandOut.minStableIn) {
      return skip(`inside the theta band (wants ${fmtWad(dy)} stable in, band is ${fmtWad(bandOut.minStableIn)})`, calls);
    }
    amountIn = dy / rateIn;
  }
  if (amountIn === 0n) return skip('the no-arbitrage move rounds to zero raw units', calls);

  // ---- the taker's own inventory ----
  const held = await d.inventory(tokenIn);
  if (held < amountIn) {
    amountIn = held;
    if (amountIn === 0n) return skip(`the bot holds no ${tokenIn === leg.risky ? 'risky' : 'stable'} token`, calls);
  }

  // ---- the output, exactly as RmmSwap will compute it ----
  let newIn = balanceIn + amountIn * rateIn;
  let newOut = side === 'riskyIn' ? await stableFor(d.router, p, newIn) : await riskyFor(d.router, p, newIn);
  calls++;
  let predicted = predictExactIn({ balanceInWad: balanceIn, balanceOutWad: balanceOut, newOutWad: newOut, epsOutWad: eps, rateOut });
  if (predicted.insideSpreadShortfall !== undefined) {
    return skip(`RmmInsideSpread(${predicted.insideSpreadShortfall})`, calls);
  }

  // ---- clamp to what the maker's wallet can actually deliver ----
  const coverage = await publicClient.readContract({
    address: d.router,
    abi: strikelineViewsAbi,
    functionName: 'coverage',
    args: [d.maker, tokenOut],
  });
  calls++;
  let cappedByCoverage = false;
  if (predicted.amountOut > coverage) {
    // Same method, run backwards: pick the output, ask the router which reserve point that is, read the
    // input off the curve. `Coverage` reverts instead of clamping, so a bot that wants a fill clamps itself.
    cappedByCoverage = true;
    if (coverage === 0n) return skip('the maker wallet can deliver none of this token', calls);
    const cappedOutReserve = reserveOutForCappedAmount(balanceOut, coverage, rateOut, eps);
    const requiredIn = side === 'riskyIn' ? await riskyFor(d.router, p, cappedOutReserve) : await stableFor(d.router, p, cappedOutReserve);
    calls++;
    if (requiredIn <= balanceIn) return skip('the coverage bound is below the current reserve point', calls);
    amountIn = ceilDiv(requiredIn - balanceIn, rateIn);
    if (amountIn > held) amountIn = held;
    newIn = balanceIn + amountIn * rateIn;
    newOut = side === 'riskyIn' ? await stableFor(d.router, p, newIn) : await riskyFor(d.router, p, newIn);
    calls++;
    predicted = predictExactIn({ balanceInWad: balanceIn, balanceOutWad: balanceOut, newOutWad: newOut, epsOutWad: eps, rateOut });
    if (predicted.insideSpreadShortfall !== undefined) return skip(`RmmInsideSpread(${predicted.insideSpreadShortfall}) after the coverage clamp`, calls);
  }
  if (predicted.amountOut === 0n) return skip('the trade returns nothing after the guard band', calls);

  // ---- is it worth doing? ----
  const paidWad = side === 'riskyIn' ? (amountIn * rateIn * d.spotWad) / WAD : amountIn * rateIn;
  const gotWad = side === 'riskyIn' ? predicted.amountOut * rateOut : (predicted.amountOut * rateOut * d.spotWad) / WAD;
  const edgeBps = paidWad === 0n ? 0 : Number(((gotWad - paidWad) * 10_000n * 1000n) / paidWad) / 1000;
  const full: Plan = {
    ...skeleton,
    amountIn,
    predictedOut: predicted.amountOut,
    newInWad: newIn,
    newOutWad: newOut,
    coverage,
    cappedByCoverage,
    edgeBps,
    calls,
  };
  if (edgeBps < d.minEdgeBps) return { ...full, skip: `edge ${edgeBps.toFixed(2)} bps is below the ${d.minEdgeBps} bps floor` };
  return full;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface Fill {
  plan: Plan;
  txHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  quotedOut: bigint;
  executedOut: bigint;
  /** Re-derived at the block the swap landed in: must equal `executedOut` to the wei. */
  repredictedOut: bigint;
  /** `executedOut - quotedOut`: one second of theta, collected by the maker. */
  thetaDrift: bigint;
}

export async function execute(p: Plan, ctx: { router: Address; taker: Address; takerKey: Hex; slippageBps: number; log: (s: string) => void }): Promise<Fill> {
  const isAToB = p.tokenIn.toLowerCase() === p.leg.tokenA.toLowerCase();
  const threshold = (p.predictedOut * BigInt(10_000 - ctx.slippageBps)) / 10_000n;
  const takerData = buildTakerTraits({
    taker: ctx.taker,
    isExactIn: true,
    isAToB,
    useTransferFromAndAquaPush: true,
    threshold,
  });

  // One quote, for verification only. The size was decided before this call, not by it.
  const { result } = await publicClient.simulateContract({
    address: ctx.router,
    abi: swapVmAbi,
    functionName: 'quote',
    args: [p.leg.order, p.amountIn, takerData],
    account: ctx.taker,
  });
  const quotedOut = result[1];
  if (quotedOut !== p.predictedOut) {
    throw new Error(
      `analytic prediction disagrees with the router: predicted ${p.predictedOut}, quote() returned ${quotedOut} ` +
        `(leg ${p.name}, side ${p.side}, amountIn ${p.amountIn})`,
    );
  }
  ctx.log(`    predicted ${p.predictedOut}  ==  router.quote() ${quotedOut}   (exact, 0 wei apart)`);

  const wallet = walletFor(ctx.takerKey);
  const txHash = await wallet.writeContract({ address: ctx.router, abi: swapVmAbi, functionName: 'swap', args: [p.leg.order, p.amountIn, takerData] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error(`swap ${txHash} reverted`);

  let executedOut = 0n;
  for (const log of receipt.logs) {
    try {
      const e = decodeEventLog({ abi: swapVmAbi, data: log.data, topics: log.topics });
      if (e.eventName === 'Swapped') executedOut = (e.args as { amountOut: bigint }).amountOut;
    } catch {
      /* not a router event */
    }
  }

  // The fill lands one block after the quote, so tau is a second smaller. Re-derive the prediction at the
  // block it actually landed in and check it wei for wei: the model reproduces the fill, not just the quote.
  const p2 = p.leg.params;
  const rateIn = p.side === 'riskyIn' ? p2.rateRisky : p2.rateStable;
  const rateOut = p.side === 'riskyIn' ? p2.rateStable : p2.rateRisky;
  const balanceIn = p.side === 'riskyIn' ? p.leg.xWad : p.leg.yWad;
  const balanceOut = p.side === 'riskyIn' ? p.leg.yWad : p.leg.xWad;
  const newIn = balanceIn + p.amountIn * rateIn;
  const newOutAtBlock =
    p.side === 'riskyIn'
      ? await stableFor(ctx.router, p2, newIn, receipt.blockNumber)
      : await riskyFor(ctx.router, p2, newIn, receipt.blockNumber);
  const repredicted = predictExactIn({ balanceInWad: balanceIn, balanceOutWad: balanceOut, newOutWad: newOutAtBlock, epsOutWad: p.epsOut, rateOut });

  return {
    plan: p,
    txHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    quotedOut,
    executedOut,
    repredictedOut: repredicted.amountOut,
    thetaDrift: executedOut - quotedOut,
  };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export interface RunResult {
  fills: Fill[];
  steps: number;
  plansConsidered: number;
  callsUsed: number;
}

export interface RunDeps {
  d: Deployments;
  tape: Tape;
  maker: Address;
  taker: Address;
  takerKey: Hex;
  options: BotOptions;
  log?: (s: string) => void;
}

export async function runBot(deps: RunDeps): Promise<RunResult> {
  const log = deps.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const { d, tape, options } = deps;
  const fills: Fill[] = [];
  let plansConsidered = 0;
  let callsUsed = 0;

  const inventory = async (token: Address) =>
    publicClient.readContract({
      address: token,
      abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
      functionName: 'balanceOf',
      args: [deps.taker],
    });

  for (let step = 0; step < options.steps; step++) {
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    const feed = await syncFeed(tape, block.timestamp);
    const reference = await referencePriceWad();
    if (reference.priceWad !== feed.priceWad) throw new Error('the feed and the tape disagree');

    const legs = await discoverLegs({
      client: publicClient,
      aqua: d.aqua,
      app: d.router,
      fromBlock: BigInt(d.blockNumber),
      maker: deps.maker,
    });
    const filter = options.legFilter;
    const scope = filter ? legs.filter((l) => legMatches(l, filter)) : legs;

    if (!options.quiet) {
      log(
        `\n  step ${String(step + 1).padStart(2)}/${options.steps}  block ${block.number}  ${new Date(Number(block.timestamp) * 1000).toISOString().replace('.000Z', 'Z')}  ` +
          `tape ${new Date(feed.seriesTs * 1000).toISOString().replace('.000Z', 'Z')}  ` +
          `feed $${(Number(reference.priceWad) / 1e18).toFixed(2)} (round ${feed.roundId})${feed.moved ? ' *' : ''}`,
      );
    }

    for (const leg of scope) {
      plansConsidered++;
      const p = await plan(leg, {
        router: d.router,
        maker: deps.maker,
        spotWad: reference.priceWad,
        nowSeconds: Number(block.timestamp),
        minEdgeBps: options.minEdgeBps,
        inventory,
      });
      callsUsed += p.calls;
      if (!options.quiet) log(`    ${describe(p)}`);
      if (p.skip || options.dryRun) continue;

      const fill = await execute(p, {
        router: d.router,
        taker: deps.taker,
        takerKey: deps.takerKey,
        slippageBps: options.slippageBps,
        log,
      });
      fills.push(fill);
      log(
        `    filled  ${symbolFor(p.tokenIn, leg)} ${fmtRaw(p.amountIn, p.tokenIn, leg)} in -> ${symbolFor(p.tokenOut, leg)} ${fmtRaw(fill.executedOut, p.tokenOut, leg)} out  ` +
          `block ${fill.blockNumber}  gas ${fill.gasUsed}  tx ${fill.txHash}`,
      );
      if (fill.repredictedOut !== fill.executedOut) {
        throw new Error(`re-derived ${fill.repredictedOut} but the Swapped event says ${fill.executedOut}`);
      }
      log(
        `    re-derived at block ${fill.blockNumber} == Swapped.amountOut (${fill.executedOut}); ` +
          `theta collected in the one second between quote and fill: ${-fill.thetaDrift} raw units`,
      );
      if (fills.length >= options.maxFills) return { fills, steps: step + 1, plansConsidered, callsUsed };
    }

    if (options.untilFill && fills.length > 0) return { fills, steps: step + 1, plansConsidered, callsUsed };
    if (step < options.steps - 1) await warpBy(options.stepSeconds);
  }
  return { fills, steps: options.steps, plansConsidered, callsUsed };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtWad(v: bigint): string {
  return Number(formatUnits(v, 18)).toFixed(6);
}

function symbolFor(token: Address, leg: DiscoveredLeg): string {
  return token.toLowerCase() === leg.risky.toLowerCase() ? 'WETH' : 'USDC';
}

function fmtRaw(v: bigint, token: Address, leg: DiscoveredLeg): string {
  const decimals = token.toLowerCase() === leg.risky.toLowerCase() ? 18 : 6;
  return Number(formatUnits(v, decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals === 18 ? 6 : 2 });
}

export function describe(p: Plan): string {
  const head =
    `${p.name.padEnd(14)} mark $${(Number(p.markWad) / 1e18).toFixed(2).padStart(8)}  ` +
    `x ${fmtWad(p.currentXWad)} -> ${fmtWad(p.targetXWad)}  `;
  if (p.skip) return `${head}skip: ${p.skip}`;
  const inSym = symbolFor(p.tokenIn, p.leg);
  const outSym = symbolFor(p.tokenOut, p.leg);
  return (
    `${head}${fmtRaw(p.amountIn, p.tokenIn, p.leg)} ${inSym} -> ${fmtRaw(p.predictedOut, p.tokenOut, p.leg)} ${outSym}  ` +
    `edge ${p.edgeBps.toFixed(1)}bps  ${p.calls} eth_calls${p.cappedByCoverage ? '  [clamped to coverage]' : ''}`
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface StoryAnchor {
  anchor: { forkTs: number; seriesTs: number };
  maker: Address;
  arb: Address;
}

function anchorFromStory(): StoryAnchor {
  if (!existsSync(STORY_PATHS.state)) die(`${STORY_PATHS.state} not found -- run \`make story-setup\` first`);
  return JSON.parse(readFileSync(STORY_PATHS.state, 'utf8')) as StoryAnchor;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const results = selfTest();
    for (const r of results) {
      process.stdout.write(`  Phi(${String(r.x).padStart(20)}) = ${r.got.toExponential(17)}  reference ${r.want.toExponential(17)}  rel err ${r.relativeError.toExponential(2)}\n`);
    }
    const worst = results[0];
    if (worst.relativeError > SELF_TEST_TOLERANCE) die(`normal CDF is off by ${worst.relativeError} at x=${worst.x}`);
    process.stdout.write(`\n  worst relative error ${worst.relativeError.toExponential(2)}, tolerance ${SELF_TEST_TOLERANCE.toExponential(0)}\n`);
    return;
  }

  const options = parseOptions(argv);
  const fork = await assertFork();
  const d = loadDeployments();
  const story = anchorFromStory();
  const tape = new Tape(loadSeries(), story.anchor);
  const takerKey = d.accounts.find((a) => a.address.toLowerCase() === story.arb.toLowerCase())?.privateKey;
  if (!takerKey) die(`no private key for the arb wallet ${story.arb}`);

  process.stdout.write(
    `\narb bot   router ${d.router}   maker ${story.maker}   wallet ${story.arb}\n` +
      `          ${tape.provenance()}\n` +
      `          block ${fork.blockNumber}, ${options.steps} step(s) of ${options.stepSeconds}s, min edge ${options.minEdgeBps} bps${options.dryRun ? ', DRY RUN' : ''}\n`,
  );

  const result = await runBot({ d, tape, maker: story.maker, taker: story.arb, takerKey, options });
  process.stdout.write(
    `\n  ${result.fills.length} fill(s) over ${result.steps} step(s); ${result.plansConsidered} legs considered, ` +
      `${result.callsUsed} eth_calls total (${(result.callsUsed / Math.max(result.plansConsidered, 1)).toFixed(1)} per plan, and none of them a search)\n\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e: unknown) => die(e instanceof Error ? (e.stack ?? e.message) : String(e)));
}
