/**
 * The mark, the chain, and the two hooks the one screen needs before it can render.
 *
 * There is no app chrome here any more, because there is no second route to wrap: the terminal
 * draws its own 56px bar and its own footer line, and both of those belong to it — the pair, the
 * spot and the block they were read at cannot be carried by a shared frame.
 */
export { WordmarkMark } from './Wordmark';

export { explorerFor, isForkOfBase, addressUrl, commitUrl, REPO_URL, COMMIT_SHA } from './explorer';
export type { Explorer } from './explorer';

export { useDeploymentChain } from './useDeploymentChain';
export type { DeploymentChain } from './useDeploymentChain';

export { useIsHydrated } from './useIsHydrated';
