# SwapVM: custom instructions, custom routers, Extruction, invariants, gas

Knowledge base for engineers/agents building an ETHOnline 2026 "Aqua app" on 1inch SwapVM. Everything below was
read from the local clones (paths abbreviated `swap-vm/` = `.../scratchpad/refs/swap-vm`, commit `f09a41e`,
2026-09-03, "Merge pull request #180 from 1inch/feature/remove-progressive-fees"; `aqua/` = `.../refs/aqua`,
commit `9c5c42e`, 2026-08-21). The worked example in section 5 was compiled and its 3 tests pass with
`forge 1.0.0-dev` (commit 7461390), solc 0.8.30, `via_ir`, `optimizer_runs = 700` (repo settings).
Anything not verified is marked **UNCERTAIN**.

---

## 0. TL;DR (decision-relevant)

1. **There is no `ProgramBuilder` / `p.build(fn, args)` / `_instructions()` API anymore.** The README/docs still
   describe it (README.md:1129-1142, 1877-1889) but the code at HEAD uses: a fixed `enum Opcode` byte table
   (`src/libs/OpcodeList.sol`), one **library per instruction** exposing `opcode`, `sizeOf`, `build`, `parse`,
   `exec`, and an **if/else dispatcher** `_runOpcode(ctx, opcode, args)` in `src/opcodes/{Opcodes,LimitOpcodes,AquaOpcodes}.sol`.
   Programs are built with `bytes.concat(Lib1.build(...), Lib2.build(...), ...)`.
2. **Program encoding**: `[opcode:1 byte][argsLength:1 byte][args:argsLength bytes]` repeated; args are packed
   big-endian with no ABI padding; max 255 arg bytes per instruction (`InstructionBuilder.patchLength`, InstructionBuilder.sol:25-29).
3. **Instruction signature is `function exec(Context memory ctx, bytes calldata args) internal`** (in a library),
   not `_foo(...)`. It mutates `ctx.swap` (registers), may call `ctx.setNextPC()`, `ctx.tryChopTakerArgs(n)`,
   and `ctx.runLoop()` (wrap-around), and must guard storage writes with `if (!ctx.vm.isStaticContext)`.
4. **Adding an opcode = 4 places**: (a) pick an enum slot in `OpcodeList.sol` (free `_xx` placeholder of the right
   bank - you can use `Opcode._d0` *without* forking), (b) write the library, (c) add an `else if` in the router's
   `_runOpcode` (override it in your router; Debug routers inherit automatically), (d) tests + gas snapshot.
5. **Official deployed router `0x111111338c5091E8440b67B168bAe16a668AC0De` is an `AquaSwapVMRouter`**
   (verified on-chain: `AQUA() = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` on Ethereum and Base,
   EIP-712 domain `"1inch SwapVM v1.0"`/`"1.0.2"`, owner `0x5AFc5DF416640348235a0571dBEEf9064cb0338D`;
   `balance(bytes32,address)` and `seriesEpoch(address,uint256)` revert, i.e. no DynamicBalances/SeriesEpoch
   externals). Its opcode set (`AquaOpcodes`, 16 opcodes) has **no** StaticBalances/DynamicBalances, LimitSwap,
   Invalidators, TWAP, DutchAuction, MinRate, FeeFlatOut, Stop/Revert, JumpIfDirection, Whitelists, PiecewiseLinearScale, OraclePriceAdjuster, BaseFeeAdjuster.
   It **does** have `Extruction` (0x04): custom logic can be plugged into the *official* router via an external
   contract without redeploying anything.
6. **Code size**: with repo settings `SwapVMRouter` (full `Opcodes`) is **28,486 B runtime = 3,910 B over EIP-170**
   (cannot be deployed on standard EVM chains); `AquaSwapVMRouter` 20,376 B (4,200 B headroom),
   `LimitSwapVMRouter` 20,712 B (3,864 B headroom). Extend `AquaOpcodes`/`LimitOpcodes`, not `Opcodes`,
   for anything you intend to deploy. My `MyRouter` (AquaOpcodes + 1 opcode + 1 getter) = 21,176 B.
7. **Extruction is a CALL, not a delegatecall** (`IExtruction(target).extruction(...)` / `IStaticExtruction` `view`
   in quote mode). The target cannot read/write router storage; it has its own storage; it receives
   `(isStaticContext, nextPC, SwapQuery, SwapRegisters, args, takerData)` and returns `(nextPC, choppedLength, SwapRegisters)`.
8. Gas (repo snapshots, signature-mode `SwapVMRouter`): `LimitSwap` swap 50,882 / quote 6,424; `XYCSwap`
   (DynamicBalances) swap 96,426 / quote 11,525; per-opcode marginal cost e.g. XYCSwap 1,007, Salt 1,005,
   DynamicBalances 26,925, InvalidateBit 23,647, PeggedSwap 8,040, XYCConcentrateSwap 4,559. My Aqua-mode
   `MyRouter` swap: 143,012 gas (cold: first Aqua push/pull + first storage write), 77,181 warm.

---

## 1. Repo facts

| Item | Value |
|---|---|
| Solidity | `0.8.30`, `optimizer_runs = 700`, `via_ir = true` (`foundry.toml`, `hardhat.config.ts`); EVM must be >= cancun (`TransientLock` uses tstore) |
| Deps (`package.json`) | `@1inch/aqua` github `1inch/aqua#v1.0.0` (package.json version says 0.1.0), `@1inch/solidity-utils` 6.9.10, `@openzeppelin/contracts` 5.4.0, `forge-std` v1.11.0. Installed under `swap-vm/node_modules` (no `lib/`), remappings in `swap-vm/remappings.txt` |
| Test runner | Hardhat 3 (`yarn test` = `npx hardhat test`, ~771 solidity tests, ~7 min full compile); forge also works with the repo's `remappings.txt` (I used forge) |
| Layout | `src/SwapVM.sol` (engine), `src/libs/{VM,OpcodeList,InstructionBuilder,InstructionArgs,MemoryPtr,StorageSlots,MakerTraits,TakerTraits,ProtocolFee}.sol`, `src/instructions/*.sol` (one lib per opcode family), `src/opcodes/{Opcodes,LimitOpcodes,AquaOpcodes}[Debug].sol`, `src/routers/{SwapVMRouter,LimitSwapVMRouter,AquaSwapVMRouter}[Debug].sol`, `src/strategies/Strategies.sol`, `test/**` |
| License | `LicenseRef-Degensoft-SwapVM-1.1` (source-available, not MIT) |
| Deployed (README.md:56-74) | `0x111111338c5091E8440b67B168bAe16a668AC0De` on Ethereum, Base, Optimism, Polygon, Arbitrum, Avalanche, BSC, Linea, Sonic, Unichain, Gnosis, zkSync, Cronos, Monad, HyperEVM |
| Broadcast evidence | `broadcast/__DeployPadCreate.s.sol/{1,8453,...}/run-latest.json`: `CREATE AquaSwapVMRouter` at pad address `0x3c4758979ec30ca45857cabc2462a70699ed790e` with ctor args `(aqua=0x4a055AA172C98ec32de118B9B5b6AC8B4099A580, weth, owner=0x0BD61d605C64A857C3D94779aEf7cA295702b3A2, "1inch SwapVM v1.0", "1.0.1")`; `__DeployPadCreate3.s.sol` then deploys via a CREATE3 factory `0xef1aa3c8e20b544912da97379dcb356fc90087c5` (salt `0x40be5476...`). The scripts themselves are not in the repo (**UNCERTAIN** exact final-deploy flow). On-chain the live contract reports version `1.0.2` and `AQUA()=0x1111113CCf...a90a`; `WETH()` reverted in my probe (**UNCERTAIN** why - do not rely on that getter) |
| TS SDK | `refs/sdks/typescript/aqua` contains only the Aqua contract wrapper (ship/dock/push/pull + events). **No SwapVM program builder in TS** in the clone; build programs in Solidity (tests/scripts) or hand-pack bytes |

---

## 2. Execution model (what an instruction sees)

### 2.1 Structs (`src/libs/VM.sol`)

```solidity
struct VM {                                   // VM.sol:21-27
    bool isStaticContext;                     // true in quote(), false in swap()
    uint256 nextPC;                           // PC of the NEXT instruction (already advanced when exec runs)
    CalldataPtr programPtr;                   // use ctx.program()
    CalldataPtr takerArgsPtr;                 // use ctx.takerArgs() / ctx.tryChopTakerArgs(n)
    function(Context memory, uint256, bytes calldata) internal dispatch; // router's _dispatch
}
struct SwapQuery {                            // VM.sol:37-43  (READ-ONLY by convention)
    bytes32 orderHash; address maker; address taker; address tokenIn; address tokenOut; bool isExactIn;
}
struct SwapRegisters {                        // VM.sol:51-55  (MUTABLE)
    uint256 balanceIn; uint256 balanceOut; uint256 amountIn; uint256 amountOut;
}
struct ProtocolFee { FeeMeta meta; FeeReceiver[] receivers; uint256 feeTotal; } // VM.sol:61-64
struct Context { VM vm; SwapQuery query; SwapRegisters swap; ProtocolFee fee; } // VM.sol:72-76
```

