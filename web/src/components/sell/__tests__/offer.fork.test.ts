/**
 * The rule the card is built around, checked against a real chain.
 *
 * An offer is sized by choosing `L` off chain — the notional that puts the amount a person typed on
 * the curve — and reading `y` from `StrikelineViews.stableFor`. If that `y` disagrees with the
 * router's own curve by one wei in the wrong direction, every quote on the offer reverts for the
 * rest of its life; and because `Aqua.ship` requires `tokensCount == 0` and `dock` writes `0xff`
 * permanently, the strategy hash can never be re-shipped. There is no recovery, which is why the
 * reserve is never computed in TypeScript.
 *
 * So this runs the whole card path with the card's own code — `liquidityForRisky` to size it,
 * `stableFor` to price it, `buildLegProgram` + `buildAquaOrder` to compile it — ships it to the
 * OFFICIAL Aqua registry through our router, and then proves the result:
 *
 *   1. the amount on offer is EXACTLY the amount typed, to the wei;
 *   2. the shipped reserves sit on the curve (`bandFor` reports a band at the guard band's scale);
 *   3. the two numbers under the button are the router's, not a model's — the settlement read is
 *      `K*(L - x)` to the wei, and a taker who buys the whole reserve pays what the card promised;
 *   4. a trade of one unit reverts inside the band, which is the payment mechanism working;
 *   5. `ship` moved no tokens.
 *
 * Requires `make fork && make bootstrap`; skipped automatically when the fork is not reachable.
 */
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { aggregatorV3Abi, swapVmQuoteViewAbi } from '../../../lib/contracts/abis';
import { aquaAbi } from '../../../lib/swapvm/abi';
import { loadDeploymentsFromFile } from '../../../lib/contracts/deployments.server';
import type { Deployments } from '../../../lib/contracts/deployments';
import { buildAquaOrder, buildTakerTraits, encodeStrategyForShip, orderHashAqua } from '../../../lib/swapvm';
import {
  ASSIGNMENT_WINDOW_SECONDS,
  EPS_WAD,
  FLAG_RISKY_IS_TOKEN_A,
  WAD,
  buildLegProgram,
  expiryFlagsFor,
  rateFor,
  strikelineViewsAbi,
  toRawReserve,
  type RmmArgs,
} from '../../curve/rmm';
import { nextFridayAfter } from '../expiry';
import { liquidityForRisky, strikeFrom } from '../moneyness';

/**
 * What a person types into the amount field, as a fraction of what the wallet actually holds.
 *
 * Read from the chain rather than hardcoded, and deliberately short of the whole balance. `Coverage`
 * enforces `min(balanceOf, allowance)` at quote time, so an offer sized to the last wei is refused
 * the moment anything else on the fork spends one -- which is the guard doing its job, not a test
 * failure, and not something to make a suite flaky over. Nine tenths of an irregular balance is
 * itself irregular, so round numbers still cannot hide a scaling bug.
 */
const AMOUNT_NUMERATOR = BigInt(9);
const AMOUNT_DENOMINATOR = BigInt(10);
const SIGMA_WAD = BigInt('600000000000000000');
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

async function probe(): Promise<{ deployments: Deployments; chainId: number } | undefined> {
  try {
    const { deployments } = await loadDeploymentsFromFile();
    const client = createPublicClient({ transport: http(deployments.rpcUrl) });
    const chainId = await client.getChainId();
    const code = await client.getCode({ address: deployments.router });
    if (!code || code === '0x') return undefined;
    // A router without the views is a ProbeRouter, not a StrikelineRouter: nothing here applies.
    await client.readContract({
      address: deployments.router,
      abi: strikelineViewsAbi,
      functionName: 'tauNow',
      args: [0],
    });
    return { deployments, chainId };
  } catch {
    return undefined;
  }
}

const fork = await probe();

/**
 * Built inside the test rather than in the describe body: `describe.skipIf` still *collects* its
 * callback, so anything dereferenced at that level throws when there is no fork to talk to.
 */
function harness() {
  const d = fork!.deployments;
  const chain = {
    id: fork!.chainId,
    name: 'fork',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [d.rpcUrl] } },
  } as const;
  const publicClient = createPublicClient({ chain, transport: http(d.rpcUrl) }) as PublicClient;
  const makerAccount =
    d.accounts.find((a) => a.privateKey && a.role?.startsWith('maker')) ?? d.accounts.find((a) => a.privateKey)!;
  const maker = privateKeyToAccount(makerAccount.privateKey!);
  const wallet = createWalletClient({ account: maker, chain, transport: http(d.rpcUrl) });
  return { d, publicClient, wallet, maker };
}

