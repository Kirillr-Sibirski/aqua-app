import type { Metadata } from 'next';
import Link from 'next/link';
import { Temple } from '@/components/landing/Temple';
import classes from './landing.module.css';

export const metadata: Metadata = {
  title: 'Strikeline · Name your price. Get paid to wait.',
  description:
    'Sell your ETH at a price you choose. Buyers pay you more every day it waits. Your ETH never leaves your wallet.',
};

const REPO = 'https://github.com/Kirillr-Sibirski/strikeline';

function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6.16 21.74 14.91 10.26" fill="none" stroke="var(--ink)" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M14.91 10.26H25.84" fill="none" stroke="var(--accent)" strokeWidth="3.6" strokeLinecap="round" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className={classes.page}>
      {/* The ground: a covered call's payoff, drawn large and dim — up to the strike, then flat. */}
      <svg className={classes.field} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1="0" x2="1600" y1={120 + i * 90} y2={120 + i * 90} className={classes.level} />
        ))}
        <path className={classes.payoff} d="M-40 860 L760 300 H1640" />
      </svg>

      <header className={classes.bar}>
        <Link href="/" className={classes.brand}>
          <Mark />
          strikeline
        </Link>
        <nav className={classes.nav} aria-label="Primary">
          <Link href="/docs">Docs</Link>
          <Link href="/app" className={classes.navCta}>
            Open the app
          </Link>
        </nav>
      </header>

      <main>
        <section className={classes.hero}>
          <div className={classes.copy}>
            <h1 className={classes.headline}>
              <span>Name your price.</span>
              <span>
                Get paid to <em>wait.</em>
              </span>
            </h1>
            <p className={classes.sub}>
              Sell your ETH at a price you choose. Buyers pay you more every day it waits. Your ETH never
              leaves your wallet.
            </p>
            <div className={classes.actions}>
              <Link href="/app" className={classes.cta}>
                Open the app
              </Link>
              <Link href="/docs" className={classes.textLink}>
                How it works <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ul className={classes.chips}>
              <li>Official 1inch Aqua registry</li>
              <li>0.10% protocol fee</li>
              <li>Non-custodial</li>
            </ul>
          </div>

          <div className={classes.art}>
            <Temple className={classes.temple} />
          </div>
        </section>

        <section className={classes.blocks}>
          <article className={classes.block}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={classes.glyph}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v10M9 9.5h4.5a2 2 0 0 1 0 4H10a2 2 0 0 0 0 4h5" />
            </svg>
            <h2>Who pays you</h2>
            <p>Traders on 1inch Aqua. Buying from you costs more each day nobody does.</p>
          </article>
          <article className={classes.block}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={classes.glyph}>
              <path d="M3 19h4v-4h4v-4h4V7h6" />
            </svg>
            <h2>A little at a time</h2>
            <p>Your offer sells as the price rises. At expiry, the rest sells at your price.</p>
          </article>
          <article className={classes.block}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={classes.glyph}>
              <path d="M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10h18L12 4z" />
            </svg>
            <h2>Built on 1inch</h2>
            <p>Two new SwapVM instructions, settling on the official Aqua registry.</p>
          </article>
        </section>
      </main>

      <footer className={classes.footer}>
        <span>ETHGlobal ETHOnline 2026</span>
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
}