`ContextLib` helpers (VM.sol:81-159): `program(ctx)`, `takerArgs(ctx)`, `setNextPC(ctx, pc)`,
`tryChopTakerArgs(ctx, length) returns (bytes calldata)` (consumes `min(length, remaining)` bytes from the front),
`runLoop(ctx) returns (amountIn, amountOut)`.

### 2.2 The run loop (VM.sol:126-158) - exact semantics

```solidity
function runLoop(Context memory ctx) internal returns (uint256 swapAmountIn, uint256 swapAmountOut) {
    bytes calldata programBytes = ctx.program();
    uint256 length = programBytes.length;
    uint256 pcs = ctx.vm.nextPC;
    while (pcs < length) {
        uint256 opcode; bytes calldata args;
        assembly ("memory-safe") {
            let word := calldataload(add(programBytes.offset, pcs))
            opcode := shr(248, word)                       // byte 0
            let argsLength := and(shr(240, word), 0xff)    // byte 1
            pcs := add(pcs, 2)
            args.offset := add(programBytes.offset, pcs)
            args.length := argsLength
            pcs := add(pcs, argsLength)
        }
        if (pcs > length) revert RunLoopExceedProgramLength(pcs, length);
        ctx.vm.nextPC = pcs;                 // advanced BEFORE dispatch
        ctx.vm.dispatch(ctx, opcode, args);  // -> router._dispatch -> _runOpcode
        pcs = ctx.vm.nextPC;                 // instruction may have changed it (Jump, Stop, Extruction, nested runLoop)
    }
    return (ctx.swap.amountIn, ctx.swap.amountOut);
}
```

Consequences:
- A **nested `ctx.runLoop()`** inside an instruction executes *the rest of the program* and returns; because it
  leaves `ctx.vm.nextPC == program.length` the outer loop then terminates. This is the "wrap-around" pattern
  (pre-process, let the tail compute amounts, post-process). Every wrap-around opcode is documented "expected to be
  executed only once in strategy flow".
- `Stop` sets `nextPC = type(uint256).max` (Controls.sol:119-122). `Jump*` set `nextPC` to an
  instruction-aligned offset; jumping inside an instruction is undefined (Controls.t.sol:420-442).
- A PC past the end silently ends the program (Controls.t.sol:404-415), an unknown opcode reverts
  `UnknownOpcode(opcode)` from the dispatcher (RunLoop.t.sol:159-172).
- Empty program is legal but fails later with `TakerTraitsAmountOutMustBeGreaterThanZero(0)` (RunLoop.t.sol:107-116).

### 2.3 `quote()` vs `swap()` (`src/SwapVM.sol`)

`quote(order, amount, takerTraitsAndData)` (SwapVM.sol:124-175) and `swap(...)` (SwapVM.sol:177-243) build the
same `Context`; differences:

| | quote | swap |
|---|---|---|
| `isStaticContext` | `true` | `false` |
| reentrancy | none | `_reentrancyGuards[orderHash].lock()` (transient, per order) |
| auth | none (no signature check, but Aqua-mode still calls `AQUA.safeBalances`) | Aqua mode: `AQUA.safeBalances(maker, this, orderHash, tokenIn, tokenOut)` seeds `balanceIn/balanceOut`; else `recoverOrIsValidSignature` |
| after runLoop | `order.traits.validate(amountIn)`; `takerTraits.validate(...)` | same, then `_transferOut`/`_transferIn` in the order chosen by `isFirstTransferFromTaker`, hooks, callbacks, protocol-fee resolution, `Swapped` event |

`quote` is declared `view` only in `ISwapVM`; call it as `swapVM.asView().quote(...)` (asView returns
`ISwapVM(address(this))`, SwapVM.sol:103-105) which compiles to STATICCALL - so **any storage write reached in
quote mode reverts**, which is why every stateful opcode guards writes with `if (!ctx.vm.isStaticContext)`.

Registers at entry: `balanceIn/Out = 0` (or Aqua balances), `amountIn = isExactIn ? amount : 0`,
`amountOut = isExactIn ? 0 : amount`. Direction: `tokenIn/tokenOut` come from `order.traits.tokens(order.data)`
(tokenA < tokenB is enforced by `MakerTraitsLib.build`) swapped by `takerTraits.isAToB()`.

### 2.4 Order / taker data builders you need in tests

`MakerTraitsLib.Args` (MakerTraits.sol:79-103): `maker, receiver, tokenA, tokenB, shouldUnwrapWeth,
useAquaInsteadOfSignature, allowZeroAmountIn, hasPre/PostTransferIn/OutHook (4 bools), pre/postTransferIn/OutTarget +
Data (4 pairs), program`. `MakerTraitsLib.build(args) returns ISwapVM.Order` (MakerTraits.sol:109-171); `order.data
= tokenA(20) ++ tokenB(20) ++ hook slices ++ program`, program is the tail (`OrderDataSlices.Program`).

`TakerTraitsLib.Args` (TakerTraits.sol:58-81): `taker, isExactIn, shouldUnwrapWeth, isStrictThresholdAmount,
isFirstTransferFromTaker, useTransferFromAndAquaPush, isAToB, allowPartialFill, threshold (0 or 32 bytes), to,
deadline (uint40), hasPreTransferIn/OutCallback, 4 hook data, 2 callback data, instructionsArgs, signature`.
`instructionsArgs` becomes `ctx.vm.takerArgsPtr`. Flags bit layout TakerTraits.sol:101-109.

`ISwapVM.Order { address maker; MakerTraits traits; bytes data; }` (ISwapVM.sol:17-21).
`hash(order)` = EIP-712 (`Order(address maker,uint256 traits,bytes data)`, typehash
`0x4ff6e0f284e5bda3bffd2bfd3adc9a8f89d4c787c8be730b8c214c0e10bb3d40`, verified on-chain) or, in Aqua mode,
`keccak256(abi.encode(order))` (SwapVM.sol:109-120) which equals `Aqua.ship`'s `strategyHash = keccak256(strategy)`
when `strategy = abi.encode(order)` (Aqua.sol:40-41).

---

## 3. Anatomy of an instruction

### 3.1 Skeleton (this is the exact pattern of every file in `src/instructions/`)

```solidity
library Foo {
    using InstructionArgs for bytes;      // args.at(shift) -> bytes32 word
    using InstructionArgs for bytes32;    // word.asU32() / asAddress() / asBool(bit) ...
    using MemoryPtrLib for MemoryPtr;     // alloc/push/patch/resolve
    using InstructionBuilder for MemoryPtr; // pushHeader/patchLength
    using ContextLib for Context;         // ctx.runLoop() / setNextPC / tryChopTakerArgs

    error FooBad(uint256 x);
    Opcode constant opcode = Opcode.Foo;  // byte index, from OpcodeList.sol

    // ---- builder (pure, used off-chain / in tests / in Strategies.sol) ----
    function sizeOf(uint32, uint256) internal pure returns (uint256) { return InstructionBuilder.sizeOf() + 4 + 32; } // 2 header bytes + args
    function build(uint32 a, uint256 b) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf(a, b)), a, b).resolve();          // standalone bytes
    }
    function build(MemoryPtr ptrStart, uint32 a, uint256 b) internal pure returns (MemoryPtr ptr) {
        ptr = ptrStart.pushHeader(opcode);      // writes opcode byte, skips the length byte
        ptr = ptr.push(a, 4).push(b, 32);       // push(uint256 value, uint8 size) / push(address) / push(uint8) / pushMem(bytes)
        ptrStart.patchLength(ptr);              // writes args length (must be < 256) into byte 1
    }
    // ---- parser ----
    function parse(bytes calldata args) internal pure returns (uint32 a, uint256 b) {
        a = args.at(0).asU32();                 // InstructionArgs.at = calldataload(args.offset + shift) (no bounds check!)
        b = args.at(4).asU256();
    }
    // ---- executor ----
    function exec(Context memory ctx, bytes calldata args) internal { ... }
}
```

Library refs: `InstructionBuilder.sizeOf()==2`, `pushHeader`, `patchLength`, `encodeBool(value, bit)` =
`128 >> bit` (InstructionBuilder.sol:17-34). `InstructionArgs.at/asBool/asAddress/asU8..asU256/asBytes1..32`
(InstructionArgs.sol:13-89); `asBool(word, bit)` reads bit `bit` counting from the MSB of the first byte, matching
`encodeBool`. `MemoryPtr` packs `[current<<128 | end<<64 | start]`; `resolve()` requires exact fill,
`resolveShrink()` allows a shorter result (used by `FeeProtocol.build`) (MemoryPtr.sol:27-64).
`InstructionArgs` does **no** out-of-bounds validation ("Order creator is responsible", InstructionArgs.sol:8-9);
short args read zero-padded calldata.

### 3.2 Mutating registers - stateless curve (XYCSwap.sol:37-45)

