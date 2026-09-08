# Router size budget: how many SwapVM opcodes fit under EIP-170 next to `AquaOpcodes`

Measured 2026-09-06 against `1inch/swap-vm` HEAD `f09a41e689240adc645934f965c8061749397cd2` (2026-09-03, "Merge pull request #180 … remove-progressive-fees"), solc 0.8.30 (`0.8.30+commit.73712a01`), `optimizer=true, optimizer_runs=700, via_ir=true, evm_version=cancun` (the swap-vm repo's own `foundry.toml` settings plus an explicit `evm_version`; artifacts' metadata confirms all four). Tooling: forge/cast `1.0.0-dev` (7461390b, 2025-04-30), anvil `1.1.0-nightly` (a63dbe2936, 2025-04-30). All byte counts are **runtime** bytes from `forge build --sizes` and were re-checked from `out/<C>.sol/<C>.json` `deployedBytecode.object` lengths. Every variant's initcode is exactly runtime + 1,488 B (constructor + EIP-712 strings), far under the 49,152 B EIP-3860 initcode limit, so only the runtime limit matters.

Working tree: `mywork` (generated sources `src/menu/*.sol`, `src/menu2/*.sol`; generators, logs and manifests in `tools/`). This file complements `docs/research/swapvm-custom-opcodes.md` §0.6/§8.3 (which only had the three official routers) and answers `completeness-review.md` gap G2.

## 0. TL;DR

1. **EIP-170 = 24,576 B (0x6000) of runtime code; the check is `len > 24576` fails, so exactly 24,576 is allowed** (anvil `--code-size-limit 28501` accepts a 28,501 B contract, `28500` rejects it). It is enforced today by Ethereum mainnet and Base: `eth_estimateGas` of the 28,501 B initcode against `https://mainnet.base.org` and `https://gateway.tenderly.co/public/mainnet` returns `-32003 EVM error: CreateContractSizeLimit`, against `https://ethereum-rpc.publicnode.com` `-32000 max code size exceeded` (blocks 50,929,261 / 25,914,165, 2026-09-05). Fusaka (mainnet 2025-12-03) did **not** include EIP-7907 and Glamsterdam's meta-EIP does not list it either; EIP-7907 is still Draft (§8).
2. **Fixed costs.** SwapVM engine with no opcodes at all (`Simulator + SwapVM`, dispatcher reverts) = **13,011 B**, so a real-chain router has **11,565 B** for opcodes. The 16 `AquaOpcodes` cost **7,365 B** (`AquaSwapVMRouter` = 20,376 B, **4,200 B headroom**). Inheriting `AquaOpcodes` and re-dispatching via `super._runOpcode` costs 0 B versus a flat dispatcher (`M_Base` = `E_16_AquaFlat` = `AquaSwapVMRouter` = 20,376 B).
3. **Marginal cost per requested opcode** (standalone on top of `AquaOpcodes`, ±~100 B via-IR noise): Stop 27 · Revert 59 · PrivateOrder 68 · JumpIfDirection 83 · StaticBalances 96 · WhitelistCoequal 110 · FeeFlatOut 140 · WhitelistSequential 169 · LimitSwapFullAmount 205 · RequireMinRate 212 · LimitSwap 238 · PiecewiseLinearScaleBalanceIn 239 · …Out 244 · DutchAuctionBalanceIn 276 · AdjustMinRate 296 · DutchAuctionBalanceOut 297 · InvalidateTokenIn 774 (448 without its `External` getter) · InvalidateTokenOut 778 (452) · OraclePriceAdjuster 873 · TWAPSwap 1,191 (1,073). Full table §3.
4. **All 20 requested opcodes on top of the full `AquaOpcodes` do not fit: 26,282 B (−1,706 B)**; no 19-of-20 fits either (best: minus TWAPSwap = 25,097 B). **Largest fitting sets keep 18 of 20**: minus `TWAPSwap`+`InvalidateTokenOut` = **24,477 B (99 B left)**, minus `TWAPSwap`+`OraclePriceAdjuster` = **24,238 B (338 B left)**. In task order the prefix fits through #12 `InvalidateTokenOut` = 24,547 B (29 B left). All three deploy on default anvil and estimate at ~5.43 M gas on live Base/Ethereum.
5. **The real lever is dropping unused Aqua opcodes** (§4): `FeeProtocol` 1,442 B, `PeggedSwap` 1,394 B, `XYCConcentrateSwap` 1,037 B, the four `TokenValidators` 939 B, `Decay` 883 B, `Extruction` 803 B. A "lean" base (`Jump, Deadline, XYCSwap, XYCConcentrateSwap, Salt, FeeFlatIn` = 14,763 B) **plus all 20 requested opcodes = 20,721 B (3,855 B headroom)**; plus all 24 non-Aqua opcodes of `Opcodes.sol` = **22,944 B (1,632 B headroom)**. I.e. the *only* things in the official `Opcodes` set that do not fit together are `FeeProtocol / PeggedSwap / Decay / Extruction / TokenValidators / JumpIfTokenIn|Out` alongside everything else.
6. **Position bundles** (§5.3): (c) TWAMM bundle 24,052 B fits with 524 B left; (h) Dutch-auction bundle 22,656 B (1,920 B left); (l)/#4 Liquidity-OS bundle 23,057 B (1,519 B left — room for ~one custom opcode of `ThrottleOut` size, 800 B incl. getter); the `swapvm-instructions.md §5` cheat-sheet universe (15 opcodes incl. `DynamicBalances/InvalidateBit/BaseFeeAdjuster/ValidateSeriesEpoch`) = 26,092 B does **not** fit on the full Aqua base (−1,516 B) — needs the lean base.
7. **anvil**: `--disable-code-size-limit` (or `--code-size-limit <bytes>`) lets the 28,501 B router deploy (6,259,389 gas); it works identically in fork mode because the limit is anvil's local EVM config, not something read from the forked chain (§7). Such a router **cannot be deployed to Base/Ethereum/Arbitrum/Optimism/Polygon mainnets** and a failed attempt burns the whole gas limit (the create halts with `CreateContractSizeLimit`, `gasUsed = gas limit`).

