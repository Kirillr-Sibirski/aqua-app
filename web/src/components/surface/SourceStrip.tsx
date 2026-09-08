'use client';

/**
 * Where these numbers came from.
 *
 * A read layer that will not say which of its sources answered is asking to be trusted rather than
 * checked, and a stale index is a lie told confidently. So the census sits beside its provenance:
 * how many quotes were decoded, from how many makers, at which block, through which path.
 */
import { Pill, StatRow, StatTile, TokenAmount } from '@/components/ui';
import { formatUnits } from '@/lib/ui';
import type { SurfaceCensus, SurfaceSource } from './types';

export interface SourceStripProps {
  census: SurfaceCensus;
  source: SurfaceSource;
  lensVia?: 'deployed' | 'deployless';
  blockNumber?: bigint;
  indexedBlock?: bigint;
  loading?: boolean;
  /** Symbol of the risky side, for the notional figure. */
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
    <StatRow>
      <StatTile
        label="Live quotes"
        loading={loading}
        value={census.liveLegs.toString()}
        unit={census.legs === census.liveLegs ? undefined : `of ${census.legs} written`}
        detail={
          census.guarded === census.liveLegs
            ? 'Every one margined by Coverage'
            : `${census.guarded} of ${census.liveLegs} margined by Coverage`
        }
      />
      <StatTile
        label="Makers"
        loading={loading}
        value={census.makers.toString()}
        detail={`${census.strikes} strikes, ${census.expiries} ${census.expiries === 1 ? 'expiry' : 'expiries'}`}
      />
      <StatTile
        label="Notional written"
        loading={loading}
        value={<TokenAmount value={census.writtenWad} decimals={18} size="lg" />}
        unit={riskySymbol}
        detail="Sum of L across live legs"
      />
      <StatTile
        label="Read via"
        loading={loading}
        value={source === 'subgraph' ? 'Subgraph' : 'Event logs'}
        aside={
          <Pill tone={source === 'subgraph' ? 'accent' : 'neutral'} size="sm">
            {lensVia === 'deployless' ? 'Lens inline' : lensVia === 'deployed' ? 'Lens live' : 'Decoded'}
          </Pill>
        }
        detail={
          blockNumber === undefined
            ? 'Waiting for a block'
            : behind !== undefined && behind > BigInt(0)
              ? `Block ${formatUnits(blockNumber, 0)}, index ${formatUnits(behind, 0)} behind`
              : `Block ${formatUnits(blockNumber, 0)}`
        }
      />
    </StatRow>
  );
}
