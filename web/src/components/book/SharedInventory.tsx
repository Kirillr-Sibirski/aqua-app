'use client';

/**
 * The shared-inventory instrument: one bar per token, every leg's claim stacked inside it.
 *
 * It is the first thing on the screen because it is the thing that is different. Everywhere else in
 * DeFi, "how much can this position deliver" is answered by a balance that was moved into the
 * position when it was opened. Here it is answered by a balance that never moved, is shared by every
 * leg at once, and is re-read at every block — so the instrument is not a summary of the book, it is
 * the constraint the book is priced against.
 */
import { Wallet } from 'lucide-react';
import type { Hex } from 'viem';
import { Callout, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { formatTokenAmount } from '@/lib/ui';
import type { UseBookReturn } from '@/hooks/useBook';
import { InventoryBar } from './InventoryBar';

export interface SharedInventoryProps {
  book: UseBookReturn;
  /** True once a wallet is connected; drives the disconnected state. */
  connected: boolean;
  connectAction?: React.ReactNode;
  highlight?: Hex;
  onHighlight?: (hash: Hex | undefined) => void;
  /** Names the chain the numbers were read from, when the wallet is on a different one. */
  readChainName?: string;
}

export function SharedInventory({ book, connected, connectAction, highlight, onHighlight, readChainName }: SharedInventoryProps) {
  const description =
    'One balance backs every leg. The solid stack is what could be delivered if all of them were swept at once; beyond the wallet line is written and margined, not pre-funded.';

  if (!connected) {
    return (
      <EmptyState
        icon={Wallet}
        title="Connect a wallet to see the inventory"
        description="Strikeline never custodies anything, so there is no vault balance to show. The bar is your own wallet, read with balanceOf and allowance, which is exactly what Coverage checks when a taker asks for a fill."
        action={connectAction}
      />
    );
  }

  if (book.error) {
    return (
      <Card title="Shared inventory" description={description}>
        <ErrorState error={book.error} title="Could not read the inventory" onRetry={book.refetch} bare />
      </Card>
    );
  }

  if (book.isLoading || book.tokens.length === 0) {
    return (
      <Card title="Shared inventory" description={description}>
        <div className="flex flex-col gap-8">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <Skeleton className="h-5 w-16" label={i === 0 ? 'shared inventory' : undefined} />
                <Skeleton className="h-5 w-48" />
              </div>
              <Skeleton radius="control" className="h-11 w-full" />
              <div className="h-4" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const nothingWritten = book.tokens.every((t) => t.written === BigInt(0));
  const constrained = book.tokens.filter((t) => t.allowanceBinds && t.written > BigInt(0));

  return (
    <Card
      title="Shared inventory"
      description={description}
      footer={
        <>
          <span>
            {book.blockNumber === undefined
              ? 'Waiting for a block'
              : `Every figure read at block ${book.blockNumber.toString()}`}
            {readChainName ? ` on ${readChainName}` : null}
          </span>
          <span className="font-mono text-mini tnum text-ink-3">balanceOf &and; allowance(maker, AQUA)</span>
        </>
      }
    >
      <div className="flex flex-col gap-8">
        {book.tokens.map((token) => (
          <InventoryBar key={token.address} token={token} highlight={highlight} onHighlight={onHighlight} />
        ))}
      </div>

      {nothingWritten ? (
        <p className="mt-6 max-w-prose text-mini leading-prose text-ink-3">
          Nothing is written against this inventory yet. Ship a ladder and each leg appears here as a claim inside the bar it
          draws on.
        </p>
      ) : null}

      {!book.routerHasViews ? (
        <Callout tone="warning" title="This router does not answer StrikelineViews" className="mt-6">
          The wallet line falls back to <span className="font-mono">min(balanceOf, allowance)</span>, which is the same quantity{' '}
          <span className="font-mono">Coverage</span> enforces, but the leg rows below cannot read <span className="font-mono">tauNow</span>,{' '}
          <span className="font-mono">bandFor</span> or <span className="font-mono">coverage</span> from it. Point the deployment manifest at a
          StrikelineRouter.
        </Callout>
      ) : null}

      {constrained.length > 0 ? (
        <Callout tone="warning" title="An allowance, not a balance, is the binding limit" className="mt-6">
          {constrained.map((t) => (
            <span key={t.address} className="mr-4 inline-block font-mono text-meta tnum">
              {t.symbol} {formatTokenAmount(t.allowance, t.decimals)} approved of {formatTokenAmount(t.wallet, t.decimals)} held
            </span>
          ))}
        </Callout>
      ) : null}
    </Card>
  );
}
