/**
 * End-to-end smoke test on the bootstrapped fork (run after `make fork` + `make bootstrap`):
 *   1. router.AQUA() == official Aqua
 *   2. account #1 (maker) approves Aqua and ships a WETH/USDC XYC strategy (0.3% FeeFlatIn + XYCSwap + Salt) to
 *      Aqua under OUR router, using the TS encoder from web/src/lib/swapvm (strategy = abi.encode(order))
 *   3. account #2 (taker) quotes and swaps 0.1 WETH -> USDC with useTransferFromAndAquaPush
 *   4. prints balances / events and asserts every delta against the off-chain XYC math.
 *
 * Env: ANVIL_RPC_URL, DEPLOYMENTS (manifest path), SMOKE_AMOUNT_IN (WETH, default 0.1).
 */
import { decodeEventLog, maxUint256, parseUnits, type Address, type Hex, type Log } from 'viem';
import {
  aquaAbi,
  buildAquaOrder,
  buildTakerTraits,
  decodeOrder,
  encodeStrategyForShip,
  ix,
  math,
  orderHashAqua,
  program,
  swapVmAbi,
} from '../../web/src/lib/swapvm/index.ts';
import { assertFork, die, erc20Abi, fmt, loadDeployments, log, publicClient, short, table, walletFor } from './lib.ts';

const LIQ_WETH = parseUnits('10', 18);
const LIQ_USDC = parseUnits('25000', 6);
const FEE_BPS = 30_000n; // 0.3% of 1e7
const BPS = 10_000_000n;
const AMOUNT_IN = parseUnits(process.env.SMOKE_AMOUNT_IN ?? '0.1', 18);

function assertEq<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) die(`${what}: expected ${String(expected)}, got ${String(actual)}`);
  log(`  ok  ${what} = ${String(actual)}`);
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

