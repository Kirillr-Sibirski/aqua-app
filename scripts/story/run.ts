/**
 * The demo driver.
 *
 *   make story-0 ... make story-6      one scene, one process
 *   make story-all                     scenes 1-6 back to back
 *   make story-status                  where the show currently is
 *
 * Every scene is a separate process on purpose. On camera, a scene that goes wrong is retaken with
 * `make story-load` (about a second) and re-run; nothing depends on a long-lived REPL, and the
 * presenter's terminal history is the script. What has to survive between them -- the shipped legs, the
 * tape anchor, the maturity -- lives in `.story-state.json`.
 *
 * Scene order:
 *   0  somebody else's liquidity, through 1inch's own unmodified router
 *   1  ship a four-leg book from one wallet: Shipped x4, Pushed x8, zero ERC-20 Transfer logs
 *   2  an arbitrage bot fills one leg, and every sibling's deliverable depth drops in the same block
 *   3  three days pass with no transaction, and the theta band opens
 *   4  a taker asks for more than the wallet holds and is refused, with both numbers
 *   5  past expiry the curve is a constant-sum order at K, and assignment only runs one way
 *   6  roll the book: Shipped x4, Docked x4, zero ERC-20 Transfer logs
 */
import { context } from './context.ts';
import { fail, iso, kv, loadState, out, weth, usdc, balanceOf } from './lib.ts';
import { coverageOf } from './book.ts';

type SceneModule = { run: (ctx: Awaited<ReturnType<typeof context>>, argv: string[]) => Promise<void> };

const SCENES: Record<string, { title: string; load: () => Promise<SceneModule> }> = {
  '0': { title: 'real third-party liquidity through the official router', load: () => import('./scenes/scene0.ts') },
  '1': { title: 'ship the book from one wallet', load: () => import('./scenes/scene1.ts') },
  '2': { title: 'one fill, four legs tighten', load: () => import('./scenes/scene2.ts') },
  '3': { title: 'three days of theta, no transaction', load: () => import('./scenes/scene3.ts') },
  '4': { title: 'refused, with both numbers', load: () => import('./scenes/scene4.ts') },
  '5': { title: 'expiry: constant-sum at the strike, one way', load: () => import('./scenes/scene5.ts') },
  '6': { title: 'roll the book, move no tokens', load: () => import('./scenes/scene6.ts') },
};

async function status(): Promise<void> {
  const ctx = await context();
  out();
  out('Strikeline demo status');
  kv([
    ['fork', `chain ${ctx.fork.chainId} block ${ctx.fork.blockNumber} ts ${ctx.fork.timestamp} (${iso(ctx.fork.timestamp)})`],
    ['router', ctx.d.router],
    ['maker', `${ctx.state.maker}  ${weth(await balanceOf(ctx.d.weth, ctx.state.maker))} / ${usdc(await balanceOf(ctx.d.usdc, ctx.state.maker))}`],
    ['coverage', `${weth(await coverageOf(ctx.d.router, ctx.state.maker, ctx.d.weth))} / ${usdc(await coverageOf(ctx.d.router, ctx.state.maker, ctx.d.usdc))}`],
    ['tape', `${iso(ctx.tape.seriesTimeFor(ctx.fork.timestamp))} = $${ctx.tape.at(ctx.fork.timestamp).priceUsd.toFixed(2)}`],
    ['maturity', ctx.state.maturity ? `${ctx.state.maturity} (${iso(ctx.state.maturity)})` : 'nothing shipped yet'],
    ['legs', ctx.state.legs.length === 0 ? 'none' : ctx.state.legs.map((l) => `${l.label}${l.docked ? ' [docked]' : ''}`).join('\n            ')],
  ]);
  out();
  out('history');
  for (const h of ctx.state.history) out(`  ${h.at}  scene ${h.scene.padEnd(5)} ${h.note}`);
  out();
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === 'help') {
    out('usage: run.ts <0|1|2|3|4|5|6|all|status> [scene arguments]');
    for (const [k, v] of Object.entries(SCENES)) out(`  ${k}  ${v.title}`);
    return;
  }
  if (command === 'status') return status();

  const keys = command === 'all' ? ['1', '2', '3', '4', '5', '6'] : [command];
  for (const key of keys) {
    const entry = SCENES[key];
    if (!entry) fail(`no scene "${key}" -- try one of ${Object.keys(SCENES).join(', ')}, all, status`);
    // Re-read the context between scenes: earlier ones ship legs and move the clock.
    const ctx = await context();
    const mod = await entry.load();
    await mod.run(ctx, argv);
  }
  out();
  out(`state: ${loadState().legs.length} legs on the books`);
  out();
}

main().catch((e: unknown) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
