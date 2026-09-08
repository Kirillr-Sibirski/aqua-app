/**
 * When a book expires.
 *
 * Two things make this worth its own module. First, the maturity is an argument to `RmmSwap`, so it
 * is part of the strategy hash and must not move between the moment a leg is priced and the moment
 * it is signed — deriving it from `Date.now()` on every render would re-key the sizing query
 * continuously and quietly reprice the book under the maker. Second, the clock is the chain's:
 * a fork that has been warped forward is genuinely closer to expiry no matter what the laptop says.
 *
 * So maturities land on 08:00 UTC, the way a real expiry does. That makes the timestamp stable for
 * a whole day, legible in the program inspector, and something two makers can talk about.
 */

const DAY = 86_400;
/** Options expire in the morning, and a fixed hour keeps the maturity stable between renders. */
const EXPIRY_HOUR_UTC = 8;

export interface ExpiryPreset {
  days: number;
  label: string;
}

/**
 * The tenors offered. Short by the standards of a listed market, because the position is quoting
 * liquidity rather than being held to expiry, and because theta is what pays here.
 */
export const EXPIRY_PRESETS: readonly ExpiryPreset[] = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];

/**
 * The 08:00 UTC instant `days` ahead of the chain's current block, always strictly in the future.
 *
 * @param blockTimestamp seconds, from the chain
 */
export function maturityAt(blockTimestamp: number, days: number): number {
  const target = blockTimestamp + days * DAY;
  const dayStart = Math.floor(target / DAY) * DAY;
  let maturity = dayStart + EXPIRY_HOUR_UTC * 3_600;
  // Rounding down to the day can land before the block we started from on a short tenor.
  while (maturity <= blockTimestamp) maturity += DAY;
  return maturity;
}

/** `Fri 18 Sep, 08:00 UTC` — the expiry as a maker would say it out loud. */
export function formatExpiry(maturity: number): string {
  const d = new Date(maturity * 1000);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${weekday} ${d.getUTCDate()} ${month}, ${hh}:${mm} UTC`;
}
