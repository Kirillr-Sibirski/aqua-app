'use client';

/**
 * The frame the positions view sits in: a slim bar, two tabs, the wallet, and the block.
 *
 * DESIGN.md gives the front door "a slim bar with the wordmark, the network state and the wallet
 * button. Nothing else." The positions view is the second tab of that same bar, so it carries the
 * same bar plus the one thing the front door has no use for: **the block number every figure below
 * was read at.** That is not decoration. `useBook` pins two multicall rounds and a log replay to one
 * block so a fill moves the bar and its rows together instead of drifting in as separate pollers
 * fire, and the pill is where that claim is stated in the open.
 *
 * Two tabs and no more. A nav bar full of routes is what the redesign is removing.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/shell/Wordmark';
import { NetworkGuard, WalletCluster } from '@/components/wallet';
import { cn } from '@/lib/ui';

interface Tab {
  href: string;
  label: string;
}

const TABS: readonly Tab[] = [
  { href: '/', label: 'Make an offer' },
  { href: '/offers', label: 'Your offers' },
];

export interface OffersChromeProps {
  children: ReactNode;
  /** The block every number on the page was read at. Omitted while the first block is pending. */
  blockNumber?: bigint;
  /** Named when the wallet is on a different chain than the one the page reads. */
  readChainName?: string;
}

export function OffersChrome({ children, blockNumber, readChainName }: OffersChromeProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#content"
        className={cn(
          'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-toast',
          'focus:rounded-control focus:border focus:border-line focus:bg-surface focus:px-3 focus:py-2',
          'focus:text-meta focus:text-ink',
        )}
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-app-bar border-b border-line bg-bg">
        {/* Two rows on a phone, one on everything else. At 390px the mark, two tabs and a wallet
            pill do not fit on one line: the tabs were the thing that lost, and a clipped "Yo…"
            where the current tab should be is worse than a second row. */}
        <div className="mx-auto flex w-full max-w-page flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:h-header sm:flex-nowrap sm:gap-6 sm:px-6 sm:py-0">
          <Wordmark />

          <nav aria-label="Primary" className="order-last w-full min-w-0 sm:order-none sm:w-auto">
            <ul className="flex items-center gap-1 rounded-pill bg-surface-2 p-1">
              {TABS.map((tab) => {
                const current = pathname === tab.href;
                return (
                  <li key={tab.href} className="flex-1 sm:flex-none">
                    <Link
                      href={tab.href}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'block rounded-pill px-3 py-1.5 text-center text-meta whitespace-nowrap transition-state sm:px-4',
                        current
                          ? 'bg-surface text-ink shadow-(--shadow-card)'
                          : 'text-ink-2 hover:text-ink',
                      )}
                    >
                      {tab.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {blockNumber === undefined ? null : (
              <span
                className="hidden items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1 font-mono text-mini tnum text-ink-2 lg:inline-flex"
                title={
                  readChainName
                    ? `Every figure on this page was read at this block on ${readChainName}.`
                    : 'Every figure on this page was read at this block, in one snapshot.'
                }
              >
                <span aria-hidden="true" className="size-1.5 rounded-pill bg-pos" />
                block {blockNumber.toString()}
              </span>
            )}
            <WalletCluster />
          </div>
        </div>
      </header>

      <NetworkGuard className="mx-auto w-full max-w-page px-4 pt-4 sm:px-6" />

      <main
        id="content"
        tabIndex={-1}
        className="mx-auto w-full max-w-page flex-1 px-4 py-6 focus-visible:outline-none sm:px-6 sm:py-8"
      >
        {children}
      </main>
    </div>
  );
}
