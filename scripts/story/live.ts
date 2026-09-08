/**
 * Real, live, third-party Aqua strategies on Base, and the ABI of the router that serves them.
 *
 * Scene 0 fills these. They were shipped by other people to the OFFICIAL, UNMODIFIED v1.0.2 router at
 * 0x111111338c... months before this project existed, and they are still active at the pinned fork block.
 * Nothing here is ours: not the maker, not the strategy, not the router, not the registry. That is the
 * whole point -- before showing a single Strikeline instruction, the demo proves the plumbing is the real
 * plumbing.
 *
 * The bytes are exactly the `Shipped.strategy` payload (`abi.encode(ISwapVMV102.Order)`), lifted from the
 * same constants `contracts/test/fork/live/LiveBaseStrategies.sol` pins, with the ledger balances the
 * Solidity fork test asserts at block 50,946,000. `assertLiveStrategiesPinned()` re-checks
 * `keccak256(strategy) == strategyHash` before anything is sent.
 *
 * v1.0.2 vs HEAD, the two differences that matter here:
 *   - `quote`/`swap` are 5-arg `(order, tokenIn, tokenOut, amount, takerTraitsAndData)`; HEAD is 3-arg.
 *   - v1.0.2 taker traits have 7 flags; HEAD adds `isAToB` (0x80) and `allowPartialFill` (0x100), and
 *     direction comes from the explicit tokenIn/tokenOut instead. The 22-byte header layout is otherwise
 *     identical, so `buildTakerTraits({ isAToB: false, allowPartialFill: false })` emits v1.0.2 bytes --
 *     asserted against the 1inch SDK's own `TakerTraits.default().encode()` golden vector below.
 */
import { keccak256, type Address, type Hex } from 'viem';
import { buildTakerTraits } from '../../web/src/lib/swapvm/index.ts';

export const BASE_CHAIN_ID = 8453;
/** The block `scripts/fork/start.sh` pins, and the block every ledger figure below was verified at. */
export const PINNED_BLOCK = 50_946_000;

export const AQUA: Address = '0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a';
/** `AquaSwapVMRouter` v1.0.2, deployed by 1inch. Same address on Ethereum and Base. */
export const OFFICIAL_ROUTER: Address = '0x111111338c5091E8440b67B168bAe16a668AC0De';

export interface LiveStrategy {
  key: 'live1' | 'live2' | 'live3';
  label: string;
  maker: Address;
  hash: Hex;
  strategy: Hex;
  /** Aqua ledger at `PINNED_BLOCK`, asserted by the Solidity fork test. */
  ledgerWeth: bigint;
  ledgerUsdc: bigint;
  /** Gated on `tx.origin` holding the access NFT. */
  gated: boolean;
  /**
   * The maker's own wallet holds the inventory, so a fill is capped by it and shows up as a wallet
   * delta. False for makers whose hooks source the token just-in-time from somewhere else: live2's
   * wallet holds literally nothing, and the fill still settles.
   */
  walletBacked: boolean;
  /** What the program does, decoded from its bytes. */
  program: string;
}

export const LIVE = {
  weth: '0x4200000000000000000000000000000000000006' as Address,
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
  /** "Access Token for SwapVM v3.1.2", symbol RES: the per-strategy gate the 1inch dApp ships with. */
  kycNft: '0x26FFc7D378E8e49Be2c483295A3e3E511F96a468' as Address,
  /** An EOA that holds one RES at the pinned block. We impersonate it; we do not mint anything. */
  resHolder: '0x3E4798B0e268bB73c04e29afe0bc7FdCF37B67c1' as Address,
  /** Recipient of `aquaProtocolFeeAmountInXD` in every gated dApp strategy on Base. */
  protocolFeeTo: '0x8063D4FAF54BF8c898dC6ddC689C76aB12b4614a' as Address,
} as const;

/** Shipped at block 49,514,250. Ungated, EOA maker, concentrated 2,000-2,100 USDC/ETH, 10% flat fee. */
const LIVE1: LiveStrategy = {
  key: 'live1',
  label: 'ungated EOA maker',
  maker: '0xFD40Ce008f1459D797530a55Bb07da4a4954aD18',
  hash: '0xb5a7193e990bafa45847a153fcd252b84688808f52721d472dff567bb32c29fb',
  strategy:
    '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000fd40ce008f1459d797530a55bb07da4a4954ad1840000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000004a1240000000000000000000000000000000000000000000000000000028ac80bff62b000000000000000000000000000000000000000000000000000029ada3f6ec36150405f5e100110000000000000000000000000000000000000000000000',
  ledgerWeth: 224_075_990_008_781n,
  ledgerUsdc: 1_461_965n,
  gated: false,
  walletBacked: true,
  program: 'concentrateGrowLiquidity2D(2000..2100) . flatFeeAmountInXD(10%) . xycSwapXD',
};

