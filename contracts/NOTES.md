# Contracts notes

Engineering log for `contracts/`. Two routers live here:

- **`src/StrikelineRouter.sol`** — the product. Simulator + SwapVM + `StrikelineOpcodes` +
  `StrikelineViews`, adding `RmmSwap` (`0x55`) and `Coverage` (`0x93`). This is what ships.
- **`src/ProbeRouter.sol`** — the research harness that came first. Simulator + SwapVM + AquaOpcodes +
  `ProbeScale` (`0xd0`). Kept because the curve probes and the math benchmarks still run against it, and
  because it is the control in several comparisons.

Sections 1–4 below are about the shipped router. Everything from *"Probe harness"* onward is the older
harness and the API facts learned building it, which still apply to both.

---

# 1. What is asserted, and where

`test/invariants/` is the directory a reviewer should read first. 43 tests, all offline, no RPC.

| File | Tests | What it settles |
| --- | ---: | --- |
| `StrikelineCoreInvariants.t.sol` | 8 | **SwapVM's own `CoreInvariants` suite**, imported unmodified from `node_modules/@1inch/swap-vm/test/invariants/`, run against a shipped leg — symmetry, quote==swap, additivity, monotonicity, rounding-favours-maker, balance sufficiency — plus the tolerance table in §2 |
| `StrikelineLiveness.t.sol` | 8 | The one invariant the framework does **not** carry: for every (leg, amount, direction), `quote` and `swap` either both succeed with identical numbers or both revert with byte-identical return data. Asserted at every liveness edge: shipped, docked, past `Deadline`, past maturity in each direction, and at the `Coverage` bound |
| `ScaleVectors.t.sol` | 6 | USDC(6)/WETH(18) golden vectors for all six paths where the `1e12` is applied, each with an independent proof the rounding lands on the maker's side, controlled against an 18-decimal stable |
| `OpcodeLayout.t.sol` | 10 | The frozen wire format byte by byte, the flag bits, the opcode slots, the error selectors — and `test_Layout_OneByteDriftBricksTheStrategy`, which shows what encoding drift actually looks like from outside |
| `CoverageObligation.t.sol` | 3 | A `tokenOut` protocol fee is part of the maker's obligation; a `tokenIn` fee is not; both nesting orders of `Coverage`/`FeeProtocol` reach the same bound |
| `CoverageHaircut.t.sol` | 2 | `haircutBps` is bounded on the **wire**, not only in `build` |
| `RmmDomain.t.sol` | 3 | The representable domain, proved from the `uint128` widths rather than checked at run time |
| `GasReport.t.sol` | 3 | The per-instruction gas table in §3 and the EIP-170 margin |

```bash
make test-invariants     # all of the above, with their console output
make test                # the whole offline suite
make test-fork           # against the official Aqua on a real chain
```

---

# 2. The tolerance table

The framework's `CoreInvariants` ships defaults tuned for rational curves in exact integer arithmetic.
RMM-01 is transcendental. **One tolerance is loosened, two are kept, one is tightened**, and every cell is
asserted by `test_ToleranceTable`, so neither our values nor the framework's defaults can drift unnoticed.

The whole table is derived from two measured primitives (`test/probe/MathPrimitives.t.sol`, against 50-digit
mpmath references):

```
EPS_PHI       = 6.95e-8    absolute error of Gaussian.cdf, probability units, over [-8, 8]
EPS_PHI_INV   = 1.18e-6    absolute error of the Gaussian.icdf round trip, z units

EPS_EVAL      = EPS_PHI + sup(phi)·EPS_PHI_INV = 6.95e-8 + 0.39894·1.18e-6 = 5.40251890873e-7
EPS_ROUNDTRIP = 2 · EPS_EVAL                                               = 1.080503781746e-6
```

