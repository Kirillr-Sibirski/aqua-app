/**
 * SCENE 2 -- one fill, four legs tighten.
 *
 * This is the scene the whole project exists for. An arbitrage bot fills ONE leg of the book, and in the
 * SAME BLOCK the other three legs -- which nobody touched, which share no storage, which never hear about
 * it -- can deliver less than they could a block earlier. No keeper ran. No message was passed. The only
 * thing that happened is that the maker's wallet got smaller, and every leg reads that wallet inside the
 * call that prices the trade.
 *
 * The measurement is deliberately made twice, in two different ways, because "depth dropped" is easy to
 * assert and easy to fake:
 *
 *   1. THE NUMBERS. For each leg, what Aqua advertises (`safeBalances`, which never clamps to the wallet)
 *      next to what `Coverage` will actually deliver, read at the block before the fill and at the block
 *      of the fill. Two legs flip from "bound by its own reserve" to "bound by the wallet".
 *
 *   2. THE PROOF. One `quote()` per sibling, for a size chosen to sit between the two bounds, sent twice
 *      at the same node: once pinned at block N-1 and once at block N. The first returns a price. The
 *      second reverts `NotCovered(needed, free)`. Same call, same leg, one block apart, and no transaction
 *      in that block went anywhere near it.
 *
 * The bot is `scripts/arb/bot.ts` and it is not a puppet: its reference price is a replayed real Chainlink
 * ETH/USD series from Base, it sizes in closed form off the router's own views, and it refuses to send a
 * swap whose output it cannot predict to the wei.
 */
import { runBot, type Fill } from '../../arb/bot.ts';
import { legName } from '../../arb/discover.ts';
import { EPS_WAD, WAD, ceilDiv } from '../../arb/rmm.ts';
import { coverageOf, quoteAt, readReserves, restoreOrder, takerDataFor, tauNow } from '../book.ts';
import type { Ctx } from '../context.ts';
import {
  check,
  decodeRevert,
  forkNow,
  iso,
  kv,
  note,
  out,
  printReceipt,
  scene,
  step,
  usd,
  usdc,
  weth,
  type StoredLeg,
} from '../lib.ts';

/** Which leg the bot is pointed at. The 2,600 call is the closest to the money, so it moves first. */
const TARGET_LEG = '2600';

interface Depth {
  leg: StoredLeg;
  /** What `Aqua.safeBalances` reports the leg holds -- the number with no clamp to the wallet. */
  advertisedRisky: bigint;
  /** The largest exact-out the curve itself would price: `balanceOut - epsOut`. */
  curveMax: bigint;
  /** `coverage(maker, WETH)` at this block: shared by every leg in the book. */
  coverage: bigint;
  /** What the leg can actually deliver = min(curve, wallet). */
  deliverable: bigint;
  boundByWallet: boolean;
}

/** Read one leg's deliverable WETH depth at a given block. */
async function depthAt(ctx: Ctx, leg: StoredLeg, blockNumber: bigint, coverage: bigint): Promise<Depth> {
  const reserves = await readReserves(leg, ctx.pair, { aqua: ctx.d.aqua, router: ctx.d.router, blockNumber });
  // `RmmSwap` exact-out reverts `RmmExceedsReserve` once `amountOut*rateOut + epsOut > balanceOut`, so the
  // curve's own ceiling is one guard band below the reserve. On the risky side `epsOut = L * EPS`.
  const eps = ceilDiv(BigInt(leg.liquidityWad) * EPS_WAD, WAD);
  const curveMax = reserves.xWad > eps ? (reserves.xWad - eps) / ctx.pair.rateRisky : 0n;
  const deliverable = curveMax < coverage ? curveMax : coverage;
  return {
    leg,
    advertisedRisky: reserves.rawRisky,
    curveMax,
    coverage,
    deliverable,
    boundByWallet: coverage < curveMax,
  };
}

function depthTable(rows: Depth[], title: string): void {
  out(`  ${title}`);
  out(`    ${'leg'.padEnd(19)} ${'Aqua advertises'.padStart(16)} ${'curve ceiling'.padStart(16)} ${'deliverable'.padStart(16)}   bound by`);
  for (const d of rows) {
    out(
      `    ${d.leg.label.padEnd(19)} ${weth(d.advertisedRisky, 6).padStart(16)} ${weth(d.curveMax, 6).padStart(16)} ` +
        `${weth(d.deliverable, 6).padStart(16)}   ${d.boundByWallet ? 'THE WALLET' : 'its own reserve'}`,
    );
  }
}

