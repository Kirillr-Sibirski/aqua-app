'use client';

/**
 * The legs, as rows.
 *
 * Seven columns, and only two of them are the sort of number a maker could get anywhere else. The
 * other five exist because the option is a curve rather than a contract:
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
import { Layers } from 'lucide-react';
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
        <TableHeaderCell>Leg</TableHeaderCell>
        <TableHeaderCell>Expiry</TableHeaderCell>
        <TableHeaderCell numeric>IV</TableHeaderCell>
        <TableHeaderCell numeric>Moneyness</TableHeaderCell>
        <TableHeaderCell numeric>Deliverable depth</TableHeaderCell>
        <TableHeaderCell numeric>Theta band</TableHeaderCell>
        <TableHeaderCell numeric>Realised theta</TableHeaderCell>
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
      interactive
      onMouseEnter={() => onHighlight?.(leg.strategyHash)}
      onMouseLeave={() => onHighlight?.(undefined)}
    >
      <TableHeaderCell scope="row" title={truncateHash(leg.strategyHash)}>
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="font-mono text-lead tnum text-ink">{leg.strikeLabel}</span>
            <span className="text-meta text-ink-2">{leg.kind}</span>
            {leg.status === 'docked' ? (
              <Pill tone="neutral" size="sm">
                Docked
              </Pill>
            ) : leg.status === 'settling' ? (
              <Pill tone="warning" size="sm">
                Settling
              </Pill>
            ) : leg.status === 'idle' ? (
              <Pill tone="neutral" size="sm">
                Empty
              </Pill>
            ) : null}
            {leg.guarded ? null : (
              <Pill tone="negative" size="sm">
                Unguarded
              </Pill>
            )}
          </span>
          <span className="text-mini text-ink-3">
            delivers {(leg.deliversRisky ? leg.risky : leg.stable).symbol}
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
          <span className="font-mono text-mini tnum text-ink-3">
            {leg.tauWad === undefined ? 'tau unread' : `tau ${formatUnits(leg.tauWad, 18, { significantDigits: 3 })}y`}
          </span>
        </div>
      </TableCell>

      <TableCell numeric>{formatPercent(sigmaRatio(leg.rmm.sigmaWad), { fractionDigits: 1 })}</TableCell>

      <TableCell numeric>
        <div className="flex flex-col items-end gap-0.5 leading-num">
          <span>{formatPercent(leg.deltaRatio, { fractionDigits: 1 })}</span>
          <span className="font-mono text-mini tnum text-ink-3">X/L</span>
        </div>
      </TableCell>

      <TableCell numeric>
        <DepthCell leg={leg} />
      </TableCell>

      <TableCell numeric>
        {leg.bandNext === undefined ? (
          <span className="text-ink-3">{leg.bandPending ? 'reading' : '-'}</span>
        ) : leg.bandNext === ZERO ? (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            <span className="text-ink-3">0</span>
            <span className="text-mini text-ink-3">on the curve</span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            <TokenAmount value={leg.bandNext} decimals={leg.bandToken.decimals} symbol={leg.bandToken.symbol} size="sm" />
            <span className="text-mini text-ink-3">the next fill pays</span>
          </div>
        )}
      </TableCell>

      <TableCell numeric>
        {thetaAmounts.length === 0 ? (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            <span className="text-ink-3">{theta?.pending ? 'replaying' : '0'}</span>
            <span className="text-mini text-ink-3">{theta ? `${theta.fills} ${theta.fills === 1 ? 'fill' : 'fills'}` : 'no fills'}</span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-0.5 leading-num">
            {thetaAmounts.map((entry) => (
              <TokenAmount key={entry.token.address} value={entry.amount} decimals={entry.token.decimals} symbol={entry.token.symbol} size="sm" />
            ))}
            <span className="text-mini text-ink-3">
              {theta?.fills} {theta?.fills === 1 ? 'fill' : 'fills'}
              {theta?.incomplete ? ', one band unread' : null}
            </span>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function LegsTable({ book, connected, connectAction, highlight, onHighlight }: LegsTableProps) {
  const description = 'Each row is a SwapVM program shipped to Aqua. The terms are decoded from the bytes the Shipped event carried.';

  if (!connected) {
    return (
      <EmptyState
        icon={Layers}
        title="Connect a wallet to see the book"
        description="Legs are discovered from Aqua's own Shipped logs and decoded with the verified encoder, so there is nothing to read until there is a maker to read for."
        action={connectAction}
        note="No extension? The picker offers a demo wallet that signs locally against the Base fork."
      />
    );
  }

  if (book.error) {
    return (
      <Card title="Legs" description={description}>
        <ErrorState error={book.error} title="Could not read the book" onRetry={book.refetch} bare />
      </Card>
    );
  }

  if (book.isLoading) {
    return (
      <Card title="Legs" description={description} flush>
        <Table caption="Legs in this book" hideCaption minWidth="66rem">
          <Head />
          <TableBody>
            <TableSkeletonRows rows={4} columns={COLUMNS} label="book" />
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
          title="No legs shipped from this wallet"
          description="A leg is a covered call or a cash-secured put written as a price curve: one RmmSwap instruction, wrapped in Coverage, shipped to Aqua against tokens that never leave your wallet."
          note="On the local fork, the demo book ships a 2,600 / 2,800 / 3,000 call ladder and a 2,300 put against one balance."
        />
        {book.foreignStrategies.length > 0 ? <ForeignNote count={book.foreignStrategies.length} className="mt-4" /> : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Legs"
        description={description}
        flush
        footer={
          <>
            <span>
              Depth is the bound the guard reports, not the virtual balance. Moneyness is{' '}
              <span className="font-mono">X/L = Phi(-d1)</span>, read from the reserves: no oracle is consulted on this screen.
            </span>
            <span className="font-mono text-mini tnum text-ink-3">
              {book.legs.length} {book.legs.length === 1 ? 'leg' : 'legs'}
            </span>
          </>
        }
      >
        <Table caption="Legs in this book" hideCaption minWidth="66rem">
          <Head />
          <TableBody>
            {book.legs.length === 0 ? (
              <TableMessageRow colSpan={COLUMNS}>Nothing shipped yet.</TableMessageRow>
            ) : (
              book.legs.map((leg) => <LegRow key={leg.key} leg={leg} highlight={highlight} onHighlight={onHighlight} />)
            )}
          </TableBody>
        </Table>
      </Card>

      {book.foreignStrategies.length > 0 ? <ForeignNote count={book.foreignStrategies.length} /> : null}
    </div>
  );
}

function ForeignNote({ count, className }: { count: number; className?: string }) {
  return (
    <Callout tone="info" title={`${count} other ${count === 1 ? 'strategy' : 'strategies'} on this router`} className={className}>
      Shipped to the Strikeline router by this wallet but carrying no <span className="font-mono">RmmSwap</span> instruction, so they are not
      option legs and the book does not invent terms for them.
    </Callout>
  );
}
