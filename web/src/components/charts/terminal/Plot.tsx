'use client';

/**
 * The measured box every terminal view draws into.
 *
 * It differs from `ChartFrame` in the one way that matters here: the region it lives in has a
 * flexible height, so it measures BOTH dimensions and hands the view a geometry that fills whatever
 * the page gave it. A fixed-height frame in a `1fr` grid row either leaves a band of dead surface
 * under the plot or overflows it; neither is acceptable on a screen that is the whole app.
 *
 * It also owns the cursor. Pointer and keyboard drive the same index into the same array of sample
 * positions, so the readout a mouse produces and the readout a keyboard produces are the same
 * readout, and the view stays declarative: it is handed an index and draws.
 *
 * SSR: nothing is drawn until a `ResizeObserver` has reported a size, and the effect that observes
 * is the layout one only in a browser. On the server the component renders its own skeleton, which
 * is what the client renders first as well, so hydration matches.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/ui/cn';
import { makeGeometry, nearestIndex, resolveMargin } from '../geometry';
import type { ChartGeometry, ChartMargin } from '../types';
import type { TerminalState } from './types';

/** `useLayoutEffect` warns during SSR; the effect only ever needs to run in a browser. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** `useId` returns characters that are awkward inside `url(#...)`. */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * What the view hands the plot so pointer and keyboard can address the same samples.
 *
 * `positions` is a function of the geometry rather than an array, because the geometry is the thing
 * the plot has just measured: the view cannot know where its samples land in pixels until the box
 * has a width. Everything else is index arithmetic and needs no measurement.
 */
export interface PlotCursor {
  /** x position of every sample, in px, ascending, given the measured geometry. */
  positions: (geometry: ChartGeometry) => readonly number[];
  index: number | null;
  onIndex: (index: number | null) => void;
  /** Names the cursor for assistive technology, e.g. `'spot at expiry'`. */
  label: string;
  /** The whole readout as one string, announced on every move. */
  valueText?: string;
}

export interface PlotProps {
  /** The SVG's accessible name. Two or three words. */
  title: string;
  /** One sentence naming the marks and their units. Never rendered on screen. */
  description: string;
  margin?: Partial<ChartMargin>;
  /** Floor for the measured height, so a collapsed row still draws something sane. */
  minHeight?: number;
  state?: TerminalState;
  /** Two words. Shown when there is nothing to draw. */
  emptyMessage?: string;
  /** The decoded custom error name, with its arguments. Never a raw hex blob. */
  errorMessage?: string;
  cursor?: PlotCursor;
  /** `id` for the box, so the segmented control above it can point a `tabpanel` relation at it. */
  panelId?: string;
  /** `id` of the tab that selects this panel. */
  panelLabelledBy?: string;
  /** HTML drawn over the plot, positioned by the view. */
  overlay?: (geometry: ChartGeometry) => ReactNode;
  className?: string;
  children: (geometry: ChartGeometry) => ReactNode;
}

