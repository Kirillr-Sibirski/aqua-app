/**
 * SCENE 4 -- refused, with both numbers.
 *
 * A taker walks up to the book wanting size. Aqua says the legs hold 29.6 WETH. The maker's wallet holds
 * nine. Somebody has to say no, and the interesting question is WHO, and WHEN, and WITH WHAT.
 *
 * Without a guard the answer is: Aqua, at the last possible moment, from inside `pull`'s `transferFrom`.
 * `ship()` checks no balance, `safeBalances()` returns the virtual number with no clamp, so the quote
 * succeeds, an aggregator routes to the depth and builds a bundle around it, and the FILL reverts. This
 * scene ships that exact leg -- the same curve bytes, the same reserves, the `Coverage` instruction
 * simply deleted -- and runs it end to end, because a claim about what a guard prevents is worth nothing
 * without the unguarded control next to it.
 *
 * With `Coverage` the answer is: the router, at quote time, naming both numbers.
 * `NotCovered(needed, free)` is not an outage, it is an answer -- `free` is exactly what to ask for
 * instead -- and the scene shows the bound is exact to one wei in both directions, and that two legs
 * which share no storage report the same figure.
 *
 * The control leg is docked before the scene ends, so the book is back to four legs for the roll.
 */
import { aquaAbi, buildAquaOrder, concat, decodeOrder, ix, swapVmAbi } from '../../../web/src/lib/swapvm/index.ts';
import { ASSIGNMENT_WINDOW_SECONDS, encodeRmmSwap, expiryFlagsFor, FLAG_RISKY_IS_TOKEN_A, type RmmArgs } from '../../../web/src/components/curve/rmm.ts';
import { explainProgram } from '../../../web/src/components/curve/program.ts';
import { EPS_WAD, WAD, ceilDiv } from '../../arb/rmm.ts';
import { publicClient, walletFor } from '../../fork/lib.ts';
import { coverageOf, encodeStrategy, orderHash, quoteAt, readReserves, restoreOrder, takerDataFor } from '../book.ts';
import type { Ctx } from '../context.ts';
import {
  balanceOf,
  check,
  expectRevert,
  forkNow,
  kv,
  note,
  out,
  printReceipt,
  scene,
  step,
  usdc,
  weth,
  type StoredLeg,
} from '../lib.ts';

interface Advertised {
  leg: StoredLeg;
  /** `Aqua.safeBalances` -- the virtual number, never clamped to the wallet. */
  rawRisky: bigint;
  rawStable: bigint;
  /** The most the curve itself would price out: one guard band below the reserve. */
  curveMax: bigint;
}

