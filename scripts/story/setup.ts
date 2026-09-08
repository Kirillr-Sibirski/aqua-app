/**
 * Put the fork into the exact state the demo opens in, then freeze it.
 *
 *   make story-setup      # bootstrap (deploy StrikelineRouter, fund) + this
 *   make story-load       # anvil_loadState back to that frozen state, in about a second
 *
 * What "exact" means here: fixed router address (anvil account #0's nonce at the pinned block is
 * deterministic, so `CREATE` lands the router at the same address every run), the maker's wallet trimmed
 * to exactly 10.4 WETH and 24,850 USDC, every approval already in place, the ETH/USD feed replaced by a
 * mock reporting the first price on the replayed tape, and the tape anchored to this second.
 *
 * Nothing is shipped yet: `make story-1` opens the show. So `make story-load` always returns to take one,
 * which is what makes a retake cost a second instead of two minutes.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { maxUint256, parseEther, type Address, type Hex } from 'viem';
import { erc20Abi as swapVmErc20Abi } from '../../web/src/lib/swapvm/index.ts';
import { strikelineViewsAbi } from '../../web/src/components/curve/rmm.ts';
import { anchorAtStart, loadSeries, Tape } from '../arb/tape.ts';
import { ADDR, assertFork, erc20Abi, publicClient, rpc, testClient, walletFor, type DemoAccount } from '../fork/lib.ts';
import { setOraclePrice } from '../fork/oracle.ts';
import { WALLET_USDC, WALLET_WETH, assertEncoderPinned } from './book.ts';
import { LIVE, OFFICIAL_ROUTER } from './live.ts';
import {
  PATHS,
  amount,
  balanceOf,
  check,
  deployments,
  fail,
  forkNow,
  iso,
  kv,
  labelDeployment,
  out,
  saveState,
  step,
  usd,
  usdc,
  weth,
  type StoryState,
} from './lib.ts';

/** WETH handed to the live-fill takers in scene 0. The real Base books are small; this is plenty. */
const LIVE_TAKER_WETH = 1_000_000_000_000_000_000n; // 1 WETH

async function approve(account: DemoAccount | { address: Address; privateKey: Hex }, token: Address, spender: Address): Promise<void> {
  const current = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, spender],
  });
  if (current > maxUint256 / 2n) return;
  const hash = await walletFor(account.privateKey).writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`approve ${token} -> ${spender} reverted`);
}

/** Move `token` between two funded anvil accounts until `who` holds exactly `target`. */
async function setExactBalance(
  who: { address: Address; privateKey: Hex },
  spare: { address: Address; privateKey: Hex },
  token: Address,
  target: bigint,
  decimals: number,
  symbol: string,
): Promise<void> {
  const have = await balanceOf(token, who.address);
  if (have === target) return;
  const [from, to, value] = have > target ? [who, spare, have - target] : [spare, who, target - have];
  const hash = await walletFor(from.privateKey).writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to.address, value],
  });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`balance trim transfer of ${token} reverted`);
  const now = await balanceOf(token, who.address);
  if (now !== target) throw new Error(`could not set ${symbol} to ${target}: wallet holds ${now}`);
  out(`  ${symbol.padEnd(5)} ${amount(have, decimals, symbol)} -> ${amount(target, decimals, symbol)} (moved ${amount(value, decimals, symbol)})`);
}

