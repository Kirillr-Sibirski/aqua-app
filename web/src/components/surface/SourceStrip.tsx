'use client';

/**
 * Where these numbers came from.
 *
 * A read layer that will not say which of its sources answered is asking to be trusted rather than
 * checked, and a stale index is a lie told confidently. So the census sits beside its provenance:
 * how many offers were decoded, from how many wallets, at which block, through which path.
 */
import { Badge, Paper, SimpleGrid } from '@mantine/core';
import { formatUnits } from '@/lib/ui';
import { Amount, Stat } from './kit';
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
  lensVia,
  blockNumber,
  indexedBlock,
  loading,
  riskySymbol,
}: SourceStripProps) {
  const behind =
    source === 'subgraph' && blockNumber !== undefined && indexedBlock !== undefined
      ? blockNumber - indexedBlock
      : undefined;

  return (
    <Paper withBorder radius="xl" p="lg">
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xl" verticalSpacing="lg">
        <Stat
          label="Live offers"
          loading={loading}
          value={census.liveLegs.toString()}
          unit={census.legs === census.liveLegs ? undefined : `of ${census.legs} ever made`}
          detail={
            census.guarded === census.liveLegs
              ? 'Every one checks its seller’s wallet before it quotes'
              : `${census.guarded} of ${census.liveLegs} check their seller’s wallet`
          }
        />
        <Stat
          label="Wallets offering"
          loading={loading}
          value={census.makers.toString()}
          detail={`${census.strikes} ${census.strikes === 1 ? 'price' : 'prices'}, ${census.expiries} ${census.expiries === 1 ? 'date' : 'dates'}`}
        />
        <Stat
          label="Total on offer"
          loading={loading}
          value={<Amount value={census.writtenWad} decimals={18} size="lg" />}
          unit={riskySymbol}
          detail="Added up across every live offer"
        />
        <Stat
          label="Read via"
          loading={loading}
          value={source === 'subgraph' ? 'Subgraph' : 'Event logs'}
          aside={
            <Badge
              variant="light"
              color={source === 'subgraph' ? 'petrol' : 'slate'}
              size="sm"
              radius="sm"
            >
              {lensVia === 'deployless'
                ? 'Lens inline'
                : lensVia === 'deployed'
                  ? 'Lens live'
                  : 'Decoded'}
            </Badge>
          }
          detail={
            blockNumber === undefined
              ? 'Waiting for a block'
              : behind !== undefined && behind > BigInt(0)
                ? `Block ${formatUnits(blockNumber, 0)}, index ${formatUnits(behind, 0)} behind`
                : `Block ${formatUnits(blockNumber, 0)}`
          }
        />
      </SimpleGrid>
    </Paper>
  );
}
