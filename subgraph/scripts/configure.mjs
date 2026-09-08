#!/usr/bin/env node
/**
 * Point the subgraph at a deployment.
 *
 * The router address has to appear in two places that must agree: the `StrikelineRouter` data
 * source's own address, and the `Aqua` data source's `context.router`, which is the app filter for
 * events that carry no indexed parameters. `graph build --network` substitutes only the former, so
 * this writes both, plus `networks.json`, from a deployment manifest.
 *
 *   node scripts/configure.mjs                                   # ../web/public/deployments/local.json
 *   node scripts/configure.mjs --network base --manifest ./base.json
 *
 * Idempotent, and it prints what it wrote rather than editing silently.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const network = arg('network', 'localhost');
const manifestPath = resolve(root, arg('manifest', '../web/public/deployments/local.json'));

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error(`Could not read ${manifestPath}: ${e.message}`);
  console.error('Run `make bootstrap` first, or pass --manifest <path>.');
  process.exit(1);
}

const { router, aqua } = manifest;
const startBlock = Number(manifest.bootstrapBlock ?? manifest.blockNumber ?? 0);
if (!router || !aqua) {
  console.error(`${manifestPath} has no "router" / "aqua" address.`);
  process.exit(1);
}

/**
 * Rewrite one `- kind: ethereum` block in place. The manifest is ours and its shape is fixed, so a
 * block-scoped line replacement is exact without pulling in a YAML parser that would reformat the
 * comments this file is mostly made of.
 */
function patchDataSource(yaml, name, address) {
  const blocks = yaml.split(/^(?=  - kind: ethereum$)/m);
  return blocks
    .map((block) => {
      if (!new RegExp(`^\\s*name: ${name}$`, 'm').test(block)) return block;
      return block
        .replace(/^(\s*network:\s*).*$/m, `$1${network}`)
        .replace(/^(\s*address:\s*")0x[0-9a-fA-F]{40}(")/m, `$1${address}$2`)
        .replace(/^(\s*startBlock:\s*)\d+/m, `$1${startBlock}`)
        .replace(/^(\s*data:\s*")0x[0-9a-fA-F]{40}(")/m, `$1${router}$2`);
    })
    .join('');
}

const yamlPath = resolve(root, 'subgraph.yaml');
let yaml = readFileSync(yamlPath, 'utf8');
yaml = patchDataSource(yaml, 'Aqua', aqua);
yaml = patchDataSource(yaml, 'StrikelineRouter', router);
writeFileSync(yamlPath, yaml);

const networksPath = resolve(root, 'networks.json');
const networks = JSON.parse(readFileSync(networksPath, 'utf8'));
networks[network] = {
  Aqua: { address: aqua, startBlock },
  StrikelineRouter: { address: router, startBlock },
};
writeFileSync(networksPath, `${JSON.stringify(networks, null, 2)}\n`);

console.log(`network       ${network}`);
console.log(`aqua          ${aqua}`);
console.log(`router        ${router}   (data source address and Aqua context.router)`);
console.log(`startBlock    ${startBlock}`);
console.log('\nwrote subgraph.yaml and networks.json. Next: npm run codegen && npm run build');
