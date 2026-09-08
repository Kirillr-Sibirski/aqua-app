'use client';

/**
 * The market: every offer any wallet has published, priced.
 *
 * There is no on-chain implied-volatility surface in DeFi, and the reason is that an option's terms
 * normally live in a vault's storage or an off-chain book. Here they live in an event. `Aqua.ship`
 * takes the strategy "fully instead of being pre-hashed, for data availability", so the `Shipped`
 * log carries the whole program, and a Strikeline offer encodes its price, its movement, its date
 * and its size in the clear inside it. Every offer any maker has written on this router is
 * therefore publicly decodable, by anyone, with no cooperation from the maker.
 *
 * This screen needs no wallet. It reads a public log. Connecting one only marks which of the offers
 * are yours.
 *
 * Three reads, and the panel a third of the way down says which of them answered: the subgraph in
 * `subgraph/`, the same logs pulled directly through viem when it is not running, and `SurfaceLens`
 * for the numbers the curve has to be asked for. No oracle is consulted anywhere on this page.
 *
 * Order is deliberate. The census orients, then the answer — who is offering the best terms at one
 * price and date — then how that answer was assembled, then the whole picture, then every row. A
 * reader who stops after the second block has the thing this screen exists to say.
 */
import { useMemo, useState } from 'react';
import { Alert, Button } from '@mantine/core';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { AppChrome, PageHeader, useIsHydrated } from '@/components/shell';
import {
  BestQuote,
  ReadLayer,
  SourceStrip,
  SurfaceChart,
  SurfaceTable,
  pickQuotePoint,
  useSurface,
} from '@/components/surface';
import { useDeployments } from '@/hooks';
import { tokenInfo } from '@/lib/contracts';

export default function SurfacePage() {
  const hydrated = useIsHydrated();
  const { deployments } = useDeployments();
  const surface = useSurface({ enabled: hydrated });
  const [selected, setSelected] = useState<string | undefined>(undefined);

  // The pair comes from the offers themselves, not from the manifest: a maker may have written
  // against any pair, and the axis has to be labelled with the one that is actually on screen.
  const { riskySymbol, stableSymbol } = useMemo(() => {
    const first = surface.legs[0];
    return {
      riskySymbol: first ? tokenInfo(first.tokenRisky, deployments).symbol : 'WETH',
      stableSymbol: first ? tokenInfo(first.tokenStable, deployments).symbol : 'USDC',
    };
  }, [surface.legs, deployments]);

  // The cell the quote panel is showing. Lifted so the provenance panel underneath can print the
  // query that answers it, with this price and this date substituted in.
  const point = useMemo(() => pickQuotePoint(surface.points, selected), [surface.points, selected]);

  const loading = !hydrated || surface.isLoading;

  return (
    <AppChrome>
      {/* No badge row under the title. There were three — NO WALLET NEEDED, READ LAYER · THE GRAPH,
          YOUR OFFERS ARE MARKED — and each was a sentence wearing a pill. The first two are said
          plainly below; the third is only true when a wallet is attached and is self-evident from
          the rows that are marked. */}
      <PageHeader
        title="Every offer, from every wallet"
        subtitle="Nobody publishes a price list for these offers: each one is a small program sitting on chain on its own, related to nothing. This page assembles the list out of the chain's own log, so you can see who is paying most for the wait before you sell anything. No wallet needed to read it."
      />

      <div className="mt-8 flex flex-col gap-8">
        {surface.error ? (
          <Alert
            variant="light"
            color="ember"
            radius="lg"
            icon={<AlertTriangle size={18} strokeWidth={1.75} />}
            title="Could not read the market"
          >
            <p className="leading-prose">{surface.error.message}</p>
            <Button
              mt="sm"
              size="xs"
              variant="default"
              leftSection={<RefreshCw size={14} strokeWidth={1.75} />}
              onClick={() => surface.refetch()}
            >
              Try again
            </Button>
          </Alert>
        ) : (
          <>
            <SourceStrip
              census={surface.census}
              source={surface.source}
              lensVia={surface.lensVia}
              blockNumber={surface.blockNumber}
              indexedBlock={surface.indexedBlock}
              loading={loading}
              riskySymbol={riskySymbol}
            />

            {surface.subgraphError ? (
              <Alert
                variant="light"
                color="petrol"
                radius="lg"
                icon={<Info size={18} strokeWidth={1.75} />}
                title="The subgraph did not answer, so this is read straight from the chain"
              >
                <p className="leading-prose">
                  {surface.subgraphError.message}. Aqua&apos;s events carry no indexed parameters, so
                  the direct path pulls every <span className="font-mono">Shipped</span> since the
                  router&apos;s deployment block and decodes it in the browser. Same bytes, same
                  offsets, same numbers; it just does not scale past a few thousand offers.
                </p>
              </Alert>
            ) : null}

            {surface.lensError && !surface.priced ? (
              <Alert
                variant="light"
                color="amber"
                radius="lg"
                icon={<AlertTriangle size={18} strokeWidth={1.75} />}
                title="SurfaceLens did not answer, so the priced columns are blank"
              >
                <p className="leading-prose">
                  {surface.lensError.message}. The price, the movement priced in, the date and the
                  size are decoded from the log and are unaffected; what the offer is worth, how much
                  can be sold and the smallest trade come from the curve and are simply absent rather
                  than estimated.
                </p>
              </Alert>
            ) : null}

            {surface.census.foreign > 0 ? (
              <Alert
                variant="light"
                color="petrol"
                radius="lg"
                icon={<Info size={18} strokeWidth={1.75} />}
                title={`${surface.census.foreign} strategies on this router are not offers`}
              >
                <p className="leading-prose">
                  They decode fine and carry no <span className="font-mono">RmmSwap</span>{' '}
                  instruction, so they have no price to plot. Leaving them out is the point: the
                  decoder never guesses a price.
                </p>
              </Alert>
            ) : null}

            <BestQuote
              points={surface.points}
              deployments={deployments}
              nowSeconds={surface.nowSeconds}
              selected={selected}
              onSelect={setSelected}
              priced={surface.priced}
            />

            <ReadLayer
              source={surface.source}
              subgraphError={surface.subgraphError}
              indexedBlock={surface.indexedBlock}
              blockNumber={surface.blockNumber}
              lensVia={surface.lensVia}
              point={point}
              legs={surface.census.liveLegs}
              loading={loading}
            />

            <SurfaceChart
              points={surface.points}
              legs={surface.legs}
              nowSeconds={surface.nowSeconds}
              stableSymbol={stableSymbol}
              state={loading ? 'loading' : 'ready'}
            />

            <SurfaceTable
              legs={surface.legs}
              deployments={deployments}
              nowSeconds={surface.nowSeconds}
              loading={loading}
              onSelect={setSelected}
            />
          </>
        )}
      </div>
    </AppChrome>
  );
}
