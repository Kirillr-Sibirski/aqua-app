/**
 * The rule about prose, enforced instead of remembered.
 *
 * the layout spec bans explanatory sentences from the resting screen, and this pass deliberately added
 * the first prose the app has ever carried. The whole defence of that is the container: a caption
 * is one clause and is always visible; a note is one short sentence and is not on screen until
 * somebody asks for it. Those two limits are the difference between progressive disclosure and a
 * paragraph that crept onto a trading terminal, and neither of them is enforced by anything else —
 * a caption that grows a second sentence still compiles, still renders and still looks fine to
 * whoever wrote it.
 *
 * So the shapes are asserted here, in the tokens' own vocabulary, for every view and both symbols.
 */
import { describe, expect, it } from 'vitest';
import { TERMINAL_VIEWS } from '../types';
import { TERMINAL_VIEW_LABEL, VIEW_COPY } from '../copy';

/** Sentence-enders outside a decimal. `2.5` is not two sentences. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const RISKY = 'WETH';
const STABLE = 'USDC';

describe('view copy', () => {
  it('covers every view in the control, and nothing else', () => {
    expect(Object.keys(VIEW_COPY).sort()).toEqual([...TERMINAL_VIEWS].sort());
    expect(Object.keys(TERMINAL_VIEW_LABEL).sort()).toEqual([...TERMINAL_VIEWS].sort());
  });

  it.each(TERMINAL_VIEWS)('%s: the tab is one lowercase word', (view) => {
    const { label } = VIEW_COPY[view];
    expect(label).toMatch(/^[a-z]+$/);
    expect(label.length).toBeLessThanOrEqual(12);
    expect(TERMINAL_VIEW_LABEL[view]).toBe(label);
  });

  it.each(TERMINAL_VIEWS)('%s: the caption is one clause and never a sentence', (view) => {
    const caption = VIEW_COPY[view].caption(RISKY, STABLE);

    // A clause: no terminal punctuation, and short enough to sit on one line beside the control.
    expect(caption).not.toMatch(/[.!?]$/);
    expect(caption.length).toBeLessThanOrEqual(72);
    /* Lowercase, like every label on this screen — unless the clause opens on a ticker, which is
       spelled the way the token spells itself everywhere else in the app. */
    const first = caption.split(' ')[0];
    expect(first === first.toLowerCase() || first === first.toUpperCase()).toBe(true);
  });

  it.each(TERMINAL_VIEWS)('%s: the note is one short sentence', (view) => {
    const note = VIEW_COPY[view].note(RISKY, STABLE);

    expect(sentences(note)).toHaveLength(1);
    expect(note).toMatch(/^[A-Z]/);
    expect(note).toMatch(/[.!?]$/);
    expect(note.split(/\s+/).length).toBeLessThanOrEqual(15);
  });

  /**
   * The pair is a prop. A sentence with `WETH` written into it is the same class of bug as a
   * component with `#4ed5d5` written into it, and it fails on the first venue that is not this one.
   */
  it.each(TERMINAL_VIEWS)('%s: no token symbol is hard-coded into the copy', (view) => {
    const copy = VIEW_COPY[view];
    const rendered = [copy.caption('AAA', 'BBB'), copy.note('AAA', 'BBB')].join(' ');
    expect(rendered).not.toMatch(/WETH|USDC|ETH\b/);
  });

  /** A template hole that was written in a single-quoted string renders as `${risky}` verbatim. */
  it.each(TERMINAL_VIEWS)('%s: every interpolation was actually interpolated', (view) => {
    const copy = VIEW_COPY[view];
    const rendered = [copy.caption(RISKY, STABLE), copy.note(RISKY, STABLE)].join(' ');
    expect(rendered).not.toContain('${');
  });

  it('says buy where the price view differs by side', () => {
    expect(VIEW_COPY.price.caption(RISKY, STABLE, 'buy')).toBe('you buy a little at a time as the price falls');
    expect(VIEW_COPY.price.caption(RISKY, STABLE, 'sell')).toBe('you sell a little at a time as the price rises');
    expect(VIEW_COPY.payoff.note(RISKY, STABLE, 'buy')).toContain(STABLE);
    expect(VIEW_COPY.premium.caption(RISKY, STABLE, 'buy')).toBe('how much a seller gives you for waiting');
    expect(VIEW_COPY.premium.caption(RISKY, STABLE, 'sell')).toBe('how much a buyer pays you for waiting');
    for (const view of TERMINAL_VIEWS) {
      const note = VIEW_COPY[view].note(RISKY, STABLE, 'buy');
      expect(sentences(note)).toHaveLength(1);
      expect(note.split(/\s+/).length).toBeLessThanOrEqual(15);
    }
  });
});