## 1. Method (reproducible)

Generator `tools/gen_menu.py` writes `src/menu/*.sol`; each variant is the official `AquaSwapVMRouter` shape with a wrapper dispatcher (this is exactly the `MyRouter` pattern in `swapvm-custom-opcodes.md §8`):

```solidity
// GENERATED by tools/gen_menu.py — e.g. src/menu/C_02_LimitSwap.sol
contract C_02_LimitSwap is Simulator, SwapVM, AquaOpcodes {
    using OpcodeOps for Opcode;
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version) { }
    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == StaticBalances.opcode.asU8()) StaticBalances.exec(ctx, args);
        else if (opcode == LimitSwap.opcode.asU8()) LimitSwap.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);          // AquaOpcodes' 16 opcodes, then UnknownOpcode
    }
    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override { _runOpcode(ctx, opcode, args); }
}
```

Instructions that have an `External` companion contract (`DynamicBalancesExternal.balance(bytes32,address)`, `InvalidateBitExternal.{bitInvalidators,invalidateBit,invalidateBits}`, `InvalidateTokenInExternal.{tokenInInvalidators,invalidateTokenIn}`, `InvalidateTokenOutExternal.{tokenOutInvalidators,invalidateTokenOut}`, `TWAPSwapExternal.twapLastSwap(bytes32)`, `ValidateSeriesEpochExternal.{seriesEpoch,seriesEpochIncrease,seriesEpochAdvance}`; see `swap-vm/src/instructions/{Balances.sol:128, Invalidators.sol:76/162/239, TWAPSwap.sol:248, SeriesEpochManager.sol:66}`) were measured both with the mixin inherited (as `Opcodes.sol:32-38` does) and without (`_noext`).

Three families were built:

| Family | Contracts | What it isolates |
|---|---|---|
| `M_Base` | AquaOpcodes only, with the override wrapper | wrapper overhead (0 B) |
| `S_<op>[_noext]` | AquaOpcodes + exactly one opcode | standalone marginal bytes; `External` getter cost |
| `C_01..C_24` | cumulative in task order (20 requested, then `DynamicBalances, InvalidateBit, BaseFeeAdjuster, ValidateSeriesEpoch`) | the "add one at a time" curve; `C_24` reproduces the official `SwapVMRouter` (28,501 vs 28,486 B, Δ15 B from dispatcher order/wrapper) |

`tools/gen_subsets.py` writes `src/menu2/*.sol`: `E_00_Engine` (no opcodes; `_dispatch` reverts), `E_16_AquaFlat` (AquaOpcodes re-typed as a flat `_dispatch`, control), `R_<family>` (AquaOpcodes minus one family, flat), `P01..P09` (subsets of the 20), `B_*` (position bundles), `L_*` (lean base). Commands:

```bash
cd scratchpad/mywork
python3 tools/gen_menu.py    && forge build --sizes > tools/build_menu.log     # 55 contracts, solc 98.8 s
python3 tools/gen_subsets.py && forge build --sizes > tools/build_subsets.log  # 30 contracts, solc 49.6 s
./tools/anvil_codesize2.sh  > tools/anvil_codesize2.out                        # §7 deploy matrix, ports 8591+
```

`forge build --sizes` prints "Runtime Margin (B)" = 24,576 − runtime; negative = undeployable on a standard EVM. (`foundry.toml` in `mywork` maps `@1inch/swap-vm/=refs/swap-vm/`, `@1inch/solidity-utils/`, `@openzeppelin/contracts/` to the swap-vm `node_modules`.)

## 2. Fixed costs and controls

| Contract | Runtime B | Margin B | Meaning |
|---|---|---|---|
| `E_00_Engine` (`Simulator, SwapVM`, dispatcher = `revert UnknownOpcode`) | **13,011** | 11,565 | engine: `SwapVM` (EIP712, OnlyWethReceiver, Rescuable, swap/quote/Aqua settlement) + `Simulator` |
| `E_16_AquaFlat` (engine + the 16 Aqua opcodes as one flat `if/else`) | 20,376 | 4,200 | = official `AquaSwapVMRouter` bit-for-bit in size |
| `M_Base` (`is AquaOpcodes`, override wrapper calling `super`) | 20,376 | 4,200 | inheritance/wrapper overhead = **0 B** |
| official `AquaSwapVMRouter` | 20,376 | 4,200 | reference (matches `swapvm-custom-opcodes.md`) |
| official `LimitSwapVMRouter` (25 opcodes, 4 External mixins) | 20,712 | 3,864 | reference |
| official `SwapVMRouter` (40 opcodes, 6 External mixins) | **28,486** | **−3,910** | undeployable on real chains |
| `C_24_ValidateSeriesEpoch` (AquaOpcodes + all 24 others, wrapper) | 28,501 | −3,925 | reproduces `SwapVMRouter` within 15 B |
| `L_00_LeanBase` (`Jump, Deadline, XYCSwap, XYCConcentrateSwap, Salt, FeeFlatIn`) | 14,763 | 9,813 | engine + 1,752 B |

