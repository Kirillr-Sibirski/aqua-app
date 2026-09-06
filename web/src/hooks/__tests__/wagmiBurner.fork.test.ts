/**
 * Headless end-to-end run of the wagmi layer the hooks are built on: the burner ("demo mode")
 * connector signs and broadcasts against the local anvil Base fork, and every read goes through the
 * same `@wagmi/core` actions the hooks call (`readContracts` → Multicall3, `readContract` → eth_call,
 * `writeContract` → connector client, `waitForTransactionReceipt`).
 *
 * ship (useShip) → rawBalances multicall (useAquaBalances) → quote (useQuote) → swap (useSwap) →
 * dock (useDock), with a maker config and a taker config so both sides are real transactions.
 *
 * Requires `make fork && make bootstrap`; skipped automatically when the fork is not reachable.
 */
import { createPublicClient, decodeEventLog, erc20Abi, http, maxUint256, parseUnits, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { connect, disconnect, getBlock, readContract, readContracts, waitForTransactionReceipt, writeContract } from 'wagmi/actions';

import { createWagmiConfig, aquaFork } from '../../lib/chain';
import { aggregatorV3Abi, swapVmQuoteViewAbi } from '../../lib/contracts/abis';
import { loadDeploymentsFromFile } from '../../lib/contracts/deployments.server';
import type { Deployments } from '../../lib/contracts/deployments';
import { DOCKED_TOKENS_COUNT } from '../../lib/contracts/strategies';
import { aquaAbi, buildAquaOrder, buildTakerTraits, encodeStrategyForShip, ix, orderHashAqua, program, swapVmAbi } from '../../lib/swapvm';

const LIQ_WETH = parseUnits('4', 18);
const LIQ_USDC = parseUnits('10000', 6);
const AMOUNT_IN = parseUnits('0.1', 18);
const FEE = BigInt(30_000); // 0.3% of 1e7

async function probe(): Promise<Deployments | undefined> {
  try {
    const { deployments } = await loadDeploymentsFromFile();
    const client = createPublicClient({ transport: http(deployments.rpcUrl) });
    if (deployments.chainId !== (await client.getChainId())) return undefined;
    const code = await client.getCode({ address: deployments.router });
    return code && code !== '0x' ? deployments : undefined;
  } catch {
    return undefined;
  }
}

const d = await probe();

describe.skipIf(!d)('wagmi burner connector against the local Base fork', () => {
  const dep = d!;
  // `shippedStrategies.fork.test.ts` runs concurrently and signs as the manifest's "maker" account,
  // so this file deliberately uses the other two funded accounts (nonces would otherwise collide).
  const funded = dep.accounts.filter((a) => a.privateKey);
  const pick = (role: string, fallback: number) => funded.find((a) => a.role?.startsWith(role)) ?? funded[fallback] ?? funded[funded.length - 1];
  const makerAccount = pick('spare', 3);
  const takerAccount = pick('taker', 2);
  const makerConfig = createWagmiConfig({ demoPrivateKey: makerAccount.privateKey! });
  const takerConfig = createWagmiConfig({ demoPrivateKey: takerAccount.privateKey! });
  const burnerOf = (config: ReturnType<typeof createWagmiConfig>) => config.connectors.find((c) => c.id === 'burner')!;

  it('connects, ships, quotes, swaps and docks through @wagmi/core actions', async () => {
    // connect (demo mode) ------------------------------------------------------------------------
    const maker = await connect(makerConfig, { connector: burnerOf(makerConfig), chainId: aquaFork.id });
    const taker = await connect(takerConfig, { connector: burnerOf(takerConfig), chainId: aquaFork.id });
    expect(maker.accounts[0]).toBe(makerAccount.address);
    expect(taker.accounts[0]).toBe(takerAccount.address);
    expect(maker.accounts[0]).not.toBe(taker.accounts[0]);
    expect(maker.chainId).toBe(aquaFork.id);
    console.log(`connected maker ${maker.accounts[0]} / taker ${taker.accounts[0]} on chain ${maker.chainId}`);

    // useTokenBalances' multicall (Multicall3 on the fork) -----------------------------------------
    const [wethBal, wethDec, wethSym] = await readContracts(makerConfig, {
      allowFailure: false,
      contracts: [
        { address: dep.weth, abi: erc20Abi, functionName: 'balanceOf', args: [maker.accounts[0]], chainId: aquaFork.id },
        { address: dep.weth, abi: erc20Abi, functionName: 'decimals', chainId: aquaFork.id },
        { address: dep.weth, abi: erc20Abi, functionName: 'symbol', chainId: aquaFork.id },
      ],
    });
    expect(wethSym).toBe('WETH');
    expect(wethDec).toBe(18);
    expect(wethBal).toBeGreaterThan(LIQ_WETH);
    console.log(`multicall3 balances: maker holds ${wethBal} wei ${wethSym} (${wethDec} decimals)`);

    // useOraclePrice ------------------------------------------------------------------------------
    const [oracle] = await readContracts(makerConfig, {
      allowFailure: false,
      contracts: [{ address: dep.chainlink.ethUsd, abi: aggregatorV3Abi, functionName: 'latestRoundData', chainId: aquaFork.id }],
    });
    expect(oracle[1]).toBeGreaterThan(BigInt(0));

    // useShip: approve → Aqua.ship ------------------------------------------------------------------
    const wethIsA = BigInt(dep.weth) < BigInt(dep.usdc);
    const tokenA: Address = wethIsA ? dep.weth : dep.usdc;
    const tokenB: Address = wethIsA ? dep.usdc : dep.weth;
    const amountA = wethIsA ? LIQ_WETH : LIQ_USDC;
    const amountB = wethIsA ? LIQ_USDC : LIQ_WETH;
    const order = buildAquaOrder({
      maker: maker.accounts[0],
      tokenA,
      tokenB,
      program: program(ix.feeFlatIn(FEE), ix.xycSwap(), ix.salt(BigInt(Date.now()))),
    });
    const strategyHash: Hex = orderHashAqua(order);

    for (const token of [tokenA, tokenB]) {
      const allowance = await readContract(makerConfig, {
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [maker.accounts[0], dep.aqua],
        chainId: aquaFork.id,
      });
      if (allowance < amountA + amountB) {
        const h = await writeContract(makerConfig, {
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [dep.aqua, maxUint256],
          chainId: aquaFork.id,
        });
        expect((await waitForTransactionReceipt(makerConfig, { hash: h, chainId: aquaFork.id })).status).toBe('success');
      }
    }
    const shipHash = await writeContract(makerConfig, {
      address: dep.aqua,
      abi: aquaAbi,
      functionName: 'ship',
      args: [dep.router, encodeStrategyForShip(order), [tokenA, tokenB], [amountA, amountB]],
      chainId: aquaFork.id,
    });
    const shipReceipt = await waitForTransactionReceipt(makerConfig, { hash: shipHash, chainId: aquaFork.id });
    expect(shipReceipt.status).toBe('success');
    console.log(`ship (burner-signed) tx ${shipHash} status ${shipReceipt.status} gas ${shipReceipt.gasUsed} strategy ${strategyHash}`);

    // useAquaBalances: rawBalances multicall --------------------------------------------------------
    const rawBalances = await readContracts(makerConfig, {
      allowFailure: false,
      contracts: [tokenA, tokenB].map(
        (token) =>
          ({
            address: dep.aqua,
            abi: aquaAbi,
            functionName: 'rawBalances',
            args: [maker.accounts[0], dep.router, strategyHash, token],
            chainId: aquaFork.id,
          }) as const,
      ),
    });
    expect(rawBalances.map((r) => (r as readonly [bigint, number])[0])).toEqual([amountA, amountB]);
    expect(rawBalances.map((r) => Number((r as readonly [bigint, number])[1]))).toEqual([2, 2]);

    // useQuote: eth_call against the `view` ABI twin -------------------------------------------------
    const quoteTraits = buildTakerTraits({ taker: taker.accounts[0], isExactIn: true, isAToB: wethIsA, useTransferFromAndAquaPush: true });
    const [qIn, qOut, qHash] = await readContract(takerConfig, {
      address: dep.router,
      abi: swapVmQuoteViewAbi,
      functionName: 'quote',
      args: [order, AMOUNT_IN, quoteTraits],
      account: taker.accounts[0],
      chainId: aquaFork.id,
    });
    expect(qHash).toBe(strategyHash);
    expect(qIn).toBe(AMOUNT_IN);
    expect(qOut).toBeGreaterThan(BigInt(0));
    console.log(`quote ${AMOUNT_IN} WETH -> ${qOut} USDC`);

    // useSwap: approve router → router.swap ----------------------------------------------------------
    const block = await getBlock(takerConfig, { chainId: aquaFork.id });
    const swapTraits = buildTakerTraits({
      taker: taker.accounts[0],
      isExactIn: true,
      isAToB: wethIsA,
      threshold: (qOut * BigInt(99)) / BigInt(100),
      deadline: block.timestamp + BigInt(3600),
      useTransferFromAndAquaPush: true,
    });
    const takerAllowance = await readContract(takerConfig, {
      address: dep.weth,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [taker.accounts[0], dep.router],
      chainId: aquaFork.id,
    });
    if (takerAllowance < AMOUNT_IN) {
      const h = await writeContract(takerConfig, {
        address: dep.weth,
        abi: erc20Abi,
        functionName: 'approve',
        args: [dep.router, maxUint256],
        chainId: aquaFork.id,
      });
      expect((await waitForTransactionReceipt(takerConfig, { hash: h, chainId: aquaFork.id })).status).toBe('success');
    }
    const usdcBefore = await readContract(takerConfig, {
      address: dep.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [taker.accounts[0]],
      chainId: aquaFork.id,
    });
    const swapHash = await writeContract(takerConfig, {
      address: dep.router,
      abi: swapVmAbi,
      functionName: 'swap',
      args: [order, AMOUNT_IN, swapTraits],
      chainId: aquaFork.id,
    });
    const swapReceipt = await waitForTransactionReceipt(takerConfig, { hash: swapHash, chainId: aquaFork.id });
    expect(swapReceipt.status).toBe('success');

    let swapped: { amountIn: bigint; amountOut: bigint; orderHash: Hex } | undefined;
    for (const log of swapReceipt.logs) {
      try {
        const event = decodeEventLog({ abi: swapVmAbi, data: log.data, topics: log.topics });
        if (event.eventName === 'Swapped') swapped = event.args as unknown as typeof swapped;
      } catch {
        /* not a router event */
      }
    }
    expect(swapped?.orderHash).toBe(strategyHash);
    expect(swapped?.amountIn).toBe(qIn);
    expect(swapped?.amountOut).toBe(qOut);
    const usdcAfter = await readContract(takerConfig, {
      address: dep.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [taker.accounts[0]],
      chainId: aquaFork.id,
    });
    expect(usdcAfter - usdcBefore).toBe(qOut);
    console.log(`swap (burner-signed) tx ${swapHash} status ${swapReceipt.status} gas ${swapReceipt.gasUsed}: in ${swapped?.amountIn} out ${swapped?.amountOut}; taker USDC +${usdcAfter - usdcBefore}`);

    // virtual balances moved by exactly the swap ------------------------------------------------------
    const afterSwap = await readContracts(makerConfig, {
      allowFailure: false,
      contracts: [tokenA, tokenB].map(
        (token) =>
          ({
            address: dep.aqua,
            abi: aquaAbi,
            functionName: 'rawBalances',
            args: [maker.accounts[0], dep.router, strategyHash, token],
            chainId: aquaFork.id,
          }) as const,
      ),
    });
    const [wethSlot, usdcSlot] = wethIsA ? [0, 1] : [1, 0];
    expect((afterSwap[wethSlot] as readonly [bigint, number])[0]).toBe(LIQ_WETH + qIn);
    expect((afterSwap[usdcSlot] as readonly [bigint, number])[0]).toBe(LIQ_USDC - qOut);

    // useDock ------------------------------------------------------------------------------------------
    const dockHash = await writeContract(makerConfig, {
      address: dep.aqua,
      abi: aquaAbi,
      functionName: 'dock',
      args: [dep.router, strategyHash, [tokenA, tokenB]],
      chainId: aquaFork.id,
    });
    const dockReceipt = await waitForTransactionReceipt(makerConfig, { hash: dockHash, chainId: aquaFork.id });
    expect(dockReceipt.status).toBe('success');
    const afterDock = await readContracts(makerConfig, {
      allowFailure: false,
      contracts: [tokenA, tokenB].map(
        (token) =>
          ({
            address: dep.aqua,
            abi: aquaAbi,
            functionName: 'rawBalances',
            args: [maker.accounts[0], dep.router, strategyHash, token],
            chainId: aquaFork.id,
          }) as const,
      ),
    });
    expect(afterDock.map((r) => Number((r as readonly [bigint, number])[1]))).toEqual([DOCKED_TOKENS_COUNT, DOCKED_TOKENS_COUNT]);
    console.log(`dock (burner-signed) tx ${dockHash} status ${dockReceipt.status}; tokensCount now ${afterDock.map((r) => Number((r as readonly [bigint, number])[1])).join(',')}`);

    await disconnect(makerConfig, { connector: burnerOf(makerConfig) });
    await disconnect(takerConfig, { connector: burnerOf(takerConfig) });
  }, 180_000);
});
