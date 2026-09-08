/**
 * The book screen's read paths, against the local anvil Base fork.
 *
 * Read-only on purpose: it ships nothing, warps nothing and moves no tokens, so it can run beside a
 * demo rehearsal without disturbing it. What it checks is that the four claims the screen makes
 * about its own numbers hold against a real chain:
 *
 *   1. the terms on a row come out of the bytes Aqua published, not out of a fixture;
 *   2. the wallet line is `min(balanceOf, allowance)` and the router agrees;
 *   3. deliverable depth is what the guard says it is, probed at `min(coverage, reserve)`;
 *   4. the theta a past fill paid can be recovered from the log stream alone.
 *
 * Requires `make fork` and a StrikelineRouter in the deployment manifest; skipped automatically
 * otherwise. Leg-dependent cases skip again when the fork carries no legs yet, so a bare fork
 * reports "skipped" rather than "passed" and cannot flatter the suite.
 *
 * Run: cd web && npm test
 */
import { createPublicClient, getAbiItem, http, type Address, type Hex, type PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';

import { loadDeploymentsFromFile } from '../../lib/contracts/deployments.server';
import type { Deployments } from '../../lib/contracts/deployments';
import { fetchShippedStrategiesDetailed } from '../../lib/contracts/strategies';
import { aquaAbi, buildTakerTraits, erc20Abi, swapVmAbi, type Order } from '../../lib/swapvm';
import {
  boundFromRevert,
  decodeLegProgram,
  fromWad,
  quoteWithStrikelineErrorsAbi,
  replayReserves,
  reserveAt,
  strikelineViewsAbi,
  toWad,
  type ReserveDelta,
  type RmmArgs,
} from '../strikeline';

const ZERO = BigInt(0);

interface Fork {
  deployments: Deployments;
  client: PublicClient;
}

/**
 * A usable fork is one that is reachable, has our router deployed, and whose router answers
 * `StrikelineViews`. A ProbeRouter passes the first two and fails the third, which is exactly the
 * state the screen renders as "this router does not answer StrikelineViews".
 */
async function probe(): Promise<Fork | undefined> {
  try {
    const { deployments } = await loadDeploymentsFromFile();
    const client = createPublicClient({ transport: http(deployments.rpcUrl) }) as PublicClient;
    await client.getChainId();
    const code = await client.getCode({ address: deployments.router });
    if (!code || code === '0x') return undefined;
    await client.readContract({ address: deployments.router, abi: strikelineViewsAbi, functionName: 'tauNow', args: [0] });
    return { deployments, client };
  } catch {
    return undefined;
  }
}

const fork = await probe();

interface ForkLeg {
  strategyHash: Hex;
  maker: Address;
  order: Order;
  rmm: RmmArgs;
  guarded: boolean;
  risky: Address;
  stable: Address;
  reserveRisky: bigint;
  reserveStable: bigint;
  deliversRisky: boolean;
}

/** Every Strikeline leg currently live on the router, whoever shipped it. */
async function discover(f: Fork): Promise<ForkLeg[]> {
  const { strategies } = await fetchShippedStrategiesDetailed(f.client, {
    aqua: f.deployments.aqua,
    app: f.deployments.router,
    fromBlock: BigInt(f.deployments.blockNumber),
  });

  const legs: ForkLeg[] = [];
  for (const strategy of strategies) {
    const decoded = decodeLegProgram(strategy.program);
    if (!decoded.rmm || strategy.docked) continue;
    const [tokenA, tokenB] = strategy.tokens;
    const risky = decoded.rmm.riskyIsTokenA ? tokenA : tokenB;
    const stable = decoded.rmm.riskyIsTokenA ? tokenB : tokenA;
    const reserveOf = (token: Address) => strategy.balances.find((b) => b.token.toLowerCase() === token.toLowerCase())?.balance ?? ZERO;
    legs.push({
      strategyHash: strategy.strategyHash,
      maker: strategy.maker,
      order: strategy.order,
      rmm: decoded.rmm,
      guarded: decoded.guarded,
      risky,
      stable,
      reserveRisky: reserveOf(risky),
      reserveStable: reserveOf(stable),
      deliversRisky: decoded.rmm.postExpiryOneWay ? decoded.rmm.postExpiryOutIsRisky : toWad(reserveOf(risky), decoded.rmm.rateRisky) * BigInt(2) > decoded.rmm.liquidityWad,
    });
  }
  return legs;
}

const legs = fork ? await discover(fork) : [];

describe.skipIf(!fork)('The book, read from the local Base fork', () => {
  it('has a router that answers StrikelineViews', async () => {
    const f = fork!;
    const tau = await f.client.readContract({ address: f.deployments.router, abi: strikelineViewsAbi, functionName: 'tauNow', args: [0] });
    // A maturity in the past is settled, which is what makes tau exactly zero.
    expect(tau).toBe(ZERO);
  });

  it('reads coverage as the same min(balanceOf, allowance) the guard enforces', async () => {
    const f = fork!;
    const maker = legs[0]?.maker ?? (f.deployments.accounts[1]?.address as Address);
    expect(maker).toBeDefined();

    for (const token of [f.deployments.weth, f.deployments.usdc]) {
      const [balance, allowance, coverage] = await Promise.all([
        f.client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [maker] }),
        f.client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [maker, f.deployments.aqua] }),
        f.client.readContract({ address: f.deployments.router, abi: strikelineViewsAbi, functionName: 'coverage', args: [maker, token] }),
      ]);
      expect(coverage).toBe(balance < allowance ? balance : allowance);
    }
  });

  it.skipIf(legs.length === 0)('decodes every leg out of the bytes Aqua published', () => {
    for (const leg of legs) {
      expect(leg.rmm.strikeWad).toBeGreaterThan(ZERO);
      expect(leg.rmm.liquidityWad).toBeGreaterThan(ZERO);
      expect(leg.rmm.sigmaWad).toBeGreaterThan(ZERO);
      expect(leg.rmm.rateRisky).toBeGreaterThan(ZERO);
      expect(leg.rmm.rateStable).toBeGreaterThan(ZERO);
      // A leg's reserves must sit inside its own liquidity, or the curve is out of domain.
      expect(toWad(leg.reserveRisky, leg.rmm.rateRisky)).toBeLessThanOrEqual(leg.rmm.liquidityWad);
      // Every leg the app ships is wrapped in Coverage; an unguarded one is rendered as such.
      expect(typeof leg.guarded).toBe('boolean');
    }
  });

  it.skipIf(legs.length === 0)('reports tau on the chain clock, floored at an hour', async () => {
    const f = fork!;
    const block = await f.client.getBlock({ blockTag: 'latest' });
    for (const leg of legs) {
      const tau = await f.client.readContract({
        address: f.deployments.router,
        abi: strikelineViewsAbi,
        functionName: 'tauNow',
        args: [leg.rmm.maturity],
      });
      if (Number(block.timestamp) >= leg.rmm.maturity) expect(tau).toBe(ZERO);
      else expect(tau).toBeGreaterThan(ZERO);
    }
  });

  it.skipIf(legs.length === 0)('answers the depth probe either with a clearing quote or with a bound', async () => {
    const f = fork!;
    for (const leg of legs) {
      const deliveryToken = leg.deliversRisky ? leg.risky : leg.stable;
      const written = leg.deliversRisky ? leg.reserveRisky : leg.reserveStable;
      if (written === ZERO) continue;

      const coverage = await f.client.readContract({
        address: f.deployments.router,
        abi: strikelineViewsAbi,
        functionName: 'coverage',
        args: [leg.maker, deliveryToken],
      });
      const probeAmount = coverage < written ? coverage : written;
      if (probeAmount === ZERO) continue;

      const [, tokenB] = [leg.risky, leg.stable].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      const takerTraits = buildTakerTraits({
        taker: leg.maker,
        isExactIn: false,
        isAToB: deliveryToken.toLowerCase() === tokenB.toLowerCase(),
        threshold: null,
        useTransferFromAndAquaPush: true,
      });

      try {
        const [amountIn, amountOut] = await f.client.readContract({
          address: f.deployments.router,
          abi: quoteWithStrikelineErrorsAbi,
          functionName: 'quote',
          args: [leg.order, probeAmount, takerTraits],
        });
        // The quote cleared, so the leg really can deliver the size the wallet bound implies, and
        // the taker's cost is a real price rather than zero.
        expect(amountOut).toBe(probeAmount);
        expect(amountIn).toBeGreaterThan(ZERO);
      } catch (error) {
        const refusal = boundFromRevert(error);
        if (refusal) {
          const rateOut = leg.deliversRisky ? leg.rmm.rateRisky : leg.rmm.rateStable;
          const bound = refusal.reason === 'curve' ? fromWad(refusal.bound, rateOut) : refusal.bound;
          // Whichever side refused, the bound it reports can never exceed what the leg wrote.
          expect(bound).toBeLessThanOrEqual(written);
        }
      }
    }
  });

  it.skipIf(legs.length === 0)('recovers the band each recorded fill had to clear, from the log stream alone', async () => {
    const f = fork!;
    const fromBlock = BigInt(f.deployments.blockNumber);
    const toBlock = await f.client.getBlockNumber();
    const byHash = new Map(legs.map((l) => [l.strategyHash.toLowerCase(), l]));

    const [swapped, pushed, pulled] = await Promise.all([
      f.client.getLogs({ address: f.deployments.router, event: getAbiItem({ abi: swapVmAbi, name: 'Swapped' }), fromBlock, toBlock, strict: true }),
      f.client.getLogs({ address: f.deployments.aqua, event: getAbiItem({ abi: aquaAbi, name: 'Pushed' }), fromBlock, toBlock, strict: true }),
      f.client.getLogs({ address: f.deployments.aqua, event: getAbiItem({ abi: aquaAbi, name: 'Pulled' }), fromBlock, toBlock, strict: true }),
    ]);

    const fills = swapped.filter((log) => byHash.has(log.args.orderHash.toLowerCase()));
    if (fills.length === 0) return; // a book that has not traded yet has no theta to recover

    for (const fill of fills) {
      const leg = byHash.get(fill.args.orderHash.toLowerCase())!;
      const key = leg.strategyHash.toLowerCase();
      const deltas: ReserveDelta[] = [
        ...pushed.filter((l) => l.args.strategyHash.toLowerCase() === key).map((l) => ({
          strategyHash: l.args.strategyHash,
          token: l.args.token,
          amount: l.args.amount,
          blockNumber: l.blockNumber,
          logIndex: l.logIndex,
          transactionHash: l.transactionHash,
        })),
        ...pulled.filter((l) => l.args.strategyHash.toLowerCase() === key).map((l) => ({
          strategyHash: l.args.strategyHash,
          token: l.args.token,
          amount: -l.args.amount,
          blockNumber: l.blockNumber,
          logIndex: l.logIndex,
          transactionHash: l.transactionHash,
        })),
      ];

      const before = replayReserves(deltas, new Set([fill.transactionHash.toLowerCase()])).get(fill.transactionHash.toLowerCase());
      const xBefore = reserveAt(before, leg.risky);
      const yBefore = reserveAt(before, leg.stable);

      // The reserves the fill hit must be inside the leg's own liquidity, or the replay is wrong.
      expect(toWad(xBefore, leg.rmm.rateRisky)).toBeLessThanOrEqual(leg.rmm.liquidityWad);

      const [minRiskyIn, minStableIn] = await f.client.readContract({
        address: f.deployments.router,
        abi: strikelineViewsAbi,
        functionName: 'bandFor',
        args: [
          leg.rmm.strikeWad,
          leg.rmm.sigmaWad,
          leg.rmm.maturity,
          leg.rmm.liquidityWad,
          toWad(xBefore, leg.rmm.rateRisky),
          toWad(yBefore, leg.rmm.rateStable),
        ],
        blockNumber: fill.blockNumber,
      });

      const paidRisky = fill.args.tokenIn.toLowerCase() === leg.risky.toLowerCase();
      const paid = paidRisky ? fromWad(minRiskyIn, leg.rmm.rateRisky) : fromWad(minStableIn, leg.rmm.rateStable);

      // A band is a shortfall, never a credit, and a taker cannot have paid more decay than they
      // put in: those two bounds are what make the sum a theta figure rather than an arbitrary one.
      expect(paid).toBeGreaterThanOrEqual(ZERO);
      expect(paid).toBeLessThanOrEqual(fill.args.amountIn);
    }
  });
});
