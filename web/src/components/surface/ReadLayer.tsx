'use client';

/**
 * Where this page gets its answers, said out loud.
 *
 * An options market needs one thing before it can exist: somewhere to look up what the same option
 * costs from everyone else. Aqua has no such place. It keys a strategy by the hash of its own bytes,
 * relates nothing to anything, and publishes no book — two makers who wrote the same option are two
 * unrelated storage slots. So the price discovery has to be reconstructed, and the only public
 * record of what anyone wrote is the event log.
 *
 * That is what the subgraph in `subgraph/` is: a mapping that decodes each shipped program as it
 * indexes it, turning opaque bytes into `Leg`, `Maker`, `Fill` and `SurfacePoint` entities, so
 * "who is offering the best terms on this option" is one query instead of a scan of every block
 * since deployment.
 *
 * This panel exists because a read layer that will not name its own source is asking to be trusted
 * rather than checked. It says which path answered this page load, how far behind the index is, and
 * prints the query itself — with the strike and expiry currently on screen substituted in, so it can
 * be pasted into a Graph playground and checked against what the page is showing.
 */
import type { ReactNode } from 'react';
import { Card, CopyButton, Pill, Skeleton } from '@/components/ui';
import { formatUnits } from '@/lib/ui';
import { SUBGRAPH_URL } from './subgraph';
import type { SurfacePoint, SurfaceSource } from './types';

export interface ReadLayerProps {
  source: SurfaceSource;
  /** Set when a subgraph was configured and did not answer; the direct log read took over. */
  subgraphError?: Error;
  /** How far the index has caught up, when the subgraph answered. */
  indexedBlock?: bigint;
  /** The block the rest of the screen was read at. */
  blockNumber?: bigint;
  lensVia?: 'deployed' | 'deployless';
  /** The cell the quote panel is showing, so the printed query is the one being answered. */
  point?: SurfacePoint;
  /** Live offers decoded on this page load. */
  legs: number;
  loading?: boolean;
}

