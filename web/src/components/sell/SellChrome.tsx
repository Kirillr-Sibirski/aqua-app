'use client';

/**
 * The frame around the card, and it is deliberately almost nothing.
 *
 * A slim bar with the wordmark and the wallet button. No routes, no stat row, no hero. The one
 * thing that can appear beside the mark is the second tab — and only once this wallet actually has
 * offers to look at, which is the rule the redesign turns on: a positions view is worth having and
 * is never what greets a first-time visitor. A disconnected wallet, or a connected one that has not
 * published anything, sees the mark and the card.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { WordmarkMark } from '@/components/shell/Wordmark';
import { useHasOffers } from '@/components/offers/useHasOffers';
import classes from './sell.module.css';
import { WalletButton } from './WalletButton';

const TABS = [
  { href: '/', label: 'Make an offer' },
  { href: '/offers', label: 'Your offers' },
] as const;

export function SellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const offers = useHasOffers();

  return (
    <div className={classes.shell}>
      <header className={classes.bar}>
        <div className={classes.barInner}>
          {/* The mark and the word, composed here rather than taken whole, because at 390px the
              bar has to drop the word to fit the tabs and the address beside it. */}
          <Link href="/" className={classes.brand} aria-label="Strikeline, make an offer">
            <WordmarkMark />
            <span className={classes.brandText}>Strikeline</span>
          </Link>
          {offers.has ? (
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
            <WalletButton />
          </div>
        </div>
      </header>
      <main className={classes.stage}>{children}</main>
    </div>
  );
}
