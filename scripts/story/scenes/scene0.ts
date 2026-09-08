/**
 * SCENE 0 -- somebody else's liquidity, through 1inch's own router.
 *
 * Before a single Strikeline instruction runs, fill three strategies that other people shipped to the
 * OFFICIAL, UNMODIFIED v1.0.2 router at 0x111111338c..., settling against the OFFICIAL Aqua registry at
 * 0x1111113CCf.... Nothing on this screen is ours: not the maker, not the program, not the router, not
 * the registry, not the access NFT. Real WETH leaves a taker, real USDC leaves a stranger's wallet.
 *
 * It answers the only question that matters before the rest of the demo means anything -- is this the
 * real Aqua, or a mock with the same name? -- and it answers it with a transaction, not a claim.
 *
 * Ported from `contracts/test/fork/live/AquaBaseLiveFork.t.sol`, which asserts the same things in
 * Foundry. The three strategies:
 *   live1  ungated EOA maker, concentrated 2,000-2,100 USDC/ETH, wallet-limited to a few cents
 *   live2  contract maker whose hooks source USDC just-in-time; its wallet holds none at all
 *   live3  the 1inch dApp's own book, gated on tx.origin holding a "RES" access token
 */
import { decodeAbiParameters, type Address, type Hex } from 'viem';
import { aquaAbi } from '../../../web/src/lib/swapvm/index.ts';
import { impersonated, publicClient, walletFor } from '../../fork/lib.ts';
import type { Ctx } from '../context.ts';
import {
  AQUA,
  LIVE,
  LIVE_STRATEGIES,
  OFFICIAL_ROUTER,
  PINNED_BLOCK,
  TAKER_TRAITS_V102_GOLDEN,
  officialRouterAbi,
  orderTupleAbi,
  takerTraitsV102,
  type LiveStrategy,
} from '../live.ts';
import {
  balanceOf,
  check,
  expectRevert,
  kv,
  note,
  out,
  printReceipt,
  scene,
  step,
  usdc,
  weth,
} from '../lib.ts';

interface V102Order {
  maker: Address;
  traits: bigint;
  data: Hex;
}

function decodeOrder(strategy: Hex): V102Order {
  const [order] = decodeAbiParameters(orderTupleAbi, strategy);
  return order as V102Order;
}

/** The Aqua ledger for a strategy shipped under the official app. */
async function ledger(maker: Address, hash: Hex, token: Address): Promise<bigint> {
  const [balance] = await publicClient.readContract({
    address: AQUA,
    abi: aquaAbi,
    functionName: 'rawBalances',
    args: [maker, OFFICIAL_ROUTER, hash, token],
  });
  return balance;
}

async function quoteOfficial(
  s: LiveStrategy,
  taker: Address,
  amountIn: bigint,
  threshold?: bigint,
): Promise<{ amountIn: bigint; amountOut: bigint; orderHash: Hex }> {
  const [qIn, qOut, hash] = await publicClient.readContract({
    address: OFFICIAL_ROUTER,
    abi: officialRouterAbi,
    functionName: 'quote',
    args: [decodeOrder(s.strategy), LIVE.weth, LIVE.usdc, amountIn, takerTraitsV102(taker, threshold)],
    account: taker,
  });
  return { amountIn: qIn, amountOut: qOut, orderHash: hash };
}

