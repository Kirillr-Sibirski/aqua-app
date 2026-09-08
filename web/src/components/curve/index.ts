/**
 * The leg: its bytes, its curve, and the chain reads that describe it.
 *
 * Shared by the writer (which compiles a leg) and the leg detail screen (which reads one back), so
 * the two can never disagree about what a Strikeline program is.
 */
export {
  ASSIGNMENT_WINDOW_SECONDS,
  COVERAGE_ARGS_BYTES,
  COVERAGE_BPS,
  COVERAGE_FLAG_CHECK_TOKEN_IN,
  COVERAGE_OPCODE,
  EPS_WAD,
  FLAG_POST_EXPIRY_ONE_WAY,
  FLAG_POST_EXPIRY_OUT_IS_RISKY,
  FLAG_RISKY_IS_TOKEN_A,
  RMM_ARGS_BYTES,
  RMM_SWAP_OPCODE,
  TAU_FLOOR_SECONDS,
  WAD,
  YEAR_SECONDS,
  buildLegProgram,
  decodeCoverageArgs,
  decodeRmmSwapArgs,
  encodeCoverage,
  encodeCoverageArgs,
  encodeRmmSwap,
  encodeRmmSwapArgs,
  expiryFlagsFor,
  legKindFor,
  rateFor,
  remainingSeconds,
  strikelineErrorsAbi,
  strikelineReadAbi,
  strikelineViewsAbi,
  tauWad,
  toRawReserve,
} from './rmm';
export type { CoverageArgs, LegKind, LegProgramArgs, RmmArgs } from './rmm';

export { explainProgram, findRmmArgs } from './program';
export type { DecodedField, DecodedInstruction } from './program';

export { ProgramInspector } from './ProgramInspector';
export type { ProgramInspectorProps } from './ProgramInspector';

export { CurveChart } from './CurveChart';
export type { BandCorner, CurveChartProps, FillMarker, ReservePoint } from './CurveChart';

export { TimeScrubber, formatDuration } from './TimeScrubber';
export type { TimeScrubberProps } from './TimeScrubber';

export {
  readLegLedger,
  useCoverage,
  useDebounced,
  useLegFills,
  useTauNow,
  useThetaBand,
} from './useLegChain';
export type { LegFill, LegLedger, ThetaBand } from './useLegChain';
