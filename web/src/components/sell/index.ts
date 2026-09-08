/**
 * The card, and everything that stands behind it.
 *
 * `OfferCard` is the product: three fields and one button, all three pre-filled from the chain.
 * The rest is exported for the offer screen and the tests, which need the same date arithmetic and
 * the same sizing rule the card publishes with. The chrome it sits under is `AppChrome`, in
 * `components/shell`, and is the same frame every other route renders.
 */
export { OfferCard } from './OfferCard';
export { WalletButton, ConnectModal, NetworkNotice } from './WalletButton';

export {
  EXPIRY_PRESETS,
  MIN_TENOR_SECONDS,
  dateStringFor,
  daysUntil,
  formatByWhen,
  formatExpiry,
  maturityAt,
  maturityForDateString,
  nextFridayAfter,
} from './expiry';
export type { ExpiryPreset } from './expiry';

/*
 * `phi`, `d1d2` and `riskyFraction` are deliberately NOT here.
 *
 * `moneyness.ts` is the one file allowed to touch a shipped number in floating point, and it says
 * so at the top: nothing else in the app may reach its `Phi`. Re-exporting it from the public
 * barrel made that a comment rather than a rule — any future screen could have imported a float
 * normal CDF with an ordinary import and started modelling an option in TypeScript. The three
 * callers need are below; the test imports the rest from '../moneyness' directly, and an eslint
 * `no-restricted-imports` rule now refuses that path from anywhere outside this directory.
 */
export { liquidityForRisky, moneynessOf, strikeFrom } from './moneyness';
export type { MoneynessInput } from './moneyness';

export { useOffer } from './useOffer';
export type { UseOfferParams, UseOfferResult } from './useOffer';

export { usePublishOffer } from './usePublish';
export type { PublishParams, PublishResult } from './usePublish';

export { blockLadder, estimateRealisedVol, readBlockHistory, useRealisedVol } from './useRealisedVol';
export type {
  PriceObservation,
  RealisedVol,
  RealisedVolEstimate,
  RealisedVolSource,
  UseRealisedVolResult,
} from './useRealisedVol';

export type { OfferPair, SizedOffer } from './types';
