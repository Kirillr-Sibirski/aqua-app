'use client';

/**
 * The offers, as rows.
 *
 * Seven columns, and only two of them are the sort of number a maker could get anywhere else. The
 * other five exist because the offer is a curve rather than a contract. Every header says what the
 * number means in words a newcomer already has, and carries the desk term in its `title` for the
 * reader who wants it:
 *
 *  - **Expiry** runs on the chain's clock, not the browser's. On a fork warped three days forward,
 *    the leg really is three days closer to expiry, and `tau` beside it is what the curve itself
 *    reads from `tauNow`.
 *  - **Moneyness** is `X/L`, straight from the reserves. Because the reserve point sits exactly on
 *    the curve, `X/L = Phi(-d1)` — the leg's own delta per unit of liquidity. No oracle is consulted
 *    anywhere on this screen, and no `Phi` is evaluated off-chain.
 *  - **Deliverable depth** is the bound the guard reports, not the virtual balance Aqua advertises.
 *  - **Theta band** is the gap decay has opened between the stale reserve point and the live curve:
 *    what the next taker must clear before they can trade at all.
 *  - **Realised theta** is the sum of the bands past takers actually did clear.
 */
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Hex } from 'viem';
import {
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Pill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableMessageRow,
  TableRow,
  TableSkeletonRows,
  TokenAmount,
} from '@/components/ui';
import { formatPercent, formatUnits, truncateHash } from '@/lib/ui';
import type { BookLeg, UseBookReturn } from '@/hooks/useBook';
import { formatCountdown, sigmaRatio } from '@/hooks/strikeline';
import { DepthCell } from './DepthCell';

const ZERO = BigInt(0);
const COLUMNS = 7;

export interface LegsTableProps {
  book: UseBookReturn;
  connected: boolean;
  connectAction?: React.ReactNode;
  highlight?: Hex;
  onHighlight?: (hash: Hex | undefined) => void;
}

function Head() {
  return (
    <TableHead>
      <TableRow>
        <TableHeaderCell title="The leg, keyed by its strategy hash">Offer</TableHeaderCell>
        <TableHeaderCell title="Time to expiry, and tau as the curve reads it">
          Time left
        </TableHeaderCell>
        <TableHeaderCell numeric title="Implied volatility">
          Movement priced in
        </TableHeaderCell>
        <TableHeaderCell numeric title="Moneyness: the share of the offer still sitting in the risky asset, which is its delta per unit of liquidity">
          Share still unsold
        </TableHeaderCell>
        <TableHeaderCell numeric title="Deliverable depth">
          How much you can sell right now
        </TableHeaderCell>
        <TableHeaderCell numeric title="Theta band">
          Minimum trade size right now
        </TableHeaderCell>
        <TableHeaderCell numeric title="Realised theta">
          Paid so far
        </TableHeaderCell>
      </TableRow>
    </TableHead>
  );
}

