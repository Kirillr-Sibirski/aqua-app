/**
 * Move the replay's own output into the app, and refuse to move anything that is not it.
 *
 * `contracts/test/markout/MarkoutReplay.t.sol` writes three files as it runs. This copies them into
 * `web/src/components/receipt/data/`, where the screen imports them at build time, and checks on the way
 * through that each one is what it claims to be: the right `kind`, `simulation: true`, series arrays that
 * are all the same length, and every number inside the range a JSON double carries exactly. The screen
 * therefore never has to defend itself against a malformed file, and a hand-edited number cannot reach it
 * silently -- which matters more here than anywhere else in the app, because this is the one screen whose
 * figures do not come from a chain read the reader can repeat.
 *
 *   tsx scripts/markout/publish.ts            copy and validate
 *   tsx scripts/markout/publish.ts --check    fail if the committed copies are stale
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/markout
const ROOT = resolve(HERE, '..', '..');
const FROM = resolve(ROOT, 'contracts/test/markout');
const TO = resolve(ROOT, 'web/src/components/receipt/data');

/** Beyond this a JSON number stops being an exact integer, and a dollar figure would drift silently. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

interface Artifact {
  file: string;
  kind?: string;
  /** Groups of keys whose arrays must all have the same length. */
  parallel: string[][];
}

const ARTIFACTS: Artifact[] = [
  {
    file: 'replay.json',
    kind: 'strikeline-markout-replay',
    parallel: [
      [
        'series.t',
        'series.spot6',
        'series.strikeline6',
        'series.hodl6',
        'series.cpLow6',
        'series.cpHigh6',
        'series.markout6',
        'series.upside6',
        'series.weth6',
        'series.fills',
      ],
      ['legs.label', 'legs.kind', 'legs.strike6', 'legs.liquidity6', 'legs.fills', 'legs.markout6'],
    ],
  },
  {
    file: 'sweep-sigma.json',
    parallel: [
      ['impliedVolBps', 'fills', 'netEth6', 'timeValue6', 'vsHold6', 'vsCpLow6', 'vsCpHigh6'],
    ],
  },
  {
    file: 'sweep-window.json',
    parallel: [
      [
        'offsetHours',
        'startSpot6',
        'endSpot6',
        'fills',
        'realisedVolBps',
        'vsHold6',
        'vsCpLow6',
        'vsCpHigh6',
      ],
    ],
  },
];

type Json = Record<string, unknown>;

function at(root: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Json | undefined)?.[key], root);
}

function assertNumbersFit(node: unknown, path: string): void {
  if (typeof node === 'number') {
    if (!Number.isFinite(node) || !Number.isSafeInteger(node)) {
      throw new Error(`${path} is ${node}, which a JSON double does not carry exactly`);
    }
    if (Math.abs(node) > MAX_SAFE) throw new Error(`${path} is out of the safe integer range`);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertNumbersFit(child, `${path}[${i}]`));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) assertNumbersFit(child, `${path}.${key}`);
  }
}

function validate(artifact: Artifact, parsed: Json): void {
  if (artifact.kind && parsed.kind !== artifact.kind) {
    throw new Error(`${artifact.file}: kind is ${String(parsed.kind)}, expected ${artifact.kind}`);
  }
  for (const group of artifact.parallel) {
    let length: number | undefined;
    for (const path of group) {
      const value = at(parsed, path);
      if (!Array.isArray(value)) throw new Error(`${artifact.file}: ${path} is not an array`);
      if (length === undefined) length = value.length;
      else if (value.length !== length) {
        throw new Error(`${artifact.file}: ${path} has ${value.length} entries, the group has ${length}`);
      }
    }
    if (!length) throw new Error(`${artifact.file}: ${group[0]} is empty`);
  }
  assertNumbersFit(parsed, artifact.file);
}

function main(): void {
  const check = process.argv.includes('--check');
  mkdirSync(TO, { recursive: true });

  let stale = 0;
  for (const artifact of ARTIFACTS) {
    const source = resolve(FROM, artifact.file);
    if (!existsSync(source)) {
      console.error(
        `missing ${source} -- run \`forge test --match-path 'test/markout/*'\` in contracts/ first`,
      );
      process.exit(1);
    }
    const text = readFileSync(source, 'utf8');
    validate(artifact, JSON.parse(text) as Json);

    const target = resolve(TO, artifact.file);
    if (check) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
        console.error(`web/src/components/receipt/data/${artifact.file} is stale`);
        stale++;
      }
      continue;
    }
    writeFileSync(target, text);
    console.log(`published ${artifact.file}`);
  }

  if (check) {
    if (stale > 0) process.exit(1);
    console.log('the receipt screen is showing the current replay');
  }
}

main();
