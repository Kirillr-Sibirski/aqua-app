/**
 * The rule this whole feature is built around, checked against a real chain.
 *
 * A leg is sized by choosing `x` off chain and reading `y` from `StrikelineViews.stableFor`. If that
 * `y` disagrees with the router's own curve by one wei in the wrong direction, every quote on the
 * leg reverts for the rest of its life — and because `Aqua.ship` requires `tokensCount == 0` and
 * `dock` writes `0xff` permanently, the strategy hash can never be re-shipped. There is no recovery,
 * which is why the reserve is never computed in TypeScript.
 *
 * So this test does the entire writer path with the writer's own code — `riskyReserveWad` to pick
 * the point, `stableFor` to price it, `toRawReserve` to round it, `buildLegProgram` +
 * `buildAquaOrder` to compile it — ships it to the OFFICIAL Aqua registry through our router, and
 * then proves the result actually trades:
 *
 *   1. the shipped reserves sit on the curve (`bandFor` reports a band far below the guard band);
 *   2. `riskyFor` inverts `stableFor` back to the `x` that was chosen;
 *   3. a trade above the band quotes a positive output;
 *   4. a trade of one unit reverts inside the band, which is the premium mechanism working.
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
  parseUnits,
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
  tauWad,
  toRawReserve,
  type RmmArgs,
} from '../../curve/rmm';
import { riskyReserveWad } from '../moneyness';

/** `L` for the test leg. Irregular on purpose: round numbers hide off-by-one scaling bugs. */
const LIQUIDITY = parseUnits('3.4', 18);
const SIGMA_WAD = BigInt('600000000000000000');
const SEVEN_DAYS = 7 * 24 * 3_600;

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

