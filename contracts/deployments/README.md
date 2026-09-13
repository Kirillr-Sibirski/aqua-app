# deployments/

One JSON manifest per chain id, written by `script/DeployStrikeline.s.sol:RecordDeployment`.

Everything in a manifest is read back from the chain or from the broadcast receipt. The script asserts
nothing about what it believes it deployed, so every field can be checked by a stranger with an RPC and
no trust in this repository.

```bash
make deploy RPC=https://mainnet.base.org PK=0x...
```

Two passes, on purpose: foundry writes the broadcast receipt only after a script returns, so a deploying
script cannot know its own transaction hash. `make deploy` runs `DeployStrikeline`, then re-runs
`RecordDeployment` on the same RPC, which reads the receipt back with `vm.getBroadcast` and writes the
manifest. That is why the hash in the file is the hash the node actually returned.

`31337.json` is gitignored: it is the local anvil fork, and every `make deploy` regenerates it.

## Schema `strikeline/deployments@1`

| Field | Where it comes from | How to check it |
|---|---|---|
| `chainId` | `block.chainid` | `cast chain-id --rpc-url $RPC` |
| `sourceCommit` / `sourceDirty` | `git rev-parse HEAD` and `git diff --quiet`, passed in by `make deploy` | `git cat-file -t <commit>`. A dirty tree is **recorded, not refused** — refusing would only buy a throwaway commit |
| `recordedAtBlock` / `recordedAtTimestamp` | the block `RecordDeployment` ran against | — |
| `fork.chainId` / `fork.block` | `FORK_CHAIN_ID` / `FORK_BLOCK` | present only on a fork; absent on a real chain |
| `aqua.address` | `AQUA` env, defaulting to the official registry | must equal `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` |
| `aqua.canonical` | `aqua == Canonical.AQUA` | **if this is `false`, the deployment is not settling through the official registry** |
| `aqua.runtimeCodeHash` | `aqua.codehash` | proves the bytecode at that address, not just the address |
| `weth.*`, `officialRouter.*` | same treatment | `officialRouter` is recorded for provenance only; Strikeline never calls it |
| `instructions` | `RmmSwap.opcode` and `Coverage.opcode`, read from the libraries | `85` = `0x55`, `147` = `0x93`. An encoder that disagrees with these produces a strategy this router will not dispatch — see `docs/OPCODES.md` |
| `contracts.StrikelineRouter.address` | `vm.getBroadcast(...).contractAddress` | |
| `…transactionHash`, `…blockNumber` | the broadcast receipt | `cast tx <hash> --rpc-url $RPC` |
| `…owner` | `router.owner()`, read off the deployed contract | `cast call <addr> "owner()(address)"` |
| `…runtimeCodeHash` | `router.codehash` | see below |
| `…buildCodeHash` | `keccak256(vm.getDeployedCode(...))` | see below |
| `…runtimeCodeSize`, `…eip170Margin` | `router.code.length`, and `24576 −` it | `cast codesize <addr> --rpc-url $RPC` |

`RecordDeployment` also refuses to write a manifest unless the recorded address answers
`StrikelineViews.tauNow`, so a file can never end up pointing at a stock SwapVM deployment or at a stale
address something else has since occupied.

## The two code hashes, and why there are two

**`runtimeCodeHash`** is `keccak256` of the code actually at the address. Reproduce it with one RPC call:

```bash
cast keccak "$(cast code 0x… --rpc-url $RPC)"
```

Use the command substitution, not a pipe: `cast keccak` takes an argument, and piping feeds the trailing
newline into the hash (`Error: odd number of digits`, or a wrong answer).

It is **not** a build fingerprint. SwapVM caches its EIP-712 domain separator in an immutable, and that
separator contains `address(this)`, so the same bytes deployed twice at two addresses have two different
runtime code hashes.

**`buildCodeHash`** is `keccak256` of the compiled artifact's deployed bytecode with immutables still
unset. That one is the build fingerprint: stable across addresses, and it moves the moment the compiler
input moves. Observed here: reformatting `src/math/Gaussian.sol` with `forge fmt` — whitespace and
thousands separators only, byte-identical semantics, identical 23,664-byte runtime — changed
`buildCodeHash` from `0x2b2dbb87…` to `0x5139d6f6…`, because solc appends a CBOR blob carrying the hash
of the metadata, and the metadata carries the hash of every source file.

To reproduce it, build with the settings in `foundry.toml` — they are the compiler input:

```
solc 0.8.30   optimizer = true   optimizer_runs = 700   via_ir = true   evm_version = "cancun"
```

then `keccak256` of `out/StrikelineRouter.sol/StrikelineRouter.json` → `deployedBytecode.object`.

## A recorded run

Against the local Base fork (anvil, chain id 31337, forking Base 8453 at block 50946000), on an earlier
build. Today's router is 23,851 B (margin 725), so the size and both code hashes below will differ on a
fresh deploy; the method does not:

```
StrikelineRouter   0x7bb773006fD109CdFc139c530AdA30bC024D8840
transactionHash    0x0c97a984db8d6ad9c893334729715b36ae7820ce8a7f5d22db9f24bc9da98a39
runtimeCodeHash    0x0ad28bce26dd6ba3479defa343885b1aa7ca2bf7e9868f2c9da4181472ef1698
buildCodeHash      0x5139d6f61b8bf30e577b490026042818c20c3b80c912c03c941633b86db7e203
runtimeCodeSize    23664        EIP-170 margin 912
aqua               0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a   canonical: true
aqua codehash      0x720bc02d220db318164dc3bade86eec1f3655bdc00fc1174de7d816a95c341f8
opcodes            85 (RmmSwap 0x55)   147 (Coverage 0x93)
```

`cast keccak "$(cast code 0x7bb7…8840 --rpc-url http://127.0.0.1:8545)"` returns
`0x0ad28bce26dd6ba3479defa343885b1aa7ca2bf7e9868f2c9da4181472ef1698`, which is the manifest's
`runtimeCodeHash`.
