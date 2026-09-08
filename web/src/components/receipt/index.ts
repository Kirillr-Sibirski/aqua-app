/**
 * The receipt: one replayed week of this book, next to holding and next to a pool.
 *
 * Everything under here is a simulation and says so. Nothing else in the app may import from this
 * directory to render a live figure.
 */
export { PathChart } from './PathChart';
export type { PathChartProps } from './PathChart';

export { TapeChart, InventoryChart } from './TapeCharts';
export type { TapeChartProps } from './TapeCharts';

export { SigmaSweepTable, WindowSweepTable } from './SweepTables';

export { ReceiptLinks } from './ReceiptLinks';

export { Head, META, Section, Signed, SimBadge, Stat } from './kit';

export {
  REPLAY,
  SIGMA_SWEEP,
  WINDOW_SWEEP,
  replayIsUsable,
  headlineOf,
  lowestSellStrike6,
  difference,
  daysFrom,
  dailyRowIndices,
  toDollars,
  usd,
  eth,
  volPercent,
  sharePercent,
} from './replay';
export type {
  Replay,
  ReplaySeries,
  ReplayTotals,
  ReplayLegs,
  ReplayTape,
  SigmaSweep,
  WindowSweep,
  Headline,
} from './replay';