```solidity
function exec(Context memory ctx, bytes calldata) internal pure {
    if (ctx.query.isExactIn) {
        ctx.swap.amountOut = ctx.swap.amountIn * ctx.swap.balanceOut / (ctx.swap.balanceIn + ctx.swap.amountIn); // floor favors maker
    } else {
        ctx.swap.amountIn = (ctx.swap.amountOut * ctx.swap.balanceIn).ceilDiv(ctx.swap.balanceOut - ctx.swap.amountOut); // ceil favors maker
    }
}
```
Rules (`.cursor/rules/security-review.mdc`, BUGBOT.md): handle both `isExactIn` branches; exactIn rounds output
DOWN, exactOut rounds input UP; direction-dependent params must be swapped on `tokenIn < tokenOut`
(e.g. `StaticBalances.exec` Balances.sol:46-54, `LimitSwap.exec` requires `direction == (tokenIn < tokenOut)` LimitSwap.sol:53-57).

### 3.3 Validation-only instruction (Deadline, Controls.sol:151-158)

```solidity
function exec(Context memory, bytes calldata args) internal view {
    uint40 deadline = parse(args);
    require(block.timestamp <= deadline, DeadlineReached(deadline));
}
```
`Strategies.sol:46-53` whitelists such "prefix" opcodes (OnlyTakerTokenBalance*, OnlyTxOriginTokenBalanceNonZero,
Deadline, Salt, ValidateSeriesEpoch) as safe to prepend to any program because they never touch registers.

### 3.4 Control flow (Jump, Jumps.sol:50-53)

```solidity
function exec(Context memory ctx, bytes calldata args) internal pure { ctx.setNextPC(parse(args)); } // uint16 offset into program
```
`JumpIfDirection` (`direction == (tokenIn < tokenOut)`), `JumpIfTokenIn`, `JumpIfTokenOut`, `WhitelistCoequal` /
`WhitelistSequential` (jump if taker whitelisted) all follow this. Offsets are absolute byte offsets; tests compute
them from `build(...).length` (Controls.t.sol:251-284). Builders expose `patchNextPC(ptrStart, nextPC)` to
back-patch (Jumps.sol:42-44).

### 3.5 Storage + isStaticContext + wrap-around (DynamicBalances, Balances.sol:92-125)

```solidity
struct Storage { mapping(bytes32 orderHash => mapping(address token => uint256)) balance; }
function store() internal pure returns (Storage storage $) { bytes32 slot = StorageSlots.DynamicBalances; assembly ("memory-safe") { $.slot := slot } }

function exec(Context memory ctx, bytes calldata args) internal {
    Storage storage $ = store();
    uint256 balanceIn = $.balance[ctx.query.orderHash][ctx.query.tokenIn];
    uint256 balanceOut = $.balance[ctx.query.orderHash][ctx.query.tokenOut];
    if (balanceIn | balanceOut == 0) {                    // first execution: seed from args
        if (ctx.query.tokenIn < ctx.query.tokenOut) (balanceIn, balanceOut) = parse(args);
        else (balanceOut, balanceIn) = parse(args);
    }
    ctx.swap.balanceIn = balanceIn; ctx.swap.balanceOut = balanceOut;
    (uint256 amountIn, uint256 amountOut) = ctx.runLoop();   // run the rest (fees, curve, ...)
    balanceIn += amountIn; balanceOut -= amountOut;
    require(balanceIn | balanceOut != 0, DynamicBalancesReachZero());
    if (!ctx.vm.isStaticContext) {                           // quote() must not write (STATICCALL)
        $.balance[ctx.query.orderHash][ctx.query.tokenIn] = balanceIn;
        $.balance[ctx.query.orderHash][ctx.query.tokenOut] = balanceOut;
    }
}
```
Storage lives in the **router** at an ERC-7201 namespaced slot; slots are precomputed constants in
`src/libs/StorageSlots.sol:8-29` (`keccak256(abi.encode(uint256(keccak256("1inch.storage.<Name>")) - 1)) & ~0xff`;
I reproduced `DynamicBalances = 0x8a1457da...2e00` with that formula). A companion `contract XxxExternal` (e.g.
`DynamicBalancesExternal.balance(bytes32,address)`, `InvalidateBitExternal.invalidateBit(uint256)`,
`TWAPSwapExternal.twapLastSwap(bytes32)`, `ValidateSeriesEpochExternal.seriesEpochIncrease(uint256)`) is mixed
into the opcode-set contract to expose/cancel state (Opcodes.sol:32-39).

Other wrap-around examples: `Decay` (Decay.sol:61-80, virtual offsets decaying over `period`, writes 2 slots),
`InvalidateBit` (Invalidators.sol:59-73, check bit -> runLoop -> set bit), `InvalidateTokenIn/Out`
(Invalidators.sol:141-159/218-236, scale balances by remaining fill, then bound cumulative fill),
`TWAPSwap` (TWAPSwap.sol:161-246), `RequireMinRate`/`AdjustMinRate` (MinRate.sol:51-61/100-118, post-validate or
patch final amounts), `FeeFlatIn` (see next).

### 3.6 Fee wrap-around with exactIn/exactOut asymmetry (FeeFlatIn.sol:53-70)

```solidity
function exec(Context memory ctx, bytes calldata args) internal {
    uint24 feeBps = parse(args);                       // BPS = 1e7 (100% = 1e7, so 0.3% = 0.003e7 = 30_000)
    if (ctx.query.isExactIn) {
        uint256 fee = (ctx.swap.amountIn * feeBps).ceilDiv(BPS);
        ctx.swap.amountIn -= fee;                      // curve sees net input
        uint256 reduction = ctx.swap.amountIn;
        ctx.runLoop();
        reduction -= ctx.swap.amountIn;                // did the tail shrink amountIn (partial fill)?
        if (reduction == 0) ctx.swap.amountIn += fee;  // restore taker-specified amount
        else ctx.swap.amountIn += (ctx.swap.amountIn * feeBps).ceilDiv(BPS - feeBps);
    } else {
        ctx.runLoop();
        ctx.swap.amountIn += (ctx.swap.amountIn * feeBps).ceilDiv(BPS - feeBps);
    }
}
```
Note: taker-specified amount must come back unchanged unless `allowPartialFill` (TakerTraits.validate:187-230).

### 3.7 Consuming taker args (only `Extruction` does it today)

`ctx.takerArgs()` returns the remaining `instructionsArgs`; `ctx.tryChopTakerArgs(n)` consumes up to `n` bytes
(VM.sol:114-118). Extruction passes the whole remainder to the target and then chops exactly `choppedLength`
(Extruction.sol:86-87, reverts `ExtructionChoppedExceedsLength` if fewer bytes were available). A custom
instruction reading taker-supplied data (e.g. an oracle quote, a max gas price) should do
`bytes calldata mine = ctx.tryChopTakerArgs(32); require(mine.length == 32)` and treat it as **untrusted**.

### 3.8 Checklist for a new instruction (from BUGBOT.md + security-review.mdc)

- Validate builder inputs in `build` (e.g. `FeeFlatIn.build` requires `feeBps < BPS`; `XYCConcentrateSwap.build`
  requires `0 < sqrtPriceMin < sqrtPriceMax`), so bad programs cannot be built by honest tooling.
- Both `isExactIn` branches; rounding in maker's favor; division-by-zero; overflow of intermediate products.
- No storage writes when `ctx.vm.isStaticContext`; quote must equal swap for identical inputs.
- Direction-dependent params swapped on `tokenIn < tokenOut`.
- "Wrap-around" opcodes: execute once; document ordering constraints (e.g. `InvalidateTokenIn` must run before
  amount-modifying opcodes like `FeeProtocol`; `DutchAuctionBalanceIn` must not be combined with `InvalidateTokenIn`).
- Wire the opcode into the correct opcode tables **and** Debug variants (Debug variants inherit, see 4.3).
- Tests: `vm.expectRevert(Lib.Error.selector)` with exact error, mocks in `test/mocks/`, invariants via `CoreInvariants`.

---

## 4. Opcode table, dispatch, routers

### 4.1 `enum Opcode` (`src/libs/OpcodeList.sol:16-292`) - banked byte space

Banks: `0x00-0x0f` core, `0x10-0x1f` debug (only wired in `*Debug` sets), `0x20-0x3f` conditions/guards/jumps,
`0x40-0x4f` invalidators/epochs, `0x50-0x6f` swap curves, `0x70-0x8f` fees, `0x90-0xaf` balance tuning,
`0xb0-0xcf` rate tuning, `0xd0-0xef` **unallocated**, `0xf0-0xff` **reserved, never allocate** (2-byte escape
prefix idea). Free slots are named `_xx`; `OpcodeEnumCheck.t.sol` pins the hex labels.

Allocated indices (index -> instruction library, file, encoding of args):

