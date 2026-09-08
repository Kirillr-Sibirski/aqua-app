/**
 * Take one, again.
 *
 *   make story-load        # nothing shipped, wallet back at 10.4 WETH / 24,850 USDC, clock rewound
 *
 * Two mechanisms, tried in that order, because they fail differently.
 *
 * `evm_revert` is the complete rewind: block height, clock and every account, including the third-party
 * wallets scene 0 fills. It is the right answer inside a running anvil session and costs milliseconds.
 * Anvil consumes a snapshot id on revert, so a fresh one is taken immediately afterwards.
 *
 * `anvil_loadState` is the durable one: it survives restarting anvil, which is what makes the demo open
 * in a second instead of a two-minute bootstrap. But it *merges* the dump into the current state rather
 * than replacing it, so accounts the dump never held -- a stranger's wallet that scene 0 drew USDC from
 * -- stay where the last run left them. After a restart that is exactly right, because those accounts
 * are served from the fork again.
 *
 * `--dump` forces the second path; `--keep-story` leaves `.story-state.json` alone.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { rpc } from '../fork/lib.ts';
import { PATHS, check, fail, forkNow, iso, kv, loadState, out } from './lib.ts';

interface Dump {
  takenAt: string;
  blockNumber: number;
  timestamp: number;
  state: Hex;
}

interface Snapshot {
  id: string;
  takenAt: string;
  blockNumber: number;
  timestamp: number;
}

async function revert(): Promise<Snapshot | undefined> {
  if (!existsSync(PATHS.snapshot)) return undefined;
  const snap = JSON.parse(readFileSync(PATHS.snapshot, 'utf8')) as Snapshot;
  const ok = await rpc<boolean>('evm_revert', [snap.id]).catch(() => false);
  if (!ok) return undefined;
  const fresh: Snapshot = { ...snap, id: await rpc<string>('evm_snapshot', []), takenAt: new Date().toISOString() };
  writeFileSync(PATHS.snapshot, JSON.stringify(fresh, null, 2) + '\n');
  return snap;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let path = PATHS.dump;
  let keepStory = false;
  let forceDump = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--to') path = argv[++i];
    else if (argv[i] === '--keep-story') keepStory = true;
    else if (argv[i] === '--dump') forceDump = true;
    else fail(`unknown argument ${argv[i]}`);
  }

  const before = await forkNow();
  let frozen: { blockNumber: number; timestamp: number };

  const snap = forceDump ? undefined : await revert();
  if (snap) {
    check(true, `evm_revert to snapshot ${snap.id} taken at ${snap.takenAt} -- full rewind, third-party wallets included`);
    frozen = snap;
  } else {
    if (!existsSync(path)) fail(`${path} not found -- run \`make story-setup\` first`);
    const dump = JSON.parse(readFileSync(path, 'utf8')) as Dump;
    const ok = await rpc<boolean>('anvil_loadState', [dump.state]);
    check(ok, `anvil_loadState accepted ${((dump.state.length - 2) / 2 / 1024).toFixed(0)} KiB taken at ${dump.takenAt}`);
    frozen = dump;
  }

  if (!keepStory && existsSync(PATHS.storyStateBackup)) {
    copyFileSync(PATHS.storyStateBackup, PATHS.state);
    check(loadState().legs.length === 0, 'story state restored: no legs shipped');
  }

  // `anvil_setBlockTimestampInterval` is node configuration, not chain state, so neither `evm_revert` nor
  // `anvil_loadState` brings it back -- and after a restart anvil is timestamping blocks from the WALL
  // CLOCK again. Measured: three seconds of thinking time became three seconds of theta. Re-pin it here
  // and prove it with two blocks, because a demo whose numbers depend on how long the presenter talked is
  // not reproducible. The two blocks are then rewound, so this check costs the demo nothing.
  await rpc('anvil_setBlockTimestampInterval', [1]);
  const probe = await rpc<string>('evm_snapshot', []);
  const t0 = (await forkNow()).timestamp;
  await rpc('evm_mine', []);
  const t1 = (await forkNow()).timestamp;
  const pinned = t1 - t0 === 1n;
  await rpc('evm_revert', [probe]);
  check(pinned, 'one block is one second again, so the clock cannot drift with the wall clock');

  // `evm_revert` consumes the id it was given, so re-arm the retake snapshot at the state we just proved.
  writeFileSync(
    PATHS.snapshot,
    JSON.stringify({ id: await rpc<string>('evm_snapshot', []), takenAt: new Date().toISOString(), blockNumber: frozen.blockNumber, timestamp: frozen.timestamp }, null, 2) + '\n',
  );

  const after = await forkNow();
  kv([
    ['before', `block ${before.blockNumber} ts ${before.timestamp} (${iso(before.timestamp)})`],
    ['after', `block ${after.blockNumber} ts ${after.timestamp} (${iso(after.timestamp)})`],
    ['frozen at', `block ${frozen.blockNumber} ts ${frozen.timestamp} (${iso(frozen.timestamp)})`],
  ]);
  check(Number(after.timestamp) === frozen.timestamp, 'the clock is back at the frozen timestamp, so a warped scene really is undone');
  check(Number(after.blockNumber) === frozen.blockNumber, 'the block number is back at the frozen height');
  out();
}

main().catch((e: unknown) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