export async function run(ctx: Ctx, argv: string[]): Promise<void> {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
  const targets = LIVE_STRATEGIES.filter((s) => !only || s.key === only);
  if (targets.length === 0) throw new Error(`--only ${only}: no such live strategy`);

  scene(
    '0',
    'Real third-party liquidity, through the official unmodified router',
    'Nothing here is ours. Official Aqua 0x1111113CCf, official SwapVM v1.0.2 0x111111338c, three strategies other people shipped.',
  );

  // ---- the router really is the deployed v1.0.2 ----
  step('the router on the other end');
  const [, name, version, chainId, verifying] = await publicClient.readContract({
    address: OFFICIAL_ROUTER,
    abi: officialRouterAbi,
    functionName: 'eip712Domain',
  });
  check(name === '1inch SwapVM v1.0' && version === '1.0.2', `EIP-712 domain says "${name}" / "${version}"`);
  check(verifying.toLowerCase() === OFFICIAL_ROUTER.toLowerCase(), `verifyingContract is ${OFFICIAL_ROUTER}`);
  const routerAqua = await publicClient.readContract({ address: OFFICIAL_ROUTER, abi: officialRouterAbi, functionName: 'AQUA' });
  check(routerAqua.toLowerCase() === ctx.d.aqua.toLowerCase(), `it settles against the same Aqua our router does: ${routerAqua}`);
  // The domain's chainId comes from `block.chainid`, which anvil serves as the local id; the CODE at this
  // address is the Base deployment's, byte for byte, which is what the fill actually depends on.
  const officialCode = await publicClient.getCode({ address: OFFICIAL_ROUTER });
  check(!!officialCode && officialCode.length > 2, `${((officialCode!.length - 2) / 2).toLocaleString('en-US')} bytes of deployed v1.0.2 code, forked from Base (EIP-712 chainId reads ${chainId}, the fork's local id)`);
  check(
    takerTraitsV102(ctx.taker.address) === TAKER_TRAITS_V102_GOLDEN,
    `our v1.0.2 taker traits reproduce the 1inch SDK golden vector ${TAKER_TRAITS_V102_GOLDEN}`,
  );

  // ---- the strategies really are live ----
  step('three live books, verified against their own Shipped bytes');
  for (const s of targets) {
    const order = decodeOrder(s.strategy);
    const routerHash = await publicClient.readContract({
      address: OFFICIAL_ROUTER,
      abi: officialRouterAbi,
      functionName: 'hash',
      args: [order],
    });
    check(routerHash === s.hash, `${s.key}: officialRouter.hash(order) == the strategyHash Aqua stored`);
    const [w, u] = await publicClient.readContract({
      address: ctx.d.aqua,
      abi: aquaAbi,
      functionName: 'safeBalances',
      args: [s.maker, OFFICIAL_ROUTER, s.hash, LIVE.weth, LIVE.usdc],
    });
    out(`  ${s.key}  ${s.label}`);
    kv([
      ['maker', s.maker],
      ['program', s.program],
      ['Aqua ledger', `${weth(w)} / ${usdc(u)}`],
      ['maker wallet', `${weth(await balanceOf(LIVE.weth, s.maker))} / ${usdc(await balanceOf(LIVE.usdc, s.maker))}`],
    ]);
    if (ctx.fork.blockNumber === BigInt(PINNED_BLOCK)) {
      check(w === s.ledgerWeth && u === s.ledgerUsdc, `${s.key}: ledger matches the value pinned at block ${PINNED_BLOCK}`);
    }
  }

  // ---- the gate ----
  const gated = targets.find((s) => s.gated);
  if (gated) {
    step('the gate is real: our taker holds no access NFT');
    check((await balanceOf(LIVE.kycNft, ctx.taker.address)) === 0n, `${ctx.taker.address} holds 0 RES`);
    check((await balanceOf(LIVE.kycNft, LIVE.resHolder)) === 1n, `${LIVE.resHolder} holds 1 RES`);
    await expectRevert(`${gated.key} quote as a wallet without RES`, () => quoteOfficial(gated, ctx.taker.address, 10_000_000_000_000_000n));
  }

  // ---- the fills ----
  let filledWeth = 0n;
  let receivedUsdc = 0n;
  for (const s of targets) {
    step(`fill ${s.key}: ${s.label}`);
    const takerAddress = s.gated ? LIVE.resHolder : ctx.taker.address;
    const amountIn = await sizeFor(s, takerAddress);
    const q = await quoteOfficial(s, takerAddress, amountIn);
    check(q.orderHash === s.hash, `quote returns the live strategy hash ${s.hash.slice(0, 12)}..`);
    kv([
      ['taker', s.gated ? `${takerAddress} (impersonated RES holder, so tx.origin passes the gate)` : takerAddress],
      ['quote', `${weth(amountIn)} -> ${usdc(q.amountOut)}  (${(Number(q.amountOut) / 1e6 / (Number(amountIn) / 1e18)).toFixed(2)} USDC/ETH)`],
    ]);

    const before = {
      takerWeth: await balanceOf(LIVE.weth, takerAddress),
      takerUsdc: await balanceOf(LIVE.usdc, takerAddress),
      makerWeth: await balanceOf(LIVE.weth, s.maker),
      makerUsdc: await balanceOf(LIVE.usdc, s.maker),
    };

    const args = [decodeOrder(s.strategy), LIVE.weth, LIVE.usdc, amountIn, takerTraitsV102(takerAddress, q.amountOut)] as const;
    const hash = s.gated
      ? await impersonated(takerAddress).writeContract({ address: OFFICIAL_ROUTER, abi: officialRouterAbi, functionName: 'swap', args })
      : await walletFor(ctx.taker.privateKey).writeContract({ address: OFFICIAL_ROUTER, abi: officialRouterAbi, functionName: 'swap', args });
    const r = await printReceipt(hash, `${s.key} swap through the official router`);

    const after = {
      takerWeth: await balanceOf(LIVE.weth, takerAddress),
      takerUsdc: await balanceOf(LIVE.usdc, takerAddress),
      makerWeth: await balanceOf(LIVE.weth, s.maker),
      makerUsdc: await balanceOf(LIVE.usdc, s.maker),
    };
    check(before.takerWeth - after.takerWeth === amountIn, `taker paid ${weth(amountIn)}`);
    check(after.takerUsdc - before.takerUsdc === q.amountOut, `taker received ${usdc(q.amountOut)}, exactly the quote`);
    if (s.walletBacked) {
      check(before.makerUsdc - after.makerUsdc === q.amountOut, `the stranger's own wallet paid the USDC (${usdc(before.makerUsdc)} -> ${usdc(after.makerUsdc)})`);
    } else {
      check(before.makerUsdc === 0n && after.makerUsdc === 0n, 'the maker wallet held no USDC before or after: its pre-transfer-out hook sourced the whole fill');
    }
    check(r.counts.Pulled === 1 && r.counts.Pushed === 1 && r.counts.Swapped === 1, 'Aqua Pulled + Pushed, router Swapped');
    filledWeth += amountIn;
    receivedUsdc += q.amountOut;
  }

  step('what just happened');
  kv([
    ['registry', `${ctx.d.aqua} (official, never redeployed)`],
    ['app', `${OFFICIAL_ROUTER} (official v1.0.2, never modified)`],
    ['filled', `${targets.length} strategies, ${weth(filledWeth)} in, ${usdc(receivedUsdc)} out`],
    ['ours', 'none of it'],
  ]);
  note(ctx.state, '0', ctx.fork.timestamp, `filled ${targets.map((s) => s.key).join(', ')} through the official v1.0.2 router`);
}

