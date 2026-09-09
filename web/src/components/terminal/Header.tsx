'use client';

/**
 * 56px, and it carries three things: what is being traded, what it costs, and who you are.
 *
 * No navigation, because there is nowhere to go. The block number sits beside the wallet because
 * every figure below it — the spot, the curve, the ticket's premium, every positions row — was read
 * at that block, and saying which one is the only way that claim is checkable.
 */
import { WalletButton } from '@/components/sell';
import { WordmarkMark } from '@/components/shell';
import { TokenPair } from '@/components/token';
import { Bar } from './bits';
import classes from './terminal.module.css';
import { formatSpan, type SpotWindow } from './useSpotWindow';

export interface HeaderProps {
  base: string;
  quote: string;
  /** The feed's own answer, grouped and two-placed. Undefined until it lands. */
  spot?: string;
  /** How far it has moved, over however much history the chain would serve. */
  window?: SpotWindow;
  blockNumber?: bigint;
}

export function TerminalHeader({ base, quote, spot, window: spotWindow, blockNumber }: HeaderProps) {
  const tone = spotWindow === undefined
    ? 'flat'
    : spotWindow.change > 0
      ? 'pos'
      : spotWindow.change < 0
        ? 'neg'
        : 'flat';

  return (
    <header className={classes.bar}>
      <span className={classes.brand}>
        <WordmarkMark size={18} />
        <span className={classes.brandText}>strikeline</span>
      </span>

      <div className={classes.instrument}>
        <TokenPair base={base} quote={quote} size={20} className={classes.pair} />
        <span className={classes.spot}>{spot ?? <Bar width={64} />}</span>
        <span className={classes.delta} data-tone={tone}>
          {spotWindow ? (
            <>
              <span>
                {spotWindow.change >= 0 ? '+' : '−'}
                {(Math.abs(spotWindow.change) * 100).toFixed(2)}%
              </span>
              <span
                className={classes.deltaSpan}
                title={`Measured against the oldest price this chain will serve, ${formatSpan(spotWindow.spanSeconds)} back.`}
              >
                {formatSpan(spotWindow.spanSeconds)}
              </span>
            </>
          ) : (
            <Bar width={52} />
          )}
        </span>
      </div>

      <div className={classes.barEnd}>
        {blockNumber === undefined ? null : (
          <span
            className={classes.block}
            title="Every figure on this screen was read at this block, in one snapshot."
          >
            <span aria-hidden="true" className={classes.blockDot} />
            {blockNumber.toString()}
          </span>
        )}
        <WalletButton size="xs" />
      </div>
    </header>
  );
}
