'use client';

/**
 * The container every chart in the app mounts on.
 *
 * It owns four things marks should never have to think about: the measured width (a
 * `ResizeObserver`, so a chart in a resizable rail is always drawn at its real size), the margin
 * arithmetic, the accessible name and description of the picture, and the five states a data
 * surface has to ship. Marks receive the resulting {@link ChartGeometry} and draw into it.
 *
 * `height` is the whole SVG box, axis band included, so a fixed height can never squeeze the
 * x-axis labels into their own scrollbar.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/ui/cn';
import { makeGeometry, resolveMargin } from './geometry';
import type { ChartGeometry, ChartMargin } from './types';

/** `useLayoutEffect` warns during SSR; the effect only ever needs to run in a browser. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** `useId` returns characters that are awkward inside `url(#...)`; keep it to a safe alphabet. */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

export type ChartState = 'ready' | 'loading' | 'empty' | 'error';

export interface ChartFrameProps {
  /** Names the chart. Shown as the caption and used as the SVG `<title>`. */
  title: string;
  /**
   * One sentence saying what the marks show and in what units, for a reader who cannot see the
   * picture. Becomes the SVG `<desc>`. Not shown on screen.
   */
  description: string;
  /** Optional second caption line: the assumption behind the curve, the range, the block. */
  subtitle?: ReactNode;
  /** Height of the whole SVG box in px, axis bands included. Default 240. */
  height?: number;
  /** Overrides for the reserved axis bands. */
  margin?: Partial<ChartMargin>;
  /** Width used when the container reports zero, e.g. inside a collapsed panel. Default 240. */
  minWidth?: number;
  /** Inline legend, rendered top right beside the caption. Never a bottom-centred block. */
  legend?: ReactNode;
  /** Controls that scope this one chart, e.g. an invert-price toggle. */
  actions?: ReactNode;
  /** HTML drawn over the plot, for a cursor readout. Positioned by the child, not by the frame. */
  overlay?: (geometry: ChartGeometry) => ReactNode;
  /**
   * The chart's accessible twin: the same numbers as a `<table>`, behind a disclosure. Whenever a
   * value is only reachable by hovering, this is what makes it reachable without.
   */
  table?: ReactNode;
  /** Label on the table disclosure. Default `'Show values'` / `'Hide values'`. */
  tableLabel?: string;
  state?: ChartState;
  /** Sentence shown in the empty state. Say what is missing, not "no data". */
  emptyMessage?: string;
  /** The one action that resolves the empty state. */
  emptyAction?: ReactNode;
  /** Decoded error name or message. Never a raw hex blob. */
  errorMessage?: string;
  errorAction?: ReactNode;
  /**
   * Set when the chart contains a focusable control such as `Cursor`. A `role="img"` element hides
   * its subtree from assistive technology, which would swallow that control.
   */
  interactive?: boolean;
  /** Caption under the plot: units, assumptions, the source of the numbers. */
  footnote?: ReactNode;
  className?: string;
  /** Draws the marks. Called with the measured geometry on every resize. */
  children: (geometry: ChartGeometry) => ReactNode;
}

