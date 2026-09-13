'use client';

/**
 * PREMIUM — what a taker has to pay you, growing every day nobody takes it.
 *
 * A leg's reserves sit exactly on its curve the moment it is published. Time then moves the curve
 * away from them, in both directions at once, and a trade only clears once it is big enough to
 * close that distance. So the distance IS the premium: whoever crosses it hands it to the maker,
 * and nothing was signed to open it. This view is that distance, read from `bandFor` at one
 * synthetic maturity per point — "the same leg, with that much less time left".
 *
 * The tab used to read `decay`, which is the mechanism and not the subject. `bandFor` measures a
 * band; what the band IS, to the person writing the offer, is income. The note behind the ⓘ leads
 * with `time decay` for a reader who wants the term.
 *
 * ONE SERIES, ONE AXIS. The gap can be closed from either side, in either token, and this view
 * used to draw both on two y-axes. They trace the same path — one gap quoted in two currencies — so
 * the second line added a scale to read and nothing to learn. It now draws only what a buyer pays
 * the maker, in the stable, against the days since the offer was posted. The axis starts at zero
 * because on the price view's scale the band is a fraction of a pixel.
 */
import { useState } from 'react';
import { scaleLinear } from 'd3-scale';
import type { Address } from 'viem';
import type { SupportedChainId } from '@/lib/chain';
import { formatTenor } from '@/lib/ui/format';
import { Axis } from '../Axis';
import { AreaFill } from '../AreaFill';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { formatChartNumber, formatChartToken } from '../format';
import type { ChartGeometry, ChartPoint } from '../types';
import { tokenFractionDigits } from '@/components/token';
import classes from './chart.module.css';
import { Crosshair } from './Crosshair';
import { Readout, type ReadoutItem } from './chrome';
import { terminalError } from './errors';
import { AxisBand, AxisName, Wipe } from './Marks';
import { Plot, PlotArea } from './Plot';
import { useDecayBand, type DecayPoint } from './useDecayBand';
import type { TerminalLeg, TerminalState, TerminalToken } from './types';

export interface PremiumViewProps {
  panelId: string;
  tabId: string;
  router?: Address;
  chainId?: SupportedChainId;
  leg?: TerminalLeg;
  risky: TerminalToken;
  stable: TerminalToken;
  nowSeconds?: number;
  state: TerminalState;
  errorMessage?: string;
  refusedMessage?: string;
}

/** The bottom carries the axis band — `today`, `days since you posted`, `expiry` — below the ticks. */
const MARGIN = { top: 26, right: 24, bottom: 42, left: 58 };

/** Points across the remaining life. Each is one `eth_call` inside one multicall. */
const BAND_SAMPLES = 25;

/** Below this the axis names lose their verb and keep the noun; the plot is too narrow for both. */
const COMPACT_WIDTH = 460;