async function main(): Promise<void> {
  assertEncoderPinned();
  const fork = await assertFork();
  const d = deployments();
  labelDeployment(d);

  out();
  out('Strikeline demo setup');
  kv([
    ['fork', `${d.rpcUrl} chain ${fork.chainId} block ${fork.blockNumber} ts ${fork.timestamp} (${iso(fork.timestamp)})`],
    ['Aqua (official)', d.aqua],
    ['router', `${d.router} (${d.routerName})`],
  ]);

  // ---- the router has to be ours, and it has to be wired to the official registry ----
  step('router');
  const routerAqua = await publicClient.readContract({ address: d.router, abi: strikelineViewsAbi as never, functionName: 'coverage', args: [d.accounts[1].address, d.weth] }).then(
    () => true,
    () => false,
  );
  if (!routerAqua) {
    fail(
      `the deployed router at ${d.router} has no StrikelineViews.coverage() -- it is ${d.routerName}.\n` +
        `Run: ROUTER_ARTIFACT=contracts/out/StrikelineRouter.sol/StrikelineRouter.json FORCE_REDEPLOY=1 make bootstrap`,
    );
  }
  const aquaOnRouter = await publicClient.readContract({
    address: d.router,
    abi: [{ type: 'function', name: 'AQUA', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const,
    functionName: 'AQUA',
  });
  check(aquaOnRouter.toLowerCase() === ADDR.aqua.toLowerCase(), `router.AQUA() == official Aqua ${ADDR.aqua}`);
  const aquaCode = await publicClient.getCode({ address: ADDR.aqua });
  check(!!aquaCode && aquaCode !== '0x', `official Aqua has ${((aquaCode!.length - 2) / 2).toLocaleString('en-US')} bytes of code on this fork`);
  const officialCode = await publicClient.getCode({ address: OFFICIAL_ROUTER });
  check(!!officialCode && officialCode !== '0x', `official v1.0.2 router ${OFFICIAL_ROUTER} has code (scene 0 fills through it)`);

  // ---- cast ----
  const account = (index: number) => {
    const a = d.accounts.find((x) => x.index === index);
    if (!a?.privateKey) fail(`manifest has no private key for anvil account #${index}`);
    return { address: a.address, privateKey: a.privateKey };
  };
  const maker = account(1);
  const arb = account(2);
  const taker = account(3);

  step('the maker wallet, to the wei');
  await setExactBalance(maker, arb, d.weth, WALLET_WETH, 18, 'WETH');
  await setExactBalance(maker, arb, d.usdc, WALLET_USDC, 6, 'USDC');
  check((await balanceOf(d.weth, maker.address)) === WALLET_WETH, `maker holds ${weth(WALLET_WETH, 2)}`);
  check((await balanceOf(d.usdc, maker.address)) === WALLET_USDC, `maker holds ${usdc(WALLET_USDC)}`);

  step('approvals');
  // The maker approves Aqua, never the router: Aqua is what pulls, and the allowance is half of what
  // `Coverage` reads as deliverable.
  for (const token of [d.weth, d.usdc]) await approve(maker, token, d.aqua);
  for (const who of [arb, taker]) for (const token of [d.weth, d.usdc]) await approve(who, token, d.router);
  for (const who of [arb, taker]) await approve(who, d.weth, OFFICIAL_ROUTER);
  const allowance = (owner: Address, spender: Address, token: Address) =>
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
  check((await allowance(maker.address, d.aqua, d.weth)) === maxUint256, 'maker WETH allowance to Aqua is unlimited');
  check((await allowance(maker.address, d.aqua, d.usdc)) === maxUint256, 'maker USDC allowance to Aqua is unlimited');
  check((await allowance(arb.address, d.router, d.usdc)) === maxUint256, 'arb USDC allowance to the router is unlimited');
  check((await allowance(taker.address, OFFICIAL_ROUTER, d.weth)) === maxUint256, 'taker WETH allowance to the official router is unlimited');

  step('scene 0: the gated third-party maker needs a taker who holds the access NFT');
  // The 1inch dApp strategy is gated on `tx.origin` holding a "RES" access token. We do not mint one --
  // we impersonate an address that already holds one on Base, which is what `--auto-impersonate` is for.
  const resBalance = await publicClient.readContract({
    address: LIVE.kycNft,
    abi: swapVmErc20Abi,
    functionName: 'balanceOf',
    args: [LIVE.resHolder],
  });
  check(resBalance === 1n, `${LIVE.resHolder} holds ${resBalance} RES access token on this fork`);
  await testClient.setBalance({ address: LIVE.resHolder, value: parseEther('10') });
  const resWeth = await balanceOf(d.weth, LIVE.resHolder);
  if (resWeth < LIVE_TAKER_WETH) {
    const hash = await walletFor(arb.privateKey).writeContract({
      address: d.weth,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [LIVE.resHolder, LIVE_TAKER_WETH - resWeth],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  // Impersonated, so no key: send the approval as an unsigned transaction from the holder itself.
  const resAllowance = await allowance(LIVE.resHolder, OFFICIAL_ROUTER, d.weth);
  if (resAllowance < LIVE_TAKER_WETH) {
    const hash = await rpc<Hex>('eth_sendTransaction', [
      {
        from: LIVE.resHolder,
        to: d.weth,
        data: `0x095ea7b3${OFFICIAL_ROUTER.slice(2).toLowerCase().padStart(64, '0')}${'f'.repeat(64)}`,
      },
    ]);
    await publicClient.waitForTransactionReceipt({ hash });
  }
  check((await balanceOf(d.weth, LIVE.resHolder)) >= LIVE_TAKER_WETH, `RES holder funded with ${weth(LIVE_TAKER_WETH, 2)}`);
  check((await allowance(LIVE.resHolder, OFFICIAL_ROUTER, d.weth)) >= LIVE_TAKER_WETH, 'RES holder approved the official router');

  // ---- the tape, and the feed that reports it ----
  step('price tape');
  const series = loadSeries();
  const now = await forkNow();
  const anchor = anchorAtStart(now.timestamp, series);
  const tape = new Tape(series, anchor);
  const reading = tape.at(now.timestamp);
  out(`  ${tape.provenance()}`);
  kv([
    ['anchor', `fork ts ${anchor.forkTs} (${iso(anchor.forkTs)})  =  tape ts ${anchor.seriesTs} (${iso(anchor.seriesTs)})`],
    ['opening price', `${usd(reading.priceWad)}  round ${reading.roundId}`],
    ['tape ends', `${iso(series.lastTimestamp)}, ${((series.lastTimestamp - series.firstTimestamp) / 86_400).toFixed(2)} days ahead of the anchor`],
  ]);
  const feed = await setOraclePrice(ADDR.chainlink.ethUsd, reading.answer);
  check(feed.answer === reading.answer, `Chainlink ETH/USD at ${ADDR.chainlink.ethUsd} now reports the tape: ${usd(reading.priceWad)}`);

  // ---- state ----
  const state: StoryState = {
    version: 2,
    router: d.router,
    maker: maker.address,
    arb: arb.address,
    taker: taker.address,
    anchor,
    legs: [],
    history: [{ scene: 'setup', at: new Date().toISOString(), forkTs: Number(now.timestamp), note: 'fork prepared, nothing shipped' }],
  };
  saveState(state);

  // ---- freeze ----
  step('freeze');
  mkdirSync(PATHS.dumpDir, { recursive: true });
  const dump = await rpc<Hex>('anvil_dumpState', []);
  writeFileSync(PATHS.dump, JSON.stringify({ takenAt: new Date().toISOString(), blockNumber: Number(now.blockNumber), timestamp: Number(now.timestamp), state: dump }) + '\n');
  copyFileSync(PATHS.state, `${PATHS.dumpDir}/story-state.json`);
  const bytes = (dump.length - 2) / 2;
  check(bytes > 0, `anvil_dumpState wrote ${(bytes / 1024).toFixed(0)} KiB of gzipped chain state to ${PATHS.dump}`);

  out();
  out('ready. `make story-load` returns here in about a second; `make story-1` opens the show.');
  out();
}

if (!existsSync(PATHS.storyDir)) fail('run from the repository root');
main().catch((e: unknown) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
