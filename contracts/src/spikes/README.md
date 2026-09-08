# `src/spikes/` — nothing here ships

Every contract in this directory is research. None of it is deployed by `make bootstrap`,
`make smoke`, `make story-setup` or `make deploy`, all four of which build
`out/StrikelineRouter.sol/StrikelineRouter.json` and nothing else. The two custom instructions
Strikeline claims — `RmmSwap` (`0x55`) and `Coverage` (`0x93`) — are in `src/instructions/`, which
now contains those two files and no others.

It is kept, rather than deleted, for one reason: **each of these measurements is re-run by
`forge test` and re-proved by `forge build --sizes` on every build.** A number copied into a
markdown file stops being true the day solc, the optimizer settings or a dependency moves, and
nothing tells you. A number that is a failing test tells you.

There are three groups.

---

## 1. The size decision: PRBMath vs solady

`CurveProbeRouterPRB.sol` · `CurveProbeRouterSolady.sol` · `CurveProbePRB.sol` ·
`CurveProbeSolady.sol` · `GaussianPRB.sol` · `WadMathPRB.sol`

The question that had to be answered before any of this was worth building: **does an RMM-01 curve
fit inside a SwapVM router that still carries the whole `AquaOpcodes` set, under EIP-170's 24,576
runtime bytes?** The curve needs `exp`, `ln`, `pow`, `sqrt` and a Gaussian CDF and its inverse, none
of which the VM provides.

Two identical routers were built — same opcode set, same curve, same four direction/exactness cases
— differing only in the fixed-point library underneath. `forge build --sizes`, solc 0.8.30,
`via_ir`, `optimizer_runs = 700`, `evm_version = cancun`:

| Router | Runtime B | EIP-170 margin | |
|---|---:|---:|---|
| `ProbeRouter` (`AquaOpcodes` + one trivial opcode) | 20,434 | +4,142 | the floor: what the official set alone costs |
| `CurveProbeRouterSolady` (+ RMM-01 + weighted, on solady `FixedPointMathLib`) | **23,966** | **+610** | **fits** |
| `CurveProbeRouterPRB` (the same curves on `@prb/math` UD60x18) | 25,884 | **−1,308** | does not fit |

PRBMath costs ~1.9 KB more for the same math. That single number decided the backend, and the
610 B of headroom left over is what forced `StrikelineOpcodes` to drop `PeggedSwap` (−1,394 B) to
make room for the second custom instruction. The shipped router lands at **23,851 B, 725 B under
the limit** — a margin that only exists because this was measured before the curve was written
rather than after.

The verdict is only as good as the compiler settings it was taken under, which is exactly why both
routers are still compiled. If a dependency bump ever makes solady the loser, the table above
changes on the next `forge build --sizes` instead of quietly becoming a false claim in a doc.

> **`test_RMM_*` gas numbers in this suite are not fill costs.** They read 657k–667k because a
> Foundry `gas:` figure is the whole test body: a quote, a `deal` cheatcode, two full balance
> snapshots and then the swap. The shipped leg's real cost is **113,283 quote / 211,317 swap**,
> measured as `gasleft()` deltas around the external call in
> `test/invariants/GasReport.t.sol`. Quote that one.

## 2. The error budget the tolerance table is derived from

`MathBench.sol` · `GaussianPRB.sol` · `WadMathPRB.sol`, driven by `test/probe/MathPrimitives.t.sol`

`MathBench` runs both backends' `exp`/`ln`/`pow`/`sqrt`/`Φ`/`Φ⁻¹` against 50-digit mpmath
references. Two of the numbers it produces are load-bearing everywhere else in this repo:

```
EPS_PHI     = 6.95e-8    absolute error of Gaussian.cdf over [-8, 8], probability units
EPS_PHI_INV = 1.18e-6    absolute error of the Gaussian.icdf round trip, z units
```

Every cell of the tolerance table in `NOTES.md` §2 is computed from those two, and `RmmSwap.EPS` is
sized as 1.85× the round-trip bound they imply. Delete this spike and that table stops being a
measurement and becomes an assertion. `test_Eps_DominatesTheRoundTripErrorBound` would still pass —
against a constant nobody re-derives.

## 3. `ProbeRouter` — the control, not a spike

`ProbeRouter.sol` · `ProbeScale.sol`

This one is not dead code and never was, and "probe" undersells it. It is a stock router —
`Simulator + SwapVM + AquaOpcodes` plus one trivial custom opcode (`ProbeScale`, `0xd0`) that exists
only to prove custom dispatch works and falls through correctly. It carries **neither** `RmmSwap`
nor `Coverage`, which is the whole point of it.

`AquaSwapVMTestBase` declares its `router` field as a `ProbeRouter` and deploys one in `setUp`, so
this type is load-bearing for every Foundry suite in the repo. Three places run a real one:

| Deploys and drives a real `ProbeRouter` | For |
|---|---|
| `test/AquaXYC.t.sol` (19 tests, via the base's default `setUp`) | the Aqua/SwapVM harness itself: ship, quote, swap, dock, fees, taker modes, custom-opcode dispatch and unknown-opcode fall-through |
| `test/encoding/EncodingVectors.t.sol` | the golden vectors the TypeScript encoder is checked against — `test/encoding/vectors.json` carries `"name": "ProbeRouter"` as the EIP-712 domain, and `web/src/lib/swapvm/__tests__/encoding.test.ts` reads it |
| `test/fork/live/AquaBaseLiveFork.t.sol` | `test_Live_B`: a second app on the official Base Aqua, proving the registry scopes balances per `(maker, app, strategyHash)` in both directions |

The Strikeline suites — `StrikelineBook.t.sol`, `SurfaceLens.t.sol`, `StrikelineV4Base.sol`,
`invariants/StrikelineLeg.sol` — deploy a `StrikelineRouter` and assign it to the same inherited
field (`router = ProbeRouter(payable(address(sl)))`; both are `SwapVM`, so the `ISwapVM` surface is
identical). They never execute probe code, but they will not compile without the type.

It sits under `spikes/` and not next to `StrikelineRouter.sol` because a
router named "Probe" beside the real one, with no explanation, is exactly the kind of thing that
makes a reader wonder which contract the project actually ships — and because it deploys to the
**same deterministic address** as `StrikelineRouter` from anvil account #0, answers `AQUA()` with
the official registry, and then reverts on every read the app makes. `scripts/fork/bootstrap.ts`
refuses to write a manifest for a router that cannot answer `tauNow(uint40)` for that reason.

There is no `script/DeployProbeRouter.s.sol` any more. Deploying the control router to a real chain
had no purpose, and its existence implied one.

### Known defect, deliberately unfixed

`ProbeScale.build()` ends with `return start.resolve();`, but `MemoryPtrLib.resolve` is strict and
must be called on the *end* pointer, so it always reverts `MemoryPtrStrictResolveFailed`. The
one-line fix is `return ptr.resolve();`, as `XYCSwap.build` and `FeeFlatIn.build` do. It is left
alone because the bug is a finding about the VM's builder API, recorded in `NOTES.md`, and
`AquaSwapVMTestBase.buildProbeScale(factor)` emits the exact bytes `d0 04 <uint32 factor>` that the
fixed builder would. `ProbeScale.exec` itself is correct and is what the dispatch tests exercise.

---

```bash
cd contracts
forge test --match-path 'test/probe/*' -vv   # 49 tests: the two backends, the primitives, the accuracy
forge build --sizes | grep -E 'ProbeRouter|CurveProbeRouter|StrikelineRouter'
```