So: the 16 Aqua opcodes cost 7,365 B together; the sum of the twelve single-family removals in §4 is 7,130 B, i.e. ~235 B is shared dispatcher/library code that only disappears when everything goes.

## 3. Marginal bytes per opcode (the requested 20, then the 4 extras)

`standalone` = `S_<op>` − `M_Base` (20,376). `cum. total` = `C_k`; `cum. Δ` = `C_k − C_{k−1}`. `getter` = `S_<op>` − `S_<op>_noext` (cost of the `External` view/write functions, i.e. ABI selectors + storage reads). Opcode numbers from `swap-vm/src/libs/OpcodeList.sol`.

| # | opcode (hex) | file | standalone B (+External) | without External | getter B | cum. total B | cum. Δ B | EIP-170 margin after |
|---|---|---|---|---|---|---|---|---|
| 1 | StaticBalances (0x90) | Balances.sol | 96 | – | – | 20,472 | +96 | 4,104 |
| 2 | LimitSwap (0x53) | LimitSwap.sol | 238 | – | – | 20,710 | +238 | 3,866 |
| 3 | LimitSwapFullAmount (0x54) | LimitSwap.sol | 205 | – | – | 20,898 | +188 | 3,678 |
| 4 | DutchAuctionBalanceIn (0x94) | DutchAuction.sol | 276 | – | – | 21,174 | +276 | 3,402 |
| 5 | DutchAuctionBalanceOut (0x95) | DutchAuction.sol | 297 | – | – | 21,388 | +214 | 3,188 |
| 6 | PiecewiseLinearScaleBalanceIn (0x98) | PiecewiseLinearScale.sol | 239 | – | – | 21,620 | +232 | 2,956 |
| 7 | PiecewiseLinearScaleBalanceOut (0x99) | PiecewiseLinearScale.sol | 244 | – | – | 21,672 | +52 | 2,904 |
| 8 | OraclePriceAdjuster (0xb2) | OraclePriceAdjuster.sol | **873** | – | – | 22,538 | +866 | 2,038 |
| 9 | RequireMinRate (0xb0) | MinRate.sol | 212 | – | – | 22,749 | +211 | 1,827 |
| 10 | AdjustMinRate (0xb1) | MinRate.sol | 296 | – | – | 23,059 | +310 | 1,517 |
| 11 | InvalidateTokenIn (0x41) | Invalidators.sol | **774** | 448 | 326 | 23,867 | +808 | 709 |
| 12 | InvalidateTokenOut (0x42) | Invalidators.sol | **778** | 452 | 326 | **24,547** | +680 | **29** ← last prefix that fits |
| 13 | WhitelistCoequal (0x2c) | Whitelist.sol | 110 | – | – | 24,656 | +109 | −80 |
| 14 | WhitelistSequential (0x2d) | Whitelist.sol | 169 | – | – | 24,824 | +168 | −248 |
| 15 | PrivateOrder (0x2b) | Whitelist.sol | 68 | – | – | 24,891 | +67 | −315 |
| 16 | TWAPSwap (0x9d) | TWAPSwap.sol | **1,191** | 1,073 | 118 | 25,980 | +1,089 | −1,404 |
| 17 | JumpIfDirection (0x30) | Jumps.sol | 83 | – | – | 26,151 | +171 | −1,575 |
| 18 | Stop (0x00) | Controls.sol | 27 | – | – | 26,084 | −67 (!) | −1,508 |
| 19 | Revert (0x01) | Controls.sol | 59 | – | – | 26,169 | +85 | −1,593 |
| 20 | FeeFlatOut (0x71) | FeeFlat.sol | 140 | – | – | **26,282** | +113 | **−1,706** |
| 21 | DynamicBalances (0x91) | Balances.sol | 637 | 515 | 122 | 26,900 | +618 | −2,324 |
| 22 | InvalidateBit (0x40) | Invalidators.sol | 755 | 294 | 461 | 27,651 | +751 | −3,075 |
| 23 | BaseFeeAdjuster (0xb4) | BaseFeeAdjuster.sol | 226 | – | – | 27,876 | +225 | −3,300 |
| 24 | ValidateSeriesEpoch (0x48) | SeriesEpochManager.sol | 629 | 177 | 452 | 28,501 | +625 | −3,925 |

