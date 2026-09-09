/**
 * The terminal chart: one component, three chain-sampled views, and the types a page needs to mount
 * it in a flexible-height region.
 *
 * Everything else in this directory is an implementation detail. A page hands `<TerminalChart>` a
 * router, a leg and the two tokens; the component does its own reads.
 */
export { TerminalChart } from './TerminalChart';
export { TERMINAL_VIEWS, TERMINAL_VIEW_LABEL } from './types';
export type {
  TerminalChartProps,
  TerminalLeg,
  TerminalState,
  TerminalToken,
  TerminalView,
} from './types';

/** The pure payoff arithmetic, exported for the tests that pin it and for a page that wants the
 *  same figures in text. Every input is a chain read; see the module header. */
export {
  holdValue,
  payoffAnchors,
  payoffDomain,
  positionValue,
  wadToNumber,
} from './payoff';
export type { PayoffAnchors, PayoffInputs } from './payoff';

export { decayGrid, snapAnchor } from './decay';
export type { DecayGridPoint } from './decay';
