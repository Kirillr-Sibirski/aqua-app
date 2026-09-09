/**
 * The public shape of `<TerminalChart>`.
 *
 * The chart is deliberately self-sufficient: hand it the six numbers that define a leg and it does
 * its own reads. Nothing here takes a series of points, because a series of points computed in
 * TypeScript is exactly the thing this app does not have — every curve value on screen is a
 * `stableFor`, a `bandFor` or a `quote` from the router, and the component samples them itself so a
 * call site cannot accidentally hand it a model.
 *
 * The one number that is NOT a leg parameter is `spot`. It comes from the Chainlink feed and is
 * used for two things only: the marker on the payoff axis, and centring that axis. It never enters
 * a curve value.
 */
import type { ReactNode } from 'react';
import type { Address } from 'viem';
import type { SupportedChainId } from '@/lib/chain';

/** The three views behind the segmented control. */
export type TerminalView = 'payoff' | 'curve' | 'decay';

/** Order of the segmented control, and the order the arrow keys walk. */
export const TERMINAL_VIEWS = ['payoff', 'curve', 'decay'] as const satisfies readonly TerminalView[];

/** One-word labels. A segmented control is not the place for a sentence. */
export const TERMINAL_VIEW_LABEL: Record<TerminalView, string> = {
  payoff: 'payoff',
  curve: 'curve',
  decay: 'decay',
};

/**
 * A token as the chart needs to name it: a symbol for the axis, and the mark that goes beside it.
 *
 * `icon` is a slot rather than a drawing. The page owns the token art — it is the same 20px mark
 * that appears in the ticket and in the positions rows — and a chart that drew its own would be a
 * second, subtly different set of glyphs on one screen.
 */
export interface TerminalToken {
  symbol: string;
  /** ERC-20 decimals. Used to round a readout to a real unit rather than to 18 places. */
  decimals: number;
  /** 12-16px mark, rendered inline before the symbol in the legend. */
  icon?: ReactNode;
}

/**
 * A leg, as the router parses it, plus where its reserves currently sit.
 *
 * `xWad`/`yWad` are the reserve point: `x` is what the maker put on offer and `y` is what
 * `stableFor` said the curve requires there. Both are normalised WAD, which is the space every
 * `StrikelineViews` argument lives in — not raw token units.
 */
export interface TerminalLeg {
  /** `K`, WAD, normalised stable per risky. */
  strikeWad: bigint;
  /** Annualised implied volatility, WAD. `0.6e18` is 60%. */
  sigmaWad: bigint;
  /** Unix seconds. */
  maturity: number;
  /** `L`, WAD, in risky units. */
  liquidityWad: bigint;
  /** Risky reserve, WAD. */
  xWad: bigint;
  /** Stable reserve, WAD, from `stableFor`. */
  yWad: bigint;
}

/**
 * The five states a data surface ships.
 *
 * `empty` means there is no leg to draw yet. `refused` is the one that is not about a read: the
 * ticket has rejected what was typed, so the leg the router priced describes a configuration that
 * cannot be published, and drawing it would be a picture of an offer nobody can make. It exists
 * because the chart used to plot a strike of 1 against a spot of 2,442 — four identical `10.4M`
 * gridline labels, a cap annotation colliding with the axis title, a readout of ten million — while
 * the ticket beside it correctly refused with `Strike below spot`. Refuse rather than lie.
 */
export type TerminalState = 'ready' | 'loading' | 'empty' | 'error' | 'refused';

export interface TerminalChartProps {
  /** The Strikeline router. `StrikelineViews` is a mixin on it, not a separate contract. */
  router?: Address;
  chainId?: SupportedChainId;
  /** The leg being drafted or held. Absent means the empty state. */
  leg?: TerminalLeg;
  risky: TerminalToken;
  stable: TerminalToken;
  /** Spot from the price feed, stable per risky. Marks the payoff axis; never priced against. */
  spot?: number;
  /** The chain's clock, seconds, from the watched block. The decay grid is anchored on it. */
  nowSeconds?: number;
  /** Controlled view. Leave unset and the chart owns its own. */
  view?: TerminalView;
  defaultView?: TerminalView;
  onViewChange?: (view: TerminalView) => void;
  /**
   * The caller's own state. `loading` while the ticket is still pricing the leg; `error` with
   * `errorMessage` when its read refused; `refused` when the ticket has rejected the input. The
   * chart adds its own reads' states on top, and never overrides a state the caller set.
   */
  state?: TerminalState;
  /** A decoded custom error name from the caller's read. Never a raw hex blob. */
  errorMessage?: string;
  /**
   * Why the ticket is refusing what was typed, in two or three words — the same string the publish
   * button is wearing. Set it and every view draws nothing but that word.
   */
  refusedMessage?: string;
  className?: string;
}
