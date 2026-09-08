/**
 * End-to-end smoke test on the bootstrapped fork (run after `make fork` + `make bootstrap`).
 *
 * Steps 1-4 are the wiring proof, on a strategy whose arithmetic can be checked off-chain by hand:
 *   1. router.AQUA() == official Aqua
 *   2. account #1 (maker) approves Aqua and ships a WETH/USDC XYC strategy (0.3% FeeFlatIn + XYCSwap + Salt) to
 *      Aqua under OUR router, using the TS encoder from web/src/lib/swapvm (strategy = abi.encode(order))
 *   3. account #2 (taker) quotes and swaps 0.1 WETH -> USDC with useTransferFromAndAquaPush
 *   4. prints balances / events and asserts every delta against the off-chain XYC math.
 *
 * Step 5 is the product. A constant-product curve proves the Aqua path but proves nothing about this
 * project, so the same maker then ships a real option leg -- `Deadline . Coverage . RmmSwap . Salt`,
 * opcodes 0x93 and 0x55 -- and three claims are checked against the chain rather than asserted:
 *   5a. the leg starts exactly on the curve, because `y` came from the router's own `stableFor`
 *   5b. `bandFor`'s published minimum is the edge: it clears, and one raw unit less reverts
 *   5c. a fill drains the shared wallet by exactly what left it, which is the number `Coverage` binds
 *       for every other leg the same maker has shipped
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
import {
  ASSIGNMENT_WINDOW_SECONDS,
  COVERAGE_OPCODE,
  FLAG_RISKY_IS_TOKEN_A,
  RMM_SWAP_OPCODE,
  buildLegProgram,
  expiryFlagsFor,
  rateFor,
  strikelineReadAbi,
  toRawReserve,
  type RmmArgs,
} from '../../web/src/components/curve/rmm.ts';
import { explainProgram } from '../../web/src/components/curve/program.ts';
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

  // 5. the product: one option leg, both custom instructions ---------------------
  const leg = await smokeLeg({ d, maker, taker, makerWallet, takerWallet, wethIsA });

  log(
    `\nSMOKE OK` +
      `\n  XYC   strategy ${hash} shipped by ${short(maker.address)} on router ${router}; ` +
      `${short(taker.address)} swapped ${fmt(qIn, 18, 'WETH')} -> ${fmt(qOut, 6, 'USDC')} (tx ${swapHash})` +
      `\n  LEG   strategy ${leg.hash} (0x93 Coverage . 0x55 RmmSwap), K=2,600 sigma=60% 7d; ` +
      `published band ${leg.band} USDC wei is the exact edge; a ${fmt(leg.fill, 6, 'USDC')} fill returned ` +
      `${fmt(leg.out, 18, 'WETH')} (tx ${leg.swapHash})` +
      `\n  the fill moved ${fmt(leg.coverageDrop, 18, 'WETH')} out of the shared wallet, which is what every ` +
      `sibling leg's deliverable depth just fell by`,
  );
}

// ---------------------------------------------------------------------------
// [5] the option leg
// ---------------------------------------------------------------------------

/** 2,600 strike, 60% vol, 7 days, 4 WETH of liquidity, started 65% of the way up the curve. */
const LEG_STRIKE_WAD = 2_600n * 10n ** 18n;
const LEG_SIGMA_WAD = 600_000_000_000_000_000n;
const LEG_LIQUIDITY_WAD = 4n * 10n ** 18n;
const LEG_X_WAD = (LEG_LIQUIDITY_WAD * 65n) / 100n;
/** A real ticket, not the dust the band alone would be at issue. Irregular on purpose. */
const LEG_FILL_USDC = parseUnits('1418.5', 6);

