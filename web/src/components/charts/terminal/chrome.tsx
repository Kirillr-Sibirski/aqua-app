'use client';

/**
 * The chrome above the plot: which view, what it shows, and what the cursor is over.
 *
 * It is two rows, and the split between them is deliberate rather than cosmetic.
 *
 *   Row one is OWNED BY `TerminalChart` and never unmounts: the segmented control, the note, and
 *   the caption. That matters because the control's selected pill slides between tabs, and a CSS
 *   transition cannot run on an element that was just mounted — the three views are three sibling
 *   slots in `TerminalChart`, so anything rendered *inside* a view is destroyed and rebuilt on
 *   every switch and would jump rather than move. Row one is the part that has to persist.
 *
 *   Row two is owned by the view, because it is the view's own readout: figures its own hooks
 *   produced, at its own cursor.
 *
 * WHAT IS NOT HERE ANY MORE: the legend. It named four marks from as far away as the layout allows
 * and cost a row of chrome to do it. Every mark now carries its own name — the axis says which
 * series lives on it and in what units (`AxisName`), a line is labelled on the line (`SeriesLabel`),
 * and the two shaded regions on the payoff are named in this readout, in their own colours, with a
 * figure attached. A name beside the thing beats a name in a box.
 *
 * Nothing here is a sentence except inside the note, which is the one container in the app where
 * prose is allowed and the only one a reader has to open.
 */
import type { ReactNode } from 'react';
import { Explain } from '@/components/terminal/Explain';
import { cn } from '@/lib/ui/cn';
import classes from './chart.module.css';
import { VIEW_COPY } from './copy';
import { TERMINAL_VIEWS, type TerminalView } from './types';

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
 * The selection is a pill that SLIDES rather than a background that swaps. Three equal grid columns
 * are what make that exact: the pill is one column wide and translates by whole multiples of its
 * own width, so there is nothing to measure, nothing to observe on resize, and no frame where the
 * pill is the wrong size. It is the only place in the chart where motion carries meaning about the
 * interface rather than about the data — it says the three views are one thing you are moving
 * along, which is the fact a reader most needs and a background swap hides.
 *
 * Deliberately not accented. The accent marks the primary action and your own position; a view
 * switch is neither, and spending the one colour here would leave nothing to point at the button
 * that publishes an offer.
 */
export function Segmented({ value, onChange, panelId, idPrefix }: SegmentedProps) {
  const at = TERMINAL_VIEWS.indexOf(value);

  const move = (delta: number) => {
    const next = TERMINAL_VIEWS[(at + delta + TERMINAL_VIEWS.length) % TERMINAL_VIEWS.length];
    onChange(next);
    document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="chart view"
      className="relative grid shrink-0 grid-cols-3 rounded-control border border-line bg-surface-2 p-0.5"
    >
      {/* One column wide, inset by the track's own 2px padding, translated by whole columns. */}
      <span
        aria-hidden="true"
        className="transition-state pointer-events-none absolute inset-y-0.5 left-0.5 rounded-chip bg-surface-3"
        style={{ width: 'calc((100% - 0.25rem) / 3)', transform: `translateX(${at * 100}%)` }}
      />
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
              /* `relative` so the label paints over the pill sliding under it, and `--radius-chip`
                 to match the pill's own corner — the concentric inner radius of the track above
                 minus its 2px padding, which is one arithmetic done once in a token.

                 No `lowercase` transform. The labels are lowercase strings, so the rule changed
                 nothing but made the tabs the only `text-transform: lowercase` in the app. */
              'transition-state relative rounded-chip px-2.5 py-1 text-micro',
              selected ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {VIEW_COPY[view].label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The note
// ---------------------------------------------------------------------------

/**
 * The one place on this screen where prose is allowed, and it is behind a click.
 *
 * The rule the app is built on is that nothing explains itself on the surface: a label is one or
 * two words and a figure carries its unit. That rule is right, and it left three chart views with
 * no way in for a reader who has never traded an option. Progressive disclosure is the resolution
 * rather than an exception to it — the resting screen stays a desk tool, and the two or three
 * sentences that genuinely explain the shape live one keystroke away, where somebody who wants
 * them can get them and somebody who does not never sees them.
 *
 * It is the SAME affordance the ticket's figures wear, imported rather than rebuilt. A screen with
 * two different ⓘ — two glyphs, two popovers, two focus behaviours — has told a reader that they
 * are two different kinds of thing, which they are not. `Explain` owns the button, the portal, the
 * focus return and the Escape handling; this supplies the copy and the heading, and the deep import
 * skips `components/terminal/index.ts` so the chart does not close a cycle with the screen that
 * renders it.
 *
 * The first line inside is the precise term, in mono. Someone who already trades options reads that
 * line, knows exactly which plot they are looking at, and stops reading.
 */
export function ViewNote({
  view,
  risky,
  stable,
}: {
  view: TerminalView;
  risky: string;
  stable: string;
}) {
  const copy = VIEW_COPY[view];
  return (
    <Explain term={copy.label} position="bottom-start">
      <p className={classes.noteTerm}>{copy.term}</p>
      {copy.note(risky, stable).map((sentence) => (
        <p key={sentence.slice(0, 24)}>{sentence}</p>
      ))}
    </Explain>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/**
 * Row one: the control, the note, and the caption naming what is plotted against what.
 *
 * The caption is keyed on the view so a switch remounts it and it cross-fades in rather than
 * swapping mid-word. It is one clause, in `--ink-3`, and it never grows a second sentence: the
 * second sentence is what the note is for.
 *
 * The row wraps rather than scrolls. At 390px the control and the note keep one line and the
 * caption takes the next, which is the order a reader needs them in anyway.
 */
export function ChartHeader({
  view,
  control,
  risky,
  stable,
}: {
  view: TerminalView;
  control: ReactNode;
  risky: string;
  stable: string;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {control}
      <ViewNote view={view} risky={risky} stable={stable} />
      <p key={view} className={cn(classes.caption, 'min-w-0 text-mini text-ink-3')}>
        {VIEW_COPY[view].caption(risky, stable)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readout
// ---------------------------------------------------------------------------

export interface ReadoutItem {
  /** One to three words, or a ticker. Also the row's key and its accessible name. */
  label: string;
  value: string;
  tone?: 'ink' | 'ink-2' | 'pos' | 'neg' | 'accent';
  /** The token's own mark, when the label names one. Supplied by the page, never drawn here. */
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
 * Row two: what the cursor is over, or — with no cursor — the figures the view is anchored on.
 *
 * Always populated, so moving the pointer onto the plot never grows the row and pushes the chart
 * down by a line. Values are mono and tabular for the same reason: a digit that changes must not
 * move the one beside it.
 *
 * It is also what names the two marks a label cannot reach. The payoff's premium and forgone
 * regions are a green sliver and a red wedge; each has an entry here, in its own colour, with the
 * figure the region is worth — which is a better legend than a swatch, because a swatch says a
 * region exists and this says what it is worth.
 */
export function Readout({ items }: { items: readonly ReadoutItem[] }) {
  return (
    <dl className="flex min-w-0 shrink-0 flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
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
