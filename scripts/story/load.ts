/**
 * Return the fork to the frozen post-setup state in about a second.
 *
 *   make story-load        # take one again: nothing shipped, wallet at 10.4 WETH / 24,850 USDC
 *
 * `anvil_loadState` merges the dumped accounts, storage, code and block history back into the running
 * node, so the router keeps its address, the oracle mock keeps its code, every approval survives, and --
 * measured, not assumed -- the block number and the clock come back too, which is what makes it a real
 * undo for a scene that warped three days forward. The story state file is restored alongside it,
 * because a chain rewound to before the book was shipped with a `.story-state.json` that still lists
 * four legs is the one way this demo can lie.
 *
 * `--to <path>` loads a different dump; `--keep-story` leaves the story file alone (useful only when
 * debugging a scene against a dump you took yourself).
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { rpc } from '../fork/lib.ts';
import { PATHS, check, fail, forkNow, iso, kv, loadState, out } from './lib.ts';

interface Dump {
  takenAt: string;
  blockNumber: number;
  timestamp: number;
  state: Hex;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let path = PATHS.dump;
  let keepStory = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--to') path = argv[++i];
    else if (argv[i] === '--keep-story') keepStory = true;
    else fail(`unknown argument ${argv[i]}`);
  }
  if (!existsSync(path)) fail(`${path} not found -- run \`make story-setup\` first`);

  const dump = JSON.parse(readFileSync(path, 'utf8')) as Dump;
  const before = await forkNow();
  const ok = await rpc<boolean>('anvil_loadState', [dump.state]);
  check(ok, `anvil_loadState accepted ${((dump.state.length - 2) / 2 / 1024).toFixed(0)} KiB taken at ${dump.takenAt}`);

  const storyFile = `${PATHS.dumpDir}/story-state.json`;
  if (!keepStory && existsSync(storyFile)) {
    copyFileSync(storyFile, PATHS.state);
    check(loadState().legs.length === 0, 'story state restored: no legs shipped');
  }

  const after = await forkNow();
  kv([
    ['before', `block ${before.blockNumber} ts ${before.timestamp} (${iso(before.timestamp)})`],
    ['after', `block ${after.blockNumber} ts ${after.timestamp} (${iso(after.timestamp)})`],
    ['frozen at', `block ${dump.blockNumber} ts ${dump.timestamp} (${iso(dump.timestamp)})`],
  ]);
  check(Number(after.timestamp) === dump.timestamp, 'the clock is back at the frozen timestamp, so a warped scene really is undone');
  check(Number(after.blockNumber) === dump.blockNumber, 'the block number is back at the frozen height');
  out();
}

main().catch((e: unknown) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