| Knob | Framework | Ours | Why |
| --- | --- | --- | --- |
| `symmetryTolerance` | 2 wei | **33,714** USDC wei | `ceil(L·K·EPS_ROUNDTRIP) / rateStable + 2` |
| | | **12,966,045,380,954** WETH wei | `ceil(L·EPS_ROUNDTRIP) / rateRisky + 2` |
| `additivityTolerance` | 0 | 0 — kept | the band is charged once per fill, so one big fill beats two by exactly one band |
| `roundingToleranceBps` | 100 (1%) | **0 — tightened** | dust must never price better than spot; inside the band it reverts instead |
| `monotonicityToleranceBps` | 0 | 0 — kept | at issue the curve is convex and the band is `EPS`-sized |
| `skipSymmetry` / `skipAdditivity` / `skipSpotPrice` | false | false | none skipped, in any run |
| `skipMonotonicity` | false | false at issue, **true once decayed** | replaced by a strictly stronger check, see below |

**`symmetryTolerance` is the only loosened value, and it is not a knob.** It is `L_in · EPS_ROUNDTRIP / rate_in`
plus one unit for each of the two quantisations the VM performs once each (exact-in floors `amountOut` to whole
`tokenOut` units; exact-out ceils `amountIn` to whole `tokenIn` units). Nothing else is added. The framework's
2 wei assumes exact integer arithmetic; one reserve round trip here crosses `Φ⁻¹` and `Φ` twice.

The headroom is printed rather than claimed. Observed miss against the derived bound:

```
USDC in     486000000 wei   miss              0   bound         33714
USDC in    2140000000 wei   miss              0   bound         33714
USDC in    5320000000 wei   miss              0   bound         33714
WETH in   0.093e18   wei    miss        1063936   bound 12966045380954
WETH in   0.514e18   wei    miss      249931316   bound 12966045380954
WETH in   1.090e18   wei    miss      379026068   bound 12966045380954
```

The worst observed miss uses **0.003%** of the bound. If that ratio ever moves, the suite is saying the error
budget moved, not that the tolerance needs raising.

**`RmmSwap.EPS` is `2e-6`**, which is `1.85 ×` `EPS_ROUNDTRIP`. That ratio is asserted by
`test_Eps_DominatesTheRoundTripErrorBound` with a floor of 1.5×, so shrinking `EPS` to let a small trade
through fails the suite rather than quietly making dust fills lossy for the maker.

**The one skip, and what replaces it.** The framework's monotonicity check compares *average* prices, and its
own comment says the flag exists for "flat rate orders". Any instrument charging a fixed premium has average
price rising with size until the premium is amortised. At issue our band is `EPS`-sized and the check passes at
0 bps. Two days in, the band is 133.49 USDC and average price keeps improving up to about 6,800 USDC — 50
bands. That is the option premium, not a pricing defect, and the amortisation point is published by
`test_Monotonicity_AmortisationPointIsPublished` rather than hidden behind the flag.

What must hold instead is that the *marginal* price is monotone, equivalently that `amountOut(amountIn)` is
concave. `test_Monotonicity_MarginalPriceIsMonotoneInsideAndOutsideTheBand` asserts it over a 40-point scan
starting **inside** the band, at zero tolerance. Together with additivity at tolerance 0, that is strictly
stronger than the statement being skipped, because it is what actually rules out a size-splitting arbitrage.

---

# 3. Gas and size

`gasleft()` deltas around real external calls on real Aqua-mode orders, on a second pass so no program is
charged for cold slots the others then find warm (`GasReport.t.sol`). Each instruction is priced as the
difference between two programs identical except for it.

| Program | quote | swap |
| --- | ---: | ---: |
| `RmmSwap . Salt` | 109,440 | 207,480 |
| `Coverage . RmmSwap . Salt` | 112,837 | 210,873 |
| `Deadline . Coverage . RmmSwap . Salt` (the shipped leg) | 113,283 | 211,317 |
| `XYCSwap . Salt` (official instruction, same router, reference) | 8,809 | 106,848 |

| Instruction | quote | swap |
| --- | ---: | ---: |
| `RmmSwap` (over `XYCSwap`) | 100,631 | 100,632 |
| `Coverage` | 3,397 | 3,393 |
| `Deadline` | 446 | 444 |

The two columns agree to within four gas, which is what view-only instructions should look like. Of `RmmSwap`'s
100,631, **99,062 is the Gaussian**: at `τ = 0` the curve degenerates to the closed form `Y = K·(L − X)` and a
quote costs 14,191.

`forge build --sizes`:

```
| StrikelineRouter | 23,664 | 25,166 | 912 | 23,986 |
```