| idx | Instruction | File | Args encoding |
|---|---|---|---|
| 0x00 | Stop | Controls.sol | `[]` |
| 0x01 | Revert | Controls.sol | `[bytes4 exception]` or `[bytes exception]` -> `InstructionRevert(bytes)` |
| 0x02 | Salt | Controls.sol | `[uint64]` or `[bytes]` (no-op, changes order hash) |
| 0x03 | Jump | Jumps.sol | `[uint16 nextPC]` |
| 0x04 | Extruction | Extruction.sol | `[address target, bytes extructionArgs]` |
| 0x10 | PrintSwapRegisters | Debug.sol | `[]` (console.log) |
| 0x11 | PrintSwapQuery | Debug.sol | `[]` |
| 0x12 | PrintVM | Debug.sol | `[]` |
| 0x13 | PrintFreeMemoryPointer | Debug.sol | `[]` |
| 0x14 | PrintGasLeft | Debug.sol | `[]` |
| 0x15 | PrintFee | Debug.sol | `[]` (wraps runLoop, prints fee regs after) |
| 0x1a | PatchSwapRegisters | Debug.sol | `[uint256 x4]` overwrite `ctx.swap` |
| 0x20 | Deadline | Controls.sol | `[uint40 deadline]` |
| 0x23 | OnlyTakerTokenBalanceNonZero | TokenValidators.sol | `[address token]` |
| 0x24 | OnlyTakerTokenBalanceGte | TokenValidators.sol | `[address token, uint256 amount]` |
| 0x25 | OnlyTakerTokenSupplyShareGte | TokenValidators.sol | `[address token, uint64 share(1e18)]` |
| 0x26 | OnlyTxOriginTokenBalanceNonZero | TokenValidators.sol | `[address token]` |
| 0x2b | PrivateOrder | Whitelist.sol | `[uint80 allowedTaker]` (low 10 bytes of address) |
| 0x2c | WhitelistCoequal | Whitelist.sol | `[uint16 nextPC, uint80 takers[N]]` |
| 0x2d | WhitelistSequential | Whitelist.sol | `[uint40 start, uint16 nextPC, (uint16 duration, uint80 taker)[N]]` |
| 0x30 | JumpIfDirection | Jumps.sol | `[bool direction(bit0), uint16 nextPC]` |
| 0x31 | JumpIfTokenIn | Jumps.sol | `[address token, uint16 nextPC]` |
| 0x32 | JumpIfTokenOut | Jumps.sol | `[address token, uint16 nextPC]` |
| 0x40 | InvalidateBit | Invalidators.sol | `[uint32 bitIndex]` (maker-scoped bitmap) |
| 0x41 | InvalidateTokenIn | Invalidators.sol | `[]` |
| 0x42 | InvalidateTokenOut | Invalidators.sol | `[]` |
| 0x48 | ValidateSeriesEpoch | SeriesEpochManager.sol | `[uint32 seriesId, uint32 epoch]` |
| 0x50 | XYCSwap | XYCSwap.sol | `[]` |
| 0x51 | XYCConcentrateSwap | XYCConcentrate.sol | `[uint256 sqrtPriceMin, uint256 sqrtPriceMax]` (1e18) |
| 0x53 | LimitSwap | LimitSwap.sol | `[bool direction]` (partial fills) |
| 0x54 | LimitSwapFullAmount | LimitSwap.sol | `[bool direction]` (all-or-nothing) |
| 0x58 | PeggedSwap | PeggedSwap.sol | `[uint256 x0, uint256 y0, uint256 linearWidth, uint256 rateA, uint256 rateB]` (PeggedSwap.sol:17) |
| 0x70 | FeeFlatIn | FeeFlat.sol | `[uint24 feeBps]` (BPS = 1e7) |
| 0x71 | FeeFlatOut | FeeFlat.sol | `[uint24 feeBps]` |
| 0x80 | FeeProtocol | FeeProtocol.sol | `[uint8 header, (uint8 flags, address, uint24?, uint24?)*count, uint216 surplusEstimate?]` |
| 0x90 | StaticBalances | Balances.sol | `[uint256 balanceA, uint256 balanceB]` |
| 0x91 | DynamicBalances | Balances.sol | `[uint256 balanceA, uint256 balanceB]` (storage-backed) |
| 0x94 | DutchAuctionBalanceIn | DutchAuction.sol | `[uint40 start, uint16 duration, uint64 decay(1e18)]` |
| 0x95 | DutchAuctionBalanceOut | DutchAuction.sol | same |
| 0x98 | PiecewiseLinearScaleBalanceIn | PiecewiseLinearScale.sol | `[uint40 ts, uint24 scale0, (uint16 duration, uint24 scale)[k]]`, scale = `(s+1)/2^24` |
| 0x99 | PiecewiseLinearScaleBalanceOut | PiecewiseLinearScale.sol | same |
| 0x9c | Decay | Decay.sol | `[uint16 period]` |
| 0x9d | TWAPSwap | TWAPSwap.sol | `[uint256 x6: balanceIn, balanceOut, startTime, duration, priceBump(1e18), minTradeAmountOut]` |
| 0xb0 | RequireMinRate | MinRate.sol | `[uint64 rateA, uint64 rateB]` |
| 0xb1 | AdjustMinRate | MinRate.sol | `[uint64 rateA, uint64 rateB]` |
| 0xb2 | OraclePriceAdjuster | OraclePriceAdjuster.sol | `[uint64 maxPriceDecay, uint16 maxStaleness, uint8 oracleDecimals, address oracle]` (Chainlink `latestRoundData`) |
| 0xb4 | BaseFeeAdjuster | BaseFeeAdjuster.sol | `[uint64 baseGasPrice, uint96 ethPrice, uint24 gasAmount, uint64 maxDecay]` (BaseFeeAdjuster.sol:16) |

`OpcodeOps.asU8(opcode)` (OpcodeList.sol:7-11) is the only conversion helper.

### 4.2 Which router has which opcode

| Opcode | `Opcodes` (SwapVMRouter) | `LimitOpcodes` (LimitSwapVMRouter) | `AquaOpcodes` (AquaSwapVMRouter, **deployed**) |
|---|---|---|---|
| Jump, JumpIfTokenIn, JumpIfTokenOut, Deadline, OnlyTakerTokenBalanceNonZero/Gte/SupplyShareGte, OnlyTxOriginTokenBalanceNonZero, Salt, FeeProtocol, Extruction | yes | yes | yes |
| XYCSwap, XYCConcentrateSwap, Decay, FeeFlatIn, PeggedSwap | yes | no | yes |
| StaticBalances, InvalidateBit/TokenIn/TokenOut, LimitSwap, LimitSwapFullAmount, BaseFeeAdjuster, ValidateSeriesEpoch, PrivateOrder, WhitelistCoequal, WhitelistSequential, PiecewiseLinearScaleBalanceIn/Out | yes | yes | no |
| Stop, Revert, JumpIfDirection, DynamicBalances, RequireMinRate, AdjustMinRate, DutchAuctionBalanceIn/Out, TWAPSwap, FeeFlatOut, OraclePriceAdjuster | yes | no | no |

Source: `src/opcodes/Opcodes.sol:45-87`, `LimitOpcodes.sol:34-60`, `AquaOpcodes.sol:27-45`. Extra external
mixins: `Opcodes is DynamicBalancesExternal, InvalidateBitExternal, InvalidateTokenInExternal,
InvalidateTokenOutExternal, TWAPSwapExternal, ValidateSeriesEpochExternal`; `LimitOpcodes` the four
invalidator/epoch externals; `AquaOpcodes` none.

Aqua-mode strategies need no Balances opcode: `swap()`/`quote()` seed `ctx.swap.balanceIn/Out` from
`AQUA.safeBalances` (SwapVM.sol:167-170, 221-223).

### 4.3 Dispatcher and router wiring (complete)

```solidity
// src/opcodes/AquaOpcodes.sol:21-46
contract AquaOpcodes {
    using OpcodeOps for Opcode;
    error UnknownOpcode(uint256 opcode);
    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual {
             if (opcode == Jump.opcode.asU8()) Jump.exec(ctx, args);
        else if (opcode == JumpIfTokenIn.opcode.asU8()) JumpIfTokenIn.exec(ctx, args);
        /* ... 14 more ... */
        else if (opcode == OnlyTxOriginTokenBalanceNonZero.opcode.asU8()) OnlyTxOriginTokenBalanceNonZero.exec(ctx, args);
        else revert UnknownOpcode(opcode);
    }
}
// src/opcodes/AquaOpcodesDebug.sol:13-26 - prepends the 7 Print*/Patch opcodes then `super._runOpcode`
// src/routers/AquaSwapVMRouter.sol:16-29
contract AquaSwapVMRouter is Simulator, SwapVM, AquaOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version) { }
    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override { _runOpcode(ctx, opcode, args); }
}
```
`SwapVM._dispatch` is the single abstract hook (SwapVM.sol:367-369); `ctx.vm.dispatch = _dispatch` is a
function pointer captured when the `Context` is built. Dispatch cost is a linear if/else chain (compiled with
via_ir into a jump table-ish sequence; per-opcode overhead is ~300-1000 gas, see section 8).

`Simulator` (solidity-utils) adds `simulate(address delegatee, bytes data)` which delegatecalls and always
reverts with `Simulated(delegatee, data, success, result)` - used for off-chain what-if simulation.

