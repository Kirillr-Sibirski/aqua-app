export {
  aquaFork,
  base,
  chains,
  FORK_CHAIN_ID,
  FORK_RPC_URL,
  BASE_RPC_URL,
  DEFAULT_FORK_RPC_URL,
  MULTICALL3_ADDRESS,
  isForkChainId,
} from './chains';
export type { SupportedChainId } from './chains';

export { burner, ANVIL_ACCOUNTS, ANVIL_ACCOUNT_1_PRIVATE_KEY, DEMO_PRIVATE_KEY, BURNER_CONNECTOR_ID } from './burner';
export type { BurnerParameters } from './burner';

export { wagmiConfig, createWagmiConfig } from './wagmi';
export type { WagmiConfig } from './wagmi';