async function smokeLeg(ctx: {
  d: ReturnType<typeof loadDeployments>;
  maker: { address: Address };
  taker: { address: Address };
  makerWallet: ReturnType<typeof walletFor>;
  takerWallet: ReturnType<typeof walletFor>;
  wethIsA: boolean;
}) {
  const { d, maker, taker, makerWallet, takerWallet, wethIsA } = ctx;
  const { router, aqua, weth, usdc } = d;
  log('\n[5] the same maker ships an OPTION leg: Deadline . Coverage . RmmSwap . Salt');

  const [tokenA, tokenB] = wethIsA ? [weth, usdc] : [usdc, weth];
  const rateRisky = rateFor(18);
  const rateStable = rateFor(6);
  const latest = await publicClient.getBlock({ blockTag: 'latest' });
  const maturity = Number(latest.timestamp) + 7 * 24 * 3600;

  const args: RmmArgs = {
    flags: (wethIsA ? FLAG_RISKY_IS_TOKEN_A : 0) | expiryFlagsFor('call'),
    sigmaWad: LEG_SIGMA_WAD,
    maturity,
    strikeWad: LEG_STRIKE_WAD,
    liquidityWad: LEG_LIQUIDITY_WAD,
    rateRisky,
    rateStable,
  };
  const legProgram = buildLegProgram({
    rmm: args,
    coverage: { flags: 0, haircutBps: 0 },
    deadline: maturity + ASSIGNMENT_WINDOW_SECONDS,
    salt: BigInt(Date.now()),
  });
  // Decoded with the app's own instruction walker, not a byte scan: an opcode value can occur inside
  // another instruction's arguments, and the point is that these are real instructions in the stream.
  const decodedProgram = explainProgram(legProgram);
  log(`  program ${decodedProgram.map((i) => `0x${i.opcode.toString(16).padStart(2, '0')} ${i.name}`).join(' . ')}`);
  assertEq(decodedProgram.some((i) => i.opcode === RMM_SWAP_OPCODE), true, 'program carries opcode 0x55 RmmSwap');
  assertEq(decodedProgram.some((i) => i.opcode === COVERAGE_OPCODE), true, 'program carries opcode 0x93 Coverage');

  // 5a. the reserves come from the chain, not from a float. One wei off the curve and the leg is
  // bricked for its whole life, because `Aqua.ship` requires `tokensCount == 0`.
  const yWad = await publicClient.readContract({
    address: router,
    abi: strikelineReadAbi,
    functionName: 'stableFor',
    args: [LEG_STRIKE_WAD, LEG_SIGMA_WAD, maturity, LEG_LIQUIDITY_WAD, LEG_X_WAD],
  });
  const risky = toRawReserve(LEG_X_WAD, rateRisky);
  const stable = toRawReserve(yWad, rateStable);
  log(`  x = ${fmt(risky.raw, 18, 'WETH')} (the maker's moneyness choice); stableFor -> y = ${fmt(stable.raw, 6, 'USDC')}`);

  const legOrder = buildAquaOrder({ maker: maker.address, tokenA, tokenB, program: legProgram });
  const legHash = orderHashAqua(legOrder);
  const [amountA, amountB] = wethIsA ? [risky.raw, stable.raw] : [stable.raw, risky.raw];
  const shipHash = await makerWallet.writeContract({
    address: aqua,
    abi: aquaAbi,
    functionName: 'ship',
    args: [router, encodeStrategyForShip(legOrder), [tokenA, tokenB], [amountA, amountB]],
  });
  const shipReceipt = await publicClient.waitForTransactionReceipt({ hash: shipHash });
  if (shipReceipt.status !== 'success') die(`leg ship reverted: ${shipHash}`);
  log(`  ship tx ${shipHash} gas ${shipReceipt.gasUsed}; strategy ${legHash}`);

  // 5b. `bandFor` publishes the smallest trade that clears. Prove it is the edge, not an estimate:
  // the published number fills and one raw USDC wei less reverts inside RmmSwap.
  const [, minStableIn] = await publicClient.readContract({
    address: router,
    abi: strikelineReadAbi,
    functionName: 'bandFor',
    args: [LEG_STRIKE_WAD, LEG_SIGMA_WAD, maturity, LEG_LIQUIDITY_WAD, risky.normalised, stable.normalised],
  });
  const band = (minStableIn + rateStable - 1n) / rateStable; // ceil: a minimum that rounds down is not one

  // Buying WETH with USDC, so the direction is the opposite of step 3's.
  const legTraits = buildTakerTraits({
    taker: taker.address,
    isExactIn: true,
    isAToB: !wethIsA,
    threshold: 0n,
    deadline: latest.timestamp + 7n * 24n * 3600n + 3600n,
    useTransferFromAndAquaPush: true,
  });

  const quoteLeg = async (amount: bigint) =>
    publicClient.simulateContract({ address: router, abi: [...swapVmAbi, ...strikelineReadAbi], functionName: 'quote', args: [legOrder, amount, legTraits], account: taker.address });

  const cleared = await quoteLeg(band);
  assertEq(cleared.result[0], band, `bandFor's published minimum (${fmt(band, 6, 'USDC')}) clears`);
  let refused = false;
  try {
    await quoteLeg(band - 1n);
  } catch (e) {
    refused = true;
    log(`  ok  one wei under the band reverts: ${(e as Error).message.split('\n').find((l) => l.includes('RmmInsideSpread')) ?? 'RmmInsideSpread'}`);
  }
  assertEq(refused, true, 'bandFor is the edge, not an estimate');

  // 5c. `Coverage` reads the maker's real wallet, and a fill moves it. The band above is deliberately
  // dust -- at issue the reserves are still on the curve, so the only thing to clear is the guard band
  // -- so the fill itself is a real size, the kind a taker would send.
  const coverageOf = () =>
    publicClient.readContract({ address: router, abi: strikelineReadAbi, functionName: 'coverage', args: [maker.address, weth] });
  const coverageBefore = await coverageOf();

  const usdcAllowance = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [taker.address, router] });
  if (usdcAllowance < LEG_FILL_USDC) {
    const h = await takerWallet.writeContract({ address: usdc, abi: erc20Abi, functionName: 'approve', args: [router, maxUint256] });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
  const legSwapHash = await takerWallet.writeContract({ address: router, abi: swapVmAbi, functionName: 'swap', args: [legOrder, LEG_FILL_USDC, legTraits] });
  const legSwapReceipt = await publicClient.waitForTransactionReceipt({ hash: legSwapHash });
  if (legSwapReceipt.status !== 'success') die(`leg swap reverted: ${legSwapHash}`);
  const legSwapped = legSwapReceipt.logs.map(tryDecode).find((e) => e?.eventName === 'Swapped')!.args as { amountOut: bigint };
  const coverageAfter = await coverageOf();

  log(`  swap tx ${legSwapHash} gas ${legSwapReceipt.gasUsed}; ${fmt(LEG_FILL_USDC, 6, 'USDC')} -> ${fmt(legSwapped.amountOut, 18, 'WETH')}`);
  assertEq(coverageBefore - coverageAfter, legSwapped.amountOut, 'coverage() fell by exactly the WETH the fill pulled');

  return { hash: legHash, band, fill: LEG_FILL_USDC, out: legSwapped.amountOut, swapHash: legSwapHash, coverageDrop: coverageBefore - coverageAfter };
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
