/**
 * Move the fork's clock.
 *
 *   tsx time.ts +3600        # evm_increaseTime(3600) + mine one block (quotes/eth_call see the new timestamp only after a block)
 *   tsx time.ts set 1790000000   # evm_setNextBlockTimestamp + mine
 *   tsx time.ts now          # print latest block number / timestamp
 *   tsx time.ts mine [n]     # mine n blocks (default 1)
 *
 * Note: on anvil, eth_call runs with the timestamp of the LATEST MINED block, so every time move mines a block.
 */
import { assertFork, die, log, publicClient, rpc } from './lib.ts';

export async function increaseTime(seconds: number): Promise<{ blockNumber: bigint; timestamp: bigint }> {
  await rpc('evm_increaseTime', [seconds]);
  await rpc('evm_mine', []);
  const b = await publicClient.getBlock({ blockTag: 'latest' });
  return { blockNumber: b.number, timestamp: b.timestamp };
}

export async function setNextTimestamp(ts: number): Promise<{ blockNumber: bigint; timestamp: bigint }> {
  await rpc('evm_setNextBlockTimestamp', [ts]);
  await rpc('evm_mine', []);
  const b = await publicClient.getBlock({ blockTag: 'latest' });
  return { blockNumber: b.number, timestamp: b.timestamp };
}

export async function mine(blocks = 1): Promise<bigint> {
  await rpc('anvil_mine', [`0x${blocks.toString(16)}`]);
  return publicClient.getBlockNumber();
}

const iso = (ts: bigint) => new Date(Number(ts) * 1000).toISOString();

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const before = await assertFork();
  if (!cmd || cmd === 'now') {
    log(`block ${before.blockNumber}  timestamp ${before.timestamp} (${iso(before.timestamp)})`);
    return;
  }
  if (/^[+-]?\d+$/.test(cmd)) {
    const secs = Number(cmd);
    if (secs < 0) die('anvil cannot rewind time; use snapshot.ts restore');
    const after = await increaseTime(secs);
    log(`+${secs}s: block ${before.blockNumber} -> ${after.blockNumber}, timestamp ${before.timestamp} -> ${after.timestamp} (${iso(after.timestamp)})`);
    return;
  }
  if (cmd === 'set') {
    const ts = Number(arg);
    if (!Number.isFinite(ts) || ts <= Number(before.timestamp)) die(`timestamp must be > ${before.timestamp}`);
    const after = await setNextTimestamp(ts);
    log(`set: block ${after.blockNumber}, timestamp ${after.timestamp} (${iso(after.timestamp)})`);
    return;
  }
  if (cmd === 'mine') {
    const n = await mine(arg ? Number(arg) : 1);
    log(`mined -> block ${n}`);
    return;
  }
  die(`usage: tsx time.ts +<seconds> | set <unix ts> | now | mine [n]`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => die(e instanceof Error ? e.message : String(e)));
}
