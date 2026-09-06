/**
 * Fork test for the read paths behind `useShippedStrategies` / `useAquaBalances` / `useQuote` /
 * `useOraclePrice`. It ships a real strategy to the OFFICIAL Aqua through our router on the local
 * anvil Base fork and then decodes it back through exactly the code the hooks call
 * (`fetchShippedStrategiesDetailed`, `readRawBalances`, `swapVmQuoteViewAbi`, `aggregatorV3Abi`).
 *
 * Requires `make fork && make bootstrap`; skipped automatically when the fork is not reachable.
 * Run: cd web && npm test
 */
import { createPublicClient, createWalletClient, erc20Abi, http, maxUint256, parseUnits, type Address, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { aggregatorV3Abi, swapVmQuoteViewAbi } from '../../lib/contracts/abis';
import { aquaAbi } from '../../lib/swapvm/abi';
import { loadDeploymentsFromFile } from '../../lib/contracts/deployments.server';
import { DOCKED_TOKENS_COUNT, decodeStrategyBytes, fetchShippedStrategiesDetailed, readRawBalances } from '../../lib/contracts/strategies';
import type { Deployments } from '../../lib/contracts/deployments';
import { buildAquaOrder, buildTakerTraits, decodeOrder, encodeStrategyForShip, ix, orderHashAqua, program } from '../../lib/swapvm';

const LIQ_WETH = parseUnits('3', 18);
const LIQ_USDC = parseUnits('7500', 6);
const FEE = BigInt(30_000); // 0.3% of 1e7

async function probe(): Promise<{ deployments: Deployments; chainId: number } | undefined> {
  try {
    const { deployments } = await loadDeploymentsFromFile();
    const client = createPublicClient({ transport: http(deployments.rpcUrl) });
    const chainId = await client.getChainId();
    const code = await client.getCode({ address: deployments.router });
    if (!code || code === '0x') return undefined;
    return { deployments, chainId };
  } catch {
    return undefined;
  }
}

const fork = await probe();

describe.skipIf(!fork)('Shipped-strategy discovery against the local Base fork', () => {
  const d = fork!.deployments;
  const chain = { id: fork!.chainId, name: 'fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [d.rpcUrl] } } } as const;
  const publicClient = createPublicClient({ chain, transport: http(d.rpcUrl) }) as PublicClient;
  const makerAccount = d.accounts.find((a) => a.privateKey && a.role?.startsWith('maker')) ?? d.accounts.find((a) => a.privateKey)!;
  const maker = privateKeyToAccount(makerAccount.privateKey!);
  const wallet = createWalletClient({ account: maker, chain, transport: http(d.rpcUrl) });

  const wethIsA = BigInt(d.weth) < BigInt(d.usdc);
  const tokenA: Address = wethIsA ? d.weth : d.usdc;
  const tokenB: Address = wethIsA ? d.usdc : d.weth;
  const amountA = wethIsA ? LIQ_WETH : LIQ_USDC;
  const amountB = wethIsA ? LIQ_USDC : LIQ_WETH;

  // Salt keeps every run a distinct strategy hash (a docked hash can never be shipped again).
  const prog = program(ix.feeFlatIn(FEE), ix.xycSwap(), ix.salt(BigInt(Date.now())));
  const order = buildAquaOrder({ maker: maker.address, tokenA, tokenB, program: prog });
  const strategyHash: Hex = orderHashAqua(order);

  it('ships, then finds + decodes the strategy through the hook pipeline', async () => {
    // ship (approve Aqua first) -----------------------------------------------------------------
    for (const token of [tokenA, tokenB]) {
      const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [maker.address, d.aqua] });
      if (allowance < amountA + amountB) {
        const approveHash = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [d.aqua, maxUint256] });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }
    const shipHash = await wallet.writeContract({
      address: d.aqua,
      abi: aquaAbi,
      functionName: 'ship',
      args: [d.router, encodeStrategyForShip(order), [tokenA, tokenB], [amountA, amountB]],
    });
    const shipReceipt = await publicClient.waitForTransactionReceipt({ hash: shipHash });
    expect(shipReceipt.status).toBe('success');
    console.log(`ship tx ${shipHash} block ${shipReceipt.blockNumber} gas ${shipReceipt.gasUsed} strategy ${strategyHash}`);

    // useShippedStrategies' pipeline -------------------------------------------------------------
    const found = await fetchShippedStrategiesDetailed(publicClient, {
      aqua: d.aqua,
      app: d.router,
      maker: maker.address,
      fromBlock: BigInt(d.blockNumber),
    });
    console.log(`getLogs ${found.fromBlock}..${found.toBlock}: ${found.strategies.length} strategies for maker ${maker.address}, ${found.skipped.length} skipped`);
    const mine = found.strategies.find((s) => s.strategyHash === strategyHash);
    expect(mine, 'strategy not found in Shipped logs').toBeDefined();
    expect(mine!.app.toLowerCase()).toBe(d.router.toLowerCase());
    expect(mine!.maker.toLowerCase()).toBe(maker.address.toLowerCase());
    expect(mine!.hashMatches).toBe(true);
    expect(mine!.tokens).toEqual([tokenA, tokenB]);
    expect(mine!.program).toBe(prog);
    expect(mine!.order.traits).toBe(order.traits);
    expect(mine!.order.data).toBe(order.data);
    const roundTrip = decodeStrategyBytes(mine!.strategy);
    // viem checksums decoded addresses; the locally built order carries the lowercase form.
    expect(roundTrip.maker.toLowerCase()).toBe(order.maker.toLowerCase());
    expect({ traits: roundTrip.traits, data: roundTrip.data }).toEqual({ traits: order.traits, data: order.data });
    expect(decodeOrder(mine!.order).useAquaInsteadOfSignature).toBe(true);
    expect(mine!.docked).toBe(false);
    expect(mine!.active).toBe(true);
    expect(mine!.balances.map((b) => b.balance)).toEqual([amountA, amountB]);
    expect(mine!.balances.map((b) => b.tokensCount)).toEqual([2, 2]);
    console.log(
      `decoded: tokens ${mine!.tokens.join(', ')} program ${mine!.program} balances ${mine!.balances.map((b) => `${b.token}=${b.balance}/${b.tokensCount}`).join(' ')}`,
    );

    // useAquaBalances' multicall ------------------------------------------------------------------
    const raw = await readRawBalances(publicClient, {
      aqua: d.aqua,
      app: d.router,
      maker: maker.address,
      items: [
        { strategyHash, token: tokenA },
        { strategyHash, token: tokenB },
      ],
    });
    expect(raw.map((b) => b.balance)).toEqual([amountA, amountB]);

    // useQuote's eth_call (the `view` ABI twin) ----------------------------------------------------
    const amountIn = parseUnits('0.05', 18);
    const takerTraits = buildTakerTraits({ taker: maker.address, isExactIn: true, isAToB: wethIsA, useTransferFromAndAquaPush: true });
    const [qIn, qOut, qHash] = await publicClient.readContract({
      address: d.router,
      abi: swapVmQuoteViewAbi,
      functionName: 'quote',
      args: [order, amountIn, takerTraits],
      account: maker.address,
    });
    expect(qHash).toBe(strategyHash);
    expect(qIn).toBe(amountIn);
    expect(qOut).toBeGreaterThan(BigInt(0));
    console.log(`quote 0.05 WETH -> ${qOut} USDC (orderHash ${qHash})`);

    // useOraclePrice's read -------------------------------------------------------------------------
    const [, answer, , updatedAt] = await publicClient.readContract({ address: d.chainlink.ethUsd, abi: aggregatorV3Abi, functionName: 'latestRoundData' });
    const decimals = await publicClient.readContract({ address: d.chainlink.ethUsd, abi: aggregatorV3Abi, functionName: 'decimals' });
    expect(answer).toBeGreaterThan(BigInt(0));
    console.log(`chainlink ETH/USD = ${Number(answer) / 10 ** Number(decimals)} (updatedAt ${updatedAt})`);

    // useDock's write, then the docked flag through the same pipeline ---------------------------------
    const dockHash = await wallet.writeContract({ address: d.aqua, abi: aquaAbi, functionName: 'dock', args: [d.router, strategyHash, [tokenA, tokenB]] });
    const dockReceipt = await publicClient.waitForTransactionReceipt({ hash: dockHash });
    expect(dockReceipt.status).toBe('success');
    const after = await fetchShippedStrategiesDetailed(publicClient, {
      aqua: d.aqua,
      app: d.router,
      maker: maker.address,
      fromBlock: BigInt(d.blockNumber),
    });
    const dockedStrategy = after.strategies.find((s) => s.strategyHash === strategyHash)!;
    expect(dockedStrategy.docked).toBe(true);
    expect(dockedStrategy.active).toBe(false);
    expect(dockedStrategy.balances.map((b) => b.tokensCount)).toEqual([DOCKED_TOKENS_COUNT, DOCKED_TOKENS_COUNT]);
    expect(dockedStrategy.balances.map((b) => b.balance)).toEqual([BigInt(0), BigInt(0)]);
    console.log(`dock tx ${dockHash}: tokensCount ${dockedStrategy.balances.map((b) => b.tokensCount).join(',')} (0xff = docked)`);
  }, 120_000);
});

describe.skipIf(fork)('fork unavailable', () => {
  it('skipped: run `make fork && make bootstrap` first', () => {
    expect(true).toBe(true);
  });
});
