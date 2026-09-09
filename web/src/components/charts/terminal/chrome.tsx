'use client';

/**
 * The strip above the plot: which view, what the marks mean, and what the cursor is over.
 *
 * All three are one line at desk width and wrap to two on a phone. Nothing here is a sentence — a
 * label is one or two words and a figure carries its unit, which is the whole grammar the screen
 * uses.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/ui/cn';
import { color } from '@/lib/ui/tokens';
import { dashArray, type ColorToken, type DashStyle } from '../types';
import { TERMINAL_VIEWS, TERMINAL_VIEW_LABEL, type TerminalView } from './types';

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export interface SegmentedProps {
  value: TerminalView;
  onChange: (view: TerminalView) => void;
  /** `id` of the element the panel is, so a screen reader can walk tab -> panel. */
  panelId: string;
  idPrefix: string;
}

/**
 * Three tabs in one track. Roving tabindex, so Tab enters the group once and the arrow keys move
 * inside it — the behaviour a tablist is required to have and the one a trader's hands expect.
 *
 * Deliberately not accented. The accent marks the primary action and your own position; a view
 * switch is neither, and spending the one colour here would leave nothing to point at the button
 * that publishes an offer.
 */
export function Segmented({ value, onChange, panelId, idPrefix }: SegmentedProps) {
  const move = (delta: number) => {
    const at = TERMINAL_VIEWS.indexOf(value);
    const next = TERMINAL_VIEWS[(at + delta + TERMINAL_VIEWS.length) % TERMINAL_VIEWS.length];
    onChange(next);
    document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="chart view"
      className="flex shrink-0 items-center gap-px rounded-control border border-line bg-surface-2 p-px"
    >
      {TERMINAL_VIEWS.map((view) => {
        const selected = view === value;
        return (
          <button
            key={view}
            id={`${idPrefix}-tab-${view}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(view)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                move(-1);
              }
            }}
            className={cn(
              'transition-state rounded-[7px] px-2.5 py-1 text-micro lowercase',
              selected
                ? 'bg-surface-3 text-ink'
                : 'text-ink-3 hover:bg-surface-3/60 hover:text-ink-2',
            )}
          >
            {TERMINAL_VIEW_LABEL[view]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export interface LegendItem {
  /** Stable key and, unless `label` is given, the text. */
  id: string;
  label?: ReactNode;
  color: ColorToken;
  /** `'line'` draws a rule, `'area'` a filled swatch, `'dot'` a ringed point. */
  kind?: 'line' | 'area' | 'dot';
  dash?: DashStyle;
}

/** Inline, beside the control. Never a bottom-centred block, never a box. */
export function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-1.5 text-micro whitespace-nowrap text-ink-3">
          <Swatch item={item} />
          {item.label ?? item.id}
        </li>
      ))}
    </ul>
  );
}

function Swatch({ item }: { item: LegendItem }) {
  const kind = item.kind ?? 'line';
  if (kind === 'area') {
    return (
      <svg width={12} height={8} aria-hidden="true" className="shrink-0">
        <rect
          width={12}
          height={8}
          fill={color(item.color)}
          fillOpacity={0.22}
          stroke={color(item.color)}
          strokeWidth={1}
          strokeOpacity={0.7}
        />
      </svg>
    );
  }
  if (kind === 'dot') {
    return (
      <svg width={12} height={8} aria-hidden="true" className="shrink-0">
        <circle cx={6} cy={4} r={3} fill={color(item.color)} stroke={color('surface')} strokeWidth={1.5} />
      </svg>
    );
  }
  return (
    <svg width={12} height={8} aria-hidden="true" className="shrink-0">
      <line
        x1={0}
        x2={12}
        y1={4}
        y2={4}
        stroke={color(item.color)}
        strokeWidth={1.75}
        strokeDasharray={dashArray(item.dash ?? 'solid', 1.75)}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Readout
// ---------------------------------------------------------------------------

export interface ReadoutItem {
  /** One or two words, or a ticker. Also the row's key and its accessible name. */
  label: string;
  value: string;
  tone?: 'ink' | 'ink-2' | 'pos' | 'neg' | 'accent';
  /** The token's own mark, when the label is a ticker. Supplied by the page, never drawn here. */
  icon?: ReactNode;
}

const TONE: Record<NonNullable<ReadoutItem['tone']>, string> = {
  ink: 'text-ink',
  'ink-2': 'text-ink-2',
  pos: 'text-pos',
  neg: 'text-neg',
  accent: 'text-accent',
};

/**
 * What the cursor is over, or — with no cursor — the figures the view is anchored on.
 *
 * Always populated, so moving the pointer onto the plot never grows the strip and pushes the chart
 * down by a line. Values are mono and tabular for the same reason: a digit that changes must not
 * move the one beside it.
 */
export function Readout({ items }: { items: readonly ReadoutItem[] }) {
  return (
    <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="flex items-center gap-1 text-micro whitespace-nowrap text-ink-3">
            {item.icon ? (
              <span aria-hidden="true" className="flex shrink-0 items-center">
                {item.icon}
              </span>
            ) : null}
            {item.label}
          </dt>
          <dd className={cn('font-mono text-mini tnum whitespace-nowrap', TONE[item.tone ?? 'ink'])}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------

/**
 * One row at desk width, two on a phone: what you are looking at on the left, what it is worth on
 * the right. `shrink-0` keeps it out of the flex distribution so the plot below takes every
 * remaining pixel of a flexible region.
 */
export function Strip({
  control,
  legend,
  readout,
}: {
  control: ReactNode;
  legend: readonly LegendItem[];
  readout: readonly ReadoutItem[];
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {control}
        <Legend items={legend} />
      </div>
      <Readout items={readout} />
    </div>
  );
}
