/**
 * Save / restore the fork state (anvil evm_snapshot / evm_revert).
 *
 *   tsx snapshot.ts save     # take a snapshot, remember its id in scripts/fork/.snapshot.json
 *   tsx snapshot.ts restore  # revert to it, then immediately re-snapshot (ids are single-use in anvil)
 *   tsx snapshot.ts list     # show the remembered id
 *
 * Caveats (measured, see docs/research/oracle-mocking-fork.md §3.2): evm_revert also undoes anvil_setCode — take the snapshot
 * AFTER installing oracle mocks (`tsx oracle.ts eth <price>`) if you want them to survive a restore. Browser wallets
 * cache nonces; after a restore clear MetaMask's activity data for the demo account.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PATHS, assertFork, die, log, publicClient, rpc } from './lib.ts';

interface SnapshotFile {
  id: string;
  blockNumber: string;
  timestamp: string;
  takenAt: string;
}

export async function save(): Promise<SnapshotFile> {
  const id = await rpc<string>('evm_snapshot', []);
  const b = await publicClient.getBlock({ blockTag: 'latest' });
  const file: SnapshotFile = { id, blockNumber: b.number.toString(), timestamp: b.timestamp.toString(), takenAt: new Date().toISOString() };
  writeFileSync(PATHS.snapshotFile, JSON.stringify(file, null, 2) + '\n');
  return file;
}

export async function restore(): Promise<{ reverted: SnapshotFile; fresh: SnapshotFile }> {
  if (!existsSync(PATHS.snapshotFile)) die('no snapshot saved yet (tsx snapshot.ts save)');
  const prev = JSON.parse(readFileSync(PATHS.snapshotFile, 'utf8')) as SnapshotFile;
  const ok = await rpc<boolean>('evm_revert', [prev.id]);
  if (!ok) die(`evm_revert(${prev.id}) returned false — snapshot already consumed or node restarted; run save again`);
  const fresh = await save();
  return { reverted: prev, fresh };
}

async function main() {
  const cmd = process.argv[2] ?? 'list';
  await assertFork();
  if (cmd === 'save') {
    const s = await save();
    log(`snapshot ${s.id} saved at block ${s.blockNumber} (ts ${s.timestamp}) -> ${PATHS.snapshotFile}`);
  } else if (cmd === 'restore') {
    const { reverted, fresh } = await restore();
    const b = await publicClient.getBlock({ blockTag: 'latest' });
    log(`reverted to snapshot ${reverted.id} (block ${reverted.blockNumber}); now at block ${b.number}, ts ${b.timestamp}; new snapshot id ${fresh.id}`);
  } else if (cmd === 'list') {
    if (!existsSync(PATHS.snapshotFile)) log('no snapshot saved');
    else log(readFileSync(PATHS.snapshotFile, 'utf8').trim());
  } else {
    die('usage: tsx snapshot.ts save | restore | list');
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => die(e instanceof Error ? e.message : String(e)));
}
