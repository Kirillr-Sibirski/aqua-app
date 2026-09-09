'use client';

/**
 * The signature moment, and the only one on this screen that is not a figure moving.
 *
 * When somebody takes an offer, two things change on the positions strip in the same commit: what
 * the swept leg has earned, and how much of what every *other* leg promises the shared balance can
 * still deliver. Both used to arrive as different digits on the next read, which on a strip of
 * fifteen rows is indistinguishable from nothing having happened. The affected rows announce
 * themselves instead: a ground tint that appears, holds, halves and goes.
 *
 * **This lives above the rows on purpose.** The strip swaps its rows for skeletons while a re-read
 * is in flight, so the row that shows the new figure is a different React element than the one that
 * showed the old — measured on a real fill: nought of seventeen rows kept their DOM identity. A
 * hook inside a row therefore has no memory of the reading it is meant to be comparing against.
 * The strip does not unmount, so the comparison belongs to the strip.
 *
 * It is a **held state in two stages, not an animation**. The global `prefers-reduced-motion` block
 * neutralises every animation on the page, so an @keyframes decay would be switched off entirely
 * and take the confirmation with it; two attribute values on two timers survive that, and only the
 * easing between them collapses to a step. The information is the tint; the fade is how it leaves.
 *
 * What is compared is the **printed** figure, not the read behind it. A row announces itself when
 * what a person can see on it has changed, which is the only claim the tint makes — and it is what
 * keeps a wei of drift on the next block from lighting the whole book.
 *
 * The comparison happens during render and the decay happens on timers, which is also the only
 * shape that satisfies React: a landing is state derived from a new reading, not a subscription to
 * an external system, so it is adjusted where the reading arrives rather than in an effect.
 */
import { useEffect, useMemo, useState } from 'react';

export type LandingStage = 'on' | 'fade';

/** Full tint, then half, then nothing. Both are holds; neither is a duration to ease over. */
const HOLD_MS = 900;
const DECAY_MS = 600;

const NONE: ReadonlyMap<string, LandingStage> = new Map();
const NOTHING_CHANGED: readonly string[] = [];

export interface LandingsOptions {
  holdMs?: number;
  decayMs?: number;
}

type Prints = readonly (readonly [key: string, print: string | undefined])[];

interface Reading {
  /** The identity of the whole strip's printed state, so a re-render of it is not a new reading. */
  signature: string;
  /** The last defined print per row, carried across the reads that had none. */
  prints: ReadonlyMap<string, string>;
  /** The rows whose print changed at this reading. */
  changed: readonly string[];
  /** Increments once per reading that changed something: what the decay clock is keyed to. */
  generation: number;
}

/**
 * @param prints one `[key, printed figures]` pair per row. A row whose reads are still in flight
 *   passes `undefined`, and is neither compared nor recorded — so a round trip is never mistaken
 *   for a change, and the comparison spans it.
 */
export function useLandings(
  prints: Prints,
  { holdMs = HOLD_MS, decayMs = DECAY_MS }: LandingsOptions = {},
): ReadonlyMap<string, LandingStage> {
  const signature = prints.map(([key, print]) => `${key}=${print ?? ''}`).join(';');

  /* The first reading of a row is not an arrival: every row is new when a wallet attaches, and
     lighting the whole book would say a fill had landed on all of them at once. */
  const [reading, setReading] = useState<Reading>(() => ({
    signature,
    prints: definedPrints(prints),
    changed: NOTHING_CHANGED,
    generation: 0,
  }));
  const [phase, setPhase] = useState<{ generation: number; stage: LandingStage | undefined }>({
    generation: 0,
    stage: undefined,
  });

  if (reading.signature !== signature) setReading(compare(reading, prints, signature));
  if (phase.generation !== reading.generation && reading.changed.length > 0) {
    setPhase({ generation: reading.generation, stage: 'on' });
  }

  useEffect(() => {
    const generation = phase.generation;
    if (generation === 0) return;
    const toFade = setTimeout(() => setPhase({ generation, stage: 'fade' }), holdMs);
    const toOff = setTimeout(() => setPhase({ generation, stage: undefined }), holdMs + decayMs);
    return () => {
      clearTimeout(toFade);
      clearTimeout(toOff);
    };
    /* Only a new landing restarts the clock: `phase.generation` and not `phase`. Depending on the
       whole object would restart this effect on the step down to `fade` that its own timer causes,
       which would clear the timer that ends the tint and leave the row green for good. */
  }, [phase.generation, holdMs, decayMs]);

  const stage = phase.generation === reading.generation ? phase.stage : undefined;
  return useMemo(
    () => (stage === undefined ? NONE : new Map(reading.changed.map((key) => [key, stage] as const))),
    [stage, reading],
  );
}

function definedPrints(prints: Prints): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, print] of prints) if (print !== undefined) map.set(key, print);
  return map;
}

function compare(previous: Reading, prints: Prints, signature: string): Reading {
  const next = new Map(previous.prints);
  const changed: string[] = [];
  for (const [key, print] of prints) {
    if (print === undefined) continue;
    const before = next.get(key);
    next.set(key, print);
    if (before !== undefined && before !== print) changed.push(key);
  }
  return {
    signature,
    prints: next,
    changed: changed.length > 0 ? changed : NOTHING_CHANGED,
    generation: changed.length > 0 ? previous.generation + 1 : previous.generation,
  };
}