### 4.4 What must change to add a new opcode

1. **Opcode index**: either use a free placeholder directly (`Opcode constant opcode = Opcode._d0;` - the
   `0xd0-0xef` bank is explicitly "Unallocated"; the family banks also have free `_xx` slots, e.g. `_52`,
   `_55-_57` in swap curves, `_72-_7f` in fees, `_92,_93,_96,_97,_9a,_9b,_9e...` in balances, `_b3,_b5...` in rates),
   or fork `src/libs/OpcodeList.sol` and rename the placeholder (`/* d0 */ _d0` -> `/* d0 */ ThrottleOut`) and add
   an assert to `test/OpcodeEnumCheck.t.sol`. Never use `0xf0-0xff`. Do not renumber existing ones: on-chain
   programs (Aqua-shipped strategies) hard-code bytes.
2. **Instruction library** in `src/instructions/<Name>.sol` following section 3.1; if stateful add a
   `StorageSlots.<Name>` constant (ERC-7201 formula) and optionally a `<Name>External` view/cancel contract.
3. **Wire the dispatcher**: add `else if (opcode == Name.opcode.asU8()) Name.exec(ctx, args);` to the relevant
   opcode-set contract(s) (`Opcodes`, `LimitOpcodes`, `AquaOpcodes`) - or, without forking, subclass the opcode
   set in your own router and override `_runOpcode` (section 5). The `*Debug` sets call `super._runOpcode` so they
   pick it up automatically; if you write your own router you get debug printing by inheriting `AquaOpcodesDebug`
   instead of `AquaOpcodes` (test-only: `console.log` bloats bytecode; `SwapVMRouterDebug` is 31,913 B).
4. **Strategies.sol** (optional): if the opcode is a pure validator, add it to `_prefixBitmap` (Strategies.sol:46-53).
5. **Tests**: unit test (`Test` + `OpcodesDebug`/`AquaOpcodesDebug` for signature/Aqua mode; `AquaSwapVMTest`
   base for Aqua flows), invariants (`CoreInvariants`), and a gas snapshot entry in `test/gas/OpcodeGas.t.sol`
   (`_snapshot("Name", Name.build(...))`, writes `snapshots/OpcodeGas.json` via `vm.snapshotValue`).
6. **Docs**: `docs/PROGRAMS.md` catalog + README opcode lists (already stale).

---

## 5. Worked example (compiled, 3/3 tests pass): `MyRouter is SwapVM, AquaOpcodes` + `ThrottleOut`

Location: `.../scratchpad/mywork/` (mini Foundry project that imports the swap-vm clone; nothing in the clone
was modified). `ThrottleOut` = per-order, per-tokenOut cap on cumulative `amountOut` per rolling window - a
circuit breaker / rate-limited liquidity release for an AMM position; it wraps the rest of the program, reads and
(in swap mode only) writes its own ERC-7201-style storage, and uses the free opcode slot `0xd0`.

### 5.1 `foundry.toml`
```toml
[profile.default]
src = "src"
test = "test"
out = "out"
libs = []
solc_version   = "0.8.30"
evm_version    = "cancun"          # transient storage in SwapVM's reentrancy lock
optimizer      = true
optimizer_runs = 700
via_ir         = true
allow_paths    = ["swap-vm"]
```
### 5.2 `remappings.txt` (point at the clone's `node_modules`)
```
forge-std/=<swap-vm>/node_modules/forge-std/src/
@openzeppelin/contracts/=<swap-vm>/node_modules/@openzeppelin/contracts/
@1inch/solidity-utils/=<swap-vm>/node_modules/@1inch/solidity-utils/
@1inch/aqua/=<swap-vm>/node_modules/@1inch/aqua/
@1inch/swap-vm/=<swap-vm>/
```
(For a real submission: `npm i @1inch/swap-vm` or git submodule, same remapping names.)

### 5.3 `src/instructions/ThrottleOut.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";

/// @notice ThrottleOut opcode, caps cumulative `amountOut` of a given tokenOut per rolling time window (per order)
///   "Circuit breaker" / rate-limited liquidity release for an AMM position
/// @dev Encoding: [uint32 window, uint256 maxOutPerWindow]
/// @dev Wrap-around instruction: runs the rest of the program via `ctx.runLoop()`, then enforces the cap and
///   persists the window counters only in swap mode (`!ctx.vm.isStaticContext`), so `quote()` never writes storage
/// @dev The opcode is expected to be executed only once in strategy flow
library ThrottleOut {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    using ContextLib for Context;
    using SafeCast for uint256;

    error ThrottleOutInvalidWindow();
    error ThrottleOutExceeded(uint256 soldInWindow, uint256 amountOut, uint256 maxOutPerWindow);

    /// @dev Free slot in the 0xd0-0xef "Unallocated" bank of OpcodeList.sol (no fork of OpcodeList needed).
    ///   If you fork swap-vm you can rename `_d0` -> `ThrottleOut` in src/libs/OpcodeList.sol instead.
    Opcode constant opcode = Opcode._d0;

    // Namespaced slot, must not collide with StorageSlots.* of the base instructions.
    // The base repo precomputes ERC-7201 slots (keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~0xff);
    // a plain keccak256 of a unique id is equally collision-free and compile-time constant.
    bytes32 internal constant STORAGE_SLOT = keccak256("myapp.storage.ThrottleOut");

    struct Window {
        uint64 start;
        uint192 sold;
    }

    struct Storage {
        mapping(bytes32 orderHash => mapping(address tokenOut => Window)) window;
    }

    function store() internal pure returns (Storage storage $) {
        bytes32 slot = STORAGE_SLOT;
        assembly ("memory-safe") { $.slot := slot }
    }

    // ---------------------------------------------------------------- builder (off-chain / test side)

    function sizeOf(uint32, uint256) internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 4 + 32;
    }

    function build(uint32 window, uint256 maxOutPerWindow) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf(window, maxOutPerWindow)), window, maxOutPerWindow).resolve();
    }

    function build(MemoryPtr ptrStart, uint32 window, uint256 maxOutPerWindow) internal pure returns (MemoryPtr ptr) {
        require(window > 0, ThrottleOutInvalidWindow());

        ptr = ptrStart.pushHeader(opcode);              // [opcode][len placeholder]
        ptr = ptr.push(window, 4).push(maxOutPerWindow, 32); // args, left-to-right, big-endian, no ABI padding
        ptrStart.patchLength(ptr);                      // back-patch the 1-byte args length
    }

    // ---------------------------------------------------------------- parser + executor (on-chain side)

    function parse(bytes calldata args) internal pure returns (uint32 window, uint256 maxOutPerWindow) {
        window = args.at(0).asU32();
        maxOutPerWindow = args.at(4).asU256();
    }

    function exec(Context memory ctx, bytes calldata args) internal {
        Storage storage $ = store();
        (uint32 window, uint256 maxOutPerWindow) = parse(args);

        Window memory w = $.window[ctx.query.orderHash][ctx.query.tokenOut];
        if (w.start == 0 || block.timestamp >= uint256(w.start) + window) {
            // new window
            w.start = uint64(block.timestamp);
            w.sold = 0;
        }

        // Let the rest of the program (e.g. XYCSwap) compute the amounts first
        (, uint256 amountOut) = ctx.runLoop();

        uint256 sold = uint256(w.sold) + amountOut;
        require(sold <= maxOutPerWindow, ThrottleOutExceeded(w.sold, amountOut, maxOutPerWindow));

        if (!ctx.vm.isStaticContext) {
            $.window[ctx.query.orderHash][ctx.query.tokenOut] = Window({ start: w.start, sold: sold.toUint192() });
        }
    }
}

/// @notice Optional external view mixin so the router exposes the instruction's storage (mirrors TWAPSwapExternal pattern)
contract ThrottleOutExternal {
    function throttleWindow(bytes32 orderHash, address tokenOut) external view returns (uint64 start, uint192 sold) {
        ThrottleOut.Window storage w = ThrottleOut.store().window[orderHash][tokenOut];
        return (w.start, w.sold);
    }
}
```
(ERC-7201 slot for `"myapp.storage.ThrottleOut"` if you prefer the repo convention:
`0xf4fd74e30697d3164f3c299ced5e34e32c10c55d6ba6d2e317334df731851f00`.)

### 5.4 `src/MyRouter.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";

import { ThrottleOut, ThrottleOutExternal } from "./instructions/ThrottleOut.sol";

