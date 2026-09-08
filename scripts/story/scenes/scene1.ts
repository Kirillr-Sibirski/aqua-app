/**
 * SCENE 1 -- one wallet, four option legs, no tokens moved.
 *
 * The maker holds 10.4 WETH and 24,850 USDC and writes three covered calls above spot and a
 * cash-secured put below it. The calls alone commit 32 WETH of notional. Nothing is deposited, nothing
 * is wrapped, no option token is minted, and the receipt proves it: four `Shipped`, eight `Pushed`, and
 * **zero ERC-20 `Transfer` logs** in a single block.
 *
 * That is `Aqua.ship` doing exactly what it says -- it writes a virtual balance and emits the strategy
 * bytes for data availability, and it checks no balance at all. Which is also why the book needs
 * `Coverage`: without it, the depth on screen would be fiction.
 *
 * The reserves are not invented. `x` is chosen from the replayed tape price (a maker choosing moneyness),
 * and `y` is then asked of the router's own `stableFor`, because the leg has to start exactly on the
 * curve *as the chain computes it*. One wei low and every quote reverts for the life of the leg, and a
 * shipped hash can never be repaired.
 */
import type { Hex } from 'viem';
import { aquaAbi } from '../../../web/src/lib/swapvm/index.ts';
import { explainProgram } from '../../../web/src/components/curve/program.ts';
import { publicClient, rpc, walletFor } from '../../fork/lib.ts';
import { BOOK, EXPIRY_DAYS, compileBook, encodeStrategy, readReserves } from '../book.ts';
import type { Ctx } from '../context.ts';
import {
  amount,
  balanceOf,
  check,
  forkNow,
  iso,
  kv,
  note,
  out,
  printReceipt,
  saveState,
  scene,
  step,
  tally,
  tallyLine,
  usd,
  usdc,
  weth,
  type StoredLeg,
} from '../lib.ts';

