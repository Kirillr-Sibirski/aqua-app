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
 *   `term`     the specialist's name for the same thing, inside the note. A reader who already
 *              trades options orients on this line and skips the rest.
 *   `note`     two or three plain sentences, behind an explicit affordance. This is the ONE place
 *              in the app where prose is allowed, and it is allowed precisely because a reader has
 *              to ask for it. It is written for someone who has never traded an option.
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
  /** The precise term, for a reader who already knows it. Mono, first line of the note. */
  term: string;
  /** Two or three plain sentences, one per paragraph. The only prose on this screen. */
  note: (risky: string, stable: string) => readonly string[];
}

export const VIEW_COPY: Record<TerminalView, ViewCopy> = {
  premium: {
    label: 'premium',
    caption: () => 'what a taker has to pay you, against days waited',
    term: 'time decay, read from bandFor',
    note: (risky, stable) => [
      `Your offer sits exactly on its own price curve the day you publish it, and every day nobody trades, time pushes the curve away from where your ${risky} is.`,
      `A taker now has to cross that gap before a trade will go through, and the gap is what you are paid for the wait: the left axis counts it in ${stable} if they are buying from you, the right in ${risky} if they are selling to you.`,
      'It is not cash until somebody crosses it. This line is what is on the table, not what has been banked.',
    ],
  },
  payoff: {
    label: 'payoff',
    caption: (risky) => `what you are left holding at expiry, against the ${risky} price then`,
    term: 'payoff at expiry, priced at tau = 0',
    note: (risky) => [
      `This is what you end up with on the day the offer expires, drawn against every price ${risky} could be at by then.`,
      `Below your strike nothing has changed and the two lines are one line: your position is holding. Above it your value stops climbing, because that is where somebody buys the ${risky} at the price you named.`,
      'The flat part is the trade you made. The premium is the small step at the corner where the two lines part, and it is printed there rather than shaded, because it is a few dollars against a position worth thousands.',
    ],
  },
  price: {
    label: 'price',
    caption: (risky, stable) => `${stable} held against ${risky} still unsold, and where this offer sits`,
    term: 'the leg’s trading function, y(x)',
    note: (risky, stable) => [
      `The curve is the offer itself: for every amount of ${risky} you have not sold yet, it says how much ${stable} you should be holding, and the slope between two points is the price a taker gets.`,
      `The dot is where this offer stands right now, and the arrow is the way a fill moves it — ${risky} out, ${stable} in.`,
      'The dashed line is the same offer at expiry. The shaded hump between the two, on the right-hand axis, is the premium still left to earn.',
    ],
  },
};

/** One-word labels. A segmented control is not the place for a sentence. */
export const TERMINAL_VIEW_LABEL: Record<TerminalView, string> = {
  premium: VIEW_COPY.premium.label,
  payoff: VIEW_COPY.payoff.label,
  price: VIEW_COPY.price.label,
};