export function ChartFrame({
  title,
  description,
  subtitle,
  height = 240,
  margin,
  minWidth = 240,
  legend,
  actions,
  overlay,
  table,
  tableLabel = 'values',
  state = 'ready',
  emptyMessage = 'Nothing to plot yet.',
  emptyAction,
  errorMessage = 'The series could not be read.',
  errorAction,
  interactive = false,
  footnote,
  className,
  children,
}: ChartFrameProps) {
  const rawId = useId();
  const id = safeId(rawId);
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);

  const apply = useCallback((next: number) => {
    const rounded = Math.round(next);
    setWidth((prev) => (prev === rounded ? prev : rounded));
  }, []);

  useIsomorphicLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;

    apply(el.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [apply]);

  const resolved = resolveMargin(margin);
  const geometry =
    width === null ? null : makeGeometry(Math.max(minWidth, width), height, resolved, `${id}-plot`);

  return (
    <figure
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4',
        className,
      )}
    >
      {/* Stacked below `sm`. Floated right, the legend took half the row and squeezed a two-word
          title onto two lines and its subtitle onto four in a ~100px column at 390px. */}
      <figcaption className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <span className="block min-w-0">
          <span className="block text-meta font-medium text-ink">{title}</span>
          {subtitle ? <span className="mt-0.5 block text-mini text-ink-2">{subtitle}</span> : null}
        </span>
        {legend || actions ? (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:shrink-0 sm:flex-nowrap">
            {legend}
            {actions}
          </span>
        ) : null}
      </figcaption>

      <div ref={plotRef} className="relative w-full" style={{ height }}>
        {state === 'ready' && geometry ? (
          <>
            <svg
              width={geometry.width}
              height={geometry.height}
              viewBox={`0 0 ${geometry.width} ${geometry.height}`}
              role={interactive ? 'group' : 'img'}
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-desc`}
              className="block"
              style={{ overflow: 'visible' }}
            >
              <title id={`${id}-title`}>{title}</title>
              <desc id={`${id}-desc`}>{description}</desc>
              <defs>
                <clipPath id={geometry.clipId}>
                  {/* Inflated 2px so a series sitting exactly on the domain edge keeps its whole
                      stroke instead of losing the outer half to the clip. */}
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

        {state === 'loading' ? <ChartSkeleton title={title} margin={resolved} /> : null}

        {state === 'empty' ? (
          <ChartMessage margin={resolved} heading="Nothing to plot" body={emptyMessage}>
            {emptyAction}
          </ChartMessage>
        ) : null}

        {state === 'error' ? (
          <ChartMessage
            margin={resolved}
            heading="Series unavailable"
            body={errorMessage}
            tone="error"
          >
            {errorAction}
          </ChartMessage>
        ) : null}
      </div>

      {table ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setTableOpen((open) => !open)}
            aria-expanded={tableOpen}
            aria-controls={`${id}-table`}
            className="transition-state self-start rounded-control border border-line px-2 py-1 text-mini text-ink-2 hover:border-line-strong hover:text-ink"
          >
            {tableOpen ? `Hide ${tableLabel}` : `Show ${tableLabel}`}
          </button>
          <div id={`${id}-table`} hidden={!tableOpen} className="overflow-x-auto">
            {table}
          </div>
        </div>
      ) : null}

      {footnote ? <p className="text-mini leading-prose text-ink-3">{footnote}</p> : null}
    </figure>
  );
}

/**
 * A chart-shaped placeholder rather than a spinner: the grid rules and tick stubs land where the
 * real ones will, so nothing jumps when the data arrives. The pulse has an explicit
 * `motion-reduce` branch on top of the global one in `globals.css`.
 */
function ChartSkeleton({ title, margin }: { title: string; margin: ChartMargin }) {
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
          {[0.12, 0.34, 0.58, 0.79].map((fraction) => (
            <span
              key={fraction}
              className="absolute h-2 rounded-control bg-surface-2"
              style={{ top: `${fraction * 100}%`, left: -margin.left + 8, width: margin.left - 20 }}
            />
          ))}
          <span className="absolute inset-x-0 bottom-0 h-3/5 rounded-control bg-surface-2" />
        </div>
      </div>
    </>
  );
}

/**
 * Empty and error share a layout: a heading that names the state in words, a sentence, and the one
 * control that resolves it. The tone token is never the only signal; the heading carries it too.
 */
function ChartMessage({
  margin,
  heading,
  body,
  tone = 'neutral',
  children,
}: {
  margin: ChartMargin;
  heading: string;
  body: string;
  tone?: 'neutral' | 'error';
  children?: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col justify-center"
      style={{ paddingLeft: margin.left, paddingRight: margin.right }}
    >
      <div className="flex max-w-md flex-col items-start gap-2 border-b border-line pb-4">
        <p className="flex items-center gap-1.5 text-meta font-medium text-ink">
          {tone === 'error' ? <AlertGlyph /> : null}
          {heading}
        </p>
        <p className="text-mini leading-prose text-ink-2">{body}</p>
        {children}
      </div>
    </div>
  );
}

/** A 14px warning triangle, so the error state does not lean on colour alone. */
function AlertGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="shrink-0 text-neg"
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
 * `<g clipPath>` bound to the frame's plot rect.
 *
 * Marks that can leave the plot go inside it: a constant-product curve heads for infinity near a
 * zero reserve, and clipping draws the true geometry rather than a flattened lie. Axes, marker
 * labels and the legend stay outside, because they live in the margins on purpose.
 */
export function PlotArea({
  geometry,
  children,
}: {
  geometry: ChartGeometry;
  children: ReactNode;
}) {
  return <g clipPath={`url(#${geometry.clipId})`}>{children}</g>;
}
