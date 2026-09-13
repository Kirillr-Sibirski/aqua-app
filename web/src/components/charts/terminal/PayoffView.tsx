'use client';

/**
 * PAYOFF AT EXPIRY — the view a first-time visitor reads.
 *
 * Two lines and two regions. Holding the same reserves, and writing this leg against them: the two
 * lines are the same line until spot passes the point where assignment becomes worth doing, and
 * past it the position is flat while holding keeps climbing.
 *
 * The red wedge above the kink is what the maker hands over. The green triangle below it, between
 * the strike and that kink, is what they are paid for it — `earned` tall at the strike and
 * `earned/x` wide, both from the same `stableFor` reads the ticket prints `Premium` from. The view
 * used to draw only the wedge, which made a vol-selling terminal's headline chart a picture of the
 * downside alone while the ticket beside it advertised the premium. Both regions are bounded by
 * lines that were already on the chart; nothing is shifted and nothing is modelled.
 *
 * Every constant the two lines are pinned to is a chain read at a matured maturity, where the
 * router's own trading function is the closed form `Y = K*(L - X)` and no Gaussian is evaluated at
 * all. See `payoff.ts` for the derivation. There is no Black-Scholes in this file, and no `Phi`.
 */
import { useState } from 'react';
import { scaleLinear } from 'd3-scale';
import type { Address } from 'viem';
import type { SupportedChainId } from '@/lib/chain';
import { color, colorMix, FONT_STACK } from '@/lib/ui/tokens';
import { Axis } from '../Axis';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { MarkerLayer, type MarkerSpec } from '../Marker';
import { estimateMonoTextWidth, padDomain } from '../geometry';
import { formatChartNumber } from '../format';
import { round, type ChartGeometry } from '../types';
import classes from './chart.module.css';
import { Crosshair } from './Crosshair';
import { Readout, type ReadoutItem } from './chrome';
import { terminalError } from './errors';
import { AxisBand, AxisName, SeriesLabel, Wipe } from './Marks';
import {
  forgonePoints,
  holdPoints,
  holdValue,
  payoffAnchors,
  payoffDomain,
  positionPoints,
  positionValue,
  premiumPoints,
  type PayoffAnchors,
} from './payoff';
import { Plot, PlotArea } from './Plot';
import { useSettlement } from './useSettlement';
import type { TerminalLeg, TerminalState, TerminalToken } from './types';

export interface PayoffViewProps {
  panelId: string;
  tabId: string;
  router?: Address;
  chainId?: SupportedChainId;
  leg?: TerminalLeg;
  risky: TerminalToken;
  stable: TerminalToken;
  spot?: number;
  state: TerminalState;
  errorMessage?: string;
  refusedMessage?: string;
}

/** Room for four-digit ticks on the left, the unit tag and marker labels along the top. */
const MARGIN = { top: 26, right: 14, bottom: 42, left: 58 };

/**
 * How far apart, in px, the cap and the strike have to be before the cap is drawn as its own rule.
 *
 * Below this they are one column of pixels wearing two labels, and the view says the premium as a
 * figure at the kink instead. Twenty-four is roughly two label heights: enough that a reader reads
 * two rules rather than a thick one.
 */
const CAP_SEPARATION = 24;

/**
 * How many places along the axis the cursor can stop.
 *
 * Fixed rather than derived from the measured width, which is what lets the readout above the plot
 * turn an index into a price without knowing the geometry: the strip renders outside the SVG and
 * has never been measured. At 320 stops a 1,000px plot resolves to about three pixels per step,
 * finer than a pointer, and the keyboard gets a step small enough to be smooth and a shift-step
 * large enough to cross the chart in ten presses.
 */
const STOPS = 320;

/** Evenly spaced across the plot: the payoff is a function, so any x is as valid as any other. */
function samplePositions(geometry: ChartGeometry): number[] {
  const { inner } = geometry;
  const out = new Array<number>(STOPS);
  for (let i = 0; i < STOPS; i += 1) out[i] = inner.x + (inner.width * i) / (STOPS - 1);
  return out;
}

