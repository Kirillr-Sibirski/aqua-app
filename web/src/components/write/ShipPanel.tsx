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
  // The same predicate `useShipBook` uses to build the plan it will actually run. Listing an
  // approval for a token the book does not ship would promise a signature request that never
  // arrives, which is the sort of small lie that makes a maker distrust the rest of the panel.
  const plan = [
    ...(riskyNeeded > BigInt(0) ? [`Approve ${pair.risky.symbol} to Aqua`] : []),
    ...(stableNeeded > BigInt(0) ? [`Approve ${pair.stable.symbol} to Aqua`] : []),
    ...legs.map((leg, i) => `Publish offer ${i + 1} · sells at ${leg.draft.strike}`),
  ];

  return (
    <Card
      title="Publish"
      description={
        legs.length === 0
          ? 'Nothing to publish yet.'
          : `${legs.length} ${legs.length === 1 ? 'offer' : 'offers'}, one transaction each. Aqua has no multicall, so they land one at a time and each one is live the moment it mines.`
      }
      footer={
        transferLogs === undefined ? (
          <span>No token moves when you publish. The receipts will show it.</span>
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
          <CardRow label="Offers">{legs.length}</CardRow>
          <CardRow label="Runs to">
            <span className="font-mono tnum">{maturity ? formatExpiry(maturity) : '—'}</span>
          </CardRow>
          <CardRow label="Movement priced in">
            <span className="font-mono tnum">
              {sigma === undefined ? '—' : `${(sigma * 100).toFixed(1)}%`}
            </span>
          </CardRow>
          <CardRow label={`${pair.risky.symbol} on offer`}>
            <TokenAmount value={riskyNeeded} decimals={pair.risky.decimals} size="sm" />
          </CardRow>
          <CardRow label={`${pair.stable.symbol} on offer`}>
            <TokenAmount value={stableNeeded} decimals={pair.stable.decimals} size="sm" />
          </CardRow>
        </dl>

        <Button
          icon={Ship}
          loading={isRunning}
          loadingLabel="Publishing"
          disabled={legs.length === 0 || Boolean(disabledReason)}
          disabledReason={
            legs.length === 0 ? 'Pick at least one price first.' : disabledReason
          }
          onClick={onShip}
        >
          Publish {legs.length || ''} {legs.length === 1 ? 'offer' : 'offers'}
        </Button>

        <TxStepper steps={steps} plan={plan} chainId={chainId} />

        {error ? <ErrorState error={error} title="Not every offer was published" bare /> : null}

        {shipped && shipped.length > 0 ? (
          <Callout tone="positive" title="Live">
            <p>
              Your wallet still holds every token. Each offer is quoting against{' '}
              <span className="font-mono">{formatUnits(riskyNeeded, pair.risky.decimals)}</span>{' '}
              {pair.risky.symbol} that never moved. Nobody has paid you yet: that happens when
              somebody takes one.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {shipped.map((hash, i) => (
                <li key={hash}>
                  <Link
                    href={`/leg/${hash}`}
                    className="inline-flex items-center gap-1 rounded-control font-mono text-mini tnum text-accent transition-state hover:underline"
                  >
                    Offer {i + 1}
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
