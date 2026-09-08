/**
 * Bootstrap the running Base fork for the demo:
 *   (a) deploy our SwapVM router from a Foundry artifact (env ROUTER_ARTIFACT, default ProbeRouter) against the
 *       OFFICIAL Aqua 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a using anvil account #0,
 *   (b) fund anvil accounts #0-#3 (+ optional DEMO_ADDRESS, e.g. your MetaMask EOA) with ETH, WETH, USDC, cbBTC
 *       via whale impersonation, falling back to anvil_setStorageAt on the token's balance slot,
 *   (c) write web/public/deployments/local.json and scripts/fork/deployments.local.json,
 *   (d) print a summary table.
 *
 * Env: ANVIL_RPC_URL (default http://127.0.0.1:8545), ROUTER_ARTIFACT, ROUTER_NAME, ROUTER_VERSION, DEMO_ADDRESS,
 *      FUND_ETH / FUND_WETH / FUND_USDC / FUND_CBBTC (human units), FORCE_REDEPLOY=1 (ignore an existing manifest).
 * Re-running is idempotent: an existing router at the same fork block is reused, balances are topped up to target.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { encodeAbiParameters, getAddress, isAddress, keccak256, parseEther, parseUnits, type Abi, type Address, type Hex } from 'viem';
import {
  ADDR,
  ANVIL_ACCOUNTS,
  EXPECTED_CHAIN_ID,
  PATHS,
  RPC_URL,
  TOKENS,
  WHALES,
  assertFork,
  die,
  erc20Abi,
  fmt,
  hex32,
  impersonated,
  log,
  publicClient,
  rpc,
  short,
  table,
  testClient,
  walletFor,
  type Deployments,
  type TokenKey,
} from './lib.ts';

const ROUTER_ARTIFACT = resolve(process.env.ROUTER_ARTIFACT ?? PATHS.defaultRouterArtifact);
/** What the manifest records. Repo-relative, because an absolute path is true on exactly one machine
 *  and the reuse check below compares it. */
const ROUTER_ARTIFACT_REL = relative(PATHS.root, ROUTER_ARTIFACT);
const ROUTER_NAME = process.env.ROUTER_NAME ?? 'Aqua App SwapVM';
const ROUTER_VERSION = process.env.ROUTER_VERSION ?? '1';
const FORK_BLOCK = Number(process.env.ANVIL_FORK_BLOCK ?? 50946000);
/** Set FUND_VIA_STORAGE=1 to skip whale impersonation and exercise the anvil_setStorageAt fallback. */
const FORCE_STORAGE = process.env.FUND_VIA_STORAGE === '1';

const FUND = {
  eth: parseEther(process.env.FUND_ETH ?? '1000'),
  weth: parseUnits(process.env.FUND_WETH ?? '100', 18),
  usdc: parseUnits(process.env.FUND_USDC ?? '500000', 6),
  cbBtc: parseUnits(process.env.FUND_CBBTC ?? '5', 8),
};