/** The spot an index stands for, without needing the measured box. */
function spotAt(index: number, domain: readonly [number, number]): number {
  return domain[0] + (domain[1] - domain[0]) * (index / (STOPS - 1));
}

export function PayoffView({
  panelId,
  tabId,
  router,
  chainId,
  leg,
  risky,
  stable,
  spot,
  state,
  errorMessage,
  refusedMessage,
}: PayoffViewProps) {
  const [index, setIndex] = useState<number | null>(null);

  const settlement = useSettlement({
    router,
    chainId,
    strikeWad: leg?.strikeWad,
    sigmaWad: leg?.sigmaWad,
    liquidityWad: leg?.liquidityWad,
    xWad: leg?.xWad,
    enabled: !!leg && state === 'ready',
  });

  const anchors =
    leg && settlement.capWad !== undefined && settlement.settlementWad !== undefined
      ? payoffAnchors({
          xWad: leg.xWad,
          yWad: leg.yWad,
          capWad: settlement.capWad,
          settlementWad: settlement.settlementWad,
          strikeWad: leg.strikeWad,
          liquidityWad: leg.liquidityWad,
          side: leg.side,
        })
      : null;

  let resolved: TerminalState = state;
  if (state === 'ready') {
    if (!leg) resolved = 'empty';
    else if (settlement.error) resolved = 'error';
    else if (anchors) resolved = 'ready';
    else if (settlement.isLoading) resolved = 'loading';
    else resolved = 'empty';
  }

  const domain = anchors ? payoffDomain(anchors, spot) : ([0, 1] as [number, number]);
  /** With no cursor the readout stands at today's spot, or where the two lines part. */
  const restSpot = anchors ? (spot !== undefined && spot > 0 ? spot : anchors.capSpot) : 0;
  const at = anchors ? (index === null ? restSpot : spotAt(index, domain)) : 0;

  /* Nothing is read out of a plot that is not being drawn: a refusal must not leave last frame's
     figures standing in the strip above an empty box. */
  const readout: ReadoutItem[] = anchors && resolved === 'ready' ? readoutAt(at, anchors, risky.symbol) : [];
  const buying = leg?.side === 'buy';
  /* What the maker would otherwise be sitting on: the risky they would sell, or the stable they would spend. */
  const heldSymbol = buying ? stable.symbol : risky.symbol;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* No legend row. The two lines are labelled on the lines, and the two shaded regions are
          named in the readout, in their own colours, with the figure each is worth attached — which
          is what a swatch in a box could never say. */}
      <Readout items={readout} />
      <p className={classes.assumption}>assumes no trades before expiry</p>
      <Plot
        title="Payoff at expiry"
        description={`Value of this position at expiry against spot, in ${stable.symbol}, beside the value of simply holding the same ${risky.symbol} and ${stable.symbol}. Both lines are pinned to the router's own settlement branch, read on chain: the position stops rising at ${anchors ? formatChartNumber(anchors.cap, { significantDigits: 8 }) : 'its cap'} ${stable.symbol}, which is where a taker assigns it.`}
        margin={MARGIN}
        panelId={panelId}
        panelLabelledBy={tabId}
        state={resolved}
        refusedMessage={refusedMessage}
        emptyMessage="no position"
        errorMessage={errorMessage ?? terminalError(settlement.error)}
        cursor={{
          positions: samplePositions,
          index,
          onIndex: setIndex,
          label: `spot at expiry, ${stable.symbol} per ${risky.symbol}`,
          valueText: readout.map((item) => `${item.label} ${item.value}`).join(', '),
        }}
      >
        {(geometry) => {
          if (!anchors) return null;

          const x = scaleLinear()
            .domain(domain)
            .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
          const y = scaleLinear()
            .domain(
              padDomain(
                [
                  Math.min(holdValue(domain[0], anchors), positionValue(domain[0], anchors)),
                  Math.max(holdValue(domain[1], anchors), positionValue(domain[1], anchors)),
                ],
                0.06,
              ),
            )
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

          /*
           * A narrow plot cannot carry three dodged labels along its top edge, and at 390px it
           * showed them as one smear that also collided with the axis unit. Below this width the
           * rules stay and the labels go: the readout above the plot already names spot, and the
           * kink dot names the cap.
           */
          const compact = geometry.inner.width < 460;

          /*
           * THE CAP IS ONLY ITS OWN MARK WHEN IT IS ITS OWN MARK.
           *
           * `cap = K + earned/x`, so on a live leg the two rules are four dollars apart on a
           * five-hundred-dollar axis: one pixel. Drawing both put two dashed rules through the same
           * column of pixels and handed `MarkerLayer` two labels that had to be dodged, and a dodged
           * label draws a leader back to its rule — which, at a top margin of 26px, runs horizontally
           * through the baseline of both labels. What shipped was `strike 2,600.00 cap 2,604.11`
           * with a rule struck through it, which reads as a rendering fault, and it was: the view
           * was asserting a distance it cannot draw.
           *
           * So the cap earns a rule and a label only when it is far enough from the strike to be a
           * separate place on the axis — a long-dated or high-vol leg, where the premium genuinely
           * is a visible width. Below that it is not lost, it is TOLD: the accent dot sits on the
           * kink and `premium +4.11` is printed beside it, in the money colour, under the same word
           * the ticket uses. Say the figure rather than drawing an invisible one.
           */
          const capIsItsOwnPlace =
            Math.abs(xFor(anchors.capSpot, domain, geometry) - xFor(anchors.strike, domain, geometry)) >=
            CAP_SEPARATION;

          /* Which side of the kink the premium label goes on, so it never leaves the plot. */
          const kinkAtRight =
            xFor(anchors.capSpot, domain, geometry) >
            geometry.inner.x +
              geometry.inner.width -
              estimateMonoTextWidth(`premium ${money(anchors.earned, 'always')}`, 12) -
              12;

          const forgonePath = polygon(forgonePoints(anchors, domain), x, y);
          const premiumPath = polygon(premiumPoints(anchors, domain), x, y);

          const markers: MarkerSpec[] = [
            {
              id: 'strike',
              value: anchors.strike,
              /* `strike`, not `K`. The ticket's own well is headed STRIKE, and a reader who has
                 seen one has seen the other; `K` is the same fact written for somebody who did not
                 need telling. */
              label: compact ? undefined : `strike ${money(anchors.strike)}`,
              stroke: 'ink-3',
              labelColor: 'ink-2',
            },
            ...(capIsItsOwnPlace
              ? [
                  {
                    id: 'cap',
                    value: anchors.capSpot,
                    label: compact ? undefined : `break-even ${money(anchors.capSpot)}`,
                    stroke: 'accent-dim' as const,
                    labelColor: 'ink' as const,
                  },
                ]
              : []),
            ...(spot !== undefined && spot > 0
              ? [
                  {
                    id: 'spot',
                    value: spot,
                    label: compact ? undefined : `${risky.symbol} now ${money(spot)}`,
                    stroke: 'ink-2' as const,
                    labelColor: 'ink-2' as const,
                    dash: 'solid' as const,
                  },
                ]
              : []),
          ];

          return (
            <>
              <Grid geometry={geometry} yScale={y} yCount={4} />
              <PlotArea geometry={geometry}>
                <Wipe geometry={geometry}>
                  {forgonePath ? (
                    <path d={forgonePath} fill={colorMix('neg', 16)} stroke="none" />
                  ) : null}
                  {/* Drawn under the lines, like the wedge: it is bounded by the hold line above the
                      strike and by the cap, and both of those are strokes that must stay readable. */}
                  {premiumPath ? (
                    <path d={premiumPath} fill={colorMix('pos', 20)} stroke="none" />
                  ) : null}
                  <CurveLine
                    points={positionPoints(anchors, domain)}
                    xScale={x}
                    yScale={y}
                    stroke="accent"
                    strokeWidth={2}
                  />
                  {/* Drawn over the position, not under it. Below the cap the two lines are the same
                      line, and a dashed rule riding on the solid one is what says so; hidden
                      underneath, the legend would advertise a series that appears a third of the way
                      across the chart. */}
                  <CurveLine
                    points={holdPoints(anchors, domain)}
                    xScale={x}
                    yScale={y}
                    stroke="ink-2"
                    strokeWidth={1.5}
                    dash="dashed"
                  />
                  {/* The kink: where holding and the position stop agreeing. */}
                  <circle
                    cx={round(x(anchors.capSpot))}
                    cy={round(y(anchors.cap))}
                    r={3.5}
                    fill={color('accent')}
                    stroke={color('bg')}
                    strokeWidth={1.5}
                  />
                  {/*
                    * The premium, printed at the point it is realised.
                    *
                    * The triangle above is `earned` tall at the strike, and `earned` is fifty-nine
                    * USDC on a position worth twenty-six thousand: three pixels on a three-hundred-
                    * pixel axis. Every honest way of drawing it is invisible, and the dishonest way —
                    * lifting the position line by the premium — would claim this instrument pays up
                    * front, which it does not. So the region is drawn where it truly is and the
                    * figure is written beside the kink, in the money colour, in the same two places
                    * and under the same word the ticket uses.
                    */}
                  {!compact ? (
                    <text
                      x={round(x(anchors.capSpot)) + (kinkAtRight ? -8 : 8)}
                      y={round(y(anchors.cap)) + 18}
                      textAnchor={kinkAtRight ? 'end' : 'start'}
                      fontFamily={FONT_STACK.mono}
                      fontSize={12}
                      fill={color('pos')}
                      stroke={color('bg')}
                      strokeWidth={4}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                      style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
                    >
                      {`premium ${money(anchors.earned, 'always')}`}
                    </text>
                  ) : null}
                  {/*
                    * The two lines, named on the lines.
                    *
                    * This is the shape of the whole instrument and it is the one thing a reader has to
                    * take away: above the corner one line keeps climbing and the other has stopped.
                    * A legend three hundred pixels up and to the left made that a lookup; a word at
                    * the end of each line makes it a glance. They sit at the right edge, where the
                    * lines are furthest apart, and they wear the same two words the readout uses.
                    */}
                  {buying ? (
                    /* A buy offer parts from holding on the LEFT, below the kink, so its names go there. */
                    <>
                      <SeriesLabel
                        x={geometry.inner.x + 4}
                        y={y(holdValue(domain[0], anchors)) - 9}
                        anchor="start"
                        tone="ink-2"
                        className={classes.fade}
                      >
                        {`just holding ${heldSymbol}`}
                      </SeriesLabel>
                      <SeriesLabel
                        x={geometry.inner.x + 4}
                        y={y(positionValue(domain[0], anchors)) + 15}
                        anchor="start"
                        tone="accent"
                        className={classes.fade}
                      >
                        with your offer
                      </SeriesLabel>
                    </>
                  ) : (
                    <>
                      <SeriesLabel
                        x={geometry.inner.x + geometry.inner.width - 4}
                        y={y(holdValue(domain[1], anchors)) + 15}
                        anchor="end"
                        tone="ink-2"
                        className={classes.fade}
                      >
                        {`just holding ${heldSymbol}`}
                      </SeriesLabel>
                      <SeriesLabel
                        x={geometry.inner.x + geometry.inner.width - 4}
                        y={y(anchors.cap) - 9}
                        anchor="end"
                        tone="accent"
                        className={classes.fade}
                      >
                        with your offer
                      </SeriesLabel>
                    </>
                  )}
                </Wipe>
              </PlotArea>
              <Axis geometry={geometry} scale={x} orientation="bottom" count={compact ? 3 : 5} />
              {/* `USDC/WETH` is the unit and not the axis. What the ticks are is the price this
                  pair might be at on the day the offer expires, which is the question the whole
                  plot answers and the one a reader was left to infer. */}
              {/* No end words on this axis. `today`/`expiry` and `all sold`/`none sold` name the two
                  ends of a range a reader travels along; the two ends of a price axis are just a
                  cheaper and a dearer price, and saying so would be filler. */}
              <AxisBand geometry={geometry}>
                {compact
                  ? `${risky.symbol} at expiry · ${stable.symbol}`
                  : `${risky.symbol} price at expiry · ${stable.symbol}`}
              </AxisBand>
              <Axis geometry={geometry} scale={y} orientation="left" count={4} />
              {/* No swatch: both lines share this axis, so a rule in one of their colours would be
                  a claim the other does not live here. */}
              <AxisName geometry={geometry} side="left" className={classes.fade}>
                {`what you end up with · ${stable.symbol}`}
              </AxisName>
              {/* 12px between labels rather than the default 8: `K 2,600.00` and `cap 2,605.68`
                  are dodged apart from rules five dollars apart, and at 8px the two figures read
                  as one string. */}
              {/* `haloColor="bg"`: `Marker` defaults its halo to `--surface`, which is the ground a
                  card gives it. The chart pane paints no background of its own, so a surface-coloured
                  halo drew a visibly lighter rectangle behind every marker label. */}
              <MarkerLayer
                geometry={geometry}
                scale={x}
                items={markers}
                labelSide="start"
                haloColor="bg"
                gap={12}
              />
              {index !== null ? (
                <Crosshair
                  geometry={geometry}
                  x={x(at)}
                  dots={[
                    {
                      id: 'hold',
                      y: y(holdValue(at, anchors)),
                      color: 'ink-2',
                    },
                    {
                      id: 'position',
                      y: y(positionValue(at, anchors)),
                      color: 'accent',
                    },
                  ]}
                  label={money(at)}
                />
              ) : null}
            </>
          );
        }}
      </Plot>
    </div>
  );
}