Observations:
- Standalone costs are slightly super-additive: Σ standalone (20) = 6,375 B vs actual 26,282 − 20,376 = 5,906 B (−7 %, shared helpers such as `InstructionArgs`/`BalanceLib` get de-duplicated); Σ (24) = 8,622 vs 8,125.
- via-IR layout noise is ±~100 B: adding `Stop` *shrank* `C_18` by 67 B, `PiecewiseLinearScaleBalanceOut` cost 244 B alone but only 52 B after `…In` was already present (shared `PiecewiseLinearScaleLib`). Budget with ≥150 B of slack.
- `External` getters are not free: the two `InvalidateToken*External` contracts cost 326 B each; `InvalidateBitExternal` 461 B and `ValidateSeriesEpochExternal` 452 B (three functions each). Dropping all External mixins from the 20-set saves 635 B (`P07_all20_noext` 25,647 B) — not enough on its own.
- The three big ones are `TWAPSwap` (stateful wrapper, nested `runLoop` into `LimitSwap`), `OraclePriceAdjuster` (external oracle call + decimals math) and the `InvalidateToken*` pair (storage + getters). Everything else is ≤ 300 B.

## 4. What each Aqua opcode costs (removal from the 16-opcode `AquaOpcodes`, flat dispatcher control 20,376 B)

| removed family (opcodes) | runtime B | saved B |
|---|---|---|
| FeeProtocol (0x80) | 18,934 | **1,442** |
| PeggedSwap (0x58) | 18,982 | **1,394** |
| XYCConcentrateSwap (0x51) | 19,339 | **1,037** |
| TokenValidators ×4 (0x23,0x24,0x25,0x26) | 19,437 | 939 |
| Decay (0x9c) | 19,493 | 883 |
| Extruction (0x04) | 19,573 | 803 |
| FeeFlatIn (0x70) | 20,133 | 243 |
| JumpIfTokenIn+JumpIfTokenOut (0x31,0x32) | 20,233 | 143 |
| XYCSwap (0x50) | 20,243 | 133 |
| Deadline (0x20) | 20,322 | 54 |
| Salt (0x02) | 20,346 | 30 |
| Jump (0x03) | 20,347 | 29 |

Which of these a custom router may drop is a *product* decision (`Extruction` is only needed if you want third-party extension targets on your router — pointless when you own the opcode set; `FeeProtocol` only for third-party/referrer fees; `PeggedSwap` only for stable-pair curves; `Decay` only for Mooniswap-style virtual-balance decay; `TokenValidators` only for holder-gated liquidity). None of them is required for Aqua settlement — Aqua mode is a `MakerTraits` flag handled by the engine, not an opcode (`swapvm-core.md`). Note that a program shipped to the *official* `AquaSwapVMRouter` (0x111111338c…) is a different contract; dropping opcodes from *your* router does not affect it.

## 5. Which subsets fit in 24,576 B

### 5.1 On top of the full 16-opcode `AquaOpcodes` (keeps 100 % compatibility with programs written for the official router)

| variant | opcodes on top of AquaOpcodes | runtime B | margin B | fits |
|---|---|---|---|---|
| `C_12_InvalidateTokenOut` | task-order prefix 1-12 (through InvalidateTokenOut) | 24,547 | 29 | yes (nothing else fits) |
| `P02_min_TWAP_InvOut` | **18/20**: all except TWAPSwap, InvalidateTokenOut | **24,477** | 99 | yes |
| `P03_min_TWAP_Oracle` | **18/20**: all except TWAPSwap, OraclePriceAdjuster | **24,238** | 338 | yes |
| `P05_min_Oracle_InvInOut` | 17/20 incl. TWAPSwap; minus OraclePriceAdjuster, InvalidateTokenIn/Out | 24,029 | 547 | yes |
| `P04_min_TWAP_InvInOut` | 17/20: minus TWAPSwap, InvalidateTokenIn/Out | 23,703 | 873 | yes |
| `P08_min_Oracle_TWAP_noext` | 18/20 minus TWAP, Oracle, no External getters | 23,816 | 760 | yes |
| `P01_min_TWAP` | 19/20 minus TWAPSwap | 25,097 | −521 | **no** |
| `P06_min_TWAP_noext` | 19/20 minus TWAPSwap, no External getters | 24,675 | −99 | **no** |
| `P09_min_InvInOut` | 18/20 minus InvalidateTokenIn/Out (keeps TWAP+Oracle) | 24,824 | −248 | **no** |
| `P07_all20_noext` | 20/20, no External getters | 25,647 | −1,071 | **no** |
| `C_20_FeeFlatOut` | 20/20 (+External) | 26,282 | −1,706 | **no** |

Arithmetic behind "18 is the max": to get from 26,282 down to ≤ 24,576 you must remove ≥ 1,706 B; the only single removal ≥ 1,706 does not exist (TWAPSwap is 1,185 B in context), and every pair that reaches it contains TWAPSwap (TWAP + InvalidateTokenOut = 1,805; TWAP + OraclePriceAdjuster = 2,044; TWAP + InvalidateTokenIn ≈ 1,993). Without TWAPSwap the two next-largest (Oracle 859 + InvalidateTokenOut 620 = 1,479) fall short. So **any fitting 18-subset drops TWAPSwap**; keeping TWAPSwap costs three other opcodes (`P05`).

### 5.2 Lean base (drop unused Aqua opcodes) — everything fits