**23,664 bytes runtime, 912 under EIP-170**, with no size override anywhere in `foundry.toml`.

> **The size that counts is the artifact's, not the one a test deploys.** `new StrikelineRouter(...)` inside a
> test file inlines the creation code into *that* compilation unit, where `via_ir`'s inlining decisions can
> differ. The gap was 14 bytes before `Coverage` gained its wire-level haircut check and is 0 now, and it moves
> when unrelated code is added to the same test file. `test_Size_RouterIsUnderEip170` asserts
> `vm.getDeployedCode(...)` and prints both.

`StrikelineOpcodes` drops `PeggedSwap` (−1,394 B) to fit. Every other official instruction is kept,
`FeeProtocol` included.

---

# 4. Deploying

```bash
make deploy RPC=https://mainnet.base.org PK=0x...
```

Two passes, because foundry writes the broadcast receipt only after a script returns, so a deploying script
cannot know its own transaction hash. The second pass reads the receipt back with `vm.getBroadcast` and writes
`deployments/<chainid>.json`. Every field is read from the chain or from the receipt; the script asserts
nothing about what it believes it deployed. `deployments/README.md` documents each field with the command that
checks it.

`RecordDeployment` refuses to write unless the recorded address answers `StrikelineViews.tauNow`, so a manifest
cannot end up pointing at a stock SwapVM deployment. That guard fired for real while writing these notes, when
the shared anvil fork was reset out from under an already-recorded broadcast.

Two code hashes, because they answer different questions. `runtimeCodeHash` is address-specific — SwapVM caches
its EIP-712 domain separator in an immutable and that separator contains `address(this)` — so it is what you
check with `cast keccak "$(cast code <addr> --rpc-url $RPC)"`. `buildCodeHash` is the build fingerprint, stable
across addresses. Measured: reformatting `src/math/Gaussian.sol` with `forge fmt`, whitespace only, identical
23,664-byte runtime, moved `buildCodeHash` from `0x2b2dbb87…` to `0x5139d6f6…`, because solc's appended CBOR
blob hashes the metadata and the metadata hashes every source file.

> `forge fmt` with no path argument reformats the **whole tree**, including files nobody asked you to touch,
> and it strips thousands separators from scientific literals (`1_940e6` → `1940e6`), which is not this repo's
> style. Pass explicit paths.

---

# Probe harness

Foundry harness for Aqua-backed SwapVM strategies executed through `src/ProbeRouter.sol`
(Simulator + SwapVM + AquaOpcodes + custom `ProbeScale` opcode at `0xd0`).

## Layout

| Path | What |
| --- | --- |
| `test/base/AquaSwapVMTestBase.sol` | Reusable abstract base: deploys Aqua (or uses `AQUA` env), WETH mock (or `WETH` env), USDC(6)/DAI(18) mocks, `ProbeRouter`; helpers `buildAquaOrder`, `shipOrder`, `dockOrder`, `takerData`, `quote`, `swapAs`, `fund`, `snapshot`, `assertSwapDelta`, `expectSwapped`, `buildProbeScale`, `rawInstruction`, `xycOut/xycIn`. |
| `test/AquaXYC.t.sol` | 19 unit tests: ship 10 WETH + 20,000 USDC XYC strategy, exactIn/exactOut both directions, FeeFlatIn, thresholds, `to` recipient, callback-taker mode, custom opcode dispatch, unknown opcode fall-through, dock semantics, fuzz quote==swap. |
| `test/fork/AquaMainnetFork.t.sol` | 5 fork tests against the OFFICIAL Aqua `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` + real WETH/USDC. Auto-skipped unless `FORK_RPC_URL` is set. |
| `src/mocks/` | `WETHMock`, `TokenMockDecimals`, `MockCallbackTaker` (ITakerCallbacks taker that pushes into Aqua itself). |
| `script/DeployProbeRouter.s.sol` | Deploys `ProbeRouter(AQUA, WETH, OWNER)`; defaults to mainnet official Aqua + WETH, overridable via env. |
| `Makefile` | `make test`, `make test-unit`, `make test-fork`, `make test-gas`. |

## Commands

