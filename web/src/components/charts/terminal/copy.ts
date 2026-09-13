/**
 * What the three views are called, and the only prose in the app.
 *
 * THE RULE, and how this file lives inside it. Nothing on the resting screen explains anything: a
 * label is one or two words, a figure carries its unit, and a chart says what it is by naming its
 * own axes. But "no prose" is not the same as "no meaning", and a segmented control reading
 * `decay | payoff | curve` was three jargon words with nothing to open. So description arrives in
 * three graded containers, and each one has a size:
 *
 *   `label`    one word, on the tab. What the plot SHOWS, never how it is computed.
 *   `caption`  one clause, under the control. The relationship between the two axes, and nothing
 *              else. It is a caption, not a lesson: no verb of instruction, no second sentence.
 *   `note`     one short plain sentence, behind an explicit affordance. It is written for someone
 *              who has never traded an option, and it stops after one sentence.
 *
 * WHY THESE THREE NAMES. `decay`, `payoff` and `curve` named the mechanism: two of them are terms
 * of art and the third is a shape. What a reader wants to know is which question a view answers.
 *
 *   `premium`  what a buyer has to pay you, and how it grows. This is the income, and "premium" is
 *              simultaneously the plain word for it, the word the ticket already prints beside the
 *              publish button, and the correct options term. It survives both audiences without
 *              translation, which is the test.
 *   `payoff`   what you are left with at expiry. Already the standard name for exactly this plot in
 *              every options book, and legible cold: a payoff is what you get.
 *   `price`    the leg's trading function. `curve` named the mark rather than the subject; every
 *              chart here is a curve. The subject is the price this offer trades at, which is the
 *              slope of the line drawn, so the note leads with the precise term and the caption
 *              names the axes.
 *
 * Token symbols are interpolated rather than written, because the pair is a prop. Hard-coding WETH
 * in a sentence is the same class of bug as hard-coding a colour.
 */
import type { TerminalView } from './types';

export interface ViewCopy {
  /** The tab. One word. */
  label: string;
  /** One clause under the control, naming what is plotted against what. Never a sentence. */
  caption: (risky: string, stable: string) => string;
  /** One short plain sentence behind the ⓘ. The only prose on this screen. */
  note: (risky: string, stable: string) => string;
}

export const VIEW_COPY: Record<TerminalView, ViewCopy> = {
  premium: {
    label: 'premium',
    caption: () => 'how much a buyer pays you for waiting',
    note: () => 'The extra a buyer pays you, growing each day nobody takes the offer.',
  },
  payoff: {
    label: 'payoff',
    caption: (risky) => `what you end up with at expiry, depending on the ${risky} price`,
    note: (risky) => `What you end up with at expiry, compared with just holding ${risky}.`,
  },
  price: {
    label: 'price',
    caption: (risky) => `the price each ${risky} sells at, as buyers take more`,
    note: () => 'Before expiry your offer sells a little at a time, at rising prices.',
  },
};

/** One-word labels. A segmented control is not the place for a sentence. */
export const TERMINAL_VIEW_LABEL: Record<TerminalView, string> = {
  premium: VIEW_COPY.premium.label,
  payoff: VIEW_COPY.payoff.label,
  price: VIEW_COPY.price.label,
};
