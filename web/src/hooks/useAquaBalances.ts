import { useMemo } from 'react';
import type { Address, Hex } from 'viem';
import { useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { aquaAbi, DOCKED_TOKENS_COUNT, type AquaTokenBalance } from '@/lib/contracts';
import { useDeployments } from './useDeployments';

export interface UseAquaBalancesOptions {
  chainId?: SupportedChainId;
  refetchInterval?: number | false;
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
const ZERO_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * `Aqua.rawBalances(maker, app, strategyHash, token)` for every token in one multicall.
 * `docked` = every token reports tokensCount 0xff; `active` = every token reports 1..254.
 */
export function useAquaBalances(
  maker: Address | undefined,
  app: Address | undefined,
  strategyHash: Hex | undefined,
  tokens: readonly Address[],
  options: UseAquaBalancesOptions = {},
) {
  const chainId = options.chainId ?? aquaFork.id;
  const { deployments } = useDeployments();
  const aqua = deployments?.aqua;
  const tokensKey = tokens.map((t) => t.toLowerCase()).join(',');
  const tokenList = useMemo(() => (tokensKey ? (tokensKey.split(',') as Address[]) : []), [tokensKey]);
  const enabled = !!aqua && !!maker && !!app && !!strategyHash && tokenList.length > 0;

  const contracts = useMemo(
    () =>
      tokenList.map(
        (token) =>
          ({
            address: aqua ?? ZERO_ADDRESS,
            abi: aquaAbi,
            functionName: 'rawBalances',
            args: [maker ?? ZERO_ADDRESS, app ?? ZERO_ADDRESS, strategyHash ?? ZERO_HASH, token],
            chainId,
          }) as const,
      ),
    [tokenList, aqua, maker, app, strategyHash, chainId],
  );

  const query = useReadContracts({
    contracts,
    allowFailure: false,
    query: { enabled, refetchInterval: options.refetchInterval ?? 4000 },
  });

  const balances = useMemo<AquaTokenBalance[]>(() => {
    if (!query.data) return [];
    return tokenList.map((token, i) => {
      const [balance, tokensCount] = query.data[i] as readonly [bigint, number];
      return { token, balance, tokensCount: Number(tokensCount) };
    });
  }, [query.data, tokenList]);

  const docked = balances.length > 0 && balances.every((b) => b.tokensCount === DOCKED_TOKENS_COUNT);
  const active = balances.length > 0 && balances.every((b) => b.tokensCount >= 1 && b.tokensCount < DOCKED_TOKENS_COUNT);

  return { balances, docked, active, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
