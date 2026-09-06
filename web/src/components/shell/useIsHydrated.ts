'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` on the server and during the hydration render, `true` from the first client commit.
 *
 * Wallet state, block numbers and clipboard support are all browser-only, and none of them exist
 * when the HTML is generated. Reading them during render would make the server markup and the
 * hydration markup disagree, which React reports as a mismatch and repairs by throwing the server
 * tree away. Gating on this hook keeps the two renders byte-identical and moves the live values
 * into the commit that follows — the same contract `useSyncExternalStore` gives any external store.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
