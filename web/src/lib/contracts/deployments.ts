/**
 * Deployment manifest: written by `scripts/fork/bootstrap.ts` to `web/public/deployments/local.json`
 * and fetched at runtime from `/deployments/local.json` (override: NEXT_PUBLIC_DEPLOYMENTS_URL).
 * Falls back to NEXT_PUBLIC_* env vars when the file is missing.
 *
 * Schema (all addresses checksummed on parse):
 * {
 *   chainId, rpcUrl, blockNumber,
 *   aqua, officialRouter, router, weth, usdc, cbBtc,
 *   chainlink: { ethUsd, btcUsd?, cbBtcUsd?, usdcUsd? },
 *   accounts: [{ address, privateKey?, name?, role? } | "0x..."]
 * }
 */
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem';

/** Canonical Base (8453) addresses — used as env-fallback defaults because the fork carries Base state. */
export const BASE_ADDRESSES = {
  chainId: 8453,
  aqua: '0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a',
  officialRouter: '0x111111338c5091E8440b67B168bAe16a668AC0De',
  weth: '0x4200000000000000000000000000000000000006',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  cbBtc: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  chainlink: {
    ethUsd: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    btcUsd: '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F',
    cbBtcUsd: '0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D',
    usdcUsd: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
  },
} as const;

export const DEFAULT_DEPLOYMENTS_URL = '/deployments/local.json';
export const DEPLOYMENTS_URL: string = process.env.NEXT_PUBLIC_DEPLOYMENTS_URL ?? DEFAULT_DEPLOYMENTS_URL;

export interface ChainlinkFeeds {
  ethUsd: Address;
  btcUsd?: Address;
  cbBtcUsd?: Address;
  usdcUsd?: Address;
}

export interface DeploymentAccount {
  address: Address;
  privateKey?: Hex;
  name?: string;
  role?: string;
}

export interface Deployments {
  chainId: number;
  rpcUrl: string;
  /** Block to scan events from (fork block or router deployment block). */
  blockNumber: number;
  aqua: Address;
  officialRouter: Address;
  /** Our ProbeRouter. */
  router: Address;
  weth: Address;
  usdc: Address;
  cbBtc: Address;
  chainlink: ChainlinkFeeds;
  accounts: DeploymentAccount[];
  /** Any additional keys the bootstrap wrote (deployer, txHash, routerName, ...). */
  extra: Record<string, unknown>;
}

export type DeploymentsSource = 'file' | 'env';

export interface LoadedDeployments {
  deployments: Deployments;
  source: DeploymentsSource;
  /** URL that was tried for the file. */
  url: string;
  /** Present when the file failed and env was used. */
  fileError?: string;
}

export class DeploymentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentsError';
  }
}

const KNOWN_KEYS = new Set([
  'chainId',
  'rpcUrl',
  'blockNumber',
  'aqua',
  'officialRouter',
  'router',
  'weth',
  'usdc',
  'cbBtc',
  'chainlink',
  'accounts',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readAddress(obj: Record<string, unknown>, key: string, ctx = ''): Address {
  const v = obj[key];
  if (typeof v !== 'string' || !isAddress(v, { strict: false })) {
    throw new DeploymentsError(`${ctx}${key}: expected an address, got ${JSON.stringify(v)}`);
  }
  return getAddress(v);
}

function readOptionalAddress(obj: Record<string, unknown>, key: string, ctx = ''): Address | undefined {
  if (obj[key] === undefined || obj[key] === null || obj[key] === '') return undefined;
  return readAddress(obj, key, ctx);
}

function readInt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : typeof v === 'bigint' ? Number(v) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DeploymentsError(`${key}: expected a non-negative integer, got ${JSON.stringify(v)}`);
  }
  return n;
}

function readString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) throw new DeploymentsError(`${key}: expected a non-empty string`);
  return v;
}

function readAccount(v: unknown, i: number): DeploymentAccount {
  const ctx = `accounts[${i}].`;
  if (typeof v === 'string') {
    if (!isAddress(v, { strict: false })) throw new DeploymentsError(`accounts[${i}]: not an address`);
    return { address: getAddress(v) };
  }
  if (!isRecord(v)) throw new DeploymentsError(`accounts[${i}]: expected an address or an object`);
  const address = readAddress(v, 'address', ctx);
  const out: DeploymentAccount = { address };
  if (v.privateKey !== undefined) {
    if (typeof v.privateKey !== 'string' || !isHex(v.privateKey) || v.privateKey.length !== 66) {
      throw new DeploymentsError(`${ctx}privateKey: expected a 32-byte hex string`);
    }
    out.privateKey = v.privateKey as Hex;
  }
  if (typeof v.name === 'string') out.name = v.name;
  if (typeof v.role === 'string') out.role = v.role;
  return out;
}

