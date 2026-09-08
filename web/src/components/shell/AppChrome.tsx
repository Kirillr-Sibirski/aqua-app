'use client';

/**
 * The frame, and there is only one of it.
 *
 * The app used to ship two. `/` and `/offers` rendered a slim bar with two tabs; `/offer/[hash]`,
 * `/surface` and `/receipt` rendered a four-item nav, a network pill, a mobile nav sheet and a
 * second wallet control built on a second component kit. Publishing an offer and then clicking it
 * therefore grew the header from two tabs to four and renamed the tab you came from. That is the
 * "nav bar full of routes" the redesign exists to remove, so both halves now render this.
 *
 * Two tabs and no more:
 *
 *   Make an offer   the card, which is the product
 *   Your offers     the positions view, which appears once this wallet has published something
 *
 * `/surface` and `/receipt` are read-layer demonstrations rather than steps in making an offer, and
 * they are reached from the footer. The wallet control is `sell/WalletButton` on every route, in
 * one variant, so there is never a second primary-looking Connect button 400px from the first.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useHasOffers } from '@/components/offers/useHasOffers';
import { NetworkNotice, WalletButton } from '@/components/sell/WalletButton';
import classes from './chrome.module.css';
import { SiteFooter } from './SiteFooter';
import { WordmarkMark } from './Wordmark';

const TABS = [
  { href: '/', label: 'Make an offer' },
  { href: '/offers', label: 'Your offers' },
] as const;

export interface AppChromeProps {
  children: ReactNode;
  /**
   * `card` centres the 480px card in the viewport, which is the front door. `page` is the 64rem
   * column every other screen uses, matching the bar above it to the pixel.
   */
  layout?: 'card' | 'page';
  /** The block every figure on the page was read at, for a screen that pins its reads to one. */
  blockNumber?: bigint;
  /** Named when the wallet is on a different chain than the one the page reads. */
  readChainName?: string;
}

export function AppChrome({ children, layout = 'page', blockNumber, readChainName }: AppChromeProps) {
  const pathname = usePathname();
  const offers = useHasOffers();

  // The second tab is a claim that there is something behind it. On the front door that claim has
  // to be earned; anywhere else the reader has already navigated past it, so hiding it would strand
  // them. Both conditions are client-only and the bar reflows without shifting the card.
  const showTabs = offers.has || pathname !== '/';

  return (
    <div className={classes.shell}>
      <a href="#content" className={classes.skip}>
        Skip to content
      </a>

      <header className={classes.bar}>
        <div className={classes.barInner}>
          {/* The mark and the word, composed here rather than taken whole, because at 390px the
              bar has to drop the word to fit the tabs and the address beside it. */}
          <Link href="/" className={classes.brand} aria-label="Strikeline, make an offer">
            <WordmarkMark />
            <span className={classes.brandText}>Strikeline</span>
          </Link>

          {showTabs ? (
            <nav aria-label="Primary">
              <ul className={classes.tabs}>
                {TABS.map((tab) => (
                  <li key={tab.href}>
                    <Link
                      href={tab.href}
                      className={classes.tab}
                      aria-current={pathname === tab.href ? 'page' : undefined}
                    >
                      {tab.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <div className={classes.barEnd}>
            {blockNumber === undefined ? null : (
              <span
                className={classes.block}
                title={
                  readChainName
                    ? `Every figure on this page was read at this block on ${readChainName}.`
                    : 'Every figure on this page was read at this block, in one snapshot.'
                }
              >
                <span aria-hidden="true" className={classes.blockDot} />
                block {blockNumber.toString()}
              </span>
            )}
            <WalletButton />
          </div>
        </div>
      </header>

      <div className={classes.notice}>
        <NetworkNotice />
      </div>

      <main
        id="content"
        tabIndex={-1}
        className={layout === 'card' ? classes.stageCard : classes.stagePage}
        style={{ outline: 'none' }}
      >
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
