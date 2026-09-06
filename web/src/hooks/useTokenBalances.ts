import { useMemo } from 'react';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { useBalance, useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';

export interface TokenBalance {
  token: Address;
  balance: bigint;
  decimals: number;
  symbol: string;
  formatted: string;
  /** Set when one of the three calls (balanceOf/decimals/symbol) failed. */
  error?: string;
}

export interface UseTokenBalancesOptions {
  chainId?: SupportedChainId;
  /** ms, or false to disable polling (default 4000). */
  refetchInterval?: number | false;
  /** Also read the native ETH balance (default true). */
  includeNative?: boolean;
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * ERC-20 balances (+ decimals/symbol) for `tokens` in one multicall, plus the native balance.
 * The token list is keyed by its lowercase join so callers need not memoise the array.
 */
export function useTokenBalances(address: Address | undefined, tokens: readonly Address[], options: UseTokenBalancesOptions = {}) {
  const chainId = options.chainId ?? aquaFork.id;
  const refetchInterval = options.refetchInterval ?? 4000;
  const tokensKey = tokens.map((t) => t.toLowerCase()).join(',');
  const tokenList = useMemo(() => (tokensKey ? (tokensKey.split(',') as Address[]) : []), [tokensKey]);

  const contracts = useMemo(
    () =>
      tokenList.flatMap((token) => [
        { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address ?? ZERO_ADDRESS], chainId } as const,
        { address: token, abi: erc20Abi, functionName: 'decimals', chainId } as const,
        { address: token, abi: erc20Abi, functionName: 'symbol', chainId } as const,
      ]),
    [tokenList, address, chainId],
  );

  const query = useReadContracts({
    contracts,
    allowFailure: true,
    query: { enabled: !!address && tokenList.length > 0, refetchInterval },
  });

  const native = useBalance({
    address,
    chainId,
    query: { enabled: !!address && options.includeNative !== false, refetchInterval },
  });

  const balances = useMemo<TokenBalance[]>(() => {
    const data = query.data;
    if (!data) return [];
    return tokenList.map((token, i) => {
      const [b, d, s] = data.slice(i * 3, i * 3 + 3);
      const balance = b?.status === 'success' ? (b.result as bigint) : BigInt(0);
      const decimals = d?.status === 'success' ? Number(d.result) : 18;
      const symbol = s?.status === 'success' ? String(s.result) : `${token.slice(0, 6)}…`;
      const failed = [b, d, s].find((r) => r?.status === 'failure');
      return {
        token,
        balance,
        decimals,
        symbol,
        formatted: formatUnits(balance, decimals),
        ...(failed && failed.status === 'failure' ? { error: failed.error.message } : {}),
      };
    });
  }, [query.data, tokenList]);

  return {
    balances,
    native: native.data,
    isLoading: query.isLoading || native.isLoading,
    error: query.error ?? native.error,
    refetch: () => Promise.all([query.refetch(), native.refetch()]),
  };
}
