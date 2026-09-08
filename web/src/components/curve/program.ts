/**
 * Reading a compiled leg back.
 *
 * A SwapVM program is a flat concatenation of `[opcode:u8][argsLength:u8][args...]`, so it can be
 * walked without a table of arities. What the table gives is names and field decoding, and the two
 * that matter here are ours: `RmmSwap` (`0x55`) and `Coverage` (`0x93`).
 *
 * This exists because "the mechanism is the interface". The bytes a maker is about to sign are the
 * whole agreement — `K`, `sigma`, `T` and `L` are publicly verifiable on-chain precisely because
 * `Aqua.ship` takes the strategy unhashed, for data availability — so the review screen shows them
 * decoded *and* raw, rather than asking anyone to trust that the form was wired up correctly.
 */
import { formatUnits, size, slice, type Hex } from 'viem';
import { opcodeName } from '@/lib/swapvm';
import {
  COVERAGE_OPCODE,
  FLAG_POST_EXPIRY_ONE_WAY,
  FLAG_POST_EXPIRY_OUT_IS_RISKY,
  FLAG_RISKY_IS_TOKEN_A,
  RMM_SWAP_OPCODE,
  decodeCoverageArgs,
  decodeRmmSwapArgs,
} from './rmm';

/** One decoded field of an instruction's arguments. */
export interface DecodedField {
  /** The Solidity field name, so a reader can find it in the source. */
  name: string;
  /** Human form: `2,600.00`, `60%`, `18 Sep 2026, 16:00`. */
  value: string;
  /** What it is, at most one line. Omitted for fields whose name says it. */
  note?: string;
}

export interface DecodedInstruction {
  /** Byte offset of the opcode within the program. */
  offset: number;
  /** Total bytes, header included. */
  byteLength: number;
  opcode: number;
  /** `RmmSwap`, `Coverage`, `Deadline`, or `0x??` for one we have no name for. */
  name: string;
  /** One line saying what this instruction does in this program. */
  role?: string;
  /** True for the two instructions this project contributes. */
  custom: boolean;
  /** The raw `[opcode][len][args]` bytes of this instruction alone. */
  bytes: Hex;
  /** The argument bytes without the header. */
  args: Hex;
  fields: DecodedField[];
}

const ROLE: Record<number, string> = {
  0x20: 'Hard end of the assignment window. Past it the leg quotes nothing.',
  0x02: 'Maker-owned monotonic nonce. A docked strategy hash can never be re-shipped.',
};

const CUSTOM_ROLE: Record<number, string> = {
  [RMM_SWAP_OPCODE]:
    'The curve. RMM-01 with curvature driven by the block clock, so the leg decays like an option.',
  [COVERAGE_OPCODE]:
    'Runs the curve first, then requires the priced output to be deliverable from the maker wallet.',
};

/** Trim trailing zeros from a fixed-point string, but never leave a bare decimal point. */
function trimDecimals(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
}

