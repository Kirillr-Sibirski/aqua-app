'use client';

/**
 * The chart, and it is the whole left half of the app.
 *
 * Three views behind one control, all sampled from the chain: what the position is worth at expiry
 * against holding, where the leg's curve is right now, and how the band widens if nobody trades.
 * Options justify a real chart; this is one.
 *
 * Each view owns its own reads and its own cursor, and only the mounted one is enabled — one
 * multicall per view, not one per pixel and not four in the background. Switching back to a view
 * that has already been sampled is served from the query cache, so the segmented control is
 * instant after the first visit.
 *
 * What is NOT here: any option maths. Every curve value on screen comes back from
 * `StrikelineViews.stableFor` or `StrikelineViews.bandFor`, and the payoff view's two lines are
 * pinned to the router's own settlement branch. There is no `Phi` in TypeScript in this app, and a
 * chart is exactly where one would otherwise creep in.
 */
import { useCallback, useId, useState } from 'react';
import { cn } from '@/lib/ui/cn';
import { CurveView } from './CurveView';
import { DecayView } from './DecayView';
import { PayoffView } from './PayoffView';
import { Segmented } from './chrome';
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
  defaultView = 'payoff',
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
  const control = (
    <Segmented value={active} onChange={change} panelId={panelId} idPrefix={idPrefix} />
  );

  const shared = {
    control,
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
     * own axis margins inset the marks, but the strip above them has no margins of its own, so it
     * carries the padding here. A page that wants a different gutter passes it in `className`,
     * which lands last.
     */
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col px-3 py-2', className)}>
      {active === 'payoff' ? <PayoffView {...shared} spot={spot} /> : null}
      {active === 'curve' ? <CurveView {...shared} /> : null}
      {active === 'decay' ? <DecayView {...shared} nowSeconds={nowSeconds} /> : null}
    </div>
  );
}