/** Shipped at block 50,754,929. Contract maker whose hooks source USDC just-in-time; wallet holds none. */
const LIVE2: LiveStrategy = {
  key: 'live2',
  label: 'ungated contract maker with hooks',
  maker: '0x1a09f7d9B921C93F8fCD4bF04fe448982a3388Ec',
  hash: '0x99f8041e4238844bc25e24479b04f4e7da729d5bd6a65b01a1f3c9b5e74f3838',
  strategy:
    '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000001a09f7d9b921c93f8fcd4bf04fe448982a3388ec4c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000121504002dc6c011001408ffea53d50193f62b0000000000000000000000000000',
  ledgerWeth: 17_577_848_751_888_246n,
  ledgerUsdc: 37_320_137n,
  gated: false,
  walletBacked: false,
  program: 'flatFeeAmountInXD(0.3%) . xycSwapXD . salt',
};

/** Shipped at block 49,496,295 by the 1inch dApp. KycNFT-gated, concentrated 1,875-2,091 USDC/ETH. */
const LIVE3: LiveStrategy = {
  key: 'live3',
  label: 'KycNFT-gated 1inch dApp maker',
  maker: '0x2467eBaF6860532384639836cA40706Cd8F2Cd17',
  hash: '0xb7c200701c31b095cc0833f881d52bedc44cfd838447fbc2f2d8e70f79b2c5c3',
  strategy:
    '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000002467ebaf6860532384639836ca40706cd8f2cd17400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000084211426ffc7d378e8e49be2c483295a3e3e511f96a4681c180001e8488063d4faf54bf8c898dc6ddc689c76ab12b4614a124000000000000000000000000000000000000000000000000000002761dcd3f4a500000000000000000000000000000000000000000000000000002995f6b637ee15040007a12011001408e11ab89bd79c38db00000000000000000000000000000000000000000000000000000000',
  ledgerWeth: 680_657_569_152n,
  ledgerUsdc: 1_983_510_251n,
  gated: true,
  walletBacked: true,
  program:
    'onlyTxOriginTokenBalanceNonZero(RES) . aquaProtocolFeeAmountInXD(0.0125%) . concentrateGrowLiquidity2D(1875..2091) . flatFeeAmountInXD(0.05%) . xycSwapXD . salt',
};

export const LIVE_STRATEGIES: readonly LiveStrategy[] = [LIVE1, LIVE2, LIVE3];

/** The SDK's `TakerTraits.default().encode()`: exactIn + useTransferFromAndAquaPush, no slices. */
export const TAKER_TRAITS_V102_GOLDEN: Hex = '0x00000000000000000000000000000000000000000041';

/** v1.0.2 taker traits, built with the HEAD encoder and the two HEAD-only flags left off. */
export function takerTraitsV102(taker: Address, threshold?: bigint): Hex {
  return buildTakerTraits({
    taker,
    isExactIn: true,
    isAToB: false, // does not exist in v1.0.2; direction is the explicit tokenIn/tokenOut
    useTransferFromAndAquaPush: true,
    ...(threshold === undefined ? {} : { threshold }),
  });
}

export function assertLiveStrategiesPinned(): void {
  const golden = takerTraitsV102('0x000000000000000000000000000000000000dEaD');
  if (golden !== TAKER_TRAITS_V102_GOLDEN) {
    throw new Error(`v1.0.2 taker traits drifted: expected ${TAKER_TRAITS_V102_GOLDEN}, got ${golden}`);
  }
  for (const s of LIVE_STRATEGIES) {
    const hash = keccak256(s.strategy);
    if (hash !== s.hash) throw new Error(`${s.key}: keccak256(strategy) = ${hash}, pinned hash is ${s.hash}`);
  }
}

/** Minimal ABI of the deployed v1.0.2 router. Note the 5-arg quote/swap and the tx.origin gate error. */
export const officialRouterAbi = [
  { type: 'function', name: 'AQUA', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'hash',
    stateMutability: 'view',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'maker', type: 'address' },
          { name: 'traits', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'quote',
    stateMutability: 'view',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'maker', type: 'address' },
          { name: 'traits', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'takerTraitsAndData', type: 'bytes' },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'orderHash', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'maker', type: 'address' },
          { name: 'traits', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'takerTraitsAndData', type: 'bytes' },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'orderHash', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'eip712Domain',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
  {
    type: 'event',
    name: 'Swapped',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: false },
      { name: 'maker', type: 'address', indexed: false },
      { name: 'taker', type: 'address', indexed: false },
      { name: 'tokenIn', type: 'address', indexed: false },
      { name: 'tokenOut', type: 'address', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'error',
    name: 'TxOriginTokenBalanceIsZero',
    inputs: [
      { name: 'txOrigin', type: 'address' },
      { name: 'token', type: 'address' },
    ],
  },
] as const;

/** `abi.decode(strategy, (Order))` for the v1.0.2 order shape, which is ABI-identical to HEAD's. */
export const orderTupleAbi = [
  {
    name: 'order',
    type: 'tuple',
    components: [
      { name: 'maker', type: 'address' },
      { name: 'traits', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
  },
] as const;
