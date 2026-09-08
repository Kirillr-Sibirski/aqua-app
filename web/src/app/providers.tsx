'use client';

/**
 * Client boundary for Mantine, wagmi and TanStack Query.
 *
 * Nesting order, and why:
 *
 *   MantineProvider    outermost, because ModalsProvider and Notifications both read its
 *                      context, and because its CSS-variable `<style>` should be in the tree
 *                      before anything that renders a Mantine component.
 *   ModalsProvider     needs Mantine, provides `modals.open*` to everything below.
 *   Notifications      the toast viewport; one per app, rendered once here.
 *   WagmiProvider      chain state.
 *   QueryClientProvider wagmi's async cache.
 *
 * `wagmiConfig` is created with `ssr: true` + cookie storage, so this component renders the same
 * (disconnected) markup on the server and on the first client paint; wagmi then reconnects from the
 * cookie on mount. A server component may also read the cookie itself and pass `initialState`
 * (`cookieToInitialState(wagmiConfig, (await headers()).get('cookie'))`) to skip that round trip —
 * doing so opts the route into dynamic rendering, which is why the root layout does not.
 */
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider, type State } from 'wagmi';
import { cssVariablesResolver, theme } from '@/components/theme';
import { wagmiConfig } from '@/lib/chain';
import { Z } from '@/lib/ui/tokens';

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
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      // The app has one theme. Forcing it means Mantine never reads localStorage or the OS
      // setting, which is also why `ColorSchemeScript` in the layout cannot flash.
      forceColorScheme="light"
      defaultColorScheme="light"
    >
      <ModalsProvider>
        <Notifications position="bottom-right" limit={4} zIndex={Z.toast} />
        <WagmiProvider config={wagmiConfig} initialState={initialState} reconnectOnMount>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
      </ModalsProvider>
    </MantineProvider>
  );
}

export default Providers;
