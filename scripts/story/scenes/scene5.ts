/**
 * SCENE 5 -- expiry, and the settlement that is not a settlement.
 *
 * At `tau = 0` the trading function
 *
 *     Y = L*K*Phi( Phi^-1(1 - X/L) - sigma*sqrt(tau) )
 *
 * degenerates, in closed form, to
 *
 *     Y = K*(L - X)
 *
 * a constant-sum order selling the remaining risky asset at exactly `K`. The Gaussian is not
 * approximated at expiry, it is GONE: `RmmSwap.stableOf` takes an `s == 0` branch and never calls
 * `Gaussian.cdf` at all. So there is no oracle, no keeper, no settlement contract, no option token and no
 * exercise transaction. Assignment is an ordinary swap, performed by whoever wants it.
 *
 * Three things are proved here, and the third is the one that pays for the flag bits:
 *
 *   1. The curve really is `K*(L - X)`. `stableFor` is compared with the closed form at five reserve
 *      points, to the wei, and `riskyFor` is checked as its exact inverse.
 *
 *   2. The MARGINAL price is exactly `K`. Two assignments are executed. The first pays `K` per unit plus
 *      the entire decay that no arbitrageur ever collected, in one lump, because the reserves sat inside
 *      the curve. The second pays `K` and nothing else -- to the cent -- because the first one re-opened
 *      it. That is the toll and the strike, separated on camera.
 *
 *   3. It only runs ONE WAY. An expired leg that traded in both directions would be a free at-the-money
 *      straddle written to the world. `FLAG_POST_EXPIRY_ONE_WAY` gates it: a call is assigned by a taker
 *      BUYING the risky asset, a put by a taker SELLING it, and the wrong direction reverts
 *      `RmmSettlementOneWay()` on both. Same 62 bytes, mirrored by one flag bit.
 *
 * And the window is not open forever: past `maturity + 30 minutes` the `Deadline` instruction refuses
 * everything, so an expired leg is not a limit order left on the books until someone remembers it.
 */
import { warpTo } from '../../arb/clock.ts';
import { syncFeed } from '../../arb/feed.ts';
import { EPS_WAD, WAD, ceilDiv } from '../../arb/rmm.ts';
import { publicClient, walletFor } from '../../fork/lib.ts';
import { swapVmAbi } from '../../../web/src/lib/swapvm/index.ts';
import { ASSIGNMENT_WINDOW_SECONDS } from '../../../web/src/components/curve/rmm.ts';
import { coverageOf, curveParamsOf, quoteAt, readReserves, restoreOrder, riskyFor, stableFor, takerDataFor, tauNow } from '../book.ts';
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
  printReceipt,
  scene,
  step,
  usd,
  usdc,
  wad,
  weth,
  type StoredLeg,
} from '../lib.ts';

/** The two assignments. Different sizes on purpose: the marginal price has to be `K` for both. */
const FIRST_ASSIGNMENT = 1_500_000_000_000_000_000n; // 1.5 WETH
const SECOND_ASSIGNMENT = 1_000_000_000_000_000_000n; // 1.0 WETH

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