const routerAbiMin = [
  { type: 'function', name: 'AQUA', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'WETH', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  // The one call that separates a Strikeline router from any other SwapVM router deployed against the
  // same Aqua. See `assertStrikeline` below.
  { type: 'function', name: 'tauNow', stateMutability: 'view', inputs: [{ type: 'uint40' }], outputs: [{ type: 'uint256' }] },
] as const;

// ---------------------------------------------------------------------------
// Router deployment
// ---------------------------------------------------------------------------

interface Artifact {
  abi: Abi;
  bytecode: Hex;
  contractName: string;
}

function loadArtifact(path: string): Artifact {
  if (!existsSync(path)) die(`router artifact ${path} not found — run \`cd contracts && forge build\``);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const bytecode: string | undefined = typeof raw.bytecode === 'string' ? raw.bytecode : raw.bytecode?.object;
  if (!bytecode || bytecode === '0x') die(`${path} has no creation bytecode (abstract contract or interface?)`);
  if (raw.bytecode?.linkReferences && Object.keys(raw.bytecode.linkReferences).length) die('artifact needs library linking — not supported');
  let contractName = raw.contractName as string | undefined;
  if (!contractName) {
    try {
      const meta = typeof raw.metadata === 'string' ? JSON.parse(raw.metadata) : raw.metadata;
      contractName = Object.values(meta.settings.compilationTarget)[0] as string;
    } catch {
      contractName = basename(path, '.json');
    }
  }
  return { abi: raw.abi as Abi, bytecode: bytecode as Hex, contractName: contractName! };
}

/** Map constructor params by name so both ProbeRouter(aqua,weth,owner) and AquaSwapVMRouter(aqua,weth,owner,name,version) work. */
function constructorArgs(abi: Abi, deployer: Address): { args: unknown[]; described: string } {
  const ctor = abi.find((f) => f.type === 'constructor') as { inputs: { name: string; type: string }[] } | undefined;
  const inputs = ctor?.inputs ?? [];
  const values: Record<string, unknown> = {
    aqua: ADDR.aqua,
    weth: ADDR.weth,
    owner: deployer,
    name: ROUTER_NAME,
    version: ROUTER_VERSION,
  };
  const args = inputs.map((i) => {
    const key = i.name.replace(/^_/, '').toLowerCase();
    const hit = Object.keys(values).find((k) => k.toLowerCase() === key || (k === 'aqua' && key.includes('aqua')) || (k === 'weth' && key.includes('weth')));
    if (!hit) die(`don't know how to fill constructor param "${i.name}" (${i.type}) — extend constructorArgs()`);
    return values[hit];
  });
  return { args, described: inputs.map((i, k) => `${i.name}=${String(args[k])}`).join(', ') };
}

/**
 * Refuse to write a manifest for a router the app cannot use.
 *
 * Both ProbeRouter and StrikelineRouter deploy cleanly, answer `AQUA()` with the official registry,
 * and land at the SAME address (deterministic nonce from account #0), so a fork bootstrapped with the
 * wrong artifact looks entirely healthy until every read on every screen reverts with `0x`. `tauNow`
 * is the cheapest call that only exists on `StrikelineViews`, so it is the discriminator.
 */
async function assertStrikeline(address: Address, contractName: string): Promise<void> {
  try {
    await publicClient.readContract({ address, abi: routerAbiMin, functionName: 'tauNow', args: [2_000_000_000] });
  } catch {
    die(
      `${contractName} at ${address} does not answer tauNow(uint40): it is not a Strikeline router, so the app, ` +
        `the surface and the story scenes would all read reverts.\n` +
        `  set ROUTER_ARTIFACT=contracts/out/StrikelineRouter.sol/StrikelineRouter.json (the default), or run \`make story-setup\`.`,
    );
  }
}

async function routerLooksAlive(address: Address): Promise<boolean> {
  try {
    const code = await publicClient.getCode({ address });
    if (!code || code === '0x') return false;
    const aqua = await publicClient.readContract({ address, abi: routerAbiMin, functionName: 'AQUA' });
    return aqua.toLowerCase() === ADDR.aqua.toLowerCase();
  } catch {
    return false;
  }
}

async function deployRouter(artifact: Artifact): Promise<{ address: Address; txHash: Hex; described: string; gasUsed: bigint }> {
  const deployer = ANVIL_ACCOUNTS[0];
  const wallet = walletFor(deployer.privateKey);
  const { args, described } = constructorArgs(artifact.abi, deployer.address);
  const txHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success' || !receipt.contractAddress) die(`router deployment reverted (tx ${txHash})`);
  return { address: getAddress(receipt.contractAddress), txHash, described, gasUsed: receipt.gasUsed };
}

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------

const balanceOf = (token: Address, who: Address) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who] });

