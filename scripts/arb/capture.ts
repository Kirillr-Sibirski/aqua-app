/**
 * Capture the REAL Chainlink ETH/USD round history from Base and write it to `series/base-ethusd.json`.
 *
 * The arb bot's price reference has to be a real market tape, not a slider the presenter moves: a bot trading
 * its own curve against its own knob is a puppet show. So we read the actual aggregator rounds that Chainlink
 * published on Base in the days leading up to the pinned fork block, store them with their round ids, and
 * replay them against the fork clock (see `tape.ts`).
 *
 * Reads are pinned to `--block` (default 50946000, the same block `scripts/fork/start.sh` forks from), so two
 * runs a month apart produce byte-identical output: `getRoundData` is historical storage, and reading it at a
 * fixed block fixes the answer. Requires an archive-capable Base RPC (the public Tenderly gateway is one).
 *
 *   tsx scripts/arb/capture.ts                       # ~9 days ending at block 50946000
 *   tsx scripts/arb/capture.ts --days 12 --block 50946000
 *   BASE_RPC_URL=https://... tsx scripts/arb/capture.ts
 *
 * The proxy round id packs `phaseId << 64 | aggregatorRoundId`; we walk the aggregator round id down from the
 * one that was current at the pinned block and stop when the phase runs out or the window is covered.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { SERIES_PATH, type PriceSeries, type PriceTick } from './tape.ts';

const AGGREGATOR_PROXY: Address = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'; // Chainlink ETH/USD, Base
const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';
const DEFAULT_BLOCK = 50_946_000n;
const DEFAULT_DAYS = 9;
const BATCH = 80;

const CANDIDATE_RPCS = [
  process.env.BASE_RPC_URL,
  process.env.ANVIL_FORK_URL,
  'https://gateway.tenderly.co/public/base',
  'https://mainnet.base.org',
  'https://base.drpc.org',
].filter((u): u is string => typeof u === 'string' && u.length > 0);

const aggregatorAbi = [
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
  {
    type: 'function',
    name: 'getRoundData',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

async function pickRpc(): Promise<string> {
  for (const url of CANDIDATE_RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json()) as { result?: string };
      if (json.result && BigInt(json.result) === 8453n) return url;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(`no working Base RPC among: ${CANDIDATE_RPCS.join(', ')}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let blockNumber = DEFAULT_BLOCK;
  let days = DEFAULT_DAYS;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--block') blockNumber = BigInt(argv[++i]);
    else if (argv[i] === '--days') days = Number(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }

  const rpcUrl = await pickRpc();
  const client = createPublicClient({ chain: base, transport: http(rpcUrl, { batch: true }) }) as PublicClient;
  const read = { address: AGGREGATOR_PROXY, abi: aggregatorAbi } as const;

  const [latest, decimals, description] = await Promise.all([
    client.readContract({ ...read, functionName: 'latestRoundData', blockNumber }),
    client.readContract({ ...read, functionName: 'decimals', blockNumber }),
    client.readContract({ ...read, functionName: 'description', blockNumber }),
  ]);
  const headRoundId = latest[0];
  const phaseId = headRoundId >> 64n;
  const headAggRound = headRoundId & ((1n << 64n) - 1n);
  const endTs = Number(latest[3]);
  const startTs = endTs - days * 86_400;

  process.stdout.write(
    `source ${rpcUrl}\n` +
      `feed   ${AGGREGATOR_PROXY} "${description}" ${decimals} decimals\n` +
      `head   phase ${phaseId} round ${headAggRound} @ ${endTs} (${new Date(endTs * 1000).toISOString()}) ` +
      `= $${(Number(latest[1]) / 10 ** decimals).toFixed(2)}\n` +
      `window ${days} days back to ${startTs} (${new Date(startTs * 1000).toISOString()})\n`,
  );

  const rounds: Array<{ roundId: bigint; t: number; answer: bigint }> = [];
  let cursor = headAggRound;
  let done = false;
  while (!done && cursor > 0n) {
    const ids: bigint[] = [];
    for (let i = 0; i < BATCH && cursor - BigInt(i) > 0n; i++) ids.push((phaseId << 64n) | (cursor - BigInt(i)));
    cursor -= BigInt(ids.length);

    const results = await client.multicall({
      contracts: ids.map((roundId) => ({ ...read, functionName: 'getRoundData' as const, args: [roundId] as const })),
      multicallAddress: MULTICALL3,
      blockNumber,
      allowFailure: true,
    });

    for (const r of results) {
      if (r.status !== 'success') {
        done = true; // phase start: `getRoundData` reverts below the aggregator's first round
        break;
      }
      const [roundId, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      const t = Number(updatedAt);
      rounds.push({ roundId, t, answer });
      if (t <= startTs) {
        done = true;
        break;
      }
    }
    process.stdout.write(`  ${rounds.length} rounds, oldest ${rounds[rounds.length - 1]?.t}\r`);
  }

  rounds.reverse(); // oldest first
  if (rounds.length < 2) throw new Error(`captured only ${rounds.length} rounds`);
  for (let i = 1; i < rounds.length; i++) {
    // The compact `[t, answer]` layout derives every round id from the first one.
    if (rounds[i].roundId !== rounds[i - 1].roundId + 1n) {
      throw new Error(`round ids are not consecutive at index ${i} (${rounds[i - 1].roundId} -> ${rounds[i].roundId})`);
    }
    if (rounds[i].t <= rounds[i - 1].t) throw new Error(`updatedAt is not strictly increasing at index ${i}`);
  }

  const ticks: PriceTick[] = rounds.map((r) => [r.t, r.answer.toString()] as const);
  const answers = rounds.map((r) => Number(r.answer) / 10 ** decimals);
  const series: PriceSeries = {
    description:
      'Chainlink ETH/USD aggregator rounds published on Base, read at a pinned block so the capture is reproducible.',
    chainId: 8453,
    feed: AGGREGATOR_PROXY,
    feedDescription: description,
    decimals,
    phaseId: Number(phaseId),
    readAtBlock: Number(blockNumber),
    firstRoundId: rounds[0].roundId.toString(),
    firstTimestamp: rounds[0].t,
    lastTimestamp: rounds[rounds.length - 1].t,
    ticks,
  };

  // Hand-rolled so every tick is one diffable line: 1,400+ rounds pretty-printed as objects is 7k lines of noise.
  const meta = Object.fromEntries(Object.entries(series).filter(([k]) => k !== 'ticks'));
  const head = JSON.stringify(meta, null, 2).replace(/\n\}$/, '');
  const body = ticks.map((tick) => `    ${JSON.stringify(tick)}`).join(',\n');
  mkdirSync(dirname(SERIES_PATH), { recursive: true });
  writeFileSync(SERIES_PATH, `${head},\n  "ticks": [\n${body}\n  ]\n}\n`);

  const span = series.lastTimestamp - series.firstTimestamp;
  process.stdout.write(
    `\n${ticks.length} rounds over ${(span / 86_400).toFixed(2)} days ` +
      `(one every ${Math.round(span / (ticks.length - 1))}s on average)\n` +
      `low  $${Math.min(...answers).toFixed(2)}   high $${Math.max(...answers).toFixed(2)}   ` +
      `first $${answers[0].toFixed(2)}   last $${answers[answers.length - 1].toFixed(2)}\n` +
      `written ${SERIES_PATH}\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`capture failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