export async function run(ctx: Ctx, argv: string[]): Promise<void> {
  const legs = ctx.state.legs.filter((l) => !l.docked);
  if (legs.length === 0) throw new Error('nothing is shipped -- run `make story-1` first');
  const maturity = ctx.state.maturity ?? legs[0].maturity;
  const skipDeadline = argv.includes('--no-deadline');

  scene(
    '5',
    'Expiry: a constant-sum order at the strike, and it only runs one way',
    'No oracle, no keeper, no settlement contract, no option token. The same 62 bytes that priced the option settle it.',
  );

  // ---- past maturity ----
  const startTau = await tauNow(ctx.d.router, maturity);
  step(`the clock crosses ${iso(maturity)}`);
  const move = await warpTo(maturity + 60);
  const block = await publicClient.getBlock({ blockNumber: move.blockNumber });
  const feed = await syncFeed(ctx.tape, move.after);
  kv([
    ['warped', `${iso(move.before)} -> ${iso(move.after)}, ${((move.seconds / 86_400)).toFixed(2)} days, in block ${move.blockNumber}`],
    ['transactions', `${block.transactions.length}`],
    ['tauNow(maturity)', `${amount(startTau, 18, '', 9)} -> ${amount(await tauNow(ctx.d.router, maturity), 18, '', 9)} years`],
    ['spot', `${usd(feed.priceWad)} on the replayed tape (${iso(feed.seriesTs)})`],
  ]);
  check(block.transactions.length === 0, 'the block that crossed maturity contains zero transactions');
  check((await tauNow(ctx.d.router, maturity)) === 0n, 'tau is exactly zero, so the curve is on its settlement branch');

  // ---- the closed form ----
  const subject = legs.find((l) => l.kind === 'call' && l.label.includes('2,600')) ?? legs[0];
  const p = curveOf(ctx, subject);
  const K = p.strikeWad;
  const L = p.liquidityWad;
  step(`the trading function of ${subject.label}, at tau = 0`);
  out('  Y = L*K*Phi( Phi^-1(1 - X/L) - sigma*sqrt(tau) )   collapses to   Y = K*(L - X)');
  out();
  out(`    ${'X (WETH)'.padStart(14)} ${'stableFor(X)'.padStart(20)} ${'K*(L-X)'.padStart(20)}   equal`);
  for (const numerator of [0n, 1n, 2n, 3n, 4n]) {
    const x = (L * numerator) / 4n;
    const onChain = await stableFor(ctx.d.router, p, x);
    const closedForm = ceilDiv(K * (L - x), WAD);
    out(
      `    ${amount(x, 18, '', 6).padStart(14)} ${amount(onChain, 18, '', 6).padStart(20)} ` +
        `${amount(closedForm, 18, '', 6).padStart(20)}   ${onChain === closedForm ? 'yes' : 'NO'}`,
    );
    check(onChain === closedForm, `stableFor(${wad(x, 2)}) == K*(L-X) to the wei`);
  }
  const yMid = await stableFor(ctx.d.router, p, L / 2n);
  check((await riskyFor(ctx.d.router, p, yMid)) === L / 2n, 'riskyFor is its exact inverse at the midpoint');
  out('  The Gaussian is not approximated here. RmmSwap.stableOf takes an `s == 0` branch and never calls it.');

  // ---- one way only ----
  step('one way only');
  const put = legs.find((l) => l.kind === 'put');
  const wrongWayCall = takerDataFor({ taker: ctx.taker.address, tokenIn: ctx.d.weth, tokenA: subject.tokenA, isExactIn: true });
  await expectRevert(
    `  selling WETH into the expired call ${subject.label}`,
    () => quoteAt(ctx.d.router, restoreOrder(subject.order), 10n ** 17n, wrongWayCall, ctx.taker.address),
  );
  if (put) {
    const wrongWayPut = takerDataFor({ taker: ctx.taker.address, tokenIn: ctx.d.usdc, tokenA: put.tokenA, isExactIn: true });
    const putRefusal = await expectRevert(
      `  buying WETH out of the expired put ${put.label}`,
      () => quoteAt(ctx.d.router, restoreOrder(put.order), 1_000_000_000n, wrongWayPut, ctx.taker.address),
    );
    check(putRefusal.name === 'RmmSettlementOneWay', 'the put refuses the mirror direction, from the same instruction and one flag bit');
  }
  out('  A call is assigned by a taker BUYING the risky asset; a put by a taker SELLING it. The other');
  out('  direction would be a free at-the-money straddle written to the world at expiry.');

  // ---- the toll that is sitting in front of the strike ----
  const reserves = await readReserves(subject, ctx.pair, { aqua: ctx.d.aqua, router: ctx.d.router });
  const onCurve = ceilDiv(K * (L - reserves.xWad), WAD);
  const toll = onCurve > reserves.yWad ? onCurve - reserves.yWad : 0n;
  step('what is sitting in front of the strike');
  kv([
    ['reserves', `${weth(reserves.rawRisky)} / ${usdc(reserves.rawStable)}`],
    ['K*(L-X)', `${amount(onCurve, 18, 'USDC', 2)} -- where the settlement curve says the stable side should be`],
    ['gap', `${amount(toll, 18, 'USDC', 2)} of decay that no arbitrageur ever collected on this leg`],
  ]);
  out('  In a liquid market that would have been taken in pieces, one arbitrage at a time. Here nobody');
  out('  traded this leg after scene 2, so it is still one lump -- and whoever assigns pays it.');

  // ---- assignment, twice ----
  const order = restoreOrder(subject.order);
  const takerData = takerDataFor({ taker: ctx.taker.address, tokenIn: ctx.d.usdc, tokenA: subject.tokenA, isExactIn: false });
  const free = await coverageOf(ctx.d.router, ctx.state.maker, ctx.d.weth);
  const eps = ceilDiv(BigInt(subject.liquidityWad) * EPS_WAD, WAD);
  const ceiling = (reserves.xWad - eps) / ctx.pair.rateRisky;
  const first = min(FIRST_ASSIGNMENT, free, ceiling);
  const second = min(SECOND_ASSIGNMENT, free - first, ceiling - first);

  step('assignment, executed');
  const before = { weth: await balanceOf(ctx.d.weth, ctx.state.maker), usdc: await balanceOf(ctx.d.usdc, ctx.state.maker) };
  const a1 = await assign(ctx, order, takerData, first, 'the first assignment re-opens the curve');
  const a2 = await assign(ctx, order, takerData, second, 'the second one is priced at the strike and nothing else');
  const after = { weth: await balanceOf(ctx.d.weth, ctx.state.maker), usdc: await balanceOf(ctx.d.usdc, ctx.state.maker) };

  const price = (paid: bigint, got: bigint) => (Number(paid) / 1e6 / (Number(got) / 1e18));
  out();
  kv([
    ['first', `${weth(a1.out)} for ${usdc(a1.in)}  =  $${price(a1.in, a1.out).toFixed(6)} / WETH`],
    ['  of which', `$${(Number(K) / 1e18).toFixed(2)} strike + ${amount(toll, 18, 'USDC', 2)} of uncollected decay`],
    ['second', `${weth(a2.out)} for ${usdc(a2.in)}  =  $${price(a2.in, a2.out).toFixed(6)} / WETH`],
    ['  of which', `$${(Number(K) / 1e18).toFixed(2)} strike, and nothing else`],
  ]);
  const expectedSecond = ceilDiv((K * a2.out) / WAD, ctx.pair.rateStable);
  check(
    a2.in - expectedSecond <= 1n,
    `the second assignment paid K exactly: ${usdc(a2.in)} against K*${weth(a2.out)} = ${usdc(expectedSecond)}`,
  );
  // Taking the toll back out of the first trade leaves K plus the guard band: `RmmSwap` holds back
  // `epsOut = L*EPS` of the outgoing reserve on every trade, in the maker's favour, and on a 1.5 WETH
  // assignment that is a few cents spread over the size.
  const marginal = ((a1.in - toll / ctx.pair.rateStable) * WAD) / a1.out;
  const guard = ceilDiv((K * eps) / WAD, ctx.pair.rateStable);
  out(
    `  ok   take the toll back out of the first trade and it prices at $${(Number(marginal) / 1e6).toFixed(4)} against a strike of ` +
      `$${(Number(K) / 1e18).toFixed(2)} -- the difference is the ${amount(eps, 18, 'WETH', 8)} guard band, ${usdc(guard, 6)} at this strike`,
  );

  kv([
    ['maker before', `${weth(before.weth)} / ${usdc(before.usdc)}`],
    ['maker after', `${weth(after.weth)} / ${usdc(after.usdc)}`],
    ['called away', `${weth(before.weth - after.weth)} at the strike, paid for with ${usdc(after.usdc - before.usdc)}`],
  ]);

  // ---- gas: the settlement branch skips the Gaussian ----
  const priorFill = ctx.state.lastFill;
  if (priorFill) {
    step('what the settlement branch costs');
    kv([
      ['live curve', `${priorFill.gas} gas   ${priorFill.label}, block ${priorFill.blockNumber}, tau ${amount(BigInt(priorFill.tauWad), 18, '', 9)} years`],
      ['tau = 0', `${a2.gas} gas   ${subject.label}, block ${a2.blockNumber}`],
      ['difference', `${BigInt(priorFill.gas) - a2.gas} gas -- the settlement branch never evaluates Phi or Phi inverse`],
    ]);
    check(a2.gas < BigInt(priorFill.gas), 'settling is cheaper than trading the live curve, because the transcendental is gone');
  }

  // ---- and the window closes ----
  if (!skipDeadline) {
    step('the assignment window is thirty minutes, not forever');
    const closes = maturity + ASSIGNMENT_WINDOW_SECONDS;
    await warpTo(closes + 1);
    const refusal = await expectRevert(`  the same call at ${iso(closes + 1)}`, () =>
      quoteAt(ctx.d.router, order, 10n ** 17n, takerData, ctx.taker.address),
    );
    check(refusal.name === 'DeadlineReached', 'past the window the Deadline instruction refuses everything: an expired leg is not a standing free option');
  }

  const now = await forkNow();
  note(
    ctx.state,
    '5',
    now.timestamp,
    `settled at tau=0: ${weth(a1.out + a2.out)} assigned at K=${amount(K, 18, '', 0)}, toll ${amount(toll, 18, 'USDC', 2)}`,
  );
}

