import { useCallback } from 'react';
import { erc20Abi, maxUint256, type Address, type Hex } from 'viem';
import { useConfig, useConnection, useWriteContract } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { aquaFork } from '@/lib/chain';
import { aquaAbi, tokenInfo } from '@/lib/contracts';
import { decodeOrder, encodeStrategyForShip, orderHashAqua, type Order } from '@/lib/swapvm';
import { useDeployments } from './useDeployments';
import { useTxFlow, type TxPlanStep } from './useTxFlow';

export interface ShipParams {
  /** Aqua-mode order whose `maker` is the connected account. */
  order: Order;
  /** Virtual balances in (tokenA, tokenB) order of the order itself. */
  amounts: readonly [bigint, bigint];
}

export interface ShipResult {
  strategyHash: Hex;
  /** Hash of the `Aqua.ship` transaction. */
  hash: Hex;
  tokens: readonly [Address, Address];
}

/**
 * Maker flow: `approve(token → Aqua)` for each token whose allowance is short, then
 * `Aqua.ship(router, abi.encode(order), [tokenA, tokenB], amounts)`. Aqua moves no tokens on ship;
 * the maker's wallet must hold the liquidity because `Aqua.pull` does `transferFrom(maker)` at swap time.
 */
export function useShip() {
  const chainId = aquaFork.id;
  const config = useConfig();
  const { deployments } = useDeployments();
  const { address } = useConnection();
  const { mutateAsync: writeContract } = useWriteContract();
  const { run, steps, isRunning, error, reset } = useTxFlow(chainId);

  const ship = useCallback(
    async ({ order, amounts }: ShipParams): Promise<ShipResult> => {
      if (!deployments) throw new Error('deployments not loaded');
      if (!address) throw new Error('wallet not connected');
      if (order.maker.toLowerCase() !== address.toLowerCase()) throw new Error('order.maker must be the connected account');
      const { tokenA, tokenB } = decodeOrder(order);
      const tokens = [tokenA, tokenB] as const;
      const strategyHash = orderHashAqua(order);

      const plan: TxPlanStep[] = tokens.map((token, i) => ({
        label: `approve ${tokenInfo(token, deployments).symbol} → Aqua`,
        send: async () => {
          const allowance = await readContract(config, {
            address: token,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, deployments.aqua],
            chainId,
          });
          if (allowance >= amounts[i]) return undefined;
          return writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [deployments.aqua, maxUint256], chainId });
        },
      }));
      plan.push({
        label: 'Aqua.ship',
        send: () =>
          writeContract({
            address: deployments.aqua,
            abi: aquaAbi,
            functionName: 'ship',
            args: [deployments.router, encodeStrategyForShip(order), [...tokens], [...amounts]],
            chainId,
          }),
      });

      const done = await run(plan);
      const hash = done[done.length - 1]?.hash;
      if (!hash) throw new Error('ship did not produce a transaction hash');
      return { strategyHash, hash, tokens };
    },
    [deployments, address, config, writeContract, run, chainId],
  );

  return { ship, steps, isRunning, error, reset };
}
