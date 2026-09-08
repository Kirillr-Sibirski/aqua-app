'use client';

/**
 * Your offers. The second tab, and never the front door.
 *
 * Options trading genuinely needs a positions view; it does not need to be what greets a first-time
 * visitor. So this screen assumes the reader has already published something, and spends its whole
 * area on the two things that are true here and nowhere else:
 *
 *  1. **The backing bars come first and are the largest object on the page.** One bar per token: the
 *     real wallet balance, with every offer's claim on it stacked inside. Not a stat tile. A pool, a
 *     vault or a v4 hook cannot draw this, because in all three the collateral was segregated when
 *     the position was opened; here it never moved, and one fill moves the line under every offer at
 *     once.
 *  2. **Every number comes from one block.** `useBook` pins two multicall rounds and the fill replay
 *     to the watched block number, so the bar and the rows move together instead of drifting into
 *     place as separate pollers fire. Simultaneity is the evidence, so it has to be literal — and
 *     the block it was read at is printed in the bar at the top of the page.
 *
 * Hovering a row lights its segment and vice versa: the link between "this offer can hand over 9.22
 * WETH" and "that is this slice of one balance" is the whole idea, and it should need no explaining.
 *
 * Nothing on this screen is modelled. Terms are decoded from the bytes Aqua published, what can be
 * taken is the bound the guard itself reported, what has been earned is replayed from the spread
 * each past fill actually cleared, and no oracle is read anywhere.
 */
import { Alert, Button, Paper, Skeleton, Text, Title } from '@mantine/core';
import Link from 'next/link';
import { useState } from 'react';
import type { Hex } from 'viem';
import { useConnection } from 'wagmi';
import { AppChrome, useDeploymentChain, useIsHydrated } from '@/components/shell';

import { useBook } from '@/hooks/useBook';
import { describeError, formatTokenAmount } from '@/lib/ui';
import { BackingBar } from './BackingBar';
import { OffersDisconnected, OffersNone } from './OffersEmpty';
import { OffersTable } from './OffersTable';
import { HATCH } from './visual';

const ZERO = BigInt(0);

export function OffersScreen() {
  const hydrated = useIsHydrated();
  const { address, chainId } = useConnection();
  const deploymentChain = useDeploymentChain();
  const [highlight, setHighlight] = useState<Hex | undefined>(undefined);

  const book = useBook(address, { enabled: hydrated });

  // Server and hydration renders must agree byte for byte and none of the wallet state exists on
  // the server, so both emit the disconnected screen and the live one arrives a commit later.
  const connected = hydrated && !!address;
  const wrongNetwork = connected && chainId !== deploymentChain.chainId;

  const live = book.legs.filter((leg) => leg.status !== 'docked');
  const withdrawn = book.legs.filter((leg) => leg.status === 'docked');
  // Only tokens something is actually promised against get a bar. A balance nothing draws on is a
  // wallet screenshot, not the picture this page is for.
  const bars = book.tokens.filter((token) => token.written > ZERO);
  // Optimistic while the first read is in flight: this tab is only reachable from a nav item that
  // already knows there are offers, so assuming them costs no correctness and saves the header
  // appearing a beat after the skeletons.
  const hasOffers = connected && !book.error && (book.isLoading || book.legs.length > 0);

  return (
    <AppChrome
      blockNumber={book.blockNumber}
      readChainName={wrongNetwork ? deploymentChain.name : undefined}
    >
      {/* The title, the subtitle and the second action are all claims about offers, so they appear
          only once there are offers to make them about. With nothing to show, a left-aligned page
          title stranded beside a centred 480px card is two layouts at once — the card is the whole
          screen and says its own name in its own heading. The h1 stays for the document outline. */}
      {hasOffers ? (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Title order={1} fz="var(--text-title)" c="var(--ink)">
              Your offers
            </Title>
            <Text mt={6} size="sm" c="var(--ink-2)" className="max-w-[70ch]">
              One wallet stands behind all of them, and it never moves. The moment somebody takes
              one offer, what the others can hand over shrinks — in the same block, with nothing to
              settle.
            </Text>
          </div>
          <Button component={Link} href="/" variant="default" size="sm">
            Make another offer
          </Button>
        </header>
      ) : (
        <h1 className="sr-only">Your offers</h1>
      )}

      {!connected ? (
        <div className="mt-12 sm:mt-20">
          <OffersDisconnected />
        </div>
      ) : book.error ? (
        <ErrorPanel error={book.error} onRetry={book.refetch} />
      ) : book.isLoading ? (
        <LoadingPanel />
      ) : book.legs.length === 0 ? (
        <div className="mt-12 sm:mt-20">
          <OffersNone />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {bars.length > 0 ? (
            <Paper
              withBorder
              radius="xl"
              p="lg"
              bg="var(--surface)"
              style={{ borderColor: 'var(--line)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex flex-col gap-8">
                {bars.map((token) => (
                  <BackingBar
                    key={token.address}
                    token={token}
                    highlight={highlight}
                    onHighlight={setHighlight}
                  />
                ))}
              </div>

              <p className="mt-6 border-t border-line pt-4 text-mini leading-prose text-ink-2">
                <span className="inline-flex items-center gap-1.5 align-middle">
                  <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-[2px] bg-accent" />
                  Solid
                </span>{' '}
                is what your wallet can hand over right now.{' '}
                <span className="inline-flex items-center gap-1.5 align-middle">
                  <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-[2px] border border-line" style={{ backgroundImage: HATCH }} />
                  Hatched
                </span>{' '}
                is promised past it — any one offer can still be taken up to the line, and taking it
                shrinks what the rest can deliver. That is what one balance backing several offers
                means, and it is checked inside the same call that prices the trade.
              </p>
            </Paper>
          ) : null}

          <OffersTable
            live={live}
            withdrawn={withdrawn}
            highlight={highlight}
            onHighlight={setHighlight}
          />

          <Footnotes book={book} wrongNetwork={wrongNetwork} readChainName={deploymentChain.name} />
        </div>
      )}
    </AppChrome>
  );
}

function LoadingPanel() {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <Paper
        withBorder
        radius="xl"
        p="lg"
        bg="var(--surface)"
        style={{ borderColor: 'var(--line)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex flex-col gap-8">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <Skeleton height={20} width={72} radius="sm" />
                <Skeleton height={20} width={280} radius="sm" />
              </div>
              <Skeleton height={56} radius="md" />
              <Skeleton height={14} width="100%" radius="sm" />
            </div>
          ))}
        </div>
      </Paper>
      <Paper withBorder radius="xl" p="lg" bg="var(--surface)" style={{ borderColor: 'var(--line)' }}>
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={36} radius="sm" />
          ))}
        </div>
      </Paper>
      <span className="sr-only" role="status">
        Reading your offers from the chain
      </span>
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const described = describeError(error);
  return (
    <Alert
      mt="lg"
      color="ember"
      variant="light"
      radius="lg"
      title={described.name ?? 'Could not read your offers'}
    >
      <Text size="sm" c="var(--ink-2)">
        {described.message}
      </Text>
      <Button mt="md" size="xs" variant="default" onClick={onRetry}>
        Try again
      </Button>
    </Alert>
  );
}

