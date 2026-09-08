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
    'One balance stands behind every offer. The solid part of the stack is what could actually be sold if every offer were taken at once; past the wallet line is offered and margin-checked, not set aside in advance.';

  if (!connected) {
    return (
      <EmptyState
        icon={Wallet}
        title="Connect a wallet to see what stands behind your offers"
        description="Nothing is ever custodied here, so there is no vault balance to show. The bar is your own wallet, and it is exactly what gets checked when somebody tries to take one of your offers."
        action={connectAction}
      />
    );
  }

  if (book.error) {
    return (
      <Card title="The wallet behind every offer" description={description}>
        <ErrorState error={book.error} title="Could not read your wallet" onRetry={book.refetch} bare />
      </Card>
    );
  }

  if (book.isLoading || book.tokens.length === 0) {
    return (
      <Card title="The wallet behind every offer" description={description}>
        <div className="flex flex-col gap-8">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <Skeleton className="h-5 w-16" label={i === 0 ? 'the wallet behind every offer' : undefined} />
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
      title="The wallet behind every offer"
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
          You have no offers against this balance yet. Name a price and each offer appears here as a
          claim inside the bar it draws on.
        </p>
      ) : null}

      {!book.routerHasViews ? (
        <Callout tone="warning" title="This router does not answer StrikelineViews" className="mt-6">
          The wallet line falls back to <span className="font-mono">min(balanceOf, allowance)</span>, which is the same quantity{' '}
          <span className="font-mono">Coverage</span> enforces, but the offer rows below cannot read <span className="font-mono">tauNow</span>,{' '}
          <span className="font-mono">bandFor</span> or <span className="font-mono">coverage</span> from it. Point the deployment manifest at a
          StrikelineRouter.
        </Callout>
      ) : null}

      {constrained.length > 0 ? (
        <Callout tone="warning" title="Your approval, not your balance, is the limit right now" className="mt-6">
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
