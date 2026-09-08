# contracts/

Foundry. The router that prices a maker's offer, the two instructions that are the contribution, and
the tests that hold them to it. Solidity 0.8.30, `via_ir`, `optimizer_runs = 700`.

Dependencies arrive through npm, not git submodules: `foundry.toml` sets `libs = ["node_modules"]`,
so `npm ci` has to run before `forge build`.

```bash
npm ci
forge build --sizes    # StrikelineRouter must stay under EIP-170. Current margin: 725 B
make test              # 167 offline tests. The 11 fork tests skip without FORK_RPC_URL
make test-fork         # those 11, against the OFFICIAL Aqua on Ethereum and Base
make test-invariants   # the 43 a reviewer should read first, with their console output
make deploy RPC=… PK=… # deploy, then re-read the broadcast receipt into deployments/<chainid>.json
```

## What is where

| | |
|---|---|
| `src/StrikelineRouter.sol` | 61 lines. A redeployed SwapVM that adds two opcodes to `_runOpcode` and nothing else |
| `src/instructions/RmmSwap.sol` (`0x55`) | The option written as a swap curve. 62 argument bytes carrying K, σ, maturity and L |
| `src/instructions/Coverage.sol` (`0x93`) | Prices the trade first, then requires the output to be deliverable from the maker's real wallet |
| `src/math/` | `Gaussian.sol` (A&S 7.1.26 erfc + bisection), `WadMath.sol` (over solady) |
| `src/SurfaceLens.sol` | Prices a whole book in one `eth_call`. A separate contract, so it spends none of the router's headroom |
| `src/hooks/` | The same curve as a Uniswap v4 hook, which is what makes the venue comparison an experiment rather than an argument |
| `src/spikes/` | `ProbeRouter` and the math benchmarks that came first. Kept because they are the control in several comparisons, not because they ship |
| `test/invariants/` | SwapVM's own `CoreInvariants` suite run against a shipped leg, the frozen wire format, the decimal vectors, the gas table |
| `test/strikeline/` | The nine claims the README makes, each one measured |
| `test/fork/` | Real WETH and USDC through the official Aqua and the official unmodified router |

## Read next

- [`NOTES.md`](NOTES.md) — the engineering log: what is asserted and where, the tolerance table, the
  gas table, and the API facts learned building against Aqua.
- [`deployments/README.md`](deployments/README.md) — the manifest schema, and how a stranger with an
  RPC checks every field in it without trusting this repository.
- [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — how these contracts fit together with Aqua,
  the taker and the read layer.
