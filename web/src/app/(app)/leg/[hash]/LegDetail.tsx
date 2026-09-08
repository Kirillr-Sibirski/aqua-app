'use client';

/**
 * One offer, in full.
 *
 * The whole screen is a chain read. The offer's economics come out of the 62 argument bytes of its
 * `RmmSwap` instruction, decoded exactly as `RmmSwap.parse` decodes them at fill time — there is no
 * registry, no subgraph and no JSON beside the app that remembers what strike this position was
 * written at, because `Aqua.ship` publishes the strategy whole and that is the only record.
 *
 * The curve is sampled from `stableFor`, the settlement line from `stableFor` at a maturity that has
 * already passed, the decay band from `bandFor`, the deliverable depth from `coverage`, and the
 * reserve point's history from a replay of Aqua's `Pushed`/`Pulled` stream. Nothing on this page is
 * modelled.
 */
import { Link2Off, Layers } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatUnits as viemFormatUnits } from 'viem';
import { useBlock, useConnection } from 'wagmi';
import {
  Address as AddressText,
  Card,
  CardRow,
  Delta,
  EmptyState,
  ErrorState,
  Pill,
  Skeleton,
  StatRow,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableMessageRow,
  TableRow,
  TokenAmount,
} from '@/components/ui';
import { PageHeader, useIsHydrated } from '@/components/shell';
import {
  CurveChart,
  ProgramInspector,
  TimeScrubber,
  decodeRmmSwapArgs,
  findRmmArgs,
  formatDuration,
  FLAG_POST_EXPIRY_ONE_WAY,
  FLAG_POST_EXPIRY_OUT_IS_RISKY,
  FLAG_RISKY_IS_TOKEN_A,
  TAU_FLOOR_SECONDS,
  useCoverage,
  useDebounced,
  useLegFills,
  useTauNow,
  useThetaBand,
  type FillMarker,
} from '@/components/curve';
import { formatExpiry } from '@/components/write';
import { MATURED_MATURITY, useCurveSamples } from '@/hooks/useCurveSamples';
import { useDeployments, useShippedStrategies } from '@/hooks';
import { ceilFromWad } from '@/hooks/strikeline';
import { aquaFork } from '@/lib/chain';
import { tokenInfo, type ShippedStrategy } from '@/lib/contracts';
import { formatChartNumber } from '@/components/charts/format';
import { formatPercent, truncateHash } from '@/lib/ui';
import { RollPanel } from './RollPanel';

export interface LegDetailProps {
  hash: string;
}

export function LegDetail({ hash }: LegDetailProps) {
  const hydrated = useIsHydrated();
  const { deployments } = useDeployments();
  const strategies = useShippedStrategies(undefined, { all: true });

  const strategy = useMemo(
    () => strategies.strategies.find((s) => s.strategyHash.toLowerCase() === hash.toLowerCase()),
    [strategies.strategies, hash],
  );

  if (!hydrated || strategies.isLoading) return <LegSkeleton hash={hash} />;

  if (strategies.error) {
    return (
      <>
        <PageHeader title={`Offer ${truncateHash(hash)}`} />
        <ErrorState
          className="mt-8"
          error={strategies.error}
          title="Could not read the chain's log of offers"
          onRetry={() => void strategies.refetch()}
        />
      </>
    );
  }

  if (!strategy || !deployments) {
    return (
      <>
        <PageHeader title={`Offer ${truncateHash(hash)}`} />
        <EmptyState
          className="mt-8"
          icon={Link2Off}
          title="No offer with this hash"
          description="An offer is identified by the hash of its own bytes, so it exists only if it was published to this router after the deployment block. Nothing was published under that hash."
          action={
            <Link
              href="/write"
              className="inline-flex h-10 items-center rounded-control border border-line bg-surface-2 px-4 text-body font-medium text-ink transition-state hover:border-line-strong"
            >
              Name your price
            </Link>
          }
        />
      </>
    );
  }

  return <Leg strategy={strategy} deployments={deployments} onRefresh={() => void strategies.refetch()} />;
}

// ---------------------------------------------------------------------------

type Deployments = NonNullable<ReturnType<typeof useDeployments>['deployments']>;

