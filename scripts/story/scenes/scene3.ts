/**
 * SCENE 3 -- three days pass, and the premium is already collected.
 *
 * Nothing happens in this scene. That is the scene.
 *
 * The clock moves three days and not one transaction is sent: no maker signature, no keeper, no oracle
 * update, no re-quote. Aqua's ledger for every leg is byte-identical before and after, and so is the
 * maker's wallet. The only thing that changed is `block.timestamp`.
 *
 * And yet every leg now refuses trades it would have taken. With `L` fixed and the invariant offset at
 * zero, the reserves sit exactly ON the curve, so when `tau` shrinks the curve moves AWAY from them --
 * in both directions at once. A trade only clears once it is large enough to close that gap, and
 * whoever closes it pays the accrued decay to get there.
 *
 *     THETA IS THE SPREAD. The decay gap is a toll the arbitrageur pays to re-open the curve,
 *     and that toll is the premium.
 *
 * `StrikelineViews.bandFor` publishes both sides of the gap, which is what lets a UI shade it and a
 * solver size around it instead of probing with reverting calls. This scene reads it before and after,
 * then proves the published number is the real threshold with three quotes: one far inside the band,
 * one a single raw unit below it, and one at it.
 *
 * The price feed is advanced to the tape round in force at the new time, by writing storage rather than
 * by sending a transaction -- this repo cannot mint a real Chainlink round. It is worth saying out loud
 * that this changes nothing about the band: `RmmSwap` reads K, sigma, T, L and the block clock, and no
 * oracle appears anywhere in the pricing path. The feed exists so the arbitrageur knows what the world
 * price is.
 */
import { warpTo } from '../../arb/clock.ts';
import { syncFeed } from '../../arb/feed.ts';
import { EPS_WAD, WAD, ceilDiv } from '../../arb/rmm.ts';
import { publicClient } from '../../fork/lib.ts';
import { bandFor, curveParamsOf, quoteAt, readReserves, restoreOrder, stableFor, takerDataFor, tauNow } from '../book.ts';
import type { Ctx } from '../context.ts';
import {
  amount,
  balanceOf,
  check,
  expectRevert,
  forkNow,
  iso,
  kv,
  note,
  out,
  scene,
  step,
  usd,
  usdc,
  wad,
  weth,
  type StoredLeg,
} from '../lib.ts';

const DAY = 86_400;

/** Everything about one leg that time alone can move. */
interface Reading {
  leg: StoredLeg;
  tauWad: bigint;
  minRiskyIn: bigint;
  minStableIn: bigint;
  /** Raw reserves, so "the ledger did not move" is a comparison and not a claim. */
  rawRisky: bigint;
  rawStable: bigint;
}

function curveOf(ctx: Ctx, leg: StoredLeg) {
  return curveParamsOf({
    strikeWad: BigInt(leg.strikeWad),
    sigmaWad: BigInt(leg.sigmaWad),
    maturity: leg.maturity,
    liquidityWad: BigInt(leg.liquidityWad),
    rateRisky: ctx.pair.rateRisky,
    rateStable: ctx.pair.rateStable,
  });
}

async function readLeg(ctx: Ctx, leg: StoredLeg, blockNumber: bigint): Promise<Reading> {
  const p = curveOf(ctx, leg);
  const reserves = await readReserves(leg, ctx.pair, { aqua: ctx.d.aqua, router: ctx.d.router, blockNumber });
  const band = await bandFor(ctx.d.router, p, reserves.xWad, reserves.yWad, blockNumber);
  return {
    leg,
    tauWad: await tauNow(ctx.d.router, leg.maturity, blockNumber),
    minRiskyIn: band.minRiskyIn,
    minStableIn: band.minStableIn,
    rawRisky: reserves.rawRisky,
    rawStable: reserves.rawStable,
  };
}

function bandTable(rows: Reading[]): void {
  out(`    ${'leg'.padEnd(19)} ${'tau (years)'.padStart(12)} ${'sell WETH: min in'.padStart(20)} ${'buy WETH: min in'.padStart(20)}`);
  for (const r of rows) {
    out(
      `    ${r.leg.label.padEnd(19)} ${wad(r.tauWad).padStart(12)} ` +
        `${amount(r.minRiskyIn, 18, 'WETH', 6).padStart(20)} ${amount(r.minStableIn, 18, 'USDC', 2).padStart(20)}`,
    );
  }
}

