'use client';

/**
 * One quiet line at the bottom of the screen, and the only navigation in the app.
 *
 * It carries two things and nothing else. First, the two read-layer surfaces — the market rebuilt
 * from the chain's own log, and the markout study. They are submission artifacts rather than
 * product screens, and this is deliberately the only way to reach either: putting them in a nav bar
 * is most of what made the old header read like a site's. Second, what the app is pointed at: the
 * chain, the router it calls, and the commit this bundle was built from, because a person checking
 * a number for themselves needs the address to check it against.
 *
 * Fork-local addresses carry no explorer link. Nothing deployed onto the fork after the pinned
 * block exists upstream, so the link would be a dead end.
 */
import Link from 'next/link';
import { useDeployments } from '@/hooks';
import { truncateAddress } from '@/lib/ui';
import classes from './chrome.module.css';
import { addressUrl, COMMIT_SHA, commitUrl, explorerFor, isForkOfBase, REPO_URL } from './explorer';
import { useDeploymentChain } from './useDeploymentChain';
import { useIsHydrated } from './useIsHydrated';

export interface SiteFooterProps {
  /** Full-bleed, for the terminal, which has no 64rem column to line up with. */
  wide?: boolean;
}

export function SiteFooter({ wide = false }: SiteFooterProps) {
  const hydrated = useIsHydrated();
  const { deployments } = useDeployments();
  const { chainId, name } = useDeploymentChain();
  const explorer = explorerFor(chainId);
  const forkLocal = isForkOfBase(chainId);

  return (
    <footer className={classes.footer}>
      <div className={classes.footerInner} data-wide={wide || undefined}>
        <Link href="/surface" className={classes.footerLink}>
          Market
        </Link>
        <Link href="/receipt" className={classes.footerLink}>
          Was it worth it
        </Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={classes.footerLink}>
          Source
        </a>

        <span className={classes.footerEnd}>
          {hydrated && deployments ? (
            <>
              <span>
                {name} · block {deployments.blockNumber.toLocaleString('en-US')}
              </span>
              <span>
                router{' '}
                {explorer && !forkLocal ? (
                  <a
                    href={addressUrl(explorer, deployments.router)}
                    target="_blank"
                    rel="noreferrer"
                    className={classes.footerLink}
                  >
                    {truncateAddress(deployments.router)}
                  </a>
                ) : (
                  truncateAddress(deployments.router)
                )}
              </span>
            </>
          ) : null}
          {COMMIT_SHA ? (
            <a href={commitUrl(COMMIT_SHA)} target="_blank" rel="noreferrer" className={classes.footerLink}>
              {COMMIT_SHA.slice(0, 7)}
            </a>
          ) : null}
        </span>
      </div>
    </footer>
  );
}
