'use client';

/**
 * Client boundary for wagmi + TanStack Query.
 *
 * `wagmiConfig` is created with `ssr: true` + cookie storage, so this component renders the same
 * (disconnected) markup on the server and on the first client paint; wagmi then reconnects from the
 * cookie on mount. A server component may also read the cookie itself and pass `initialState`
 * (`cookieToInitialState(wagmiConfig, (await headers()).get('cookie'))`) to skip that round trip —
 * doing so opts the route into dynamic rendering, which is why the root layout does not.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider, type State } from 'wagmi';
import { wagmiConfig } from '@/lib/chain';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Local fork: fresh data matters more than cache hits, but don't hammer on every focus.
        staleTime: 2_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/** One client per browser tab; a fresh one per request on the server. */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export interface ProvidersProps {
  children: ReactNode;
  /** Optional hydration state from `cookieToInitialState`. */
  initialState?: State;
}

export function Providers({ children, initialState }: ProvidersProps) {
  const [queryClient] = useState(getQueryClient);
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState} reconnectOnMount>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

export default Providers;
