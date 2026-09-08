'use client';

/**
 * Shipping the book.
 *
 * One approval per token to the **official Aqua registry** — not to our router — because `Aqua.pull`
 * is what calls `transferFrom(maker, taker, amount)` at fill time. Then one `Aqua.ship` per leg.
 *
 * There is no `Aqua.multicall`: the deployed registry at
 * `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` exposes `ship`, `dock`, `push`, `pull` and the two
 * balance getters and nothing else. So a four-leg book is four transactions, and the stepper says so
 * rather than implying an atomicity that does not exist. A partially shipped book is a real state,
 * and it is a safe one: each leg stands on its own, and the ones that landed are already quoting.
 *
 * `ship` moves no tokens. It writes the virtual balance and emits `Shipped` plus a `Pushed` per
 * token; the maker's wallet is untouched until someone actually fills. That is what the receipt
 * check on the review panel is asserting.
 */
import { useCallback } from 'react';
import { erc20Abi, maxUint256, type Address, type Hex } from 'viem';
import { useConfig, useConnection, useWriteContract } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { aquaFork } from '@/lib/chain';
import { aquaAbi } from '@/lib/contracts';
import { encodeStrategyForShip } from '@/lib/swapvm';
import { useTxFlow, type TxPlanStep } from '@/hooks';
import type { SizedLeg, WritePair } from './types';

export interface ShipBookParams {
  aqua: Address;
  router: Address;
  pair: WritePair;
  legs: readonly SizedLeg[];
  /** Totals in raw units, used only to decide whether an approval is needed. */
  riskyNeeded: bigint;
  stableNeeded: bigint;
}

export interface ShippedBook {
  hashes: Hex[];
  strategyHashes: Hex[];
}

export function useShipBook() {
  const chainId = aquaFork.id;
  const config = useConfig();
  const { address } = useConnection();
  const { mutateAsync: writeContract } = useWriteContract();
  const { run, steps, isRunning, error, reset } = useTxFlow(chainId);

  const ship = useCallback(
    async ({ aqua, router, pair, legs, riskyNeeded, stableNeeded }: ShipBookParams): Promise<ShippedBook> => {
      if (!address) throw new Error('wallet not connected');
      if (legs.length === 0) throw new Error('nothing to ship');

      const approvals: TxPlanStep[] = (
        [
          [pair.risky, riskyNeeded],
          [pair.stable, stableNeeded],
        ] as const
      )
        .filter(([, needed]) => needed > BigInt(0))
        .map(([token, needed]) => ({
          label: `Approve ${token.symbol} to Aqua`,
          send: async () => {
            const allowance = await readContract(config, {
              address: token.address,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [address, aqua],
              chainId,
            });
            // The allowance is what `Coverage` reads as half of the deliverable bound, so an
            // existing sufficient one is left alone rather than reset and re-granted.
            if (allowance >= needed) return undefined;
            return writeContract({
              address: token.address,
              abi: erc20Abi,
              functionName: 'approve',
              args: [aqua, maxUint256],
              chainId,
            });
          },
        }));

      const ships: TxPlanStep[] = legs.map((leg, i) => ({
        label: `Ship leg ${i + 1} · K ${leg.draft.strike}`,
        send: () =>
          writeContract({
            address: aqua,
            abi: aquaAbi,
            functionName: 'ship',
            args: [
              router,
              encodeStrategyForShip(leg.order),
              [...leg.tokens],
              [...leg.amounts],
            ],
            chainId,
          }),
      }));

      const done = await run([...approvals, ...ships]);
      return {
        hashes: done.filter((s) => s.hash).map((s) => s.hash as Hex),
        strategyHashes: legs.map((leg) => leg.strategyHash),
      };
    },
    [address, config, writeContract, run, chainId],
  );

  return { ship, steps, isRunning, error, reset };
}