export function ReadLayer({
  source,
  subgraphError,
  indexedBlock,
  blockNumber,
  lensVia,
  point,
  legs,
  loading,
}: ReadLayerProps) {
  const behind =
    source === 'subgraph' && blockNumber !== undefined && indexedBlock !== undefined
      ? blockNumber - indexedBlock
      : undefined;

  return (
    <Card
      title="Where these numbers come from"
      description="Nobody publishes a price list for these offers. Each one is a small program its maker put on chain, and the program states in the clear what it sells, at what price and until when. This page rebuilds the whole market by reading those programs out of the chain's own log, so no maker has to cooperate and no price feed is consulted."
      footer={
        <p className="text-mini leading-prose text-ink-3">
          <em className="not-italic text-ink-2">If you already trade options:</em> this is an
          implied-volatility surface reconstructed from event logs alone. The registry has no order
          book, so the cross-maker aggregation at a given strike and expiry — the best bid — is
          computed in the mapping and stored as an entity, not solved for in the browser.
        </p>
      }
    >
      <div className="flex flex-col divide-y divide-line">
        <Path
          name="The Graph"
          status={
            source === 'subgraph' ? (
              <Pill tone="accent" size="sm" dot>
                Answering
              </Pill>
            ) : SUBGRAPH_URL ? (
              <Pill tone="warning" size="sm" dot>
                Not answering
              </Pill>
            ) : (
              <Pill tone="neutral" size="sm" dot>
                Not running here
              </Pill>
            )
          }
          detail={
            loading ? undefined : source === 'subgraph' ? (
              behind !== undefined && behind > BigInt(0) ? (
                <>
                  Indexed to block{' '}
                  <span className="font-mono tnum text-ink-2">{formatUnits(indexedBlock!, 0)}</span>,{' '}
                  {formatUnits(behind, 0)} behind the chain.
                </>
              ) : (
                <>
                  Indexed to block{' '}
                  <span className="font-mono tnum text-ink-2">{formatUnits(indexedBlock ?? BigInt(0), 0)}</span>,
                  level with the chain.
                </>
              )
            ) : subgraphError ? (
              <>The index was configured and did not answer ({subgraphError.message}), so this page fell back to the log.</>
            ) : (
              <>
                Deploy it and this page prefers it. Nothing on screen changes; the same bytes are
                decoded by the same offsets, in a mapping instead of in your browser.
              </>
            )
          }
        >
          A subgraph indexes the registry&apos;s <span className="font-mono">Shipped</span>,{' '}
          <span className="font-mono">Docked</span>, <span className="font-mono">Pushed</span> and{' '}
          <span className="font-mono">Pulled</span>, plus this router&apos;s{' '}
          <span className="font-mono">Swapped</span>, and decodes each program inside the mapping
          into four entities: an offer, its maker, its fills, and the cell of the surface it sits in.
        </Path>

        <Path
          name="Straight from the log"
          status={
            source === 'logs' ? (
              <Pill tone="accent" size="sm" dot>
                Answering
              </Pill>
            ) : (
              <Pill tone="neutral" size="sm" dot>
                Standby
              </Pill>
            )
          }
          detail={
            loading ? undefined : (
              <>
                {legs === 0 ? 'No offers' : `${legs} offer${legs === 1 ? '' : 's'}`} decoded in the
                browser on this page load. Honest but not scalable: the registry&apos;s events carry
                no indexed parameters, so this path pulls every log since deployment each time.
              </>
            )
          }
        >
          The same events, read directly through viem and decoded with the same byte offsets, so the
          demo never waits on external infrastructure. The two paths are a cross-check on each other:
          if they disagreed about a price, one of the decoders would be wrong.
        </Path>

        <Path
          name="SurfaceLens"
          status={
            lensVia ? (
              <Pill tone="accent" size="sm" dot>
                {lensVia === 'deployless' ? 'Inline' : 'Deployed'}
              </Pill>
            ) : (
              <Pill tone="neutral" size="sm" dot>
                Not answering
              </Pill>
            )
          }
          detail={
            loading ? undefined : (
              <>
                One <span className="font-mono">eth_call</span>, pinned to the same block as
                everything else on this page, so a fill and the depth it consumed are never shown one
                block apart.
              </>
            )
          }
        >
          The columns the log cannot carry, because they move with the clock rather than with the
          bytes: what the curve is quoting right now, how much of the offer the maker&apos;s wallet
          can actually deliver, and the smallest trade that clears.
        </Path>
      </div>

      <details className="mt-4 rounded-card border border-line">
        <summary className="cursor-pointer list-none px-4 py-3 text-meta text-ink-2 transition-state hover:text-ink">
          The query behind the panel above
          <span className="ml-2 font-mono text-mini tnum text-ink-3">GraphQL</span>
        </summary>
        <div className="px-4 pb-4">
          <div className="flex items-start justify-between gap-3">
            <p className="max-w-prose text-mini leading-prose text-ink-3">
              This is the question the registry cannot answer about itself, and the reason the read
              layer exists. Paste it into the subgraph&apos;s playground; the numbers it returns are
              the ones above.
            </p>
            <CopyButton value={bestBidQuery(point)} what="the query" />
          </div>
          <pre className="mt-3 overflow-x-auto rounded-control bg-surface-2 p-3 font-mono text-mini leading-prose text-ink-2">
            {bestBidQuery(point)}
          </pre>
        </div>
      </details>
    </Card>
  );
}

/**
 * The best-bid query, with the cell on screen substituted in.
 *
 * Written out rather than assembled from a template so that what is displayed is exactly what a
 * playground would accept, including the literal a `BigInt` field has to be given as a string.
 */
export function bestBidQuery(point?: SurfacePoint): string {
  const where = point
    ? `    where: {
      tokenRisky: "${point.tokenRisky.toLowerCase()}"
      tokenStable: "${point.tokenStable.toLowerCase()}"
      strikeWad: "${point.strikeWad.toString()}"
      maturity: "${point.maturity}"
      liveLegCount_gt: 0
    }`
    : `    where: { liveLegCount_gt: 0 }`;

  return `{
  surfacePoints(
${where}
  ) {
    strikeWad
    maturity
    liveLegCount        # how many makers are quoting this option
    maxSigmaWad         # the widest live vol: the best bid
    liveLiquidityWad    # size written here across all makers
    bestLeg {
      id
      maker { id }
      sigmaWad
      liquidityWad
      reserveRisky
      guarded           # is that size actually backed by the wallet?
    }
  }
}`;
}

function Path({
  name,
  status,
  detail,
  children,
}: {
  name: string;
  status: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-meta font-medium text-ink">{name}</h3>
        {status}
      </div>
      <p className="max-w-prose text-mini leading-prose text-ink-3">{children}</p>
      {detail === undefined ? (
        <Skeleton className="h-4 w-64" />
      ) : (
        <p className="max-w-prose text-mini leading-prose text-ink-2">{detail}</p>
      )}
    </div>
  );
}
