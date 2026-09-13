/**
 * SCENE 6 -- roll the book, and move nothing.
 *
 * The four legs have expired. Rolling them to a new week is `dock` on the four old strategy hashes and
 * `ship` on four new ones, in a single block: **Docked x4, Shipped x4, Pushed x8, and zero ERC-20
 * `Transfer` logs**. `Aqua.dock` writes storage and emits an event; it performs no transfer and no
 * balance check. `Aqua.ship` does the same. The maker's wallet is identical to the wei before and after,
 * and the inventory was never anywhere else to begin with.
 *
 * The comparison is the point. A DOV rolls through a withdrawal window and a deposit window, with the
 * capital idle in between and a queue in front of it. A concentrated-liquidity re-range is burn, swap, mint -- three
 * transactions, real transfers, and it realises the divergence loss on the way through. Here the position
 * changes strike, vol and expiry without a token moving.
 *
 * One thing the roll cannot do is reuse a hash. `dock` writes `tokensCount = 0xff` permanently and `ship`
 * requires it to be 0, so a docked strategy is dead forever -- which is why every leg carries a maker-owned
 * `Salt` and why the roll bumps it. The scene reads `tokensCount` back for all eight hashes to show both
 * halves of that: 255 on the old, 2 on the new.
 */
import type { Hex } from 'viem';
import { aquaAbi } from '../../../web/src/lib/swapvm/index.ts';
import { publicClient, rpc, walletFor } from '../../fork/lib.ts';
import { EXPIRY_DAYS, compileBook, encodeStrategy, readReserves } from '../book.ts';
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

/** `Balance.tokensCount` after `dock`. */
const DOCKED = 255;

async function tokensCount(ctx: Ctx, hash: Hex, token: `0x${string}`): Promise<number> {
  const [, count] = await publicClient.readContract({
    address: ctx.d.aqua,
    abi: aquaAbi,
    functionName: 'rawBalances',
    args: [ctx.state.maker, ctx.d.router, hash, token],
  });
  return count;
}

