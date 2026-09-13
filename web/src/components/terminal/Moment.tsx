'use client';

/**
 * The full-screen moments: an offer placed, an offer withdrawn.
 *
 * Both tell the wordmark's story. Placed draws the rising stroke and launches the cyan strike line off
 * the right edge; withdrawn runs it backwards — the line comes in from the right, retracts into the
 * corner as it greys out, and the rise un-draws. About 1.8s, dismissed early by a click or Esc, and a
 * still toast under reduced motion. Rendered in a portal so nothing in the terminal can clip it.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import classes from './terminal.module.css';

export type MomentKind = 'placed' | 'withdrawn';

export interface MomentSpec {
  kind: MomentKind;
  figures: string;
  sub?: string;
}

const TITLE: Record<MomentKind, string> = { placed: 'Offer placed', withdrawn: 'Offer withdrawn' };
const DURATION: Record<MomentKind, number> = { placed: 1850, withdrawn: 1650 };

export function useMoment(): { play: (spec: MomentSpec) => void; node: ReactNode } {
  const [shot, setShot] = useState<(MomentSpec & { key: number; still: boolean }) | null>(null);

  useEffect(() => {
    if (!shot) return;
    const t = window.setTimeout(() => setShot(null), shot.still ? 1500 : DURATION[shot.kind]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShot(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [shot]);

  const play = (spec: MomentSpec) => {
    if (typeof window === 'undefined') return;
    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setShot({ ...spec, key: Date.now(), still });
  };

  const node =
    shot && typeof document !== 'undefined'
      ? createPortal(
          <div
            key={shot.key}
            className={classes.placed}
            data-kind={shot.kind}
            data-still={shot.still || undefined}
            role="status"
            aria-live="polite"
            onClick={() => setShot(null)}
          >
            <svg className={classes.placedArt} viewBox="0 0 1000 400" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
              <path className={classes.placedRise} d="M120 330 L300 200" pathLength={1} />
            </svg>
            <span className={classes.placedLine} aria-hidden="true" />
            <div className={classes.placedLabel}>
              <span className={classes.placedCheck} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  {shot.kind === 'withdrawn' ? (
                    <path d="M7 7l10 10M17 7L7 17" pathLength={1} />
                  ) : (
                    <path d="M6 12.5l4 4 8-9" pathLength={1} />
                  )}
                </svg>
              </span>
              <div>
                <div className={classes.placedTitle}>{TITLE[shot.kind]}</div>
                <div className={classes.placedFigures}>{shot.figures}</div>
                {shot.sub ? <div className={classes.placedSub}>{shot.sub}</div> : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return { play, node };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** `SELL 10.4000 WETH · AT 2,600 · 18 SEP`. */
export function offerFigures(
  side: 'buy' | 'sell' | undefined,
  amount: string,
  strike: string,
  maturity: number | undefined,
  symbol: string,
): string {
  const date =
    maturity !== undefined
      ? `${new Date(maturity * 1000).getUTCDate()} ${MONTHS[new Date(maturity * 1000).getUTCMonth()]}`
      : undefined;
  const price = Number(strike.replace(/,/g, ''));
  const strikeLabel = Number.isFinite(price) && strike !== '' ? price.toLocaleString('en-US') : strike;
  const size = side === 'buy' ? `BUY WITH ${amount} ${symbol}` : `SELL ${amount} ${symbol}`;
  return [size, `AT ${strikeLabel}`, date].filter(Boolean).join(' · ');
}
