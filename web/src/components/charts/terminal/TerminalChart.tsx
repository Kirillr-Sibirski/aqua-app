'use client';

/**
 * The chart, and it is the whole left half of the app.
 *
 * Three views behind one control, all sampled from the chain: what a taker has to pay for the wait,
 * what the position is worth at expiry against holding, and where the leg's curve is right now.
 * Options justify a real chart; this is one.
 *
 * Each view owns its own reads and its own cursor, and only the mounted one is enabled — one
 * multicall per view, not one per pixel and not four in the background. Switching back to a view
 * that has already been sampled is served from the query cache, so the segmented control is
 * instant after the first visit.
 *
 * THE HEADER IS RENDERED HERE, not inside the views, and that is load-bearing rather than tidy.
 * The three views are three sibling slots below, so a switch unmounts one subtree and mounts
 * another; anything inside a view is therefore rebuilt from nothing on every switch. The selected
 * pill in the segmented control slides between tabs, the caption cross-fades, and neither can
 * happen on an element that has just been mounted. Keeping row one above the switch is what makes
 * the control feel like one object with three positions instead of three buttons.
 *
 * What is NOT here: any option maths. Every curve value on screen comes back from
 * `StrikelineViews.stableFor` or `StrikelineViews.bandFor`, and the payoff view's two lines are
 * pinned to the router's own settlement branch. There is no `Phi` in TypeScript in this app, and a
 * chart is exactly where one would otherwise creep in.
 */
import { useCallback, useId, useState } from 'react';
import { cn } from '@/lib/ui/cn';
import classes from './chart.module.css';
import { ChartHeader, Segmented } from './chrome';
import { PayoffView } from './PayoffView';
import { PremiumView } from './PremiumView';
import { PriceView } from './PriceView';
import type { TerminalChartProps, TerminalView } from './types';

export function TerminalChart({
  router,
  chainId,
  leg,
  risky,
  stable,
  spot,
  nowSeconds,
  view,
  defaultView = 'premium',
  onViewChange,
  state = 'ready',
  errorMessage,
  refusedMessage,
  className,
}: TerminalChartProps) {
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [own, setOwn] = useState<TerminalView>(defaultView);
  const active = view ?? own;

  const change = useCallback(
    (next: TerminalView) => {
      if (view === undefined) setOwn(next);
      onViewChange?.(next);
    },
    [view, onViewChange],
  );

  const panelId = `${idPrefix}-panel`;

  const shared = {
    panelId,
    tabId: `${idPrefix}-tab-${active}`,
    router,
    chainId,
    leg,
    risky,
    stable,
    /* A refusal outranks everything the views could say about their own reads: the leg the router
       priced is real, but it describes an offer the ticket will not publish. */
    state: refusedMessage ? ('refused' as const) : state,
    errorMessage,
    refusedMessage,
  };

  return (
    /*
     * The gutter belongs to the chart, not to the page.
     *
     * A pane that hands this component its full width leaves the readout's first label sitting on
     * the viewport edge, and at 390px the leading character of `spot` was clipped by it. The plot's
     * own axis margins inset the marks, but the rows above them have no margins of their own, so
     * they carry the padding here. A page that wants a different gutter passes it in `className`,
     * which lands last.
     */
    /* `classes.chart` carries the two durations the marks animate on; they cascade into every
       SVG below rather than being written at each `animation` shorthand. */
    <div className={cn(classes.chart, 'flex h-full min-h-0 min-w-0 flex-col gap-2 px-3 py-2', className)}>
      <ChartHeader
        view={active}
        risky={risky.symbol}
        stable={stable.symbol}
        side={leg?.side}
        control={
          <Segmented value={active} onChange={change} panelId={panelId} idPrefix={idPrefix} />
        }
      />
      {active === 'payoff' ? <PayoffView {...shared} spot={spot} /> : null}
      {active === 'price' ? <PriceView {...shared} spot={spot} /> : null}
      {active === 'premium' ? <PremiumView {...shared} nowSeconds={nowSeconds} /> : null}
    </div>
  );
}
