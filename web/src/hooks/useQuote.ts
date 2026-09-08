import type { Address, Hex } from 'viem';
import { useReadContract } from 'wagmi';
import { aquaFork } from '@/lib/chain';
import type { Order } from '@/lib/swapvm';
import { quoteWithStrikelineErrorsAbi } from './strikeline';
import { useDeployments } from './useDeployments';

export interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  orderHash: Hex;
}

export interface UseQuoteOptions {
  /** `from` for the eth_call (the prospective taker). */
  taker?: Address;
  enabled?: boolean;
  refetchInterval?: number | false;
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
const PLACEHOLDER_ORDER: Order = { maker: ZERO_ADDRESS, traits: BigInt(0), data: '0x' };

/**
 * `router.quote(order, amount, takerTraitsAndData)` via eth_call. `amount` is amountIn or amountOut
 * depending on the `isExactIn` flag encoded in `takerTraits` (see `buildTakerTraits`).
 *
 * Quoted against `quoteWithStrikelineErrorsAbi`, not the bare view ABI: viem decodes a revert only
 * against the ABI it was handed, and on this app a refusal is usually the answer rather than an
 * outage. Handed `swapVmQuoteViewAbi`, a `NotCovered(needed, free)` or an `RmmInsideSpread` came
 * back as an undecoded `0x…` blob -- which is what the /dev diagnostics page, the one screen where
 * a taker actually fills, was showing.
 */
export function useQuote(order: Order | undefined, amount: bigint | undefined, takerTraits: Hex | undefined, options: UseQuoteOptions = {}) {
  const { deployments } = useDeployments();
  const enabled =
    (options.enabled ?? true) && !!deployments && !!order && amount !== undefined && amount > BigInt(0) && !!takerTraits && takerTraits !== '0x';

  const query = useReadContract({
    address: deployments?.router ?? ZERO_ADDRESS,
    abi: quoteWithStrikelineErrorsAbi,
    functionName: 'quote',
    args: [order ?? PLACEHOLDER_ORDER, amount ?? BigInt(0), takerTraits ?? '0x'],
    account: options.taker,
    chainId: aquaFork.id,
    query: { enabled, refetchInterval: options.refetchInterval ?? false, retry: false },
  });

  const quote: Quote | undefined = query.data ? { amountIn: query.data[0], amountOut: query.data[1], orderHash: query.data[2] } : undefined;

  return { quote, isLoading: query.isLoading, isFetching: query.isFetching, error: query.error, refetch: query.refetch };
}