export async function run(ctx: Ctx, argv: string[]): Promise<void> {
  const legs = ctx.state.legs.filter((l) => !l.docked);
  if (legs.length === 0) throw new Error('nothing is shipped -- run `make story-1` first');
  const days = Number(argv[argv.indexOf('--days') + 1]) || 3;

  scene(
    '3',
    `${days} days pass, and nobody sends a transaction`,
    'Time decay moves the curve away from the reserves in both directions. The gap is the premium, and the router publishes it.',
  );

  const start = await forkNow();
  const before: Reading[] = [];
  for (const leg of legs) before.push(await readLeg(ctx, leg, start.blockNumber));
  const walletBefore = {
    weth: await balanceOf(ctx.d.weth, ctx.state.maker),
    usdc: await balanceOf(ctx.d.usdc, ctx.state.maker),
  };

  step(`the book at block ${start.blockNumber}, ${iso(start.timestamp)}`);
  bandTable(before);
  out();
  out('  The band is the smallest trade that clears in each direction. Right now it is close to nothing,');
  out('  because these reserves were placed on the curve only hours ago.');

  // ---- the warp ----
  step(`${days} days`);
  const target = Number(start.timestamp) + days * DAY;
  const move = await warpTo(target);
  const block = await publicClient.getBlock({ blockNumber: move.blockNumber });
  kv([
    ['method', 'evm_setNextBlockTimestamp + evm_mine -- one block, mined empty'],
    ['clock', `${move.before} -> ${move.after}  (${iso(move.before)} -> ${iso(move.after)})`],
    ['block', `${move.blockNumber}, ${block.transactions.length} transactions`],
  ]);
  check(block.transactions.length === 0, 'the block that moved the clock contains zero transactions');

  const after: Reading[] = [];
  for (const leg of legs) after.push(await readLeg(ctx, leg, move.blockNumber));
  for (const [i, a] of after.entries()) {
    check(
      a.rawRisky === before[i].rawRisky && a.rawStable === before[i].rawStable,
      `${a.leg.label}: Aqua's ledger is unchanged (${weth(a.rawRisky)} / ${usdc(a.rawStable)})`,
    );
  }
  const walletAfter = {
    weth: await balanceOf(ctx.d.weth, ctx.state.maker),
    usdc: await balanceOf(ctx.d.usdc, ctx.state.maker),
  };
  check(
    walletAfter.weth === walletBefore.weth && walletAfter.usdc === walletBefore.usdc,
    `the maker's wallet is unchanged (${weth(walletAfter.weth)} / ${usdc(walletAfter.usdc)})`,
  );

  // The feed is only the arbitrageur's view of the world; nothing in the pricing path reads it.
  const feed = await syncFeed(ctx.tape, move.after);
  kv([
    ['tape', `${iso(feed.seriesTs)} = ${usd(feed.priceWad)}, Chainlink round ${feed.roundId}`],
    ['feed', `${feed.feed} now reports ${feed.onChainAnswer} (read back from the chain)`],
    ['note', 'written as storage, not as a transaction. RmmSwap never reads it: the curve is K, sigma, T, L and block.timestamp.'],
  ]);

  // ---- the band, three days later ----
  step('the same four legs, same reserves, same block clock arithmetic');
  bandTable(after);
  out();
  let tollUsdc = 0n;
  let tollWeth = 0n;
  for (const [i, a] of after.entries()) {
    const b = before[i];
    tollUsdc += a.minStableIn;
    tollWeth += a.minRiskyIn;
    out(
      `    ${a.leg.label.padEnd(19)} tau ${wad(b.tauWad)} -> ${wad(a.tauWad)}   ` +
        `buy-side toll ${amount(b.minStableIn, 18, 'USDC', 2)} -> ${amount(a.minStableIn, 18, 'USDC', 2)}`,
    );
  }
  check(
    after.every((a, i) => a.minStableIn > before[i].minStableIn || a.minRiskyIn > before[i].minRiskyIn),
    'every leg opened a wider band than it had before, with no transaction on any of them',
  );
  kv([
    ['accrued, buy side', `${amount(tollUsdc, 18, 'USDC', 2)} across the book`],
    ['accrued, sell side', `${amount(tollWeth, 18, 'WETH', 6)} across the book`],
    ['paid by', 'whichever arbitrageur wants the curve re-opened. The maker signed nothing.'],
  ]);

  // ---- the proof ----
  const subject = after.find((a) => a.minStableIn > 0n) ?? after[0];
  const p = curveOf(ctx, subject.leg);
  const reserves = await readReserves(subject.leg, ctx.pair, { aqua: ctx.d.aqua, router: ctx.d.router });
  step(`the toll, on ${subject.leg.label}`);
  out('  A taker paying USDC to buy WETH out of this leg. The published band says what it costs to get in.');
  out();

  // `bandFor` reports the gap to the curve; `RmmSwap` additionally holds back its guard band, so the true
  // threshold is `stableOf(x - epsOut) - y`. One view call, no search.
  const epsOut = ceilDiv(BigInt(subject.leg.liquidityWad) * EPS_WAD, WAD);
  const yNeeded = await stableFor(ctx.d.router, p, reserves.xWad - epsOut);
  const thresholdRaw = ceilDiv(yNeeded - reserves.yWad, ctx.pair.rateStable);
  const order = restoreOrder(subject.leg.order);
  const takerData = takerDataFor({ taker: ctx.taker.address, tokenIn: ctx.d.usdc, tokenA: subject.leg.tokenA, isExactIn: true });
  const quote = (raw: bigint) => quoteAt(ctx.d.router, order, raw, takerData, ctx.taker.address);

  const tiny = 40_000_000n; // 40 USDC
  await expectRevert(`  ${usdc(tiny)} in`, () => quote(tiny));
  await expectRevert(`  ${usdc(thresholdRaw - 1n, 6)} in, one raw unit below the threshold`, () => quote(thresholdRaw - 1n));
  const atThreshold = await quote(thresholdRaw);
  out(`  ok   ${usdc(thresholdRaw, 6)} in clears, and buys ${weth(atThreshold.amountOut, 18)} -- the whole trade is the toll`);
  check(atThreshold.amountOut < 10n ** 12n, 'at the threshold the taker receives dust: they paid exactly the accrued decay');
  const above = thresholdRaw + 4_000_000_000n; // + 4,000 USDC
  const priced = await quote(above);
  out(`  ok   ${usdc(above)} in buys ${weth(priced.amountOut)} -- past the toll the curve prices normally`);
  kv([
    ['published band', `${amount(subject.minStableIn, 18, 'USDC', 6)} (bandFor)`],
    ['measured threshold', `${usdc(thresholdRaw)} (stableFor at the guard band, confirmed by the two quotes above)`],
    ['difference', `${amount(epsOut, 18, 'WETH', 8)} of guard band, which bandFor deliberately excludes`],
  ]);

  const now = await forkNow();
  note(ctx.state, '3', now.timestamp, `warped ${days} days with no transaction; buy-side toll now ${amount(tollUsdc, 18, 'USDC', 2)} across the book`);
}
