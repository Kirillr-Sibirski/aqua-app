# SwapVM instruction set — knowledge base

Source: local clone of `1inch/swap-vm` at commit `f09a41e` ("Merge pull request #180 from 1inch/feature/remove-progressive-fees"), package `@1inch/swap-vm` 0.0.6, `solc 0.8.30`, `via_ir = true`, `optimizer_runs = 700` (`foundry.toml`).
Repo root used for all `file:line` references below:
`/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad/refs/swap-vm/`
Upstream: https://github.com/1inch/swap-vm (docs: `README.md`, `docs/PROGRAMS.md`, `docs/whitepaper-swap-vm-1.0.pdf`).

Everything below is read from source unless marked **UNCERTAIN**. Numeric claims about time-based opcodes were verified with a throwaway forge test (section 12).

---

## 0. TL;DR for the hackathon team

* A SwapVM **program** is a byte string of instructions `[uint8 opcode][uint8 argsLen][args…]` (`src/libs/VM.sol:125-158`). Max 255 bytes of args per instruction (`InstructionBuilder.patchLength`, `src/libs/InstructionBuilder.sol:25-29`).
* The VM has **4 mutable registers** `balanceIn, balanceOut, amountIn, amountOut` (`SwapRegisters`, `src/libs/VM.sol:50-55`), a read-only `SwapQuery {orderHash, maker, taker, tokenIn, tokenOut, isExactIn}` (`VM.sol:36-43`), a program counter, a taker-args pointer, and a `ProtocolFee` register.
* The taker supplies ONE amount (`amountIn` if `isExactIn`, else `amountOut`); the program must compute the other. After `runLoop`, `amountOut` must be `> 0` (`TakerTraitsLib.validate`, `src/libs/TakerTraits.sol:188`) and `amountIn > 0` unless `allowZeroAmountIn` (`MakerTraitsLib.validate`, `src/libs/MakerTraits.sol:173-175`).
* **No `*ArgsBuilder` helpers and no `1D/2D/XD` opcode variants exist at this revision** (grep of `src/` + `test/` returns nothing). The README's `p.build(Balances._staticBalancesXD, BalancesArgsBuilder.build(...))` snippets are stale. The current API is one Solidity `library` per instruction exposing `opcode`, `sizeOf(...)`, `build(...)` (standalone → `bytes memory`, and `MemoryPtr`-chained), `parse(...)`, `exec(Context memory, bytes calldata)`. Direction handling that used to be `1D/2D/XD` is now done inside `exec` by comparing `ctx.query.tokenIn < ctx.query.tokenOut`; args are always given in canonical order **tokenA = lower address, tokenB = higher address**.
* **Three routers, three opcode sets** (section 2). The full set (`Opcodes`) is only in `SwapVMRouter`. `AquaSwapVMRouter` (the variant the repo's deployment broadcasts name) exposes only 15 opcodes and **none** of: `StaticBalances`, `DynamicBalances`, `LimitSwap*`, `Invalidate*`, `TWAPSwap`, `DutchAuction*`, `PiecewiseLinearScale*`, `*MinRate`, `BaseFeeAdjuster`, `OraclePriceAdjuster`, `ValidateSeriesEpoch`, `Whitelist*`, `PrivateOrder`, `FeeFlatOut`, `JumpIfDirection`. Which set sits at the canonical `0x111111338c5091e8440b67b168bae16a668ac0de` is **UNCERTAIN** from this clone (section 11 has a `cast` recipe to check). The prize text allows redeploying a modified router, which sidesteps this.
* **Extruction (0x04)** is the escape hatch: a plain external `call` (`staticcall` semantics in quote mode via a `view` interface) to a maker-chosen contract that may rewrite all four registers, set the PC, and consume taker args. The reference implementation (`test/mocks/BestRouteSelector.sol`) embeds a full opcode set in the target and runs sub-programs — i.e. custom logic without redeploying the router.
* Instructions that call `ctx.runLoop()` are **wrappers**: they execute the *rest of the program* inside themselves, then post-process. Bytecode order therefore encodes nesting (section 1.4). Getting this wrong changes economics silently.
* Time-based pricing verified numerically (section 12): `DutchAuctionBalanceIn/Out` and `PiecewiseLinearScale*` get **better for the taker over time**; `TWAPSwap` as written gets **worse for the taker** by `0.9999^seconds` since the last trade (its docstring says "dutch auction" — intent **UNCERTAIN**, arithmetic is not).

---

## 1. Execution model

### 1.1 Data structures (`src/libs/VM.sol`)

```solidity
struct VM {                       // VM.sol:21-27
    bool isStaticContext;         // true in quote(), false in swap()
    uint256 nextPC;               // byte offset of next instruction (MUTABLE; jumps write it)
    CalldataPtr programPtr;       // program bytes (order.data tail)
    CalldataPtr takerArgsPtr;     // TakerTraits.instructionsArgs slice (MUTABLE; tryChopTakerArgs advances)
    function(Context memory, uint256, bytes calldata) internal dispatch; // router's _dispatch
}
struct SwapQuery {  bytes32 orderHash; address maker; address taker; address tokenIn; address tokenOut; bool isExactIn; } // VM.sol:36-43, READ-ONLY
struct SwapRegisters { uint256 balanceIn; uint256 balanceOut; uint256 amountIn; uint256 amountOut; }                    // VM.sol:50-55
struct ProtocolFee { FeeMeta meta; FeeReceiver[] receivers; uint256 feeTotal; }                                        // VM.sol:60-64
struct Context { VM vm; SwapQuery query; SwapRegisters swap; ProtocolFee fee; }                                        // VM.sol:71-76
```
Note: README mentions a fifth register `amountNetPulled`; it does not exist in code at this revision.

`ContextLib` (`VM.sol:80-159`):
* `program(ctx)`, `takerArgs(ctx)` → calldata slices.
* `setNextPC(ctx, pc)`.
* `tryChopTakerArgs(ctx, length)` → returns up to `length` bytes from the front of taker args and advances the pointer (`VM.sol:113-118`). **Only `Extruction` uses it** (grep). No built-in instruction reads taker args otherwise.
* `runLoop(ctx)` (`VM.sol:125-158`): `while (pc < program.length) { opcode = program[pc]; argsLen = program[pc+1]; args = program[pc+2 : pc+2+argsLen]; pc += 2+argsLen; require(pc <= length, RunLoopExceedProgramLength); ctx.vm.nextPC = pc; dispatch(ctx, opcode, args); pc = ctx.vm.nextPC; }` and returns `(amountIn, amountOut)`. Unknown opcode → `UnknownOpcode(opcode)` (`src/opcodes/Opcodes.sol:86`).

### 1.2 Entry points (`src/SwapVM.sol`)

`quote(order, amount, takerTraitsAndData)` (`SwapVM.sol:123-174`, `isStaticContext = true`, callable via `asView()`), `swap(...)` (`SwapVM.sol:176-243`, `payable`, transient reentrancy lock per `orderHash`). Both:
1. `orderHash = hash(order)`: Aqua mode → `keccak256(abi.encode(order))`; signature mode → EIP-712 `Order(address maker,uint256 traits,bytes data)` (`ORDER_TYPEHASH = 0x4ff6e0f284e5bda3bffd2bfd3adc9a8f89d4c787c8be730b8c214c0e10bb3d40`, `SwapVM.sol:75-81,109-120`).
2. `tokenIn/tokenOut` = `(tokenA, tokenB)` if `takerTraits.isAToB()` else swapped (`SwapVM.sol:135-136`). tokenA must be `< tokenB` (`MakerTraitsLib.build`, `MakerTraits.sol:110`).
3. Registers init: `amountIn = isExactIn ? amount : 0; amountOut = isExactIn ? 0 : amount; balances = 0`.
4. **Aqua mode** (`useAquaInsteadOfSignature`): `(balanceIn, balanceOut) = AQUA.safeBalances(maker, address(this), orderHash, tokenIn, tokenOut)` (`SwapVM.sol:168,222`) — so no Balances opcode is needed; balances are the maker's Aqua reserves shipped for this exact strategy hash. Signature mode: `recoverOrIsValidSignature` (EOA or ERC-1271) (`SwapVM.sol:225`).
5. `runLoop`, then `order.traits.validate(amountIn)` and `takerTraits.validate(takerData, amount, amountIn, amountOut)` (`TakerTraits.sol:187-230`): exactIn ⇒ `takerAmount == amountIn` (or `>=` with `allowPartialFill`) and `amountOut >= threshold` (threshold scaled by `amountIn/takerAmount` on partial fill; `isStrictThresholdAmount` ⇒ equality); exactOut mirrored.
6. Transfers: `_transferOut` (maker→taker via `AQUA.pull` or `safeTransferFrom`) and `_transferIn` (taker→maker; Aqua mode either requires the taker to have pushed to Aqua beforehand or `useTransferFromAndAquaPush` does `transferFrom` + `AQUA.push`), order controlled by `isFirstTransferFromTaker`. Protocol-fee receivers are paid here from `ctx.fee` (`FeeMetaLib.resolve*`, `src/libs/ProtocolFee.sol`). Maker hooks (`IMakerHooks`, `src/interfaces/IMakerHooks.sol`) and taker callbacks (`ITakerCallbacks`) fire around transfers — outside the VM.

### 1.3 Encoding helpers

* `InstructionBuilder.sizeOf() == 2` (header), `pushHeader(ptr, opcode)`, `patchLength(ptrStart, end)` (reverts `InstructionBuilderArgsLengthExceeded` if args ≥ 256), `encodeBool(value, bit) = value ? 128 >> bit : 0` (`src/libs/InstructionBuilder.sol`). Bool bit 0 is the MSB (`0x80`) of the byte; `InstructionArgs.asBool(word, bit)` mirrors it.
* `InstructionArgs.at(args, shift)` = `calldataload(args.offset + shift)` then `asU8..asU256`, `asAddress`, `asBytesN` (`src/libs/InstructionArgs.sol`). **No bounds checks**: short args read zeros past the end.
* `MemoryPtr` (`src/libs/MemoryPtr.sol`): `alloc(len)`, `push(...)`, `patch(...)`, `resolve()` (strict: written == allocated), `resolveShrink()`.
* Standard library shape (example `src/instructions/DutchAuction.sol:30-54`):
  ```solidity
  Opcode constant opcode = Opcode.DutchAuctionBalanceIn;
  function sizeOf(uint40, uint16, uint64) internal pure returns (uint256) { return InstructionBuilder.sizeOf() + 5 + 2 + 8; }
  function build(uint40 start, uint16 duration, uint64 decay) internal pure returns (bytes memory);          // standalone
  function build(MemoryPtr ptrStart, uint40 start, uint16 duration, uint64 decay) internal pure returns (MemoryPtr); // chained
  function parse(bytes calldata args) internal pure returns (uint40 start, uint16 duration, uint64 decay);
  function exec(Context memory ctx, bytes calldata args) internal view;
  ```
  Programs are assembled with `bytes.concat(A.build(...), B.build(...), ...)`.

### 1.4 Wrapper (nested `runLoop`) pattern — the single most important ordering rule

Instructions whose `exec` calls `ctx.runLoop()` run **everything after them** inside that call, then continue with post-processing; when they return, the outer loop sees `nextPC >= length` and exits. Wrapper opcodes at this revision: `DynamicBalances`, `Decay`, `FeeFlatIn`, `FeeFlatOut`, `FeeProtocol`, `InvalidateBit`, `InvalidateTokenIn`, `InvalidateTokenOut`, `RequireMinRate`, `AdjustMinRate`, `TWAPSwap`, `PrintFee` (debug). Everything else is a **leaf** (executes and returns; the outer loop proceeds).

Consequences:
* Wrappers must be placed **before** the curve they wrap (`StaticBalances → RequireMinRate → LimitSwap`; `DynamicBalances → FeeFlatIn → XYCSwap`).
* Leaf post-processors that read final amounts (`BaseFeeAdjuster`, `OraclePriceAdjuster`) must be placed **after** the curve (repo tests: `test/BaseFeeAdjuster.t.sol:71-73` — "BaseFeeAdjuster must be applied after the swap").
* Leaf pre-processors that scale balances (`DutchAuction*`, `PiecewiseLinearScale*`, `StaticBalances`) go **between** the balance source and the curve.
* Nesting order between wrappers matters: `FeeFlatIn` outside `InvalidateTokenIn` means the invalidator sees the net amount; the reverse means the invalidator sees the gross amount (see per-opcode notes).
* Deep nesting is fine (`test/RunLoop.t.sol:181-195` nests 5 wrappers).

### 1.5 Storage (`src/libs/StorageSlots.sol`) — ERC-7201 namespaced slots in the router

| Slot constant | Value | Used by | Key |
|---|---|---|---|
| `DynamicBalances` | `0x8a1457da…2e00` | DynamicBalances | `orderHash → token → uint256` |
| `Decay` | `0xdf4f9c8e…1900` | Decay | `orderHash → token → direction(bool) → DecayOffset` |
| `InvalidateBit` | `0x7fecc769…b900` | InvalidateBit | `maker → slot(uint256) → bitmap` |
| `InvalidateTokenIn` | `0xdec8baa2…4a00` | InvalidateTokenIn | `maker → orderHash → token → filled` |
| `InvalidateTokenOut` | `0x3c263435…5900` | InvalidateTokenOut | same |
| `TWAPSwap` | `0x640df918…6f00` | TWAPSwap | `orderHash → LastSwap` |
| `ValidateSeriesEpoch` | `0xf6109436…1400` | ValidateSeriesEpoch | `maker → seriesId → epoch` |

All stateful opcodes skip writes when `ctx.vm.isStaticContext` so `quote` never mutates.

---

## 2. Opcode numbers and which router exposes them

`enum Opcode` in `src/libs/OpcodeList.sol` is banked; `0xf0-0xff` reserved. Production numbers:

| Hex | Name | `Opcodes` (SwapVMRouter) | `AquaOpcodes` (AquaSwapVMRouter) | `LimitOpcodes` (LimitSwapVMRouter) |
|---|---|---|---|---|
| 00 | Stop | ✓ | – | – |
| 01 | Revert | ✓ | – | – |
| 02 | Salt | ✓ | ✓ | ✓ |
| 03 | Jump | ✓ | ✓ | ✓ |
| 04 | Extruction | ✓ | ✓ | ✓ |
| 10-15,1a | Print*/PatchSwapRegisters (debug) | only `*Debug` variants | | |
| 20 | Deadline | ✓ | ✓ | ✓ |
| 23 | OnlyTakerTokenBalanceNonZero | ✓ | ✓ | ✓ |
| 24 | OnlyTakerTokenBalanceGte | ✓ | ✓ | ✓ |
| 25 | OnlyTakerTokenSupplyShareGte | ✓ | ✓ | ✓ |
| 26 | OnlyTxOriginTokenBalanceNonZero | ✓ | ✓ | ✓ |
| 2b | PrivateOrder | ✓ | – | ✓ |
| 2c | WhitelistCoequal | ✓ | – | ✓ |
| 2d | WhitelistSequential | ✓ | – | ✓ |
| 30 | JumpIfDirection | ✓ | – | – |
| 31 | JumpIfTokenIn | ✓ | ✓ | ✓ |
| 32 | JumpIfTokenOut | ✓ | ✓ | ✓ |
| 40 | InvalidateBit | ✓ | – | ✓ |
| 41 | InvalidateTokenIn | ✓ | – | ✓ |
| 42 | InvalidateTokenOut | ✓ | – | ✓ |
| 48 | ValidateSeriesEpoch | ✓ | – | ✓ |
| 50 | XYCSwap | ✓ | ✓ | – |
| 51 | XYCConcentrateSwap | ✓ | ✓ | – |
| 53 | LimitSwap | ✓ | – | ✓ |
| 54 | LimitSwapFullAmount | ✓ | – | ✓ |
| 58 | PeggedSwap | ✓ | ✓ | – |
| 70 | FeeFlatIn | ✓ | ✓ | – |
| 71 | FeeFlatOut | ✓ | – | – |
| 80 | FeeProtocol | ✓ | ✓ | ✓ |
| 90 | StaticBalances | ✓ | – | ✓ |
| 91 | DynamicBalances | ✓ | – | – |
| 94 | DutchAuctionBalanceIn | ✓ | – | – |
| 95 | DutchAuctionBalanceOut | ✓ | – | – |
| 98 | PiecewiseLinearScaleBalanceIn | ✓ | – | ✓ |
| 99 | PiecewiseLinearScaleBalanceOut | ✓ | – | ✓ |
| 9c | Decay | ✓ | ✓ | – |
| 9d | TWAPSwap | ✓ | – | – |
| b0 | RequireMinRate | ✓ | – | – |
| b1 | AdjustMinRate | ✓ | – | – |
| b2 | OraclePriceAdjuster | ✓ | – | – |
| b4 | BaseFeeAdjuster | ✓ | – | ✓ |

Sources: `src/opcodes/Opcodes.sol:45-87`, `AquaOpcodes.sol:27-45`, `LimitOpcodes.sol:34-60`. External storage getters/invalidators are mixed into the router via `*External` contracts (`Opcodes is DynamicBalancesExternal, InvalidateBitExternal, InvalidateTokenInExternal, InvalidateTokenOutExternal, TWAPSwapExternal, ValidateSeriesEpochExternal`; `AquaOpcodes` inherits none). Gas per opcode: `snapshots/OpcodeGas.json` (e.g. XYCSwap 1007, XYCConcentrateSwap 4559, PeggedSwap 8040, DynamicBalances 26925, InvalidateBit 23647, ValidateSeriesEpoch 3557).

Routers: `contract SwapVMRouter is Simulator, SwapVM, Opcodes { function _dispatch(...) internal override { _runOpcode(ctx, opcode, args); } }` (`src/routers/SwapVMRouter.sol`), same for Aqua/Limit. Constructor `(address aqua, address weth, address owner, string name, string version)`.

---

## 3. Instruction reference

Conventions: `A`/`B` = tokens sorted by address; `dir = (tokenIn < tokenOut)` i.e. `true` for A→B; `ONE = 1e18` unless stated; "BPS" in fee opcodes means **1e7 = 100%** (`FeeReceiverLib.BPS = 1e7`, so `0.003e7 = 30_000 = 0.3%`).

### 3.1 Balances — `src/instructions/Balances.sol`

**StaticBalances (0x90)** — leaf, `pure`.
* Args `[uint256 balanceA, uint256 balanceB]` (64 B). `build(uint256 balanceA, uint256 balanceB)`.
* Writes `balanceIn/balanceOut` from `(balanceA, balanceB)` oriented by `dir` (`Balances.sol:46-54`). Overwrites Aqua-loaded balances if used in Aqua mode.
* Use: `StaticBalances.build(1000e18, 2000e18)` — "maker holds 1000 A and 2000 B" for a 1D order.

**DynamicBalances (0x91)** — wrapper, stateful, `Opcodes` only.
* Same args (initial reserves). Storage `balance[orderHash][token]`.
* `exec` (`Balances.sol:101-125`): loads both balances; if both zero → use args; sets registers; `runLoop()`; then `balanceIn += amountIn; balanceOut -= amountOut; require(balanceIn | balanceOut != 0, DynamicBalancesReachZero())`; persists in swap mode.
* Virtual accounting only: tokens still move by `safeTransferFrom` from/to the maker (signature mode), so the maker must hold/approve. Isolated per `orderHash` (per maker signature).
* External: `balance(bytes32 orderHash, address token) view` (sel `0x787deabd`).
* Must be **first** (it wraps the rest). Doc: "expected to be executed only once in strategy flow".
* Use: `bytes.concat(DynamicBalances.build(1_000e18, 1_000e18), XYCSwap.build())` (`docs/PROGRAMS.md:121-124`).

### 3.2 LimitSwap / LimitSwapFullAmount — `src/instructions/LimitSwap.sol`

**LimitSwap (0x53)** — leaf, `pure`. Args `[bool direction]` (1 B, bit0). `build(address tokenIn, address tokenOut)` (direction = `tokenIn < tokenOut`) or `build(bool direction)`.
* `require(direction == dir, LimitSwapDirectionMismatch())` → **single direction**.
* exactIn: `amountIn >= balanceIn ? (amountIn, amountOut) = (balanceIn, balanceOut) : amountOut = amountIn * balanceOut / balanceIn` (floor). exactOut: `amountOut >= balanceOut ? full : amountIn = ceil(amountOut * balanceIn / balanceOut)` (`LimitSwap.sol:58-76`).
* Capping to full balance only passes `TakerTraits.validate` if the taker set `allowPartialFill` (otherwise `TakerTraitsTakerAmountInMismatch`).
* No state: **must** be paired with `InvalidateBit` / `InvalidateTokenIn|Out` in signature mode or it is infinitely re-fillable at the same rate.

**LimitSwapFullAmount (0x54)** — leaf. Same args. Requires `amount >= balance` (`LimitSwapAmountShouldCoverBalance`) then sets amounts = balances. All-or-nothing.

### 3.3 XYCSwap (0x50) — `src/instructions/XYCSwap.sol`, leaf, `pure`, no args
* exactIn: `amountOut = amountIn * balanceOut / (balanceIn + amountIn)`; exactOut: `amountIn = ceil(amountOut * balanceIn / (balanceOut - amountOut))` (reverts on underflow if `amountOut >= balanceOut`; no partial-fill cap) (`XYCSwap.sol:37-45`).
* Bidirectional; fees are reinvested automatically when balances come from DynamicBalances/Aqua (constant-product on real balances).

### 3.4 XYCConcentrateSwap (0x51) — `src/instructions/XYCConcentrate.sol`, leaf, `pure`
* Args `[uint256 sqrtPriceMin, uint256 sqrtPriceMax]` (64 B); `build` requires `0 < sqrtPriceMin < sqrtPriceMax` (`ConcentrateInvalidPriceBounds`).
* **Price convention**: `price = rawB / rawA` (B per A, raw token units — decimals differences are baked in), `sqrtPrice = 1e18 * sqrt(price)`. Test helper: `sqrtP = Math.sqrt(price_1e18 * 1e18)` (`test/base/AquaStrategyBuilders.sol:80-83`). Spot: `sqrtPriceSpot = sqrt(virtualB * 1e36 / virtualA)` (`XYCConcentrate.sol:133`).
* **Model** (`XYCConcentrate.sol:96-118`): invariant `(balanceA + L/sqrtPmax) * (balanceB + L*sqrtPmin) = L²`. Liquidity is **recomputed from current real balances on every call**: `beta = balanceA*sqrtPmin/1e18 + balanceB*1e18/sqrtPmax; fourAC = 4*(sqrtPmax-sqrtPmin) * balanceA*balanceB / sqrtPmax; L = (beta + sqrt(beta² + fourAC)) * sqrtPmax / (2*(sqrtPmax-sqrtPmin))`. This is the "grow liquidity" behaviour: accrued fees (or any balance change) raise `L`, price bounds stay fixed. There is **no separate "grow price range" opcode** at this revision; the test enum `SwapType.CONCENTRATE_GROW_PRICE_RANGE / CONCENTRATE_GROW_LIQUIDITY` both build `XYCConcentrateSwap` (`AquaStrategyBuilders.sol:77-84`).
* `exec` (`XYCConcentrate.sol:55-94`): `virtualIn = balanceIn + (dir ? ceil(L*1e18/sqrtPmax) : ceil(L*sqrtPmin/1e18))`, `virtualOut = balanceOut + (dir ? L*sqrtPmin/1e18 : L*1e18/sqrtPmax)`; then constant-product on virtuals. exactIn: if `amountOut > balanceOut` → clamp `amountOut = balanceOut` and recompute `amountIn = ceil(amountOut*virtualIn/(virtualOut-amountOut))` (partial fill: taker needs `allowPartialFill`). exactOut: clamp `amountOut ≤ balanceOut`, `amountIn = ceil(...)`.
* Helpers (all `internal pure`): `computeLiquidity(balanceA, balanceB, sqrtPmin, sqrtPmax) → L`; `computeLiquidityAndPrice(...) → (L, sqrtPriceSpot)`; `computeBalances(L, sqrtPriceSpot, sqrtPmin, sqrtPmax) → (balanceA, balanceB)` with `balanceA = L*(sqrtPmax - sqrtSpot)*1e18/(sqrtSpot*sqrtPmax)`, `balanceB = L*(sqrtSpot - sqrtPmin)/1e18`; `computeLiquidityFromAmounts(availableA, availableB, sqrtSpot, sqrtPmin, sqrtPmax) → (L, actualA, actualB)` (takes `min` of the L each side supports). Use these to seed balances so the spot lands where you want.
* Overflow envelope (**UNCERTAIN exact bound**): `balanceA * balanceB` and `4*priceDelta*(balanceA*balanceB)` must fit uint256 — `test/invariants/concentrate/HugeLiquidity.t.sol` exercises large values.
* Strategy liveness: when one side is depleted (`balanceOut == 0`) that direction reverts/returns 0 and the reverse direction restores it (README invariant 7).
* Use: `XYCConcentrateSwap.build(Math.sqrt(0.5e36), Math.sqrt(2.0e36))` → range price ∈ [0.5, 2] B per A (`test/RunLoop.t.sol:187`).

### 3.5 PeggedSwap (0x58) — `src/instructions/PeggedSwap.sol` + `src/libs/PeggedSwapMath.sol`, leaf, `pure`
* Args `[uint256 x0, uint256 y0, uint256 linearWidth, uint256 rateA, uint256 rateB]` (160 B). `build` requires `x0,y0 > 0`, `linearWidth ≤ 5000e27`, `rateA,rateB > 0`.
* Curve: `√(x/X₀) + √(y/Y₀) + A·(x/X₀ + y/Y₀) = C`, curvature `p = 0.5` hardcoded (analytic solution). `ONE = 1e27` inside the math. `x0,y0` are **normalisation factors** = initial normalised reserves (`initial_balance * rate`); `rateA/rateB` scale decimals to a common base (assigned to lower/higher address). Example in source (`PeggedSwap.sol:46-48`): 1000 USDC(6) & 1000 DAI(18), USDC<DAI → `rateA = 1e12, rateB = 1, x0 = y0 = 1000e18`. Guidance (`PeggedSwap.sol:104-111`): stablecoins `A ≈ 100e27–300e27`, LST/LRT `20e27–100e27`, wrapped BTC `5e27–20e27`, volatile `0–5e27`. Finite reserves / hard price boundary — not for drifting pegs.
* `exec` (`PeggedSwap.sol:113-203`): normalises `x = balanceIn*rateIn`, `y = balanceOut*rateOut`, computes `targetInvariant` **from current balances** (`invariantFromReserves`, so `C` is not fixed — fees/balance growth re-anchor it, "grow" behaviour like XYCConcentrate). exactIn: `u1 = x1/X₀`; if `√u1 + A·u1 ≥ C` the input exceeds capacity → drains `amountOut = balanceOut` and recomputes `amountIn = ceil((uMax·X₀ - x)/rateIn)` (partial fill). Else `v1 = solve(C - √u1 - A·u1, A)`, `y1 = ceil(v1·Y₀)`, `amountOut = (y - y1)/rateOut`. exactOut: clamps `amountOut ≤ balanceOut`, requires `C ≥ √v1 + A·v1` (`PeggedSwapMathInvalidInput`), `amountIn = ceil((ceil(u1·X₀) - x)/rateIn)`, min 1 wei.
* `PeggedSwapMath.solve(rightSide, a)`: `a == 0 → v = R²/ONE`; else `w = 2R/(1 + √(1 + 4aR))` (cancellation-free form), `v = w²/ONE` (`PeggedSwapMath.sol:65-106`).
* Use: `PeggedSwap.build(1_000e18, 1_000e18, 100e27, 1, 1)` (`docs/PROGRAMS.md:149`).

### 3.6 TWAPSwap (0x9d) — `src/instructions/TWAPSwap.sol`, wrapper, stateful, `Opcodes` only
* Args 6×`uint256` (192 B): `balanceIn` (tokenIn expected for the *whole* `balanceOut`, sets initial price), `balanceOut` (total tokenOut to sell), `startTime`, `duration`, `priceBumpAfterIlliquidity` (1e18 = none, ≥1e18), `minTradeAmountOut`. `build` requires balances > 0, duration > 0, bump ≥ 1e18.
* Storage `lastSwap[orderHash] = LastSwap{amountIn, amountOut, timestamp, totalSold}`; external `twapLastSwap(bytes32) → (amountIn, amountOut, timestamp, totalSold)` (sel `0x65986a24`).
* Formula (`TWAPSwap.sol:161-245`):
  * `unlocked = balanceOut * min(now - startTime, duration) / duration` (linear unlock); `available = unlocked - totalSold`.
  * First trade: `base = (balanceIn, balanceOut)`, `auctionStart = startTime`. Later: `base = last trade amounts`, `auctionStart = last.timestamp`; if still inside `duration` and the last trade left `minTradeAmountOut + sold > lastSwapAvailable` (was illiquid): `illiqDur = shortfall * duration / balanceOut`, `maxIlliqDur = minTradeAmountOut * duration / balanceOut`, `bump = 1 + (priceBump - 1) * min(1, illiqDur/maxIlliqDur)`, `baseAmountIn *= bump`, `auctionStart += illiqDur`.
  * `decay = 0.9999^(now - auctionStart)` (`DECAY_FACTOR = 0.9999e18`, `Power.pow`, per second), `scaledOut = baseAmountOut * decay`.
  * Registers: if `available > 0 && scaledOut > 0`: `balanceIn = ceil(baseAmountIn * available / scaledOut); balanceOut = available` else `balanceIn = baseAmountIn; balanceOut = scaledOut`.
  * `runLoop()` — **expects `LimitSwap` (or similar) after it** to turn balances into amounts.
  * Post: during `duration` require `amountOut ≥ minTradeAmountOut` (`TWAPSwapMinTradeAmountNotReached`); always `amountOut ≤ available` (`TWAPSwapTradeAmountExceedLiquidity`); persist `totalSold += amountOut` and the trade.
* **Observed price direction** (section 12): for fixed `amountIn`, `amountOut = amountIn * baseAmountOut * decay / baseAmountIn` — the taker's output **shrinks** by 0.9999/s since `auctionStart` (halves every ≈6931 s). With `balanceIn=2000e18, balanceOut=1000e18, duration=24h`: quote of 1e18 A gives 0.2107 B at 10 % of duration, 0.0028 B at 50 %, 4.95e-7 B after the end. The illiquidity bump also raises `baseAmountIn` (more tokenIn per tokenOut). Both move price **in the maker's favour** over time, opposite to `DutchAuction*`. Whether this is intended is **UNCERTAIN** (docstring: "exponential dutch auction … for better price discovery"; tests only assert positivity, `test/TWAPSwap.t.sol:134` says "adjusted for actual behavior"). Treat as: price re-anchors to each fill, then ramps up until the next fill.
* Use: `bytes.concat(TWAPSwap.build(2000e18, 1000e18, start, 86400, 1.1e18, 1e18), LimitSwap.build(tokenIn, tokenOut))`.

### 3.7 DutchAuctionBalanceIn (0x94) / DutchAuctionBalanceOut (0x95) — `src/instructions/DutchAuction.sol`, leaf, `view`, `Opcodes` only
* Args `[uint40 start, uint16 duration, uint64 decay]` (15 B); `build` requires `decay < 1e18`. `duration ≤ 65535 s ≈ 18.2 h`.
* `require(now ≤ start + duration, DutchAuctionExpired)`; `elapsed = now - start` (reverts by underflow before `start`).
* In: `balanceIn = balanceIn * decay^elapsed / 1e18` (maker asks less tokenIn over time). Out: `balanceOut = balanceOut * 1e18 / decay^elapsed` (maker offers more tokenOut over time). `Power.pow(base, exp, precision)` = binary exponentiation (`src/libs/Power.sol`).
* Verified: with `StaticBalances(2000e18, 1000e18)`, `decay = 0.9999e18`, quote of 1e18 A → 0.50005 B at t=1 s, 0.5986 B at t=1800 s (both variants identical here).
* Must not be combined with `InvalidateTokenIn` (for In) / `InvalidateTokenOut` (for Out): the invalidator caches the *scaled* balance and the fill accounting drifts (`DutchAuction.sol:17,70`). Place after the balance source and before the curve.
* Use: `bytes.concat(StaticBalances.build(100e18, 200e18), DutchAuctionBalanceIn.build(uint40(start), 3600, 0.9999e18), LimitSwap.build(tokenA, tokenB))` (`test/DutchAuction.t.sol:127-131`).

### 3.8 Decay (0x9c) — `src/instructions/Decay.sol`, wrapper, stateful — Mooniswap-style virtual balances
* Args `[uint16 period]` (seconds, ≤ 65535). Storage `offset[orderHash][token][direction] = DecayOffset(uint216 offset, uint40 ts)`.
* `exec` (`Decay.sol:61-80`): `balanceIn += offsetNow(offset[tokenIn][true])`, `balanceOut -= offsetNow(offset[tokenOut][false])` (linearly decaying: `offset * timeLeft / period`, 0 after `period`), then `runLoop()`, then records **against** the current direction: `offset[tokenIn][false] += amountIn`, `offset[tokenOut][true] += amountOut` with `ts = now`. Effect: an immediate counter-swap sees an inflated `balanceIn` / deflated `balanceOut` → worse price for sandwichers; the effect linearly vanishes over `period`.
* Doc: execute only once per program. In quote mode nothing is written. Additivity is state-dependent (`TESTING.md`).
* Use: `bytes.concat(DynamicBalances.build(1_000e18, 1_000e18), Decay.build(300), XYCSwap.build())` (`docs/PROGRAMS.md:160-164`).

### 3.9 FeeFlatIn (0x70) / FeeFlatOut (0x71) — `src/instructions/FeeFlat.sol`, wrappers (maker/LP fee)
* Args `[uint24 feeBps]` (3 B), `BPS = 1e7`, `require(feeBps < BPS)`.
* **FeeFlatIn** (`FeeFlat.sol:53-70`): exactIn: `fee = ceil(amountIn*feeBps/BPS); amountIn -= fee; runLoop(); if the inner program reduced amountIn (partial fill) re-derive fee = ceil(amountIn*feeBps/(BPS-feeBps)) else add the original fee back`. exactOut: `runLoop(); amountIn += ceil(amountIn*feeBps/(BPS-feeBps))`. The fee stays with the maker (it is simply not swapped) and, with AMM balances, is reinvested next trade.
* **FeeFlatOut** (`FeeFlat.sol:113-119`): exactOut: gross-up `amountOut += ceil(amountOut*feeBps/(BPS-feeBps))` before `runLoop()`; after: `amountOut -= ceil(amountOut*feeBps/BPS)`. Warning in source: with auto-reinvesting curves this is **superadditive** (`swap(a)+swap(b) > swap(a+b)`) because the fee is deposited against the swap direction. `Opcodes` only.
* Progressive fees were removed in PR #180 — only flat fees exist.
* Use: `FeeFlatIn.build(0.003e7)` (= 0.3 %).

### 3.10 FeeProtocol (0x80) — `src/instructions/FeeProtocol.sol`, wrapper; third-party fees settled in the transfer phase
* Args: `[uint8 header, {uint8 flags, address target, uint24 feeBps?, uint24 surplusBps?} × count, uint216 surplusEstimate?]`; `header = bit0 isTokenIn | uint4 count` (count < 16); `flags = bit0 isProvider | bit1 takeFlatFee | bit2 takeSurplusFee`; bps fields only for non-provider entries and only if the flag is set; `surplusEstimate` present iff any `takeSurplusFee`.
* Builder: `build(bool isTokenIn, ReceiverConfig[] receivers, ProviderConfig[] providers, uint216 surplusEstimate)` with `struct ReceiverConfig {address receiver; uint24 feeBps; uint24 surplusBps;}` and `struct ProviderConfig {address provider; bool takeFlatFee; bool takeSurplusFee;}` (`FeeProtocol.sol:52-137`). Test helpers: `test/utils/FeeBuilders.sol` (`protocolFeeIn(feeBps, receiver)`, `protocolSurplusOut(...)`, `protocolProviderIn(provider)`, …).
* Providers implement `IProtocolFeeProvider.getRecipientAndFees(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, bool isExactIn) view returns (address receiver, uint24 feeBps, uint24 surplusBps)` (`src/instructions/interfaces/IProtocolFeeProvider.sol`, sel `0xc89cc373`) — a **dynamic fee hook** resolved at execution (both quote and swap).
* `exec` (`FeeProtocol.sol:163-251`): builds `ctx.fee.receivers`/`meta`; `require(totalFeeBps < BPS && totalSurplusBps < BPS)`; flat fee is paid **by the taker**: tokenIn → `amountIn` is reduced before `runLoop` (exactIn) / grossed up after (exactOut), floor rounding; tokenOut → mirrored. `ctx.fee.feeTotal = fee`. **Surplus fee** is paid by the maker: `surplusEstimate` is the maker's expected amount; `InvalidateTokenIn/Out` scale it by the filled fraction (`FeeMetaLib.scaleSurplusEstimate`); at transfer time the difference between realised and estimated is split per `surplusBps` (`src/libs/ProtocolFee.sol:95-233`). Fees are transferred (`safeTransfer`, `safeTransferFrom` or `AQUA.pull`) in `SwapVM._transferIn/_transferOut`.
* Doc: executed once per program; should be placed **inside** (after) `InvalidateTokenIn/Out` so the invalidator consumes the final amount (`Invalidators.sol:106`). `PrintFee` debug opcode must precede it.

### 3.11 BaseFeeAdjuster (0xb4) — `src/instructions/BaseFeeAdjuster.sol`, leaf, `view`
* Args `[uint64 baseGasPrice, uint96 ethPrice, uint24 gasAmount, uint64 maxDecay]` (31 B), `maxDecay < 1e18`. `ethPrice` is the ETH price **in tokenIn raw units** (1e18-scaled ratio).
* `exec` (`BaseFeeAdjuster.sol:65-79`): if `block.basefee ≤ baseGasPrice` or `amountIn == 0` → no-op. `discount = (basefee - baseGasPrice) * gasAmount * ethPrice / 1e18` capped at `amountIn * maxDecay / 1e18`; exactIn: `amountOut += discount * amountOut / amountIn`; exactOut: `amountIn -= discount`. Compensates takers for gas spikes; single direction (price is in tokenIn). Must come **after** the curve. Breaks symmetry/additivity by design (`TESTING.md`).
* Use: `…, LimitSwap.build(tokenB, tokenA), BaseFeeAdjuster.build(30 gwei, ethToTokenPrice, 150_000, 0.05e18)` (`test/BaseFeeAdjuster.t.sol:70-74`).

### 3.12 OraclePriceAdjuster (0xb2) — `src/instructions/OraclePriceAdjuster.sol`, leaf, `view`, `Opcodes` only
* Args `[uint64 maxPriceDecay, uint16 maxStaleness, uint8 oracleDecimals, address oracleAddress]` (31 B); `maxPriceDecay < 1e18`; `maxStaleness = 0` disables staleness check; `oracleDecimals = 0` → calls `decimals()`.
* Interface `IPriceOracle` = Chainlink AggregatorV3 (`src/instructions/interfaces/IPriceOracle.sol`): `decimals()`, `description()`, `version()`, `getRoundData(uint80)`, `latestRoundData() → (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)` (sel `0xfeaf968c`). Only `latestRoundData` (+ optionally `decimals`) is called.
* `exec` (`OraclePriceAdjuster.sol:70-117`): `require(maxStaleness == 0 || now ≤ updatedAt + maxStaleness)`; `oraclePrice = answer` rescaled to 1e18 (`SafeCast.toUint256` reverts on negative); `currentPrice = amountOut * 1e18 / amountIn` (**raw units**, reverts if `amountIn == 0`); if `oraclePrice ≤ currentPrice` → no-op (adjusts **only in the taker's favour**). exactIn: `amountOut *= min(oraclePrice/currentPrice, 2e18 - maxPriceDecay) / 1e18`; exactOut: `amountIn = ceil(amountIn * max(currentPrice/oraclePrice, maxPriceDecay) / 1e18)`. With `maxPriceDecay = 0.9e18` the cap is ±10 %.
* Gotchas: the feed must express **tokenOut per tokenIn in raw token units** (standard Chainlink USD feeds are per human unit and pair-specific; decimals mismatch between tokens is *not* normalised). Must be placed **after** the curve. **No test file for this opcode exists in the repo** (grep `OraclePriceAdjuster.build` in `test/` → none).

### 3.13 RequireMinRate (0xb0) / AdjustMinRate (0xb1) — `src/instructions/MinRate.sol`, wrappers
* Args `[uint64 rateA, uint64 rateB]` (16 B), interpreted as `rateIn/rateOut` oriented by `dir`; guard `amountIn / amountOut ≥ rateIn / rateOut` (maker-favour). Rates are dimensionless ratios in raw units (tests use `0.8e7 / 1.2e7`).
* `RequireMinRate` (`MinRate.sol:51-61`): `runLoop()` then `require(amountIn*rateOut ≥ rateIn*amountOut, RequireMinRateFailed)`.
* `AdjustMinRate` (`MinRate.sol:100-118`): `runLoop()` then if violated: exactIn `amountOut = amountIn*rateOut/rateIn` (floor); exactOut `amountIn = ceil(amountOut*rateIn/rateOut)`. Later opcodes must expect amounts to change.
* Single direction. Placement: **before** the curve (they wrap it): `StaticBalances → RequireMinRate → LimitSwap` (`test/MinRate.t.sol:69-73`). Recommended by `Extruction.sol:21` as the guard before an Extruction.

### 3.14 PiecewiseLinearScaleBalanceIn (0x98) / …Out (0x99) — `src/instructions/PiecewiseLinearScale.sol`, leaf, `view`
* Args `[uint40 timestamp, uint24 scales[0], (uint16 duration[k], uint24 scales[k+1])…]`; `durations.length == scales.length - 1`, `scales.length ≥ 2`. Max `(255-8)/5 = 49` intervals. `build(uint40 timestamp, uint16[] durations, uint24[] scales)`.
* Scale semantic: `value * (scale + 1) / 2^24`, so `scale = 0xFFFFFF` = 1.0, `8388607` ≈ 0.5. Helpers `scaleValue(value, scale)`, `unscaleValue(value, scale)` (inverse, rounds up).
* `calcScaleNow` (`PiecewiseLinearScale.sol:136-156`): before `timestamp` → `scales[0]`; after the last interval → last scale; inside interval `k` → linear interpolation between `scales[k]` and `scales[k+1]`. **Piecewise-linear in time, arbitrary shape (not monotone-constrained)** — a linear Dutch auction, a step schedule, or a V-shape are all expressible.
* In: `balanceIn = balanceIn * scale >> 24` (maker asks less over a descending schedule). Out: `balanceOut = balanceOut * scale >> 24`.
* Verified: `scales = [1.0, 0.5]` over 1000 s on `StaticBalances(2000e18, 1000e18)` → 1e18 A buys 0.5 B at t0, 0.667 B at 500 s, 1.0 B after the end.
* Same `InvalidateToken*` caveat as DutchAuction. Available in `Opcodes` and `LimitOpcodes`.

### 3.15 ValidateSeriesEpoch (0x48) — `src/instructions/SeriesEpochManager.sol`, leaf, `view`
* Args `[uint32 seriesId, uint32 epoch]` (8 B). Storage `epoch[maker][seriesId]` (uint256).
* `exec`: `require(epoch[maker][seriesId] == expectedEpoch, ValidateSeriesEpochWrongEpoch(maker, seriesId, expected, current))` (`SeriesEpochManager.sol:57-63`).
* External (`ValidateSeriesEpochExternal`, mixed into `Opcodes`/`LimitOpcodes`): `seriesEpoch(address maker, uint256 seriesId) view` (`0xac9a374e`), `seriesEpochIncrease(uint256 seriesId)` (`0xb176d0db`, +1, `msg.sender` scoped), `seriesEpochAdvance(uint256 seriesId, uint8 amount)` (`0x435e5f1e`, +[1..255]); event `SeriesEpochIncreased(maker, seriesId, newEpoch)`.
* Semantics: a **batch cancel / scheduling primitive**, not a scheduler. Orders pinned to epoch `k` are valid only while the maker's counter equals `k`; bumping cancels all orders of the old epoch and activates those pre-signed for the new one. **Nothing advances the epoch automatically** — the maker (or a contract acting as maker via ERC-1271 / hooks) must send a tx. Recurring orders therefore need either N pre-signed orders + external epoch bumps, or a custom opcode (section 6).
* Allowed as a Strategies.sol "prefix" (validation-only). Use: `bytes.concat(ValidateSeriesEpoch.build(1, 0), StaticBalances.build(1e18, 2e18), LimitSwap.build(tokenA, tokenB), Salt.build(abi.encodePacked(salt)))` (`test/SeriesEpochManager.t.sol:60-67`).

### 3.16 Invalidators — `src/instructions/Invalidators.sol`

**InvalidateBit (0x40)** — wrapper, stateful. Args `[uint32 bitIndex]`. Storage `bitmap[maker][bitIndex >> 8]`, bit `1 << (bitIndex & 0xff)`. `require(bit unset, InvalidateBitAlreadySet)`, `runLoop()`, set bit in swap mode (`Invalidators.sol:59-73`). One-shot order (nonce). External: `bitInvalidators(address maker, uint256 slot) view` (`0x2a3030f5`), `invalidateBit(uint256 bitIndex)` (`0x03e07168`), `invalidateBits(uint256 slot, uint256 mask)` (`0xa60cda2b`) — maker-side cancel. Note it is **maker-scoped, not order-scoped**: two orders sharing a bit index cancel each other.

**InvalidateTokenIn (0x41)** — wrapper, stateful, no args. Storage `filled[maker][orderHash][tokenIn]`. `exec` (`Invalidators.sol:141-159`): caches `balanceIn`; sets `balanceIn -= filled`, `balanceOut = balanceOut * balanceIn' / balanceIn` (pro-rata), `runLoop()`, `filled += amountIn`, `require(filled ≤ balanceIn, InvalidateTokenInExceeded)`, scales `ctx.fee.meta` surplus estimate by `amountIn/balanceIn`, persists. External: `tokenInInvalidators(address maker, bytes32 orderHash, address token) view` (`0x34437b1d`), `invalidateTokenIn(bytes32 orderHash, address token)` (`0x2a5362ac`, sets `filled = max` = cancel).

**InvalidateTokenOut (0x42)** — mirror on `balanceOut` with `balanceIn = ceil(balanceIn * balanceOut' / balanceOut)`. External `tokenOutInvalidators` (`0x6be9c958`), `invalidateTokenOut` (`0x4248bc46`).

Placement: apply **before** amount-modifying opcodes such as `FeeProtocol` so the invalidator consumes final amounts (`Invalidators.sol:106,182`); PROGRAMS.md example B puts it *after* `LimitSwap` (`StaticBalances → LimitSwap → InvalidateTokenOut`) which works because `LimitSwap` is a leaf and the invalidator then wraps nothing but still accounts the final amounts. Do not pair with `DutchAuction*`/`PiecewiseLinearScale*` on the same side (they rescale the cached balance).

### 3.17 Whitelist / PrivateOrder — `src/instructions/Whitelist.sol`
* Addresses are truncated to their **low 80 bits** (`uint80(uint160(addr))`) for packing; source argues 80-bit mining is impractical (`Whitelist.sol:15-17`).
* **PrivateOrder (0x2b)** — leaf, `pure`. Args `[uint80 allowedTaker]` (10 B). `require(uint80(taker) == allowed, PrivateOrderInvalidTaker)`.
* **WhitelistCoequal (0x2c)** — leaf. Args `[uint16 nextPC, uint80 allowedTakers[N]]` (N ≤ 25). If `taker` is listed → `setNextPC(nextPC)` (jump), else fall through. `patchNextPC(ptrStart, nextPC)` helper for two-pass building. Typical use: whitelisted takers jump past a `Revert`/fee section.
* **WhitelistSequential (0x2d)** — leaf, `view`. Args `[uint40 start, uint16 nextPC, (uint16 duration, uint80 allowedTaker)[N]]` (N ≤ 20). Reverts before `start` (`WhitelistSequentialTimeViolation`); taker `k` unlocks at `start + Σ durations[0..k]`; listed & unlocked → jump to `nextPC`; after all durations elapsed → anyone falls through. Time-phased exclusivity (resolver auctions).
* All three are in `Opcodes` and `LimitOpcodes`, not `AquaOpcodes`.

### 3.18 TokenValidators — `src/instructions/TokenValidators.sol` (leaf, `view`, all routers)
* `OnlyTakerTokenBalanceNonZero(address token)`: `IERC20(token).balanceOf(taker) > 0` (NFT gate; EIP-7702 caveat in source).
* `OnlyTxOriginTokenBalanceNonZero(address token)`: same on `tx.origin` (allows filling through contracts; weak).
* `OnlyTakerTokenBalanceGte(address token, uint256 amount)`.
* `OnlyTakerTokenSupplyShareGte(address token, uint64 share)`: `balance * 1e18 ≥ share * totalSupply`, `share ≤ 1e18`.
These are the only built-in **external-state reads** besides the oracle, fee provider, `block.basefee`, and `block.timestamp`.

### 3.19 Controls — `src/instructions/Controls.sol`
* **Stop (0x00)** — `setNextPC(type(uint256).max)` ends the program (`Opcodes` only).
* **Revert (0x01)** — `revert InstructionRevert(bytes args)`; `build(bytes4)` or `build(bytes)`. Used as the fall-through after a whitelist jump.
* **Salt (0x02)** — no-op; `build(uint64)` or `build(bytes)`; changes `orderHash` so identical strategies get distinct storage/Aqua keys. Allowed prefix in Strategies.sol.
* **Deadline (0x20)** — `require(now ≤ deadline, DeadlineReached)`; `build(uint40 deadline)`.

### 3.20 Jumps — `src/instructions/Jumps.sol` (leaf, `pure`)
* `nextPC` is a **uint16 byte offset into the program** (must be instruction-aligned; no validation — a misaligned target decodes garbage; a target ≥ length ends execution; backward jumps create loops bounded only by gas).
* **Jump (0x03)** `[uint16 nextPC]` unconditional. **JumpIfDirection (0x30)** `[bool direction, uint16 nextPC]` (jump if `dir == direction`; `build(tokenIn, tokenOut, nextPC)` or `build(bool, uint16)`; `Opcodes` only). **JumpIfTokenIn (0x31)** / **JumpIfTokenOut (0x32)** `[address token, uint16 nextPC]`.
* Each has `patchNextPC(MemoryPtr ptrStart, uint16 nextPC)` to back-patch after the target offset is known (offset of the jump's own args: `2`, `2+1`, `2+20`).
* Condition set is **only** direction / token identity / (via Whitelist*) taker identity. No jumps on amounts, balances, time, or storage (see section 6).
* Pattern for a per-direction program: `JumpIfDirection(true, pcB) ; <program for B→A> ; Stop ; [pcB:] <program for A→B>`.

### 3.21 Extruction (0x04) — `src/instructions/Extruction.sol` (all routers)
* Args `[address target, bytes extructionArgs]` (≤ 235 B of extruction args because of the 255-byte instruction limit). `build(address target, bytes extructionArgs)`.
* **Call type: a regular external `call`, not `delegatecall`** (`IExtruction(target).extruction(...)`, `Extruction.sol:76`); in quote mode it goes through the `view` interface `IStaticExtruction` so the compiler emits `staticcall` (`Extruction.sol:67`). The target therefore runs in its **own** storage context (it can persist its own state in swap mode, cannot write in quote mode), cannot touch router storage, cannot move tokens on the router's behalf (router holds no approvals for it), and cannot re-enter `swap` for the same `orderHash` (transient lock) — re-entering for other orders is **UNCERTAIN/untested**.
* Interface the target must implement (`Extruction.sol:91-119`, selector `0xccd435ec` for both):
  ```solidity
  function extruction(
      bool isStaticContext, uint256 nextPC,
      SwapQuery calldata query, SwapRegisters calldata swap,
      bytes calldata args,          // extructionArgs from the program
      bytes calldata takerData      // remaining taker instructionsArgs
  ) external /*view for IStaticExtruction*/ returns (
      uint256 updatedNextPC, uint256 choppedLength, SwapRegisters memory updatedSwap);
  ```
* What it can modify: **all four `SwapRegisters`** (replaced wholesale), **`nextPC`** (any value → conditional flow / early stop), and it **consumes `choppedLength` bytes of taker args** (`ctx.tryChopTakerArgs(choppedLength)`; reverts `ExtructionChoppedExceedsLength` if fewer remain). It cannot modify `SwapQuery` or `ctx.fee`.
* Reference implementation `test/mocks/BestRouteSelector.sol`: inherits `OpcodesDebug` (a full opcode set), parses `[uint8 n, (uint16 len, bytes program)×n]`, builds a fresh `Context` per branch with `dispatch = _runOpcode` and `vm.programPtr = branch`, runs `ctx.runLoop()` on identical starting registers, returns the branch with max `amountOut`. Test `test/RunLoop.t.sol:260-294` (`DynamicBalances → Extruction(selector, [XYCSwap | PeggedSwap])`). This shows an Extruction target can host **arbitrary custom "instructions" and sub-programs** without a router redeploy.
* Safety notes from source (`Extruction.sol:18-28`): target should be deterministic and identical in quote/swap; guard maker rate with `RequireMinRate`/`AdjustMinRate` **before** it; bound spend with Aqua/`DynamicBalances` or `StaticBalances` + `InvalidateToken*`; taker guards via threshold; multiple Extructions per program can cause quote/swap divergence if the target writes storage.

### 3.22 Debug — `src/instructions/Debug.sol` (only in `OpcodesDebug` / `AquaOpcodesDebug` / `LimitOpcodesDebug`, i.e. tests)
`PrintSwapRegisters (0x10)`, `PrintSwapQuery (0x11)`, `PrintVM (0x12)`, `PrintFreeMemoryPointer (0x13)`, `PrintGasLeft (0x14)`, `PrintFee (0x15, wrapper — runs the rest then prints ctx.fee)`, `PatchSwapRegisters (0x1a, [balanceIn, balanceOut, amountIn, amountOut] → overwrite registers)`. They use `forge-std/console.sol`; never deploy them.

---

## 4. `Strategies.sol` — `src/strategies/Strategies.sol`

On-chain-safe builders for two canonical programs, intended for contracts (e.g. an Aqua app front-end) that must construct bytecode on-chain from untrusted parts:

```solidity
struct LimitOrder { uint256 balanceA; uint256 balanceB; bool direction; }
struct XYCConcentrateOrder { uint256 sqrtPriceMin; uint256 sqrtPriceMax; uint24 feeBps; }
function buildLimitOrder(bytes[] calldata prefix, LimitOrder calldata args) internal pure returns (bytes memory);
    // = prefix… ++ StaticBalances(balanceA, balanceB) ++ LimitSwap(direction)                       (Strategies.sol:71-86)
function buildXYCConcentrateOrder(bytes[] calldata prefix, XYCConcentrateOrder calldata args) internal pure returns (bytes memory);
    // = prefix… ++ FeeFlatIn(feeBps) ++ XYCConcentrateSwap(sqrtPriceMin, sqrtPriceMax)              (Strategies.sol:88-103)
```
`prefix` is a list of already-encoded instructions restricted by `_checkPrefix` to the **validation-only bitmap** `{OnlyTakerTokenBalanceNonZero, OnlyTakerTokenBalanceGte, OnlyTakerTokenSupplyShareGte, OnlyTxOriginTokenBalanceNonZero, Deadline, Salt, ValidateSeriesEpoch}` (`Strategies.sol:46-53`); each prefix instruction must have `length == 2 + args[1]` (`PrefixInvalidLength`) and an allowed opcode (`PrefixUnregistered`). Because prefixes never touch registers, the resulting program keeps the maker's rate/liquidity invariants no matter what the caller injects. Note `buildXYCConcentrateOrder` has no `DynamicBalances`: it is meant for **Aqua mode** (balances come from `AQUA.safeBalances`). Tests: `test/Strategies.t.sol`.

---

## 5. Ordering / interaction cheat-sheet

| Want | Program order |
|---|---|
| One-shot limit order (sig mode) | `InvalidateBit(n) → StaticBalances → LimitSwap` |
| Partially fillable limit order | `StaticBalances → LimitSwap → InvalidateTokenOut` (or `InvalidateTokenOut → StaticBalances → LimitSwap`) |
| Limit order + third-party fee + partial fills | `StaticBalances → InvalidateTokenOut → FeeProtocol(...) → LimitSwap` (invalidator outside fee) |
| Dutch auction | `StaticBalances → DutchAuctionBalanceIn → LimitSwap` or `StaticBalances → PiecewiseLinearScaleBalanceIn → LimitSwap` (+ `Deadline`, `InvalidateBit`) |
| Rate-guarded external logic | `StaticBalances → InvalidateTokenIn → RequireMinRate → Extruction(target, args)` |
| AMM (sig mode) | `DynamicBalances → [Decay] → [FeeProtocol] → FeeFlatIn → XYCSwap / XYCConcentrateSwap / PeggedSwap` |
| AMM (Aqua mode) | `[Salt] → [FeeProtocol] → FeeFlatIn → XYCConcentrateSwap(sqrtMin, sqrtMax)` (no balance opcode) |
| Gas / oracle repricing | `StaticBalances → LimitSwap → BaseFeeAdjuster / OraclePriceAdjuster` (after the curve) |
| Gated by taker holdings / time / epoch | any of `OnlyTaker* / Deadline / ValidateSeriesEpoch / PrivateOrder` first (leaf validators) |
| Direction-specific programs | `JumpIfDirection(true, pc) → (B→A branch) → Stop → (A→B branch)` |

Hard incompatibilities from source comments: `DutchAuctionBalanceIn`/`PiecewiseLinearScaleBalanceIn` ⟂ `InvalidateTokenIn`; `…Out` ⟂ `InvalidateTokenOut`; `DynamicBalances`, `Decay`, `TWAPSwap`, `FeeProtocol` once per program; `LimitSwap*`, `*MinRate`, `BaseFeeAdjuster`, `OraclePriceAdjuster` are single-direction; `Extruction` more than once risks quote/swap divergence.

---

## 6. What is NOT possible with existing opcodes (needs a custom instruction, an Extruction target, or off-chain logic)

1. **Conditional flow on amounts, balances, time, or storage.** Jumps branch only on direction, token identity, and (whitelists) taker identity/time-slot. "If amountIn > X use curve 2", "if reserves imbalanced widen fee", "if price outside range stop" all require an Extruction target that rewrites `nextPC`, or a new `JumpIf*` opcode.
2. **Reading arbitrary external state.** Built-ins read only: taker/tx.origin ERC-20 balances & totalSupply, a Chainlink-shaped `latestRoundData()`, an `IProtocolFeeProvider`, `block.timestamp`, `block.basefee`, and the router's own namespaced storage. No Uniswap/Pyth/Aqua/other-order reads. Extruction can read anything (it is a plain call) but can only feed results back through the four registers and the PC.
3. **Time-varying weights or curvature.** Curves are fixed-shape: 50/50 constant product, concentrated CP with fixed `[sqrtPmin, sqrtPmax]`, pegged curve with hardcoded `p = 0.5` and fixed `A`. There is no Balancer-style weighted invariant, no TWAMM, no curve whose parameters move with time — only *balances* can be time-scaled (`DutchAuction*`, `PiecewiseLinearScale*`, `TWAPSwap`, `Decay`). Range orders that move their range (e.g. "trailing" concentrated liquidity) need a custom opcode.
4. **Dynamic / volatility-aware LP fees.** Fees are flat `uint24` constants (`FeeFlatIn/Out`) or third-party (`FeeProtocol`); progressive fees were removed. The only dynamic fee hook is `IProtocolFeeProvider`, and it pays *third parties*, not the maker. A maker-side dynamic fee (e.g. based on `Decay` state or oracle spread) is a custom instruction.
5. **Multi-hop / multi-asset positions.** An order is exactly `(tokenA, tokenB)`; Aqua balances are loaded only for `tokenIn/tokenOut`. Three-asset pools, routing through an intermediate token, or "sell A for B or C" are not expressible in one program (a taker contract can chain `swap()` calls or use `preTransferOutCallback`, but that is taker-side).
6. **Cross-strategy / cross-order accounting.** All stateful opcodes key on `orderHash` (DynamicBalances, Decay, TWAP, InvalidateToken*) or `maker` (InvalidateBit, SeriesEpoch). No opcode can read or debit another order's counters, share a fill budget across several orders, or net positions. (In Aqua mode the maker can ship the same tokens to several strategies, but that sharing lives in Aqua, not in the VM — check the Aqua KB for `safeBalances` semantics.)
7. **Self-advancing recurring orders (DCA "every N hours").** `ValidateSeriesEpoch` only *checks* an epoch; advancing needs a maker transaction (`seriesEpochIncrease/Advance`). No opcode derives the epoch from `block.timestamp`, and `InvalidateBit` cannot be "reset". `TWAPSwap` gives a linear unlock but with the price behaviour in 3.6. A "time-bucketed invalidator" (`filled[orderHash][bucket = (now - start) / period]`) is a natural custom instruction.
8. **Conditional liquidity (liquidity that exists only under a condition).** Beyond taker-holding gates, deadlines, whitelists and epochs, there is no "only if oracle price within band", "only if pool imbalance < x", "only after another order filled". Extruction or a custom validator opcode.
9. **Writing router storage from external logic / emitting custom events.** Extruction targets get their own storage only; nothing in a program can emit events (only `Swapped` and the `*External` cancel events exist) or write router state except the fixed stateful opcodes.
10. **Non-Chainlink oracles, negative/inverted prices, decimal normalisation.** `OraclePriceAdjuster` assumes `int256 answer ≥ 0` in "tokenOut per tokenIn raw units" and never adjusts against the taker — a symmetric oracle-pegged AMM (both directions, maker-favourable too) is a custom opcode.
11. **Taker-supplied parameters influencing pricing.** Only Extruction consumes `instructionsArgs`. There is no built-in "taker picks branch / passes a signed quote / passes an oracle proof".
12. **Native ETH inside the VM.** Only WETH wrap/unwrap in settlement (`msg.value` accepted when `tokenIn == WETH`).
13. **Fees paid to the maker in a different token, rebates, referral splits beyond FeeProtocol's ≤15 receivers.**
14. **Per-block/per-taker rate limits, max fill per trade as a fraction of reserves** (LimitSwap caps at full balance; AMMs cap at `balanceOut`). A custom opcode would clamp `amountOut ≤ balanceOut * k`.
15. **Loops with counters.** Backward `Jump` exists but there is no register to count iterations; loops would run until gas exhaustion unless an Extruction target changes the PC.

Escape-hatch ranking for the hackathon: (a) **Extruction target contract** (no router redeploy, official router usable, but limited to registers/PC and ~235 B args, and only as strong as your own guards); (b) **custom opcode in a redeployed router** (prize explicitly allows it: "redeployments of a modified SwapVM contract is allowed") — see section 7; (c) maker hooks `IMakerHooks` for side effects after pricing.

---

## 7. Adding a custom instruction (what to touch)

1. Pick a free slot in the right bank of `enum Opcode` (`src/libs/OpcodeList.sol`; e.g. `_52`, `_55…_5f` for curves, `_33…_3f` for conditions, `_92/_93/_96/_97` for balance tuning, `_b3/_b5…` for rate tuning; never `0xf0-0xff`). Keep existing numbers unchanged so shared tooling still decodes programs.
2. Write `library MyOp { Opcode constant opcode = Opcode.X; sizeOf; build (both overloads); parse; exec(Context memory, bytes calldata) }` following `src/instructions/DutchAuction.sol`. Respect: rounding favours maker (`amountIn` ceil, `amountOut` floor), `if (!ctx.vm.isStaticContext)` around storage writes, ERC-7201 slot in `StorageSlots.sol`, an `*External` contract for getters/cancels.
3. Add a dispatch line to `_runOpcode` in `src/opcodes/Opcodes.sol` (or a new `MyOpcodes is Opcodes` overriding `_runOpcode` and calling `super`), and inherit the `*External` contract there.
4. Router: `contract MyRouter is Simulator, SwapVM, MyOpcodes { constructor(aqua, weth, owner, name, version) SwapVM(...) {} function _dispatch(...) internal override { _runOpcode(ctx, opcode, args); } }`. Deploy with `Aqua = 0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` on the target chain; in Aqua mode makers `aqua.ship(address(myRouter), abi.encode(order), tokens, amounts)` and the strategy hash must equal `myRouter.hash(order)` (`test/base/AquaStrategyBuilders.sol:146-155`).
5. Tests: extend `test/OpcodeEnumCheck.t.sol`, and run `CoreInvariants` (`test/invariants/CoreInvariants.t.sol`, `assertAllInvariantsWithConfig`) for symmetry / additivity / monotonicity / quote-swap consistency.

---

## 8. Maker / taker traits needed for usage snippets

```solidity
ISwapVM.Order memory order = MakerTraitsLib.build(MakerTraitsLib.Args({
    maker: maker, receiver: address(0), tokenA: A, tokenB: B,           // A < B
    shouldUnwrapWeth: false, useAquaInsteadOfSignature: true /* Aqua mode */, allowZeroAmountIn: false,
    hasPreTransferInHook: false, hasPostTransferInHook: false, hasPreTransferOutHook: false, hasPostTransferOutHook: false,
    preTransferInTarget: address(0), preTransferInData: "", postTransferInTarget: address(0), postTransferInData: "",
    preTransferOutTarget: address(0), preTransferOutData: "", postTransferOutTarget: address(0), postTransferOutData: "",
    program: bytes.concat(FeeFlatIn.build(0.003e7), XYCConcentrateSwap.build(sqrtMin, sqrtMax), Salt.build(uint64(1)))
}));
bytes memory takerData = TakerTraitsLib.build(TakerTraitsLib.Args({
    taker: msg.sender, isExactIn: true, shouldUnwrapWeth: false, isStrictThresholdAmount: false,
    isFirstTransferFromTaker: false, useTransferFromAndAquaPush: true /* taker pays via transferFrom+Aqua.push */,
    isAToB: true, allowPartialFill: false, threshold: abi.encodePacked(minOut), to: address(0), deadline: 0,
    hasPreTransferInCallback: false, hasPreTransferOutCallback: false,
    preTransferInHookData: "", postTransferInHookData: "", preTransferOutHookData: "", postTransferOutHookData: "",
    preTransferInCallbackData: "", preTransferOutCallbackData: "", instructionsArgs: "" /* Extruction reads this */,
    signature: "" /* empty in Aqua mode */
}));
(uint256 amountIn, uint256 amountOut, bytes32 orderHash) = router.swap(order, 1e18, takerData);
```
`order.data` layout: `tokenA(20) ‖ tokenB(20) ‖ [hookTarget(20)?‖hookData]×4 ‖ program`; `MakerTraits` packs flags (bits 245-255), 4×uint16 slice offsets (bits 160-223), receiver (bits 0-159) (`src/libs/MakerTraits.sol:34-56,129-170`). `TakerTraits` = 22-byte header (10×uint16 slice offsets + 16 flag bits) followed by slices (`src/libs/TakerTraits.sol:97-175`).

---

## 9. Selectors (computed with `cast sig`) for on-chain verification

`AQUA()` 0x63fccba9 · `WETH()` 0xad5c4648 · `hash((address,uint256,bytes))` 0xf5d08521 · `quote((address,uint256,bytes),uint256,bytes)` 0xb7ebf0c5 · `swap((address,uint256,bytes),uint256,bytes)` 0xa69f95bd · `twapLastSwap(bytes32)` 0x65986a24 · `seriesEpoch(address,uint256)` 0xac9a374e · `seriesEpochIncrease(uint256)` 0xb176d0db · `seriesEpochAdvance(uint256,uint8)` 0x435e5f1e · `balance(bytes32,address)` 0x787deabd · `bitInvalidators(address,uint256)` 0x2a3030f5 · `invalidateBit(uint256)` 0x03e07168 · `invalidateBits(uint256,uint256)` 0xa60cda2b · `tokenInInvalidators(address,bytes32,address)` 0x34437b1d · `invalidateTokenIn(bytes32,address)` 0x2a5362ac · `tokenOutInvalidators(address,bytes32,address)` 0x6be9c958 · `invalidateTokenOut(bytes32,address)` 0x4248bc46 · `extruction(bool,uint256,(bytes32,address,address,address,address,bool),(uint256,uint256,uint256,uint256),bytes,bytes)` 0xccd435ec · `getRecipientAndFees(bytes32,address,address,address,address,bool)` 0xc89cc373 · `latestRoundData()` 0xfeaf968c · `ORDER_TYPEHASH` 0x4ff6e0f284e5bda3bffd2bfd3adc9a8f89d4c787c8be730b8c214c0e10bb3d40.

---

## 10. Deployment facts in this clone (and what is UNCERTAIN)

* README (`README.md:56-74`): "Contract Address: `0x111111338c5091E8440b67B168bAe16a668AC0De`" on Ethereum, Base, Optimism, Polygon, Arbitrum, Avalanche, BSC, Linea, Sonic, Unichain, Gnosis, zkSync, Cronos, Monad, HyperEVM.
* `broadcast/__DeployPadCreate.s.sol/<chain>/run-latest.json` (15 chains) record deployments of **`AquaSwapVMRouter`** with constructor args `(aqua = 0x4a055AA172C98ec32de118B9B5b6AC8B4099A580, weth = chain WETH, owner = 0x0BD61d605C64A857C3D94779aEf7cA295702b3A2, name = "1inch SwapVM v1.0", version = "1.0.1")` (an earlier run used version "1.0"). The recorded addresses (`0x3c4758979ec30ca45857cabc2462a70699ed790e` on mainnet, etc.) are **not** `0x111111338c…`, and the Aqua arg differs from the registry address in the task brief (`0x1111113ccf…`). The `__DeployPadCreate.s.sol` script itself is not in the repo. `ignition/parameters/chain-1.json` has placeholders and version "1.2.0".
* Therefore **UNCERTAIN**: which router class / opcode set / Aqua address / EIP-712 domain (`name`, `version`) is live at `0x111111338c…`. RPC probes from this sandbox were blocked. Verify before designing around `LimitSwap`, `DynamicBalances`, `TWAPSwap`, invalidators, etc.:
  ```bash
  R=0x111111338c5091e8440b67b168bae16a668ac0de
  cast call $R "AQUA()(address)" --rpc-url $RPC                 # expect 0x1111113ccf… if wired to the canonical registry
  cast call $R "twapLastSwap(bytes32)(uint256,uint256,uint256,uint256)" 0x00…00 --rpc-url $RPC   # reverts ⇒ not the full Opcodes set
  cast call $R "balance(bytes32,address)(uint256)" 0x00…00 0x00…00 --rpc-url $RPC              # DynamicBalancesExternal present?
  cast call $R "seriesEpoch(address,uint256)(uint256)" 0x00…00 0 --rpc-url $RPC                 # Opcodes/LimitOpcodes present?
  ```
  If these revert, the live router is `AquaSwapVMRouter` (15 opcodes, section 2) and anything else needs a redeployed router (allowed by the prize) or an Extruction target.

---

## 11. Known invariant caveats (from `TESTING.md`)

`TWAPSwap` violates symmetry/additivity/monotonicity (time + state); `BaseFeeAdjuster` breaks symmetry and additivity; `Decay` makes additivity state-dependent; `FeeFlatOut` on reinvesting curves is superadditive; `DutchAuction` + `FeeProtocol` additivity is marked TODO. `README.md` core invariants: exact-in/out symmetry, subadditivity preferred, quote/swap consistency, price monotonicity, rounding favours maker, balance sufficiency, strategy liveness.

---

## 12. Numeric verification performed (throwaway `forge test`, file deleted afterwards)

`SwapVMRouter` in signature mode, `tokenA < tokenB`, exact-in quote of `1e18 A → B`, `allowPartialFill = true`:

| Program | t | amountOut (B) |
|---|---|---|
| `StaticBalances(2000e18,1000e18) → DutchAuctionBalanceIn(start,3600,0.9999e18) → LimitSwap` | 1 s | 0.50005e18 |
| same | 1800 s | 0.59861e18 |
| `… → DutchAuctionBalanceOut(start,3600,0.9999e18) → LimitSwap` | 1 s / 1800 s | 0.50005e18 / 0.59861e18 |
| `… → PiecewiseLinearScaleBalanceIn(start,[1000],[0xFFFFFF,8388607]) → LimitSwap` | 0 / 500 / 5000 s | 0.5e18 / 0.6667e18 / 1.0e18 |
| `TWAPSwap(2000e18,1000e18,start,86400,1.2e18,1e15) → LimitSwap` | 10 % / 50 % / end+1 | 0.2107e18 / 0.0028e18 / 4.95e11 |

Interpretation: Dutch/PWL scale the ask *down* over time (taker-favourable); TWAP's `decay` scales `amountOut` *down* (maker-favourable) between fills.
