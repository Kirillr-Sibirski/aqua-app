/**
 * Put the replayed tape on the chain, and read the price back off it.
 *
 * The bot's reference price is an `eth_call` to the Chainlink ETH/USD proxy address on Base. On the fork
 * that address holds a mock (installed by `scripts/fork/oracle.ts`), and this module keeps the mock's
 * answer equal to the round the real aggregator published at the tape time the fork clock maps to. So
 * the number the bot trades against is a chain read of a real Chainlink round, and the presenter has no
 * knob.
 *
 * Nothing in the *pricing* path reads it. `RmmSwap` is oracle-free: the curve's shape comes from K,
 * sigma, T, L and `block.timestamp`, full stop. The feed is only how the arbitrageur decides what is
 * mispriced -- which is exactly the job an oracle does for a real arbitrageur.
 */
import type { Address } from 'viem';
import { ADDR, publicClient } from '../fork/lib.ts';
import { readFeed, setOraclePrice } from '../fork/oracle.ts';
import type { Tape, TapeReading } from './tape.ts';

export interface FeedSync extends TapeReading {
  /** What `latestRoundData()` reports after the write -- read back, never assumed. */
  onChainAnswer: bigint;
  feed: Address;
  /** True when the mock had to be moved (the tape advanced to a new round). */
  moved: boolean;
}

/** Advance the fork's ETH/USD feed to the tape round in force at `forkTs`. */
export async function syncFeed(tape: Tape, forkTs: bigint | number, feed: Address = ADDR.chainlink.ethUsd): Promise<FeedSync> {
  const reading = tape.at(forkTs);
  const before = await readFeed(feed);
  const moved = before.answer !== reading.answer;
  if (moved) await setOraclePrice(feed, reading.answer);
  const after = await readFeed(feed);
  if (after.answer !== reading.answer) {
    throw new Error(`feed ${feed} reports ${after.answer}, tape says ${reading.answer}`);
  }
  return { ...reading, onChainAnswer: after.answer, feed, moved };
}

/** The reference price as the bot sees it: `latestRoundData().answer`, scaled to WAD. */
export async function referencePriceWad(feed: Address = ADDR.chainlink.ethUsd): Promise<{ priceWad: bigint; answer: bigint; decimals: number; updatedAt: bigint }> {
  const r = await publicClient.readContract({
    address: feed,
    abi: [
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
      { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
    ] as const,
    functionName: 'latestRoundData',
  });
  const decimals = await publicClient.readContract({
    address: feed,
    abi: [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }] as const,
    functionName: 'decimals',
  });
  const answer = r[1];
  return { priceWad: answer * 10n ** BigInt(18 - decimals), answer, decimals, updatedAt: r[3] };
}