/** Validate + normalise a raw JSON manifest. Throws `DeploymentsError` naming the offending field. */
export function parseDeployments(raw: unknown): Deployments {
  if (!isRecord(raw)) throw new DeploymentsError('deployments: expected a JSON object');
  const chainlinkRaw = raw.chainlink;
  if (!isRecord(chainlinkRaw)) throw new DeploymentsError('chainlink: expected an object');
  const accountsRaw = raw.accounts ?? [];
  if (!Array.isArray(accountsRaw)) throw new DeploymentsError('accounts: expected an array');

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!KNOWN_KEYS.has(k)) extra[k] = v;

  const chainlink: ChainlinkFeeds = { ethUsd: readAddress(chainlinkRaw, 'ethUsd', 'chainlink.') };
  const btcUsd = readOptionalAddress(chainlinkRaw, 'btcUsd', 'chainlink.');
  const cbBtcUsd = readOptionalAddress(chainlinkRaw, 'cbBtcUsd', 'chainlink.');
  const usdcUsd = readOptionalAddress(chainlinkRaw, 'usdcUsd', 'chainlink.');
  if (btcUsd) chainlink.btcUsd = btcUsd;
  if (cbBtcUsd) chainlink.cbBtcUsd = cbBtcUsd;
  if (usdcUsd) chainlink.usdcUsd = usdcUsd;

  return {
    chainId: readInt(raw, 'chainId'),
    rpcUrl: readString(raw, 'rpcUrl'),
    blockNumber: readInt(raw, 'blockNumber'),
    aqua: readAddress(raw, 'aqua'),
    officialRouter: readAddress(raw, 'officialRouter'),
    router: readAddress(raw, 'router'),
    weth: readAddress(raw, 'weth'),
    usdc: readAddress(raw, 'usdc'),
    cbBtc: readAddress(raw, 'cbBtc'),
    chainlink,
    accounts: accountsRaw.map(readAccount),
    extra,
  };
}

/**
 * Build a manifest from NEXT_PUBLIC_* env vars. Only NEXT_PUBLIC_ROUTER is required; everything else
 * defaults to the canonical Base addresses / the local fork RPC.
 * (Each key is referenced literally so Next can inline it in client bundles.)
 */
export function deploymentsFromEnv(): Deployments {
  const router = process.env.NEXT_PUBLIC_ROUTER;
  if (!router) throw new DeploymentsError('NEXT_PUBLIC_ROUTER is not set');
  return parseDeployments({
    chainId: process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545',
    blockNumber: process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? 0,
    aqua: process.env.NEXT_PUBLIC_AQUA ?? BASE_ADDRESSES.aqua,
    officialRouter: process.env.NEXT_PUBLIC_OFFICIAL_ROUTER ?? BASE_ADDRESSES.officialRouter,
    router,
    weth: process.env.NEXT_PUBLIC_WETH ?? BASE_ADDRESSES.weth,
    usdc: process.env.NEXT_PUBLIC_USDC ?? BASE_ADDRESSES.usdc,
    cbBtc: process.env.NEXT_PUBLIC_CBBTC ?? BASE_ADDRESSES.cbBtc,
    chainlink: {
      ethUsd: process.env.NEXT_PUBLIC_CHAINLINK_ETH_USD ?? BASE_ADDRESSES.chainlink.ethUsd,
      btcUsd: process.env.NEXT_PUBLIC_CHAINLINK_BTC_USD ?? BASE_ADDRESSES.chainlink.btcUsd,
      cbBtcUsd: process.env.NEXT_PUBLIC_CHAINLINK_CBBTC_USD ?? BASE_ADDRESSES.chainlink.cbBtcUsd,
      usdcUsd: process.env.NEXT_PUBLIC_CHAINLINK_USDC_USD ?? BASE_ADDRESSES.chainlink.usdcUsd,
    },
    accounts: [],
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface LoadDeploymentsOptions {
  /** Defaults to NEXT_PUBLIC_DEPLOYMENTS_URL or '/deployments/local.json'. */
  url?: string;
  /** Injectable fetch (tests / server). */
  fetch?: typeof fetch;
  /** Disable the env fallback (default: enabled). */
  allowEnvFallback?: boolean;
}

/** Fetch `/deployments/local.json`; on any failure fall back to `deploymentsFromEnv()`. */
export async function loadDeployments(options: LoadDeploymentsOptions = {}): Promise<LoadedDeployments> {
  const url = options.url ?? DEPLOYMENTS_URL;
  const fetchImpl = options.fetch ?? fetch;
  let fileError: string;
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) throw new DeploymentsError(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    return { deployments: parseDeployments(json), source: 'file', url };
  } catch (e) {
    fileError = errorMessage(e);
  }
  if (options.allowEnvFallback === false) throw new DeploymentsError(`Could not load ${url}: ${fileError}`);
  try {
    return { deployments: deploymentsFromEnv(), source: 'env', url, fileError };
  } catch (e) {
    throw new DeploymentsError(`Could not load ${url} (${fileError}); env fallback failed (${errorMessage(e)})`);
  }
}
