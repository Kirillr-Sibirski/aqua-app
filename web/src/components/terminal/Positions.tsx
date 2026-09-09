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
import { useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { useDock } from '@/hooks';
import type { BookLeg, UseBookReturn } from '@/hooks/useBook';
import { TokenAmount, TokenAmountSkeleton, TokenIcon, tokenFractionDigits } from '@/components/token';
import { formatPercent, formatTenor, formatUnits } from '@/lib/ui';
import { backingRatio } from './backing';
import { Bar, Meter, Num } from './bits';
import classes from './terminal.module.css';

const ZERO = BigInt(0);

/**
 * The two halves of the promised-over-held ratio, at the token's own precision.
 *
 * Fixed at two places it printed `30.74 / 10.40` for a token every other figure on the screen shows
 * to four — the SELL legend and the SIZE column both read `10.4000`. There is one decimal
 * convention per token in this app and it comes from `components/token/registry`.
 */
function promisedDigits(symbol: string) {
  const places = tokenFractionDigits(symbol);
  return { significantDigits: 18, minFractionDigits: places, maxFractionDigits: places } as const;
}

export interface PositionsProps {
  book: UseBookReturn;
  connected: boolean;
  hydrated: boolean;
}

export function Positions({ book, connected, hydrated }: PositionsProps) {
  const arrived = useArrivals(book.legs);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [arming, setArming] = useState<Hex>();
  const { dock, isRunning } = useDock();
  const [pending, setPending] = useState<Hex>();

  const live = book.legs.filter((leg) => leg.status !== 'docked');
  const withdrawn = book.legs.filter((leg) => leg.status === 'docked');

  /*
   * The shape the strip held last time it had an answer: how many rows, and whether there was a
   * withdrawn disclosure under them.
   *
   * A re-read after a publish empties both for about a second and a half, and the strip used to
   * collapse from 357px to 174px and back — twice — handing the space to the chart and taking it
   * away again while the reader watched. It keeps its shape across a re-read now; only the digits
   * change. Set during render rather than in an effect, so the skeletons never paint at the wrong
   * count first.
   */
  const [heldRows, setHeldRows] = useState(3);
  const [heldWithdrawn, setHeldWithdrawn] = useState(0);
  const settled = !book.isLoading;
  if (live.length > 0 && live.length !== heldRows) setHeldRows(live.length);
  if (settled && withdrawn.length !== heldWithdrawn) setHeldWithdrawn(withdrawn.length);
  const skeletonRows = heldRows;
  const withdrawnCount = settled ? withdrawn.length : heldWithdrawn;

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
            title="Written across every live offer, over the one balance behind all of them."
          >
            Promised
            {/* Both halves at the same fixed precision. Trimming trailing zeros independently put
                `30.74 / 10.4` on the screen — two different decimal counts inside what a reader
                takes for one figure, which is the fastest way to make a ratio look approximate. */}
            <span className={classes.promisedFigure}>
              {formatUnits(signature.written, signature.decimals, promisedDigits(signature.symbol))}
              <span className={classes.promisedOver}> / </span>
              {formatUnits(signature.wallet, signature.decimals, promisedDigits(signature.symbol))}
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
          <Columns />
          <thead>
            <tr>
              <th scope="col" className={classes.cellStart}>
                <span className="sr-only">Instrument</span>
              </th>
              <th scope="col">Size</th>
              <th scope="col">Strike</th>
              <th scope="col">Expiry</th>
              <th scope="col">Earned</th>
              {/* Not `Open`. See `Row`. */}
              <th scope="col">Backing</th>
              <th scope="col">
                <span className="sr-only">Withdraw</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!hydrated || (connected && book.isLoading) ? (
              /* As many skeletons as the strip last held, not three.
                 A refetch after a publish emptied the table down to three placeholder rows for a
                 second and a half, which took 183px off this section and handed them to the chart
                 above — the layout lurching twice while a figure the reader was watching reloaded.
                 The strip holds its height across a re-read; only the digits change. */
              Array.from({ length: skeletonRows }, (_, i) => <LoadingRow key={i} />)
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
                  isNew={arrived.has(leg.strategyHash)}
                  onWithdraw={() => void onWithdraw(leg)}
                />
              ))
            )}
          </tbody>

          {/* The withdrawn legs go in the same table, and in the same scroller, deliberately.
              They used to be a second `<table>` in a second `<div class="scroller">` below this
              one, and that was two bugs. The columns disagreed, because `table-layout: fixed` had
              no widths to read in a table with no header row. And the strip grew without bound:
              the shell is `100dvh` with `overflow: hidden` on a desk, so a second 15.5rem scroll
              region opening under the first pushed the section past what the screen could hold —
              at twelve withdrawn legs the chart's x-axis painted over the POSITIONS heading and
              the footer painted over the last row. One table cannot do either. */}
          {showWithdrawn ? (
            <tbody>
              {withdrawn.map((leg) => (
                <Row key={leg.key} leg={leg} withdrawn />
              ))}
            </tbody>
          ) : null}
        </table>
      </div>

      {withdrawnCount > 0 ? (
        <button
          type="button"
          className={classes.disclosure}
          aria-expanded={showWithdrawn}
          disabled={withdrawn.length === 0}
          onClick={() => setShowWithdrawn((v) => !v)}
        >
          <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" className={classes.disclosureChevron} />
          <span>{withdrawnCount} withdrawn</span>
        </button>
      ) : null}
    </section>
  );
}

