'use client';

/**
 * The census and its provenance, as one sentence.
 *
 * This used to be a four-up grid of stat tiles — Live offers / Wallets offering / Total on offer /
 * Read via — which is the identical-tile pattern PRODUCT.md lists as an anti-reference and the
 * shape the operator's verdict was about. None of the four numbers is the reason to be on this
 * page; the reason is the cross-maker answer below, and the census is context for it. Context is a
 * line of prose.
 *
 * Nothing was dropped. Every figure the tiles carried is in the sentence, and the provenance a read
 * layer owes its reader — which source answered, at which block, how far behind the index is — is
 * the second half of it, because a read layer that will not say where its numbers came from is
 * asking to be trusted rather than checked.
 */
import { Skeleton, Text } from '@mantine/core';
import { formatUnits } from '@/lib/ui';
import type { SurfaceCensus, SurfaceSource } from './types';

export interface SourceStripProps {
  census: SurfaceCensus;
  source: SurfaceSource;
  lensVia?: 'deployed' | 'deployless';
  blockNumber?: bigint;
  indexedBlock?: bigint;
  loading?: boolean;
  /** Symbol of the risky side, for the size figure. */
  riskySymbol: string;
}

export function SourceStrip({
  census,
  source,
  blockNumber,
  indexedBlock,
  loading,
  riskySymbol,
}: SourceStripProps) {
  const behind =
    source === 'subgraph' && blockNumber !== undefined && indexedBlock !== undefined
      ? blockNumber - indexedBlock
      : undefined;

  if (loading) return <Skeleton height={18} width="70%" radius="sm" />;

  const size = formatUnits(census.writtenWad, 18, { significantDigits: 6 });
  const wallets = `${census.makers} ${census.makers === 1 ? 'wallet' : 'wallets'}`;
  const prices = `${census.strikes} ${census.strikes === 1 ? 'price' : 'prices'}`;
  const dates = `${census.expiries} ${census.expiries === 1 ? 'date' : 'dates'}`;
  const guarded =
    census.guarded === census.liveLegs
      ? 'Every one checks its seller’s wallet before it quotes.'
      : `${census.guarded} of them check their seller’s wallet before quoting.`;

  return (
    <Text size="sm" c="var(--ink-2)" className="leading-prose">
      <span className="font-mono tnum">{census.liveLegs}</span> live{' '}
      {census.liveLegs === 1 ? 'offer' : 'offers'} from {wallets}, across {prices} and {dates},{' '}
      <span className="font-mono tnum">{size}</span> {riskySymbol} on offer in total. {guarded}{' '}
      {blockNumber === undefined
        ? 'Waiting for a block.'
        : `Read ${source === 'subgraph' ? 'from the subgraph' : 'straight from the event logs'} at block ${formatUnits(blockNumber, 0)}${
            behind !== undefined && behind > BigInt(0)
              ? `, with the index ${formatUnits(behind, 0)} behind the chain`
              : ''
          }.`}
    </Text>
  );
}
