/**
 * Move a Chainlink price feed on the anvil fork (Method B from the research notes in git history, verified):
 * install `MockAggregatorV3` AT THE FEED PROXY ADDRESS with anvil_setCode, then drive it with anvil_setStorageAt.
 * The feed address never changes, so strategies/UI keep pointing at the real Chainlink address.
 * With slot1 (updatedAt) == 0 the mock reports `block.timestamp`, so staleness checks never trip — even after
 * `tsx time.ts +864000`.
 *
 *   tsx oracle.ts eth 3100                 # ETH/USD -> $3,100.00 (instant: storage write, no tx, no block)
 *   tsx oracle.ts btc 95000 --tx           # BTC/USD via a real setAnswer() tx (emits Chainlink's AnswerUpdated topic)
 *   tsx oracle.ts eth 3100 --updated-at 1788600000   # explicit stale updatedAt (to demo staleness guards)
 *   tsx oracle.ts eth                      # just print latestRoundData and whether the feed is mocked
 *   tsx oracle.ts 0x<feed> 1.02 --description "FOO / USD"
 *
 * Library use: `await setOraclePrice(feed, 3100)` — `priceUsd` as number|string is USD (8-dec answer computed),
 * as bigint it is the raw 8-dec answer.
 *
 * Mock storage layout (one full slot per field): 0 answer(int256) | 1 updatedAt (0 => block.timestamp) |
 * 2 startedAt (0 => updatedAt) | 3 roundId (0 => 1) | 4 decimals (0 => 8) | 5 version (0 => 6) | 6 description bytes32.
 * Source: scripts/fork/MockAggregatorV3.sol (solc 0.8.30, via_ir, 700 runs, cancun). Rebuild with `forge build` and
 * paste `deployedBytecode.object` into MOCK_RUNTIME.
 */
import { parseUnits, stringToHex, type Address, type Hex } from 'viem';
import { ADDR, ANVIL_ACCOUNTS, aggregatorV3Abi, assertFork, die, hex32, log, publicClient, rpc, walletFor } from './lib.ts';

export const MOCK_RUNTIME: Hex = '0x60806040526004361015610011575f80fd5b5f3560e01c8063181f5a77146103b1578063245a7bfc14610397578063313ce5671461036357806350d25bcd1461034757806354fd4d501461031a57806358303b10146102ff578063668a0f02146102e55780637284e416146102be5780637a1395aa1461029a5780638205bf6a14610280578063860f1383146101ed57806389f5df5d146101d45780639a6fc8f5146101a0578063b5ab58dc14610183578063b633620c14610160578063bc43cbaf1461015b578063e8c4be301461015b5763feaf968c146100df575f80fd5b34610157575f3660031901126101575769ffffffffffffffffffff6101026105b5565b165f546101536101106105d3565b926101196105c6565b60405194859483869360809369ffffffffffffffffffff93979692978460a088019916875260208701526040860152606085015216910152565b0390f35b5f80fd5b61042a565b3461015757602036600319011261015757602061017b6105c6565b604051908152f35b346101575760203660031901126101575760205f54604051908152f35b346101575760203660031901126101575760043569ffffffffffffffffffff81168103610157575f546101536101106105d3565b3461015757602036600319011261015757600435600655005b346101575760403660031901126101575760043560243590805f55816001555f600255600161021a6105b5565b01918260035580155f1461025757507f0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f6020425b604051908152a3005b60207f0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f9161024e565b34610157575f36600319011261015757602061017b6105c6565b346101575760203660031901126101575760043560ff811680910361015757600455005b34610157575f366003190112610157576101536102d961049a565b60405191829182610400565b34610157575f36600319011261015757602061017b6105b5565b34610157575f36600319011261015757602060405160018152f35b34610157575f366003190112610157576005548061033f575060206006604051908152f35b60209061017b565b34610157575f3660031901126101575760205f54604051908152f35b34610157575f366003190112610157576004548061038c5750602060085b60ff60405191168152f35b60ff60209116610381565b34610157575f366003190112610157576020604051308152f35b34610157575f366003190112610157576101536103ce6040610444565b601681527f4d6f636b41676772656761746f72563320312e302e30000000000000000000006020820152604051918291825b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b34610157575f3660031901126101575760206040515f8152f35b6040519190601f01601f1916820167ffffffffffffffff81118382101761046a57604052565b634e487b7160e01b5f52604160045260245ffd5b67ffffffffffffffff811161046a57601f01601f191660200190565b600654801561057d575f5b6020811080610549575b156104d8575f1981146104c4576001016104a5565b634e487b7160e01b5f52601160045260245ffd5b906104ea6104e58361047e565b610444565b82815291601f196104fa8261047e565b013660208501375f5b8181106105105750505090565b60208110156105355783518110156105355780836001921a6020828701015301610503565b634e487b7160e01b5f52603260045260245ffd5b156105355781811a60f81b7fff000000000000000000000000000000000000000000000000000000000000001615156104af565b506105886040610444565b600a81527f4d4f434b202f2055534400000000000000000000000000000000000000000000602082015290565b600354806105c35750600190565b90565b600154806105c357504290565b600254806105c357506105c36105c656fea2646970667358221220d51c48f2f8269943b3e0dfce10b33bcaf8adb34cb991603176f6930343b150ef64736f6c634300081e0033';

