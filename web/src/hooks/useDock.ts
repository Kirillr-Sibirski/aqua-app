import { useCallback } from 'react';
import type { Address, Hex } from 'viem';
import { useConnection, useWriteContract } from 'wagmi';
import { aquaFork } from '@/lib/chain';
import { aquaAbi } from '@/lib/contracts';
import { decodeOrder, orderHashAqua, type Order } from '@/lib/swapvm';
import { useDeployments } from './useDeployments';
import { useTxFlow } from './useTxFlow';

export interface DockParams {
  /** Strategy to retire; pass the order instead and the hash/tokens are derived from it. */
  strategyHash?: Hex;
  tokens?: readonly Address[];
  order?: Order;
}

export interface DockResult {
  hash: Hex;
  strategyHash: Hex;
  tokens: readonly Address[];
}

/**
 * Maker flow: `Aqua.dock(app = router, strategyHash, tokens)` — zeroes the virtual balances and marks
 * every token `_DOCKED` (tokensCount 0xff), so the strategy can no longer be filled. Only the maker
 * of the strategy can dock it, and a docked strategy hash can never be shipped again.
 */
export function useDock() {
  const chainId = aquaFork.id;
  const { deployments } = useDeployments();
  const { address } = useConnection();
  const { mutateAsync: writeContract } = useWriteContract();
  const { run, steps, isRunning, error, reset } = useTxFlow(chainId);

  const dock = useCallback(
    async (params: DockParams): Promise<DockResult> => {
      if (!deployments) throw new Error('deployments not loaded');
      if (!address) throw new Error('wallet not connected');
      const strategyHash = params.strategyHash ?? (params.order ? orderHashAqua(params.order) : undefined);
      const tokens =
        params.tokens ??
        (params.order ? ([decodeOrder(params.order).tokenA, decodeOrder(params.order).tokenB] as const) : undefined);
      if (!strategyHash) throw new Error('dock: strategyHash or order is required');
      if (!tokens || tokens.length === 0) throw new Error('dock: tokens or order is required');

      const done = await run([
        {
          label: 'Aqua.dock',
          send: () =>
            writeContract({
              address: deployments.aqua,
              abi: aquaAbi,
              functionName: 'dock',
              args: [deployments.router, strategyHash, [...tokens]],
              chainId,
            }),
        },
      ]);
      const hash = done[done.length - 1]?.hash;
      if (!hash) throw new Error('dock did not produce a transaction hash');
      return { hash, strategyHash, tokens };
    },
    [deployments, address, writeContract, run, chainId],
  );

  return { dock, steps, isRunning, error, reset };
}

export type UseDockReturn = ReturnType<typeof useDock>;
