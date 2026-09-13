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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Hex } from 'viem';
import { useDock } from '@/hooks';
import { sigmaRatio } from '@/hooks/strikeline';
import type { BookLeg, BookTokenView, UseBookReturn } from '@/hooks/useBook';
import {
  floorToTokenDigits,
  TokenAmount,
  TokenAmountSkeleton,
  TokenIcon,
  tokenFractionDigits,
} from '@/components/token';
import { Reveal, useLandings, useTweenedBigInt, useTweenedNumber, type LandingStage } from '@/lib/motion';
import { formatPercent, formatTenor, formatUnits } from '@/lib/ui';
import { backingRatio } from './backing';
import { Bar, Meter, Num } from './bits';
import { Explain, Labelled } from './Explain';
import classes from './terminal.module.css';

const ZERO = BigInt(0);

/**
 * One half of the promised-over-held ratio, printed the way this app prints a balance.
 *
 * Two things have to agree here, and only the first of them used to. The count of places comes from
 * `components/token/registry`, which is what stopped this line reading `30.74 / 10.40` under a
 * legend reading `MAX 10.4000`. The *direction* of the digits past them comes from the same file,
 * which is what stops it reading `10.3303` under a legend reading `10.3302` — the same wallet, the
 * same instant, two hundred pixels apart, disagreeing in the fourth place because one call site
 * truncated and the other rounded.
 *
 * Both halves take the same treatment, so the ratio cannot be internally inconsistent either. The
 * multiple beside it is computed from the unrounded integers, so it is unaffected by any of this.
 */
function promisedFigure(value: bigint, token: { symbol: string; decimals: number }): string {
  const places = tokenFractionDigits(token.symbol);
  return formatUnits(floorToTokenDigits(value, token.decimals, token.symbol), token.decimals, {
    significantDigits: 18,
    minFractionDigits: places,
    maxFractionDigits: places,
    // A book that has promised a hair over a thousandth of a token has promised nothing a reader
    // needs a `<` for; this is a ratio of holdings, not a dust-sized payment.
    dust: 'zero',
  });
}

export interface PositionsProps {
  book: UseBookReturn;
  connected: boolean;
  hydrated: boolean;
}