export function Plot({
  title,
  description,
  margin,
  minHeight = 180,
  state = 'ready',
  emptyMessage = 'no position',
  errorMessage,
  cursor,
  panelId,
  panelLabelledBy,
  overlay,
  className,
  children,
}: PlotProps) {
  const id = safeId(useId());
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const apply = useCallback((width: number, height: number) => {
    const w = Math.round(width);
    const h = Math.round(height);
    setSize((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  }, []);

  useIsomorphicLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    apply(rect.width, rect.height);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [apply]);

  const resolved = resolveMargin(margin);
  const geometry =
    size === null || size.width <= 0
      ? null
      : makeGeometry(size.width, Math.max(minHeight, size.height), resolved, `${id}-clip`);

  // Sample positions need the measured box, so they are resolved here rather than by the caller.
  const positions = geometry && cursor ? cursor.positions(geometry) : undefined;

  /*
   * Plain functions, not `useCallback`.
   *
   * `positions` is a fresh array on every render (the geometry may have changed), so a manual
   * memoization keyed on it preserves nothing and the React Compiler refuses to optimise a
   * component that claims otherwise. The compiler memoizes these itself, and correctly.
   */
  const move = (event: ReactPointerEvent<SVGElement>) => {
    if (!cursor || !positions || positions.length === 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    // The SVG is rendered at exactly its viewBox size, so a client offset is a user unit.
    const x = event.clientX - svg.getBoundingClientRect().left;
    const next = nearestIndex(positions, x);
    if (next !== cursor.index) cursor.onIndex(next);
  };

  const keys = (event: KeyboardEvent<SVGElement>) => {
    if (!cursor || !positions || positions.length === 0) return;
    const last = positions.length - 1;
    const from = cursor.index ?? Math.round(last / 2);
    const step = event.shiftKey ? Math.max(1, Math.round(last / 10)) : 1;

    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(last, from + step);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, from - step);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Escape') {
      if (cursor.index !== null) {
        event.preventDefault();
        cursor.onIndex(null);
      }
      return;
    } else return;

    event.preventDefault();
    cursor.onIndex(next);
  };

  const interactive = !!cursor && state === 'ready';

  return (
    <div
      ref={boxRef}
      id={panelId}
      role={panelId ? 'tabpanel' : undefined}
      aria-labelledby={panelLabelledBy}
      className={cn('relative min-h-0 w-full flex-1', className)}
    >
      {state === 'ready' && geometry ? (
        <>
          <svg
            ref={svgRef}
            width={geometry.width}
            height={geometry.height}
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            className="block touch-pan-y"
            role={interactive ? 'slider' : 'img'}
            tabIndex={interactive ? 0 : undefined}
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-desc`}
            aria-orientation={interactive ? 'horizontal' : undefined}
            aria-valuemin={interactive ? 0 : undefined}
            aria-valuemax={interactive ? Math.max(0, (positions?.length ?? 1) - 1) : undefined}
            aria-valuenow={interactive ? (cursor?.index ?? undefined) : undefined}
            aria-valuetext={interactive ? cursor?.valueText : undefined}
            onKeyDown={interactive ? keys : undefined}
            onPointerMove={interactive ? move : undefined}
            onPointerLeave={interactive ? () => cursor?.onIndex(null) : undefined}
            onBlur={interactive ? () => cursor?.onIndex(null) : undefined}
          >
            <title id={`${id}-title`}>{title}</title>
            <desc id={`${id}-desc`}>{description}</desc>
            <defs>
              <clipPath id={geometry.clipId}>
                {/* Inflated 2px so a series sitting exactly on the domain edge keeps its whole
                    stroke rather than losing the outer half to the clip. */}
                <rect
                  x={geometry.inner.x - 2}
                  y={geometry.inner.y - 2}
                  width={geometry.inner.width + 4}
                  height={geometry.inner.height + 4}
                />
              </clipPath>
            </defs>
            {children(geometry)}
          </svg>
          {overlay?.(geometry)}
        </>
      ) : null}

      {state === 'loading' || (state === 'ready' && !geometry) ? (
        <PlotSkeleton title={title} margin={resolved} />
      ) : null}

      {state === 'empty' ? <PlotMessage body={emptyMessage} /> : null}
      {state === 'error' ? <PlotMessage body={errorMessage ?? 'read failed'} tone="error" /> : null}
    </div>
  );
}

/**
 * A chart-shaped placeholder, not a spinner and not a word.
 *
 * The rules and the tick stubs land where the real ones will, so nothing jumps when the multicall
 * lands. The pulse carries its own `motion-reduce` branch on top of the global one in `globals.css`.
 */
function PlotSkeleton({ title, margin }: { title: string; margin: ChartMargin }) {
  return (
    <>
      <p role="status" className="sr-only">
        Loading {title}
      </p>
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-pulse motion-reduce:animate-none"
        style={{
          paddingTop: margin.top,
          paddingRight: margin.right,
          paddingBottom: margin.bottom,
          paddingLeft: margin.left,
        }}
      >
        <div className="relative h-full w-full">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <span
              key={fraction}
              className="absolute left-0 h-px w-full bg-line"
              style={{ top: `${fraction * 100}%` }}
            />
          ))}
          {[0.06, 0.31, 0.56, 0.81].map((fraction) => (
            <span
              key={fraction}
              className="absolute h-1.5 rounded-control bg-surface-2"
              style={{ top: `${fraction * 100}%`, left: -margin.left + 4, width: margin.left - 14 }}
            />
          ))}
          <span className="absolute inset-x-0 bottom-0 h-2/3 rounded-control bg-surface-2" />
        </div>
      </div>
    </>
  );
}

/** Empty and error share one layout: a glyph, two words, centred, in mono. */
function PlotMessage({ body, tone = 'neutral' }: { body: string; tone?: 'neutral' | 'error' }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p
        className={cn(
          'flex items-center gap-1.5 font-mono text-mini tnum',
          tone === 'error' ? 'text-neg' : 'text-ink-3',
        )}
      >
        {tone === 'error' ? <AlertGlyph /> : null}
        {body}
      </p>
    </div>
  );
}

/** A 12px warning triangle, so the error state does not lean on colour alone. */
function AlertGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 1.9 12.9 12.1H1.1Z" />
      <path d="M7 5.9v2.6" />
      <path d="M7 10.3h.01" />
    </svg>
  );
}

/**
 * `<g clipPath>` bound to the plot rect.
 *
 * Marks that can leave the plot go inside it — a curve heading for an asymptote, a payoff line
 * whose hold branch runs off the top — so the true geometry is drawn and then cut, rather than
 * flattened onto the frame. Axes, marker labels and the crosshair chip stay outside, because they
 * live in the margins on purpose.
 */
export function PlotArea({ geometry, children }: { geometry: ChartGeometry; children: ReactNode }) {
  return <g clipPath={`url(#${geometry.clipId})`}>{children}</g>;
}