```bash
cd contracts
forge build
forge test -vv                                   # unit tests; fork tests show as [SKIP]
FORK_RPC_URL=https://ethereum-rpc.publicnode.com forge test --match-path 'test/fork/*' -vv
# or: make test / make test-fork
```

Public mainnet RPCs checked on 2026-09-05: `https://ethereum-rpc.publicnode.com` and `https://eth.drpc.org` work;
`https://eth.llamarpc.com` returned HTTP 521. The whole fork suite (5 tests, fresh fork, ship + 4 swaps) runs in
about 1.4 s wall-clock on publicnode.

## API facts / surprises (current swap-vm `main`, aqua v1.0.0)

- **Hashing.** In Aqua mode `router.hash(order) == keccak256(abi.encode(order)) == Aqua.ship(...)` return value.
  The strategy bytes shipped MUST be exactly `abi.encode(order)`.
- **`Aqua.ship` moves no tokens.** Virtual balances are allowances. The maker's WALLET must hold the liquidity and
  `approve(aqua, ...)` for every token; `Aqua.pull` does `transferFrom(maker, to)` at swap time. Aqua itself never
  custodies tokens (its ERC20 balance stays 0).
- **`ship` is immutable per (maker, app, strategyHash).** Shipping the same order twice reverts
  `StrategiesMustBeImmutable`, and a docked strategy can never be re-shipped (its `tokensCount` is `0xff`, not 0).
  Use `Salt.build(...)` in the program to get a fresh hash.
- **Token order.** `MakerTraitsLib.build` requires `tokenA < tokenB` (`MakerTraitsTokensNotSorted`). The base sorts
  automatically; use `isAToB(order, tokenIn)` / `orderTokens(order)` to get the direction flag. `Aqua.ship` itself does
  NOT require sorted tokens or any particular order; `tokensCount` is `tokens.length` (max 254, `0xff` is reserved
  for DOCKED).
- **`dock` must list ALL tokens** of the strategy (`DockingShouldCloseAllTokens`), in any order. After dock:
  `rawBalances` -> `(0, 0xff)`; `safeBalances` reverts `SafeBalancesForTokenNotInActiveStrategy`. Docking never
  moves tokens.
- **`safeBalances` error names the FIRST token it checks.** The router calls
  `AQUA.safeBalances(maker, router, hash, tokenIn, tokenOut)`, so quote/swap on a docked strategy revert naming
  `tokenIn`, not the order's tokenA. (Caught on the fork where USDC < WETH by address.)
- **Taker modes in Aqua orders.** EOA takers set `useTransferFromAndAquaPush = true` (router does
  `transferFrom(taker)` then `Aqua.push`; taker must approve the ROUTER). With it false the taker must be a contract
  implementing `ITakerCallbacks.preTransferInCallback` with `hasPreTransferInCallback = true` and push into Aqua
  itself, otherwise `AquaBalanceInsufficientAfterTakerPush`.
- **Aqua-mode maker constraints.** `receiver` must be `address(0)`/maker and `shouldUnwrapWeth` must be false
  (`MakerTraitsCustomReceiverIsIncompatibleWithAqua`, `MakerTraitsUnwrapIsIncompatibleWithAqua`).
- **`quote` is `external` non-view on SwapVM** but `view` on `ISwapVM`; call `ISwapVM(address(router)).quote(...)` or
  `router.asView().quote(...)`. The base uses the former so a `vm.expectRevert` placed right before `quote(...)` binds
  to the right call (`asView()` would otherwise consume it).
- **`FeeFlatIn` BPS is 1e7**, so 0.3% = `30_000`. Fee stays with the maker: taker pays the full `amountIn`, curve
  runs on `amountIn - fee`.
- **Custom opcode dispatch works.** `ProbeRouter._runOpcode` handles `0xd0` and falls through to
  `AquaOpcodes._runOpcode` (verified: an `0xd1` instruction reverts `AquaOpcodes.UnknownOpcode(0xd1)`).