/// @title MyRouter
/// @notice AquaSwapVMRouter clone extended with ONE custom instruction (ThrottleOut)
/// @dev Same constructor as the official routers, same `swap()/quote()/hash()` ABI, so any Aqua/SwapVM tooling works unchanged
contract MyRouter is Simulator, SwapVM, AquaOpcodes, ThrottleOutExternal {
    using OpcodeOps for Opcode;

    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version)
    { }

    /// @dev Extend the opcode set: try our opcode first, otherwise fall through to AquaOpcodes (which reverts UnknownOpcode)
    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == ThrottleOut.opcode.asU8()) ThrottleOut.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }

    /// @dev Wire the VM's function-pointer dispatcher (ctx.vm.dispatch) to the opcode table
    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }
}
```

### 5.5 `test/MyRouter.t.sol` (ships to a real `Aqua`, swaps with real ERC20 transfers via `Aqua.push/pull`)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { FeeFlatIn } from "@1inch/swap-vm/src/instructions/FeeFlat.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";

import { MyRouter } from "../src/MyRouter.sol";
import { ThrottleOut } from "../src/instructions/ThrottleOut.sol";

/// @notice End-to-end: custom router + custom opcode + Aqua-shipped strategy + real ERC20 transfers via Aqua push/pull
contract MyRouterTest is Test {
    Aqua public aqua;
    MyRouter public router;
    TokenMock public tokenA;
    TokenMock public tokenB;

    address public maker = vm.addr(0x1234);
    address public taker = address(this);

    uint32 constant WINDOW = 3600;
    uint256 constant MAX_OUT_PER_WINDOW = 50e18;
    uint256 constant LIQ = 1000e18;
    uint64 constant T0 = 1_700_000_000;

    ISwapVM.Order internal order;
    bytes32 internal orderHash;

    function setUp() public {
        vm.warp(T0);

        aqua = new Aqua();
        router = new MyRouter(address(aqua), address(0), address(this), "MyRouter", "1.0.0");

        tokenA = new TokenMock("Token A", "TKA");
        tokenB = new TokenMock("Token B", "TKB");
        if (address(tokenA) > address(tokenB)) (tokenA, tokenB) = (tokenB, tokenA);

        // Program: ThrottleOut wraps { FeeFlatIn 0.3% -> XYCSwap }, balances come from Aqua (no Balances opcode needed)
        bytes memory program = bytes.concat(
            ThrottleOut.build(WINDOW, MAX_OUT_PER_WINDOW),
            FeeFlatIn.build(0.003e7),
            XYCSwap.build()
        );
        order = _order(program, true);

        // Maker: fund wallet, approve Aqua (Aqua pulls from the maker wallet on demand), ship the strategy
        tokenA.mint(maker, LIQ);
        tokenB.mint(maker, LIQ);
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = LIQ;
        amounts[1] = LIQ;

        ISwapVM.Order memory o = order;
        vm.startPrank(maker);
        tokenA.approve(address(aqua), type(uint256).max);
        tokenB.approve(address(aqua), type(uint256).max);
        orderHash = aqua.ship(address(router), abi.encode(o), tokens, amounts);
        vm.stopPrank();

        assertEq(orderHash, router.hash(o), "Aqua strategyHash must equal SwapVM order hash");

        // Taker: fund + approve the router (router does transferFrom + Aqua.push when useTransferFromAndAquaPush=true)
        tokenA.mint(taker, LIQ);
        tokenA.approve(address(router), type(uint256).max);
    }

    function _order(bytes memory program, bool useAqua) internal view returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            receiver: address(0),
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: useAqua,
            allowZeroAmountIn: false,
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: program
        }));
    }

    function _takerData(bool isExactIn, uint256 threshold) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: taker,
            isExactIn: isExactIn,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: true,
            isAToB: true,
            allowPartialFill: false,
            threshold: threshold == 0 ? bytes("") : abi.encodePacked(bytes32(threshold)),
            to: address(0),
            deadline: 0,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: "" // Aqua mode: no signature
        }));
    }

    function test_SwapViaAqua_ThrottleEnforced() public {
        ISwapVM.Order memory o = order;
        bytes memory td = _takerData(true, 0);

        // 1) quote == swap, tokens actually move
        (uint256 qIn, uint256 qOut,) = router.asView().quote(o, 30e18, td);
        assertEq(qIn, 30e18);
        assertGt(qOut, 29e18); // ~29.04e18 (0.3% fee, 29.91/1029.91 of 1000)

        uint256 takerBBefore = tokenB.balanceOf(taker);
        uint256 makerABefore = tokenA.balanceOf(maker);
        (uint256 sIn, uint256 sOut,) = router.swap(o, 30e18, td);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertEq(tokenB.balanceOf(taker) - takerBBefore, sOut, "taker received tokenB from maker via Aqua.pull");
        assertEq(tokenA.balanceOf(maker) - makerABefore, sIn, "maker received tokenA via Aqua.push");

        // Aqua accounting moved
        (uint256 balA, uint256 balB) = aqua.safeBalances(maker, address(router), orderHash, address(tokenA), address(tokenB));
        assertEq(balA, LIQ + sIn);
        assertEq(balB, LIQ - sOut);

        // Custom storage persisted only in swap mode
        // NB: with via_ir the optimizer may cache `block.timestamp` across `vm.warp` within one function,
        //     so compare against explicit expected values instead of re-reading block.timestamp
        (uint64 start, uint192 sold) = router.throttleWindow(orderHash, address(tokenB));
        assertEq(start, T0);
        assertEq(sold, sOut);

        // 2) second swap in the same window still under the 50e18 cap
        (, uint256 qOut2,) = router.asView().quote(o, 20e18, td); // ~18.4e18, total < 50 -> fine
        router.swap(o, 20e18, td);
        (, sold) = router.throttleWindow(orderHash, address(tokenB));
        assertEq(sold, sOut + qOut2);

        // 3) third swap would push above the cap -> custom typed error, both in quote and swap
        uint256 qOut3 = _curveOutIgnoringThrottle(o, 10e18, td);
        bytes memory expected = abi.encodeWithSelector(ThrottleOut.ThrottleOutExceeded.selector, uint256(sold), qOut3, MAX_OUT_PER_WINDOW);
        ISwapVM viewRouter = router.asView(); // NB: expectRevert binds to the NEXT external call, so resolve asView() first
        vm.expectRevert(expected);
        viewRouter.quote(o, 10e18, td);
        vm.expectRevert(expected);
        router.swap(o, 10e18, td);

        // 4) window rolls over -> allowed again, counter reset
        vm.warp(T0 + WINDOW);
        (, uint256 sOut4,) = router.swap(o, 10e18, td);
        (start, sold) = router.throttleWindow(orderHash, address(tokenB));
        assertEq(start, T0 + WINDOW);
        assertEq(sold, sOut4);
    }

    function test_QuoteDoesNotWriteStorage() public view {
        ISwapVM.Order memory o = order;
        router.asView().quote(o, 30e18, _takerData(true, 0));
        (uint64 start, uint192 sold) = router.throttleWindow(orderHash, address(tokenB));
        assertEq(start, 0);
        assertEq(sold, 0);
    }

    function test_UnknownOpcodeStillRejected() public {
        // Signature-mode order (quote does not touch Aqua nor verify the signature), opcode 0xd1 is wired nowhere
        bytes memory program = abi.encodePacked(uint8(Opcode._d1), uint8(0));
        ISwapVM.Order memory bad = _order(program, false);
        bytes memory td = _takerData(true, 0);
        ISwapVM viewRouter = router.asView();
        vm.expectRevert(abi.encodeWithSelector(AquaOpcodes.UnknownOpcode.selector, uint256(uint8(Opcode._d1))));
        viewRouter.quote(bad, 1e18, td);
    }

    /// @dev The curve output the program would produce for `amount`, read from the ThrottleOutExceeded revert payload
    function _curveOutIgnoringThrottle(ISwapVM.Order memory o, uint256 amount, bytes memory td) internal view returns (uint256 amountOut) {
        try router.asView().quote(o, amount, td) returns (uint256, uint256 out, bytes32) {
            return out;
        } catch (bytes memory reason) {
            bytes4 sel;
            assembly ("memory-safe") { sel := mload(add(reason, 32)) }
            assertEq(bytes32(sel), bytes32(ThrottleOut.ThrottleOutExceeded.selector));
            bytes memory payload = new bytes(reason.length - 4);
            for (uint256 i; i < payload.length; i++) payload[i] = reason[4 + i];
            (, amountOut,) = abi.decode(payload, (uint256, uint256, uint256));
        }
    }
}
```

### 5.6 Result
```
forge build: Compiling 91 files with Solc 0.8.30 ... finished in 5.27s
forge test:
[PASS] test_QuoteDoesNotWriteStorage() (gas: 52045)
[PASS] test_SwapViaAqua_ThrottleEnforced() (gas: 356916)
[PASS] test_UnknownOpcodeStillRejected() (gas: 34439)
```
Trace numbers: `MyRouter::swap` 143,012 gas (first swap: cold Aqua slots + first ThrottleOut SSTOREs), 77,181
(warm); `quote` 18,236 cold / 9,805 warm; revert payload on cap breach
`ThrottleOutExceeded(47481392959149323217, 8959320086603659771, 50000000000000000000)`.
`MyRouter` runtime 21,176 B (EIP-170 margin 3,400 B).

### 5.7 Gotchas hit while writing it (all reproducible)
- `vm.expectRevert` binds to the **next external call**; `router.asView().quote(...)` makes `asView()` that call.
  Resolve `ISwapVM v = router.asView();` first. (Repo tests avoid this by calling `swapVM.swap` directly and
  using `swapVM.asView().quote` only where no revert is expected.)