describe.skipIf(!fork)('sizing a leg through the router, against the local Base fork', () => {
  it('ships on the curve and then trades', async () => {
    const { d, publicClient, wallet, maker } = harness();

    // --- terms, all from the chain -----------------------------------------------------------
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
    const maturity = chainNow + SEVEN_DAYS;
    const tau = Number(tauWad(maturity, chainNow)) / 1e18;

    // A strike 10% above spot, quantised the way the writer quantises it.
    const strike = Math.round((spot * 1.1) / 100) * 100;
    const strikeWad = BigInt(Math.round(strike * 1e6)) * BigInt(1e12);

    const wethIsA = BigInt(d.weth) < BigInt(d.usdc);
    const rateRisky = rateFor(18);
    const rateStable = rateFor(6);

    // --- 1. x is chosen here -------------------------------------------------------------------
    const wanted = riskyReserveWad(LIQUIDITY, { spot, strike, sigma: 0.6, tau });
    const { raw: riskyRaw, normalised: xWad } = toRawReserve(wanted, rateRisky);

    // --- 2. y is read from the chain ------------------------------------------------------------
    const yWanted = await publicClient.readContract({
      address: d.router,
      abi: strikelineViewsAbi,
      functionName: 'stableFor',
      args: [strikeWad, SIGMA_WAD, maturity, LIQUIDITY, xWad],
    });
    const { raw: stableRaw, normalised: yWad } = toRawReserve(yWanted, rateStable);

    console.log(
      `spot ${spot} · K ${strike} · L ${formatUnits(LIQUIDITY, 18)} WETH · tau ${tau.toFixed(6)}y\n` +
        `  x chosen  ${formatUnits(xWad, 18)} WETH\n` +
        `  y = stableFor(x) ${formatUnits(yWanted, 18)} -> shipped ${formatUnits(stableRaw, 6)} USDC`,
    );

    // The inverse agrees: riskyFor(stableFor(x)) is x back again, both rounded toward the maker.
    const xBack = await publicClient.readContract({
      address: d.router,
      abi: strikelineViewsAbi,
      functionName: 'riskyFor',
      args: [strikeWad, SIGMA_WAD, maturity, LIQUIDITY, yWanted],
    });
    const inverseDrift = xBack > xWad ? xBack - xWad : xWad - xBack;
    console.log(`  riskyFor(y) round-trip drift ${inverseDrift} wei`);
    // The documented Phi^-1 -> Phi composite error is 1.18e-6; on 3.4 WETH that is ~4e12 wei.
    expect(inverseDrift).toBeLessThan(BigInt(1e14));

    // --- compile and ship ------------------------------------------------------------------------
    const rmm: RmmArgs = {
      flags: (wethIsA ? FLAG_RISKY_IS_TOKEN_A : 0) | expiryFlagsFor('call'),
      sigmaWad: SIGMA_WAD,
      maturity,
      strikeWad,
      liquidityWad: LIQUIDITY,
      rateRisky,
      rateStable,
    };
    const program = buildLegProgram({
      rmm,
      deadline: maturity + ASSIGNMENT_WINDOW_SECONDS,
      salt: BigInt(chainNow) * BigInt(1000) + BigInt(Math.floor(Math.random() * 999)),
    });
    const tokenA: Address = wethIsA ? d.weth : d.usdc;
    const tokenB: Address = wethIsA ? d.usdc : d.weth;
    const order = buildAquaOrder({ maker: maker.address, tokenA, tokenB, program });
    const strategyHash: Hex = orderHashAqua(order);
    const amounts: [bigint, bigint] = wethIsA ? [riskyRaw, stableRaw] : [stableRaw, riskyRaw];

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

    const transfers = shipReceipt.logs.filter(
      (log) => log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    );
    console.log(
      `  shipped ${strategyHash} in ${shipReceipt.gasUsed} gas, ${transfers.length} ERC-20 Transfer logs`,
    );
    // Aqua moves no tokens on ship. The panel claims it; here it is measured.
    expect(transfers).toHaveLength(0);

    // --- 3. the reserves are on the curve --------------------------------------------------------
    const [minRiskyIn, minStableIn] = (await publicClient.readContract({
      address: d.router,
      abi: strikelineViewsAbi,
      functionName: 'bandFor',
      args: [strikeWad, SIGMA_WAD, maturity, LIQUIDITY, xWad, yWad],
    })) as readonly [bigint, bigint];

    // The guard band the instruction itself applies, for scale: eps on the stable side is
    // (L*K/WAD) * EPS / WAD, and on the risky side L * EPS / WAD.
    const epsStable = ((LIQUIDITY * strikeWad) / WAD) * EPS_WAD / WAD;
    const epsRisky = (LIQUIDITY * EPS_WAD) / WAD;
    console.log(
      `  band right after ship: ${formatUnits(minStableIn, 18)} stable / ${formatUnits(minRiskyIn, 18)} risky\n` +
        `  guard band for scale: ${formatUnits(epsStable, 18)} stable / ${formatUnits(epsRisky, 18)} risky`,
    );

    // A few seconds of decay is all that separates the reserves from the curve, and that is far
    // below the instruction's own epsilon. A TypeScript-computed `y` would not land here.
    expect(minStableIn).toBeLessThan(epsStable);
    expect(minRiskyIn).toBeLessThan(epsRisky);

    // --- 4. it trades ----------------------------------------------------------------------------
    const takerAccount = d.accounts.find((a) => a.role?.startsWith('taker')) ?? d.accounts[2];
    const taker = takerAccount.address;
    // USDC in, WETH out. `isAToB` is decided by address order, not by which side is risky.
    const isAToB = BigInt(d.usdc) < BigInt(d.weth);
    const traits = buildTakerTraits({
      taker,
      isExactIn: true,
      isAToB,
      useTransferFromAndAquaPush: true,
    });

    const above = minStableIn / rateStable + parseUnits('25', 6);
    const [amountIn, amountOut] = (await publicClient.readContract({
      address: d.router,
      abi: swapVmQuoteViewAbi,
      functionName: 'quote',
      args: [order, above, traits],
      account: taker,
    })) as readonly [bigint, bigint, Hex];
    console.log(
      `  quote ${formatUnits(amountIn, 6)} USDC -> ${formatUnits(amountOut, 18)} WETH ` +
        `(${(Number(formatUnits(amountIn, 6)) / Number(formatUnits(amountOut, 18))).toFixed(2)} per WETH)`,
    );
    expect(amountOut).toBeGreaterThan(BigInt(0));

    // --- 5. and refuses dust, which is the premium ------------------------------------------------
    await expect(
      publicClient.readContract({
        address: d.router,
        abi: swapVmQuoteViewAbi,
        functionName: 'quote',
        args: [order, BigInt(1), traits],
        account: taker,
      }),
    ).rejects.toThrow();

    // --- 6. coverage is exactly what Coverage will enforce ----------------------------------------
    const [free, balance, allowance] = await Promise.all([
      publicClient.readContract({
        address: d.router,
        abi: strikelineViewsAbi,
        functionName: 'coverage',
        args: [maker.address, d.weth],
      }),
      publicClient.readContract({
        address: d.weth,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [maker.address],
      }),
      publicClient.readContract({
        address: d.weth,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [maker.address, d.aqua],
      }),
    ]);
    console.log(`  coverage(maker, WETH) = ${formatUnits(free, 18)}`);
    expect(free).toBe(balance < allowance ? balance : allowance);

    // Docked at the end so repeated runs do not accumulate legs on the shared fork.
    const dockHash = await wallet.writeContract({
      address: d.aqua,
      abi: aquaAbi,
      functionName: 'dock',
      args: [d.router, strategyHash, [tokenA, tokenB]],
    });
    const dockReceipt = await publicClient.waitForTransactionReceipt({ hash: dockHash });
    expect(dockReceipt.status).toBe('success');
    expect(
      dockReceipt.logs.filter(
        (log) => log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      ),
    ).toHaveLength(0);
  }, 60_000);
});
