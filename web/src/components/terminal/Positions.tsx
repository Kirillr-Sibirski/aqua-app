'use client';

/**
 * The positions strip. What used to be a whole route.
 *
 * One row per live offer and nothing else on the screen changes: `useBook` pins two multicall
 * rounds and the fill replay to the watched block, so what an offer can still hand over, what it
 * has earned and the meter beside it are one snapshot rather than three pollers drifting into
 * place. The header carries the figure that exists nowhere else in DeFi — what this wallet has
 * promised across every offer, over what it actually holds — because the offers are written against
 * a balance that never moved, and one fill shrinks all of them at once.
 *
 * Nothing here is modelled. Terms are decoded from the bytes Aqua published; what can be taken is
 * the bound the `Coverage` guard itself reported when the offer was probed for everything it
 * advertises; what has been earned is replayed from the spread each past fill actually cleared, and
 * stays at zero until somebody trades.
 *
 * Withdrawn offers collapse. A docked strategy hash can never be filled again, so every figure on
 * such a row would be a claim about a trade that is structurally impossible.
 */
import { ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import type { Hex } from 'viem';
import { useDock } from '@/hooks';
import type { BookLeg, UseBookReturn } from '@/hooks/useBook';
import { TokenAmount, TokenAmountSkeleton, tokenFractionDigits } from '@/components/token';
import { formatUnits } from '@/lib/ui';
import { backingRatio } from './backing';
import { Bar, Meter, Num } from './bits';
import classes from './terminal.module.css';

const ZERO = BigInt(0);

/** The two halves of the promised-over-held ratio, printed to the same width. */
const PROMISED_DIGITS = {
  significantDigits: 18,
  minFractionDigits: 2,
  maxFractionDigits: 2,
} as const;

export interface PositionsProps {
  book: UseBookReturn;
  connected: boolean;
  hydrated: boolean;
}

export function Positions({ book, connected, hydrated }: PositionsProps) {
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [arming, setArming] = useState<Hex>();
  const { dock, isRunning } = useDock();
  const [pending, setPending] = useState<Hex>();

  const live = book.legs.filter((leg) => leg.status !== 'docked');
  const withdrawn = book.legs.filter((leg) => leg.status === 'docked');

  /* The token the book is most over-allocated on: the one the signature figure is about. */
  const signature = book.kpis.writtenToken;

  const onWithdraw = async (leg: BookLeg) => {
    if (arming !== leg.strategyHash) {
      setArming(leg.strategyHash);
      return;
    }
    setArming(undefined);
    setPending(leg.strategyHash);
    try {
      await dock({ strategyHash: leg.strategyHash, tokens: leg.strategy.tokens });
      book.refetch();
    } catch {
      // `useTxFlow` holds the reason; the row simply comes back live on the next read.
    } finally {
      setPending(undefined);
    }
  };

  return (
    <section className={classes.positions} aria-label="Your offers">
      <div className={classes.positionsHead}>
        <span className={classes.positionsTitle}>Positions</span>
        {signature ? (
          <span
            className={classes.promised}
            title="Written across every live offer, against the balance standing behind all of them. One fill shrinks what the rest can deliver, in the same block."
          >
            Promised
            {/* Both halves at the same fixed precision. Trimming trailing zeros independently put
                `30.74 / 10.4` on the screen — two different decimal counts inside what a reader
                takes for one figure, which is the fastest way to make a ratio look approximate. */}
            <span className={classes.promisedFigure}>
              {formatUnits(signature.written, signature.decimals, PROMISED_DIGITS)}
              <span className={classes.promisedOver}> / </span>
              {formatUnits(signature.wallet, signature.decimals, PROMISED_DIGITS)}
            </span>
            <span className={classes.promisedFigure} style={{ color: 'var(--ink-3)' }}>
              {signature.symbol}
            </span>
            {signature.writtenMultiple > 1 ? (
              <span className={classes.promisedMultiple}>{signature.writtenMultiple.toFixed(2)}×</span>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className={classes.scroller}>
        <table className={classes.table}>
          <thead>
            <tr>
              <th scope="col" className={classes.cellStart} style={{ width: '22%' }}>
                Size
              </th>
              <th scope="col" style={{ width: '13%' }}>
                Strike
              </th>
              <th scope="col" style={{ width: '13%' }}>
                Expiry
              </th>
              <th scope="col" style={{ width: '17%' }}>
                Open
              </th>
              <th scope="col" style={{ width: '17%' }}>
                Earned
              </th>
              <th scope="col" style={{ width: '12%' }}>
                Backing
              </th>
              <th scope="col" style={{ width: '6%' }}>
                <span className="sr-only">Withdraw</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!hydrated || (connected && book.isLoading) ? (
              [0, 1, 2].map((i) => <LoadingRow key={i} />)
            ) : !connected ? (
              <tr>
                <td colSpan={7} className={classes.emptyRow}>
                  Not connected
                </td>
              </tr>
            ) : live.length === 0 ? (
              <tr>
                <td colSpan={7} className={classes.emptyRow}>
                  No positions
                </td>
              </tr>
            ) : (
              live.map((leg) => (
                <Row
                  key={leg.key}
                  leg={leg}
                  armed={arming === leg.strategyHash}
                  pending={pending === leg.strategyHash && isRunning}
                  onWithdraw={() => void onWithdraw(leg)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {withdrawn.length > 0 ? (
        <>
          <button
            type="button"
            className={classes.disclosure}
            aria-expanded={showWithdrawn}
            onClick={() => setShowWithdrawn((v) => !v)}
          >
            <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" className={classes.disclosureChevron} />
            <span>
              {withdrawn.length} withdrawn
            </span>
          </button>
          {showWithdrawn ? (
            <div className={classes.scroller}>
              <table className={classes.table}>
                <tbody>
                  {withdrawn.map((leg) => (
                    <Row key={leg.key} leg={leg} withdrawn />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Row({
  leg,
  withdrawn = false,
  armed = false,
  pending = false,
  onWithdraw,
}: {
  leg: BookLeg;
  withdrawn?: boolean;
  armed?: boolean;
  pending?: boolean;
  onWithdraw?: () => void;
}) {
  const delivers = leg.deliversRisky ? leg.risky : leg.stable;
  // The guard's own number wins when it gave one: same quantity, straight from the enforcer.
  const open = leg.probe.bound ?? leg.depth.amount;
  const written = leg.depth.written;
  const backing = backingRatio(open, written);

  const theta = leg.theta;
  const earned =
    theta && theta.risky > ZERO
      ? { token: leg.risky, amount: theta.risky }
      : theta && theta.stable > ZERO
        ? { token: leg.stable, amount: theta.stable }
        : undefined;

  return (
    <tr className={classes.row} data-dim={withdrawn || undefined}>
      <td className={classes.cellStart}>
        <TokenAmount
          value={written}
          decimals={delivers.decimals}
          symbol={delivers.symbol}
          icon
          size={18}
          tone={withdrawn ? 'muted' : 'default'}
        />
      </td>

      <td>
        {/* Not `leg.strikeLabel`, which trims its trailing zeros: in a column that puts `2,442.5`
            under `2,600` and the decimal points stop lining up. A strike is a price in the stable
            token, so it takes that token's own fixed precision — the same two places every other
            USDC figure on this screen is printed to, from the same registry. */}
        <Num tone={withdrawn ? 'dim' : undefined}>
          {formatUnits(leg.rmm.strikeWad, 18, {
            significantDigits: 18,
            minFractionDigits: tokenFractionDigits(leg.stable.symbol),
            maxFractionDigits: tokenFractionDigits(leg.stable.symbol),
          })}
        </Num>
      </td>

      <td>
        {/* The date is what an option is identified by; how far away it is is what a maker acts on,
            and counting it off a calendar in your head is the sort of arithmetic a terminal exists
            to have already done. `secondsLeft` is measured on the chain's clock, not the browser's,
            which matters here because the demo fork is warped days forward. */}
        <Num
          tone={withdrawn ? 'dim' : undefined}
          title={expiryTitle(leg)}
          unit={withdrawn ? undefined : tenorLeft(leg.secondsLeft)}
        >
          {expiryDate(leg.rmm.maturity)}
        </Num>
      </td>

      <td>
        {withdrawn || leg.status === 'docked' ? (
          <Num tone="dim">—</Num>
        ) : leg.probe.pending ? (
          <TokenAmountSkeleton chars={7} icon={false} />
        ) : (
          <TokenAmount
            value={open}
            decimals={delivers.decimals}
            symbol={delivers.symbol}
            icon={false}
            tone={open === ZERO ? 'muted' : 'default'}
          />
        )}
      </td>

      <td>
        {theta?.pending ? (
          <TokenAmountSkeleton chars={7} icon={false} />
        ) : (
          /* A leg that has never been swept earns nothing, and it used to say so with a bare `0` —
             no unit, no decimal places, and so no relationship to the `+0.3380 WETH` above it. The
             zero is printed in the same shape as a real figure instead, in the token a taker would
             pay to sweep this leg, which is the token any premium on it will arrive in. */
          <TokenAmount
            value={earned?.amount ?? ZERO}
            decimals={(earned?.token ?? leg.bandToken).decimals}
            symbol={(earned?.token ?? leg.bandToken).symbol}
            icon={false}
            sign="always"
            tone={earned ? 'money' : 'muted'}
          />
        )}
      </td>

      <td>
        {withdrawn ? (
          <Num tone="dim">—</Num>
        ) : (
          <Meter
            value={backing}
            label={`${(backing * 100).toFixed(0)}% of what this offer promises can be handed over right now`}
          />
        )}
      </td>

      <td>
        {withdrawn ? null : (
          <button
            type="button"
            className={classes.withdraw}
            disabled={pending}
            aria-label={armed ? 'Confirm withdraw' : 'Withdraw this offer'}
            title={
              armed
                ? 'Click again. This cannot be undone: the strategy hash is dead for good.'
                : 'Withdraw'
            }
            style={armed ? { background: 'var(--neg-soft)', color: 'var(--neg)' } : undefined}
            onClick={onWithdraw}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}

function LoadingRow() {
  return (
    <tr>
      <td className={classes.cellStart}>
        <Bar width={110} />
      </td>
      <td>
        <Bar width={56} />
      </td>
      <td>
        <Bar width={48} />
      </td>
      <td>
        <Bar width={72} />
      </td>
      <td>
        <Bar width={72} />
      </td>
      <td>
        <Bar width={53} />
      </td>
      <td />
    </tr>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `18 Sep`, in UTC, from the maturity in the offer's own bytes. */
function expiryDate(maturity: number): string {
  const d = new Date(maturity * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * How long is left, in one unit and at most three characters: `9d`, `18h`, `44m`, `now`.
 *
 * Deliberately not `formatRelativeTime`, which says `in 9d` — correct English and the wrong thing
 * in a column, where the preposition is width that repeats on every row and carries nothing. Past
 * maturity reads `done` rather than a negative, because the leg has stopped counting.
 */
function tenorLeft(secondsLeft: number): string {
  if (!Number.isFinite(secondsLeft)) return '';
  if (secondsLeft <= 0) return 'done';
  const days = Math.floor(secondsLeft / 86_400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(secondsLeft / 3_600);
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.floor(secondsLeft / 60);
  return minutes >= 1 ? `${minutes}m` : 'now';
}

function expiryTitle(leg: BookLeg): string {
  const d = new Date(leg.rmm.maturity * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${d.toISOString().slice(0, 10)} ${hh}:00 UTC`;
}