- **KNOWN BUG in `src/instructions/ProbeScale.sol` (not modified per instructions).** `ProbeScale.build()` ends with
  `return start.resolve();` but `MemoryPtrLib.resolve` is strict and must be called on the END pointer; it always
  reverts `MemoryPtrStrictResolveFailed(end, current)`. One-line fix: `return ptr.resolve();` (as `XYCSwap.build`,
  `FeeFlatIn.build` do). Until then use `AquaSwapVMTestBase.buildProbeScale(factor)`, which produces the exact bytes
  `d0 04 <uint32 factor>` and is what all tests use. `ProbeScale.exec` itself is correct.
- **`deal()` works for mocks and mainnet WETH/USDC** (stdstore finds the balance slot through USDC's proxy), so the
  base's `fund()` is chain-agnostic.

## Live-liquidity proof on a Base fork (`test/fork/live/`, `test/fork/v102/`)

Qualification rule #1 proof: a taker fills REAL, LIVE maker strategies through the OFFICIAL, UNMODIFIED
`AquaSwapVMRouter` v1.0.2 (`0x111111338c5091E8440b67B168bAe16a668AC0De`) against the OFFICIAL Aqua
(`0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`) on a Base (8453) fork pinned at block **50946000**, and in the
same suite our `ProbeRouter` is deployed against the SAME registry, a strategy is shipped to it and filled, and
per-app scoping of the registry is proven in both directions.

| Path | What |
| --- | --- |
| `test/fork/v102/ISwapVMV102.sol` | ABI of the deployed router ("World A"): 5-arg `quote/swap` (`0x44aa5f14`/`0xf4d2d412`), `Order{maker,uint256 traits,bytes data}`, `Swapped`, `ProtocolFeeSkipped`, `TxOriginTokenBalanceIsZero`, `eip712Domain`. |
| `test/fork/v102/TakerTraitsV102.sol` | Dependency-free port of the tag's `TakerTraitsLib.build` (20-byte slice table + 2-byte flags; 7 flags, no `isAToB`/`allowPartialFill`). Golden vector asserted: `build(default)` == `0x00…0041` == SDK `TakerTraits.default().encode()`. |
| `test/fork/live/LiveBaseStrategies.sol` | 3 live `Shipped` payloads (exact bytes, hashes, makers, ship blocks/txs, ledger balances at the pinned block) + Base addresses (KycNFT `0x26FF…a468`, a RES holder, protocol-fee recipient). |
| `test/fork/live/AquaBaseLiveFork.t.sol` | 6 tests (below). Skips cleanly when no RPC is set **or the RPC is not Base**, so `FORK_RPC_URL=<ethereum rpc>` (used by `AquaMainnetFork.t.sol`) leaves them `[SKIP]`. |

```bash
cd contracts
FORK_RPC_URL=https://gateway.tenderly.co/public/base forge test --match-path 'test/fork/live/*' -vv
# alternatives: BASE_FORK_RPC_URL=… (takes precedence); BASE_FORK_BLOCK=0 forks the head instead of 50946000
# fallback RPC verified: https://mainnet.base.org (archive at the pinned block) — 6/6 pass, ~1 s
```

Verified 2026-09-06 (Tenderly gateway, block 50946000; also 6/6 at head 50947438 and 6/6 via mainnet.base.org):

| Test | Live strategy (maker / hash) | Result |
| --- | --- | --- |
| `test_Live_0_…` | all three | router `eip712Domain` = "1inch SwapVM v1.0" / "1.0.2"; `keccak256(strategy) == officialRouter.hash(order) == strategyHash`; KYC-gate presence decoded from bytes; ledgers match the pinned constants. |
| `test_Live_A1_Ungated_EOAMaker` | `0xFD40Ce00…aD18` / `0xb5a7193e…29fb` (concentrated 2000-2100, 10 % flat fee) | permissionless EOA (0 RES) sells 0.0005 WETH → 923,159 USDC-units; `Pulled`/`Pushed`/`Swapped` asserted; taker, maker-wallet and Aqua-ledger deltas exact; quote == swap; **swap gas 137,619**. Amount picked by a ladder capped at min(ledger, wallet, allowance) — this maker's book is only ~1 USDC deep. |
| `test_Live_A2_Ungated_ContractMakerWithHooks` | `0x1a09f7d9…88Ec` (18 KB contract, pre-transfer-out + post-transfer-in hooks) / `0x99f8041e…3838` (0.3 % flat fee + XYC) | permissionless EOA sells **0.05 WETH → 27,591,104 USDC-units**; quote equals the value recomputed from the decoded program (ceil fee + XYC on the live ledger); maker wallet holds 0 USDC — its hook sources USDC just-in-time from `0xb367a430…3a4e`; **swap gas 786,249**. |
| `test_Live_A3_Gated_RESHolder` | `0x2467eBaF…Cd17` / `0xb7c20070…c5c3` (1inch dApp: KycNFT gate, 0.0125 % aqua protocol fee, concentrated 1875-2091, 0.05 % flat fee) | non-holder is rejected on quote AND swap with `TxOriginTokenBalanceIsZero(taker, KycNFT)`; `vm.prank(holder, holder)` (tx.origin = real RES holder `0x3E4798B0…67c1`) sells **0.05 WETH → 104,178,436 USDC-units**; `ProtocolFeeSkipped` (fee 6.25e12 wei > 6.8e11 WETH ledger) so maker wallet +0.05 WETH exactly; **swap gas 148,771**. |
| `test_Live_B_OurRouter_…AppIsolation` | our maker, ProbeRouter | ship 1 WETH / 2,480 USDC XYC to the official Aqua with `app = ProbeRouter`; 0.05 WETH → 118,095,238 USDC-units, **gas 108,267**; both routers hash the order identically (`OFFICIAL.hash(v102Order) == router.hash(order)`) yet `safeBalances(maker, OFFICIAL, hash)` reverts `SafeBalancesForTokenNotInActiveStrategy`, official `quote`/`swap` on our order revert the same way, a direct `aqua.pull` from the official router's address panics (underflow), and symmetrically our router cannot read/pull the live strategy. |
| `test_Live_C_OneWallet_TwoApps_OneRegistry` | live maker `0x2467eBaF…Cd17` | the live dApp maker (pranked, **no new approve** — its mainnet allowance to Aqua is already max) ships a second XYC strategy to OUR router; the taker fills it (22,545,454 USDC-units) and the RES holder then fills the maker's official-router strategy (20,882,179); the same wallet paid both, and each app's ledger moved only by its own fill. |

Facts learned about the deployed router / live books:
- **`quote` succeeding does not mean `swap` will.** The three ungated EOA books on Base (all maker `0xFD40…`) hold
  ~1-2 USDC in the ledger but concentrated liquidity quotes 55 USDC for 0.1 WETH; `swap` then reverts inside
  `Aqua.pull` (Panic 0x11 ledger underflow) or `SafeTransferFromFailed` (wallet/allowance). Fillable size =
  min(Aqua ledger, wallet balance, allowance to Aqua) of tokenOut — compute it before quoting.
- 159/436 Base strategies are ungated, but only 3 ungated WETH/USDC books were active and wallet-backed at the
  pinned block (all tiny). The deepest genuinely fillable WETH/USDC book (`0xb7c20070…`, ~$1.98k ledger, ~895 USDC
  wallet) is KycNFT-gated: the gate reads `tx.origin`, so a fork demo needs `vm.prank(holder, holder)` /
  `anvil_impersonateAccount` of a RES holder (quote via `eth_call` must also set `from`).
- `aquaProtocolFeeAmountInXD` is best-effort: it `try`s `Aqua.pull(maker, hash, tokenIn, fee, to)` and emits
  `ProtocolFeeSkipped` when the ledger cannot cover it; the taker still pays the full `amountIn` and the maker keeps it.
- Maker hooks work through the official router with plain EOA taker traits (A2): a contract maker with
  `hasPreTransferOutHook` pulled inventory from an external vault mid-swap; the fill costs ~5.7x the gas of an EOA maker.
- Both routers compute `keccak256(abi.encode(order))` for Aqua orders, so the SAME hash exists under two apps; Aqua
  scopes every balance by `(maker, app, strategyHash, token)` and never checks that `app` is a known contract.
- Foundry gotchas: NatSpec parses `@word` inside `///` comments as a tag (use `//` for narrative comments
  mentioning `@1inch/...` or `@block`); `vm.skip` belongs in the test/modifier, so the chain-id guard sets a flag in
  `setUp` and the `onlyFork` modifier skips.