- With `via_ir`, the optimizer cached `block.timestamp` across `vm.warp` inside one test function
  (`assertEq(start, uint64(block.timestamp))` compared against the stale value). Compare against explicit constants.
- An Aqua-mode order's `quote` calls `AQUA.safeBalances` **before** running the VM, so an un-shipped Aqua order
  reverts with `SafeBalancesForTokenNotInActiveStrategy` - use a signature-mode order to unit-test VM behavior
  without Aqua (quote never checks the signature).
- `MakerTraitsLib.build` requires `tokenA < tokenB` (`MakerTraitsTokensNotSorted`); sort tokens after deploying mocks.
- Taker flow in Aqua mode: either `useTransferFromAndAquaPush = true` (router does `transferFrom(taker) -> forceApprove(AQUA) -> AQUA.push`, SwapVM.sol:265-274) or a taker contract implementing `ITakerCallbacks.preTransferInCallback` that pushes itself (`test/mocks/MockTaker.sol:46-58`, requires `hasPreTransferInCallback = true`). In the second case the router checks `AQUA.rawBalances` grew by `amountIn` (SwapVM.sol:276-278).

---

## 6. Extruction / BestRouteSelector: running external logic

### 6.1 Mechanics (Extruction.sol:15-119)

```solidity
function exec(Context memory ctx, bytes calldata args) internal {
    (address target, bytes calldata extructionArgs) = parse(args);   // [address target][bytes args]
    uint256 choppedLength;
    if (ctx.vm.isStaticContext) {
        (ctx.vm.nextPC, choppedLength, ctx.swap) = IStaticExtruction(target).extruction(   // `view` -> STATICCALL
            ctx.vm.isStaticContext, ctx.vm.nextPC, ctx.query, ctx.swap, extructionArgs, ctx.takerArgs());
    } else {
        (ctx.vm.nextPC, choppedLength, ctx.swap) = IExtruction(target).extruction(         // plain CALL
            ctx.vm.isStaticContext, ctx.vm.nextPC, ctx.query, ctx.swap, extructionArgs, ctx.takerArgs());
    }
    bytes calldata chopped = ctx.tryChopTakerArgs(choppedLength);
    require(chopped.length == choppedLength, ExtructionChoppedExceedsLength(chopped, choppedLength));
}
interface IExtruction { function extruction(bool isStaticContext, uint256 nextPC, SwapQuery calldata query,
    SwapRegisters calldata swap, bytes calldata args, bytes calldata takerData)
    external returns (uint256 updatedNextPC, uint256 choppedLength, SwapRegisters memory updatedSwap); }
interface IStaticExtruction { /* same, `external view` */ }
```

**It is a CALL, not a delegatecall.** Therefore:
- The target **cannot read or write the router's storage** (no access to `DynamicBalances`, invalidators, your
  custom opcode's storage). It only gets the four registers + query by value and returns new registers.
- The target **can have its own storage** and mutate it in swap mode (`isStaticContext == false`); in quote mode
  it is STATICCALLed so any write reverts. This is the documented quote/swap divergence risk
  (Extruction.sol:27-28): executing the opcode several times per program, or a stateful target, can make
  quote != swap.
- The target can set `nextPC` (skip/branch the remaining program) and consume taker args (`choppedLength`).
- It **cannot** touch `ctx.query`, `ctx.fee`, or the program bytes, and cannot make the router transfer tokens
  (settlement happens in `SwapVM` after `runLoop`). Reentrancy into `swap` for the *same* order is blocked by the
  per-orderHash transient lock; reentrancy into `swap` on a *different* order or into `Aqua` is not blocked
  (**UNCERTAIN** whether exploitable in practice; treat maker-chosen targets as untrusted code for takers).
- `msg.sender` inside the target is the router; the target should `require(msg.sender == router)` if it keeps state.

### 6.2 `test/mocks/BestRouteSelector.sol` (RunLoop.t.sol:260-294 uses it)

```solidity
contract BestRouteSelector is OpcodesDebug {          // embeds the FULL opcode set inside the target
    using ContextLib for Context;
    function extruction(bool isStaticContext, uint256 nextPC, SwapQuery calldata query, SwapRegisters calldata swap,
                        bytes calldata args, bytes calldata takerData)
        external returns (uint256 updatedNextPC, uint256 choppedLength, SwapRegisters memory updatedSwap) {
        // args = [uint8 numBranches, (uint16 len, bytes strategy)*]
        uint8 numBranches = uint8(args[0]); uint256 offset = 1;
        uint256 bestAmountOut; SwapRegisters memory bestResult = swap;
        for (uint256 i = 0; i < numBranches; i++) {
            uint16 strategyLen = uint16(bytes2(args[offset:offset + 2])); offset += 2;
            bytes calldata strategy = args[offset:offset + strategyLen]; offset += strategyLen;
            Context memory ctx = Context({
                vm: VM({ isStaticContext: isStaticContext, nextPC: 0, programPtr: CalldataPtrLib.from(strategy),
                         takerArgsPtr: CalldataPtrLib.from(takerData), dispatch: _runOpcode }),   // its OWN dispatcher
                query: query, swap: swap,                                                          // same start registers
                fee: ProtocolFee({ meta: FeeMetaLib.init(), receivers: FeeReceiverLib.init(), feeTotal: 0 })
            });
            (, uint256 amountOut) = ctx.runLoop();                                                // nested VM run
            if (amountOut > bestAmountOut) { bestAmountOut = amountOut; bestResult = SwapRegisters(swap.balanceIn, swap.balanceOut, swap.amountIn, amountOut); }
        }
        return (nextPC, 0, bestResult);
    }
}
```
Program: `DynamicBalances.build(100e18,100e18) ++ Extruction.build(selector, abi.encodePacked(uint8(2),
uint16(len1), XYCSwap.build(), uint16(len2), PeggedSwap.build(50e18,50e18,0.02e9,1,1)))`. The selector
instantiates a **second VM** in its own address space; any stateful opcode in a sub-strategy would write the
selector's storage, not the router's; fee registers computed in sub-strategies are discarded (fresh `ProtocolFee`).
It only handles the exactIn case (compares `amountOut`). This is the reference pattern for "run arbitrary
composed logic behind the official router": the router only needs opcode 0x04.

### 6.3 Safety guidance (Extruction.sol:18-28, PROGRAMS.md "Conditional Flow")
Maker side: put `RequireMinRate`/`AdjustMinRate` **before** Extruction to bound the rate; bound spend with Aqua
balances (or `DynamicBalances`, or `StaticBalances + InvalidateTokenIn/Out`). Taker side: `threshold` in
TakerTraits; SwapVM guarantees the taker-specified amount is unchanged (unless `allowPartialFill`). Target should
be deterministic, non-upgradeable, revert-transparent; avoid executing it multiple times per program.

---

## 7. Invariant testing: `CoreInvariants`

`test/invariants/CoreInvariants.t.sol:42` - `abstract contract CoreInvariants is Test`. You **must implement**:
```solidity
function _executeSwap(SwapVM swapVM, ISwapVM.Order memory order, address tokenIn, address tokenOut,
                      uint256 amount, bytes memory takerData) internal virtual returns (uint256 amountIn, uint256 amountOut);
```
(mint/approve then `swapVM.swap(order, amount, takerData)`; see ExampleInvariantUsage.t.sol:69-91).

`InvariantConfig` (CoreInvariants.t.sol:67-80) and defaults (`_getDefaultConfig`, :561-583):
`symmetryTolerance=2 wei, additivityTolerance=0, roundingToleranceBps=100, monotonicityToleranceBps=0,
testAmounts=[1e18,10e18,50e18], testAmountsExactOut=[] (=testAmounts), skipAdditivity/skipMonotonicity/
skipSpotPrice/skipSymmetry=false, exactInTakerData="", exactOutTakerData=""` - you must set the two taker datas
(exactOut typically with threshold `type(uint256).max`).

`assertAllInvariantsWithConfig(swapVM, order, tokenIn, tokenOut, config)` (:107-218) runs, in order:
1. `assertSymmetryInvariant` (:224-262): `quote(exactIn X) -> Y`, `quote(exactOut Y) -> X'`, `|X'-X| <= tolerance`.
2. `assertQuoteSwapConsistencyInvariant` (:336-367) for exactIn and exactOut amounts: quote then real swap on a
   `vm.snapshot()`, `revertTo`, amounts must be equal.
3. `assertMonotonicityInvariant` (:374-419): `amountOut*1e18/amountIn` non-increasing across `testAmounts` (+bps tolerance).
4. `assertAdditivityInvariant` (:270-330): `swap(a+b) + tolerance >= swap(a) + swap(b)` (real swaps, snapshots),
   for `a = testAmounts[i], b = 2a`, both exactIn and exactOut data.
5. `assertRoundingFavorsMakerInvariant` (:426-510): 1/10/100/1000 wei quotes must not beat the 1-token spot rate
   (exactIn) / must cost at least spot (exactOut), within `roundingToleranceBps`; reverts/zero outputs are tolerated.