export async function run(ctx: Ctx, argv: string[]): Promise<void> {
  const live = ctx.state.legs.filter((l) => !l.docked);
  if (live.length === 0) throw new Error('nothing is shipped -- run `make story-1` first');
  const days = Number(argv[argv.indexOf('--days') + 1]) || EXPIRY_DAYS;

  scene(
    '6',
    'Roll the book, move no tokens',
    'dock x4 and ship x4 in one block. Twelve Aqua events, zero ERC-20 Transfer logs, and the wallet untouched.',
  );

  const now = await forkNow();
  const reading = ctx.tape.at(now.timestamp);
  const walletBefore = { weth: await balanceOf(ctx.d.weth, ctx.state.maker), usdc: await balanceOf(ctx.d.usdc, ctx.state.maker) };

  step('what is on the books');
  for (const leg of live) {
    const r = await readReserves(leg, ctx.pair, { aqua: ctx.d.aqua, router: ctx.d.router });
    out(
      `    ${leg.label.padEnd(19)} ${weth(r.rawRisky).padStart(15)} / ${usdc(r.rawStable).padStart(14)}   ` +
        `expired ${iso(leg.maturity)}   ${leg.hash.slice(0, 12)}..`,
    );
  }
  kv([
    ['maker wallet', `${weth(walletBefore.weth)} / ${usdc(walletBefore.usdc)}`],
    ['spot', `${usd(reading.priceWad)} on the replayed tape${reading.beyondTape ? ' (past the captured window: the last real round is held)' : ''}`],
  ]);

  // ---- the new book ----
  const maturity = Number(now.timestamp) + days * 86_400;
  const generation = ctx.state.legs.length; // monotonic across rolls, because a docked hash is dead
  step(`the new book, expiring ${iso(maturity)}`);
  const compiled = await compileBook({
    router: ctx.d.router,
    maker: ctx.state.maker,
    pair: ctx.pair,
    maturity,
    spotWad: reading.priceWad,
    nowSeconds: Number(now.timestamp),
    generation,
  });
  for (const { built, row } of compiled) {
    out(
      `    ${row.label.padEnd(19)} x = ${amount(BigInt(row.xWad), 18, 'WETH', 4).padStart(13)}   ` +
        `y = ${amount(BigInt(row.yWad), 18, 'USDC', 2).padStart(14)}   salt ${built.salt}   ${row.hash.slice(0, 12)}..`,
    );
  }
  check(
    compiled.every(({ row }) => !live.some((l) => l.hash === row.hash)),
    'every new strategy hash is new: the salt moved, so none of them collides with a docked one',
  );

  // ---- one block ----
  step('one block: four docks, then four ships');
  const wallet = walletFor(ctx.maker.privateKey);
  const dockArgs = live.map((l) => [ctx.d.router, l.hash, [l.tokenA, l.tokenB]] as const);
  const shipArgs = compiled.map(
    ({ row }) =>
      [
        ctx.d.router,
        encodeStrategy({ maker: row.order.maker, traits: BigInt(row.order.traits), data: row.order.data }),
        [row.tokenA, row.tokenB],
        [BigInt(row.amountA), BigInt(row.amountB)],
      ] as const,
  );
  const dockGas = await Promise.all(
    dockArgs.map((args) =>
      publicClient.estimateContractGas({ address: ctx.d.aqua, abi: aquaAbi, functionName: 'dock', args, account: ctx.state.maker }),
    ),
  );
  const shipGas = await Promise.all(
    shipArgs.map((args) =>
      publicClient.estimateContractGas({ address: ctx.d.aqua, abi: aquaAbi, functionName: 'ship', args, account: ctx.state.maker }),
    ),
  );

  const nonce = await publicClient.getTransactionCount({ address: ctx.state.maker, blockTag: 'pending' });
  await rpc('evm_setAutomine', [false]);
  const hashes: Hex[] = [];
  try {
    for (const [i, args] of dockArgs.entries()) {
      hashes.push(await wallet.writeContract({ address: ctx.d.aqua, abi: aquaAbi, functionName: 'dock', args, nonce: nonce + i, gas: dockGas[i] }));
    }
    for (const [i, args] of shipArgs.entries()) {
      hashes.push(
        await wallet.writeContract({
          address: ctx.d.aqua,
          abi: aquaAbi,
          functionName: 'ship',
          args,
          nonce: nonce + dockArgs.length + i,
          gas: shipGas[i],
        }),
      );
    }
    await rpc('evm_mine', []);
  } finally {
    await rpc('evm_setAutomine', [true]);
  }

  const receipts: Awaited<ReturnType<typeof printReceipt>>[] = [];
  for (const [i, hash] of hashes.entries()) {
    const label = i < live.length ? `dock ${live[i].label}` : `ship ${compiled[i - live.length].row.label}`;
    receipts.push(await printReceipt(hash, label));
  }
  const blocks = new Set(receipts.map((r) => r.blockNumber.toString()));
  const totals = tally(receipts);

  step('the receipt');
  kv([
    ['events', tallyLine(totals.counts)],
    ['blocks', `${blocks.size} (${[...blocks].join(', ')})`],
    ['gas', `${totals.gas} for the whole roll`],
  ]);
  check(totals.counts.Docked === live.length, `Docked x${live.length}`);
  check(totals.counts.Shipped === compiled.length, `Shipped x${compiled.length}`);
  check(totals.counts.Pushed === compiled.length * 2, `Pushed x${compiled.length * 2} (one per token per new leg)`);
  check(totals.transferCount === 0, 'ERC-20 Transfer logs: 0 -- rolling the book moves no tokens at all');
  check(blocks.size === 1, 'the whole roll landed in one block');
  const walletAfter = { weth: await balanceOf(ctx.d.weth, ctx.state.maker), usdc: await balanceOf(ctx.d.usdc, ctx.state.maker) };
  check(
    walletAfter.weth === walletBefore.weth && walletAfter.usdc === walletBefore.usdc,
    `the maker's wallet is identical to the wei: ${weth(walletAfter.weth)} / ${usdc(walletAfter.usdc)}`,
  );

  // ---- the ledger, both halves ----
  step('what the registry says about the eight hashes');
  for (const leg of live) {
    const count = await tokensCount(ctx, leg.hash, ctx.pair.tokenA);
    out(`    old  ${leg.label.padEnd(19)} ${leg.hash.slice(0, 12)}..  tokensCount ${count}${count === DOCKED ? '  (docked, and can never be re-shipped)' : ''}`);
    check(count === DOCKED, `${leg.label}: docked permanently`);
  }
  for (const { row } of compiled) {
    const count = await tokensCount(ctx, row.hash, ctx.pair.tokenA);
    const r = await readReserves(row, ctx.pair, { aqua: ctx.d.aqua, router: ctx.d.router });
    out(`    new  ${row.label.padEnd(19)} ${row.hash.slice(0, 12)}..  tokensCount ${count}   ${weth(r.rawRisky)} / ${usdc(r.rawStable)}`);
    check(count === 2, `${row.label}: active, two tokens`);
    check(r.rawRisky === BigInt(ctx.pair.riskyIsTokenA ? row.amountA : row.amountB), `${row.label}: Aqua ledger WETH == shipped`);
  }

  // ---- persist ----
  for (const [i, r] of compiled.entries()) {
    r.row.shipTx = receipts[live.length + i].hash;
    r.row.shipBlock = Number(receipts[live.length + i].blockNumber);
  }
  ctx.state.legs = [
    ...ctx.state.legs.map((l) => (live.some((x) => x.hash === l.hash) ? { ...l, docked: true } : l)),
    ...compiled.map((c) => c.row),
  ];
  ctx.state.maturity = maturity;
  ctx.state.spotWadAtShip = reading.priceWad.toString();
  saveState(ctx.state);

  step('what that costs anywhere else');
  out('  A DOV rolls through a withdrawal window and a deposit window, with the capital idle in between.');
  out('  A concentrated-liquidity re-range is burn, swap, mint: three transactions, real transfers, and it realises');
  out('  the divergence loss on the way through.');
  out();
  out(`  Here: ${totals.transferCount} transfers, one block, ${totals.gas} gas, and the inventory never left the wallet`);
  out('  because it was never anywhere else.');

  note(ctx.state, '6', now.timestamp, `rolled 4 legs to ${iso(maturity)} in one block, 0 ERC-20 Transfer logs`);
}
