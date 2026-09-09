/**
 * The frame, and the mark.
 *
 * The app is one screen and draws its own bar; `AppChrome` is what wraps the two read-layer
 * artifacts the footer links to. `SiteFooter` is the app's only navigation, on purpose.
 */
export { AppChrome } from './AppChrome';
export type { AppChromeProps } from './AppChrome';

export { SiteFooter } from './SiteFooter';
export type { SiteFooterProps } from './SiteFooter';

export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { Wordmark, WordmarkMark } from './Wordmark';
export type { WordmarkProps } from './Wordmark';

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
