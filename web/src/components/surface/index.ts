/**
 * The read layer.
 *
 * An implied-volatility surface reconstructed from Aqua's own event log: `Shipped` carries the
 * whole strategy for data availability, a Strikeline leg encodes its strike, vol, expiry and
 * liquidity in the clear inside it, and so every option any maker has written here is publicly
 * decodable. Nothing in this directory models a price.
 */
export { SurfaceChart } from './SurfaceChart';
export type { SurfaceChartProps } from './SurfaceChart';

export { BestQuote, pickQuotePoint } from './BestQuote';
export type { BestQuoteProps } from './BestQuote';

export { ReadLayer, bestBidQuery } from './ReadLayer';
export type { ReadLayerProps } from './ReadLayer';

export { SurfaceTable } from './SurfaceTable';
export type { SurfaceTableProps } from './SurfaceTable';

export { SourceStrip } from './SourceStrip';
export type { SourceStripProps } from './SourceStrip';

export { useSurface } from './useSurface';
export type { UseSurfaceOptions, UseSurfaceReturn } from './useSurface';

export {
  censusOf,
  daysToExpiry,
  decodeSurface,
  decodeSurfaceLeg,
  deltaOf,
  groupSurface,
  impliedSpot,
  ivOf,
  pointKey,
} from './decode';
export type { DecodeResult, SkipReason } from './decode';

export { readBook, pricingOf, describeLensRevert, surfaceLensAbi } from './lens';
export type { LensLeg, ReadBookParams, ReadBookResult } from './lens';

export { fetchSubgraphSurface, SubgraphError, SUBGRAPH_URL, SURFACE_QUERY } from './subgraph';
export type { SubgraphSurface } from './subgraph';

export type { LegPricing, SurfaceCensus, SurfaceLeg, SurfacePoint, SurfaceSource } from './types';
