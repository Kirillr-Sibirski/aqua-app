'use client';

/**
 * The book.
 *
 * The claim this screen has to carry is one sentence: *one wallet backs the whole ladder, and a
 * fill on any leg shrinks what the others can deliver, in the same block, with no keeper.* Three
 * decisions serve it and nothing else:
 *
 *  1. **The shared inventory is first and it is the largest thing on the page.** Not a stat tile —
 *     a bar per token with every leg's claim stacked inside it and a line where the wallet runs
 *     out. It is the only picture in this category that a pool, a vault or a v4 hook cannot draw,
 *     because in all three the collateral was segregated when the position was opened.
 *  2. **Every number comes from one block.** The watched block number is passed into each read, so
 *     the bar and the seven leg rows move together rather than drifting into place as separate
 *     pollers fire. Simultaneity is the evidence, so it has to be literal.
 *  3. **Hovering a row lights its segment.** The link between "leg 2 delivers 9.22 WETH" and "that
 *     is this slice of one balance" is the whole idea, and it should take no explaining.
 *
 * Nothing here is modelled. Terms are decoded from the bytes Aqua published, depth is the bound the
 * guard reports, realised theta is replayed from the band each past fill cleared, and no oracle is
 * read anywhere on the screen.
 */
import { useState } from 'react';
import type { Hex } from 'viem';
import { useConnection } from 'wagmi';
import { AppShell, PageHeader, useDeploymentChain, useIsHydrated } from '@/components/shell';
import { ConnectButton } from '@/components/wallet';
import { Address as AddressText, Pill } from '@/components/ui';
import { KpiStrip, LegsTable, SharedInventory } from '@/components/book';
import { useBook } from '@/hooks/useBook';

export function BookScreen() {
  const hydrated = useIsHydrated();
  const { address, chainId } = useConnection();
  const deploymentChain = useDeploymentChain();
  const [highlight, setHighlight] = useState<Hex | undefined>(undefined);

  const book = useBook(address, { enabled: hydrated });

  // Server and hydration renders must agree byte for byte, and none of the wallet state exists on
  // the server, so both emit the disconnected screen and the live one arrives a commit later.
  const connected = hydrated && !!address;
  const wrongNetwork = hydrated && !!address && chainId !== deploymentChain.chainId;

  return (
    <AppShell>
      <PageHeader
        title="Book"
        subtitle="One wallet, a ladder of legs written against it, and the margin that makes the over-allocation real."
        meta={
          <>
            {connected ? (
              <AddressText value={address} kind="address" what="maker" />
            ) : (
              <Pill tone="neutral">No wallet connected</Pill>
            )}
            {book.blockNumber !== undefined ? (
              <Pill tone="accent" dot>
                Block {book.blockNumber.toString()}
              </Pill>
            ) : null}
            {wrongNetwork ? <Pill tone="warning">Reads come from {deploymentChain.name}</Pill> : null}
          </>
        }
      />

      <div className="mt-8 flex flex-col gap-10">
        <KpiStrip kpis={book.kpis} blockTimestamp={book.blockTimestamp} loading={connected && book.isLoading} />

        <SharedInventory
          book={book}
          connected={connected}
          connectAction={<ConnectButton size="md" />}
          highlight={highlight}
          onHighlight={setHighlight}
          readChainName={wrongNetwork ? deploymentChain.name : undefined}
        />

        <LegsTable
          book={book}
          connected={connected}
          connectAction={<ConnectButton size="md" />}
          highlight={highlight}
          onHighlight={setHighlight}
        />
      </div>
    </AppShell>
  );
}