| variant | base | extra opcodes | runtime B | margin B |
|---|---|---|---|---|
| `L_00_LeanBase` | Jump, Deadline, XYCSwap, XYCConcentrateSwap, Salt, FeeFlatIn (6) | – | 14,763 | 9,813 |
| `L_20_LeanFull` | lean 6 | all 20 requested (+External) | **20,721** | **3,855** |
| `L_20_LeanFull_noext` | lean 6 | all 20 requested, no External | 19,990 | 4,586 |
| `L_24_LeanEverything` | lean 6 | all 24 non-Aqua opcodes of `Opcodes.sol` (+6 External mixins) | **22,944** | **1,632** |

`L_24_LeanEverything` = the official `Opcodes` set minus {Decay, PeggedSwap, FeeProtocol, Extruction, OnlyTaker×3, OnlyTxOrigin, JumpIfTokenIn, JumpIfTokenOut} — 30 opcodes in one deployable router with 1.6 KB to spare for custom instructions. If `PeggedSwap` is needed (peg-defense position (i)), add 1,394 B → still fits only by dropping TWAPSwap or similar; if `Extruction` is needed, +803 B fits.

### 5.3 Position bundles from the catalog (on the full Aqua base)

| bundle | opcodes added to AquaOpcodes | runtime B | margin B |
|---|---|---|---|
| `B_TWAMM` — catalog (c) TWAMM/DCA | TWAPSwap, RequireMinRate, AdjustMinRate, OraclePriceAdjuster, StaticBalances, LimitSwap, InvalidateTokenIn (+2 External) | 24,052 | 524 |
| `B_Dutch` — catalog (h) Dutch auction | StaticBalances, DutchAuctionBalanceIn/Out, LimitSwap, LimitSwapFullAmount, RequireMinRate, InvalidateTokenOut, PiecewiseLinearScaleBalanceIn/Out | 22,656 | 1,920 |
| `B_LiquidityOS` — catalog (l)/#4 | StaticBalances, LimitSwap(+FullAmount), PiecewiseLinearScale In/Out, OraclePriceAdjuster, RequireMinRate, AdjustMinRate, JumpIfDirection, Stop, Revert, FeeFlatOut, WhitelistCoequal, PrivateOrder | 23,057 | 1,519 |
| `B_Instr5` — `swapvm-instructions.md §5` cheat-sheet universe | StaticBalances, DynamicBalances, InvalidateBit, InvalidateTokenIn/Out, LimitSwap, DutchAuctionBalanceIn, PiecewiseLinearScaleBalanceIn, RequireMinRate, BaseFeeAdjuster, OraclePriceAdjuster, ValidateSeriesEpoch, PrivateOrder, JumpIfDirection, Stop (+5 External) | 26,092 | **−1,516** |

Budget for *custom* opcodes on top of a bundle: `swapvm-custom-opcodes.md` measured `ThrottleOut` (one stateful opcode + one view getter, ~90 lines) at **+800 B** (`MyRouter` 21,176 − 20,376). A leaf `view` opcode without storage (e.g. the (l) `RealBalanceCap` two `IERC20` calls) should be in the 150-400 B range (compare `OnlyTakerTokenBalanceGte`-class validators: 4 of them = 939 B); an oracle-calling opcode ~900 B (`OraclePriceAdjuster` = 873 B); a curve with fixed-point `exp/ln/pow` is UNMEASURED (critic gap G6). So `B_LiquidityOS` (1,519 B) holds one `ThrottleOut`-class or two leaf custom opcodes; `B_TWAMM` (524 B) holds one leaf opcode only; `L_20_LeanFull` (3,855 B) holds ~4.

## 6. Consequences for the existing KB

- `position-catalog.md` (c) "use `SwapVMRouter`-style with `useAquaInsteadOfSignature`": a full-`Opcodes` router is undeployable on any real chain; use `B_TWAMM` (fits, 524 B left) or the lean base. The `Deadline`/`Salt` it lists are already in AquaOpcodes.
- `position-catalog.md` (h) "existing instructions cover 100 % (on the full `Opcodes` router in Aqua mode)": true functionally, but the router must be `B_Dutch`-shaped (22,656 B). Fine.
- `position-catalog.md` (l)/#4 "All the curves; `Extruction` … `RealBalanceCap`": `B_LiquidityOS` at 23,057 B keeps `PeggedSwap`, `XYCConcentrateSwap`, `Extruction` (they are in AquaOpcodes) and leaves 1,519 B for `RealBalanceCap` + `GridSwap`-class opcodes, but **not** for `TWAPSwap`/`Invalidate*` in addition. Adding a stop-loss via `OraclePriceAdjuster` is already included.
- `swapvm-instructions.md §5` cheat-sheet: the union of its rows (`B_Instr5`, 15 opcodes) does not fit on the full Aqua base; any *single* row does. If the demo needs `DynamicBalances`+`InvalidateBit`+`ValidateSeriesEpoch` (signature-mode rows) together with Aqua curves, use the lean base (`L_24_LeanEverything`, 22,944 B).
- `swapvm-custom-opcodes.md §0.6`: "extend `AquaOpcodes`/`LimitOpcodes`, not `Opcodes`" — confirmed and now quantified; also valid: extend a *flat* copy of `AquaOpcodes` with the families you do not need deleted (§4), which is what `gen_subsets.py`'s `inherit_aqua=False` mode generates.