/**
 * The largest amount from a fixed ladder that the maker can actually pay, given the smaller of their
 * Aqua ledger, their wallet and their allowance. These are real books with real inventory; live1's maker
 * has about a dollar of USDC, so the fill is sized to what exists rather than to what looks good.
 */
async function sizeFor(s: LiveStrategy, taker: Address): Promise<bigint> {
  const ledgerUsdc = await ledger(s.maker, s.hash, LIVE.usdc);
  const cap = s.walletBacked
    ? min(
        ledgerUsdc,
        await balanceOf(LIVE.usdc, s.maker),
        await publicClient.readContract({
          address: LIVE.usdc,
          abi: [{ type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
          functionName: 'allowance',
          args: [s.maker, AQUA],
        }),
      )
    : ledgerUsdc; // hooks source the USDC inside the fill, so the wallet is not the bound
  const ladder = [50_000_000_000_000_000n, 10_000_000_000_000_000n, 1_000_000_000_000_000n, 500_000_000_000_000n, 200_000_000_000_000n, 100_000_000_000_000n, 50_000_000_000_000n, 10_000_000_000_000n];
  for (const amountIn of ladder) {
    try {
      const q = await quoteOfficial(s, taker, amountIn);
      if (q.amountOut > 0n && q.amountOut <= cap) return amountIn;
    } catch {
      /* the maker cannot price this size; try a smaller one */
    }
  }
  throw new Error(`${s.key}: no size in the ladder is fillable (maker can pay at most ${usdc(cap)})`);
}

function min(...values: bigint[]): bigint {
  return values.reduce((a, b) => (a < b ? a : b));
}
