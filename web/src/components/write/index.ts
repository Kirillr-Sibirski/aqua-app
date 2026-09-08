/**
 * The writing surface: everything that turns a maker's intent into shipped bytes.
 *
 * The split that matters is between the two kinds of number in here. `moneyness.ts` and `payoff.ts`
 * are floating point and are *allowed* to be — one chooses where on a curve a leg starts, the other
 * draws an overlay the UI labels "model". `useLegSizing.ts` is where the chain answers, and nothing
 * shipped comes from anywhere else.
 */
export { WriteWizard } from './WriteWizard';

export { Terms, ivRatio, IV_MAX_PERCENT } from './Terms';
export type { TermsProps } from './Terms';

export { StrikePicker } from './StrikePicker';
export type { StrikePickerProps } from './StrikePicker';

export { PayoffChart } from './PayoffChart';
export type { PayoffChartProps } from './PayoffChart';

export { MarginPreview } from './MarginPreview';
export type { MarginClaim, MarginPreviewProps, MarginRow } from './MarginPreview';

export { ShipCalldata } from './ShipCalldata';
export type { ShipCalldataProps } from './ShipCalldata';

export { ShipPanel } from './ShipPanel';
export type { ShipPanelProps } from './ShipPanel';

export { TxStepper, countTransferLogs, ERC20_TRANSFER_TOPIC } from './TxStepper';
export type { TxStepperProps } from './TxStepper';

export { EXPIRY_PRESETS, formatExpiry, maturityAt } from './expiry';
export type { ExpiryPreset } from './expiry';

export {
  MONEYNESS_CHIPS,
  d1d2,
  moneynessOf,
  phi,
  positionDelta,
  riskyFraction,
  riskyReserveWad,
  strikeFrom,
} from './moneyness';
export type { MoneynessChip, MoneynessInput } from './moneyness';

export {
  assignedBounds,
  bookSummary,
  bookValue,
  bookValueAtExpiry,
  callPrice,
  hodlValue,
  legValue,
  spotDomain,
} from './payoff';
export type { PayoffLeg } from './payoff';

export { useLegSizing } from './useLegSizing';
export type { UseLegSizingParams, UseLegSizingResult } from './useLegSizing';

export { blockLadder, estimateRealisedVol, readBlockHistory, useRealisedVol } from './useRealisedVol';
export type {
  PriceObservation,
  RealisedVol,
  RealisedVolEstimate,
  RealisedVolSource,
  UseRealisedVolOptions,
  UseRealisedVolResult,
} from './useRealisedVol';

export { useShipBook } from './useShipBook';
export type { ShipBookParams, ShippedBook } from './useShipBook';

export { WRITE_STEPS } from './types';
export type { LegDraft, SizedLeg, WritePair, WriteStep } from './types';
