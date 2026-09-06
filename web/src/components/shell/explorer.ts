/**
 * Block-explorer links.
 *
 * The app's data chain is a local anvil fork of Base, so the fork carries every Base contract that
 * existed at the pinned block: those addresses resolve on BaseScan and are worth linking. Anything
 * deployed *onto* the fork afterwards (our SwapVM router, a strategy's transaction hash) exists
 * nowhere upstream, and a link to it would be a dead end. Callers say which case they are in with
 * `canonical`; there is deliberately no way to get a link for fork-local state.
 */
import { base, FORK_CHAIN_ID } from '@/lib/chain';

export interface Explorer {
  /** 'Basescan' */
  name: string;
  /** No trailing slash. */
  url: string;
}

const BASE_EXPLORER: Explorer | undefined = base.blockExplorers?.default;

/**
 * The explorer for a chain, or `undefined` when there is none to link to.
 * Chain 31337 resolves to Base's explorer because it is a fork of Base state.
 */
export function explorerFor(chainId: number | undefined): Explorer | undefined {
  if (chainId === base.id) return BASE_EXPLORER;
  if (chainId === FORK_CHAIN_ID) return BASE_EXPLORER;
  return undefined;
}

/** True when `chainId` is the fork, where only pre-fork (upstream Base) state is on the explorer. */
export function isForkOfBase(chainId: number | undefined): boolean {
  return chainId === FORK_CHAIN_ID;
}

export function addressUrl(explorer: Explorer, address: string): string {
  return `${explorer.url}/address/${address}`;
}

export function txUrl(explorer: Explorer, hash: string): string {
  return `${explorer.url}/tx/${hash}`;
}

export function tokenUrl(explorer: Explorer, address: string): string {
  return `${explorer.url}/token/${address}`;
}

/** The project's source, linked from the footer and from the commit tag. */
export const REPO_URL = 'https://github.com/Kirillr-Sibirski/aqua-app';

/**
 * Commit the running bundle was built from. Both keys are referenced literally so Next can inline
 * them; when neither is set the footer renders no commit line rather than an invented one.
 */
export const COMMIT_SHA: string | undefined =
  process.env.NEXT_PUBLIC_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

export function commitUrl(sha: string): string {
  return `${REPO_URL}/commit/${sha}`;
}

export function blockUrl(explorer: Explorer, blockNumber: number | bigint): string {
  return `${explorer.url}/block/${blockNumber.toString()}`;
}