export async function run(ctx: Ctx, argv: string[]): Promise<void> {
  const legs = ctx.state.legs.filter((l) => !l.docked);
  if (legs.length === 0) throw new Error('nothing is shipped -- run `make story-1` first');
  const skipControl = argv.includes('--no-control');

  scene(
    '4',
    'Refused, with both numbers',
    'The book advertises more WETH than the wallet holds. Coverage says no at quote time, and says how much instead.',
  );

  // ---- what the book advertises ----
  const rows: Advertised[] = [];
  for (const leg of legs) {
    const reserves = await readReserves(leg, ctx.pair, { aqua: ctx.d.aqua, router: ctx.d.router });
    const eps = ceilDiv(BigInt(leg.liquidityWad) * EPS_WAD, WAD);
    rows.push({
      leg,
      rawRisky: reserves.rawRisky,
      rawStable: reserves.rawStable,
      curveMax: (reserves.xWad - eps) / ctx.pair.rateRisky,
    });
  }
  const free = await coverageOf(ctx.d.router, ctx.state.maker, ctx.d.weth);
  const wallet = await balanceOf(ctx.d.weth, ctx.state.maker);

  step('what Aqua says the book holds');
  for (const r of rows) out(`    ${r.leg.label.padEnd(19)} ${weth(r.rawRisky).padStart(16)}   safeBalances(), with no clamp to any wallet`);
  const advertised = rows.reduce((a, r) => a + r.rawRisky, 0n);
  kv([
    ['advertised', `${weth(advertised)} across ${rows.length} legs`],
    ['maker wallet', weth(wallet)],
    ['coverage()', `${weth(free)} -- balanceOf and allowance(maker, Aqua), whichever is smaller`],
    ['gap', `${weth(advertised - free)} of depth no single wallet can deliver`],
  ]);

  // ---- the headline refusal ----
  const subject = rows.reduce((a, b) => (b.curveMax > a.curveMax ? b : a));
  if (subject.curveMax <= free) {
    throw new Error(
      'no leg currently advertises more than the wallet can deliver -- run `make story-2` first, so the ' +
        'shared balance has actually moved.',
    );
  }
  const order = restoreOrder(subject.leg.order);
  const takerData = takerDataFor({ taker: ctx.taker.address, tokenIn: ctx.d.usdc, tokenA: subject.leg.tokenA, isExactIn: false });
  const ask = (raw: bigint) => quoteAt(ctx.d.router, order, raw, takerData, ctx.taker.address);

  step(`a taker asks ${subject.leg.label} for everything it advertises`);
  out(`  exact-out ${weth(subject.curveMax)} from a leg whose Aqua balance is ${weth(subject.rawRisky)}`);
  const refused = await expectRevert('  the quote', () => ask(subject.curveMax));
  check(refused.name === 'NotCovered', 'the router refuses at QUOTE time, with a named error');
  check(refused.args[0] === subject.curveMax, `needed == ${weth(subject.curveMax)}, the amount that was asked for`);
  check(refused.args[1] === free, `free == ${weth(free)} == coverage(maker, WETH)`);
  out('  Both numbers are in the error, and the second one is the answer: it is what to ask for instead.');

  // ---- the bound is exact ----
  step('and the bound is exact');
  const ok = await ask(free);
  out(`  ok   ${weth(free)} out  ->  ${usdc(ok.amountIn)} in. Sized straight off the error, filled first time.`);
  const overByOne = await expectRevert(`  ${weth(free)} + 1 wei`, () => ask(free + 1n));
  check(
    overByOne.name === 'NotCovered' && overByOne.args[0] === free + 1n,
    'one wei more is refused: this is a solvency bound, not a heuristic',
  );

  // ---- the same bound, from a different leg ----
  const other = rows.find((r) => r.leg.hash !== subject.leg.hash && r.curveMax > free);
  if (other) {
    step('the same number, asked of a different leg');
    const otherData = takerDataFor({ taker: ctx.taker.address, tokenIn: ctx.d.usdc, tokenA: other.leg.tokenA, isExactIn: false });
    const otherRefusal = await expectRevert(`  ${other.leg.label} asked for ${weth(other.curveMax)}`, () =>
      quoteAt(ctx.d.router, restoreOrder(other.leg.order), other.curveMax, otherData, ctx.taker.address),
    );
    check(otherRefusal.args[1] === free, `a different leg, a different strike, the same free figure: ${weth(free)}`);
    out("  Two legs that share no storage and never call each other agree on the maker's balance, because");
    out('  they are both reading it inside the call that prices the trade.');
  }

  // ---- the control: the same leg with the guard removed ----
  if (!skipControl) await control(ctx, subject, free);

  const now = await forkNow();
  note(ctx.state, '4', now.timestamp, `refused ${weth(subject.curveMax)} on ${subject.leg.label} with NotCovered(needed, free=${weth(free)})`);
}

/**
 * Ship the same leg with `Coverage` deleted, and show what Aqua does on its own.
 *
 * Identical maker, identical router, identical curve, identical reserves; five bytes fewer. The quote
 * succeeds at a size the maker cannot pay, and the swap reverts inside `Aqua.pull`'s `transferFrom` --
 * after an aggregator has already been told the liquidity is there.
 */
