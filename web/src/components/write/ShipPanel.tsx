'use client';

/**
 * Step four: sign it.
 *
 * The panel states what is about to happen before it happens — how many transactions, what each one
 * is, and the fact that none of them moves a token. `ship` writes a virtual balance and emits
 * `Shipped` plus a `Pushed` per token; the ERC-20 balances in the wallet are identical afterwards.
 * That is a claim, so once the receipts are in it is checked rather than repeated: every log is
 * scanned for the `Transfer` topic and the count is printed.
 *
 * There is no `Aqua.multicall` on the deployed registry, so a book is one transaction per leg plus
 * the approvals. The panel says that rather than implying atomicity it does not have.
 */
import { ArrowRight, Ship } from 'lucide-react';
import Link from 'next/link';
import { Button, Callout, Card, CardRow, ErrorState, Pill, TokenAmount } from '@/components/ui';
import { formatUnits } from '@/lib/ui';
import type { TxStep } from '@/hooks';
import { TxStepper, countTransferLogs } from './TxStepper';
import { formatExpiry } from './expiry';
import type { SizedLeg, WritePair } from './types';

export interface ShipPanelProps {
  pair: WritePair;
  legs: readonly SizedLeg[];
  riskyNeeded: bigint;
  stableNeeded: bigint;
  maturity?: number;
  /** Implied vol as a ratio, for the summary line. */
  sigma?: number;
  steps: readonly TxStep[];
  isRunning: boolean;
  error?: string;
  /** Set once every leg has been shipped, so the panel can link to them. */
  shipped?: readonly `0x${string}`[];
  chainId?: number;
  onShip: () => void;
  /** Why shipping is not possible yet, in one sentence. */
  disabledReason?: string;
}

export function ShipPanel({
  pair,
  legs,
  riskyNeeded,
  stableNeeded,
  maturity,
  sigma,
  steps,
  isRunning,
  error,
  shipped,
  chainId,
  onShip,
  disabledReason,
}: ShipPanelProps) {
  const transferLogs = countTransferLogs(steps);
  const plan = [
    `Approve ${pair.risky.symbol} to Aqua`,
    `Approve ${pair.stable.symbol} to Aqua`,
    ...legs.map((leg, i) => `Ship leg ${i + 1} · K ${leg.draft.strike}`),
  ];

  return (
    <Card
      title="Ship"
      description={
        legs.length === 0
          ? 'Nothing to ship yet.'
          : `${legs.length} ${legs.length === 1 ? 'leg' : 'legs'}, one transaction each. Aqua has no multicall, so they land one at a time and each is live the moment it mines.`
      }
      footer={
        transferLogs === undefined ? (
          <span>Aqua moves no tokens on ship. The receipts will show it.</span>
        ) : (
          <span className="flex items-center gap-2">
            <Pill tone={transferLogs === 0 ? 'positive' : 'warning'} size="sm">
              {transferLogs} ERC-20 Transfer logs
            </Pill>
            <span>counted across every receipt</span>
          </span>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col">
          <CardRow label="Legs">{legs.length}</CardRow>
          <CardRow label="Expiry">
            <span className="font-mono tnum">{maturity ? formatExpiry(maturity) : '—'}</span>
          </CardRow>
          <CardRow label="Implied vol">
            <span className="font-mono tnum">
              {sigma === undefined ? '—' : `${(sigma * 100).toFixed(1)}%`}
            </span>
          </CardRow>
          <CardRow label={`${pair.risky.symbol} shipped`}>
            <TokenAmount value={riskyNeeded} decimals={pair.risky.decimals} size="sm" />
          </CardRow>
          <CardRow label={`${pair.stable.symbol} shipped`}>
            <TokenAmount value={stableNeeded} decimals={pair.stable.decimals} size="sm" />
          </CardRow>
        </dl>

        <Button
          icon={Ship}
          loading={isRunning}
          loadingLabel="Shipping the book"
          disabled={legs.length === 0 || Boolean(disabledReason)}
          disabledReason={
            legs.length === 0 ? 'Add at least one leg to ship a book.' : disabledReason
          }
          onClick={onShip}
        >
          Ship {legs.length || ''} {legs.length === 1 ? 'leg' : 'legs'}
        </Button>

        <TxStepper steps={steps} plan={plan} chainId={chainId} />

        {error ? <ErrorState error={error} title="The book was not fully shipped" bare /> : null}

        {shipped && shipped.length > 0 ? (
          <Callout tone="positive" title="Shipped">
            <p>
              The wallet still holds every token. Each leg is quoting from{' '}
              <span className="font-mono">{formatUnits(riskyNeeded, pair.risky.decimals)}</span>{' '}
              {pair.risky.symbol} that never moved.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {shipped.map((hash, i) => (
                <li key={hash}>
                  <Link
                    href={`/leg/${hash}`}
                    className="inline-flex items-center gap-1 rounded-control font-mono text-mini tnum text-accent transition-state hover:underline"
                  >
                    Leg {i + 1}
                    <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}
      </div>
    </Card>
  );
}
