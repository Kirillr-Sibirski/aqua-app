import { useCallback } from 'react';
import { decodeEventLog, erc20Abi, maxUint256, type Address, type Hex } from 'viem';
import { useConfig, useConnection, useWriteContract } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { aquaFork } from '@/lib/chain';
import { tokenInfo } from '@/lib/contracts';
import { buildTakerTraits, decodeOrder, swapVmAbi, type Order } from '@/lib/swapvm';
import { useDeployments } from './useDeployments';
import { useTxFlow, type TxPlanStep } from './useTxFlow';

export interface SwapParams {
  order: Order;
  /** amountIn when `isExactIn` (default), otherwise amountOut. */
  amount: bigint;
  /** true: tokenA -> tokenB. */
  isAToB: boolean;
  isExactIn?: boolean;
  /** min amountOut (exactIn) / max amountIn (exactOut). Omitted => no threshold check. */
  threshold?: bigint;
  /** uint40 unix seconds; 0 / undefined = no deadline. */
  deadline?: bigint;
  /** Pre-built taker traits blob; when given, the flags above are ignored. */
  takerTraits?: Hex;
}

export interface SwapResult {
  hash: Hex;
  /** Taker-traits blob that was sent (useful for replaying the quote). */
  takerTraits: Hex;
  tokenIn: Address;
  tokenOut: Address;
  /** Decoded from the router's `Swapped` event (undefined if the event is missing). */
  amountIn?: bigint;
  amountOut?: bigint;
  orderHash?: Hex;
}

/**
 * Taker traits for the Aqua path: `useTransferFromAndAquaPush` makes the router pull tokenIn from
 * the taker (`transferFrom`) and push it into Aqua, so the taker only has to approve the router.
 */
export function buildSwapTakerTraits(params: SwapParams & { taker: Address }): Hex {
  if (params.takerTraits) return params.takerTraits;
  return buildTakerTraits({
    taker: params.taker,
    isExactIn: params.isExactIn ?? true,
    isAToB: params.isAToB,
    threshold: params.threshold ?? null,
    deadline: params.deadline ?? BigInt(0),
    useTransferFromAndAquaPush: true,
  });
}

/**
 * Taker flow: `approve(tokenIn → router)` when the allowance is short, then
 * `router.swap(order, amount, takerTraitsAndData)`. Per-step hashes and receipts live in `steps`.
 */
export function useSwap() {
  const chainId = aquaFork.id;
  const config = useConfig();
  const { deployments } = useDeployments();
  const { address } = useConnection();
  const { mutateAsync: writeContract } = useWriteContract();
  const { run, steps, isRunning, error, reset } = useTxFlow(chainId);

  const swap = useCallback(
    async (params: SwapParams): Promise<SwapResult> => {
      if (!deployments) throw new Error('deployments not loaded');
      if (!address) throw new Error('wallet not connected');
      const { tokenA, tokenB } = decodeOrder(params.order);
      const tokenIn = params.isAToB ? tokenA : tokenB;
      const tokenOut = params.isAToB ? tokenB : tokenA;
      const takerTraits = buildSwapTakerTraits({ ...params, taker: address });
      // How much tokenIn the swap may pull, used only to decide whether an approve is needed.
      // exactIn: exactly `amount`. exactOut: at most `threshold` — and with no cap given, `amount`
      // is denominated in tokenOut, so it says nothing about tokenIn: require a full approval.
      const spend = (params.isExactIn ?? true) ? params.amount : (params.threshold ?? maxUint256);

      const plan: TxPlanStep[] = [
        {
          label: `approve ${tokenInfo(tokenIn, deployments).symbol} → router`,
          send: async () => {
            const allowance = await readContract(config, {
              address: tokenIn,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [address, deployments.router],
              chainId,
            });
            if (allowance >= spend) return undefined;
            return writeContract({
              address: tokenIn,
              abi: erc20Abi,
              functionName: 'approve',
              args: [deployments.router, maxUint256],
              chainId,
            });
          },
        },
        {
          label: 'router.swap',
          send: () =>
            writeContract({
              address: deployments.router,
              abi: swapVmAbi,
              functionName: 'swap',
              args: [params.order, params.amount, takerTraits],
              chainId,
            }),
        },
      ];

      const done = await run(plan);
      const last = done[done.length - 1];
      if (!last?.hash) throw new Error('swap did not produce a transaction hash');

      let amountIn: bigint | undefined;
      let amountOut: bigint | undefined;
      let orderHash: Hex | undefined;
      for (const log of last.receipt?.logs ?? []) {
        try {
          const event = decodeEventLog({ abi: swapVmAbi, data: log.data, topics: log.topics });
          if (event.eventName === 'Swapped') {
            const args = event.args as unknown as { amountIn: bigint; amountOut: bigint; orderHash: Hex };
            amountIn = args.amountIn;
            amountOut = args.amountOut;
            orderHash = args.orderHash;
          }
        } catch {
          // not one of ours
        }
      }

      return { hash: last.hash, takerTraits, tokenIn, tokenOut, amountIn, amountOut, orderHash };
    },
    [deployments, address, config, writeContract, run, chainId],
  );

  return { swap, steps, isRunning, error, reset };
}

export type UseSwapReturn = ReturnType<typeof useSwap>;
