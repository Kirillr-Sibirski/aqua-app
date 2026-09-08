/**
 * When an offer runs to.
 *
 * Two things make this worth its own module. First, the maturity is an argument to the curve, so it
 * is part of the strategy hash and must not move between the moment an offer is priced and the
 * moment it is signed — deriving it from `Date.now()` on every render would re-key the sizing query
 * continuously and quietly reprice the offer under the maker. Second, the clock is the chain's:
 * a fork that has been warped forward is genuinely closer to expiry no matter what the laptop says.
 *
 * So maturities land on 08:00 UTC, the way a real expiry does. That makes the timestamp stable for
 * a whole day, legible, and something two people can talk about.
 *
 * The card's default is **the next Friday**, which is where a weekly option expires everywhere
 * else, with a two-day floor so a visitor arriving on a Thursday night is not offered something
 * that expires before they have finished reading the card.
 */

const DAY = 86_400;
/** Options expire in the morning, and a fixed hour keeps the maturity stable between renders. */
const EXPIRY_HOUR_UTC = 8;
/** `Date.getUTCDay()` for Friday. */
const FRIDAY = 5;

/**
 * The shortest offer the card will pre-fill.
 *
 * Under two days the decay band is wide enough that a taker has to cross a lot to clear it, so the
 * offer is unlikely to be taken at all — and an offer nobody takes earns nothing. A person can
 * still pick tomorrow by hand; this only governs the default.
 */
export const MIN_TENOR_SECONDS = 2 * DAY;

export interface ExpiryPreset {
  days: number;
  label: string;
}

/**
 * The tenors offered. Short by the standards of a listed market, because the position is quoting
 * liquidity rather than being held to expiry, and because decay is what pays here.
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

/**
 * The card's default date: the next Friday 08:00 UTC that is at least {@link MIN_TENOR_SECONDS}
 * away. Arrive on a Sunday and you get this Friday; arrive on a Thursday evening and you get the
 * one after, because the nearer one would expire inside two days.
 */
export function nextFridayAfter(blockTimestamp: number): number {
  let maturity = Math.floor(blockTimestamp / DAY) * DAY + EXPIRY_HOUR_UTC * 3_600;
  while (maturity < blockTimestamp + MIN_TENOR_SECONDS || new Date(maturity * 1000).getUTCDay() !== FRIDAY) {
    maturity += DAY;
  }
  return maturity;
}

/** `Fri 18 Sep, 08:00 UTC` — the expiry in full, for a disclosure or a details row. */
export function formatExpiry(maturity: number): string {
  const d = new Date(maturity * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

/** `Fri 18 Sep` — the expiry as the last word of the card's sentence. */
export function formatByWhen(maturity: number): string {
  const d = new Date(maturity * 1000);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Whole days from the chain's clock to the expiry, rounded down. Never negative. */
export function daysUntil(maturity: number, blockTimestamp: number): number {
  return Math.max(0, Math.floor((maturity - blockTimestamp) / DAY));
}

// ---------------------------------------------------------------------------
// The date picker speaks `YYYY-MM-DD`
// ---------------------------------------------------------------------------

/*
 * Mantine 9's date components hold a calendar date as a plain `YYYY-MM-DD` string rather than a
 * `Date`, which suits us: a maturity is a UTC instant on a named day, and going through a local
 * `Date` would move that day across the date line for anyone west of Greenwich. Both directions
 * below stay in UTC, so the day a person clicks is the day the offer expires.
 */

/** The UTC calendar day a maturity falls on, as the picker's value. */
export function dateStringFor(maturity: number): string {
  return new Date(maturity * 1000).toISOString().slice(0, 10);
}

/** 08:00 UTC on the day named by a `YYYY-MM-DD` string, or `undefined` if it is not one. */
export function maturityForDateString(value: string | null | undefined): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}T${String(EXPIRY_HOUR_UTC).padStart(2, '0')}:00:00Z`);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
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
] as const;
