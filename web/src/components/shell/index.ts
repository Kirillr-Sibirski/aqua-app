/**
 * The frame. One import for anything that draws chrome around a screen.
 */
export { AppShell } from './AppShell';
export type { AppShellProps } from './AppShell';

export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { Footer } from './Footer';
export { NavBar } from './NavBar';
export { NetworkPill } from './NetworkPill';
export { Wordmark, WordmarkMark } from './Wordmark';
export type { WordmarkProps } from './Wordmark';

export { NAV_ITEMS, readyNavItems, isNavItemActive } from './nav';
export type { NavItem } from './nav';

export {
  explorerFor,
  isForkOfBase,
  addressUrl,
  txUrl,
  tokenUrl,
  blockUrl,
  commitUrl,
  REPO_URL,
  COMMIT_SHA,
} from './explorer';
export type { Explorer } from './explorer';

export { useDeploymentChain } from './useDeploymentChain';
export type { DeploymentChain } from './useDeploymentChain';

export { useIsHydrated } from './useIsHydrated';
