/**
 * The words the positions view puts on a row, in one place so the table, the bar and the empty
 * state cannot disagree about what an offer is called.
 *
 * The jargon rule this file implements is the corrected one, not the blanket ban: first contact is
 * plain, and depth is available rather than mandatory. Someone reading this screen has already
 * published something, so `strike`, `expiry` and `IV` are fair — but they live in tooltips and
 * secondary lines, and the primary line of every row is a sentence in English.
 *
 * Nothing here computes an option value. Every quantity these helpers describe was read from the
 * chain by `useBook`; this module only chooses the noun.
 */
import type { BookLeg } from '@/hooks/useBook';
import { formatTokenAmount, formatUnits } from '@/lib/ui';

/** Short month names, fixed rather than localised, so the date never shifts with an ICU version. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Every figure in a column, formatted the same way.
 *
 * Six significant digits keeps a WETH balance honest, and a floor of two fraction digits is what
 * makes a column of stablecoin figures line up: without it `24,850` and `17,301.6` sit in the same
 * column with the decimal point in two different places, which is the one thing tabular figures
 * exist to prevent.
 */
export function amountText(value: bigint, decimals: number): string {
  return formatUnits(value, decimals, { significantDigits: 6, minFractionDigits: 2 });
}

/** The same figure where the space is a tick under a bar segment: `9.925`, `17.3K`. */
export function tickText(value: bigint, decimals: number): string {
  return formatTokenAmount(value, decimals, { compact: true, significantDigits: 4 });
}

/**
 * The offer's own date, on the chain's calendar.
 *
 * UTC, deliberately. The maturity is a block timestamp the contract compares against, and rendering
 * it in the reader's zone would put a different date on screen than the one the curve expires on
 * for anybody east or west of Greenwich. The exact instant is in the title attribute.
 */
export function formatExpiryDate(maturitySeconds: number): string {
  const d = new Date(maturitySeconds * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The same instant, spelled out, for the tooltip. */
export function formatExpiryExact(maturitySeconds: number): string {
  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(maturitySeconds * 1000))} UTC`;
}

export interface OfferAction {
  /**
   * Always "Sell", because the row's amount is always what LEAVES the wallet.
   *
   * It is tempting to flip the verb on the put side and read the row as *buy WETH*, and an earlier
   * draft did — which put "Buy 17,301.60 USDC" on screen, the exact opposite of what the offer does
   * with those dollars. One verb, applied to the token the maker hands over, is correct on both
   * sides: a cash-secured put IS selling dollars for ETH. Which side it is stays legible from the
   * token, from the trigger clause under the price, and from the tooltip.
   */
  verb: 'Sell';
  /** Which side of the curve the maker is assigned on. */
  kind: 'call' | 'put';
  /** The clause under the price: what has to happen for the trade to be worth taking. */
  trigger: string;
}

/**
 * Which side of the trade this offer is, in the words the landing card uses.
 *
 * A covered call hands over the risky token: *sell 9.93 WETH if it reaches 3,000*. By put-call
 * parity the same 62 bytes with stable-heavy reserves hand over the stable token instead, and the
 * sentence keeps its shape rather than inverting: *sell 17,301.60 USDC if it falls to 2,300*. The
 * settlement flag in the program says which, and `useBook` has already decoded it.
 */
export function offerAction(leg: Pick<BookLeg, 'kind'>): OfferAction {
  return leg.kind === 'call'
    ? { verb: 'Sell', kind: 'call', trigger: 'if it reaches' }
    : { verb: 'Sell', kind: 'put', trigger: 'if it falls to' };
}

export type DepthTone = 'quiet' | 'warn';

export interface DepthCaption {
  text: string;
  tone: DepthTone;
  /** The precise reason, for the reader who wants the instruction that produced it. */
  title?: string;
}

/**
 * Why "can be taken now" is the number it is.
 *
 * The number itself is never estimated. Each offer is probed at the pinned block with an exact-out
 * quote for the whole of what it promises, and the answer is read out of the result: a clearing
 * quote means the promise is deliverable in full, and a refusal carries the true bound as its own
 * second argument — `NotCovered(needed, free)` when the wallet binds, `RmmExceedsReserve(requested,
 * available)` when the curve does. A refusal is the measurement, not an error.
 */
export function depthCaption(leg: BookLeg): DepthCaption {
  const { probe, depth } = leg;
  if (probe.pending) return { text: 'checking', tone: 'quiet' };

  if (probe.ok) {
    return depth.amount < depth.written
      ? {
          text: 'your wallet is the limit',
          tone: 'warn',
          title: 'The quote clears at exactly this size, so this is everything the offer can hand over right now.',
        }
      : { text: 'all of it', tone: 'quiet' };
  }

  switch (probe.errorName) {
    case 'NotCovered':
      return {
        text: 'your wallet is the limit',
        tone: 'warn',
        title: 'NotCovered: the guard refused the full size and reported what the wallet can actually deliver.',
      };
    case 'RmmExceedsReserve':
      return {
        text: 'the offer runs out first',
        tone: 'quiet',
        title: 'RmmExceedsReserve: the wallet covers this offer in full; the offer itself is the smaller bound.',
      };
    case 'RmmInsideSpread':
      return {
        text: 'under the minimum trade size',
        tone: 'quiet',
        title: 'RmmInsideSpread: time has moved the curve away from the reserves, so a trade this small cannot clear yet.',
      };
    case 'RmmSettlementOneWay':
      return {
        text: 'past its date, one way only',
        tone: 'quiet',
        title: 'RmmSettlementOneWay: past expiry the offer trades in one direction only.',
      };
    case 'RmmOutOfDomain':
      return { text: 'reserves off the curve', tone: 'warn', title: 'RmmOutOfDomain' };
    default:
      return { text: probe.errorName ?? `${depth.bound} is the limit`, tone: 'warn' };
  }
}

export interface OfferStatus {
  label: string;
  tone: 'live' | 'warn' | 'quiet';
  title: string;
}

/** The badge on the row, if the offer is anything other than plainly open for business. */
export function offerStatus(leg: BookLeg): OfferStatus | undefined {
  switch (leg.status) {
    case 'docked':
      return { label: 'Withdrawn', tone: 'quiet', title: 'Taken down. Nobody can take this offer again.' };
    case 'settling':
      return { label: 'Past its date', tone: 'warn', title: 'Past expiry: it settles in one direction only.' };
    case 'idle':
      return { label: 'Nothing left', tone: 'quiet', title: 'Every token this offer promised has been taken.' };
    default:
      return undefined;
  }
}