function LegRow({ leg, highlight, onHighlight }: { leg: BookLeg; highlight?: Hex; onHighlight?: (hash: Hex | undefined) => void }) {
  const theta = leg.theta;
  const thetaAmounts = theta
    ? ([
        theta.risky > ZERO ? { token: leg.risky, amount: theta.risky } : undefined,
        theta.stable > ZERO ? { token: leg.stable, amount: theta.stable } : undefined,
      ].filter(Boolean) as { token: BookLeg['risky']; amount: bigint }[])
    : [];

  return (
    <TableRow
      highlighted={highlight === leg.strategyHash}
      // Not `interactive`: that prop turns on a pointer cursor, and a row that only lights its
      // segment in the bar above does not go anywhere when clicked. Hover feedback without the
      // promise of a click.
      className="hover:bg-surface-2"
      onMouseEnter={() => onHighlight?.(leg.strategyHash)}
      onMouseLeave={() => onHighlight?.(undefined)}
    >
      <TableHeaderCell scope="row" title={truncateHash(leg.strategyHash)}>
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            {/* The link is on the strike, not the row: a `<tr>` cannot be an anchor, and this is the
                only keyboard path to /leg/[hash] — the screen with the live curve, the scrubber, the
                decoded program and the roll control. */}
            <Link
              href={`/leg/${leg.strategyHash}`}
              className="rounded-control font-mono text-lead tnum text-ink transition-state hover:text-accent hover:underline hover:underline-offset-2"
            >
              {leg.strikeLabel}
            </Link>
            <span className="text-meta text-ink-2">{leg.kind}</span>
            {leg.status === 'docked' ? (
              <Pill tone="neutral" size="sm" title="Docked in Aqua">
                Withdrawn
              </Pill>
            ) : leg.status === 'settling' ? (
              <Pill tone="warning" size="sm" title="Past maturity: settling, assignment only">
                Past its date
              </Pill>
            ) : leg.status === 'idle' ? (
              <Pill tone="neutral" size="sm" title="Reserves are zero">
                Nothing left
              </Pill>
            ) : null}
            {leg.guarded ? null : (
              <Pill tone="negative" size="sm" title="No Coverage instruction wraps the curve">
                Wallet not checked
              </Pill>
            )}
          </span>
          <span className="text-mini text-ink-3">
            {/* Withdrawn offers repeat their terms exactly (a rolled book ends with several rows
                reading the same strike, expiry and vol) so they carry the block they were shipped
                in. */}
            {leg.status === 'docked' ? (
              <>
                <span className="font-mono tnum">
                  {truncateHash(leg.strategyHash)} · block {formatUnits(leg.strategy.blockNumber, 0)}
                </span>
                <span className="mx-1.5">·</span>
              </>
            ) : null}
            sells {(leg.deliversRisky ? leg.risky : leg.stable).symbol}
            <span className="mx-1.5">·</span>
            <span className="font-mono">0x55</span> RmmSwap
            {leg.guarded ? (
              <>
                <span className="mx-1.5">·</span>
                <span className="font-mono">0x93</span> Coverage
              </>
            ) : null}
          </span>
        </div>
      </TableHeaderCell>

      <TableCell>
        <div className="flex flex-col gap-0.5 leading-num">
          <span className="font-mono text-meta tnum text-ink">
            {Number.isNaN(leg.secondsLeft) ? '-' : formatCountdown(leg.secondsLeft)}
          </span>
          <span
            className="font-mono text-mini tnum text-ink-3"
            title="tau, the time the curve itself is reading"
          >
            {leg.tauWad === undefined ? 'tau unread' : `tau ${formatUnits(leg.tauWad, 18, { significantDigits: 3 })}y`}
          </span>
        </div>
      </TableCell>

      <TableCell numeric>{formatPercent(sigmaRatio(leg.rmm.sigmaWad), { fractionDigits: 1 })}</TableCell>

      <TableCell numeric>
        <div className="flex flex-col items-end gap-0.5 leading-num">
          <span>{formatPercent(leg.deltaRatio, { fractionDigits: 1 })}</span>
          <span className="text-mini text-ink-3">of the offer</span>
        </div>
      </TableCell>

      <TableCell numeric>
        <DepthCell leg={leg} />
      </TableCell>

      <TableCell numeric>
        {/* A docked strategy hash can never be filled again, so there is no "next fill" to price.
            Publishing the band anyway advertised a trade that is structurally impossible -- and on
            an expired leg it was the largest number in the column, pulling the eye to the deadest
            row on the screen. PRODUCT.md: a number that cannot be acted on is a fake number. */}
        {leg.status === 'docked' ? (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            <span className="text-ink-3">-</span>
            <span className="text-mini text-ink-3">withdrawn</span>
          </div>
        ) : leg.bandNext === undefined ? (
          <span className="text-ink-3">{leg.bandPending ? 'reading' : '-'}</span>
        ) : leg.bandNext === ZERO ? (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            <span className="text-ink-3">0</span>
            <span className="text-mini text-ink-3">no gap yet</span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            <TokenAmount value={leg.bandNext} decimals={leg.bandToken.decimals} symbol={leg.bandToken.symbol} size="sm" />
            <span className="text-mini text-ink-3">the next buyer pays it</span>
          </div>
        )}
      </TableCell>

      <TableCell numeric>
        {thetaAmounts.length === 0 ? (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            <span className="text-ink-3">{theta?.pending ? 'replaying' : '0'}</span>
            <span className="text-mini text-ink-3">{theta ? `${theta.fills} ${theta.fills === 1 ? 'trade' : 'trades'}` : 'nobody yet'}</span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            {thetaAmounts.map((entry) => (
              <TokenAmount key={entry.token.address} value={entry.amount} decimals={entry.token.decimals} symbol={entry.token.symbol} size="sm" />
            ))}
            <span className="text-mini text-ink-3">
              {theta?.fills} {theta?.fills === 1 ? 'trade' : 'trades'}
              {theta?.incomplete ? ', one gap unread' : null}
            </span>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function LegsTable({ book, connected, connectAction, highlight, onHighlight }: LegsTableProps) {
  const description = 'Each row is one offer to sell at a price you named. The price and the date are read back out of the bytes the chain itself published, not out of a database beside this app.';
  const [showDocked, setShowDocked] = useState(false);

  // The live offers ARE the table. Rolling leaves one withdrawn row per offer per roll, all of them
  // repeating the terms of the offer they replaced, and after two rolls they outnumber the live
  // ones three to one and bury them in the middle of the screen. History stays one keystroke away.
  const live = book.legs.filter((leg) => leg.status !== 'docked');
  const docked = book.legs.filter((leg) => leg.status === 'docked');

  if (!connected) {
    return (
      <EmptyState
        icon={Layers}
        title="Connect a wallet to see your offers"
        description="An offer to sell your ETH at a price you choose. Your tokens stay in your wallet until someone takes it, so there is nothing to read until a wallet is connected."
        action={connectAction}
        note="No extension? The picker offers a demo wallet that signs locally against the Base fork."
      />
    );
  }

  if (book.error) {
    return (
      <Card title="Offers" description={description}>
        <ErrorState error={book.error} title="Could not read your offers" onRetry={book.refetch} bare />
      </Card>
    );
  }

  if (book.isLoading) {
    return (
      <Card title="Offers" description={description} flush>
        <Table caption="Your open offers" hideCaption minWidth="66rem">
          <Head />
          <TableBody>
            <TableSkeletonRows rows={4} columns={COLUMNS} label="your offers" />
          </TableBody>
        </Table>
      </Card>
    );
  }

  if (book.legs.length === 0) {
    return (
      <>
        <EmptyState
          icon={Layers}
          title="You have not made an offer yet"
          description="An offer to sell your ETH at a price you choose. Your tokens stay in your wallet until someone takes it, and one balance can stand behind several offers at once."
          note="On the local fork, the demo publishes offers to sell at 2,600 / 2,800 / 3,000 and one to buy at 2,300, all against one balance."
        />
        {book.foreignStrategies.length > 0 ? <ForeignNote count={book.foreignStrategies.length} className="mt-4" /> : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Offers"
        description={description}
        flush
        footer={
          <>
            <span>
              How much you can sell is what the guard would actually allow this instant, not what the
              offer advertises. <em className="not-italic text-ink-2">Mechanically:</em> the share
              still unsold is <span className="font-mono">Phi(-d1)</span>, read straight from the
              reserves rather than modelled, so no oracle is consulted anywhere on this screen.
            </span>
            <span className="font-mono text-mini tnum text-ink-3">
              {live.length} live
              {docked.length > 0 ? ` · ${docked.length} withdrawn` : null}
            </span>
          </>
        }
      >
        <Table
          caption="Your open offers"
          hideCaption
          minWidth="66rem"
          scrollHint="how much you can sell, minimum trade, paid so far"
        >
          <Head />
          <TableBody>
            {live.length === 0 && docked.length === 0 ? (
              <TableMessageRow colSpan={COLUMNS}>Nothing on offer yet.</TableMessageRow>
            ) : (
              <>
                {live.map((leg) => (
                  <LegRow key={leg.key} leg={leg} highlight={highlight} onHighlight={onHighlight} />
                ))}
                {live.length === 0 && docked.length > 0 ? (
                  <TableMessageRow colSpan={COLUMNS}>
                    Nothing live. Every offer this wallet made has been withdrawn.
                  </TableMessageRow>
                ) : null}
                {docked.length > 0 ? (
                  <DockedDisclosure open={showDocked} count={docked.length} onToggle={() => setShowDocked((v) => !v)} />
                ) : null}
                {showDocked
                  ? docked.map((leg) => (
                      <LegRow key={leg.key} leg={leg} highlight={highlight} onHighlight={onHighlight} />
                    ))
                  : null}
              </>
            )}
          </TableBody>
        </Table>
      </Card>

      {book.foreignStrategies.length > 0 ? <ForeignNote count={book.foreignStrategies.length} /> : null}
    </div>
  );
}

/**
 * The row that stands in for the withdrawn history: a real button in a real cell, so it is reachable
 * by Tab and announces its own state, rather than a chevron a pointer has to find.
 */
function DockedDisclosure({ open, count, onToggle }: { open: boolean; count: number; onToggle: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <tr>
      <td colSpan={COLUMNS} className="border-t border-line p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-meta text-ink-2 transition-state hover:bg-surface-2 hover:text-ink"
        >
          <Icon size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-3" />
          <span className="font-mono tnum">{count}</span>
          <span>{count === 1 ? 'withdrawn offer' : 'withdrawn offers'}</span>
          <span className="text-mini text-ink-3">
            {open ? 'shown below' : 'moved to a later date or taken down. Nobody can take these.'}
          </span>
        </button>
      </td>
    </tr>
  );
}

function ForeignNote({ count, className }: { count: number; className?: string }) {
  return (
    <Callout tone="info" title={`${count} other ${count === 1 ? 'strategy' : 'strategies'} on this router`} className={className}>
      Shipped to the Strikeline router by this wallet but carrying no <span className="font-mono">RmmSwap</span> instruction, so they are not
      offers to sell at a price, and this screen does not invent a price for them.
    </Callout>
  );
}
