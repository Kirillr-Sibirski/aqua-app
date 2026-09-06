/**
 * ABIs used by the contract handles. SwapVM / Aqua / ERC-20 come from the verified encoder package;
 * this file adds Chainlink AggregatorV3 and a `view`-typed twin of `quote` for eth_call quoting.
 */
export { swapVmAbi, aquaAbi, erc20Abi } from '../swapvm';

/** Chainlink AggregatorV3Interface (proxy + aggregator share it). */
export const aggregatorV3Abi = [
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'description',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'version',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'latestAnswer',
    inputs: [],
    outputs: [{ name: '', type: 'int256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRoundData',
    inputs: [{ name: '_roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'aggregator',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

/**
 * `ISwapVM.quote` is declared `view` on the interface but `external` (non-view) on `SwapVM`, so the
 * ProbeRouter artifact ABI marks it `nonpayable`. This twin is identical except for the mutability,
 * which lets `readContract` / `useReadContract` issue a plain eth_call.
 */
export const swapVmQuoteViewAbi = [
  {
    type: 'function',
    name: 'quote',
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
      { name: 'amount', type: 'uint256' },
      { name: 'takerTraitsAndData', type: 'bytes' },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'orderHash', type: 'bytes32' },
    ],
    stateMutability: 'view',
  },
] as const;

/** WETH9 surface beyond ERC-20 (Base WETH 0x4200…0006 is WETH9). */
export const weth9Abi = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
