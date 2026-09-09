'use client';

/**
 * One 24px line under the terminal. It is not navigation, because there is nowhere to go.
 *
 * What it carries is what a person checking a figure for themselves needs to check it against: the
 * chain, the router's address, and the commit this bundle was built from. Nothing else.
 *
 * It deliberately does NOT print a block number. The bar at the top prints the block every figure
 * on the screen was read at, and this line used to print `deployments.blockNumber` under the same
 * word — the manifest's deploy block, hundreds behind and never moving. Two different numbers
 * twenty pixels apart, both labelled "block", on a screen whose whole claim is that it is one
 * snapshot at one block. The deploy block is a property of the deployment, so it is stated as one
 * ("router … deployed 50,946,000") or not at all.
 *
 * Fork-local addresses carry no explorer link: nothing deployed onto the fork after the pinned
 * block exists upstream, so the link would be a dead end.
 */
import { useDeployments } from '@/hooks';
import {
  addressUrl,
  COMMIT_SHA,
  commitUrl,
  explorerFor,
  isForkOfBase,
  REPO_URL,
  useDeploymentChain,
  useIsHydrated,
} from '@/components/shell';
import { formatCount, truncateAddress } from '@/lib/ui';
import classes from './terminal.module.css';

export function TerminalFooter() {
  const hydrated = useIsHydrated();
  const { deployments } = useDeployments();
  const { chainId, name } = useDeploymentChain();
  const explorer = explorerFor(chainId);
  const forkLocal = isForkOfBase(chainId);

  return (
    <footer className={classes.foot}>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className={classes.footLink}>
        Source
      </a>

      <span className={classes.footEnd}>
        {hydrated && deployments ? (
          <>
            <span>{name}</span>
            <span>
              router{' '}
              {explorer && !forkLocal ? (
                <a
                  href={addressUrl(explorer, deployments.router)}
                  target="_blank"
                  rel="noreferrer"
                  className={classes.footLink}
                >
                  {truncateAddress(deployments.router)}
                </a>
              ) : (
                truncateAddress(deployments.router)
              )}
            </span>
            <span>deployed {formatCount(deployments.blockNumber)}</span>
          </>
        ) : null}
        {COMMIT_SHA ? (
          <a href={commitUrl(COMMIT_SHA)} target="_blank" rel="noreferrer" className={classes.footLink}>
            {COMMIT_SHA.slice(0, 7)}
          </a>
        ) : null}
      </span>
    </footer>
  );
}