export const FEEDS: Record<string, { address: Address; description: string }> = {
  eth: { address: ADDR.chainlink.ethUsd, description: 'ETH / USD' },
  btc: { address: ADDR.chainlink.btcUsd, description: 'BTC / USD' },
  cbbtc: { address: ADDR.chainlink.cbBtcUsd, description: 'cbBTC / USD' },
  usdc: { address: ADDR.chainlink.usdcUsd, description: 'USDC / USD' },
};

const SLOT = { answer: 0n, updatedAt: 1n, startedAt: 2n, roundId: 3n, decimals: 4n, version: 5n, description: 6n } as const;

const mockAbi = [
  {
    type: 'function',
    name: 'setAnswer',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'answer', type: 'int256' }, { name: 'updatedAt', type: 'uint256' }],
    outputs: [],
  },
] as const;

export interface RoundData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  decimals: number;
  description: string;
}

export async function readFeed(feed: Address): Promise<RoundData & { mocked: boolean }> {
  const [rd, decimals, description, code] = await Promise.all([
    publicClient.readContract({ address: feed, abi: aggregatorV3Abi, functionName: 'latestRoundData' }),
    publicClient.readContract({ address: feed, abi: aggregatorV3Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: feed, abi: aggregatorV3Abi, functionName: 'description' }),
    publicClient.getCode({ address: feed }),
  ]);
  return { roundId: rd[0], answer: rd[1], startedAt: rd[2], updatedAt: rd[3], decimals, description, mocked: code === MOCK_RUNTIME };
}

export async function isMocked(feed: Address): Promise<boolean> {
  return (await publicClient.getCode({ address: feed })) === MOCK_RUNTIME;
}

/** Swap the proxy's code for the mock and wipe the proxy's old storage (slots 0/2 hold owner/phase otherwise). */
export async function installMock(feed: Address, opts: { description?: string; decimals?: number } = {}): Promise<void> {
  let description = opts.description;
  let decimals = opts.decimals;
  try {
    // Preserve what the real feed reports so nothing downstream notices the swap.
    const real = await readFeed(feed);
    description ??= real.description;
    decimals ??= real.decimals;
  } catch {
    /* address had no feed — use defaults */
  }
  description ??= 'MOCK / USD';
  decimals ??= 8;
  if (Buffer.byteLength(description) > 31) throw new Error('description must be <= 31 bytes');
  await rpc('anvil_setCode', [feed, MOCK_RUNTIME]);
  const writes: Array<[bigint, Hex]> = [
    [SLOT.answer, hex32(0n)],
    [SLOT.updatedAt, hex32(0n)],
    [SLOT.startedAt, hex32(0n)],
    [SLOT.roundId, hex32(0n)],
    [SLOT.decimals, hex32(BigInt(decimals))],
    [SLOT.version, hex32(6n)],
    [SLOT.description, stringToHex(description, { size: 32 })],
  ];
  for (const [slot, value] of writes) await rpc('anvil_setStorageAt', [feed, hex32(slot), value]);
}

export interface SetPriceOptions {
  /** 0n (default) => the mock reports block.timestamp (never stale). */
  updatedAt?: bigint;
  /** Send a real `setAnswer` tx (emits AnswerUpdated) instead of writing storage. */
  viaTx?: boolean;
  /** Only used when the mock is installed by this call. */
  description?: string;
  decimals?: number;
}

/**
 * Set `feed`'s price. `priceUsd` number|string = USD (e.g. 3100 or "3100.25"), bigint = raw answer in feed decimals.
 * Installs the mock on first use. Returns the round data read back from the fork.
 */
