/**
 * The decode the inspector renders.
 *
 * The screen where a maker reads these fields is the last place the terms are legible before they
 * become a hash, so the offsets, the flag names and the units are asserted rather than eyeballed.
 * A wrong label here is worse than a wrong number: it reads as confirmation.
 */
import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_WINDOW_SECONDS,
  FLAG_POST_EXPIRY_ONE_WAY,
  FLAG_POST_EXPIRY_OUT_IS_RISKY,
  FLAG_RISKY_IS_TOKEN_A,
  buildLegProgram,
  rateFor,
  type RmmArgs,
} from '../rmm';
import { explainProgram, findRmmArgs } from '../program';

const LEG: RmmArgs = {
  flags: FLAG_RISKY_IS_TOKEN_A | FLAG_POST_EXPIRY_ONE_WAY | FLAG_POST_EXPIRY_OUT_IS_RISKY,
  sigmaWad: BigInt('635000000000000000'),
  maturity: 1_789_000_000,
  strikeWad: BigInt('2725500000000000000000'),
  liquidityWad: BigInt('10400000000000000000'),
  rateRisky: rateFor(18),
  rateStable: rateFor(6),
};

const PROGRAM = buildLegProgram({
  rmm: LEG,
  deadline: LEG.maturity + ASSIGNMENT_WINDOW_SECONDS,
  salt: BigInt('1789000000042'),
});

function fields(name: string) {
  const instruction = explainProgram(PROGRAM).find((i) => i.name === name);
  if (!instruction) throw new Error(`no ${name} in the program`);
  return Object.fromEntries(instruction.fields.map((f) => [f.name, f.value]));
}

describe('explainProgram', () => {
  it('marks our two instructions as custom and the stock ones as not', () => {
    const byName = Object.fromEntries(explainProgram(PROGRAM).map((i) => [i.name, i.custom]));
    expect(byName).toEqual({ Deadline: false, Coverage: true, RmmSwap: true, Salt: false });
  });

  it('reports each instruction at its true byte offset and length', () => {
    expect(explainProgram(PROGRAM).map((i) => [i.name, i.offset, i.byteLength])).toEqual([
      ['Deadline', 0, 7],
      ['Coverage', 7, 5],
      ['RmmSwap', 12, 64],
      ['Salt', 76, 10],
    ]);
  });

  it('decodes the curve arguments into the units a maker reads', () => {
    const f = fields('RmmSwap');
    expect(f.sigmaWad).toBe('63.5%');
    expect(f.strikeWad).toBe('2725.5');
    expect(f.liquidityWad).toBe('10.4');
    expect(f.rateRisky).toBe('1');
    expect(f.rateStable).toBe('1000000000000');
    expect(f.maturity).toBe('2026-09-10 00:26 UTC');
  });

  it('names the flag bits rather than printing a byte', () => {
    expect(fields('RmmSwap').flags).toBe('0x07 — riskyIsTokenA | postExpiryOneWay | postExpiryOutIsRisky');
  });

  it('decodes the deadline and the salt', () => {
    expect(fields('Deadline').deadline).toBe('2026-09-10 00:56 UTC');
    expect(fields('Salt').salt).toBe('1789000000042');
  });

  it('carries the raw bytes of each instruction alongside its decode', () => {
    const rmm = explainProgram(PROGRAM).find((i) => i.name === 'RmmSwap')!;
    expect(rmm.bytes.slice(0, 6)).toBe('0x553e');
    expect(rmm.args).toBe(findRmmArgs(PROGRAM));
  });

  it('refuses a truncated program rather than decoding half of it', () => {
    // A partial decode on a review screen is a program that gets shipped anyway.
    const cut = PROGRAM.slice(0, PROGRAM.length - 8) as `0x${string}`;
    expect(() => explainProgram(cut)).toThrow(/truncated/);
    expect(findRmmArgs(cut)).toBeUndefined();
  });

  it('walks a program that contains no RmmSwap without inventing one', () => {
    expect(findRmmArgs('0x9303000000')).toBeUndefined();
    expect(explainProgram('0x9303000000').map((i) => i.name)).toEqual(['Coverage']);
  });
});

describe('Coverage arguments', () => {
  it('says what the guard checks and what it withholds', () => {
    const f = fields('Coverage');
    expect(f.flags).toBe('0x00');
    expect(f.haircutBps).toBe('0 (0.00%)');
  });
});
