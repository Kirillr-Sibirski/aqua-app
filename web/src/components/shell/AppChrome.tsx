'use client';

/**
 * The frame around the two read-layer surfaces, and nothing else.
 *
 * The app is one screen now — `components/terminal` draws its own 56px bar, because the pair, the
 * spot and the block it was read at belong in it and a shared chrome cannot carry those. What is
 * left here is the wrapper for `/surface` and `/receipt`, which are submission artifacts rather
 * than product screens: they are reachable only from the one line at the bottom of the terminal,
 * and this frame gives them a mark that leads back to it and a wallet control, with no tabs,
 * because there is no set of routes to move between.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NetworkNotice, WalletButton } from '@/components/sell';
import classes from './chrome.module.css';
import { SiteFooter } from './SiteFooter';
import { WordmarkMark } from './Wordmark';

export interface AppChromeProps {
  children: ReactNode;
  /** The block every figure on the page was read at, for a screen that pins its reads to one. */
  blockNumber?: bigint;
  /** Named when the wallet is on a different chain than the one the page reads. */
  readChainName?: string;
}

export function AppChrome({ children, blockNumber, readChainName }: AppChromeProps) {
  return (
    <div className={classes.shell}>
      <a href="#content" className={classes.skip}>
        Skip to content
      </a>

      <header className={classes.bar}>
        <div className={classes.barInner}>
          <Link href="/" className={classes.brand} aria-label="Strikeline, back to the terminal">
            <WordmarkMark />
            <span className={classes.brandText}>strikeline</span>
          </Link>

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

      <main id="content" tabIndex={-1} className={classes.stagePage} style={{ outline: 'none' }}>
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