/**
 * Which rows landed since the last read.
 *
 * The one confirmation a publish gets. Pressing the button used to produce nothing observable for
 * the whole nineteen seconds a run takes on a fork — the offer landed and a row silently appeared
 * among five identical ones. The row that appears now lights for two seconds in the accent, which
 * LAYOUT.md reserves for the primary action and your own position, and this is both: it is the
 * thing the primary action just made.
 *
 * The first read is not an arrival. Every leg is new on the first render of a connected wallet, and
 * lighting the whole book would say a fill had happened five times over.
 */
function useArrivals(legs: readonly BookLeg[], holdMs = 2_000): ReadonlySet<Hex> {
  const seen = useRef<Set<Hex> | null>(null);
  const [arrived, setArrived] = useState<ReadonlySet<Hex>>(() => new Set());

  const hashes = legs.map((leg) => leg.strategyHash).join(',');

  useEffect(() => {
    const now = new Set(legs.map((leg) => leg.strategyHash));
    const before = seen.current;
    seen.current = now;
    if (before === null || now.size === 0) return;

    const fresh = new Set([...now].filter((hash) => !before.has(hash)));
    if (fresh.size === 0) return;

    setArrived(fresh);
    const timer = setTimeout(() => setArrived(new Set()), holdMs);
    return () => clearTimeout(timer);
    // `hashes` is the identity of the set; `legs` is a new array on every read of the same book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashes, holdMs]);

  return arrived;
}

/**
 * The column widths, stated once and away from the headings.
 *
 * `table-layout: fixed` takes its geometry from the first row it can find unless a `<colgroup>`
 * tells it otherwise, which made the widths a property of the header cells and so of whichever
 * `<tbody>` happened to be rendered. Here they are a property of the table.
 */
function Columns() {
  return (
    <colgroup>
      <col style={{ width: '3.5rem' }} />
      <col style={{ width: '24%' }} />
      <col style={{ width: '16%' }} />
      <col style={{ width: '16%' }} />
      <col style={{ width: '22%' }} />
      <col style={{ width: '22%' }} />
      <col style={{ width: '2.5rem' }} />
    </colgroup>
  );
}

function Row({
  leg,
  withdrawn = false,
  armed = false,
  pending = false,
  isNew = false,
  onWithdraw,
}: {
  leg: BookLeg;
  withdrawn?: boolean;
  armed?: boolean;
  pending?: boolean;
  /** Landed since this strip was last read: the row that confirms a publish. */
  isNew?: boolean;
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
    <tr className={classes.row} data-dim={withdrawn || undefined} data-new={isNew || undefined}>
      <td className={classes.cellStart}>
        <span className={classes.mark}>
          <TokenIcon symbol={delivers.symbol} size={18} dim={withdrawn} />
          <span className={classes.side} title={leg.kind === 'call' ? 'Covered call' : 'Cash-secured put'}>
            {leg.kind === 'call' ? 'C' : 'P'}
          </span>
        </span>
      </td>

      <td>
        <TokenAmount
          value={written}
          decimals={delivers.decimals}
          symbol={delivers.symbol}
          icon={false}
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
          unit={withdrawn ? undefined : formatTenor(leg.secondsLeft)}
        >
          {expiryDate(leg.rmm.maturity)}
        </Num>
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
        {/*
          * BACKING, and the column that used to sit beside it.
          *
          * There was an OPEN column here printing `open` in full, and it was `SIZE × BACKING` — not
          * coincidentally in the demo state, but by construction, because this figure IS
          * `open / written`. Two columns for one quantity read as density and were redundancy: in a
          * fifteen-row book they printed the same string as SIZE fifteen times. The absolute is
          * still one multiplication away and the relative is the one a maker acts on, because it is
          * the one that moves when a sibling offer is filled out of the same balance.
          *
          * The meter alone carried no reading at all: nine cells, and its only explanation was an
          * `aria-label` spelling out a full teaching sentence — prose for a screen reader and an
          * unlabelled bar for everybody else, which is the worst of both. The figure is the value
          * and the column header is its unit; the meter is the shape, and it is `aria-hidden`.
          */}
        {withdrawn || leg.status === 'docked' ? (
          <Num tone="dim">—</Num>
        ) : leg.probe.pending ? (
          <TokenAmountSkeleton chars={7} icon={false} />
        ) : (
          <span className={classes.backing}>
            <Meter value={backing} />
            <Num tone={backing < 0.999 ? undefined : 'dim'}>
              {formatPercent(backing, { fractionDigits: 0 })}
            </Num>
          </span>
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
        <Bar width={18} />
      </td>
      <td>
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

function expiryTitle(leg: BookLeg): string {
  const d = new Date(leg.rmm.maturity * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${d.toISOString().slice(0, 10)} ${hh}:00 UTC`;
}