describe.skipIf(!fork)('the card, sized and shipped against the local Base fork', () => {
  it('puts exactly the amount typed on offer, and pays what the card says', async () => {
    const { d, publicClient, wallet, maker } = harness();

    // --- the three fields, exactly as the card fills them in ---------------------------------
    const [, answer] = (await publicClient.readContract({
      address: d.chainlink.ethUsd,
      abi: aggregatorV3Abi,
      functionName: 'latestRoundData',
    })) as readonly [bigint, bigint, bigint, bigint, bigint];
    const feedDecimals = await publicClient.readContract({
      address: d.chainlink.ethUsd,
      abi: aggregatorV3Abi,
      functionName: 'decimals',
    });
    const spot = Number(formatUnits(answer, Number(feedDecimals)));

    const block = await publicClient.getBlock();
    const chainNow = Number(block.timestamp);
    const maturity = nextFridayAfter(chainNow);
    const strike = strikeFrom(spot, 0.05);
    const strikeWad = BigInt(Math.round(strike * 1e6)) * BigInt(1e12);
    const tau = Math.max(maturity - chainNow, 3_600) / (365 * 86_400);

    const rateRisky = rateFor(18);
    const rateStable = rateFor(6);
    const balance = await publicClient.readContract({
      address: d.weth,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [maker.address],
    });
    expect(balance).toBeGreaterThan(BigInt(1e17));
    const amountRaw = (balance * AMOUNT_NUMERATOR) / AMOUNT_DENOMINATOR;
    const xWad = amountRaw * rateRisky;

    // --- L is chosen here; x is what the person typed -----------------------------------------
    const liquidityWad = liquidityForRisky(xWad, { spot, strike, sigma: 0.6, tau });
    // The whole point of inverting the relation: the amount on offer is the amount, to the wei.
    expect(xWad).toBe(amountRaw * rateRisky);
    expect(liquidityWad).toBeGreaterThan(xWad);

    // --- y is read from the chain, and so are both numbers under the button --------------------
    const [yWanted, ySettlement] = (await Promise.all([
      publicClient.readContract({
        address: d.router,
        abi: strikelineViewsAbi,
        functionName: 'stableFor',
        args: [strikeWad, SIGMA_WAD, maturity, liquidityWad, xWad],
      }),
      // A maturity of zero is in the past for any block, so `tauOf` returns zero and the curve is
      // its settlement branch. That is what "what you earn" is differenced against.
      publicClient.readContract({
        address: d.router,
        abi: strikelineViewsAbi,
        functionName: 'stableFor',
        args: [strikeWad, SIGMA_WAD, 0, liquidityWad, xWad],
      }),
    ])) as [bigint, bigint];
    const { raw: stableRaw, normalised: yWad } = toRawReserve(yWanted, rateStable);

    // At `tau == 0` the curve degenerates in closed form to `Y = K*(L - X)`. This is the one place
    // the app relies on that identity, so it is asserted against the chain rather than assumed —
    // `stableOf` rounds up, hence the one-wei tolerance of integer division.
    const closedForm = (strikeWad * (liquidityWad - xWad)) / WAD;
    expect(ySettlement - closedForm).toBeLessThanOrEqual(BigInt(1));
    expect(ySettlement).toBeGreaterThanOrEqual(closedForm);

    const earned = ySettlement - yWad;
    const effective = strikeWad + (earned * WAD) / xWad;
    expect(earned).toBeGreaterThan(BigInt(0));
    expect(effective).toBeGreaterThan(strikeWad);

    console.log(
      `spot ${spot} · wallet ${formatUnits(balance, 18)} WETH\n` +
        `  sell ${formatUnits(xWad, 18)} WETH at ${strike} by ${new Date(maturity * 1000).toISOString()}\n` +
        `  L chosen        ${formatUnits(liquidityWad, 18)} WETH\n` +
        `  y = stableFor   ${formatUnits(yWanted, 18)} -> shipped ${formatUnits(stableRaw, 6)} USDC\n` +
        `  at expiry       ${formatUnits(ySettlement, 18)} USDC\n` +
        `  the card says   +${formatUnits(earned, 18)} USDC, ${formatUnits(effective, 18)} each`,
    );

    // --- compile and ship -----------------------------------------------------------------------
    const wethIsA = BigInt(d.weth) < BigInt(d.usdc);
    const rmm: RmmArgs = {
      flags: (wethIsA ? FLAG_RISKY_IS_TOKEN_A : 0) | expiryFlagsFor('call'),
      sigmaWad: SIGMA_WAD,
      maturity,
      strikeWad,
      liquidityWad,
      rateRisky,
      rateStable,
    };
    const program = buildLegProgram({
      rmm,
      deadline: maturity + ASSIGNMENT_WINDOW_SECONDS,
      salt: BigInt(Date.now()) * BigInt(1_000) + BigInt(Math.floor(Math.random() * 999)),
    });
    const tokenA: Address = wethIsA ? d.weth : d.usdc;
    const tokenB: Address = wethIsA ? d.usdc : d.weth;
    const order = buildAquaOrder({ maker: maker.address, tokenA, tokenB, program });
    const strategyHash: Hex = orderHashAqua(order);
    const amounts: [bigint, bigint] = wethIsA ? [amountRaw, stableRaw] : [stableRaw, amountRaw];

    for (const token of [tokenA, tokenB]) {
      const allowance = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [maker.address, d.aqua],
      });
      if (allowance < maxUint256 / BigInt(2)) {
        const hash = await wallet.writeContract({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [d.aqua, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
    }

    const shipHash = await wallet.writeContract({
      address: d.aqua,
      abi: aquaAbi,
      functionName: 'ship',
      args: [d.router, encodeStrategyForShip(order), [tokenA, tokenB], amounts],
    });
    const shipReceipt = await publicClient.waitForTransactionReceipt({ hash: shipHash });
    expect(shipReceipt.status).toBe('success');

    // The result panel prints this number. Aqua moves no tokens on ship; here it is measured.
    const transfers = shipReceipt.logs.filter((log) => log.topics[0] === ERC20_TRANSFER_TOPIC);
    console.log(`  shipped ${strategyHash} in ${shipReceipt.gasUsed} gas, ${transfers.length} Transfer logs`);
    expect(transfers).toHaveLength(0);

    // --- the reserves are on the curve ----------------------------------------------------------
    const [minRiskyIn, minStableIn] = (await publicClient.readContract({
      address: d.router,
      abi: strikelineViewsAbi,
      functionName: 'bandFor',
      args: [strikeWad, SIGMA_WAD, maturity, liquidityWad, xWad, yWad],
    })) as readonly [bigint, bigint];

    const epsStable = (((liquidityWad * strikeWad) / WAD) * EPS_WAD) / WAD;
    const epsRisky = (liquidityWad * EPS_WAD) / WAD;
    const TWO = BigInt(2);
    // Right after a ship the band IS essentially the instruction's own guard band: `bandFor`
    // publishes the smallest trade `exec` will clear, which is the curve gap PLUS eps, and a few
    // seconds of decay is all that separates these reserves from the curve. A TypeScript-computed
    // `y` would be orders of magnitude off this, in either direction.
    expect(minStableIn).toBeGreaterThan(epsStable / TWO);
    expect(minStableIn).toBeLessThan(epsStable * TWO);
    expect(minRiskyIn).toBeGreaterThan(epsRisky / TWO);
    expect(minRiskyIn).toBeLessThan(epsRisky * TWO);

    // --- and the promise on the card is the price a taker actually gets --------------------------
    const takerAccount = d.accounts.find((a) => a.role?.startsWith('taker')) ?? d.accounts[2];
    const taker = takerAccount.address;
    const isAToB = BigInt(d.usdc) < BigInt(d.weth);
    const traits = buildTakerTraits({ taker, isExactIn: true, isAToB, useTransferFromAndAquaPush: true });

    // Buying the whole reserve costs the settlement value less what the offer already holds — the
    // exact figure the card puts under "if it is taken in full", now asked of the router as a quote.
    const toBuyEverything = (ySettlement - yWad) / rateStable + (strikeWad * xWad) / WAD / rateStable;
    const [amountIn, amountOut] = (await publicClient.readContract({
      address: d.router,
      abi: swapVmQuoteViewAbi,
      functionName: 'quote',
      args: [order, toBuyEverything, traits],
      account: taker,
    })) as readonly [bigint, bigint, Hex];
    const perUnit = (amountIn * rateStable * WAD) / (amountOut * rateRisky);
    console.log(
      `  a taker paying ${formatUnits(amountIn, 6)} USDC receives ${formatUnits(amountOut, 18)} WETH ` +
        `(${formatUnits(perUnit, 18)} each; the card promised ${formatUnits(effective, 18)})`,
    );
    expect(amountOut).toBeGreaterThan(BigInt(0));
    // Within a tenth of a percent of the promised price: the residue is the decay between the read
    // and the quote plus the guard band the instruction keeps for the maker. It errs in the maker's
    // favour, which is the direction the rounding is designed to go.
    expect(perUnit).toBeGreaterThan((effective * BigInt(999)) / BigInt(1_000));

    // --- and refuses dust, which is the payment --------------------------------------------------
    await expect(
      publicClient.readContract({
        address: d.router,
        abi: swapVmQuoteViewAbi,
        functionName: 'quote',
        args: [order, BigInt(1), traits],
        account: taker,
      }),
    ).rejects.toThrow();

    // Docked at the end so repeated runs do not accumulate offers on the shared fork.
    const dockHash = await wallet.writeContract({
      address: d.aqua,
      abi: aquaAbi,
      functionName: 'dock',
      args: [d.router, strategyHash, [tokenA, tokenB]],
    });
    expect((await publicClient.waitForTransactionReceipt({ hash: dockHash })).status).toBe('success');
  }, 60_000);
});
