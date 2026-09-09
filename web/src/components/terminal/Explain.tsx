'use client';

/**
 * The one explanatory affordance on the screen, and the only place sentences are allowed.
 *
 * LAYOUT.md bans prose at rest and that rule has not moved: nothing here is visible until someone
 * asks for it. What sits on the screen is a 13px ⓘ in `--ink-3` — quieter than the label it follows
 * and far quieter than any figure — and what it opens is two or three plain sentences about one
 * number.
 *
 * It is used on exactly five figures, which is the whole list and is meant to stay short: the ones
 * a reader cannot derive from the label and the unit. IV, because it is the only input the chain
 * cannot supply. PREMIUM and CAPPED AT, because both describe money that arrives under conditions
 * the figure cannot state. DELIVERABLE and PROMISED, because they are the product's actual thesis —
 * several offers written against one balance that never moves — and a bare `165.9396 / 10.4000`
 * does not say that to anybody who has not already read the README.
 *
 * Keyboard and screen reader: it is a real button with a real name, so it is reachable by Tab and
 * announced as "What premium means, button". `trapFocus` moves focus into the dropdown on open so
 * that Escape has somewhere to fire from — Mantine listens for it on the dropdown, not globally —
 * and `returnFocus` puts focus back on the ⓘ when it closes. Clicking outside dismisses it too.
 *
 * The dropdown is portalled, so an ⓘ in a sticky table header inside a scroller is not clipped by
 * either of them.
 */
import { useState, type ReactNode } from 'react';
import { Popover, type FloatingPosition } from '@mantine/core';
import { Info } from 'lucide-react';
import classes from './terminal.module.css';

export interface ExplainProps {
  /**
   * The figure being explained, spelled the way the screen spells it. It heads the popover and it
   * is the button's accessible name, so it must read as a noun: "Premium", not "premium info".
   */
  term: string;
  /** Two or three plain sentences. Not a paragraph, and not a definition of options. */
  children: ReactNode;
  /**
   * Which side it opens on. The default is above, because every figure this is attached to sits in
   * the lower half of a 900px window; Floating UI flips it when that is wrong.
   */
  position?: FloatingPosition;
}

export function Explain({ term, children, position = 'top' }: ExplainProps) {
  const [opened, setOpened] = useState(false);

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position={position}
      offset={6}
      width={272}
      withArrow
      arrowSize={9}
      radius="md"
      shadow="lg"
      trapFocus
      returnFocus
      classNames={{ dropdown: classes.explainPop, arrow: classes.explainArrow }}
    >
      <Popover.Target>
        <button
          type="button"
          className={classes.explain}
          /* Named for what it opens, not for what it looks like. "Info" on five buttons in one
             screen reader's element list is five identical rows. */
          aria-label={`About ${term}`}
          onClick={() => setOpened((v) => !v)}
        >
          <Info size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </Popover.Target>

      <Popover.Dropdown>
        <p className={classes.explainTerm}>{term}</p>
        <div className={classes.explainBody}>{children}</div>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * A label with its ⓘ beside it, as one inline box.
 *
 * The wrapper exists so the icon rides the label's own baseline rather than the row's. Dropped
 * straight into `.legend` — a `align-items: baseline` flex row — a 20px inline-flex button
 * contributes its bottom margin edge as its baseline and lands three pixels low against 11px
 * uppercase, which is exactly the kind of almost-right a reader feels and cannot name.
 */
export function Labelled({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className ? `${classes.labelled} ${className}` : classes.labelled}>{children}</span>;
}
