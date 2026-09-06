/**
 * Typed contract handles built from a `Deployments` manifest.
 *
 *  - `getContracts(deployments)` → `{ address, abi }` pairs for wagmi hooks (`useReadContract`, ...).
 *  - `routerContract(address, client)` etc. → viem `getContract` instances for scripts and tests.
 */
import { getContract, type Address, type Client } from 'viem';
import { aggregatorV3Abi, aquaAbi, erc20Abi, swapVmAbi, swapVmQuoteViewAbi, weth9Abi } from './abis';
import { BASE_ADDRESSES, type Deployments } from './deployments';

export interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  /** False when the token is not in the manifest / known list (metadata is a guess). */
  known: boolean;
}

const KNOWN_TOKEN_META: Record<string, Omit<TokenInfo, 'address' | 'known'>> = {
  [BASE_ADDRESSES.weth.toLowerCase()]: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  [BASE_ADDRESSES.usdc.toLowerCase()]: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  [BASE_ADDRESSES.cbBtc.toLowerCase()]: { symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', decimals: 8 },
};

/** Static token metadata (WETH/USDC/cbBTC from the manifest, else the known-Base table, else a placeholder). */
export function tokenInfo(address: Address, deployments?: Deployments): TokenInfo {
  const key = address.toLowerCase();
  if (deployments) {
    if (key === deployments.weth.toLowerCase()) return { address, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, known: true };
    if (key === deployments.usdc.toLowerCase()) return { address, symbol: 'USDC', name: 'USD Coin', decimals: 6, known: true };
    if (key === deployments.cbBtc.toLowerCase()) return { address, symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', decimals: 8, known: true };
  }
  const meta = KNOWN_TOKEN_META[key];
  if (meta) return { address, ...meta, known: true };
  return { address, symbol: `${address.slice(0, 6)}…${address.slice(-4)}`, name: 'Unknown token', decimals: 18, known: false };
}

export function erc20(address: Address) {
  return { address, abi: erc20Abi } as const;
}

export function aggregator(address: Address) {
  return { address, abi: aggregatorV3Abi } as const;
}

export function getContracts(d: Deployments) {
  const chainlink = {
    ethUsd: aggregator(d.chainlink.ethUsd),
    ...(d.chainlink.btcUsd ? { btcUsd: aggregator(d.chainlink.btcUsd) } : {}),
    ...(d.chainlink.cbBtcUsd ? { cbBtcUsd: aggregator(d.chainlink.cbBtcUsd) } : {}),
    ...(d.chainlink.usdcUsd ? { usdcUsd: aggregator(d.chainlink.usdcUsd) } : {}),
  } as {
    ethUsd: ReturnType<typeof aggregator>;
    btcUsd?: ReturnType<typeof aggregator>;
    cbBtcUsd?: ReturnType<typeof aggregator>;
    usdcUsd?: ReturnType<typeof aggregator>;
  };

  return {
    /** Our ProbeRouter (HEAD swap-vm ABI: 3-arg quote/swap). */
    router: { address: d.router, abi: swapVmAbi } as const,
    /** Same address with `quote` typed as view for eth_call quoting. */
    routerQuote: { address: d.router, abi: swapVmQuoteViewAbi } as const,
    /**
     * The official AquaSwapVMRouter (v1.0.2). Only `AQUA()` / `hash()` are ABI-compatible with the
     * HEAD ABI — its quote/swap take 5 args and use a different taker-traits encoding.
     */
    officialRouter: { address: d.officialRouter, abi: swapVmAbi } as const,
    aqua: { address: d.aqua, abi: aquaAbi } as const,
    weth: erc20(d.weth),
    weth9: { address: d.weth, abi: weth9Abi } as const,
    usdc: erc20(d.usdc),
    cbBtc: erc20(d.cbBtc),
    tokens: [tokenInfo(d.weth, d), tokenInfo(d.usdc, d), tokenInfo(d.cbBtc, d)] as readonly TokenInfo[],
    chainlink,
  } as const;
}

export type Contracts = ReturnType<typeof getContracts>;

// --------------------------------------------------------------------------- viem instances

export function routerContract(address: Address, client: Client) {
  return getContract({ address, abi: swapVmAbi, client });
}

export function routerQuoteContract(address: Address, client: Client) {
  return getContract({ address, abi: swapVmQuoteViewAbi, client });
}

export function aquaContract(address: Address, client: Client) {
  return getContract({ address, abi: aquaAbi, client });
}

export function erc20Contract(address: Address, client: Client) {
  return getContract({ address, abi: erc20Abi, client });
}

export function aggregatorContract(address: Address, client: Client) {
  return getContract({ address, abi: aggregatorV3Abi, client });
}