/** A closed path from domain points, or null when there is nothing to close. */
function polygon(
  points: readonly { x: number; y: number }[],
  x: (v: number) => number,
  y: (v: number) => number,
): string | null {
  if (points.length < 3) return null;
  return `M${points.map((p) => `${round(x(p.x))},${round(y(p.y))}`).join('L')}Z`;
}

/** Where a domain value lands in px, without building the scale twice. */
function xFor(value: number, domain: readonly [number, number], geometry: ChartGeometry): number {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  return geometry.inner.x + (geometry.inner.width * (value - lo)) / span;
}

/** Money reads to the cent. Two places, always, so a column of them lines up. */
function money(value: number, sign: 'auto' | 'always' = 'auto'): string {
  return formatChartNumber(value, {
    significantDigits: 18,
    minFractionDigits: 2,
    maxFractionDigits: 2,
    sign,
  });
}

/**
 * The five figures, at one spot. Same shape whether the cursor is down or resting.
 *
 * The last two name the two shaded regions, so every colour on the plot has a number beside it and
 * neither region is a mood. Since the legend row is gone, this IS the legend for them — and a
 * better one, because a swatch says a region exists and a figure says what it is worth. `premium` is a property of the offer rather than of the pointer — the
 * same `earned` the ticket prints under the same word, from the same `stableFor` — and `given up`
 * is what the red wedge is worth at this spot, which is zero everywhere below the cap.
 *
 * It used to read `vs hold`, which is `position - hold` and is the same quantity negated. That was
 * a worse name for two reasons: it printed `+0.00` at rest, three hundred pixels from the ticket's
 * `Premium +59.08`, so the product's headline benefit appeared to be nothing and its cost appeared
 * to be the only thing on the chart; and it named neither of the two regions actually drawn.
 */
function readoutAt(at: number, a: PayoffAnchors, riskySymbol: string): ReadoutItem[] {
  const position = positionValue(at, a);
  const hold = holdValue(at, a);
  return [
    { label: `${riskySymbol} price at expiry`, value: money(at) },
    { label: 'with your offer', value: money(position), tone: 'accent' },
    // The same words written on the two lines themselves. One mark, one name.
    { label: 'just holding', value: money(hold), tone: 'ink-2' },
    { label: 'premium', value: money(a.earned, 'always'), tone: 'pos' },
  ];
}
