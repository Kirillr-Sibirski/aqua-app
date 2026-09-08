/**
 * Moving the fork clock, deterministically.
 *
 * Anvil normally derives a new block's timestamp from the wall clock, so an unattended fork drifts by
 * however long the presenter spent talking, and two takes of the same scene price differently. `setup.ts`
 * pins `anvil_setBlockTimestampInterval(1)`, which makes every mined block exactly one second later than
 * its parent -- and, measured, that interval takes precedence over `evm_increaseTime`, which is why time
 * moves through `evm_setNextBlockTimestamp` here instead.
 *
 * One second per block is also what makes the bot's honesty check meaningful: a fill lands exactly one
 * second after the quote it was checked against, so the difference between the two is exactly one second
 * of theta rather than an unknown amount of wall clock.
 */
import { publicClient, rpc } from '../fork/lib.ts';

export interface ClockMove {
  before: bigint;
  after: bigint;
  blockNumber: bigint;
  seconds: number;
}

/** Mine one block at exactly `timestamp`. */
export async function warpTo(timestamp: number | bigint): Promise<ClockMove> {
  const before = (await publicClient.getBlock({ blockTag: 'latest' })).timestamp;
  const target = BigInt(timestamp);
  if (target <= before) throw new Error(`cannot rewind: target ${target} is not after ${before} (use \`make story-load\`)`);
  await rpc('evm_setNextBlockTimestamp', [Number(target)]);
  await rpc('evm_mine', []);
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  if (block.timestamp !== target) throw new Error(`warp landed at ${block.timestamp}, asked for ${target}`);
  return { before, after: block.timestamp, blockNumber: block.number, seconds: Number(target - before) };
}

/** Mine one block `seconds` later than the current head. */
export async function warpBy(seconds: number): Promise<ClockMove> {
  const before = (await publicClient.getBlock({ blockTag: 'latest' })).timestamp;
  return warpTo(before + BigInt(seconds));
}