async function assign(
  ctx: Ctx,
  order: ReturnType<typeof restoreOrder>,
  takerData: `0x${string}`,
  amountOut: bigint,
  title: string,
): Promise<{ in: bigint; out: bigint; gas: bigint; blockNumber: bigint }> {
  if (amountOut <= 0n) throw new Error(`${title}: nothing left to assign`);
  const quote = await quoteAt(ctx.d.router, order, amountOut, takerData, ctx.taker.address);
  out();
  out(`  ${title}: ${weth(amountOut)} out, quoted at ${usdc(quote.amountIn)} in`);
  const hash = await walletFor(ctx.taker.privateKey).writeContract({
    address: ctx.d.router,
    abi: swapVmAbi,
    functionName: 'swap',
    args: [order, amountOut, takerData],
  });
  const receipt = await printReceipt(hash, '  assignment');
  const swapped = receipt.logs.find((l) => l.name === 'Swapped');
  const paid = swapped?.args.amountIn as bigint;
  const got = swapped?.args.amountOut as bigint;
  check(got === amountOut, `the taker received exactly the ${weth(amountOut)} they asked for`);
  return { in: paid, out: got, gas: receipt.gasUsed, blockNumber: receipt.blockNumber };
}

function min(...values: bigint[]): bigint {
  return values.reduce((a, b) => (a < b ? a : b));
}
