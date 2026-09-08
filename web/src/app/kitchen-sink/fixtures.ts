/**
 * Fixture values for the component gallery.
 *
 * These are the only numbers in the app that do not come from a chain read, which is why they live
 * in one file with this comment on it rather than being scattered through the page. They are shaped
 * like the real thing on purpose: a 42-character checksummed address, a 66-character transaction
 * hash, and amounts at irregular magnitudes, because a gallery full of `1.0000` and `0xabc…def`
 * hides exactly the layout bugs it exists to catch (a digit that overflows its column, an address
 * that elides to nothing, a symbol that wraps).
 *
 * The amounts are the ones the contract suite actually measured, so the gallery and the README
 * agree: 0.338 WETH of theta over one leg's life, a 133.5473 USDC decay band after two days, and the
 * demo book's 10.4 WETH wallet.
 */

/** The official Aqua registry on Base. Real, and the address every strategy settles against. */
export const AQUA_ADDRESS = '0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a';

/** A maker. Shaped like an address, belongs to nobody. */
export const MAKER_ADDRESS = '0x8A4c1E6d4B0f19B2ee31c2B0E0D5f9C3a7b62D14';

/** A strategy hash: 32 bytes, the identity a maker reads off the screen. */
export const STRATEGY_HASH = '0x7c3f1a94d2e08b6537ac41f0d9be25a8c60417ef3b92d5a1084c7e6f2b3d90a5';

/** A transaction hash. */
export const TX_HASH = '0x4be9017c25a3f8d0e61b7fa4293c85d017e6bf20c4a9138d6e5027fb3ca1849d';

export const WETH_DECIMALS = 18;
export const USDC_DECIMALS = 6;

/** 12.4871 WETH — irregular on purpose. */
export const WETH_BALANCE = BigInt('12487100000000000000');
/** 24,850.4213 USDC. */
export const USDC_BALANCE = BigInt('24850421300');
/** 10.4 WETH, the demo book's shared backing. */
export const BOOK_BACKING = BigInt('10400000000000000000');
/** 5.4 WETH: what is left after a 5 WETH fill on leg 1. */
export const BOOK_REMAINING = BigInt('5400000000000000000');
/** 0.338 WETH of theta collected over one leg's life. */
export const THETA_COLLECTED = BigInt('338000000000000000');
/** 133.547310 USDC — the decay band two days in, as `test_Band_MatchesObservedMinimum` prints it. */
export const DECAY_BAND = BigInt('133547310');
/** A loss, for the negative branch. */
export const NEGATIVE_DELTA = BigInt('-1204380000');
/** Small enough to round away at eight fraction digits, so the `<` bound shows. */
export const DUST = BigInt('4823');
/** $31,204.87, in cents. */
export const USD_VALUE = { value: BigInt('3120487'), decimals: 2 };

export interface FixtureLeg {
  hash: string;
  pair: string;
  kind: 'Call' | 'Put';
  strike: string;
  depth: bigint;
  depthDecimals: number;
  depthSymbol: string;
  status: 'active' | 'docked' | 'partial';
  block: bigint;
}

/** The demo ladder: three calls above spot and a cash-secured put below. */
export const FIXTURE_LEGS: FixtureLeg[] = [
  {
    hash: STRATEGY_HASH,
    pair: 'WETH / USDC',
    kind: 'Call',
    strike: '2,600',
    depth: BigInt('4180000000000000000'),
    depthDecimals: WETH_DECIMALS,
    depthSymbol: 'WETH',
    status: 'active',
    block: BigInt('50946417'),
  },
  {
    hash: '0x2d81b0f47ea935c168d4029b7f3ac5e61840db27596ef03ca4b8172de905c36f',
    pair: 'WETH / USDC',
    kind: 'Call',
    strike: '2,800',
    depth: BigInt('3742000000000000000'),
    depthDecimals: WETH_DECIMALS,
    depthSymbol: 'WETH',
    status: 'active',
    block: BigInt('50946419'),
  },
  {
    hash: '0x9f04c7a3182be6d05fc4913a7e28b0d6534f81ca920e7b3d418065cf2a97d3e1',
    pair: 'WETH / USDC',
    kind: 'Call',
    strike: '3,000',
    depth: BigInt('2705000000000000000'),
    depthDecimals: WETH_DECIMALS,
    depthSymbol: 'WETH',
    status: 'partial',
    block: BigInt('50946421'),
  },
  {
    hash: '0xc518ae3097bd24f6013e8a5d7c40b29fe6803147da295cb60f8241e7935b0da8',
    pair: 'USDC / WETH',
    kind: 'Put',
    strike: '2,300',
    depth: BigInt('11840710000'),
    depthDecimals: USDC_DECIMALS,
    depthSymbol: 'USDC',
    status: 'docked',
    block: BigInt('50946424'),
  },
];

/** A viem-shaped revert, so ErrorState's decoder is exercised on the real object graph. */
export const COVERAGE_REVERT = Object.assign(
  new Error('The contract function "quote" reverted.'),
  {
    shortMessage: 'The contract function "quote" reverted.',
    cause: Object.assign(new Error('reverted'), {
      name: 'ContractFunctionRevertedError',
      data: {
        errorName: 'NotCovered',
        args: [BigInt('6000000000000000000'), BigInt('5400000000000000000')],
      },
    }),
  },
);

/** What a wallet throws when the person closes the prompt. Not a failure. */
export const USER_REJECTED = Object.assign(new Error('User rejected the request.'), {
  name: 'UserRejectedRequestError',
  shortMessage: 'User rejected the request.',
});