export function Positions({ book, connected, hydrated }: PositionsProps) {
  const arrived = useArrivals(book.legs);
  const promised = usePromisedFigures(book.kpis.writtenToken);
  const rows = useRowMotion(book.legs);
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
  /*
   * One, not three.
   *
   * The held count exists so a re-read after a publish does not collapse the strip, and after the
   * first answer it is the real row count, so the seed only ever describes the very first paint —
   * which, because wagmi reconnects from a cookie on the client, is always the disconnected one.
   * Seeded at three, a first-time visitor got three shimmering rows for the length of hydration and
   * then a single line reading `Not connected`: 72px handed to the chart and taken back, on the one
   * paint a reader is watching hardest. Seeded at one, that first paint is already the shape it
   * settles into, and a returning wallet's book grows into the space instead of shrinking out of it.
   */
  const [heldRows, setHeldRows] = useState(1);
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
          <span className={classes.promised}>
            {/*
              * The ⓘ rides the word, not the end of the line.
              *
              * It used to trail the whole group — after the ratio, the unit and the multiple — which
              * put it 22px past the last figure and so 2px past the strip header's own padding,
              * and, worse, made this the one explainer on the screen attached to a number instead of
              * to a label. Every other one on the terminal follows the word it defines: `IV ⓘ`,
              * `PREMIUM ⓘ`, `CAPPED AT ⓘ`. This one now does too, and `16.06×` gets the right edge
              * back.
              *
              * The one figure on this screen that exists nowhere else is also the one nobody can
              * read. It used to carry a native `title`, which is prose only a mouse can reach, never
              * announces itself, and cannot be opened on the phone where this line is at its most
              * cryptic. Everything the title said is in the popover, plus the half it never said:
              * why the numerator is allowed to be larger.
              */}
            <Labelled>
              Promised
              <Explain term="Promised" position="top-end">
                <p>All your open offers added up, against what your wallet holds.</p>
              </Explain>
            </Labelled>
            {/* Both halves at the same fixed precision. Trimming trailing zeros independently put
                `30.74 / 10.4` on the screen — two different decimal counts inside what a reader
                takes for one figure, which is the fastest way to make a ratio look approximate.

                The denominator is `coverage`, not `wallet`, and that is a correctness fix rather
                than a preference: the multiple beside it has always been `written / coverage`, so
                on a wallet whose Aqua allowance is smaller than its balance the printed ratio and
                the printed `x` were two different divisions of the same numerator, disagreeing by
                exactly the shortfall. `coverage` is `min(balance, allowance)` — the number the
                `Coverage` guard enforces, and the only denominator under which "what one wallet can
                actually deliver" is true. On an approved wallet the two are the same figure. */}
            <span className={classes.promisedFigure}>
              {promisedFigure(promised.written, signature)}
              <span className={classes.promisedOver}> / </span>
              {promisedFigure(promised.coverage, signature)}
            </span>
            <span className={`${classes.promisedFigure} ${classes.promisedSymbol}`}>
              {signature.symbol}
            </span>
            {signature.writtenMultiple > 1 ? (
              <span className={classes.promisedMultiple}>{promised.multiple.toFixed(2)}×</span>
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
              {/* The term that makes this an options venue rather than a limit order, and the one
                  a maker compares across their own book. It is per-leg and it varies; the column
                  it replaced was `SIZE × BACKING`. */}
              <th scope="col">IV</th>
              <th scope="col">Expiry</th>
              <th scope="col">Earned</th>
              {/*
                * Not `Open` — see `Row` — and no longer `Backing` either.
                *
                * `Backing` names a thing (collateral) where the column holds a proportion, and it
                * reads as a synonym for the meter beside it rather than as the meter's unit. What
                * the figure actually answers is "how much of this offer could be taken right now",
                * and the shortest true word for that is what it can deliver. One word longer, one
                * question fewer.
                */}
              <th scope="col">
                <Labelled className={classes.headLabel}>
                  Deliverable
                  <Explain term="Deliverable" position="top-end">
                    <p>How much of this offer your wallet can still cover right now.</p>
                  </Explain>
                </Labelled>
              </th>
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
              <EmptyRow rows={skeletonRows}>Not connected</EmptyRow>
            ) : live.length === 0 ? (
              /* Not `No positions`: the disclosure directly below this may be offering nineteen
                 withdrawn ones, and a strip that says it has none over a button that counts
                 nineteen is contradicting itself in 32px. The word that is true in both places is
                 `live`. */
              <EmptyRow rows={skeletonRows}>No live offers</EmptyRow>
            ) : (
              live.map((leg) => (
                <Row
                  key={leg.key}
                  leg={leg}
                  armed={arming === leg.strategyHash}
                  pending={pending === leg.strategyHash && isRunning}
                  isNew={arrived.has(leg.strategyHash)}
                  from={rows.from(leg.key)}
                  landing={rows.stage(leg.key)}
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
 * Row motion, owned by the strip because the rows do not survive long enough to own it.
 *
 * A re-read swaps every row for a skeleton and back — measured on a real fill: nought of seventeen
 * rows kept their DOM identity. So the two things a row needs in order to move, and cannot keep for
 * itself, live here: what it printed before the read in flight, and whether what it prints has
 * changed since.
 *
 * `from` is read during the row's own render, which is before this hook's effect runs, so a row
 * that has just remounted with new figures is handed the ones it had a moment ago and travels from
 * them. A row on its first sighting is handed nothing and simply appears at its value.
 */
function useRowMotion(legs: readonly BookLeg[]) {
  const previous = useRef(new Map<string, RowFigures>());
  const stages = useLandings(legs.map((leg) => [leg.key, rowFigures(leg).print] as const));

  const before = previous.current;
  /* After the rows have rendered — and after they have read `before` — record what they are
     showing now, so the next read has something to travel from. A settled half only: a pending one
     would overwrite a real reading with nothing and lose the comparison across the round trip. */
  useEffect(() => {
    for (const leg of legs) {
      const next = rowFigures(leg);
      const held = previous.current.get(leg.key);
      previous.current.set(leg.key, {
        backed: next.backed ?? held?.backed,
        earned: next.earned ?? held?.earned,
        print: next.print ?? held?.print,
      });
    }
  });

  return {
    from: (key: string) => before.get(key),
    stage: (key: string) => stages.get(key),
  };
}

/**
 * The signature figure, moving.
 *
 * `PROMISED 30.7400 / 10.4000 WETH 2.96x` is the claim no other venue can print, and every part of
 * it moves on the two events this screen exists for: publishing an offer raises the numerator, and
 * a fill changes the wallet under it. Travelling between two readings is what says which of the two
 * just happened; replacing one string with another says only that something did.
 *
 * All three are tweened off the same reads, so the ratio and the multiple beside it never disagree
 * mid-transition. Each falls back to the figure itself, which is what a first reading gives and
 * what a reader who has asked for reduced motion gets on every reading after it.
 */
function usePromisedFigures(token: UseBookReturn['kpis']['writtenToken']) {
  const written = useTweenedBigInt(token?.written);
  const coverage = useTweenedBigInt(token?.coverage);
  const multiple = useTweenedNumber(token?.writtenMultiple);
  return {
    written: written ?? token?.written ?? ZERO,
    coverage: coverage ?? token?.coverage ?? ZERO,
    multiple: multiple ?? token?.writtenMultiple ?? 0,
  };
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
 * What a row prints, as data: the two figures a fill moves, and the string a reader could see.
 *
 * It is computed here rather than inside the row because the strip needs it too — to notice that a
 * figure changed across a re-read that unmounted every row, and to lend the row that comes back the
 * reading the row that went away was showing. One function, so the two can never disagree about
 * what "this row changed" means.
 *
 * Either half is `undefined` while its own read is in flight, which is exactly the condition under
 * which that cell draws a skeleton. A row with a pending half is not compared and not recorded, so
 * the round trip is spanned rather than mistaken for a change.
 */
interface RowFigures {
  /** `open / written`, the fraction of what this offer promises the wallet can still deliver. */
  backed?: number;
  /** Realised theta, and the token it was paid in. */
  earned?: { amount: bigint; token: BookTokenView };
  /** The two of them as a reader sees them: the string the landing tint compares. */
  print?: string;
}

function rowFigures(leg: BookLeg): RowFigures {
  // The guard's own number wins when it gave one: same quantity, straight from the enforcer.
  const backed = leg.probe.pending
    ? undefined
    : backingRatio(leg.probe.bound ?? leg.depth.amount, leg.depth.written);

  const theta = leg.theta;
  const earned = theta?.pending
    ? undefined
    : theta && theta.risky > ZERO
      ? { amount: theta.risky, token: leg.risky }
      : theta && theta.stable > ZERO
        ? { amount: theta.stable, token: leg.stable }
        : { amount: ZERO, token: leg.bandToken };

  const print =
    backed === undefined || earned === undefined || leg.status === 'docked'
      ? undefined
      : `${Math.round(backed * 100)}|${earned.amount}${earned.token.symbol}`;

  return { backed, earned, print };
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
      <col style={{ width: '4.5rem' }} />
      <col style={{ width: '22%' }} />
      <col style={{ width: '15%' }} />
      <col style={{ width: '10%' }} />
      <col style={{ width: '15%' }} />
      {/* Two points move from EARNED to DELIVERABLE. At the table's 42rem floor — which is exactly
          the phone, where the strip scrolls inside itself — the last column was 121px holding 100px
          of meter-plus-percentage inside 24px of padding, so its content had been overflowing into
          EARNED before the header grew a word and an ⓘ. `0.00 USDC` needs 94 and had 134. */}
      <col style={{ width: '18%' }} />
      <col style={{ width: '20%' }} />
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
  from,
  landing,
  onWithdraw,
}: {
  leg: BookLeg;
  withdrawn?: boolean;
  armed?: boolean;
  pending?: boolean;
  /** Landed since this strip was last read: the row that confirms a publish. */
  isNew?: boolean;
  /** What this row printed before the read in flight, so its figures can travel rather than jump. */
  from?: RowFigures;
  /** Set for the second and a half after somebody took an offer this row is exposed to. */
  landing?: LandingStage;
  onWithdraw?: () => void;
}) {
  const delivers = leg.deliversRisky ? leg.risky : leg.stable;
  const figures = rowFigures(leg);
  const earnedToken = figures.earned?.token ?? leg.bandToken;

  /*
   * The two figures a fill moves, and they move rather than jump.
   *
   * BACKING is the one on this strip that changes without anybody touching this row: a fill on a
   * sibling offer eats into the one balance behind all of them, so this offer can suddenly deliver
   * less of what it advertises. That is the claim the whole product makes, and it used to arrive as
   * a different set of digits and a different count of lit cells on the next read, which on a strip
   * of fifteen rows is indistinguishable from nothing having happened. The meter and the percentage
   * are driven off one tweened ratio, so the cells go out in order from the tip and the figure
   * counts down with them instead of the two changing independently.
   *
   * `from` is the reading this row held before the re-read, lent by the strip: the rows are
   * unmounted while the new block is being read, so a hook in here has no memory of its own to
   * travel from. Absent on a first sighting, which is what keeps a figure that has only just
   * arrived from counting up out of nowhere.
   */
  const backing = useTweenedNumber(figures.backed, { from: from?.backed }) ?? figures.backed ?? 1;
  const earnedAmount = useTweenedBigInt(figures.earned?.amount, { from: from?.earned?.amount });

  return (
    <tr
      className={classes.row}
      data-dim={withdrawn || undefined}
      data-new={isNew || undefined}
      data-filled={landing}
    >
      <td className={classes.cellStart}>
        <span className={classes.mark}>
          <TokenIcon symbol={delivers.symbol} size={18} dim={withdrawn} />
          <span
            className={classes.side}
            title={leg.kind === 'call' ? `Sells ${leg.risky.symbol} at the strike` : `Buys ${leg.risky.symbol} at the strike`}
          >
            {leg.kind === 'call' ? 'sell' : 'buy'}
          </span>
        </span>
      </td>

      <td>
        <TokenAmount
          value={leg.depth.written}
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
        {/* `sigmaWad` off the leg's own decoded `RmmSwap` args. Two significant places, because the
            ticket publishes one and the spread across a book is tenths. */}
        <Num tone={withdrawn ? 'dim' : undefined}>
          {formatPercent(sigmaRatio(leg.rmm.sigmaWad), { fractionDigits: 1 })}
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
        <Reveal token={earnedAmount === undefined ? 'pending' : 'settled'}>
          {earnedAmount === undefined ? (
            <TokenAmountSkeleton chars={9} icon={false} />
          ) : (
            /* A leg that has never been swept earns nothing, and it used to say so with a bare `0` —
               no unit, no decimal places, and so no relationship to the `+0.3380 WETH` above it. The
               zero is printed in the same shape as a real figure instead, in the token a taker would
               pay to sweep this leg, which is the token any premium on it will arrive in. */
            <TokenAmount
              value={earnedAmount}
              decimals={earnedToken.decimals}
              symbol={earnedToken.symbol}
              icon={false}
              sign="always"
              tone={figures.earned && figures.earned.amount > ZERO ? 'money' : 'muted'}
            />
          )}
        </Reveal>
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
        ) : (
          <Reveal token={figures.backed === undefined ? 'pending' : 'settled'}>
            {figures.backed === undefined ? (
              <TokenAmountSkeleton chars={9} icon={false} />
            ) : (
              <span className={classes.backing}>
                <Meter value={backing} />
                <Num tone={backing < 0.999 ? undefined : 'dim'}>
                  {formatPercent(backing, { fractionDigits: 0 })}
                </Num>
              </span>
            )}
          </Reveal>
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
            /* An attribute, not an inline style. Two other places on this screen used to paint a
               state with `style={{ color: 'var(--neg)' }}`, which means the armed treatment lives
               somewhere the stylesheet cannot see it and cannot be given a transition, a hover or a
               focus variant without moving it back. */
            data-armed={armed || undefined}
            onClick={onWithdraw}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * The strip with nothing in it, at the height the strip already had.
 *
 * The empty state takes the height the skeletons above it were holding, so the strip is the size it
 * is going to be from the first frame and the chart above it stops moving. Capped at three rows: a
 * wallet that disconnects out of a fifteen-row book would otherwise leave a 540px hole with two
 * words in it.
 *
 * The message stays left-aligned rather than centred: at 390px this table is 672px wide inside a
 * 390px scroller, and a message centred on the table is a message parked 140px off the right edge
 * of the phone.
 */
function EmptyRow({ rows, children }: { rows: number; children: ReactNode }) {
  return (
    <tr>
      <td
        colSpan={8}
        className={classes.emptyRow}
        /* A length, computed from the row height the module already owns — not a colour, and not a
           second copy of the 36px constant. */
        style={{ height: `calc(${Math.min(3, Math.max(1, rows))} * var(--row-h))` }}
      >
        {children}
      </td>
    </tr>
  );
}

/**
 * A row of the right widths, measured against what actually lands in each cell.
 *
 * "A skeleton of the right width" is only worth the rule if the widths are right. Two of these were
 * not: EARNED reserved 53px for `0.00 USDC`, which sets 70, and DELIVERABLE reserved the same 53
 * for a nine-cell meter plus `100%`, which is 102 — so the last column of a loading strip was half
 * the width of the column that replaced it, and the whole rail moved when the read landed. The
 * numbers below are the rendered widths of the widest figure each column holds at 13px mono.
 */
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
        <Bar width={62} />
      </td>
      <td>
        <Bar width={38} />
      </td>
      <td>
        <Bar width={72} />
      </td>
      <td>
        <Bar width={72} />
      </td>
      <td>
        <Bar width={100} />
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