/**
 * The three things the page owes the reader once it has drawn everything: which block it all came
 * from, whether the approval rather than the balance is the binding term, and whether the router
 * answered at all.
 */
function Footnotes({
  book,
  wrongNetwork,
  readChainName,
}: {
  book: ReturnType<typeof useBook>;
  wrongNetwork: boolean;
  readChainName: string;
}) {
  const constrained = book.tokens.filter((t) => t.allowanceBinds && t.written > ZERO);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-mini leading-prose text-ink-3">
        {book.blockNumber === undefined
          ? 'Waiting for a block.'
          : `Every figure on this page was read at block ${book.blockNumber.toString()}${wrongNetwork ? ` on ${readChainName}` : ''}, in one snapshot, so the bars and the rows agree with each other rather than drifting into place separately.`}{' '}
        What has been earned is the spread past buyers actually crossed, replayed from the chain at
        each trade&rsquo;s own block. It stays at zero until somebody trades.
        {book.foreignStrategies.length > 0 ? (
          <>
            {' '}
            {book.foreignStrategies.length === 1
              ? '1 other strategy from this wallet sits on the same router without a price curve, so it is not an offer and is not listed.'
              : `${book.foreignStrategies.length} other strategies from this wallet sit on the same router without a price curve, so they are not offers and are not listed.`}
          </>
        ) : null}
      </p>

      {constrained.length > 0 ? (
        <Alert color="amber" variant="light" radius="lg" title="Your approval, not your balance, is the limit">
          <div className="flex flex-col gap-1">
            {constrained.map((t) => (
              <span key={t.address} className="font-mono text-mini tnum text-ink-2">
                {t.symbol}: {formatTokenAmount(t.allowance, t.decimals)} approved of{' '}
                {formatTokenAmount(t.wallet, t.decimals)} held
              </span>
            ))}
          </div>
        </Alert>
      ) : null}

      {!book.routerHasViews ? (
        <Alert color="amber" variant="light" radius="lg" title="This router does not answer StrikelineViews">
          <Text size="xs" c="var(--ink-2)">
            The wallet line falls back to <span className="font-mono">min(balanceOf, allowance)</span>,
            the same quantity the guard enforces, but the rows cannot read the live curve from it.
            Point the deployment manifest at a StrikelineRouter.
          </Text>
        </Alert>
      ) : null}
    </div>
  );
}