function formatTimestamp(seconds: number): string {
  if (seconds === 0) return '0 (none)';
  return `${new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function rmmFlagNames(flags: number): string {
  const on: string[] = [];
  if (flags & FLAG_RISKY_IS_TOKEN_A) on.push('riskyIsTokenA');
  if (flags & FLAG_POST_EXPIRY_ONE_WAY) on.push('postExpiryOneWay');
  if (flags & FLAG_POST_EXPIRY_OUT_IS_RISKY) on.push('postExpiryOutIsRisky');
  return on.length === 0 ? 'none' : on.join(' | ');
}

function rmmFields(args: Hex): DecodedField[] {
  const a = decodeRmmSwapArgs(args);
  return [
    {
      name: 'flags',
      value: `0x${a.flags.toString(16).padStart(2, '0')} — ${rmmFlagNames(a.flags)}`,
      note:
        a.flags & FLAG_POST_EXPIRY_ONE_WAY
          ? `After maturity the leg only trades with ${
              a.flags & FLAG_POST_EXPIRY_OUT_IS_RISKY ? 'the risky asset going out' : 'the stable asset going out'
            }.`
          : 'The assignment window trades both ways.',
    },
    {
      name: 'sigmaWad',
      value: `${trimDecimals(formatUnits(a.sigmaWad * BigInt(100), 18))}%`,
      note: 'Implied volatility, annualised. The maker chose it; no oracle supplies it.',
    },
    { name: 'maturity', value: formatTimestamp(a.maturity) },
    { name: 'strikeWad', value: trimDecimals(formatUnits(a.strikeWad, 18)), note: 'K, stable per risky.' },
    {
      name: 'liquidityWad',
      value: trimDecimals(formatUnits(a.liquidityWad, 18)),
      note: 'L, in risky units. Fixed for the life of the leg, with no invariant offset.',
    },
    { name: 'rateRisky', value: a.rateRisky.toString(), note: 'Raw to normalised multiplier.' },
    { name: 'rateStable', value: a.rateStable.toString() },
  ];
}

function coverageFields(args: Hex): DecodedField[] {
  const a = decodeCoverageArgs(args);
  return [
    {
      name: 'flags',
      value: `0x${a.flags.toString(16).padStart(2, '0')}`,
      note: a.flags & 1 ? 'Also requires the input leg to be receivable.' : 'Checks the output token only.',
    },
    {
      name: 'haircutBps',
      value: `${a.haircutBps} (${(a.haircutBps / 100).toFixed(2)}%)`,
      note: 'Fraction of the wallet withheld from the deliverable figure.',
    },
  ];
}

function genericFields(opcode: number, args: Hex): DecodedField[] {
  if (size(args) === 0) return [];
  const raw = BigInt(args);
  if (opcode === 0x20) return [{ name: 'deadline', value: formatTimestamp(Number(raw)) }];
  if (opcode === 0x02) return [{ name: 'salt', value: raw.toString() }];
  return [{ name: 'args', value: args }];
}

/**
 * Walk a program into instructions.
 *
 * Throws on a truncated program rather than returning what it managed to read: a half-decoded
 * program on a review screen is worse than an error, because it would be shipped.
 */
export function explainProgram(program: Hex): DecodedInstruction[] {
  const total = size(program);
  const out: DecodedInstruction[] = [];
  let offset = 0;

  while (offset < total) {
    if (offset + 2 > total) {
      throw new Error(`program truncated: an instruction header needs 2 bytes at offset ${offset}`);
    }
    const opcode = Number(BigInt(slice(program, offset, offset + 1)));
    const argsLength = Number(BigInt(slice(program, offset + 1, offset + 2)));
    const end = offset + 2 + argsLength;
    if (end > total) {
      throw new Error(`program truncated: instruction at ${offset} declares ${argsLength} argument bytes`);
    }

    const args: Hex = argsLength === 0 ? '0x' : slice(program, offset + 2, end);
    const custom = opcode === RMM_SWAP_OPCODE || opcode === COVERAGE_OPCODE;
    const name =
      opcode === RMM_SWAP_OPCODE
        ? 'RmmSwap'
        : opcode === COVERAGE_OPCODE
          ? 'Coverage'
          : (opcodeName(opcode) ?? `0x${opcode.toString(16).padStart(2, '0')}`);

    out.push({
      offset,
      byteLength: 2 + argsLength,
      opcode,
      name,
      role: custom ? CUSTOM_ROLE[opcode] : ROLE[opcode],
      custom,
      bytes: slice(program, offset, end),
      args,
      fields:
        opcode === RMM_SWAP_OPCODE
          ? rmmFields(args)
          : opcode === COVERAGE_OPCODE
            ? coverageFields(args)
            : genericFields(opcode, args),
    });

    offset = end;
  }

  return out;
}

/** The `RmmSwap` instruction in a program, or `undefined` when it carries none. */
export function findRmmArgs(program: Hex): Hex | undefined {
  try {
    return explainProgram(program).find((i) => i.opcode === RMM_SWAP_OPCODE)?.args;
  } catch {
    return undefined;
  }
}
