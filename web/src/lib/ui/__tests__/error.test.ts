/**
 * The one line a refusal turns into.
 *
 * The shapes below are what viem actually throws: the decoded custom error sits several `cause`
 * levels down under `data.errorName` / `data.args`, and every wrapper on the way out sets its own
 * `shortMessage` to the generic *The contract function "X" reverted.* — which names neither the
 * guard that refused nor the numbers it refused with. Preferring the decode over that string is the
 * whole reason the errors ABI is attached to these calls, so it is asserted here rather than
 * assumed.
 */
import { describe, expect, it } from 'vitest';
import { describeError, explainError } from '../error';

/** `Coverage.NotCovered(needed, free)`: 6 WETH asked of a wallet holding 5.4, as the fork reports it. */
function notCovered() {
  return {
    name: 'ContractFunctionExecutionError',
    shortMessage: 'The contract function "swap" reverted.',
    message: 'The contract function "swap" reverted.\nContract Call:\n  address: 0x59675EAF…',
    cause: {
      name: 'ContractFunctionRevertedError',
      shortMessage: 'The contract function "swap" reverted.',
      data: {
        errorName: 'NotCovered',
        args: [BigInt('6000000000000000000'), BigInt('5400000000000000000')],
      },
    },
  };
}

describe('describeError', () => {
  it('takes the decoded custom error out of the cause chain', () => {
    const d = describeError(notCovered());
    expect(d.name).toBe('NotCovered');
    expect(d.args).toEqual(['6000000000000000000', '5400000000000000000']);
    expect(d.rejected).toBe(false);
  });

  it('reports a wallet rejection as a rejection, not a failure', () => {
    const d = describeError({
      name: 'ContractFunctionExecutionError',
      shortMessage: 'User rejected the request.',
      cause: { name: 'UserRejectedRequestError', shortMessage: 'User rejected the request.' },
    });
    expect(d.rejected).toBe(true);
  });

  it('falls back to the short message when nothing decoded', () => {
    expect(describeError(new Error('nothing to decode\nsecond line')).message).toBe('nothing to decode');
    expect(describeError(undefined).message).toBe('');
  });
});

describe('explainError', () => {
  it('names the guard and both of its numbers rather than the generic revert string', () => {
    // The defect this replaced: `err.shortMessage` alone, which is the generic sentence below.
    expect(notCovered().shortMessage).toBe('The contract function "swap" reverted.');
    expect(explainError(notCovered())).toBe(
      'NotCovered: needed 6000000000000000000, free 5400000000000000000',
    );
  });

  it('lets the call site denominate the arguments it knows the units of', () => {
    const asWeth = (v: string) => `${Number(v) / 1e18} WETH`;
    expect(explainError(notCovered(), asWeth)).toBe('NotCovered: needed 6 WETH, free 5.4 WETH');
  });

  it('labels the single argument RmmSwap refuses a dust trade with', () => {
    expect(
      explainError({
        shortMessage: 'The contract function "quote" reverted.',
        cause: { data: { errorName: 'RmmInsideSpread', args: [BigInt(133_550_000)] } },
      }),
    ).toBe('RmmInsideSpread: shortfall 133550000');
  });

  it('says the person cancelled rather than that something failed', () => {
    expect(
      explainError({ cause: { name: 'UserRejectedRequestError', shortMessage: 'User rejected.' } }),
    ).toBe('Cancelled in your wallet.');
  });

  it('keeps the name beside the generic sentence when a revert carried no arguments', () => {
    expect(
      explainError({
        shortMessage: 'The contract function "quote" reverted.',
        cause: { data: { errorName: 'RmmOutOfDomain', args: [] } },
      }),
    ).toBe('RmmOutOfDomain. The contract function "quote" reverted.');
  });
});
