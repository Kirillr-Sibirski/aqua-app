'use client';

/**
 * The picture the whole page exists for: what the same money was worth, four ways, over the same week.
 *
 * Four series, and the reader can read them two ways. **What each was worth** draws the marks as they
 * stand, which is the honest default — it shows that all four spent the week doing roughly the same
 * thing, because they are all mostly long the same ETH. **Difference from holding** subtracts the hold
 * line from the other three, which is the question actually being asked and the only view in which a two
 * hundred dollar gap on a fifty thousand dollar book is visible at all.
 *
 * The y axis does not start at zero in either mode and the caption says so. Starting a $49,600-$51,000
 * range at zero would render every difference in this study as one flat line, which would be a more
 * misleading chart, not a more honest one.
 */
import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { Axis } from '@/components/charts/Axis';
import { ChartFrame, PlotArea } from '@/components/charts/ChartFrame';
import { CurveLine } from '@/components/charts/CurveLine';
import { Grid } from '@/components/charts/Grid';
import { formatChartNumber } from '@/components/charts/format';
import { padDomain, finiteExtent } from '@/components/charts/geometry';
import type { ChartPoint, ColorToken, DashStyle } from '@/components/charts/types';
import {
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { dailyRowIndices, daysFrom, difference, toDollars, usd, type Replay } from './replay';

type Mode = 'value' | 'versus';

const MARGIN = { top: 14, right: 18, bottom: 34, left: 74 };

interface SeriesSpec {
  key: string;
  /** What it is, in the words the rest of the page uses. */
  label: string;
  stroke: ColorToken;
  dash: DashStyle;
  strokeWidth: number;
  micro: readonly number[];
}

export interface PathChartProps {
  replay: Replay;
  height?: number;
}

export function PathChart({ replay, height = 340 }: PathChartProps) {
  const [mode, setMode] = useState<Mode>('value');
  const s = replay.series;

  const days = useMemo(() => daysFrom(s), [s]);

  const specs = useMemo<SeriesSpec[]>(() => {
    const hold = s.hodl6;
    const value: SeriesSpec[] = [
      {
        key: 'strikeline',
        label: 'This book',
        stroke: 'accent',
        dash: 'solid',
        strokeWidth: 2,
        micro: s.strikeline6,
      },
      {
        key: 'hodl',
        label: 'Just holding',
        stroke: 'ink-2',
        dash: 'dashed',
        strokeWidth: 1.5,
        micro: hold,
      },
      {
        key: 'cpLow',
        label: `Pool, ${replay.cpFeeLowBps} bp fee`,
        stroke: 'ink-3',
        dash: 'solid',
        strokeWidth: 1.5,
        micro: s.cpLow6,
      },
      {
        key: 'cpHigh',
        label: `Pool, ${replay.cpFeeHighBps} bp fee`,
        stroke: 'ink-3',
        dash: 'dotted',
        strokeWidth: 1.5,
        micro: s.cpHigh6,
      },
    ];
    if (mode === 'value') return value;
    return value
      .filter((spec) => spec.key !== 'hodl')
      .map((spec) => ({ ...spec, micro: difference(spec.micro, hold) }));
  }, [mode, replay.cpFeeHighBps, replay.cpFeeLowBps, s]);

  const lines = useMemo(
    () =>
      specs.map((spec) => ({
        spec,
        points: spec.micro.map<ChartPoint>((micro, i) => ({ x: days[i], y: toDollars(micro) })),
      })),
    [days, specs],
  );

  const yDomain = useMemo(() => {
    const all = lines.flatMap((line) => line.points);
    const extent = finiteExtent(all) ?? [0, 1];
    // 6% of headroom, and in `versus` mode the zero rule is always inside the frame, because "did it
    // beat holding" is unreadable if the reader cannot see where zero is.
    const padded = padDomain(extent, 0.06);
    return mode === 'versus'
      ? ([Math.min(0, padded[0]), Math.max(0, padded[1])] as const)
      : padded;
  }, [lines, mode]);

  const lastDay = days[days.length - 1] ?? 0;

  return (
    <ChartFrame
      title="What the same money was worth"
      description={
        mode === 'value'
          ? `Simulated mark of four strategies on identical capital over ${lastDay.toFixed(1)} days of real Base ETH prices: this option book, holding the coins untouched, and a constant-product position at ${replay.cpFeeLowBps} and ${replay.cpFeeHighBps} basis points. The vertical axis runs from ${formatChartNumber(yDomain[0])} to ${formatChartNumber(yDomain[1])} US dollars and does not start at zero.`
          : `The same simulation, with the value of simply holding subtracted from each of the other three, so a difference of a few hundred dollars on a fifty thousand dollar book is visible. Above the zero rule beats holding, below it loses to holding. The vertical axis runs from ${formatChartNumber(yDomain[0])} to ${formatChartNumber(yDomain[1])} US dollars.`
      }
      subtitle="Simulation on a replayed price tape. Not a track record."
      height={height}
      margin={MARGIN}
      legend={<Legend specs={specs} />}
      actions={
        <SegmentedControl
          label="View"
          size="sm"
          items={[
            { value: 'value', label: 'What each was worth' },
            { value: 'versus', label: 'Difference from holding' },
          ]}
          value={mode}
          onValueChange={(next) => setMode(next as Mode)}
        />
      }
      footnote={
        <>
          All four start at the same mark, {usd(replay.totals.start6)}, because the pool is opened with
          the same capital split the way a constant-product position requires. The vertical axis does not
          start at zero. Every point is a value the replay recorded on chain, roughly hourly; the replay
          itself steps on all {replay.tape.rounds.toLocaleString('en-US')} price rounds in the window.
        </>
      }
      table={<ValuesTable replay={replay} days={days} />}
      tableLabel="the daily marks"
    >
      {(geometry) => {
        const x = scaleLinear()
          .domain([0, lastDay || 1])
          .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain([yDomain[0], yDomain[1]])
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

        return (
          <>
            <Grid geometry={geometry} yScale={y} xScale={x} lines="both" zeroRule={mode === 'versus'} />
            <PlotArea geometry={geometry}>
              {lines.map((line) => (
                <CurveLine
                  key={line.spec.key}
                  points={line.points}
                  xScale={x}
                  yScale={y}
                  stroke={line.spec.stroke}
                  strokeWidth={line.spec.strokeWidth}
                  dash={line.spec.dash}
                  endDot={line.spec.key === 'strikeline'}
                />
              ))}
            </PlotArea>
            <Axis
              geometry={geometry}
              scale={x}
              orientation="bottom"
              count={7}
              format={(value) => `${formatChartNumber(Number(value), { significantDigits: 2 })}d`}
              label="days"
            />
            <Axis
              geometry={geometry}
              scale={y}
              orientation="left"
              count={5}
              format={(value) => formatChartNumber(Number(value), { significantDigits: 6 })}
              label="USD"
            />
          </>
        );
      }}
    </ChartFrame>
  );
}

/**
 * Named inline beside the caption, never a centred block under the plot. Each entry carries its own
 * stroke treatment as a swatch, so the four series are told apart by dash pattern as well as by hue.
 */
function Legend({ specs }: { specs: readonly SeriesSpec[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {specs.map((spec) => (
        <span key={spec.key} className="flex items-center gap-1.5 text-mini text-ink-2">
          <svg width={18} height={8} aria-hidden="true" className="shrink-0">
            <line
              x1={0}
              y1={4}
              x2={18}
              y2={4}
              stroke={`var(--${spec.stroke})`}
              strokeWidth={spec.strokeWidth}
              strokeDasharray={
                spec.dash === 'dashed' ? '5 3.5' : spec.dash === 'dotted' ? '0 3.6' : undefined
              }
              strokeLinecap={spec.dash === 'dotted' ? 'round' : 'butt'}
            />
          </svg>
          {spec.label}
        </span>
      ))}
    </span>
  );
}

/** The chart's accessible twin: one row per day, the same numbers the picture draws. */
function ValuesTable({ replay, days }: { replay: Replay; days: readonly number[] }) {
  const s = replay.series;
  const rows = dailyRowIndices(s);
  const last = days.length - 1;

  return (
    <Table caption="Simulated mark of each strategy, one row per day">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Day</TableHeaderCell>
          <TableHeaderCell numeric>ETH price</TableHeaderCell>
          <TableHeaderCell numeric>This book</TableHeaderCell>
          <TableHeaderCell numeric>Just holding</TableHeaderCell>
          <TableHeaderCell numeric>{replay.cpFeeLowBps} bp pool</TableHeaderCell>
          <TableHeaderCell numeric>{replay.cpFeeHighBps} bp pool</TableHeaderCell>
          <TableHeaderCell numeric>Fills</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((i) => (
          <TableRow key={i}>
            <TableCell>{i === last ? 'end' : `${Math.round(days[i])}`}</TableCell>
            <TableCell numeric>{usd(s.spot6[i])}</TableCell>
            <TableCell numeric>{usd(s.strikeline6[i])}</TableCell>
            <TableCell numeric>{usd(s.hodl6[i])}</TableCell>
            <TableCell numeric>{usd(s.cpLow6[i])}</TableCell>
            <TableCell numeric>{usd(s.cpHigh6[i])}</TableCell>
            <TableCell numeric>{s.fills[i]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
