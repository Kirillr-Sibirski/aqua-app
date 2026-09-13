/**
 * One taker, one trade, right now. For the demo video: no time warp, no profitability logic.
 *
 *   make buy ARGS="2600 1"               # buy 1 WETH out of the live sell offer struck at 2,600
 *   make buy ARGS="2300 1 --side buy"    # sell 1 WETH into the live buy offer struck at 2,300
 *
 * The offer is found the way any resolver would find it, out of Aqua's `Shipped` log (any maker). If
 * several live offers match, the newest wins and the script says so. It quotes first, then swaps through
 * the Strikeline router as the demo taker, and prints a short receipt. When the maker's wallet can't
 * deliver, it stops with one line showing needed vs free in WETH.
 */
import { formatUnits, type Address, type Hex } from 'viem';
import { buildTakerTraits, swapVmAbi } from '../../web/src/lib/swapvm/index.ts';
import { FLAG_POST_EXPIRY_OUT_IS_RISKY, strikelineViewsAbi } from '../../web/src/components/curve/rmm.ts';
import { assertFork, die, erc20Abi, loadDeployments, publicClient, walletFor } from '../fork/lib.ts';
import { awaitReceipt, label, labelDeployment, printReceiptOf, PATHS as STORY_PATHS } from '../story/lib.ts';
import { discoverLegs, FEE_SCALE, legMatches, type DiscoveredLeg } from './discover.ts';
import { existsSync, readFileSync } from 'node:fs';

const fmt = (raw: bigint, decimals: number, places: number) =>
  Number(formatUnits(raw, decimals)).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });

function parseArgs(argv: string[]): { strike: string; amount: string; side: 'sell' | 'buy' } {
  const positional: string[] = [];
  let side: 'sell' | 'buy' = 'sell';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--side') {
      const v = argv[++i];
      if (v !== 'sell' && v !== 'buy') die('--side must be "sell" or "buy"');
      side = v;
    } else positional.push(argv[i]);
  }
  if (positional.length < 2) die('usage: make buy ARGS="<strike> <WETH amount> [--side buy]"');
  return { strike: positional[0], amount: positional[1], side };
}

function revertName(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/(NotCovered|RmmInsideSpread|[A-Z][A-Za-z]+)\(([^)]*)\)/);
  return m ? `${m[1]}(${m[2]})` : msg.split('\n')[0];
}

