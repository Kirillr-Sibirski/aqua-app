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
import { useState, type ReactNode } from 'react';
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
import { Crosshair, UnitTag } from './Crosshair';
import { Strip, type LegendItem, type ReadoutItem } from './chrome';
import { terminalError } from './errors';
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
  control: ReactNode;
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
const MARGIN = { top: 24, right: 14, bottom: 42, left: 58 };

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
  control,
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
  const readout: ReadoutItem[] = anchors && resolved === 'ready' ? readoutAt(at, anchors) : [];

  /* A legend names the marks on the plot. With nothing drawn there are no marks, so a refusal or an
     error would otherwise advertise a series that is not there. Loading keeps it: the marks are
     about to exist and the strip should not reflow when they arrive. */
  const legend: LegendItem[] =
    resolved !== 'ready' && resolved !== 'loading'
      ? []
      : [
          { id: 'position', color: 'accent' },
          { id: 'hold', color: 'ink-2', dash: 'dashed' },
          { id: 'premium', color: 'pos', kind: 'area' },
          { id: 'given up', color: 'neg', kind: 'area' },
        ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Strip control={control} legend={legend} readout={readout} />
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
            .domain(padDomain([holdValue(domain[0], anchors), holdValue(domain[1], anchors)], 0.06))
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

          /*
           * A narrow plot cannot carry three dodged labels along its top edge, and at 390px it
           * showed them as one smear that also collided with the axis unit. Below this width the
           * rules stay and the labels go: the readout above the plot already names spot, and the
           * kink dot names the cap.
           */
          const compact = geometry.inner.width < 460;

          /*
           * The strike and the cap are a few dollars apart on a leg this cheap, and the gap between
           * them IS the premium: `cap = K + earned/x`, which is the one place on this plot where
           * the number the ticket prints is a visible distance rather than an invisible area.
           *
           * So both labels stay. They used to collide, and the fix was to drop the strike's — which
           * left one labelled rule and an unlabelled twin beside it, and took the premium off the
           * picture entirely. `MarkerLayer` already slides overlapping labels apart and draws a
           * leader from each back to its own rule; letting it do that is the whole fix.
           */
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
              label: compact ? undefined : `K ${money(anchors.strike)}`,
              stroke: 'ink-3',
              labelColor: 'ink-2',
            },
            {
              id: 'cap',
              value: anchors.capSpot,
              label: compact ? undefined : `cap ${money(anchors.capSpot)}`,
              stroke: 'accent-dim',
              labelColor: 'ink',
            },
            ...(spot !== undefined && spot > 0
              ? [
                  {
                    id: 'spot',
                    value: spot,
                    label: compact ? undefined : `spot ${money(spot)}`,
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
                  stroke={color('surface')}
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
              </PlotArea>
              <Axis geometry={geometry} scale={x} orientation="bottom" count={compact ? 3 : 5} />
              <UnitTag geometry={geometry}>{`${stable.symbol}/${risky.symbol}`}</UnitTag>
              <Axis
                geometry={geometry}
                scale={y}
                orientation="left"
                count={4}
                label={stable.symbol}
              />
              {/* 12px between labels rather than the default 8: `K 2,600.00` and `cap 2,605.68`
                  are dodged apart from rules five dollars apart, and at 8px the two figures read
                  as one string. */}
              <MarkerLayer geometry={geometry} scale={x} items={markers} labelSide="start" gap={12} />
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
 * neither region is a mood. `premium` is a property of the offer rather than of the pointer — the
 * same `earned` the ticket prints under the same word, from the same `stableFor` — and `given up`
 * is what the red wedge is worth at this spot, which is zero everywhere below the cap.
 *
 * It used to read `vs hold`, which is `position - hold` and is the same quantity negated. That was
 * a worse name for two reasons: it printed `+0.00` at rest, three hundred pixels from the ticket's
 * `Premium +59.08`, so the product's headline benefit appeared to be nothing and its cost appeared
 * to be the only thing on the chart; and it named neither of the two regions actually drawn.
 */
function readoutAt(at: number, a: PayoffAnchors): ReadoutItem[] {
  const position = positionValue(at, a);
  const hold = holdValue(at, a);
  const givenUp = Math.max(0, hold - position);
  return [
    { label: 'spot', value: money(at) },
    { label: 'position', value: money(position), tone: 'accent' },
    { label: 'hold', value: money(hold), tone: 'ink-2' },
    { label: 'premium', value: money(a.earned, 'always'), tone: 'pos' },
    {
      label: 'given up',
      value: money(givenUp),
      tone: givenUp > 0 ? 'neg' : 'ink-2',
    },
  ];
}
