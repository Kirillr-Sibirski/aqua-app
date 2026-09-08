/**
 * Shared helpers for the local Base-fork demo scripts (anvil @ chain id 31337).
 * Zero project deps besides viem; the SwapVM encoder is imported from web/src/lib/swapvm where needed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/fork
export const PATHS = {
  forkDir: HERE,
  root: resolve(HERE, '../..'),
  contracts: resolve(HERE, '../../contracts'),
  web: resolve(HERE, '../../web'),
  deploymentsLocal: resolve(HERE, 'deployments.local.json'),
  deploymentsWeb: resolve(HERE, '../../web/public/deployments/local.json'),
  snapshotFile: resolve(HERE, '.snapshot.json'),
  defaultRouterArtifact: resolve(HERE, '../../contracts/out/ProbeRouter.sol/ProbeRouter.json'),
} as const;

// ---------------------------------------------------------------------------
// Chain / RPC
// ---------------------------------------------------------------------------

export const RPC_URL: string = process.env.ANVIL_RPC_URL ?? process.env.RPC_URL ?? 'http://127.0.0.1:8545';
export const EXPECTED_CHAIN_ID = Number(process.env.ANVIL_CHAIN_ID ?? 31337);

export const anvilBase: Chain = defineChain({
  id: EXPECTED_CHAIN_ID,
  name: 'Anvil (Base fork)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: '0xca11bde05977b3631167028862be2a173976ca11' } },
});

export const publicClient = createPublicClient({ chain: anvilBase, transport: http(RPC_URL) });
export const testClient = createTestClient({ mode: 'anvil', chain: anvilBase, transport: http(RPC_URL) });

/** Wallet client for a local private key (anvil accounts). */
export function walletFor(privateKey: Hex) {
  return createWalletClient({ account: privateKeyToAccount(privateKey), chain: anvilBase, transport: http(RPC_URL) });
}

/** Wallet client that signs nothing: txs go out as eth_sendTransaction from `address` (anvil --auto-impersonate). */
export function impersonated(address: Address) {
  return createWalletClient({ account: address, chain: anvilBase, transport: http(RPC_URL) });
}

/** Raw JSON-RPC (for anvil_* methods viem does not wrap, and for exact control over params). */
export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result as T;
}

/** Exactly 32 bytes, two's complement — anvil_setStorageAt rejects anything shorter. */
export function hex32(n: bigint): Hex {
  return `0x${(n & ((1n << 256n) - 1n)).toString(16).padStart(64, '0')}`;
}

export async function assertFork(): Promise<{ chainId: number; blockNumber: bigint; timestamp: bigint }> {
  let chainId: number;
  try {
    chainId = await publicClient.getChainId();
  } catch (e) {
    throw new Error(`no node at ${RPC_URL} — start it with \`make fork\` (${(e as Error).message})`);
  }
  if (chainId !== EXPECTED_CHAIN_ID) throw new Error(`chain id ${chainId} != expected ${EXPECTED_CHAIN_ID} (${RPC_URL})`);
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  return { chainId, blockNumber: block.number, timestamp: block.timestamp };
}

// ---------------------------------------------------------------------------
// Addresses (Base mainnet; identical on the fork). Verified in docs/research/fork-stack.md §1, §5.2, §9.
// ---------------------------------------------------------------------------

export const ADDR = {
  aqua: '0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a' as Address,
  officialRouter: '0x111111338c5091e8440b67b168bae16a668ac0de' as Address,
  weth: '0x4200000000000000000000000000000000000006' as Address,
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
  cbBtc: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as Address,
  chainlink: {
    ethUsd: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70' as Address,
    btcUsd: '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F' as Address,
    cbBtcUsd: '0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D' as Address,
    usdcUsd: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B' as Address,
  },
  aave: {
    pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as Address,
    addressesProvider: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D' as Address,
    aWeth: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7' as Address,
    aUsdc: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB' as Address,
    aCbBtc: '0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6' as Address,
  },
} as const;

/** Token holders to impersonate (balances checked at the pinned block; bootstrap re-verifies and falls back). */
export const WHALES: Record<'weth' | 'usdc' | 'cbBtc', Address[]> = {
  weth: [ADDR.aave.aWeth, '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', '0xd0b53D9277642d899DF5C87A3966A349A798F224'],
  usdc: ['0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', ADDR.aave.aUsdc, '0xcDAC0d6c6C59727a65F871236188350531885C43'],
  cbBtc: [ADDR.aave.aCbBtc, '0x46e6b214b524310239732D51387075E0e70970bf'],
};

export const TOKENS = {
  weth: { address: ADDR.weth, symbol: 'WETH', decimals: 18 },
  usdc: { address: ADDR.usdc, symbol: 'USDC', decimals: 6 },
  cbBtc: { address: ADDR.cbBtc, symbol: 'cbBTC', decimals: 8 },
} as const;
export type TokenKey = keyof typeof TOKENS;

// ---------------------------------------------------------------------------
// Anvil default accounts (mnemonic "test test ... junk"). Public knowledge; only ever used on the local fork.
// ---------------------------------------------------------------------------

export interface DemoAccount {
  index: number;
  address: Address;
  privateKey: Hex;
  role: string;
}

const ANVIL_KEYS: Hex[] = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
];
const ROLES = ['deployer / router owner', 'maker (ships strategies)', 'taker (swaps)', 'spare'];

export const ANVIL_ACCOUNTS: DemoAccount[] = ANVIL_KEYS.map((privateKey, index) => ({
  index,
  address: privateKeyToAccount(privateKey).address,
  privateKey,
  role: ROLES[index],
}));

// ---------------------------------------------------------------------------
// Deployment manifest (written by bootstrap.ts, read by smoke.ts and the web app)
// ---------------------------------------------------------------------------

export interface Deployments {
  chainId: number;
  rpcUrl: string;
  /** Pinned upstream fork block. */
  blockNumber: number;
  /** Block at which bootstrap finished (router deployed, wallets funded). */
  bootstrapBlock: number;
  forkChainId: number;
  aqua: Address;
  officialRouter: Address;
  router: Address;
  routerName: string;
  routerArtifact: string;
  routerOwner: Address;
  weth: Address;
  usdc: Address;
  cbBtc: Address;
  chainlink: { ethUsd: Address; btcUsd: Address; cbBtcUsd: Address; usdcUsd: Address };
  aave: { pool: Address; addressesProvider: Address };
  accounts: Array<{ index: number | null; address: Address; privateKey?: Hex; role: string }>;
  funding: Record<string, string>;
  generatedAt: string;
}

export function loadDeployments(path: string = process.env.DEPLOYMENTS ?? PATHS.deploymentsLocal): Deployments {
  if (!existsSync(path)) throw new Error(`${path} not found — run \`make bootstrap\` first`);
  return JSON.parse(readFileSync(path, 'utf8')) as Deployments;
}

// ---------------------------------------------------------------------------
// ABIs used by several scripts
// ---------------------------------------------------------------------------

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
] as const;

export const aggregatorV3Abi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmt(amount: bigint, decimals: number, symbol?: string, fractionDigits = 4): string {
  const s = formatUnits(amount, decimals);
  const [int, frac = ''] = s.split('.');
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const f = frac.slice(0, fractionDigits).replace(/0+$/, '');
  return `${withCommas}${f ? '.' + f : ''}${symbol ? ' ' + symbol : ''}`;
}

export function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const widths = all[0].map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ');
  const out = [];
  if (header) out.push(line(header), widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

export function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

export function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}