export function PremiumView({
  panelId,
  tabId,
  router,
  chainId,
  leg,
  risky,
  stable,
  nowSeconds,
  state,
  errorMessage,
  refusedMessage,
}: PremiumViewProps) {
  const [index, setIndex] = useState<number | null>(null);

  const band = useDecayBand({
    router,
    chainId,
    strikeWad: leg?.strikeWad,
    sigmaWad: leg?.sigmaWad,
    liquidityWad: leg?.liquidityWad,
    maturity: leg?.maturity,
    xWad: leg?.xWad,
    yWad: leg?.yWad,
    nowSeconds,
    samples: BAND_SAMPLES,
    enabled: !!leg && state === 'ready',
  });

  const points = band.points;

  /*
   * Which side closes the gap is which side the offer faces. A sell offer is crossed by a buyer who
   * brings the stable; a buy offer is crossed by a seller who brings the risky, so its premium is
   * counted in the risky token, the token the positions strip already reports it earning in.
   */
  const buying = leg?.side === 'buy';
  const unit = buying ? risky : stable;
  const valueOf = (p: DecayPoint) => (buying ? p.risky : p.stable);
  const who = buying ? 'a seller gives you' : 'a buyer pays you';

  let resolved: TerminalState = state;
  if (state === 'ready') {
    if (!leg) resolved = 'empty';
    else if (band.error) resolved = 'error';
    else if (points.length >= 2) resolved = 'ready';
    else if (band.isLoading) resolved = 'loading';
    else resolved = 'empty';
  }

  /** With no cursor the readout stands at expiry — the end of the wait, and the largest figure. */
  const shown: DecayPoint | null =
    points.length === 0
      ? null
      : index === null
        ? points[points.length - 1]
        : points[Math.min(index, points.length - 1)];

  /*
   * The readout is TERSE, and that is a correction rather than a preference.
   *
   * It used to spell `a buyer brings, USDC` — the statement the axis now carries — and the two rows
   * ended up forty pixels apart, the readout above the axis name, saying the same six words twice.
   * At 390px they were two of the four chrome rows stacked over a 280px plot. One fact gets one
   * container: the axis name is the permanent legend, in the series' own colour and dash, and this
   * row is the cursor, so it prints the token and the figure and nothing else. The tone and the
   * token's own mark are what tie an entry to its axis, which is what a legend swatch does anyway.
   */
  const readout: ReadoutItem[] =
    shown && resolved === 'ready'
      ? [
          // One tenor format in the app: `8d` here is the `8d` the ticket's expiry legend prints and
          // the `8d` in the positions row, from `formatTenor`. It used to read `after 8.69 d`.
          { label: 'after', value: formatTenor(shown.days * 86_400) },
          {
            label: unit.symbol,
            icon: unit.icon,
            // The token's own two places, and `<0.01` rather than `0.00` where the band is still
            // thinner than a cent. The series sweeps four orders of magnitude and that shape is the
            // chart's job; the readout is a figure, and this app prints a USDC figure one way.
            value: formatChartToken(valueOf(shown), tokenFractionDigits(unit.symbol), {
              sign: 'always',
            }),
            tone: 'accent',
          },
        ]
      : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Readout items={readout} />
      <Plot
        title="Premium"
        description={`The smallest trade that clears this leg, against how long nobody has taken it. The axis counts the extra ${unit.symbol} ${buying ? 'a seller must bring' : 'a buyer must pay'} the maker. Every point is a bandFor read on a leg with the same reserves and that much less time left. The reserves are held fixed: a trade in between resets the gap to nothing.`}
        margin={MARGIN}
        panelId={panelId}
        panelLabelledBy={tabId}
        state={resolved}
        refusedMessage={refusedMessage}
        emptyMessage={leg ? 'no time left' : 'no position'}
        errorMessage={errorMessage ?? terminalError(band.error)}
        cursor={{
          positions: (geometry: ChartGeometry) => {
            const x = daysScale(geometry, points);
            return points.map((p) => x(p.days));
          },
          index,
          onIndex: setIndex,
          label: 'days since you posted',
          valueText: readout.map((item) => `${item.label} ${item.value}`).join(', '),
        }}
      >
        {(geometry) => {
          if (points.length < 2) return null;

          const compact = geometry.inner.width < COMPACT_WIDTH;
          const x = daysScale(geometry, points);
          const stableMax = Math.max(...points.map(valueOf));

          const yStable = scaleLinear()
            .domain([0, (stableMax || 1) * 1.08])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

          const stablePoints: ChartPoint[] = points.map((p) => ({
            x: p.days,
            y: valueOf(p),
          }));

          return (
            <>
              <Grid geometry={geometry} yScale={yStable} yCount={4} />
              <PlotArea geometry={geometry}>
                <Wipe geometry={geometry}>
                  <AreaFill
                    points={stablePoints}
                    xScale={x}
                    yScale={yStable}
                    baseline={0}
                    fill="accent"
                    tint={12}
                  />
                  <CurveLine
                    points={stablePoints}
                    xScale={x}
                    yScale={yStable}
                    stroke="accent"
                    strokeWidth={2}
                    endDot
                  />
                </Wipe>
              </PlotArea>
              <Axis
                geometry={geometry}
                scale={x}
                orientation="bottom"
                count={compact ? 3 : 5}
                format={(value) => `${formatChartNumber(Number(value), { significantDigits: 3 })}d`}
              />
              {/* The two ends of the wait, named where the axis ends rather than inside the plot.
                  `0d` and `8d` are the ticks; `today` and `expiry` are what they mean, and they are
                  why the curve starts at nothing. */}
              <AxisBand geometry={geometry} start="today" end="expiry">
                days since you posted
              </AxisBand>
              <Axis geometry={geometry} scale={yStable} orientation="left" count={4} />
              <AxisName geometry={geometry} side="left" swatch="accent" className={classes.fade}>
                {compact ? `you get · ${unit.symbol}` : `extra ${who} · ${unit.symbol}`}
              </AxisName>
              {index !== null && shown ? (
                <Crosshair
                  geometry={geometry}
                  x={x(shown.days)}
                  dots={[
                    { id: 'stable', y: yStable(valueOf(shown)), color: 'accent' },
                  ]}
                  label={formatTenor(shown.days * 86_400)}
                />
              ) : null}
            </>
          );
        }}
      </Plot>
    </div>
  );
}

/** Days of waiting, zero to the tau floor. */
function daysScale(geometry: ChartGeometry, points: readonly DecayPoint[]) {
  const end = points.length ? points[points.length - 1].days : 1;
  return scaleLinear()
    .domain([0, end || 1])
    .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
}