## 7. anvil behaviour (verified, `tools/anvil_codesize2.sh`, results `tools/anvil_codesize2.out`)

Deploying `C_24_ValidateSeriesEpoch` (28,501 B runtime / 29,989 B initcode) and two fitting routers with `cast send --create` (constructor args `(AQUA, WETH_base, owner, "SwapVM", "1.0.0")`, gas limit 12 M, account 0 of the default mnemonic):

| case | anvil flags | `anvil_nodeInfo.hardFork` | result | gasUsed |
|---|---|---|---|---|
| default, 28,501 B | – | Cancun | **fail** `EVM error CreateContractSizeLimit` (tx status 0) | 12,000,000 (= gas limit, all burned) |
| default, 24,547 B (`C_12`) | – | Cancun | ok, `codeLen=24547`, `AQUA()` = registry | 5,404,489 |
| default, 24,477 B (`P02`) | – | Cancun | ok, `codeLen=24477` | 5,389,493 |
| 28,501 B | `--disable-code-size-limit` | Cancun | **ok**, `codeLen=28501`, `AQUA()` returns `0x1111113CCf…` | 6,259,389 |
| 28,501 B | `--code-size-limit 30000` | Cancun | ok | 6,259,389 |
| 28,501 B | `--code-size-limit 28501` | Cancun | ok (limit is inclusive) | 6,259,389 |
| 28,501 B | `--code-size-limit 28500` | Cancun | fail `CreateContractSizeLimit` | 12,000,000 |
| 28,501 B | `--hardfork prague` | Prague | fail `CreateContractSizeLimit` | 12,000,000 |
| 28,501 B | `--hardfork cancun` | Cancun | fail | 12,000,000 |
| 28,501 B | `--hardfork osaka` | – | anvil refuses to start: `Error: Unknown hardfork osaka` (nightly of 2025-04-30 predates Fusaka) | – |
| 28,501 B | fork Base `--fork-url https://gateway.tenderly.co/public/base --fork-block-number 50926000 --chain-id 31337 --no-rate-limit` | Cancun (forkBlock 50926000) | **fail** `CreateContractSizeLimit` | 12,000,000 |
| 24,477 B (`P02`) | same Base fork | Cancun | ok, `codeLen=24477`, `AQUA()` = registry, addr `0x2299Ab13C8390CB7E8166C4c59ea15Cf89489b70` | 5,389,493 |
| 28,501 B | same Base fork + `--disable-code-size-limit` | Cancun | **ok**, `codeLen=28501`, `AQUA()` = `0x1111113CCf…`, addr `0x2299Ab13…` | 6,259,389 |
| 28,501 B | fork Ethereum `--fork-url https://gateway.tenderly.co/public/mainnet --fork-block-number 25913600 --chain-id 31337 --no-rate-limit` | Cancun (forkBlock 25913600) | **fail** `CreateContractSizeLimit` | 12,000,000 |
| 28,501 B | same Ethereum fork + `--disable-code-size-limit` | Cancun | **ok**, `codeLen=28501`, addr `0x8ff97d99f40330769193c025cFb90f12d0c6cEd6` | 6,259,389 |

Notes:
- The failing create burns the entire gas limit (`gasUsed = 12,000,000`): `CreateContractSizeLimit` is an exceptional halt of the top-level CREATE. On a real chain a mistaken deploy attempt of an over-limit router costs ~6-12 M gas for nothing — never try it live; `cast estimate --create` first (§8).
- The first attempt in this KB's history (`tools/anvil_codesize.sh`, port 8561) reported every case as failed because port 8561 was already occupied by another agent's Base fork (`Error: Address already in use (os error 48)`); `anvil_codesize2.sh` uses ports 8591-8605 and checks `anvil_nodeInfo`. Do not `pkill anvil` in this scratchpad — forks on 8547/8551/8552/8561 belong to other agents.
- `anvil --help` (this build) documents `--code-size-limit <CODE_SIZE_LIMIT>` "EIP-170: Contract code size limit in bytes. Useful to increase this because of tests. Default: 0x6000 (~25kb)" and `--disable-code-size-limit`. Foundry tests: `forge test` enforces the same limit unless `foundry.toml` has `code_size_limit = <bytes>` / `--code-size-limit` (UNCERTAIN in this exact build — not tested; `forge build --sizes` only *warns*).

### 7.1 Fork-mode results

- **The forked chain does not decide the limit — anvil does.** In fork mode anvil executes with its *own* revm configuration: `anvil_nodeInfo` reports `hardFork: Cancun` for both the Base and the Ethereum fork even though the remote chains are past Fusaka (2025-12-03), and the code-size check is the local `--code-size-limit`/`--disable-code-size-limit` setting (default 0x6000). Hence: default fork → `CreateContractSizeLimit` for 28,501 B; `--disable-code-size-limit` → deploys and answers `AQUA()` with the canonical registry address read lazily from the fork; the 24,477 B router deploys on the default fork with no flags (5,389,493 gas, identical to the non-fork number).
- Consequently "does the fork enforce EIP-170 or a Fusaka/EIP-7907 raised limit?" is the wrong question for anvil: it enforces whatever its flag says, on a Cancun EVM. What the *real* chains enforce was checked directly against live nodes in §8 (they reject > 24,576 B).
- Deploy gas is the same on fork and non-fork (6,259,389 B-router / 5,389,493 P02), i.e. ≈ 200 gas/byte code-deposit (24,477 × 200 = 4.9 M) + ~0.5 M init; Base's per-tx gas cap and 140 M+ block limit are not a constraint. The contract address differs between forks only because account 0's nonce differs (Base fork: `0x2299Ab13…`; Ethereum fork: `0x8ff97d99…`; fresh anvil: `0x5FbDB231…`).
- `--hardfork osaka` is not accepted by this anvil build (`Error: Unknown hardfork osaka`) — upgrade foundry if a Fusaka-era EVM (`CLZ`, EIP-7825 tx-gas cap 2^24) matters for the demo; it does not change the code-size limit either way (Fusaka has no EIP-7907, §8).

