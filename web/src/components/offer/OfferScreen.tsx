'use client';

/**
 * One offer, in full — and the one screen where the mechanism is allowed to show.
 *
 * The landing card is three fields and a button and says nothing a newcomer has to look up. This is
 * where someone who clicked a row gets the rest: the curve their offer prices against, the gap that
 * pays them, the trades that have moved it, and the two actions that change it. Precise terms are
 * present but they arrive in tooltips and behind a disclosure, never in a label a reader has to
 * decode to get through the page.
 *
 * Every number here is a chain read. The terms come out of the offer's own published bytes; the
 * curve from `stableFor`; the gap from `bandFor`; what a buyer pays from `quote()`; what can
 * actually be delivered from `coverage`; and the trades from a replay of Aqua's `Pushed`/`Pulled`
 * stream. There is no option maths in this app and there must not be: a wei-exact TypeScript port
 * of the curve is the single most likely way to make the screen disagree with the chain, and here a
 * disagreement is not a rounding error, it is a bricked offer.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Group, Paper, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { ArrowLeft } from 'lucide-react';
import { formatUnits as viemFormatUnits } from 'viem';
import {
  TAU_FLOOR_SECONDS,
  formatDuration,
  useCoverage,
  useDebounced,
  useLegFills,
  useTauNow,
  useThetaBand,
} from '@/components/curve';
import { formatByWhen, formatExpiry } from '@/components/sell/expiry';
import { AppChrome, useIsHydrated } from '@/components/shell';
import { MATURED_MATURITY, useCurveSamples } from '@/hooks/useCurveSamples';
import { ceilFromWad } from '@/hooks/strikeline';
import { formatPercent, formatUnits, truncateHash } from '@/lib/ui';
import { Figure, Num, Panel, SectionHead, Term } from './bits';
import { FillsPanel } from './FillsPanel';
import { GapChart } from './GapChart';
import { GapGrowth } from './GapGrowth';
import { GapReadout } from './GapReadout';
import { ManagePanel } from './ManagePanel';
import { PriceCurve, type FillMarker } from './PriceCurve';
import { TakePanel } from './TakePanel';
import { TermsPanel } from './TermsPanel';
import { TimeSlider } from './TimeSlider';
import { useBandSeries } from './useBandSeries';
import { useOffer, type Offer } from './useOffer';
import { useQuoteLadder, useSmallestFill } from './useTakeQuotes';

export interface OfferScreenProps {
  hash: string;
}

export function OfferScreen({ hash }: OfferScreenProps) {
  const hydrated = useIsHydrated();
  const { offer, deployments, notAnOffer, isLoading, error, refetch } = useOffer(hash);

  if (!hydrated || isLoading) {
    return (
      <Shell>
        <Stack gap="lg">
          <Skeleton height={28} width="60%" radius="md" />
          <Skeleton height={140} radius="lg" />
          <Skeleton height={320} radius="lg" />
        </Stack>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <Alert variant="light" color="ember" radius="lg" title="Could not read the chain's log of offers">
          <Stack gap="sm" align="flex-start">
            <Text size="sm" c="var(--ink-2)">
              {error.message}
            </Text>
            <Button size="xs" variant="default" onClick={refetch}>
              Try again
            </Button>
          </Stack>
        </Alert>
      </Shell>
    );
  }

  if (notAnOffer) {
    return (
      <Shell>
        <Stack gap="lg">
          <Text component="h1" fw={600} size="xl" c="var(--ink)">
            Not a Strikeline offer
          </Text>
          <Text size="sm" c="var(--ink-2)" className="max-w-prose leading-prose">
            This strategy was published to the Strikeline router, but its program carries no pricing
            curve, so it has no price, no date and no volatility to show. It is some other program
            using the same app.
          </Text>
        </Stack>
      </Shell>
    );
  }

  if (!offer || !deployments) {
    return (
      <Shell>
        <Stack gap="md" align="flex-start">
          <Text component="h1" fw={600} size="xl" c="var(--ink)">
            No offer with this reference
          </Text>
          <Text size="sm" c="var(--ink-2)" className="max-w-prose leading-prose">
            An offer is identified by the hash of its own bytes, so it exists only if it was
            published to this router. Nothing was published under{' '}
            <span className="font-mono text-mini">{truncateHash(hash)}</span>.
          </Text>
          <Button component={Link} href="/offers" variant="default" size="sm">
            Your offers
          </Button>
        </Stack>
      </Shell>
    );
  }

  return <Detail offer={offer} deployments={deployments} onRefresh={refetch} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <AppChrome>{children}</AppChrome>;
}

// ---------------------------------------------------------------------------

function Detail({
  offer,
  deployments,
  onRefresh,
}: {
  offer: Offer;
  deployments: NonNullable<ReturnType<typeof useOffer>['deployments']>;
  onRefresh: () => void;
}) {
  const [scrub, setScrub] = useState(0);
  const settled = useDebounced(scrub, 140);
  const { rmm, risky, stable, chainNow } = offer;

  /**
   * Scrubbing changes which offer the router is asked about, not how the answer is read: an offer
   * maturing sooner is a real sample, and one that has already matured returns the closed form.
   *
   * Three cases, and both ends are exact on purpose. At rest the chart must be this offer's own
   * curve, so the maturity is the one in its bytes, untouched. At the far end it is the settlement
   * sentinel. In between the value is snapped to a minute, because the raw expression drifts with
   * the block clock and every distinct value is another multicall for a curve that has not visibly
   * changed.
   */
  const effectiveMaturity =
    chainNow === undefined || offer.remainingSeconds === undefined
      ? undefined
      : settled <= 0
        ? rmm.maturity
        : settled >= 1
          ? MATURED_MATURITY
          : Math.floor((rmm.maturity - offer.remainingSeconds * settled) / 60) * 60;

  const live = useCurveSamples({
    router: deployments.router,
    strikeWad: rmm.strikeWad,
    sigmaWad: rmm.sigmaWad,
    maturity: effectiveMaturity,
    liquidityWad: rmm.liquidityWad,
  });

  const settlement = useCurveSamples({
    router: deployments.router,
    strikeWad: rmm.strikeWad,
    sigmaWad: rmm.sigmaWad,
    // Already matured, so `tauOf` returns zero and the curve takes its constant-sum branch. That
    // branch has no tau in it, which makes this the one curve on the screen that cannot change.
    maturity: MATURED_MATURITY,
    liquidityWad: rmm.liquidityWad,
    refreshMs: false,
  });

  const bandParams =
    offer.xWad > BigInt(0)
      ? {
          strikeWad: rmm.strikeWad,
          sigmaWad: rmm.sigmaWad,
          maturity: rmm.maturity,
          liquidityWad: rmm.liquidityWad,
          xWad: offer.xWad,
          yWad: offer.yWad,
        }
      : undefined;

  /** What a taker has to cross right now. The tradeable number. */
  const band = useThetaBand(deployments.router, bandParams);

  /** The same gap at the scrubber's position, so the wedge is the one under the curve on screen. */
  const scrubbedBand = useThetaBand(
    deployments.router,
    bandParams && effectiveMaturity !== undefined && settled > 0
      ? { ...bandParams, maturity: effectiveMaturity }
      : undefined,
  );

  const shownBand = settled > 0 ? scrubbedBand.band : band.band;

  const tau = useTauNow(deployments.router, rmm.maturity);
  const coverage = useCoverage(deployments.router, offer.strategy.maker, [
    offer.riskyToken,
    offer.stableToken,
  ]);
  const ledger = useLegFills({
    aqua: deployments.aqua,
    app: deployments.router,
    maker: offer.strategy.maker,
    strategyHash: offer.strategy.strategyHash,
    fromBlock: BigInt(deployments.blockNumber),
  });

  const series = useBandSeries({
    router: deployments.router,
    strikeWad: rmm.strikeWad,
    sigmaWad: rmm.sigmaWad,
    liquidityWad: rmm.liquidityWad,
    maturity: rmm.maturity,
    xWad: offer.xWad,
    yWad: offer.yWad,
    chainNow,
  });

  // What leaves the offer when somebody takes it, and how much of it can actually be delivered.
  const outIsRisky = offer.outToken.toLowerCase() === offer.riskyToken.toLowerCase();
  const outMeta = outIsRisky ? risky : stable;
  const inMeta = outIsRisky ? stable : risky;
  const advertisedOut = outIsRisky ? offer.riskyRaw : offer.stableRaw;
  const deliverableOut = coverage.free[offer.outToken.toLowerCase()];
  const maxOut = useMemo(() => {
    const ceiling =
      deliverableOut === undefined
        ? advertisedOut
        : deliverableOut < advertisedOut
          ? deliverableOut
          : advertisedOut;
    // A hair inside the bound, so the top rung is a price rather than a coin flip against the guard.
    return (ceiling * BigInt(98)) / BigInt(100);
  }, [deliverableOut, advertisedOut]);

  const ladder = useQuoteLadder({
    router: deployments.router,
    order: offer.strategy.order,
    isAToB: offer.isAToB,
    maxOut,
    enabled: !offer.withdrawn,
  });

  /**
   * `bandFor`'s minimum on the side the taker pays, in that token's raw units — ceiled, because a
   * minimum that rounds down is one raw unit short of clearing.
   *
   * `liveIn` is always the offer as it stands and is what the quote probe is sent, since the router
   * can only be asked to fill something at the block it is in. `shownIn` follows the slider, so the
   * figure above the wedge and the wedge itself are always the same moment.
   */
  const liveIn =
    band.band === undefined
      ? undefined
      : outIsRisky
        ? ceilFromWad(band.band.minStableIn, rmm.rateStable)
        : ceilFromWad(band.band.minRiskyIn, rmm.rateRisky);
  const shownIn =
    shownBand === undefined
      ? undefined
      : outIsRisky
        ? ceilFromWad(shownBand.minStableIn, rmm.rateStable)
        : ceilFromWad(shownBand.minRiskyIn, rmm.rateRisky);
  const shownOther =
    shownBand === undefined
      ? undefined
      : outIsRisky
        ? ceilFromWad(shownBand.minRiskyIn, rmm.rateRisky)
        : ceilFromWad(shownBand.minStableIn, rmm.rateStable);

  const smallest = useSmallestFill({
    router: deployments.router,
    order: offer.strategy.order,
    isAToB: offer.isAToB,
    published: liveIn,
    enabled: !offer.withdrawn,
  });

  const fills: FillMarker[] = ledger.fills.map((fill, i) => ({
    id: `${fill.transactionHash}-${fill.logIndex}`,
    x: Number(
      viemFormatUnits((fill.reservesAfter[offer.riskyToken.toLowerCase()] ?? BigInt(0)) * rmm.rateRisky, 18),
    ),
    y: Number(
      viemFormatUnits((fill.reservesAfter[offer.stableToken.toLowerCase()] ?? BigInt(0)) * rmm.rateStable, 18),
    ),
    label: `Trade ${i + 1}`,
  }));

  // Derived from the maturity the router was actually asked about, not from the slider's fraction:
  // the two differ by up to the snapping quantum, and every caption here labels a number that came
  // back from that call.
  const scrubbedSeconds =
    effectiveMaturity === undefined || chainNow === undefined
      ? undefined
      : Math.max(effectiveMaturity - chainNow, 0);
  const scrubbedDays =
    scrubbedSeconds === undefined || offer.remainingSeconds === undefined
      ? undefined
      : (offer.remainingSeconds - scrubbedSeconds) / 86_400;

  const gapStable = shownBand ? Number(viemFormatUnits(shownBand.minStableIn, 18)) : 0;
  const gapRisky = shownBand ? Number(viemFormatUnits(shownBand.minRiskyIn, 18)) : 0;
  const fullStableRange = Number(viemFormatUnits((rmm.liquidityWad * rmm.strikeWad) / BigInt(10) ** BigInt(18), 18));

  const sigma = Number(viemFormatUnits(rmm.sigmaWad, 18));
  const strikeLabel = `${formatUnits(rmm.strikeWad, 18, { significantDigits: 18, maxFractionDigits: 2 })} ${stable.symbol}`;

  /*
   * How much is on offer: the reserve on the side that LEAVES the wallet, never `L`.
   *
   * This used to print `rmm.liquidityWad`, which is the notional the curve is drawn against and is
   * always larger than the amount being sold — the same offer read 14.3969 WETH here, 10.40 on
   * /offers, and 10.4 in this page's own take panel three sections down. A 38% overstatement in the
   * two most prominent numbers on the screen, and it broke the card's promise that you sell exactly
   * what you typed. On a put it was worse: the headline said "Buy <L> WETH" while the token the
   * offer actually hands over is USDC.
   *
   * `advertisedOut` is that reserve, already resolved above for the quote ladder, and it is
   * formatted through the same rule `offers/copy.ts` uses so the table and this h1 print the same
   * characters for the same offer. `L` is named where it belongs, in the terms panel at the foot of
   * the page.
   */
  const sizeLabel = `${formatUnits(advertisedOut, outMeta.decimals, { significantDigits: 6, minFractionDigits: 2 })} ${outMeta.symbol}`;
  const notionalLabel = `${formatUnits(rmm.liquidityWad, 18, { significantDigits: 6 })} ${risky.symbol}`;
  // One verb, applied to the token the maker hands over, is correct on both sides: a cash-secured
  // put IS selling dollars for ETH. The trigger clause is what says which — the same sentence the
  // landing card and the offers table make.
  const trigger = offer.kind === 'put' ? 'if it falls to' : 'if it reaches';

  return (
    <Shell>
      <Stack gap="xl">
        {/* --- who and what ------------------------------------------------ */}
        <Stack gap="sm">
          <Anchor
            component={Link}
            href="/offers"
            className="inline-flex w-fit items-center gap-1.5 text-meta"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            Your offers
          </Anchor>

          <Text component="h1" fw={600} className="text-section leading-num" c="var(--ink)">
            Sell <Num>{sizeLabel}</Num> {trigger} <Num>{strikeLabel}</Num> by{' '}
            <Num>{formatByWhen(rmm.maturity)}</Num>
          </Text>

          <Group gap="xs" wrap="wrap">
            {offer.withdrawn ? (
              <Badge variant="light" color="slate" radius="sm" size="sm">
                Withdrawn
              </Badge>
            ) : offer.expired ? (
              <Badge variant="light" color="amber" radius="sm" size="sm">
                Past its date
              </Badge>
            ) : (
              <Badge variant="light" color="moss" radius="sm" size="sm">
                Live
              </Badge>
            )}
            <Badge variant="light" color="petrol" radius="sm" size="sm">
              <Term precise={`Implied volatility, sigma = ${formatPercent(sigma, { fractionDigits: 1 })}. The movement this offer is priced for over a year.`}>
                {formatPercent(sigma, { fractionDigits: 0 })} movement priced in
              </Term>
            </Badge>
            <Text size="xs" c="var(--ink-3)" className="font-mono tnum">
              {truncateHash(offer.strategy.strategyHash)}
            </Text>
          </Group>
        </Stack>

        {/* --- the whole thing in four numbers ----------------------------- */}
        <Panel
          title="What you agreed to"
          description={
            offer.kind === 'put'
              ? `An offer to buy ${risky.symbol} at this price, paid for with ${stable.symbol}. Nobody is paid up front: what the maker earns builds up inside the offer and only becomes real when somebody trades.`
              : `An offer to sell ${risky.symbol} at this price. Nobody is paid up front: what the maker earns builds up inside the offer and only becomes real when somebody trades.`
          }
        >
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
              <Figure
                label="How much"
                value={formatUnits(advertisedOut, outMeta.decimals, {
                  significantDigits: 6,
                  minFractionDigits: 2,
                })}
                unit={outMeta.symbol}
                detail={
                  <Term
                    precise={`The virtual reserve Aqua holds on the ${outMeta.symbol} side. The curve underneath is drawn against a liquidity L of ${notionalLabel}, which is always the larger number and is not what is on offer.`}
                  >
                    on offer right now
                  </Term>
                }
              />
              <Figure
                label="At what price"
                value={formatUnits(rmm.strikeWad, 18, { significantDigits: 18, maxFractionDigits: 2 })}
                unit={stable.symbol}
                detail={<Term precise="Strike, K.">each</Term>}
              />
              <Figure
                label="By when"
                value={formatByWhen(rmm.maturity)}
                detail={
                  offer.remainingSeconds === undefined
                    ? formatExpiry(rmm.maturity)
                    : `${formatDuration(offer.remainingSeconds)} left`
                }
              />
              <Figure
                label="Smallest trade it takes"
                tone="warn"
                value={
                  liveIn === undefined
                    ? '—'
                    : // No `maxFractionDigits` cap: at two places a bound of 0.006308 USDC printed
                      // as "0.01" here while `GapReadout` printed the exact figure from the same
                      // read a section below, which is two different numbers for one quantity on
                      // one screen. Nine significant digits is what the readout uses.
                      formatUnits(smallest.fill?.clears ?? liveIn, inMeta.decimals, {
                        significantDigits: 9,
                        maxFractionDigits: 6,
                      })
                }
                unit={inMeta.symbol}
                detail="and growing"
              />
            </SimpleGrid>

            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Stack gap={4}>
                <Text size="xs" fw={500} c="var(--pos)">
                  What you earn
                </Text>
                <Text size="sm" c="var(--ink-2)" className="leading-prose">
                  Whoever takes this offer has to pay for the wait, and the longer nobody does the
                  more they have to pay. Right now the smallest trade it will accept is{' '}
                  <Num>
                    {liveIn === undefined
                      ? '—'
                      : formatUnits(smallest.fill?.clears ?? liveIn, inMeta.decimals, {
                          significantDigits: 9,
                          maxFractionDigits: 6,
                        })}
                  </Num>{' '}
                  {inMeta.symbol}, and every hour that passes it grows.
                </Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" fw={500} c="var(--neg)">
                  What you risk
                </Text>
                <Text size="sm" c="var(--ink-2)" className="leading-prose">
                  {offer.kind === 'put' ? (
                    <>
                      If {risky.symbol} falls well below <Num>{strikeLabel}</Num> you still buy at{' '}
                      <Num>{strikeLabel}</Num>. You keep what you were paid and you carry the rest of
                      the fall.
                    </>
                  ) : (
                    <>
                      If {risky.symbol} runs well past <Num>{strikeLabel}</Num> you still sell at{' '}
                      <Num>{strikeLabel}</Num>. You keep what you were paid and you give up the rest
                      of the move.
                    </>
                  )}{' '}
                  Your {risky.symbol} never leaves your wallet either way.
                </Text>
              </Stack>
            </div>
          </Stack>
        </Panel>

        {/* --- the curve --------------------------------------------------- */}
        <Stack gap="md">
          <SectionHead title="What it trades at">
            Buyers take {risky.symbol} out of the offer and pay {stable.symbol} in, and the rate
            moves as they do. Drag the slider to watch the line fall toward what the offer becomes on
            its date. Nothing moves on chain.
          </SectionHead>

          <PriceCurve
            live={live.samples}
            settlement={settlement.samples}
            reserve={
              offer.xWad > BigInt(0) || offer.yWad > BigInt(0)
                ? {
                    x: Number(viemFormatUnits(offer.xWad, 18)),
                    y: Number(viemFormatUnits(offer.yWad, 18)),
                  }
                : undefined
            }
            gapStable={gapStable}
            fills={fills}
            riskySymbol={risky.symbol}
            stableSymbol={stable.symbol}
            scrubbed={settled > 0}
            subtitle={
              scrubbedSeconds === undefined
                ? 'Sampling…'
                : `${formatDuration(scrubbedSeconds)} left · ${formatPercent(sigma, { fractionDigits: 0 })} movement priced in · drawn against ${notionalLabel}`
            }
            state={live.error ? 'error' : live.isLoading ? 'loading' : 'ready'}
            errorMessage={
              live.error
                ? 'The router did not return the curve for this offer. Check that the deployment points at a StrikelineRouter.'
                : undefined
            }
          />

          <Paper withBorder p="md" bg="var(--surface)">
            <TimeSlider
              value={scrub}
              onChange={setScrub}
              remainingSeconds={offer.remainingSeconds ?? 0}
              disabled={offer.expired || offer.remainingSeconds === undefined}
              disabledReason={
                offer.expired
                  ? 'This offer is past its date; the curve is already its settlement line.'
                  : 'Waiting for the chain to report the time left.'
              }
            />
          </Paper>
        </Stack>

        {/* --- the gap ----------------------------------------------------- */}
        <Stack gap="md">
          <SectionHead title="The gap that pays you">
            The offer&rsquo;s reserves sat exactly on its curve the moment it was published. Time
            moves the curve away from them, and a trade only clears once it is big enough to close
            the distance. Nobody opened this gap with a transaction; whoever crosses it hands it to
            you.
          </SectionHead>

          <Paper withBorder p="md" bg="var(--surface)">
            <GapReadout
              publishedIn={shownIn}
              publishedOther={shownOther}
              inSymbol={inMeta.symbol}
              inDecimals={inMeta.decimals}
              otherSymbol={outMeta.symbol}
              otherDecimals={outMeta.decimals}
              // The probe can only be sent at the block the browser is in, so the measurement
              // belongs to "now". Dragging the slider replaces it with the sentence that says so.
              fill={settled > 0 ? undefined : smallest.fill}
              scrubbed={settled > 0}
              whenLabel={scrubbedSeconds === undefined ? undefined : formatDuration(scrubbedSeconds)}
            />
          </Paper>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <GapChart
              gapStable={gapStable}
              gapRisky={gapRisky}
              riskySymbol={risky.symbol}
              stableSymbol={stable.symbol}
              fullStableRange={fullStableRange}
              scrubbed={settled > 0}
              stableLabel={
                shownBand
                  ? `${formatUnits(ceilFromWad(shownBand.minStableIn, rmm.rateStable), stable.decimals, { significantDigits: 5 })} ${stable.symbol}`
                  : undefined
              }
              riskyLabel={
                shownBand
                  ? `${formatUnits(ceilFromWad(shownBand.minRiskyIn, rmm.rateRisky), risky.decimals, { significantDigits: 4 })} ${risky.symbol}`
                  : undefined
              }
              subtitle={
                settled > 0 && scrubbedSeconds !== undefined
                  ? `As it would be with ${formatDuration(scrubbedSeconds)} left`
                  : 'As it is right now'
              }
              state={band.isLoading && !shownBand ? 'loading' : 'ready'}
            />

            <GapGrowth
              points={series.points}
              stableSymbol={stable.symbol}
              markerDays={scrubbedDays}
              state={series.error ? 'error' : series.isLoading ? 'loading' : 'ready'}
              errorMessage={series.error ? series.error.message : undefined}
            />
          </SimpleGrid>

          {offer.remainingSeconds !== undefined && offer.remainingSeconds > TAU_FLOOR_SECONDS ? (
            <Text size="xs" c="var(--ink-3)" className="leading-prose">
              Traders call this gap the{' '}
              <Term precise="Theta band. With liquidity fixed and the invariant offset at zero, the reserves sit on the curve and decay moves the curve away from them in both directions at once, so the premium arrives as a two-sided spread rather than as an up-front credit.">
                theta band
              </Term>
              , and it is why this offer contains no fee instruction: a flat fee would push the
              reserves off the curve and leak the premium to the next taker.
            </Text>
          ) : null}
        </Stack>

        {/* --- the price a buyer sees -------------------------------------- */}
        <TakePanel
          rows={ladder.rows}
          isLoading={ladder.isLoading}
          error={ladder.error}
          outSymbol={outMeta.symbol}
          outDecimals={outMeta.decimals}
          inSymbol={inMeta.symbol}
          inDecimals={inMeta.decimals}
          deliverable={deliverableOut}
          advertised={advertisedOut}
          strikeLabel={strikeLabel}
        />

        {/* --- what has happened ------------------------------------------- */}
        <FillsPanel
          fills={ledger.fills}
          isLoading={ledger.isLoading}
          deployments={deployments}
          chainId={deployments.chainId}
        />

        {/* --- the two things you can do ----------------------------------- */}
        {offer.withdrawn ? (
          <Alert variant="light" color="slate" radius="lg" title="This offer has been taken down">
            <Text size="sm" c="var(--ink-2)" className="leading-prose">
              Aqua wrote <span className="font-mono">0xff</span> over it, so nobody can take it and
              it can never be published again. The same price, size and date can only come back as a
              new offer with its own history. No token moved when it went: there was never anything
              held anywhere to give back.
            </Text>
          </Alert>
        ) : (
          <ManagePanel
            aqua={deployments.aqua}
            router={deployments.router}
            maker={offer.strategy.maker}
            strategyHash={offer.strategy.strategyHash}
            tokens={offer.strategy.tokens}
            rmm={rmm}
            reserves={[
              offer.rawByToken[offer.strategy.tokens[0].toLowerCase()] ?? BigInt(0),
              offer.rawByToken[offer.strategy.tokens[1].toLowerCase()] ?? BigInt(0),
            ]}
            riskyIsTokenA={offer.riskyToken.toLowerCase() === offer.strategy.tokens[0].toLowerCase()}
            riskySymbol={risky.symbol}
            riskyDecimals={risky.decimals}
            stableSymbol={stable.symbol}
            stableDecimals={stable.decimals}
            chainNow={chainNow}
            chainId={deployments.chainId}
            onDone={onRefresh}
          />
        )}

        {/* --- for whoever wants the precise words ------------------------- */}
        <details className="rounded-card border border-line bg-surface">
          <summary className="cursor-pointer list-none px-4 py-3 text-meta font-medium text-ink-2 transition-state hover:text-ink">
            The exact terms, and the bytes they are stored as
          </summary>
          <div className="border-t border-line p-4">
            <TermsPanel offer={offer} tauWad={tau.tauWad} chainId={deployments.chainId} />
          </div>
        </details>
      </Stack>
    </Shell>
  );
}
