/**
 * The frame. One import for anything that draws chrome around a screen.
 *
 * One chrome, one nav, one wallet control. `AppChrome` replaced a pair of shells that disagreed
 * about how many routes exist — two tabs on the card and the positions view, four items plus a
 * network pill and a second wallet UI everywhere else — which a person saw directly as the header
 * growing when they clicked their own offer.
 */
export { AppChrome } from './AppChrome';
export type { AppChromeProps } from './AppChrome';

export { SiteFooter } from './SiteFooter';

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
