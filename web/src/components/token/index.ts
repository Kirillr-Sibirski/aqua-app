/**
 * Token identity: the marks, the pair, and the one way this app prints a quantity.
 *
 * Import from here. `marks` is exported for the two places that need a bare glyph — a chart legend
 * and the favicon's sibling — and not because a call site should be picking a mark by hand;
 * `TokenIcon` is the thing that maps a symbol to one.
 */
export { TokenIcon } from './TokenIcon';
export type { TokenIconProps } from './TokenIcon';

export { TokenPair } from './TokenPair';
export type { TokenPairProps } from './TokenPair';

export { TokenAmount, TokenAmountSkeleton } from './TokenAmount';
export type { AmountTone, TokenAmountProps, TokenAmountSkeletonProps } from './TokenAmount';

export { CbBtcMark, EthereumMark, UnknownMark, UsdcMark } from './marks';
export type { MarkProps } from './marks';

export { fallbackInitial, tokenFractionDigits, tokenMeta } from './registry';
export type { TokenMark, TokenMeta } from './registry';