6. `assertBalanceSufficiencyInvariant` (:516-536): quote of 1,000,000e18 either reverts or returns non-zero amounts.

Also `assertBatchInvariants(swapVM, order, tokenIn, tokenOut, amounts)` and `createInvariantConfig(amounts, tolerance)`.
`RoundingInvariants` library (test/invariants/RoundingInvariants.sol) adds `assertNoAccumulationExploit` (N tiny
swaps <= one big swap + N wei) and `assertNoRoundTripProfit` (A->B->A loops), taking a `function(...) internal
returns (uint256)` executor.

Usage patterns:
- Minimal: `contract MyTest is Test, OpcodesDebug, CoreInvariants { ... assertAllInvariantsWithConfig(...) }` (ExampleInvariantUsage.t.sol:32-228).
- Parametrized family: `XYCFeesInvariants` keeps `balanceA/B`, fee bps, `testAmounts`, tolerances, skip flags as
  **storage vars** and builds `_config(order)` from them (XYCFeesInvariants.t.sol:57-92, 194-207); scenario files
  just override `setUp()` and change the vars (`test/invariants/xyc/SmallAmounts.t.sol:15-37`, `pegged/*`,
  `concentrate/*`). Copy this for your custom opcode: one base test, many scenario subclasses.
- Known non-conformers documented in `TESTING.md`: TWAP, DutchAuction, BaseFeeAdjuster, FeeFlatOut with AMMs
  (superadditive), Decay (state-dependent) - they set `skipSymmetry/skipAdditivity`. Expect the same for any
  time/state-dependent custom opcode (my `ThrottleOut` breaks additivity by design once the cap binds).
- Aqua-mode base: `test/base/AquaSwapVMTest.sol` (`AquaStrategyBuilders`): `createStrategy(program)` (Aqua-mode
  order), `shipStrategy(order, tokenIn, tokenOut, balIn, balOut)` (prank maker, approve Aqua, `aqua.ship`),
  `swap(SwapProgram, order)` via `MockTaker` (callback pushes to Aqua), `quote(...)`, `tradeToZeroBalance`.
  `_deployRouter()` is `virtual` - override it to return your custom router.

---

## 8. Gas numbers (`snapshots/*.json`, produced by `test/gas/Gas.t.sol` and `OpcodeGas.t.sol` on `SwapVMRouter`, signature mode, 1e18 swaps, warm)

### 8.1 Whole programs (`AMMGas.json`, `LimitSwapGas.json`)
| Program | swap exactIn | swap exactOut | quote exactIn | quote exactOut |
|---|---|---|---|---|
| StaticBalances + LimitSwap | 50,882 | 51,087 | 6,424 | 6,634 |
| + Deadline | 51,375 | | 6,917 | |
| + Salt | 51,811 | | 7,353 | |
| + FeeFlatIn 1% / FeeFlatOut 1% | 52,547 / 52,431 | | 8,089 / 7,973 | |
| + AdjustMinRate | 52,541 | 52,844 | 8,083 | 8,391 |
| + DutchAuctionBalanceIn / Out | 52,288 / 52,345 | 52,493 / 52,550 | 7,830 / 7,887 | 8,040 / 8,097 |
| + InvalidateBit | 74,469 | | 9,683 | |
| + InvalidateTokenIn | 75,304 | | 10,480 | |
| + TWAPSwap | 144,610 | 144,815 | 15,562 | 15,772 |
| Full limit (Deadline+Salt+Static+FeeFlatIn+LimitSwap+InvalidateTokenIn) | 78,403 | | 13,580 | |
| DynamicBalances + XYCSwap | 96,426 | 96,625 | 11,525 | 11,729 |
| + FeeFlatIn / FeeFlatOut | 98,091 / 97,975 | | 13,190 / 13,074 | |
| DynamicBalances + XYCConcentrateSwap | 99,537 | 99,730 | 14,637 | 14,835 |
| DynamicBalances + Decay + XYCSwap | 148,984 | 149,183 | 23,402 | 23,606 |
| DynamicBalances + Decay + XYCConcentrateSwap | 152,095 | | 26,514 | |
| Full AMM (Dynamic+Decay+FeeFlatIn+Concentrate) | 153,760 | | 28,179 | |

Swap numbers include two ERC20 `transferFrom`s (~2x ~25k), signature recovery, and (for Dynamic/Decay/TWAP/
Invalidate) SSTOREs. The VM itself is cheap: quote of Static+LimitSwap is 6,424 gas total.

### 8.2 Marginal per-opcode cost (`OpcodeGas.json`; method OpcodeGas.t.sol:30-35: `lastCall(Just+op) - lastCall(Just) + calldata gas of the op's bytes`, Just = StaticBalances+LimitSwap, warm)
`Jump 361, Deadline 593, JumpIfTokenIn 919, Salt 1005, XYCSwap 1007, LimitSwap 1048, LimitSwapFullAmount 1113,
StaticBalances 1146, BaseFeeAdjuster 1347, PrivateOrder 1382, RequireMinRate 1558, PiecewiseLinearScaleBalanceIn 1616,
AdjustMinRate 1677, FeeFlatIn 1745, OnlyTakerTokenBalanceNonZero 1877, OnlyTakerTokenBalanceGte 2078,
ValidateSeriesEpoch 3557, XYCConcentrateSwap 4559, OnlyTakerTokenSupplyShareGte 4869, PeggedSwap 8040,
InvalidateBit 23647, InvalidateTokenIn 24442, DynamicBalances 26925` (the last three = fresh SSTOREs).

### 8.3 Contract sizes (this toolchain, `forge build --sizes`, runtime bytes / EIP-170 margin)
`Aqua 2,678 / 21,898` (node_modules v1.0.0; live Aqua at `0x1111113CCf...` is 5,619 B - newer build),
`AquaSwapVMRouter 20,376 / 4,200` (live `0x111111338c...` is 20,541 B), `LimitSwapVMRouter 20,712 / 3,864`,
`MyRouter 21,176 / 3,400`, `AquaSwapVMRouterDebug 23,805 / 771`, **`SwapVMRouter 28,486 / -3,910`**,
`SwapVMRouterDebug 31,913 / -7,337`. Hardhat config silences `code-size` only for `*Debug.sol`; **UNCERTAIN**
how `SwapVMRouter` is meant to ship (maybe never; hardhat's in-process EVM ignores the limit in tests).

---

## 9. Aqua integration essentials (node_modules `@1inch/aqua` v1.0.0, `src/Aqua.sol`)

- `ship(app, strategy, tokens, amounts) returns strategyHash` (:40-52): `strategyHash = keccak256(strategy)`;
  stores `_balances[msg.sender][app][hash][token] = (amount, tokensCount)`; immutable per hash
  (`StrategiesMustBeImmutable`). `app` = the router address. Max 254 tokens.
- `safeBalances(maker, app, hash, token0, token1)` (:30-38) reverts unless both tokens are in an active strategy.
- `pull(maker, hash, token, amount, to)` (:63-70): `app = msg.sender`; decrements and `safeTransferFrom(maker, to)` -
  the maker must have **approved Aqua** for each token; funds stay in the maker wallet until pulled.
- `push(maker, app, hash, token, amount)` (:72-80): anyone; increments and `safeTransferFrom(msg.sender, maker)`.
- `dock(app, hash, tokens)` deactivates (all tokens at once).
- Live registry: `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` (same on Ethereum and Base per `AQUA()` of the router).
- For a local fork demo: `aqua.ship(address(router), abi.encode(order), [tokenA, tokenB], [balA, balB])` from the
  maker; taker calls `router.swap(order, amount, takerData)` with `useTransferFromAndAquaPush = true`; verify with
  `aqua.safeBalances` and ERC20 balances (exactly what section 5.5 does).

---

## 10. Pitfalls / open questions

- Docs drift: README/PROGRAMS mention `ProgramBuilder`, `_opcodes()`, `_instructions()`, `amountNetPulled`, and
  5-argument `quote/swap(order, tokenIn, tokenOut, amount, takerData)`; none exist. Trust `src/` and `test/`.
- The clone is a single squashed commit; no per-opcode history to imitate. Use the checklist in 4.4.
- `Opcode` placeholders are a shared namespace: if 1inch later allocates `0xd0`, programs written for your router
  are unaffected (routers are independent), but do not reuse an index that the *official* router already maps to a
  different instruction if you intend programs to be portable.
- `InstructionArgs.at` has no bounds check; malformed args read zeros. `RunLoopExceedProgramLength` only guards the
  instruction envelope.
- Extruction targets get STATICCALLed in quote: a target that writes storage unconditionally makes `quote` revert.
- `TakerTraits.validate` forbids `amountOut == 0` and (without `allowPartialFill`) requires the taker-specified
  amount to be returned unchanged - a custom opcode that reduces `amountIn` for exactIn must restore it (see FeeFlatIn).
- **UNCERTAIN**: whether the CREATE3-deployed `1.0.2` bytecode equals repo HEAD (`1.0.1` pad); whether `WETH()` is
  exposed on the live router; whether a SwapVM TS program builder exists outside the `sdks` clone.