## 8. Real chains: EIP-170 is enforced today; no raised limit is live or scheduled

Evidence 1 — live `eth_estimateGas` of the same initcode (`cast estimate --from 0xf39F… --create <initcode+args>`), 2026-09-05 (`tools/live_estimate.out`):

| RPC | chain | 28,501 B router | 24,477 B router (`P02`) |
|---|---|---|---|
| `https://mainnet.base.org` (op-geth) | 8453, block 50,929,261 | `error code -32003: EVM error: CreateContractSizeLimit` | **5,433,434 gas** |
| `https://base.drpc.org` | 8453 | HTTP 408 free-plan timeout on the big payload | 5,433,434 gas |
| `https://gateway.tenderly.co/public/mainnet` | 1, block 25,914,165 (ts 1788647867) | `-32003: EVM error: CreateContractSizeLimit` | 5,433,434 gas |
| `https://ethereum-rpc.publicnode.com` (geth) | 1 | `-32000: max code size exceeded` | 5,433,434 gas |

So the nodes serving Base and Ethereum mainnet reject > 24,576 B code in their current EVM; the fitting router costs ≈ 5.43 M gas to deploy (≈ 200 gas/byte code-deposit + init). Arbitrum/Optimism/Polygon were not probed but all inherit EIP-170 (no known deviation; UNCERTAIN only in the sense of not measured here).

Evidence 2 — protocol status (eips.ethereum.org, fetched 2026-09-06; summaries, re-verify before quoting):
- **EIP-7907 "Meter Contract Code Size And Increase Limit"**: Status **Draft**; proposes 65,536 B (64 KiB) code / 131,072 B initcode with per-byte metering; `FORK_BLKNUM: TBD`; names no fork.
- **EIP-7607 Fusaka meta (Final)**: mainnet activation epoch 411,392, timestamp 1,764,798,551 = 2025-12-03 21:49:11 UTC; included EIPs 7594, 7823, 7825, 7883, 7917, 7918, 7934, 7939, 7951 (+ 7892, 7642, 7910, 7935). **EIP-7907 is not in Fusaka.**
- **EIP-7773 Glamsterdam meta**: scheduled-for-inclusion list 2780, 7688, 7708, 7732, 7778, 7843, 7928, 7954, 7976, 7981, 7997, 8024, 8037, 8038, 8045, 8061, 8246, 8282 (+ networking 7975, 8070, 8136, 8159, 8189); **no EIP-7907**; no mainnet activation time populated yet as of the fetch.

Conclusion: as of 2026-09-06 the limit on every target chain is 24,576 B and nothing scheduled raises it; the hackathon rule "redeployments of a modified SwapVM contract is allowed" therefore implies a router ≤ 24,576 B if it is ever to leave the fork. Forks with `--disable-code-size-limit` are acceptable for the demo ("local forks are ok") but say so explicitly in the README.

## 9. Rules of thumb for budgeting a hackathon router

1. Start from `AquaSwapVMRouter` (20,376 B, 4,200 B free) and add ≤ ~3,500 B of official opcodes + custom opcodes, keeping ≥ 300 B slack for optimizer noise and the Debug variants (`AquaSwapVMRouterDebug` is 23,805 B — Debug opcodes cost ~3,430 B; you cannot have Debug + much else).
2. Cheapest useful additions: `StaticBalances` 96, `LimitSwap` 238, `LimitSwapFullAmount` +188, `RequireMinRate` 212, `AdjustMinRate` ~300, `DutchAuctionBalanceIn/Out` ~275/215, `PiecewiseLinearScaleBalanceIn/Out` ~235/50, `Whitelist*/PrivateOrder` 68-169, `JumpIfDirection/Stop/Revert` ≤ 85, `FeeFlatOut` 140, `BaseFeeAdjuster` 226.
3. Expensive: `TWAPSwap` ~1,100-1,200, `OraclePriceAdjuster` ~870, each `InvalidateToken*` ~680-810 (drop the `External` mixin to save 326 each, but then nobody can read/reset invalidators on-chain), `InvalidateBit` ~750 (294 without External), `DynamicBalances` ~620, `ValidateSeriesEpoch` ~625 (177 without External).
4. Need more than ~4 KB? Copy `AquaOpcodes._runOpcode` into your router as a flat dispatcher and delete `FeeProtocol` (−1,442), `PeggedSwap` (−1,394), `Decay` (−883), `Extruction` (−803), `TokenValidators` (−939), `JumpIfTokenIn/Out` (−143), `XYCConcentrateSwap` (−1,037, only if you do not need the concentrated curve). With all of them gone, every opcode in `Opcodes.sol` plus ~1.6 KB of custom code fits.
5. Do not count on `--disable-code-size-limit` for anything that must run on the official chains; count on it freely for the local-fork demo, and document it.
6. Always check the final number with `forge build --sizes` (or `python3 -c "import json;print((len(json.load(open('out/X.sol/X.json'))['deployedBytecode']['object'])-2)//2)"`) and, before any real deployment, `cast estimate --rpc-url <chain> --from <you> --create <initcode>`.