async function fundViaWhale(token: TokenKey, to: Address, amount: bigint): Promise<string | null> {
  const { address } = TOKENS[token];
  for (const whale of WHALES[token]) {
    try {
      const bal = await balanceOf(address, whale);
      if (bal < amount) continue;
      if ((await publicClient.getBalance({ address: whale })) < parseEther('1')) await testClient.setBalance({ address: whale, value: parseEther('10') });
      await testClient.impersonateAccount({ address: whale }); // harmless with --auto-impersonate, required without it
      const hash = await impersonated(whale).writeContract({ address, abi: erc20Abi, functionName: 'transfer', args: [to, amount] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === 'success') return `whale ${short(whale)}`;
    } catch (e) {
      log(`    whale ${short(whale)} failed for ${TOKENS[token].symbol}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  return null;
}

const slotCache = new Map<Address, { slot: bigint; vyper: boolean }>();

/** Find the balances mapping slot by matching a known holder's balance against keccak(holder, slot) / keccak(slot, holder). */
async function findBalanceSlot(token: Address, holder: Address, known: bigint): Promise<{ slot: bigint; vyper: boolean }> {
  const cached = slotCache.get(token);
  if (cached) return cached;
  for (let i = 0n; i < 256n; i++) {
    for (const vyper of [false, true]) {
      const key = vyper
        ? keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [i, holder]))
        : keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, i]));
      const v = BigInt(await rpc<Hex>('eth_getStorageAt', [token, key, 'latest']));
      if (v === known && known !== 0n) {
        const found = { slot: i, vyper };
        slotCache.set(token, found);
        return found;
      }
    }
  }
  throw new Error(`balance slot of ${token} not found in the first 256 slots`);
}

async function fundViaStorage(token: TokenKey, to: Address, target: bigint): Promise<string> {
  const { address } = TOKENS[token];
  // Any whale works as the reference holder for slot discovery.
  let ref: { holder: Address; balance: bigint } | undefined;
  for (const w of WHALES[token]) {
    const b = await balanceOf(address, w);
    if (b > 0n) {
      ref = { holder: w, balance: b };
      break;
    }
  }
  if (!ref) throw new Error(`no reference holder with balance for ${token}`);
  const { slot, vyper } = await findBalanceSlot(address, ref.holder, ref.balance);
  const key = vyper
    ? keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [slot, to]))
    : keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [to, slot]));
  await rpc('anvil_setStorageAt', [address, key, hex32(target)]);
  if ((await balanceOf(address, to)) !== target) throw new Error(`storage write at slot ${slot} did not change balanceOf(${to})`);
  return `storage slot ${slot}${vyper ? ' (vyper layout)' : ''}`;
}

async function fundToken(token: TokenKey, to: Address, target: bigint): Promise<string> {
  const have = await balanceOf(TOKENS[token].address, to);
  if (have >= target) return 'already funded';
  const viaWhale = FORCE_STORAGE ? null : await fundViaWhale(token, to, target - have);
  if (viaWhale) return viaWhale;
  return fundViaStorage(token, to, target);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const fork = await assertFork();
  log(`fork: ${RPC_URL} chainId=${fork.chainId} block=${fork.blockNumber} ts=${fork.timestamp}`);

  for (const [name, addr] of [['Aqua', ADDR.aqua], ['official router', ADDR.officialRouter], ['WETH', ADDR.weth], ['USDC', ADDR.usdc], ['cbBTC', ADDR.cbBtc]] as const) {
    const code = await publicClient.getCode({ address: addr });
    if (!code || code === '0x') die(`${name} ${addr} has no code on this fork — is it really Base?`);
  }

  // (a) router --------------------------------------------------------------
  const artifact = loadArtifact(ROUTER_ARTIFACT);
  let router: Address | undefined;
  let deployTx: Hex | undefined;
  let deployNote = '';
  if (existsSync(PATHS.deploymentsLocal) && !process.env.FORCE_REDEPLOY) {
    const prev = JSON.parse(readFileSync(PATHS.deploymentsLocal, 'utf8')) as Deployments;
    if (prev.chainId === fork.chainId && prev.blockNumber === FORK_BLOCK && prev.routerArtifact === ROUTER_ARTIFACT_REL && (await routerLooksAlive(prev.router))) {
      router = getAddress(prev.router);
      deployNote = `reused from ${PATHS.deploymentsLocal} (set FORCE_REDEPLOY=1 to redeploy)`;
    }
  }
  if (!router) {
    const nonce = await publicClient.getTransactionCount({ address: ANVIL_ACCOUNTS[0].address });
    const d = await deployRouter(artifact);
    router = d.address;
    deployTx = d.txHash;
    deployNote = `deployed by account #0 (nonce ${nonce}) with ${artifact.contractName}(${d.described}), gas ${d.gasUsed}`;
  }
  const routerAqua = await publicClient.readContract({ address: router, abi: routerAbiMin, functionName: 'AQUA' });
  if (routerAqua.toLowerCase() !== ADDR.aqua.toLowerCase()) die(`router.AQUA() = ${routerAqua} != official Aqua`);
  await assertStrikeline(router, artifact.contractName);
  let routerWeth = 'n/a';
  let routerOwner: Address = ANVIL_ACCOUNTS[0].address;
  try {
    routerWeth = await publicClient.readContract({ address: router, abi: routerAbiMin, functionName: 'WETH' });
  } catch {
    /* v1.0.2-style routers have no WETH() getter */
  }
  try {
    routerOwner = await publicClient.readContract({ address: router, abi: routerAbiMin, functionName: 'owner' });
  } catch {
    /* ignore */
  }
  log(`router: ${router} (${artifact.contractName}) ${deployNote}`);
  log(`        AQUA()=${routerAqua} WETH()=${routerWeth} owner()=${routerOwner}${deployTx ? ` tx=${deployTx}` : ''}`);

  // (b) funding ---------------------------------------------------------------
  const targets: Deployments['accounts'] = ANVIL_ACCOUNTS.map((a) => ({ index: a.index, address: a.address, privateKey: a.privateKey, role: a.role }));
  const demo = process.env.DEMO_ADDRESS;
  if (demo) {
    if (!isAddress(demo)) die(`DEMO_ADDRESS "${demo}" is not an address`);
    if (!targets.some((t) => t.address.toLowerCase() === demo.toLowerCase())) targets.push({ index: null, address: getAddress(demo), role: 'demo wallet (MetaMask)' });
  }

  const funding: Record<string, string> = {};
  for (const t of targets) {
    log(`funding ${t.address} (${t.role})`);
    const ethBal = await publicClient.getBalance({ address: t.address });
    if (ethBal < FUND.eth) {
      await testClient.setBalance({ address: t.address, value: FUND.eth });
      funding[`${t.address}:ETH`] = 'anvil_setBalance';
    } else funding[`${t.address}:ETH`] = 'already funded';
    for (const token of ['weth', 'usdc', 'cbBtc'] as TokenKey[]) {
      const how = await fundToken(token, t.address, FUND[token]);
      funding[`${t.address}:${TOKENS[token].symbol}`] = how;
      log(`    ${TOKENS[token].symbol.padEnd(5)} ${how}`);
    }
  }

  // verify -------------------------------------------------------------------
  const rows: string[][] = [];
  for (const t of targets) {
    const [eth, weth, usdc, cbBtc] = await Promise.all([
      publicClient.getBalance({ address: t.address }),
      balanceOf(ADDR.weth, t.address),
      balanceOf(ADDR.usdc, t.address),
      balanceOf(ADDR.cbBtc, t.address),
    ]);
    if (eth < FUND.eth || weth < FUND.weth || usdc < FUND.usdc || cbBtc < FUND.cbBtc) die(`funding verification failed for ${t.address}`);
    rows.push([t.index === null ? 'demo' : `#${t.index}`, t.address, t.role, fmt(eth, 18), fmt(weth, 18), fmt(usdc, 6, undefined, 2), fmt(cbBtc, 8)]);
  }

  // (c) manifests -------------------------------------------------------------
  const bootstrapBlock = await publicClient.getBlockNumber();
  const manifest: Deployments = {
    chainId: EXPECTED_CHAIN_ID,
    rpcUrl: RPC_URL,
    blockNumber: FORK_BLOCK,
    bootstrapBlock: Number(bootstrapBlock),
    forkChainId: 8453,
    aqua: ADDR.aqua,
    officialRouter: ADDR.officialRouter,
    router,
    routerName: artifact.contractName,
    routerArtifact: ROUTER_ARTIFACT_REL,
    routerOwner,
    weth: ADDR.weth,
    usdc: ADDR.usdc,
    cbBtc: ADDR.cbBtc,
    chainlink: { ...ADDR.chainlink },
    aave: { pool: ADDR.aave.pool, addressesProvider: ADDR.aave.addressesProvider },
    accounts: targets,
    funding,
    generatedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  for (const p of [PATHS.deploymentsLocal, PATHS.deploymentsWeb]) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, json);
  }

  // (d) summary -----------------------------------------------------------------
  log('');
  log(table([
    ['chain', `${EXPECTED_CHAIN_ID} (fork of Base 8453 @ ${FORK_BLOCK}, now at block ${bootstrapBlock})`],
    ['rpc', RPC_URL],
    ['Aqua (official)', ADDR.aqua],
    ['official router', ADDR.officialRouter],
    [`router (${artifact.contractName})`, router],
    ['WETH / USDC / cbBTC', `${ADDR.weth} / ${ADDR.usdc} / ${ADDR.cbBtc}`],
    ['Chainlink ETH/USD BTC/USD USDC/USD', `${ADDR.chainlink.ethUsd} ${ADDR.chainlink.btcUsd} ${ADDR.chainlink.usdcUsd}`],
    ['Aave v3 pool', ADDR.aave.pool],
  ]));
  log(`manifests: ${PATHS.deploymentsLocal}\n           ${PATHS.deploymentsWeb}`);
  log('');
  log(table(rows, ['acct', 'address', 'role', 'ETH', 'WETH', 'USDC', 'cbBTC']));
}

main().catch((e) => die(e instanceof Error ? (e.stack ?? e.message) : String(e)));