function Leg({
  strategy,
  deployments,
  onRefresh,
}: {
  strategy: ShippedStrategy;
  deployments: Deployments;
  onRefresh: () => void;
}) {
  const { address } = useConnection();
  const [scrub, setScrub] = useState(0);
  const settled = useDebounced(scrub, 140);

  const args = findRmmArgs(strategy.program);
  const rmm = useMemo(() => (args ? decodeRmmSwapArgs(args) : undefined), [args]);

  const block = useBlock({ chainId: aquaFork.id, watch: true, query: { staleTime: 4_000 } });
  const chainNow = block.data ? Number(block.data.timestamp) : undefined;

  // Which token is which is a flag in the program, not a guess from the symbol.
  const riskyIsTokenA = rmm ? (rmm.flags & FLAG_RISKY_IS_TOKEN_A) !== 0 : true;
  const riskyToken = riskyIsTokenA ? strategy.tokens[0] : strategy.tokens[1];
  const stableToken = riskyIsTokenA ? strategy.tokens[1] : strategy.tokens[0];
  const risky = tokenInfo(riskyToken, deployments);
  const stable = tokenInfo(stableToken, deployments);

  const rawByToken = useMemo(() => {
    const out: Record<string, bigint> = {};
    for (const b of strategy.balances) out[b.token.toLowerCase()] = b.balance;
    return out;
  }, [strategy.balances]);

  const riskyRaw = rawByToken[riskyToken.toLowerCase()] ?? BigInt(0);
  const stableRaw = rawByToken[stableToken.toLowerCase()] ?? BigInt(0);
  const xWad = rmm ? riskyRaw * rmm.rateRisky : BigInt(0);
  const yWad = rmm ? stableRaw * rmm.rateStable : BigInt(0);

  // `tauNow` is displayed as the router's own answer; the scrubber's arithmetic uses the block
  // timestamp directly, because tau is floored at an hour and would freeze the last hour of a leg.
  const tau = useTauNow(deployments.router, rmm?.maturity);
  const remainingNow =
    chainNow === undefined || rmm === undefined ? undefined : Math.max(rmm.maturity - chainNow, 0);

  // Scrubbing changes which leg we ask the router about, not how we interpret its answer: a leg
  // maturing sooner is a real sample, and one that has already matured returns the closed form.
  //
  // Three cases, and the two ends are exact on purpose. At rest the chart must be this leg's own
  // curve, so the maturity is the one in its bytes, untouched. At the far end it is the settlement
  // sentinel. In between the value is snapped to a minute, because the raw expression drifts with
  // the block clock at `settled` seconds per second and every distinct value is another 48-call
  // multicall for a curve that has not visibly changed.
  const effectiveMaturity =
    chainNow === undefined || rmm === undefined
      ? undefined
      : settled <= 0
        ? rmm.maturity
        : settled >= 1
          ? MATURED_MATURITY
          : snapToMinute(rmm.maturity - (remainingNow ?? 0) * settled);

  const live = useCurveSamples({
    router: deployments.router,
    strikeWad: rmm?.strikeWad,
    sigmaWad: rmm?.sigmaWad,
    maturity: effectiveMaturity,
    liquidityWad: rmm?.liquidityWad,
  });

  const settlement = useCurveSamples({
    router: deployments.router,
    strikeWad: rmm?.strikeWad,
    sigmaWad: rmm?.sigmaWad,
    // Already matured, so `tauOf` returns zero and the curve takes its constant-sum branch. That
    // branch has no tau in it, which makes this the one curve on the screen that cannot change:
    // asked for once, never re-read.
    maturity: MATURED_MATURITY,
    liquidityWad: rmm?.liquidityWad,
    refreshMs: false,
  });

  const bandParams =
    rmm && xWad > BigInt(0)
      ? {
          strikeWad: rmm.strikeWad,
          sigmaWad: rmm.sigmaWad,
          maturity: rmm.maturity,
          liquidityWad: rmm.liquidityWad,
          xWad,
          yWad,
        }
      : undefined;

  /** What a taker has to cross right now. The tradeable number, and the one the rail quotes. */
  const band = useThetaBand(deployments.router, bandParams);

  /**
   * The same band at the scrubber's position, so the wedge on the chart is bounded by the curve
   * that is actually drawn under it. Without this the outline's interior would come from the
   * scrubbed samples while its two corners came from the live band, which is not a shape that
   * exists. It also makes the point of the scrubber visible: drag three days forward and the
   * minimum fillable trade grows, with nothing having happened on chain.
   */
  const scrubbedBand = useThetaBand(
    deployments.router,
    bandParams && effectiveMaturity !== undefined && settled > 0
      ? { ...bandParams, maturity: effectiveMaturity }
      : undefined,
  );

  const chartBand = settled > 0 ? scrubbedBand.band : band.band;

  const coverage = useCoverage(deployments.router, strategy.maker, [riskyToken, stableToken]);
  const ledger = useLegFills({
    aqua: deployments.aqua,
    app: deployments.router,
    maker: strategy.maker,
    strategyHash: strategy.strategyHash,
    fromBlock: BigInt(deployments.blockNumber),
  });

  if (!rmm) {
    return (
      <>
        <PageHeader title={`Offer ${truncateHash(strategy.strategyHash)}`} />
        <EmptyState
          className="mt-8"
          icon={Layers}
          title="Not a Strikeline offer"
          description="This strategy was shipped to the Strikeline router but its program carries no RmmSwap instruction, so it has no price, no date and no volatility to show. It is some other SwapVM program using the same app."
        />
        <ProgramInspector className="mt-6" program={strategy.program} strategyHash={strategy.strategyHash} />
      </>
    );
  }

  // Which side of the wheel this is comes out of the program, not out of a price feed. The maker
  // declared it when they set the one-way settlement flags, and that declaration is what the
  // instruction will enforce at expiry — so it is also the honest thing to put in the title.
  const kind: 'call' | 'put' | undefined =
    rmm.flags & FLAG_POST_EXPIRY_ONE_WAY
      ? rmm.flags & FLAG_POST_EXPIRY_OUT_IS_RISKY
        ? 'call'
        : 'put'
      : undefined;
  const strike = Number(viemFormatUnits(rmm.strikeWad, 18));
  const sigma = Number(viemFormatUnits(rmm.sigmaWad, 18));
  const liquidity = Number(viemFormatUnits(rmm.liquidityWad, 18));
  const expired = chainNow !== undefined && chainNow >= rmm.maturity;

  const fills: FillMarker[] = ledger.fills.map((fill, i) => {
    const fx = (fill.reservesAfter[riskyToken.toLowerCase()] ?? BigInt(0)) * rmm.rateRisky;
    const fy = (fill.reservesAfter[stableToken.toLowerCase()] ?? BigInt(0)) * rmm.rateStable;
    return {
      id: `${fill.transactionHash}-${fill.logIndex}`,
      x: Number(viemFormatUnits(fx, 18)),
      y: Number(viemFormatUnits(fy, 18)),
      label: `Trade ${i + 1}`,
    };
  });

  // Derived from the maturity the router was actually asked about, not from the scrubber's
  // fraction: the two differ by up to the snapping quantum, and the chart's caption and the theta
  // card's projection both label numbers that came back from that call.
  const scrubbedSeconds =
    effectiveMaturity === undefined || chainNow === undefined
      ? undefined
      : Math.max(effectiveMaturity - chainNow, 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              {kind === 'call' ? 'Sell' : kind === 'put' ? 'Buy' : 'Trade'} {risky.symbol} at
            </span>
            <span className="font-mono tnum text-ink-2">
              {formatChartNumber(strike, { significantDigits: 12, maxFractionDigits: 2 })}{' '}
              {stable.symbol}
            </span>
          </span>
        }
        subtitle={
          <>
            <span className="block">
              {kind === 'call'
                ? `An offer to sell ${risky.symbol} at this price. Whoever takes it pays the maker for the wait, and nobody is paid up front: the payment only becomes real when somebody trades.`
                : kind === 'put'
                  ? `An offer to buy ${risky.symbol} at this price, paid for with ${stable.symbol}. Whoever takes it pays the maker for the wait, and nobody is paid up front: the payment only becomes real when somebody trades.`
                  : `An offer with no one-way gate at its date, so it keeps trading in both directions afterwards. Nobody is paid up front: the payment only becomes real when somebody trades.`}
            </span>
            <span className="mt-2 block text-ink-3">
              The tokens never left the maker&rsquo;s wallet. The reserves below are balances Aqua
              records, not tokens it holds.
            </span>
            <span className="mt-2 block text-ink-3">
              <em className="not-italic text-ink-2">If you already trade options:</em>{' '}
              {kind === 'put'
                ? 'a cash-secured put written as an RMM-01 price curve, from the same 62 bytes as a call; which one it is was decided only by the side of the strike its reserves started on.'
                : 'a covered call written as an RMM-01 price curve, with the premium arriving as a two-sided spread that widens with theta rather than as an up-front credit.'}
            </span>
          </>
        }
        meta={
          <>
            {strategy.docked ? (
              <Pill tone="neutral" dot title="Docked in Aqua">
                Withdrawn
              </Pill>
            ) : expired ? (
              <Pill tone="warning" dot title="Past maturity: in assignment">
                Past its date
              </Pill>
            ) : (
              <Pill tone="positive" dot>
                Live
              </Pill>
            )}
            <Pill tone="accent" title="Implied volatility">
              {formatPercent(sigma, { fractionDigits: 0 })} movement priced in
            </Pill>
            <AddressText
              value={strategy.strategyHash}
              kind="hash"
              what="strategy hash"
              size="meta"
            />
          </>
        }
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-4">
            <CurveChart
              live={live.samples}
              settlement={settlement.samples}
              reserve={
                xWad > BigInt(0) || yWad > BigInt(0)
                  ? { x: Number(viemFormatUnits(xWad, 18)), y: Number(viemFormatUnits(yWad, 18)) }
                  : undefined
              }
              band={
                chartBand
                  ? {
                      xOnCurve: Number(viemFormatUnits(chartBand.xOnCurveWad, 18)),
                      yOnCurve: Number(viemFormatUnits(chartBand.yOnCurveWad, 18)),
                    }
                  : undefined
              }
              fills={fills}
              riskySymbol={risky.symbol}
              stableSymbol={stable.symbol}
              scrubbed={settled > 0}
              subtitle={
                scrubbedSeconds === undefined
                  ? 'Sampling…'
                  : `${formatDuration(scrubbedSeconds)} left · ${formatPercent(sigma, { fractionDigits: 0 })} movement priced in · ${formatChartNumber(liquidity)} ${risky.symbol} on offer`
              }
              state={live.error ? 'error' : live.isLoading ? 'loading' : 'ready'}
              errorMessage={
                live.error
                  ? 'The chain did not return the curve for this offer. Check that the deployment points at a StrikelineRouter.'
                  : undefined
              }
            />

            <Card>
              <TimeScrubber
                value={scrub}
                onValueChange={setScrub}
                remainingSeconds={remainingNow ?? 0}
                floorSeconds={TAU_FLOOR_SECONDS}
                disabled={expired || remainingNow === undefined}
                disabledReason={
                  expired
                    ? 'This offer is past its date; the curve is already the settlement line.'
                    : 'Waiting for the chain to report the time left.'
                }
              />
            </Card>
          </div>

          <Card
            title="Who has taken this offer"
            description="Replayed from the chain's own ledger. Every trade moves the offer along its curve without the maker signing anything, which is why the reserves below change on their own."
            flush
          >
            <Table caption="Trades against this offer" hideCaption minWidth="42rem">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Transaction</TableHeaderCell>
                  <TableHeaderCell numeric title="Aqua pull: what left the strategy">
                    Paid out
                  </TableHeaderCell>
                  <TableHeaderCell numeric title="Aqua push: what came back in">
                    Taken in
                  </TableHeaderCell>
                  <TableHeaderCell numeric>Block</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ledger.isLoading ? (
                  <TableMessageRow colSpan={4}>Reading the ledger…</TableMessageRow>
                ) : ledger.fills.length === 0 ? (
                  <TableMessageRow colSpan={4}>
                    Nobody has taken this offer yet, so nothing has been paid. A trade has to be at
                    least the minimum size shown on the right before it can.
                  </TableMessageRow>
                ) : (
                  ledger.fills.map((fill) => {
                    const out = tokenInfo(fill.outToken, deployments);
                    const inTok = fill.inToken ? tokenInfo(fill.inToken, deployments) : undefined;
                    return (
                      <TableRow key={`${fill.transactionHash}-${fill.logIndex}`}>
                        <TableCell>
                          <AddressText
                            value={fill.transactionHash}
                            kind="hash"
                            what="transaction hash"
                            size="meta"
                          />
                        </TableCell>
                        <TableCell numeric>
                          <TokenAmount
                            value={fill.outAmount}
                            decimals={out.decimals}
                            symbol={out.symbol}
                            size="sm"
                          />
                        </TableCell>
                        <TableCell numeric>
                          {inTok ? (
                            <TokenAmount
                              value={fill.inAmount}
                              decimals={inTok.decimals}
                              symbol={inTok.symbol}
                              size="sm"
                            />
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </TableCell>
                        <TableCell numeric>
                          <span className="font-mono text-meta tnum">{fill.blockNumber.toString()}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>

          <ProgramInspector program={strategy.program} strategyHash={strategy.strategyHash} />
        </div>

        <div className="flex flex-col gap-6 lg:sticky lg:top-20">
          <Card
            title="The offer"
            description="Read out of the offer's own published bytes, which are the only record of it anywhere."
          >
            <dl className="flex flex-col">
              <CardRow label={<span title="Strike, K">Price it sells at</span>}>
                <span className="font-mono tnum">
                  {formatChartNumber(strike, { significantDigits: 12, maxFractionDigits: 2 })}{' '}
                  {stable.symbol}
                </span>
              </CardRow>
              <CardRow label={<span title="Implied volatility, sigma">Movement priced in</span>}>
                <span className="font-mono tnum">{formatPercent(sigma, { fractionDigits: 1 })}</span>
              </CardRow>
              <CardRow label={<span title="Liquidity, L">How much it covers</span>}>
                <span className="font-mono tnum">
                  {formatChartNumber(liquidity)} {risky.symbol}
                </span>
              </CardRow>
              <CardRow label={<span title="Expiry, the maturity in the program">Runs to</span>}>
                <span className="font-mono tnum">{formatExpiry(rmm.maturity)}</span>
              </CardRow>
              <CardRow label="Time left">
                <span className="font-mono tnum">
                  {remainingNow === undefined ? '—' : formatDuration(remainingNow)}
                </span>
              </CardRow>
              <CardRow label={<span title="tau, the time the curve itself is reading">tau (from the chain)</span>}>
                <span className="font-mono tnum">
                  {tau.tauWad === undefined
                    ? '—'
                    : `${(Number(tau.tauWad) / 1e18).toFixed(6)} y`}
                </span>
              </CardRow>
              <CardRow label="Written by">
                <AddressText value={strategy.maker} size="meta" />
              </CardRow>
            </dl>
          </Card>

          <Card
            title="Minimum trade size right now"
            description="Time passing has opened a gap between where the last trade left this offer and where its price is now. Nobody created it with a transaction. Whoever crosses it pays it to the maker, which is how the maker gets paid at all. Traders call it the theta band."
          >
            {band.band ? (
              <StatRow className="md:grid-cols-2">
                <StatTile
                  label={`Smallest ${stable.symbol} trade it will take`}
                  value={
                    <TokenAmount
                      value={ceilFromWad(band.band.minStableIn, rmm.rateStable)}
                      decimals={stable.decimals}
                      size="lg"
                    />
                  }
                  unit={stable.symbol}
                  // Ceiled, not floored: `bandFor` publishes the smallest normalised input `exec`
                  // will clear, and a minimum that rounds down is one raw unit short of clearing.
                  detail="Smaller than this and the trade is refused"
                />
                <StatTile
                  label={`Smallest ${risky.symbol} trade it will take`}
                  value={
                    <TokenAmount
                      value={ceilFromWad(band.band.minRiskyIn, rmm.rateRisky)}
                      decimals={risky.decimals}
                      size="lg"
                    />
                  }
                  unit={risky.symbol}
                  detail="The other side of the same gap"
                />
              </StatRow>
            ) : band.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <p className="text-meta text-ink-3">
                The chain did not return a minimum for these reserves.
              </p>
            )}

            {band.band && scrubbedBand.band && settled > 0 && scrubbedSeconds !== undefined ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-mini leading-prose text-ink-3">
                  With <span className="font-mono tnum">{formatDuration(scrubbedSeconds)}</span>{' '}
                  left and nobody having traded in between, the same offer would refuse anything
                  under:
                </p>
                <dl className="mt-2 flex flex-col">
                  <CardRow label={stable.symbol}>
                    <span className="flex items-center gap-2">
                      <TokenAmount
                        value={ceilFromWad(scrubbedBand.band.minStableIn, rmm.rateStable)}
                        decimals={stable.decimals}
                        size="sm"
                      />
                      <Delta
                        value={
                          ceilFromWad(scrubbedBand.band.minStableIn, rmm.rateStable) -
                          ceilFromWad(band.band.minStableIn, rmm.rateStable)
                        }
                        decimals={stable.decimals}
                        size="sm"
                      />
                    </span>
                  </CardRow>
                  <CardRow label={risky.symbol}>
                    <span className="flex items-center gap-2">
                      <TokenAmount
                        value={ceilFromWad(scrubbedBand.band.minRiskyIn, rmm.rateRisky)}
                        decimals={risky.decimals}
                        size="sm"
                      />
                      <Delta
                        value={
                          ceilFromWad(scrubbedBand.band.minRiskyIn, rmm.rateRisky) -
                          ceilFromWad(band.band.minRiskyIn, rmm.rateRisky)
                        }
                        decimals={risky.decimals}
                        size="sm"
                      />
                    </span>
                  </CardRow>
                </dl>
              </div>
            ) : null}
          </Card>

          <Card
            title="How much you can sell right now"
            description="What the guard would actually allow this instant, read from the same wallet balance every other offer from this maker is quoting against. Traders call it the deliverable depth."
          >
            <StatRow className="md:grid-cols-2">
              <StatTile
                label={`${risky.symbol} it can sell`}
                value={
                  coverage.free[riskyToken.toLowerCase()] === undefined ? undefined : (
                    <TokenAmount
                      value={coverage.free[riskyToken.toLowerCase()]}
                      decimals={risky.decimals}
                      size="lg"
                    />
                  )
                }
                unit={risky.symbol}
                empty="not read"
                detail={
                  <>
                    On offer{' '}
                    <TokenAmount value={riskyRaw} decimals={risky.decimals} size="sm" />
                  </>
                }
              />
              <StatTile
                label={`${stable.symbol} it can sell`}
                value={
                  coverage.free[stableToken.toLowerCase()] === undefined ? undefined : (
                    <TokenAmount
                      value={coverage.free[stableToken.toLowerCase()]}
                      decimals={stable.decimals}
                      size="lg"
                    />
                  )
                }
                unit={stable.symbol}
                empty="not read"
                detail={
                  <>
                    On offer{' '}
                    <TokenAmount value={stableRaw} decimals={stable.decimals} size="sm" />
                  </>
                }
              />
            </StatRow>
          </Card>

          {strategy.docked ? null : (
            <RollPanel
              aqua={deployments.aqua}
              router={deployments.router}
              maker={strategy.maker}
              strategyHash={strategy.strategyHash}
              tokens={strategy.tokens}
              rmm={rmm}
              reserves={[
                rawByToken[strategy.tokens[0].toLowerCase()] ?? BigInt(0),
                rawByToken[strategy.tokens[1].toLowerCase()] ?? BigInt(0),
              ]}
              riskyIsTokenA={riskyIsTokenA}
              riskySymbol={risky.symbol}
              riskyDecimals={risky.decimals}
              stableSymbol={stable.symbol}
              stableDecimals={stable.decimals}
              chainNow={chainNow}
              chainId={deployments.chainId}
              canAct={Boolean(address)}
              onDone={onRefresh}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** Floor to the minute, so a value that drifts with the block clock stops re-keying its query. */
function snapToMinute(seconds: number): number {
  return Math.floor(seconds / 60) * 60;
}

function LegSkeleton({ hash }: { hash: string }) {
  return (
    <>
      <PageHeader title={`Offer ${truncateHash(hash)}`} />
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:items-start">
        <div className="flex flex-col gap-8">
          <Skeleton className="h-80 w-full" radius="card" label="the trading curve" />
          <Skeleton className="h-56 w-full" radius="card" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56 w-full" radius="card" />
          <Skeleton className="h-40 w-full" radius="card" />
        </div>
      </div>
    </>
  );
}