async function main() {
  const d = loadDeployments();
  const fork = await assertFork();
  const maker = d.accounts.find((a) => a.index === 1)!;
  const taker = d.accounts.find((a) => a.index === 2)!;
  if (!maker.privateKey || !taker.privateKey) die('manifest lacks private keys for accounts #1/#2');
  const makerWallet = walletFor(maker.privateKey);
  const takerWallet = walletFor(taker.privateKey);
  const { router, aqua, weth, usdc } = d;
  log(`fork ${d.rpcUrl} chain ${fork.chainId} block ${fork.blockNumber}; router ${router} (${d.routerName}); maker ${maker.address}; taker ${taker.address}`);

  // 1. router wiring ------------------------------------------------------------
  log('\n[1] router.AQUA()');
  const routerAqua = await publicClient.readContract({ address: router, abi: swapVmAbi, functionName: 'AQUA' });
  assertEq(routerAqua.toLowerCase(), aqua.toLowerCase(), 'router.AQUA() == official Aqua');
  const aquaCode = await publicClient.getCode({ address: aqua });
  log(`  ok  Aqua code ${(aquaCode!.length - 2) / 2} bytes at ${aqua}`);

  // 2. maker ships ------------------------------------------------------------
  log('\n[2] maker ships WETH/USDC strategy through our router');
  const wethIsA = BigInt(weth) < BigInt(usdc);
  const [tokenA, tokenB] = wethIsA ? [weth, usdc] : [usdc, weth];
  const [amountA, amountB] = wethIsA ? [LIQ_WETH, LIQ_USDC] : [LIQ_USDC, LIQ_WETH];
  const prog = program(ix.feeFlatIn(FEE_BPS), ix.xycSwap(), ix.salt(BigInt(Date.now())));
  const order = buildAquaOrder({ maker: maker.address, tokenA, tokenB, program: prog });
  const strategy = encodeStrategyForShip(order);
  const hash = orderHashAqua(order);
  const routerHash = await publicClient.readContract({ address: router, abi: swapVmAbi, functionName: 'hash', args: [order] });
  assertEq(routerHash, hash, 'router.hash(order) == keccak256(abi.encode(order))');
  const decoded = decodeOrder(order);
  log(`  program ${decoded.program} (FeeFlatIn 0.3% | XYCSwap | Salt), tokenA ${short(tokenA)} tokenB ${short(tokenB)}, useAqua=${decoded.useAquaInsteadOfSignature}`);

  for (const token of [weth, usdc]) {
    const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [maker.address, aqua] });
    if (allowance < amountA + amountB) {
      const h = await makerWallet.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [aqua, maxUint256] });
      const r = await publicClient.waitForTransactionReceipt({ hash: h });
      log(`  approve ${short(token)} -> Aqua: ${r.status} (gas ${r.gasUsed})`);
    }
  }
  const shipHash = await makerWallet.writeContract({
    address: aqua,
    abi: aquaAbi,
    functionName: 'ship',
    args: [router, strategy, [tokenA, tokenB], [amountA, amountB]],
  });
  const shipReceipt = await publicClient.waitForTransactionReceipt({ hash: shipHash });
  if (shipReceipt.status !== 'success') die(`ship reverted: ${shipHash}`);
  const shipped = shipReceipt.logs.map((l) => tryDecode(l)).find((e) => e?.eventName === 'Shipped');
  if (!shipped) die('no Shipped event');
  const shippedArgs = shipped.args as { maker: Address; app: Address; strategyHash: Hex; strategy: Hex };
  log(`  ship tx ${shipHash} gas ${shipReceipt.gasUsed}; events: ${shipReceipt.logs.map((l) => tryDecode(l)?.eventName ?? '?').join(', ')}`);
  assertEq(shippedArgs.strategyHash, hash, 'Shipped.strategyHash');
  assertEq(shippedArgs.app.toLowerCase(), router.toLowerCase(), 'Shipped.app == our router');
  assertEq(shippedArgs.strategy, strategy, 'Shipped.strategy == abi.encode(order)');
  const [balA0, balB0] = await publicClient.readContract({ address: aqua, abi: aquaAbi, functionName: 'safeBalances', args: [maker.address, router, hash, tokenA, tokenB] });
  assertEq(balA0, amountA, 'Aqua safeBalances tokenA');
  assertEq(balB0, amountB, 'Aqua safeBalances tokenB');

  // 3. taker quotes + swaps ------------------------------------------------------------
  log(`\n[3] taker swaps ${fmt(AMOUNT_IN, 18, 'WETH')} -> USDC (exactIn, useTransferFromAndAquaPush)`);
  const fee = ceilDiv(AMOUNT_IN * FEE_BPS, BPS);
  const expectedOut = math.xycAmountOut(AMOUNT_IN - fee, LIQ_WETH, LIQ_USDC);
  const latest = await publicClient.getBlock({ blockTag: 'latest' });
  const takerData = buildTakerTraits({
    taker: taker.address,
    isExactIn: true,
    isAToB: wethIsA,
    threshold: (expectedOut * 99n) / 100n, // min out
    deadline: latest.timestamp + 3600n,
    useTransferFromAndAquaPush: true,
  });

  const allowance = await publicClient.readContract({ address: weth, abi: erc20Abi, functionName: 'allowance', args: [taker.address, router] });
  if (allowance < AMOUNT_IN) {
    const h = await takerWallet.writeContract({ address: weth, abi: erc20Abi, functionName: 'approve', args: [router, maxUint256] });
    const r = await publicClient.waitForTransactionReceipt({ hash: h });
    log(`  approve WETH -> router: ${r.status}`);
  }

  // quote() is non-view on SwapVM (view on ISwapVM), so simulate it as the taker.
  const { result: q } = await publicClient.simulateContract({ address: router, abi: swapVmAbi, functionName: 'quote', args: [order, AMOUNT_IN, takerData], account: taker.address });
  const [qIn, qOut, qHash] = q;
  assertEq(qHash, hash, 'quote.orderHash');
  assertEq(qIn, AMOUNT_IN, 'quote.amountIn');
  assertEq(qOut, expectedOut, `quote.amountOut == xyc(amountIn - 0.3% fee) = ${fmt(expectedOut, 6, 'USDC')}`);

  const before = await balances(maker.address, taker.address, weth, usdc);
  const swapHash = await takerWallet.writeContract({ address: router, abi: swapVmAbi, functionName: 'swap', args: [order, AMOUNT_IN, takerData] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  if (receipt.status !== 'success') die(`swap reverted: ${swapHash}`);
  log(`  swap tx ${swapHash} block ${receipt.blockNumber} gas ${receipt.gasUsed}`);

  const eventRows: string[][] = [];
  let swapped: { amountIn: bigint; amountOut: bigint; tokenIn: Address; tokenOut: Address; orderHash: Hex } | undefined;
  for (const l of receipt.logs) {
    const e = tryDecode(l);
    if (!e) {
      eventRows.push([short(l.address), `topic ${l.topics[0]?.slice(0, 10)}`, '']);
      continue;
    }
    const args = e.args as Record<string, unknown>;
    eventRows.push([short(l.address), e.eventName, Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' && v.length === 42 ? short(v) : String(v)}`).join(' ')]);
    if (e.eventName === 'Swapped') swapped = args as typeof swapped;
  }
  log(table(eventRows, ['emitter', 'event', 'args']));
  if (!swapped) die('no Swapped event');
  assertEq(swapped.orderHash, hash, 'Swapped.orderHash');
  assertEq(swapped.amountIn, qIn, 'Swapped.amountIn == quote');
  assertEq(swapped.amountOut, qOut, 'Swapped.amountOut == quote');

  // 4. balances ------------------------------------------------------------
  log('\n[4] balances');
  const after = await balances(maker.address, taker.address, weth, usdc);
  const [balA1, balB1] = await publicClient.readContract({ address: aqua, abi: aquaAbi, functionName: 'safeBalances', args: [maker.address, router, hash, tokenA, tokenB] });
  const aquaWeth = [wethIsA ? balA0 : balB0, wethIsA ? balA1 : balB1];
  const aquaUsdc = [wethIsA ? balB0 : balA0, wethIsA ? balB1 : balA1];
  log(table(
    [
      ['maker wallet', fmt(before.makerWeth, 18), fmt(after.makerWeth, 18), fmt(before.makerUsdc, 6, undefined, 2), fmt(after.makerUsdc, 6, undefined, 2)],
      ['taker wallet', fmt(before.takerWeth, 18), fmt(after.takerWeth, 18), fmt(before.takerUsdc, 6, undefined, 2), fmt(after.takerUsdc, 6, undefined, 2)],
      ['Aqua strategy (virtual)', fmt(aquaWeth[0], 18), fmt(aquaWeth[1], 18), fmt(aquaUsdc[0], 6, undefined, 2), fmt(aquaUsdc[1], 6, undefined, 2)],
    ],
    ['', 'WETH before', 'WETH after', 'USDC before', 'USDC after'],
  ));
  assertEq(before.takerWeth - after.takerWeth, qIn, 'taker paid amountIn WETH');
  assertEq(after.takerUsdc - before.takerUsdc, qOut, 'taker received amountOut USDC');
  assertEq(after.makerWeth - before.makerWeth, qIn, 'maker wallet received WETH (Aqua.push -> transfer)');
  assertEq(before.makerUsdc - after.makerUsdc, qOut, 'maker wallet paid USDC (Aqua.pull -> transferFrom)');
  assertEq(aquaWeth[1] - aquaWeth[0], qIn, 'Aqua virtual WETH += amountIn');
  assertEq(aquaUsdc[0] - aquaUsdc[1], qOut, 'Aqua virtual USDC -= amountOut');

  log(`\nSMOKE OK: strategy ${hash} shipped by ${short(maker.address)} on router ${router}; ${short(taker.address)} swapped ${fmt(qIn, 18, 'WETH')} -> ${fmt(qOut, 6, 'USDC')} (tx ${swapHash})`);
}

async function balances(maker: Address, taker: Address, weth: Address, usdc: Address) {
  const bal = (token: Address, who: Address) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who] });
  const [makerWeth, makerUsdc, takerWeth, takerUsdc] = await Promise.all([bal(weth, maker), bal(usdc, maker), bal(weth, taker), bal(usdc, taker)]);
  return { makerWeth, makerUsdc, takerWeth, takerUsdc };
}

function tryDecode(l: Log): { eventName: string; args: unknown } | undefined {
  for (const abi of [swapVmAbi, aquaAbi, erc20Abi] as const) {
    try {
      return decodeEventLog({ abi, data: l.data, topics: l.topics }) as { eventName: string; args: unknown };
    } catch {
      /* try next */
    }
  }
  return undefined;
}

main().catch((e) => die(e instanceof Error ? (e.stack ?? e.message) : String(e)));
