import type { Metadata } from 'next';
import Link from 'next/link';
import { Instrument_Serif } from 'next/font/google';
import { Temple } from '@/components/landing/Temple';
import classes from './landing.module.css';

const serif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Strikeline · Name your price. Get paid to wait.',
  description:
    'Post an offer to sell your ETH at a price you choose. Traders pay a little more every day nobody takes it. Your ETH never leaves your wallet.',
};

const REPO = 'https://github.com/Kirillr-Sibirski/strikeline';

export default function LandingPage() {
  return (
    <div className={`${classes.page} ${serif.variable}`}>
      <header className={classes.bar}>
        <Link href="/" className={classes.brand}>
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6.16 21.74 14.91 10.26" fill="none" stroke="#0e1a2b" strokeWidth="3.6" strokeLinecap="round" />
            <path d="M14.91 10.26H25.84" fill="none" stroke="#4ed5d5" strokeWidth="3.6" strokeLinecap="round" />
          </svg>
          strikeline
        </Link>
        <nav className={classes.nav} aria-label="Primary">
          <Link href="/docs">How it works</Link>
          <a href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <Link href="/app" className={classes.navCta}>
            Open the app
          </Link>
        </nav>
      </header>

      <main>
        <section className={classes.hero}>
          <div className={classes.copy}>
            <p className={classes.kicker}>Covered calls on 1inch Aqua</p>
            <h1 className={classes.headline}>
              Name your price. Get paid to <em>wait.</em>
            </h1>
            <p className={classes.sub}>
              Post an offer to sell your ETH at a price you choose. Traders pay a little more every day
              nobody takes it. Your ETH never leaves your wallet.
            </p>
            <div className={classes.actions}>
              <Link href="/app" className={classes.cta}>
                Open the app <span aria-hidden="true">→</span>
              </Link>
              <Link href="/docs" className={classes.textLink}>
                How it works
              </Link>
            </div>
          </div>

          <div className={classes.art}>
            <Temple className={classes.temple} />
          </div>

          <ul className={classes.labels}>
            <li>Official Aqua registry</li>
            <li>0.10% protocol fee</li>
            <li>ETH stays in your wallet</li>
          </ul>
        </section>

        <section className={classes.sections}>
          <article className={classes.section}>
            <p className={classes.sectionKicker}>Who pays you</p>
            <h2>Buyers, for the wait.</h2>
            <p>
              Traders and bots swapping on 1inch Aqua can buy from your offer. Buying from you costs a
              little more every day nobody does. No trade, no pay.
            </p>
          </article>
          <article className={classes.section}>
            <p className={classes.sectionKicker}>How it works</p>
            <h2>A little at a time.</h2>
            <p>
              Your offer sells a little as the price rises and buys back if it falls. At expiry the rest
              sells at your price. You can offer to buy ETH lower, too.
            </p>
          </article>
          <article className={classes.section}>
            <p className={classes.sectionKicker}>Built on 1inch</p>
            <h2>Aqua and SwapVM.</h2>
            <p>
              Offers live on the official Aqua registry, priced by two new SwapVM instructions, with a
              0.10% protocol fee on each fill.{' '}
              <a href={REPO} target="_blank" rel="noreferrer">
                Read the code
              </a>
            </p>
          </article>
        </section>
      </main>

      <footer className={classes.footer}>
        <span>ETHGlobal ETHOnline 2026</span>
        <Link href="/app">Open the app →</Link>
      </footer>
    </div>
  );
}
