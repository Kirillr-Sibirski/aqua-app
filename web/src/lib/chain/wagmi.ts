/**
 * wagmi v3 config: local Aqua fork (31337) + Base (8453), injected wallets (MetaMask / Rabby via
 * EIP-6963 discovery + generic window.ethereum) and a burner "demo mode" connector.
 *
 * SSR: `ssr: true` + cookie storage. `app/layout.tsx` reads the cookie on the server with
 * `cookieToInitialState` and hands it to `<Providers initialState>` so the connected state hydrates
 * without a flash; `providers.tsx` is the 'use client' boundary.
 */
import { cookieStorage, createConfig, createStorage, http, injected } from 'wagmi';
import { aquaFork, base, BASE_RPC_URL, FORK_RPC_URL } from './chains';
import { burner, DEMO_PRIVATE_KEY } from './burner';

export function createWagmiConfig(options: { demoPrivateKey?: `0x${string}` } = {}) {
  return createConfig({
    chains: [aquaFork, base],
    connectors: [
      injected({ shimDisconnect: true }),
      burner({ privateKey: options.demoPrivateKey ?? DEMO_PRIVATE_KEY, name: 'Demo mode (burner key)' }),
    ],
    transports: {
      [aquaFork.id]: http(FORK_RPC_URL, { batch: true }),
      [base.id]: http(BASE_RPC_URL, { batch: true }),
    },
    ssr: true,
    storage: createStorage({ storage: cookieStorage, key: 'aqua-wagmi' }),
    multiInjectedProviderDiscovery: true,
  });
}

/** Module singleton; safe to create on the server because `ssr: true` defers all browser access. */
export const wagmiConfig = createWagmiConfig();

export type WagmiConfig = typeof wagmiConfig;

declare module 'wagmi' {
  interface Register {
    config: WagmiConfig;
  }
}
