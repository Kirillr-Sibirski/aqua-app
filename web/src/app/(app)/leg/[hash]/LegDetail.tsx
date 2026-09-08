'use client';

/**
 * One leg, in full.
 *
 * The whole screen is a chain read. The leg's economics come out of the 62 argument bytes of its
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
        <PageHeader title={`Leg ${truncateHash(hash)}`} />
        <ErrorState
          className="mt-8"
          error={strategies.error}
          title="Could not read the Shipped log"
          onRetry={() => void strategies.refetch()}
        />
      </>
    );
  }

  if (!strategy || !deployments) {
    return (
      <>
        <PageHeader title={`Leg ${truncateHash(hash)}`} />
        <EmptyState
          className="mt-8"
          icon={Link2Off}
          title="No leg with this hash"
          description="Aqua keys every balance by keccak256 of the strategy bytes, so a leg exists only if it was shipped to this router from the block the deployment was made at. Nothing here was shipped under that hash."
          action={
            <Link
              href="/write"
              className="inline-flex h-10 items-center rounded-control border border-line bg-surface-2 px-4 text-body font-medium text-ink transition-state hover:border-line-strong"
            >
              Write a book
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
    // Already matured, so `tauOf` returns zero and the curve takes its constant-sum branch.
    maturity: MATURED_MATURITY,
    liquidityWad: rmm?.liquidityWad,
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
        <PageHeader title={`Leg ${truncateHash(strategy.strategyHash)}`} />
        <EmptyState
          className="mt-8"
          icon={Layers}
          title="Not a Strikeline leg"
          description="This strategy was shipped to the Strikeline router but its program carries no RmmSwap instruction, so it has no strike, no implied vol and no expiry to show. It is some other SwapVM program using the same app."
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
      label: `Fill ${i + 1}`,
    };
  });

  const scrubbedSeconds =
    remainingNow === undefined ? undefined : Math.round(remainingNow * (1 - settled));

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              {risky.symbol} {kind ?? 'leg'}
            </span>
            <span className="font-mono tnum text-ink-2">
              K {formatChartNumber(strike, { significantDigits: 12, maxFractionDigits: 2 })}
            </span>
          </span>
        }
        subtitle={
          kind === 'call'
            ? 'A covered call written as a price curve. The reserves below are virtual balances in Aqua; the tokens themselves have never left the maker\u2019s wallet.'
            : kind === 'put'
              ? 'A cash-secured put written as a price curve, from the same 62 bytes as a call. Which one it is was decided only by the side of the strike its reserves started on.'
              : 'A price curve with no one-way settlement gate, so at expiry it trades in both directions. The reserves below are virtual balances in Aqua.'
        }
        meta={
          <>
            {strategy.docked ? (
              <Pill tone="neutral" dot>
                Docked
              </Pill>
            ) : expired ? (
              <Pill tone="warning" dot>
                In assignment
              </Pill>
            ) : (
              <Pill tone="positive" dot>
                Active
              </Pill>
            )}
            <Pill tone="accent">{formatPercent(sigma, { fractionDigits: 0 })} IV</Pill>
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
                  : `${formatDuration(scrubbedSeconds)} to maturity · sigma ${formatPercent(sigma, { fractionDigits: 0 })} · L ${formatChartNumber(liquidity)} ${risky.symbol}`
              }
              state={live.error ? 'error' : live.isLoading ? 'loading' : 'ready'}
              errorMessage={
                live.error
                  ? 'The router did not return curve samples. Check that the deployment points at a StrikelineRouter.'
                  : undefined
              }
            />

            <Card>
              <TimeScrubber
                value={scrub}
                onValueChange={setScrub}
                remainingSeconds={remainingNow ?? 0}
                disabled={expired || remainingNow === undefined}
                disabledReason={
                  expired
                    ? 'This leg has matured; the curve is already the settlement line.'
                    : 'Waiting for the router to report tau.'
                }
              />
            </Card>
          </div>

          <Card
            title="Fills"
            description="Replayed from Aqua's own ledger events. Every pull decrements the strategy's virtual balance and every push increments it, so the reserve point walks across fills with no maker transaction."
            flush
          >
            <Table caption="Fills against this leg" hideCaption minWidth="42rem">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Transaction</TableHeaderCell>
                  <TableHeaderCell numeric>Out</TableHeaderCell>
                  <TableHeaderCell numeric>In</TableHeaderCell>
                  <TableHeaderCell numeric>Block</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ledger.isLoading ? (
                  <TableMessageRow colSpan={4}>Reading the ledger…</TableMessageRow>
                ) : ledger.fills.length === 0 ? (
                  <TableMessageRow colSpan={4}>
                    Nothing has crossed this curve yet. A trade has to clear the decay band before it can.
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
          <Card title="Terms" description="Read out of the RmmSwap arguments, the only record of them.">
            <dl className="flex flex-col">
              <CardRow label="Strike">
                <span className="font-mono tnum">
                  {formatChartNumber(strike, { significantDigits: 12, maxFractionDigits: 2 })}{' '}
                  {stable.symbol}
                </span>
              </CardRow>
              <CardRow label="Implied vol">
                <span className="font-mono tnum">{formatPercent(sigma, { fractionDigits: 1 })}</span>
              </CardRow>
              <CardRow label="Liquidity (L)">
                <span className="font-mono tnum">
                  {formatChartNumber(liquidity)} {risky.symbol}
                </span>
              </CardRow>
              <CardRow label="Expiry">
                <span className="font-mono tnum">{formatExpiry(rmm.maturity)}</span>
              </CardRow>
              <CardRow label="Time left">
                <span className="font-mono tnum">
                  {remainingNow === undefined ? '—' : formatDuration(remainingNow)}
                </span>
              </CardRow>
              <CardRow label="tau (router)">
                <span className="font-mono tnum">
                  {tau.tauWad === undefined
                    ? '—'
                    : `${(Number(tau.tauWad) / 1e18).toFixed(6)} y`}
                </span>
              </CardRow>
              <CardRow label="Maker">
                <AddressText value={strategy.maker} size="meta" />
              </CardRow>
            </dl>
          </Card>

          <Card
            title="Theta band"
            description="The gap decay has opened between the stale reserve point and the curve. No transaction created it; whoever crosses it pays it to the maker."
          >
            {band.band ? (
              <StatRow className="md:grid-cols-2">
                <StatTile
                  label={`Smallest ${stable.symbol} trade`}
                  value={
                    <TokenAmount
                      value={band.band.minStableIn / rmm.rateStable}
                      decimals={stable.decimals}
                      size="lg"
                    />
                  }
                  unit={stable.symbol}
                  detail="Anything below this reverts RmmInsideSpread"
                />
                <StatTile
                  label={`Smallest ${risky.symbol} trade`}
                  value={
                    <TokenAmount
                      value={band.band.minRiskyIn / rmm.rateRisky}
                      decimals={risky.decimals}
                      size="lg"
                    />
                  }
                  unit={risky.symbol}
                  detail="The other side of the same band"
                />
              </StatRow>
            ) : band.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <p className="text-meta text-ink-3">
                The router did not return a band for these reserves.
              </p>
            )}

            {band.band && scrubbedBand.band && settled > 0 && scrubbedSeconds !== undefined ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-mini leading-prose text-ink-3">
                  At <span className="font-mono tnum">{formatDuration(scrubbedSeconds)}</span> to
                  maturity, with no transaction in between, the same reserves would refuse anything
                  under:
                </p>
                <dl className="mt-2 flex flex-col">
                  <CardRow label={stable.symbol}>
                    <span className="flex items-center gap-2">
                      <TokenAmount
                        value={scrubbedBand.band.minStableIn / rmm.rateStable}
                        decimals={stable.decimals}
                        size="sm"
                      />
                      <Delta
                        value={
                          (scrubbedBand.band.minStableIn - band.band.minStableIn) / rmm.rateStable
                        }
                        decimals={stable.decimals}
                        size="sm"
                      />
                    </span>
                  </CardRow>
                  <CardRow label={risky.symbol}>
                    <span className="flex items-center gap-2">
                      <TokenAmount
                        value={scrubbedBand.band.minRiskyIn / rmm.rateRisky}
                        decimals={risky.decimals}
                        size="sm"
                      />
                      <Delta
                        value={
                          (scrubbedBand.band.minRiskyIn - band.band.minRiskyIn) / rmm.rateRisky
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
            title="Deliverable now"
            description="What Coverage would allow this instant, read from the same wallet balance every sibling leg is quoting against."
          >
            <StatRow className="md:grid-cols-2">
              <StatTile
                label={`${risky.symbol} free`}
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
                    Virtual reserve{' '}
                    <TokenAmount value={riskyRaw} decimals={risky.decimals} size="sm" />
                  </>
                }
              />
              <StatTile
                label={`${stable.symbol} free`}
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
                    Virtual reserve{' '}
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
      <PageHeader title={`Leg ${truncateHash(hash)}`} />
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