export async function setOraclePrice(feed: Address, priceUsd: number | string | bigint, opts: SetPriceOptions = {}): Promise<RoundData & { txHash?: Hex }> {
  if (!(await isMocked(feed))) await installMock(feed, opts);
  const decimals = Number(BigInt(await rpc<Hex>('eth_getStorageAt', [feed, hex32(SLOT.decimals), 'latest']))) || 8;
  const answer = typeof priceUsd === 'bigint' ? priceUsd : parseUnits(String(priceUsd), decimals);
  const updatedAt = opts.updatedAt ?? 0n;

  let txHash: Hex | undefined;
  if (opts.viaTx) {
    const wallet = walletFor(ANVIL_ACCOUNTS[0].privateKey);
    txHash = await wallet.writeContract({ address: feed, abi: mockAbi, functionName: 'setAnswer', args: [answer, updatedAt] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error(`setAnswer tx ${txHash} reverted`);
  } else {
    const prevRound = BigInt(await rpc<Hex>('eth_getStorageAt', [feed, hex32(SLOT.roundId), 'latest']));
    await rpc('anvil_setStorageAt', [feed, hex32(SLOT.answer), hex32(answer)]);
    await rpc('anvil_setStorageAt', [feed, hex32(SLOT.updatedAt), hex32(updatedAt)]);
    await rpc('anvil_setStorageAt', [feed, hex32(SLOT.roundId), hex32((prevRound === 0n ? 1n : prevRound) + 1n)]);
  }
  return { ...(await readFeed(feed)), txHash };
}

export function resolveFeed(nameOrAddress: string): { address: Address; label: string } {
  const key = nameOrAddress.toLowerCase();
  if (FEEDS[key]) return { address: FEEDS[key].address, label: `${key.toUpperCase()} (${FEEDS[key].description})` };
  if (/^0x[0-9a-fA-F]{40}$/.test(nameOrAddress)) return { address: nameOrAddress as Address, label: nameOrAddress };
  return die(`unknown feed "${nameOrAddress}" — use one of ${Object.keys(FEEDS).join(', ')} or an address`);
}

function fmtRound(r: RoundData & { mocked?: boolean }): string {
  const price = (Number(r.answer) / 10 ** r.decimals).toLocaleString('en-US', { maximumFractionDigits: r.decimals });
  return `answer=${r.answer} ($${price}, ${r.decimals} dec) roundId=${r.roundId} updatedAt=${r.updatedAt} (${new Date(Number(r.updatedAt) * 1000).toISOString()})` +
    ` description="${r.description}"${r.mocked === undefined ? '' : r.mocked ? ' [MOCK]' : ' [real Chainlink code]'}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tx') flags.tx = true;
    else if (a === '--updated-at') flags.updatedAt = argv[++i];
    else if (a === '--description') flags.description = argv[++i];
    else if (a.startsWith('--')) die(`unknown flag ${a}`);
    else positional.push(a);
  }
  const [feedArg, priceArg] = positional;
  if (!feedArg) die('usage: tsx oracle.ts <eth|btc|cbbtc|usdc|0xfeed> [priceUsd] [--tx] [--updated-at <ts>] [--description "X / USD"]');

  const fork = await assertFork();
  const { address, label } = resolveFeed(feedArg);
  const before = await readFeed(address);
  log(`feed ${label} @ ${address}  latest block ${fork.blockNumber} ts ${fork.timestamp}`);
  log(`before: ${fmtRound(before)}`);
  if (priceArg === undefined) return;

  const res = await setOraclePrice(address, priceArg, {
    viaTx: flags.tx === true,
    updatedAt: flags.updatedAt ? BigInt(flags.updatedAt as string) : 0n,
    description: typeof flags.description === 'string' ? flags.description : undefined,
  });
  const after = await readFeed(address);
  log(`after:  ${fmtRound(after)}${res.txHash ? `  tx=${res.txHash}` : ''}`);
  const latest = await publicClient.getBlock({ blockTag: 'latest' });
  if (!flags.updatedAt) {
    if (after.updatedAt !== latest.timestamp) die(`updatedAt ${after.updatedAt} != latest block timestamp ${latest.timestamp}`);
    log(`updatedAt == latest block timestamp (${latest.timestamp}) -> staleness checks pass; it tracks block.timestamp after every time move`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => die(e instanceof Error ? e.message : String(e)));
}