export async function run(ctx: Ctx, argv: string[]): Promise<void> {
  const decodeAll = argv.includes('--decode-all');
  if (ctx.state.legs.some((l) => !l.docked)) {
    throw new Error('the book is already shipped -- `make story-load` to retake, or `make story-6` to roll it');
  }

  const now = await forkNow();
  const reading = ctx.tape.at(now.timestamp);
  const maturity = Number(now.timestamp) + EXPIRY_DAYS * 86_400;
  const generation = ctx.state.legs.length; // salts are a monotonic nonce across rolls

  scene(
    '1',
    'Write the book from one wallet',
    `Three calls above spot and a put below, all backed by the same ${weth(await balanceOf(ctx.d.weth, ctx.maker.address), 2)} and ${usdc(await balanceOf(ctx.d.usdc, ctx.maker.address))}.`,
  );

  step('the market the book is written into');
  kv([
    ['tape', ctx.tape.provenance()],
    ['now', `fork ts ${now.timestamp} (${iso(now.timestamp)}) = tape ${iso(reading.seriesTs)}`],
    ['spot', `${usd(reading.priceWad)} from Chainlink round ${reading.roundId}, published ${iso(reading.roundTs)}`],
    ['expiry', `${iso(maturity)} (${EXPIRY_DAYS} days), sigma 60% annualised, both chosen by the maker`],
  ]);

  // ---- compile ----
  step('compile four legs');
  const compiled = await compileBook({
    router: ctx.d.router,
    maker: ctx.maker.address,
    pair: ctx.pair,
    maturity,
    spotWad: reading.priceWad,
    nowSeconds: Number(now.timestamp),
    generation,
  });
  const built = compiled.map((c) => c.built);
  const rows: StoredLeg[] = compiled.map((c) => c.row);

  for (const [i, b] of built.entries()) {
    const r = rows[i];
    out(
      `  ${b.spec.label.padEnd(18)} x = ${amount(BigInt(r.xWad), 18, 'WETH', 4).padStart(14)}   ` +
        `y = ${amount(BigInt(r.yWad), 18, 'USDC', 2).padStart(14)}   ${b.hash.slice(0, 12)}..  ${(b.program.length - 2) / 2} program bytes`,
    );
  }

  step('what a leg actually is');
  const sample = decodeAll ? built : [built[0]];
  for (const b of sample) {
    out(`  ${b.spec.label}   program ${b.program}`);
    for (const ins of explainProgram(b.program)) {
      out(`    ${String(ins.offset).padStart(3)}  ${ins.name.padEnd(9)} 0x${ins.opcode.toString(16).padStart(2, '0')}  ${ins.byteLength} bytes${ins.custom ? '   <- ours' : ''}`);
      if (ins.role) out(`         ${ins.role}`);
      for (const f of ins.fields) out(`         ${f.name.padEnd(13)} ${f.value}`);
    }
  }
  check(
    explainProgram(built[0].program).filter((i) => i.custom).length === 2,
    'each leg carries both custom instructions: RmmSwap 0x55 and Coverage 0x93',
  );

  // ---- ship, all four in one block ----
  step('ship');
  const walletBefore = { weth: await balanceOf(ctx.d.weth, ctx.maker.address), usdc: await balanceOf(ctx.d.usdc, ctx.maker.address) };
  const wallet = walletFor(ctx.maker.privateKey);
  const shipArgs = rows.map(
    (r) =>
      [ctx.d.router, encodeStrategy({ maker: r.order.maker, traits: BigInt(r.order.traits), data: r.order.data }), [r.tokenA, r.tokenB], [BigInt(r.amountA), BigInt(r.amountB)]] as const,
  );
  const gas = await Promise.all(
    shipArgs.map((args) =>
      publicClient.estimateContractGas({ address: ctx.d.aqua, abi: aquaAbi, functionName: 'ship', args, account: ctx.maker.address }),
    ),
  );

  // Aqua has no multicall, so four transactions. Automine off, then one `evm_mine`, puts them in one
  // block -- which is the only way to say "in the same block" and mean it.
  const nonce = await publicClient.getTransactionCount({ address: ctx.maker.address, blockTag: 'pending' });
  await rpc('evm_setAutomine', [false]);
  let hashes: Hex[];
  try {
    hashes = [];
    for (const [i, args] of shipArgs.entries()) {
      hashes.push(
        await wallet.writeContract({ address: ctx.d.aqua, abi: aquaAbi, functionName: 'ship', args, nonce: nonce + i, gas: gas[i] }),
      );
    }
    await rpc('evm_mine', []);
  } finally {
    await rpc('evm_setAutomine', [true]);
  }

  const receipts: Awaited<ReturnType<typeof printReceipt>>[] = [];
  for (const [i, hash] of hashes.entries()) receipts.push(await printReceipt(hash, `ship ${rows[i].label}`));
  const blocks = new Set(receipts.map((r) => r.blockNumber.toString()));
  const totals = tally(receipts);

  step('the receipt');
  kv([
    ['events', tallyLine(totals.counts)],
    ['blocks', `${blocks.size} (${[...blocks].join(', ')})`],
    ['gas', `${totals.gas} for the whole book`],
  ]);
  check(totals.counts.Shipped === 4, 'Shipped x4');
  check(totals.counts.Pushed === 8, 'Pushed x8 (one per token per leg)');
  check(totals.transferCount === 0, 'ERC-20 Transfer logs: 0 -- shipping moves no tokens');
  check(blocks.size === 1, 'all four legs landed in the same block');
  const walletAfter = { weth: await balanceOf(ctx.d.weth, ctx.maker.address), usdc: await balanceOf(ctx.d.usdc, ctx.maker.address) };
  check(
    walletAfter.weth === walletBefore.weth && walletAfter.usdc === walletBefore.usdc,
    `the maker's wallet is untouched: ${weth(walletAfter.weth, 2)} / ${usdc(walletAfter.usdc)}`,
  );

  // ---- persist and verify against the registry ----
  for (const [i, r] of rows.entries()) {
    r.shipTx = receipts[i].hash;
    r.shipBlock = Number(receipts[i].blockNumber);
  }
  ctx.state.legs = rows;
  ctx.state.maturity = maturity;
  ctx.state.spotWadAtShip = reading.priceWad.toString();
  saveState(ctx.state);

  step('what Aqua now believes, and what the wallet actually holds');
  let virtualRisky = 0n;
  let virtualStable = 0n;
  for (const r of rows) {
    const res = await readReserves(r, ctx.pair, { aqua: ctx.d.aqua, router: ctx.d.router });
    check(res.rawRisky === BigInt(ctx.pair.riskyIsTokenA ? r.amountA : r.amountB), `${r.label}: Aqua ledger WETH == shipped`);
    check(res.rawStable === BigInt(ctx.pair.riskyIsTokenA ? r.amountB : r.amountA), `${r.label}: Aqua ledger USDC == shipped`);
    virtualRisky += res.xWad;
    virtualStable += res.yWad;
  }
  const notional = BOOK.filter((s) => s.kind === 'call').reduce((a, s) => a + BigInt(s.liquidity), 0n);
  kv([
    ['virtual WETH', `${amount(virtualRisky, 18, 'WETH')} across four legs`],
    ['real WETH', `${weth(walletAfter.weth, 2)} in one wallet  (${(Number(virtualRisky) / Number(walletAfter.weth)).toFixed(2)}x over-allocated)`],
    ['virtual USDC', amount(virtualStable, 18, 'USDC', 2)],
    ['real USDC', `${usdc(walletAfter.usdc)}  (${(Number(virtualStable) / 1e12 / Number(walletAfter.usdc)).toFixed(2)}x)`],
    ['call notional', `${notional} WETH written against ${weth(walletAfter.weth, 2)}`],
  ]);
  out();
  out('  Aqua allows every one of those numbers: ship() checks no balance and safeBalances() never clamps.');
  out('  Scene 2 is what turns that from phantom depth into portfolio margin.');

  note(ctx.state, '1', now.timestamp, `shipped 4 legs at spot ${usd(reading.priceWad)}, expiry ${iso(maturity)}`);
}