## 10. UNCERTAIN / not measured

- Bytes for a fixed-point curve opcode (PRBMath/solady `exp/ln/pow`, bisection): not measured (critic G6). Expect 1-3 KB.
- Whether `forge test` in this build honours `code_size_limit` in `foundry.toml`; the fork tests in `swapvm-aqua-tests.md` pass with `AquaSwapVMRouter`-sized routers so it has not mattered.
- Whether any L2 in the target list (Arbitrum Nitro, Polygon PoS) has a different code-size limit: not probed; Base/Ethereum verified.
- The official on-chain router bytecode (`router_eth.bin`, v1.0.2) is ~20.5 KB and older than HEAD; HEAD sizes above apply to *redeployed* routers only.
- EIP page summaries came through a fetch/summarisation step; the "not in Fusaka / not in Glamsterdam" claims match the primary evidence (live nodes still reject > 24,576 B) but re-read the meta-EIPs if you cite them in the README.

## 11. Files

- `scratchpad/mywork/tools/gen_menu.py`, `tools/menu_manifest.json`, `tools/build_menu.log` — 55 contracts (`M_Base`, 30× `S_*`, 24× `C_*`), sizes table.
- `scratchpad/mywork/tools/gen_subsets.py`, `tools/subsets_manifest.json`, `tools/build_subsets.log` — 30 contracts (`E_*`, `R_*`, `P0*`, `B_*`, `L_*`).
- `scratchpad/mywork/src/menu/*.sol`, `src/menu2/*.sol` — generated sources; `out/<C>.sol/<C>.json` — artifacts (metadata: solc 0.8.30, runs 700, cancun, viaIR).
- `scratchpad/mywork/tools/anvil_codesize2.sh`, `tools/anvil_codesize2.out`, `tools/anvil_cs2_*.log` — anvil deploy matrix; `tools/anvil_diag_{default,disabled}.log` — first single-case proof (`Contract created: 0x5FbDB2315678afecb367f032d93F642f64180aa3`, gas 6,259,389 with the flag; `EVM error CreateContractSizeLimit` without).
- `scratchpad/mywork/tools/live_estimate.out` — live-chain `eth_estimateGas` evidence.
- Sources: `refs/swap-vm/src/opcodes/{AquaOpcodes,LimitOpcodes,Opcodes}.sol`, `src/routers/*.sol`, `src/libs/OpcodeList.sol`, `src/SwapVM.sol:30,95,368`.

## 12. MEASURED (2026-09-06, this repo): fixed-point curve opcodes — closes critic gap G6

Measured with `forge build --sizes` in `/Users/kirillrybkov/Desktop/project/contracts` (solc 0.8.30, via_ir, 700 runs) and `forge test --match-path 'test/probe/*'`:

| Router | Runtime B | EIP-170 margin | Verdict |
|---|---|---|---|
| `ProbeRouter` (AquaOpcodes + 1 trivial opcode) | 20,434 | +4,142 | baseline |
| `CurveProbeRouterSolady` (AquaOpcodes + RMM-01 + weighted curve on solady `FixedPointMathLib`) | **23,966** | **+610** | **FITS — use solady** |
| `CurveProbeRouterPRB` (same curves on `@prb/math` UD60x18) | 25,884 | **−1,308** | does NOT fit — reject PRBMath |

**Decision: use `solady` `FixedPointMathLib` (`lnWad`, `expWad`, `powWad`, `sqrtWad`) for any curve needing fractional powers / Gaussians.** PRBMath costs ~1.9 KB more for the same math.

Accuracy + gas (49 probe tests pass, reference values from Python mpmath in the test comments):
- **RMM-01 (covered-call replicating curve, Φ/Φ⁻¹ via A&S erfc + Newton):** exactIn risky→stable 657k gas, exactOut 667k; stable→risky 666k/659k. Relative error vs reference ≈ 5e-12 … 1e-11 (e.g. 198.981316885147759151 vs 198.982243947718798931 DAI).
- **Weighted / LBP curve (`pow` on balance ratio):** ~349k gas all four directions; equal weights reproduce XYCSwap to 1e-19; error vs reference ≈ 1e-16.
- Both are well inside a Base block (30M gas) and cheap in USD on Base (~$0.01 at 0.005 gwei).

Implication for design: an options (RMM-01) or weighted-LBP position is **feasible on-chain as a custom opcode**, but only with solady and only with ~600 B to spare on the full Aqua opcode set — drop `FeeProtocol` (−1,442), `PeggedSwap` (−1,394), `Decay` (−883) or `Extruction` (−803) from the dispatcher to buy room for a second custom opcode.
