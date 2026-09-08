'use client';

/**
 * The surface: every option written on this router, priced.
 *
 * There is no on-chain implied-volatility surface in DeFi, and the reason is that an option's terms
 * normally live in a vault's storage or an off-chain book. Here they live in an event. `Aqua.ship`
 * takes the strategy "fully instead of being pre-hashed, for data availability", so the `Shipped`
 * log carries the whole program, and a Strikeline leg encodes its strike, its implied vol, its
 * maturity and its liquidity in the clear inside it. Every option any maker has written on this
 * router is therefore publicly decodable, by anyone, with no cooperation from the maker.
 *
 * This screen needs no wallet. It reads a public log. Connecting one only marks which of the quotes
 * are yours.
 *
 * Three reads, and the strip at the top says which of them answered: the subgraph in `subgraph/`,
 * the same logs pulled directly through viem when it is not running, and `SurfaceLens` for the
 * numbers the curve has to be asked for. No oracle is consulted anywhere on this page.
 */
import { useMemo, useState } from 'react';
import { useConnection } from 'wagmi';
import { AppShell, PageHeader, useIsHydrated } from '@/components/shell';
import { BestQuote, SourceStrip, SurfaceChart, SurfaceTable, useSurface } from '@/components/surface';
import { Callout, ErrorState, Pill } from '@/components/ui';
import { useDeployments } from '@/hooks';
import { tokenInfo } from '@/lib/contracts';

export default function SurfacePage() {
  const hydrated = useIsHydrated();
  const { address } = useConnection();
  const { deployments } = useDeployments();
  const surface = useSurface({ enabled: hydrated });
  const [selected, setSelected] = useState<string | undefined>(undefined);

  // The pair comes from the legs themselves, not from the manifest: a maker may have written
  // against any pair, and the axis has to be labelled with the one that is actually on screen.
  const { riskySymbol, stableSymbol } = useMemo(() => {
    const first = surface.legs[0];
    return {
      riskySymbol: first ? tokenInfo(first.tokenRisky, deployments).symbol : 'WETH',
      stableSymbol: first ? tokenInfo(first.tokenStable, deployments).symbol : 'USDC',
    };
  }, [surface.legs, deployments]);

  const loading = !hydrated || surface.isLoading;

  return (
    <AppShell>
      <PageHeader
        title="Surface"
        subtitle="Every option written on this router, decoded from Aqua's own event log. No oracle, no order book, no permission needed."
        meta={
          hydrated && !address ? (
            <Pill tone="neutral" size="sm">
              Public read, no wallet needed
            </Pill>
          ) : null
        }
      />

      <div className="mt-8 flex flex-col gap-8">
        {surface.error ? (
          <ErrorState
            error={surface.error}
            title="Could not read the log"
            onRetry={surface.refetch}
          />
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
              <Callout tone="info" title="The subgraph did not answer, so this is read straight from the logs">
                {surface.subgraphError.message}. Aqua&apos;s events carry no indexed parameters, so
                the direct path pulls every <span className="font-mono">Shipped</span> since the
                router&apos;s deployment block and decodes it in the browser. Same bytes, same
                offsets, same numbers — it just does not scale past a few thousand legs.
              </Callout>
            ) : null}

            {surface.lensError && !surface.priced ? (
              <Callout tone="warning" title="SurfaceLens did not answer, so the priced columns are blank">
                {surface.lensError.message}. Strike, implied vol, expiry, notional and the Aqua
                reserves are decoded from the log and are unaffected; the mark, the premium and the
                theta band come from the curve and are simply absent rather than estimated.
              </Callout>
            ) : null}

            {surface.census.foreign > 0 ? (
              <Callout tone="info" title={`${surface.census.foreign} strategies on this router are not options`}>
                They decode fine and carry no <span className="font-mono">RmmSwap</span>{' '}
                instruction, so they are not on the surface. Declining to plot them is the point:
                the decoder never guesses a strike.
              </Callout>
            ) : null}

            <SurfaceChart
              points={surface.points}
              legs={surface.legs}
              nowSeconds={surface.nowSeconds}
              stableSymbol={stableSymbol}
              state={loading ? 'loading' : 'ready'}
            />

            <BestQuote
              points={surface.points}
              deployments={deployments}
              nowSeconds={surface.nowSeconds}
              selected={selected}
              onSelect={setSelected}
              priced={surface.priced}
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
    </AppShell>
  );
}
