'use client';

import { useDeployments } from '@/hooks';
import { cn, formatUnits } from '@/lib/ui';
import {
  addressUrl,
  blockUrl,
  COMMIT_SHA,
  commitUrl,
  explorerFor,
  isForkOfBase,
  REPO_URL,
} from './explorer';
import { ShellAddress, ShellExplorerLink, ShellSkeleton } from './primitives';
import { useDeploymentChain } from './useDeploymentChain';
import { useIsHydrated } from './useIsHydrated';

interface ContractEntry {
  label: string;
  address: string;
  /** True when the address also exists upstream on Base, so an explorer link goes somewhere. */
  canonical: boolean;
}

/**
 * What the app is pointed at, in the place a maker looks when they want to check it themselves:
 * the three contracts it calls, the block the fork was cut at, and the commit this bundle was built
 * from. Fork-local deployments are labelled as such and carry no explorer link, because there is
 * nothing upstream for the link to reach.
 */
export function Footer({ className }: { className?: string }) {
  const hydrated = useIsHydrated();
  const { deployments, error, url } = useDeployments();
  const { chainId, name } = useDeploymentChain();
  const explorer = explorerFor(chainId);
  const forked = isForkOfBase(chainId);

  const contracts: ContractEntry[] = deployments
    ? [
        { label: 'Aqua', address: deployments.aqua, canonical: true },
        { label: 'SwapVM router', address: deployments.officialRouter, canonical: true },
        { label: 'App router', address: deployments.router, canonical: !forked },
      ]
    : [];

  return (
    <footer className={cn('mt-16 border-t border-line', className)}>
      <div className="mx-auto w-full max-w-page px-6 py-8">
        <div className="flex flex-wrap justify-between gap-x-12 gap-y-8">
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            {!hydrated || (!deployments && !error)
              ? [0, 1, 2].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <ShellSkeleton className="h-3 w-20" />
                    <ShellSkeleton className="h-4 w-36" />
                  </div>
                ))
              : contracts.map((c) => (
                  <div key={c.label}>
                    <dt className="text-mini text-ink-3">{c.label}</dt>
                    <dd className="mt-0.5 flex items-center gap-2">
                      <ShellAddress
                        value={c.address}
                        href={c.canonical && explorer ? addressUrl(explorer, c.address) : undefined}
                      />
                      {!c.canonical ? (
                        <span
                          className="text-mini text-ink-3"
                          title="Deployed onto the local fork after the fork block, so it exists on no public explorer"
                        >
                          fork only
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ))}
          </dl>

          <div className="flex flex-col items-start gap-2 text-mini text-ink-3">
            {hydrated && error ? (
              <p className="text-warn">
                No deployment manifest at {url}. Addresses fall back to the NEXT_PUBLIC_* environment.
              </p>
            ) : null}

            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Fork block</span>
              {hydrated && deployments ? (
                explorer ? (
                  <ShellExplorerLink href={blockUrl(explorer, deployments.blockNumber)}>
                    <span className="font-mono tnum">{formatUnits(BigInt(deployments.blockNumber), 0)}</span>
                  </ShellExplorerLink>
                ) : (
                  <span className="font-mono tnum text-ink-2">
                    {formatUnits(BigInt(deployments.blockNumber), 0)}
                  </span>
                )
              ) : (
                <ShellSkeleton className="inline-block h-3.5 w-20 align-middle" />
              )}
              <span aria-hidden="true">·</span>
              <span>{name}</span>
            </p>

            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {COMMIT_SHA ? (
                <>
                  <span>Commit</span>
                  <ShellExplorerLink href={commitUrl(COMMIT_SHA)}>
                    <span className="font-mono tnum">{COMMIT_SHA.slice(0, 7)}</span>
                  </ShellExplorerLink>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <ShellExplorerLink href={REPO_URL}>Source on GitHub</ShellExplorerLink>
            </p>

            <p className="max-w-md leading-prose">
              Aqua records allowances, not deposits. Tokens stay in the maker&rsquo;s wallet until a
              trade pulls them.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
