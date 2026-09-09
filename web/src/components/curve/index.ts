/**
 * The leg: its bytes and its curve.
 *
 * `buildLegProgram` compiles one and `decodeRmmSwapArgs` reads one back, so the ticket that ships a
 * leg and the positions strip that decodes one can never disagree about what a Strikeline program
 * is.
 *
 * `program.ts` is deliberately NOT re-exported here. It disassembles a compiled program, and its
 * only remaining caller is the test that asserts `buildLegProgram` emits Deadline . Coverage .
 * RmmSwap . Salt in that order, wraps the curve in the guard, carries no fee instruction and
 * accounts for every byte. Those are invariants of the encoder rather than something a screen
 * renders — the screen that rendered them was the offer detail page, and there is no offer detail
 * page. The per-leg chain reads that lived beside it went the same way: nothing imported one once
 * the app became a single screen whose reads are all owned by `useBook`.
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
