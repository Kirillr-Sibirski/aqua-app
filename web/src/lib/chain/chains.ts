/**
 * Chain definitions for the app.
 *
 *  - `aquaFork` : the local anvil fork of Base (chain id 31337, http://127.0.0.1:8545 by default).
 *                 Multicall3 lives at the canonical address because the fork carries Base state.
 *  - `base`     : real Base (8453), configured as the second chain so a wallet that is on Base
 *                 can be prompted to switch to the fork.
 *
 * Env (inlined at build time by Next, so every key must be referenced literally):
 *  - NEXT_PUBLIC_RPC_URL       fork RPC       (default http://127.0.0.1:8545)
 *  - NEXT_PUBLIC_BASE_RPC_URL  Base RPC       (default https://mainnet.base.org)
 */
import { defineChain, type Address } from 'viem';
import { base } from 'viem/chains';

export const FORK_CHAIN_ID = 31337;
export const DEFAULT_FORK_RPC_URL = 'http://127.0.0.1:8545';
export const FORK_RPC_URL: string = process.env.NEXT_PUBLIC_RPC_URL ?? DEFAULT_FORK_RPC_URL;
export const BASE_RPC_URL: string = process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org';

/** Same address on Base and Ethereum; present on the fork because it forks Base state. */
export const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const aquaFork = defineChain({
  id: FORK_CHAIN_ID,
  name: 'Aqua Fork (Base)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [FORK_RPC_URL] },
  },
  contracts: {
    // Base's Multicall3 (blockCreated is the Base deployment block; irrelevant on the fork but keeps viem happy).
    multicall3: { address: MULTICALL3_ADDRESS, blockCreated: 5022 },
  },
  testnet: true,
});

export { base };

/** Chains in wagmi order: the fork first (default), Base second. */
export const chains = [aquaFork, base] as const;

export type SupportedChainId = (typeof chains)[number]['id'];

export function isForkChainId(chainId: number | undefined): chainId is typeof FORK_CHAIN_ID {
  return chainId === FORK_CHAIN_ID;
}