export async function run(ctx: Ctx, argv: string[]): Promise<void> {
  if (ctx.state.legs.length === 0) throw new Error('nothing is shipped -- run `make story-1` first');
  const stepSeconds = numberArg(argv, '--step-seconds', 1800);
  const minEdgeBps = numberArg(argv, '--min-edge-bps', 20);
  const maxSteps = numberArg(argv, '--max-steps', 96);

  const legs = ctx.state.legs.filter((l) => !l.docked);
  const target = legs.find((l) => l.label.replace(/[^0-9]/g, '').includes(TARGET_LEG));
  if (!target) throw new Error(`no ${TARGET_LEG} leg on the books`);

  scene(
    '2',
    'One fill, four legs tighten',
    'An arbitrage bot fills one leg. In the same block the other three can deliver less, with no keeper and no shared storage.',
  );

  // ---- what the book claims before anyone trades ----
  const before = await forkNow();
  const coverageBefore = await coverageOf(ctx.d.router, ctx.state.maker, ctx.d.weth, before.blockNumber);
  const depthsBefore: Depth[] = [];
  for (const leg of legs) depthsBefore.push(await depthAt(ctx, leg, before.blockNumber, coverageBefore));

  step(`the book at block ${before.blockNumber}, before anyone trades`);
  depthTable(depthsBefore, 'what each leg says it holds, and what the wallet says it can hand over');
  const advertisedTotal = depthsBefore.reduce((a, d) => a + d.advertisedRisky, 0n);
  kv([
    ['advertised', `${weth(advertisedTotal)} across ${depthsBefore.length} legs`],
    ['deliverable', `${weth(coverageBefore)} -- one wallet, shared by all of them`],
    ['over-allocated', `${(Number(advertisedTotal) / Number(coverageBefore)).toFixed(2)}x`],
  ]);
  if (depthsBefore.some((d) => d.boundByWallet)) {
    throw new Error(
      'a leg is already capped by the wallet, so this scene has run before on this fork state. ' +
        'Retake it: `make story-load && make story-1`, then `make story-2`.',
    );
  }
  check(
    depthsBefore.every((d) => !d.boundByWallet),
    'every leg is bound by its OWN reserve right now: the wallet is not yet the constraint on any of them',
  );

  // ---- the bot ----
  step('the arbitrage bot, pointed at the 2,600 leg');
  out('  It reads the leg out of Aqua\'s Shipped log, prices against a replayed real Base ETH/USD tape,');
  out('  and sizes in closed form. Watch the eth_call count: no size is ever found by search.');
  out();
  const result = await runBot({
    d: ctx.d,
    tape: ctx.tape,
    maker: ctx.state.maker,
    taker: ctx.arb.address,
    takerKey: ctx.arb.privateKey,
    options: {
      steps: maxSteps,
      stepSeconds,
      untilFill: true,
      maxFills: 1,
      minEdgeBps,
      slippageBps: 20,
      dryRun: false,
      legFilter: TARGET_LEG,
      quiet: false,
    },
    log: (s) => out(s),
  });
  if (result.fills.length !== 1) {
    throw new Error(
      `the bot found no fill in ${result.steps} steps of ${stepSeconds}s -- the tape did not move far enough. ` +
        `Retry with --max-steps ${maxSteps * 2} or a lower --min-edge-bps.`,
    );
  }
  const fill: Fill = result.fills[0];
  check(fill.plan.side === 'stableIn', 'the bot is buying the risky asset out of the leg, so WETH leaves the shared wallet');
  check(
    result.callsUsed / Math.max(result.plansConsidered, 1) < 6,
    `${(result.callsUsed / result.plansConsidered).toFixed(1)} eth_calls per plan on average -- a bisection would be forty`,
  );

  step('the fill');
  const receipt = await printReceipt(fill.txHash, `${legName(fill.plan.leg)} swap`);
  check(receipt.counts.Swapped === 1, 'one Swapped');
  check(receipt.counts.Pulled === 1 && receipt.counts.Pushed === 1, 'Aqua Pulled the WETH out of the maker and Pushed the USDC in');
  check(
    receipt.transferCount === 3,
    'three ERC-20 Transfers -- WETH straight from the maker to the taker, USDC through the router because the ' +
      'taker asked for transferFrom + Aqua.push. Scene 1 had zero of these; this is the block where tokens move.',
  );

  // ---- the same block, from four different legs ----
  const at = fill.blockNumber;
  const priorCoverage = await coverageOf(ctx.d.router, ctx.state.maker, ctx.d.weth, at - 1n);
  const coverageAfter = await coverageOf(ctx.d.router, ctx.state.maker, ctx.d.weth, at);
  const depthsAfter: Depth[] = [];
  for (const leg of legs) depthsAfter.push(await depthAt(ctx, leg, at, coverageAfter));

  step(`the same wallet, read from four legs, at block ${at}`);
  kv([
    ['coverage(maker, WETH)', `block ${at - 1n}: ${weth(priorCoverage)}   ->   block ${at}: ${weth(coverageAfter)}`],
    ['difference', `${weth(priorCoverage - coverageAfter)} -- exactly the fill`],
  ]);
  check(priorCoverage - coverageAfter === fill.executedOut, 'the drop in shared coverage equals the amount that left, to the wei');
  out();
  depthTable(depthsAfter, `the same four legs, one block later`);
  out();
  for (const [i, after] of depthsAfter.entries()) {
    const b = depthsBefore[i];
    const touched = after.leg.hash === target.hash;
    const delta = b.deliverable - after.deliverable;
    out(
      `    ${after.leg.label.padEnd(19)} ${weth(b.deliverable).padStart(14)} -> ${weth(after.deliverable).padStart(14)}   ` +
        `${delta > 0n ? `-${weth(delta)}` : 'unchanged'}   ${touched ? '<- the leg that traded' : after.boundByWallet ? '<- untouched, now capped by the wallet' : '<- untouched, its own reserve is still smaller'}`,
    );
  }
  const tightened = depthsAfter.filter((d, i) => d.leg.hash !== target.hash && d.deliverable < depthsBefore[i].deliverable);
  check(tightened.length > 0, `${tightened.length} sibling leg(s) can deliver less than they could one block ago, and none of them was in a transaction`);

  // ---- the proof: the same question, one block apart ----
  step('the proof: one quote, two blocks, no transaction in between');
  out('  For each untouched sibling, a size that was inside the wallet\'s reach at the earlier block and');
  out('  outside it at the later one. Same call, same leg, same node.');
  out();
  let proved = 0;
  for (const [i, after] of depthsAfter.entries()) {
    if (after.leg.hash === target.hash) continue;
    const b = depthsBefore[i];
    const ceiling = b.curveMax < priorCoverage ? b.curveMax : priorCoverage;
    if (ceiling <= after.deliverable) {
      out(`  ${after.leg.label}: no such size exists -- its own reserve (${weth(b.curveMax)}) is inside the new wallet bound. Honestly unaffected.`);
      continue;
    }
    const probe = after.deliverable + (ceiling - after.deliverable) / 2n;
    const order = restoreOrder(after.leg.order);
    const takerData = takerDataFor({
      taker: ctx.taker.address,
      tokenIn: ctx.d.usdc,
      tokenA: after.leg.tokenA,
      isExactIn: false,
    });
    out(`  ${after.leg.label}: ask for ${weth(probe)} out`);
    const okBefore = await quoteAt(ctx.d.router, order, probe, takerData, ctx.taker.address, at - 1n);
    out(`    at block ${at - 1n}  filled: ${usdc(okBefore.amountIn)} in -> ${weth(okBefore.amountOut)} out`);
    const refused = await expectRevertAt(`    at block ${at}`, () =>
      quoteAt(ctx.d.router, order, probe, takerData, ctx.taker.address, at),
    );
    check(refused.name === 'NotCovered', `${after.leg.label}: refused with NotCovered(needed, free), not with a generic failure`);
    check(refused.args[0] === probe, `needed == the ${weth(probe)} that was asked for`);
    check(refused.args[1] === coverageAfter, `free == coverage(maker, WETH) == ${weth(coverageAfter)}`);
    proved++;
  }
  check(proved > 0, 'at least one sibling refused a size it would have filled one block earlier');

  step('what just happened');
  const now = await forkNow();
  const reading = ctx.tape.at(now.timestamp);
  kv([
    ['the trade', `${usdc(fill.plan.amountIn)} -> ${weth(fill.executedOut)} on ${legName(fill.plan.leg)}, block ${fill.blockNumber}, gas ${fill.gasUsed}`],
    ['the price', `${usd(reading.priceWad)} from the replayed Base tape, round ${reading.roundId} (${iso(reading.roundTs)})`],
    ['the mechanism', `${tightened.length} untouched leg(s) tightened in block ${at}. No keeper. No shared storage. No message.`],
    ['why', 'Coverage reads balanceOf(maker) inside the same call that prices the trade, and every leg reads the same wallet.'],
  ]);
  ctx.state.lastFill = {
    scene: '2',
    label: legName(fill.plan.leg),
    tx: fill.txHash,
    gas: fill.gasUsed.toString(),
    blockNumber: Number(fill.blockNumber),
    tauWad: (await tauNow(ctx.d.router, fill.plan.leg.params.maturity, fill.blockNumber)).toString(),
  };
  note(
    ctx.state,
    '2',
    now.timestamp,
    `bot filled ${legName(fill.plan.leg)} for ${weth(fill.executedOut)}; coverage ${weth(priorCoverage)} -> ${weth(coverageAfter)}`,
  );
}

/** `expectRevert`, but printing the caller's own label instead of a sentence. */
async function expectRevertAt(label: string, fn: () => Promise<unknown>) {
  try {
    const value = await fn();
    throw new Error(`CHECK FAILED: ${label} was expected to revert but returned ${JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('CHECK FAILED')) throw e;
    const decoded = decodeRevert(e);
    out(`${label}  refused: ${decoded.pretty}`);
    return decoded;
  }
}

function numberArg(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const value = Number(argv[i + 1]);
  if (!Number.isFinite(value)) throw new Error(`${name} needs a number`);
  return value;
}
