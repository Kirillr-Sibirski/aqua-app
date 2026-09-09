'use client';

/**
 * PAYOFF AT EXPIRY — the view a first-time visitor reads.
 *
 * Two lines. Holding the same reserves, and writing this leg against them. They are the same line
 * until spot passes the point where assignment becomes worth doing, and past it the position is
 * flat while holding keeps climbing. The wedge between them is what the maker hands over, and it is
 * shaded because it is the only thing on this screen that costs money in a state nobody chose.
 *
 * Every constant the two lines are pinned to is a chain read at a matured maturity, where the
 * router's own trading function is the closed form `Y = K*(L - X)` and no Gaussian is evaluated at
 * all. See `payoff.ts` for the derivation. There is no Black-Scholes in this file, and no `Phi`.
 */
import { useState, type ReactNode } from 'react';
import { scaleLinear } from 'd3-scale';
import type { Address } from 'viem';
import type { SupportedChainId } from '@/lib/chain';
import { color, colorMix } from '@/lib/ui/tokens';
import { Axis } from '../Axis';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { MarkerLayer, type MarkerSpec } from '../Marker';
import { padDomain } from '../geometry';
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

  const readout: ReadoutItem[] = anchors ? readoutAt(at, anchors) : [];

  const legend: LegendItem[] = [
    { id: 'position', color: 'accent' },
    { id: 'hold', color: 'ink-2', dash: 'dashed' },
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

          const forgone = forgonePoints(anchors, domain);
          const forgonePath =
            forgone.length === 3
              ? `M${forgone.map((p) => `${round(x(p.x))},${round(y(p.y))}`).join('L')}Z`
              : null;

          const markers: MarkerSpec[] = [
            {
              id: 'strike',
              value: anchors.strike,
              label: compact ? undefined : `K ${formatChartNumber(anchors.strike, { significantDigits: 6 })}`,
              stroke: 'ink-3',
              labelColor: 'ink-2',
            },
            {
              id: 'cap',
              value: anchors.capSpot,
              label: compact ? undefined : `cap ${formatChartNumber(anchors.capSpot, { significantDigits: 6 })}`,
              stroke: 'accent-dim',
              labelColor: 'ink',
            },
            ...(spot !== undefined && spot > 0
              ? [
                  {
                    id: 'spot',
                    value: spot,
                    label: compact ? undefined : `spot ${formatChartNumber(spot, { significantDigits: 6 })}`,
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
                {forgonePath ? <path d={forgonePath} fill={colorMix('neg', 16)} stroke="none" /> : null}
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
              </PlotArea>
              <Axis geometry={geometry} scale={x} orientation="bottom" count={compact ? 3 : 5} />
              <UnitTag geometry={geometry}>{`${stable.symbol}/${risky.symbol}`}</UnitTag>
              <Axis geometry={geometry} scale={y} orientation="left" count={4} label={stable.symbol} />
              <MarkerLayer geometry={geometry} scale={x} items={markers} labelSide="start" />
              {index !== null ? (
                <Crosshair
                  geometry={geometry}
                  x={x(at)}
                  dots={[
                    { id: 'hold', y: y(holdValue(at, anchors)), color: 'ink-2' },
                    { id: 'position', y: y(positionValue(at, anchors)), color: 'accent' },
                  ]}
                  label={formatChartNumber(at, { significantDigits: 6 })}
                />
              ) : null}
            </>
          );
        }}
      </Plot>
    </div>
  );
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

/** The four figures, at one spot. Same shape whether the cursor is down or resting. */
function readoutAt(at: number, a: PayoffAnchors): ReadoutItem[] {
  const position = positionValue(at, a);
  const hold = holdValue(at, a);
  const delta = position - hold;
  return [
    { label: 'spot', value: formatChartNumber(at, { significantDigits: 6, minFractionDigits: 2 }) },
    { label: 'position', value: money(position), tone: 'accent' },
    { label: 'hold', value: money(hold), tone: 'ink-2' },
    { label: 'vs hold', value: money(delta, 'always'), tone: delta < 0 ? 'neg' : 'ink-2' },
  ];
}