async function main(): Promise<void> {
  const { strike, amount, side } = parseArgs(process.argv.slice(2));
  await assertFork();
  const d = loadDeployments();
  if (!existsSync(STORY_PATHS.state)) die(`${STORY_PATHS.state} not found -- run \`make story-setup\` first`);
  const story = JSON.parse(readFileSync(STORY_PATHS.state, 'utf8')) as { taker: Address };
  const takerKey = d.accounts.find((a) => a.address.toLowerCase() === story.taker.toLowerCase())?.privateKey as Hex | undefined;
  if (!takerKey) die(`no private key for the taker ${story.taker}`);

  const legs = await discoverLegs({ client: publicClient, aqua: d.aqua, app: d.router, fromBlock: BigInt(d.blockNumber) });
  const wantCall = side === 'sell';
  const matches = legs.filter(
    (l) => legMatches(l, `K=${strike}`) && ((l.args.flags & FLAG_POST_EXPIRY_OUT_IS_RISKY) !== 0) === wantCall,
  );
  if (matches.length === 0) die(`no live ${side} offer struck at ${strike} -- publish one in the app first`);
  const leg: DiscoveredLeg = matches.sort((a, b) => Number(b.shippedAtBlock - a.shippedAtBlock))[0];
  if (matches.length > 1) process.stdout.write(`  ${matches.length} live ${side} offers at ${strike}; using the newest (shipped in block ${leg.shippedAtBlock})\n`);

  const [riskyDec, stableDec] = await Promise.all([
    publicClient.readContract({ address: leg.risky, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: leg.stable, abi: erc20Abi, functionName: 'decimals' }),
  ]);
  const riskyAmount = BigInt(Math.round(Number(amount) * 10 ** Number(riskyDec)));
  if (riskyAmount <= 0n) die('amount must be positive');

  // Sell offer: the taker takes WETH OUT (exact out). Buy offer: the taker puts WETH IN (exact in).
  const tokenIn = side === 'sell' ? leg.stable : leg.risky;
  const tokenOut = side === 'sell' ? leg.risky : leg.stable;
  const isExactIn = side === 'buy';
  const isAToB = tokenIn.toLowerCase() === leg.tokenA.toLowerCase();
  const takerData = buildTakerTraits({ taker: story.taker, isExactIn, isAToB, useTransferFromAndAquaPush: true });

  const strikeName = (Number(leg.args.strikeWad) / 1e18).toLocaleString('en-US');
  if (side === 'sell') {
    const free = await publicClient.readContract({ address: d.router, abi: strikelineViewsAbi, functionName: 'coverage', args: [leg.maker, leg.risky] });
    if (riskyAmount > free) {
      die(`the ${strikeName} offer can't deliver: needs ${fmt(riskyAmount, Number(riskyDec), 4)} WETH, the maker wallet has ${fmt(free, Number(riskyDec), 4)} WETH free`);
    }
  }

  let amountIn: bigint;
  let amountOut: bigint;
  try {
    const { result } = await publicClient.simulateContract({
      address: d.router,
      abi: swapVmAbi,
      functionName: 'quote',
      args: [leg.order, riskyAmount, takerData],
      account: story.taker,
    });
    [amountIn, amountOut] = [result[0], result[1]];
  } catch (e) {
    const reason = revertName(e);
    if (reason.startsWith('NotCovered')) {
      const nums = reason.match(/\d+/g) ?? [];
      die(`the ${strikeName} offer can't deliver: needs ${fmt(BigInt(nums[0] ?? 0), Number(riskyDec), 4)} WETH, the maker wallet has ${fmt(BigInt(nums[1] ?? 0), Number(riskyDec), 4)} WETH free`);
    }
    die(`the router refused the quote: ${reason}`);
  }

  const held = await publicClient.readContract({ address: tokenIn, abi: erc20Abi, functionName: 'balanceOf', args: [story.taker] });
  if (held < amountIn) die(`the taker ${story.taker} holds too little to pay ${amountIn} raw units`);

  const wallet = walletFor(takerKey);
  const txHash = await wallet.writeContract({ address: d.router, abi: swapVmAbi, functionName: 'swap', args: [leg.order, riskyAmount, takerData] });
  const receipt = await awaitReceipt(txHash);
  if (receipt.status !== 'success') die(`swap ${txHash} reverted`);

  const feeRaw = leg.fee.bps > 0n && leg.fee.isTokenIn ? amountIn - (amountIn * (FEE_SCALE - leg.fee.bps)) / FEE_SCALE : 0n;
  const feeText = feeRaw > 0n ? ` (fee ${fmt(feeRaw, Number(side === 'sell' ? stableDec : riskyDec), side === 'sell' ? 2 : 4)} ${side === 'sell' ? 'USDC' : 'WETH'})` : '';
  const makerWeth = await publicClient.readContract({ address: leg.risky, abi: erc20Abi, functionName: 'balanceOf', args: [leg.maker] });
  const strikeLabel = strikeName;

  const line1 =
    side === 'sell'
      ? `Bought ${fmt(amountOut, Number(riskyDec), 4)} WETH from the ${strikeLabel} offer for ${fmt(amountIn, Number(stableDec), 2)} USDC${feeText}`
      : `Sold ${fmt(amountIn, Number(riskyDec), 4)} WETH into the ${strikeLabel} buy offer for ${fmt(amountOut, Number(stableDec), 2)} USDC${feeText}`;
  process.stdout.write(
    `\n  ${line1}\n  block ${receipt.blockNumber} · maker wallet now ${fmt(makerWeth, Number(riskyDec), 4)} WETH\n\n  what moved on-chain:\n`,
  );
  labelDeployment(d);
  label(leg.maker, 'maker (you)');
  label(story.taker, 'buyer');
  printReceiptOf(receipt, 'swap');
  process.stdout.write('\n');
}

main().catch((e: unknown) => die(e instanceof Error ? (e.stack ?? e.message) : String(e)));