async function control(ctx: Ctx, subject: Advertised, free: bigint): Promise<void> {
  step('the control: the same leg, with the guard deleted');
  const leg = subject.leg;
  const args: RmmArgs = {
    flags: (ctx.pair.riskyIsTokenA ? FLAG_RISKY_IS_TOKEN_A : 0) | expiryFlagsFor(leg.kind),
    sigmaWad: BigInt(leg.sigmaWad),
    maturity: leg.maturity,
    strikeWad: BigInt(leg.strikeWad),
    liquidityWad: BigInt(leg.liquidityWad),
    rateRisky: ctx.pair.rateRisky,
    rateStable: ctx.pair.rateStable,
  };
  // `Deadline . RmmSwap . Salt` -- the shipped program minus the five bytes of `Coverage`.
  //
  // The salt carries the current block height because `dock` writes `tokensCount = 0xff` permanently and
  // `ship` requires it to be 0: a docked strategy hash can never be re-shipped. Without this, running the
  // scene twice inside one anvil session would revert on `StrategiesMustBeImmutable`, which is a confusing
  // way to fail on camera. Replaying from the frozen state reproduces the same height and the same hash.
  const height = (await forkNow()).blockNumber;
  const program = concat(
    ix.deadline(leg.maturity + ASSIGNMENT_WINDOW_SECONDS),
    encodeRmmSwap(args),
    ix.salt(BigInt(leg.salt) + 900n + height),
  );
  const controlOrder = buildAquaOrder({ maker: ctx.maker.address, tokenA: ctx.pair.tokenA, tokenB: ctx.pair.tokenB, program });
  const hash = orderHash(controlOrder);

  const shippedProgram = decodeOrder(restoreOrder(leg.order)).program;
  out(`  shipped   ${explainProgram(shippedProgram).map((i) => i.name).join(' . ')}   ${(shippedProgram.length - 2) / 2} bytes`);
  out(`  control   ${explainProgram(program).map((i) => i.name).join(' . ')}${' '.repeat(11)}   ${(program.length - 2) / 2} bytes`);
  check(
    explainProgram(program).every((i) => i.opcode !== 0x93),
    'the control program carries no Coverage instruction; everything else about it is the same leg',
  );

  const maker = walletFor(ctx.maker.privateKey);
  const [amountA, amountB] = ctx.pair.riskyIsTokenA
    ? [subject.rawRisky, subject.rawStable]
    : [subject.rawStable, subject.rawRisky];
  const shipHash = await maker.writeContract({
    address: ctx.d.aqua,
    abi: aquaAbi,
    functionName: 'ship',
    args: [ctx.d.router, encodeStrategy(controlOrder), [ctx.pair.tokenA, ctx.pair.tokenB], [amountA, amountB]],
  });
  const shipped = await printReceipt(shipHash, 'ship the unguarded control leg');
  check(shipped.transferCount === 0, 'shipping it moves no tokens either: Aqua took the maker\'s word for the reserves');

  const takerData = takerDataFor({ taker: ctx.taker.address, tokenIn: ctx.d.usdc, tokenA: ctx.pair.tokenA, isExactIn: false });
  const want = subject.curveMax;
  const quote = await quoteAt(ctx.d.router, controlOrder, want, takerData, ctx.taker.address);
  out();
  out(`  the unguarded leg QUOTES ${weth(quote.amountOut)} for ${usdc(quote.amountIn)}`);
  check(quote.amountOut === want, 'no revert and no clamp: this is the depth an aggregator would route to');
  check(quote.amountOut > free, `it is ${weth(quote.amountOut - free)} more than the maker can actually deliver`);

  const takerUsdc = await balanceOf(ctx.d.usdc, ctx.taker.address);
  check(takerUsdc >= quote.amountIn, `the taker holds ${usdc(takerUsdc)} and needs ${usdc(quote.amountIn)}, so the taker's side is fine`);
  // Simulated first, because that is where the revert data is; then sent, because a demo of a failing
  // fill should show a real failing transaction rather than a failing `eth_call`.
  await expectRevert('  the same call simulated', () =>
    publicClient.simulateContract({
      address: ctx.d.router,
      abi: swapVmAbi,
      functionName: 'swap',
      args: [controlOrder, want, takerData],
      account: ctx.taker.address,
    }),
  );
  const swapHash = await walletFor(ctx.taker.privateKey).writeContract({
    address: ctx.d.router,
    abi: swapVmAbi,
    functionName: 'swap',
    args: [controlOrder, want, takerData],
    gas: 2_000_000n,
  });
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  out(`  and sent: block ${swapReceipt.blockNumber}  status ${swapReceipt.status}  gas burnt ${swapReceipt.gasUsed}  tx ${swapHash}`);
  check(swapReceipt.status === 'reverted', 'the transaction reverted on chain, from inside Aqua.pull\'s transferFrom');
  check(swapReceipt.logs.length === 0, 'and it emitted nothing at all: no Pulled, no Pushed, no Swapped');
  out('  The quote said yes and the fill said no, after the router had already published the depth. That is');
  out('  the failure Coverage moves forward into the quote, where a caller can still do something about it.');

  const dockHash = await maker.writeContract({
    address: ctx.d.aqua,
    abi: aquaAbi,
    functionName: 'dock',
    args: [ctx.d.router, hash, [ctx.pair.tokenA, ctx.pair.tokenB]],
  });
  const docked = await printReceipt(dockHash, 'dock the control leg, so the book is four legs again');
  check(docked.counts.Docked === 1 && docked.transferCount === 0, 'Docked x1, zero ERC-20 Transfer logs');
}
