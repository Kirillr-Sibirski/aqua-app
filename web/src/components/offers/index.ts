/**
 * The positions view's own vocabulary.
 *
 * These are the domain, not primitives: the product has a shape no generic dashboard component
 * covers — one balance that several published offers draw on at once, re-read at every block.
 *
 * `useHasOffers` is exported for the front door, not for this screen. It is the cheap gate a nav
 * item reads to decide whether the second tab exists at all: a first-time visitor, or a wallet with
 * nothing published, should see the one card and no dashboard.
 */
export { OffersScreen } from './OffersScreen';

export { OffersChrome } from './OffersChrome';
export type { OffersChromeProps } from './OffersChrome';

export { BackingBar } from './BackingBar';
export type { BackingBarProps } from './BackingBar';

export { OffersTable } from './OffersTable';
export type { OffersTableProps } from './OffersTable';

export { OffersDisconnected, OffersNone } from './OffersEmpty';

export { useHasOffers } from './useHasOffers';
export type { HasOffers } from './useHasOffers';

export { useCountTo } from './useCountTo';
export { HATCH, pct } from './visual';

export { depthCaption, formatExpiryDate, formatExpiryExact, offerAction, offerStatus } from './copy';
export type { DepthCaption, DepthTone, OfferAction, OfferStatus } from './copy';
