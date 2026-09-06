# SwapVM core — knowledge base (swapvm-core)

Sources read (all local): `refs/swap-vm` (1inch/swap-vm `main`, commit `f09a41e`, 2026-09-03), `refs/swap-vm-v1.0.2` (tag `v1.0.2`, commit `32c687c`, 2026-07-26 — the version deployed on-chain), `refs/aqua` (1inch/aqua), `refs/sdks/typescript/aqua`, Blockscout-verified source of the on-chain router (dumped to `scratchpad/deployed_v102/`, byte-identical to tag v1.0.2 for every file present), plus live `cast` probes on Ethereum and Base. Paths below are relative to `scratchpad/` unless absolute. `SV=refs/swap-vm/src`, `V102=refs/swap-vm-v1.0.2/src`.

---

## 0. Decision-relevant TL;DR (read this first)

1. **Two SwapVM designs exist and they are ABI-incompatible.**
   - **On-chain `0x111111338c5091E8440b67B168bAe16a668AC0De`** (Ethereum, Base — verified live) is `AquaSwapVMRouter` **tag v1.0.2**: EIP-712 domain `("1inch SwapVM v1.0","1.0.2")`, `AQUA()=0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`, `owner()=0x5AFc5DF416640348235a0571dBEEf9064cb0338D`. Its ABI is `swap(Order,address tokenIn,address tokenOut,uint256 amount,bytes takerTraitsAndData)` (non-payable) and `quote(...)` with the same 5 args; dispatch is a **function-pointer array** (opcode = array index, 0..33 for Aqua set; unknown opcode → Panic 0x32). No `WETH()` getter, no native-ETH payment.
   - **`main` branch** (what you would redeploy): `swap(Order,uint256 amount,bytes takerTraitsAndData)` **payable**, tokens are the first 40 bytes of `order.data`, direction chosen by taker flag `isAToB`; dispatch is a **banked `Opcode` enum (0x00–0xff) + `if/else` chain** in `_runOpcode`, overridable per router. Unknown opcode → `UnknownOpcode(uint256)`.
   - The repo `README.md` on `main` is partially stale (still shows `_instructions()`, `amountNetPulled`, 5-arg `swap`). Trust code, not README.
2. **Aqua mode is confirmed from code**: with `useAquaInsteadOfSignature=1` the router (a) skips signatures and uses `AQUA.safeBalances(maker, address(this), orderHash, tokenIn, tokenOut)` as the balance source AND the authorization (reverts if strategy not active), (b) `orderHash == keccak256(abi.encode(order)) == Aqua.strategyHash` (Aqua computes `keccak256(strategy)` where `strategy = abi.encode(order)`), (c) settles via `AQUA.pull(maker, orderHash, tokenOut, amountOut, to)` and either `AQUA.push(...)` after `transferFrom` (taker flag `useTransferFromAndAquaPush`) or a taker-callback push verified by `rawBalances`, (d) **the Aqua "app" is the router address itself** (`address(this)`): a maker ships to the official Aqua with `app = <your router>`; only that router can `pull` (Aqua keys `_balances[maker][msg.sender][strategyHash][token]`).
3. **A modified router works against the official Aqua** — verified with a passing Ethereum-mainnet fork test (`customrouter-example/test/ForkOfficialAqua.t.sol`): deploy `MyAquaSwapVMRouter(AQUA=0x1111113ccf…, WETH, owner, name, version)` → maker `ship(app=router, abi.encode(order), [WETH,USDC], [10e18, 30_000e6])` → taker `swap()` with `useTransferFromAndAquaPush` → real WETH/USDC moved, Aqua balances updated. Custom opcode added in `0xd0` (unallocated bank). Full example in §16.
4. Aqua official address `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` is the same on ETH, BSC, Polygon, Arbitrum, Avalanche, Gnosis, Base, Optimism, zkSync, Linea, Unichain, Sonic, Robinhood, Monad, Cronos, HyperEVM (`refs/sdks/typescript/aqua/src/aqua-protocol-contract/constants.ts:8-25`). The deployed Aqua is `AquaRouter` (= `Aqua + Simulator + Multicall + Rescuable`), selectors verified on-chain.

---

## 1. Repos, versions, addresses

| Item | Value |
|---|---|
| swap-vm `main` | commit `f09a41e` "Merge PR #180 remove-progressive-fees", `package.json` version `0.0.6`, deps `@1inch/aqua#v1.0.0`, `@1inch/solidity-utils 6.9.10`, OZ `5.4.0`, solc `0.8.30`, `via_ir=true`, `optimizer_runs=700` (`refs/swap-vm/foundry.toml`, `hardhat.config.ts`) |
| swap-vm tags | `0.0.1..0.0.6`, `v1.0.0` (b2daef8), `v1.0.1` (b6e4f97), `v1.0.2` (32c687c). No newer tag → `main` is unreleased |
| Deployed router | `0x111111338c5091E8440b67B168bAe16a668AC0De` = `AquaSwapVMRouter` v1.0.2, compiler `v0.8.30+commit.73712a01`, runs 700, evm `prague`. Ctor args (Blockscout-decoded): `aqua=0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a, weth=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2, owner=0x4134e66d52EfC4C77DD8Ccc952D87b9E92E0C352, name="1inch SwapVM v1.0", version="1.0.2"`. Current `owner()` on-chain = `0x5AFc5DF4…` (ownership transferred later). Runtime code 20,542 bytes |
| Deployed Aqua | `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`, runtime 5,620 bytes, `owner()=0x5AFc5DF416640348235a0571dBEEf9064cb0338D`. Selectors present: `ship 0xf50b870f, dock 0x28defc17, pull 0xb00bbd10, push 0x47d72768, rawBalances 0x6d58b4cc, safeBalances 0x65f2fe14, multicall 0xac9650d8, simulate 0xbd61951d, rescueFunds 0x78e3214f, owner, transferOwnership, renounceOwnership` |
| Older non-vanity deployments in `broadcast/` | `AquaSwapVMRouter` at `0x3c4758979ec30ca45857cabc2462a70699ed790e` (ETH+Base, version "1.0.1", aqua `0x4a055AA172C98ec32de118B9B5b6AC8B4099A580`, deployer `0x72b4736f…`) and `0xdfd05fe230bfe7b212878414270c72c8345506fa` (version "1.0"). `0x4a055AA1…` is an older Aqua deployment (same code size as the official). The vanity `0x1111…` deploys are NOT in this repo's `broadcast/` (UNCERTAIN how they were deployed; `__DeployPadCreate3.s.sol` broadcast on Base shows a CREATE3-style call to `0xef1aa3c8e20b544912da97379dcb356fc90087c5` with salt `0x40be5476…`, producing `0x1dd98df7…`) |
| Opcode gas snapshots | `refs/swap-vm/snapshots/{AMMGas,LimitSwapGas,OpcodeGas}.json` |
| Deploy docs | `main`: Hardhat Ignition (`DEPLOY.md`, `ignition/modules/*.ts`, params `ignition/parameters/chain-<id>.json`); Foundry scripts still present `script/Deploy{Aqua,Limit,}SwapVMRouter.s.sol` reading `config/constants.json` |

---

## 2. Order struct and hashing

`SV/interfaces/ISwapVM.sol:17-21`
```solidity
struct Order {
    address maker;
    MakerTraits traits;   // type MakerTraits is uint256
    bytes data;           // [tokenA(20)][tokenB(20)][hook slices...][program]   (main)
}
```
Interface (main, `ISwapVM.sol:27-53`):
```solidity
function hash(Order calldata order) external view returns (bytes32);
function quote(Order calldata order, uint256 amount, bytes calldata takerTraitsAndData) external view returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);
function swap (Order calldata order, uint256 amount, bytes calldata takerTraitsAndData) external payable returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);
```
Note: `SwapVM.quote` is declared non-view in the abstract contract (`SwapVM.sol:123-127`) because instructions may write storage; use `router.asView().quote(...)` (returns `ISwapVM(address(this))`, `SwapVM.sol:102-104`) or `eth_call`. In `quote`, `ctx.vm.isStaticContext=true`, and stateful opcodes skip storage writes.

Hashing (`SV/SwapVM.sol:109-120`):
```solidity
bytes32 public constant ORDER_TYPEHASH = keccak256("Order(address maker,uint256 traits,bytes data)");
// = 0x4ff6e0f284e5bda3bffd2bfd3adc9a8f89d4c787c8be730b8c214c0e10bb3d40 (matches on-chain ORDER_TYPEHASH())
function hash(ISwapVM.Order calldata order) public view returns (bytes32) {
    if (order.traits.useAquaInsteadOfSignature()) {
        return keccak256(abi.encode(order));          // Aqua mode: NOT EIP-712, no domain, chain-agnostic
    }
    return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, order.maker, order.traits, keccak256(order.data))));
}
```
- EIP-712 domain: OZ `EIP712(name, version)`; on-chain `eip712Domain()` → fields `0x0f`, name `1inch SwapVM v1.0`, version `1.0.2`, chainId, verifyingContract. Test helper that reproduces the typed-data bytes: `refs/swap-vm/test/utils/OrderHasher.sol`.
- Signature verification (signature mode only, only in `swap`, not in `quote`): `order.maker.recoverOrIsValidSignature(orderHash, signature)` (`SwapVM.sol:225`) — 64/65-byte ECDSA else EIP-1271 fallback (`solidity-utils/libraries/ECDSA.sol:140-150`). Signature is the last TakerTraits data slice.
- **Aqua mode hash == Aqua strategyHash**: `Aqua.ship` does `strategyHash = keccak256(strategy)` (`refs/aqua/src/Aqua.sol:41`) and the maker passes `strategy = abi.encode(order)` (`refs/swap-vm/test/base/AquaStrategyBuilders.sol:146-155`, asserted equal at `:155`). Same `abi.encode` of the same struct → same bytes → same hash. The TS SDK computes it as `keccak256(strategyBytes)` (`aqua-protocol-contract.ts:92-94`).
- Hash identity is `orderHash` everywhere: reentrancy lock key, `DynamicBalances`/`Decay`/`TWAP` storage key, invalidator key, `Swapped` event, hook/callback arg.

### 2.1 `order.data` layout and MakerTraits (main) — `SV/libs/MakerTraits.sol`

Bits (`:34-44`):
| bit | flag |
|---|---|
| 255 | `SHOULD_UNWRAP_BIT_FLAG` (maker receives ETH instead of WETH; **incompatible with Aqua**) |
| 254 | `USE_AQUA_INSTEAD_OF_SIGNATURE_BIT_FLAG` |
| 253 | `ALLOW_ZERO_AMOUNT_IN` |
| 252/251/250/249 | `HAS_PRE_TRANSFER_IN / POST_TRANSFER_IN / PRE_TRANSFER_OUT / POST_TRANSFER_OUT _HOOK` |
| 248/247/246/245 | `..._HOOK_HAS_TARGET` (hook data slice starts with a 20-byte target; else target = maker) |
| 223..160 | 4 × uint16 slice END offsets into `data`: `index0` at bits 160-175 (end of PreTransferIn slice), `index1` 176-191, `index2` 192-207, `index3` 208-223. Built as `bytes8(abi.encodePacked(index3,index2,index1,index0))` (`:134-139`) |
| 159..0 | receiver address (0 ⇒ maker). **Custom receiver incompatible with Aqua** |

`data` (`:158-169`) = `tokenA(20) ‖ tokenB(20) ‖ [preInTarget?][preInData] ‖ [postInTarget?][postInData] ‖ [preOutTarget?][preOutData] ‖ [postOutTarget?][postOutData] ‖ program`. `build()` requires `tokenA < tokenB` (`:110`, `MakerTraitsTokensNotSorted`). Slice 0 starts at byte 40 (`:253`); `program` = `data[index3:]` (`:254`). `tokens()` reads `data[0:20]`, `data[20:40]` (`:212-217`). Minimal no-hook order: `index0..3 = 40` ⇒ `traits = 0x0028002800280028 << 160` (verified on-chain: `hash()` accepts it).

`MakerTraitsLib.Args` (`:79-103`): `maker, receiver, tokenA, tokenB, shouldUnwrapWeth, useAquaInsteadOfSignature, allowZeroAmountIn, has{Pre,Post}Transfer{In,Out}Hook, {pre,post}Transfer{In,Out}Target/Data, program`. `validate(traits, amountIn)` (`:173-175`) only enforces `amountIn > 0 || allowZeroAmountIn`.

**v1.0.2 differences** (`V102/libs/MakerTraits.sol`): no token prefix in `data` (slices start at 0, `:216-218`), `Args` has no `tokenA/tokenB`, `validate(traits, tokenIn, tokenOut, amountIn)` also requires `tokenIn != tokenOut` (`:159-162`). Flag bits are identical.

### 2.2 TakerTraits (main) — `SV/libs/TakerTraits.sol`

`takerTraitsAndData` = 22-byte header ‖ data. Header = 10 × uint16 slice-end offsets (bytes 0..19, packed `index9..index0` high→low, `:136-147`) ‖ uint16 flags (bytes 20..21). `parse()` takes `uint176(bytes22(data[0:22]))` (`:182-185`) so flags are the low 16 bits and offset k is `(traits >> 16 >> (k*16)) & 0xffff` (`:325-328`).

Flags (`:101-109`):
| mask | flag |
|---|---|
| `0x0001` | `isExactIn` |
| `0x0002` | `shouldUnwrapWeth` (taker gets ETH) |
| `0x0004` | `hasPreTransferInCallback` |
| `0x0008` | `hasPreTransferOutCallback` |
| `0x0010` | `isStrictThresholdAmount` |
| `0x0020` | `isFirstTransferFromTaker` |
| `0x0040` | `useTransferFromAndAquaPush` |
| `0x0080` | `isAToB` (**main only**; tokenIn=tokenA if set) |
| `0x0100` | `allowPartialFill` (**main only**) |

Data slices in order (`:83-95`): `threshold (0|32 B)`, `to (0|20 B)`, `deadline (0|5 B uint40)`, `preTransferInHookData`, `postTransferInHookData`, `preTransferOutHookData`, `postTransferOutHookData`, `preTransferInCallbackData`, `preTransferOutCallbackData`, `instructionsArgs` (consumed by opcodes via `tryChopTakerArgs`), `signature` (tail; empty in Aqua mode).

`validate()` (`:187-230`): `amountOut > 0`; deadline; exactIn: `takerAmount == amountIn` (or `>=` with partial fill), threshold = min out (scaled pro-rata on partial fill, ceil); exactOut: `takerAmount == amountOut` (or `>=`), threshold = max in. Strict mode requires equality. Minimal taker blob for "exactIn, A→B, no data": 20 zero bytes ‖ `0x0081`.

**v1.0.2**: only 7 flags (no `isAToB`, no `allowPartialFill`; `V102/libs/TakerTraits.sol:96-102`), tokens passed as explicit `swap()` args, no partial-fill branch in `validate` (`:172-199`).

---

## 3. Context: VM / SwapQuery / SwapRegisters / ProtocolFee — `SV/libs/VM.sol`

```solidity
struct VM {                     // :21-27
    bool isStaticContext;       // true in quote()
    uint256 nextPC;             // mutable; jumps set it; Stop sets type(uint256).max
    CalldataPtr programPtr;     // (offset<<128 | length) into calldata; ContextLib.program()
    CalldataPtr takerArgsPtr;   // remaining instructionsArgs; ContextLib.takerArgs()/tryChopTakerArgs()
    function(Context memory, uint256, bytes calldata) internal dispatch;  // = router._dispatch
}
struct SwapQuery { bytes32 orderHash; address maker; address taker; address tokenIn; address tokenOut; bool isExactIn; } // :36-43 read-only
struct SwapRegisters { uint256 balanceIn; uint256 balanceOut; uint256 amountIn; uint256 amountOut; }                     // :50-55 mutable
struct ProtocolFee { FeeMeta meta; FeeReceiver[] receivers; uint256 feeTotal; }                                          // :60-64 set by FeeProtocol opcode
struct Context { VM vm; SwapQuery query; SwapRegisters swap; ProtocolFee fee; }                                          // :71-76
```
v1.0.2 differs: `VM.opcodes` is `function(Context memory, bytes calldata) internal[]` (`V102/libs/VM.sol:24`), `SwapRegisters` has a 5th field `amountNetPulled` (`:53`), no `ProtocolFee` in `Context`.

`ContextLib` helpers (`:91-118`): `program(ctx)`, `takerArgs(ctx)`, `setNextPC(ctx, pc)`, `tryChopTakerArgs(ctx, len)` (consumes up to `len` bytes from the front of taker instructionsArgs and advances the pointer).

---

## 4. runLoop semantics and bytecode

Bytecode = concatenation of instructions `[opcode:1B][argsLength:1B][args:argsLength B]` (args ≤ 255 bytes; `InstructionBuilder.patchLength` reverts `InstructionBuilderArgsLengthExceeded` otherwise, `SV/libs/InstructionBuilder.sol:25-29`).

`ContextLib.runLoop` (main, `VM.sol:125-158`):
```solidity
function runLoop(Context memory ctx) internal returns (uint256 swapAmountIn, uint256 swapAmountOut) {
    bytes calldata programBytes = ctx.program();
    uint256 length = programBytes.length; uint256 pcs = ctx.vm.nextPC;
    while (pcs < length) {
        // word = calldataload(program + pcs); opcode = word>>248; argsLength = (word>>240)&0xff
        // args = program[pcs+2 : pcs+2+argsLength]; pcs += 2 + argsLength
        if (pcs > length) revert RunLoopExceedProgramLength(pcs, length);
        ctx.vm.nextPC = pcs;
        ctx.vm.dispatch(ctx, opcode, args);
        pcs = ctx.vm.nextPC;          // instruction may have changed it (Jump*, Stop, Extruction, nested runLoop)
    }
    return (ctx.swap.amountIn, ctx.swap.amountOut);
}
```
- Empty program is valid but fails later with `TakerTraitsAmountOutMustBeGreaterThanZero(0)` (`test/RunLoop.t.sol:107-116`). Truncated instruction → `RunLoopExceedProgramLength(pc, len)` (`:121-154`). Unknown opcode → `UnknownOpcode(opcode)` from the opcode set (`:159-172`).
- **Nested runLoop**: an instruction may call `ctx.runLoop()` itself; it executes *the rest of the program* from `ctx.vm.nextPC` (already advanced past the current instruction), returns `(amountIn, amountOut)`, and leaves `nextPC == program.length` so the outer loop terminates right after. This is how wrappers work: `DynamicBalances` (load → runLoop → persist, `Balances.sol:101-125`), `FeeFlatIn/Out`, `FeeProtocol`, `Decay`, `InvalidateBit/TokenIn/TokenOut`, `RequireMinRate/AdjustMinRate`. Ordering is therefore semantic: `A B C` where A and B are wrappers ⇒ A(pre) → B(pre) → C → B(post) → A(post). Deep nesting tested to 5 levels (`RunLoop.t.sol:181-195`); works in static context too (`:200-219`).
- Jumps: `Jump [uint16 nextPC]`, `JumpIfDirection [bool,uint16]` (direction = `tokenIn < tokenOut`), `JumpIfTokenIn/Out [address,uint16]` set `nextPC` to an instruction-aligned byte offset (`SV/instructions/Jumps.sol`). `Stop` sets `nextPC = max` (`Controls.sol:118-121`). `Revert [bytes]` reverts `InstructionRevert(bytes)`.
- `Extruction [address target, bytes args]` (`Extruction.sol:62-88`): external call `IExtruction(target).extruction(isStatic, nextPC, query, swap, args, takerArgs) returns (updatedNextPC, choppedLength, updatedSwap)`; uses `IStaticExtruction` (view) in quote mode. Target may rewrite all registers, PC, and consume taker args. Example target that runs sub-programs with its own `runLoop`: `test/mocks/BestRouteSelector.sol` (constructs a fresh `Context` with `dispatch: _runOpcode` from `OpcodesDebug`, `:85-103`).

v1.0.2 `runLoop` (`V102/libs/VM.sol:118-136`): same encoding but `ctx.vm.opcodes[opcode](ctx, args)` (array index; OOB ⇒ Panic 0x32) and `require(nextPC < length, RunLoopExcessiveCall)` on entry (so a nested runLoop at end-of-program reverts in v1.0.2 but is a no-op on main).

---

## 5. Instruction dispatch — how opcodes are wired

**main**: `SwapVM._dispatch(Context memory, uint256 opcode, bytes calldata args) internal virtual` (`SV/SwapVM.sol:368`) is abstract. Each router implements it by forwarding to its opcode set's `_runOpcode`:
```solidity
// SV/routers/AquaSwapVMRouter.sol:16-28
contract AquaSwapVMRouter is Simulator, SwapVM, AquaOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version) SwapVM(aqua, weth, owner, name, version) { }
    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override { _runOpcode(ctx, opcode, args); }
}
```
Opcode sets are plain contracts with `function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual` = an `if/else if` chain comparing `opcode == Lib.opcode.asU8()` and calling `Lib.exec(ctx, args)`, ending with `revert UnknownOpcode(opcode)` (`SV/opcodes/AquaOpcodes.sol:27-45`, `Opcodes.sol:45-87`, `LimitOpcodes.sol:34-60`). Debug sets override `_runOpcode`, handle the 0x10–0x1a debug opcodes, then `super._runOpcode` (`OpcodesDebug.sol:16-25`). Each instruction is a **library** exposing `Opcode constant opcode`, `sizeOf(...)`, `build(...)`, `build(MemoryPtr, ...)`, `parse(bytes calldata)`, `exec(Context memory, bytes calldata)`. Opcode numbers are fixed by the `Opcode` enum (`SV/libs/OpcodeList.sol`), banked: `0x00-0x0f` control (Stop 00, Revert 01, Salt 02, Jump 03, Extruction 04), `0x10-0x1f` debug (PrintSwapRegisters 10, PrintSwapQuery 11, PrintVM 12, PrintFreeMemoryPointer 13, PrintGasLeft 14, PrintFee 15, PatchSwapRegisters 1a), `0x20-0x3f` guards (Deadline 20, OnlyTakerTokenBalanceNonZero 23, OnlyTakerTokenBalanceGte 24, OnlyTakerTokenSupplyShareGte 25, OnlyTxOriginTokenBalanceNonZero 26, PrivateOrder 2b, WhitelistCoequal 2c, WhitelistSequential 2d, JumpIfDirection 30, JumpIfTokenIn 31, JumpIfTokenOut 32), `0x40-0x4f` invalidators (InvalidateBit 40, InvalidateTokenIn 41, InvalidateTokenOut 42, ValidateSeriesEpoch 48), `0x50-0x6f` curves (XYCSwap 50, XYCConcentrateSwap 51, LimitSwap 53, LimitSwapFullAmount 54, PeggedSwap 58), `0x70-0x8f` fees (FeeFlatIn 70, FeeFlatOut 71, FeeProtocol 80), `0x90-0xaf` balances (StaticBalances 90, DynamicBalances 91, DutchAuctionBalanceIn 94, DutchAuctionBalanceOut 95, PiecewiseLinearScaleBalanceIn 98, PiecewiseLinearScaleBalanceOut 99, Decay 9c, TWAPSwap 9d), `0xb0-0xcf` rates (RequireMinRate b0, AdjustMinRate b1, OraclePriceAdjuster b2, BaseFeeAdjuster b4), **`0xd0-0xef` unallocated (use these for custom instructions)**, `0xf0-0xff` reserved (never allocate). Enum values checked by `test/OpcodeEnumCheck.t.sol`.

**v1.0.2 (deployed)**: `SwapVM._instructions() internal pure virtual returns (function(Context memory, bytes calldata) internal[] memory)` (`V102/SwapVM.sol:293`); router returns `_opcodes()` (`V102/routers/AquaSwapVMRouter.sol:26-28`); instructions are `internal` functions on inherited contracts (`Controls`, `XYCSwap`, …). **Deployed AquaOpcodes index map** (`V102/opcodes/AquaOpcodes.sol:32-84`). The static `[35]` array is turned into a dynamic array by `result := instructions; mstore(result, instructions.length - 1)` (`:79-83`), i.e. static entry 0 becomes the length word and **`result[i] == instructions[i+1]`**. Effective opcode numbers (array length 34, opcodes 0..33): `0-9 _notInstruction` (no-ops; Debug variant overwrites 0..4 with prints), `10 _jump, 11 _jumpIfTokenIn, 12 _jumpIfTokenOut, 13 _deadline, 14 _onlyTakerTokenBalanceNonZero, 15 _onlyTakerTokenBalanceGte, 16 _onlyTakerTokenSupplyShareGte, 17 _xycSwapXD, 18 _xycConcentrateGrowLiquidity2D, 19 _decayXD, 20 _salt, 21 _flatFeeAmountInXD, 22-26 _notInstruction, 27 _protocolFeeAmountInXD, 28 _aquaProtocolFeeAmountInXD, 29 _dynamicProtocolFeeAmountInXD, 30 _aquaDynamicProtocolFeeAmountInXD, 31 _peggedSwapGrowPriceRange2D, 32 _extruction, 33 _onlyTxOriginTokenBalanceNonZero`. Live probes on `0x111111338c…` (ETH): opcode `0x00` = no-op (fails later with `TakerTraitsAmountOutMustBeGreaterThanZero(0)`), opcode `0x10` (=16, `_onlyTakerTokenSupplyShareGte`) with empty args reverted with selector `0x6cac7aec` = `ControlsMissingTokenArg()` (the token slice is read first, `V102/instructions/Controls.sol`), opcodes `0x50`/`0xff` → Panic `0x32` (array OOB) — consistent with this map. The same +1 shift applies to `Opcodes` (46 usable: `17 _staticBalancesXD, 18 _dynamicBalancesXD, 19-21 invalidators, 22 _xycSwapXD, 23 _xycConcentrateGrowLiquidity2D, 24 _decayXD, 25 _limitSwap1D, 26 _limitSwapOnlyFull1D, 27-28 minRate, 29-30 dutch, 31 _baseFeeAdjuster1D, 32 _twap, 33 _extruction, 34 _salt, 35 _flatFeeAmountInXD, 36-41 FeeExperimental…, 42 _peggedSwapGrowPriceRange2D, 43-45 protocol fees`; `V102/opcodes/Opcodes.sol:48-110`) and `LimitOpcodes` (`LimitOpcodes.sol:40-90`). Do not hand-compute these for production — build programs with the v1.0.2 test helper `ProgramBuilder.init(_opcodes()).build(Lib._fn, args)` which resolves indices by function-pointer equality. Deployed `Opcodes` (SwapVMRouter, 46 entries) and `LimitOpcodes` (41 entries) index maps are in `V102/opcodes/Opcodes.sol:48-110` and `LimitOpcodes.sol:40-90`; test-side `ProgramBuilder.init(_opcodes()).build(Lib._fn, args)` finds the index by function-pointer equality (`refs/swap-vm-v1.0.2/test/utils/ProgramBuilder.sol:24-41`). Debug variant injects prints at indices 0..4 (`V102/instructions/Debug.sol:17-24`).

---

## 6. `swap()` / `quote()` execution flow (main, `SV/SwapVM.sol:123-243`)

1. `orderHash = hash(order)` (`:181`).
2. `_reentrancyGuards[orderHash].lock()` (`:182`; swap only) — transient (EIP-1153) per-order lock, `TransientLockUnsafeLib` (`solidity-utils/libraries/TransientLockUnsafe.sol:34-36`, reverts `UnexpectedLock`). Unlocked at `:241`. Prevents re-entering the same order from hooks/callbacks/Extruction; different orders may nest.
3. `TakerTraitsLib.parse(takerTraitsAndData)` → `(takerTraits, takerData)`; `isExactIn` (`:184-185`).
4. Tokens: `(tokenIn, tokenOut) = isAToB ? (tokenA, tokenB) : (tokenB, tokenA)` from `order.data[0:40]` (`:187-190`).
5. Build `Context` (`:192-219`): `vm.isStaticContext=false` (true in quote), `nextPC=0`, `programPtr = order.traits.program(order.data)`, `takerArgsPtr = takerTraits.instructionsArgs(takerData)`, `dispatch=_dispatch`; `swap.amountIn = isExactIn ? amount : 0`, `swap.amountOut = isExactIn ? 0 : amount`, balances 0; `fee` zeroed.
6. Authorization + balances (`:221-226`):
   - Aqua: `(balanceIn, balanceOut) = AQUA.safeBalances(order.maker, address(this), orderHash, tokenIn, tokenOut)`.
   - else: `require(order.maker.recoverOrIsValidSignature(orderHash, takerTraits.signature(takerData)), BadSignature(...))`. (quote skips this.)
7. `originalAquaBalanceIn = ctx.swap.balanceIn` (`:228`); `(amountIn, amountOut) = ctx.runLoop()` (`:229`).
8. `order.traits.validate(amountIn)`; `takerTraits.validate(takerData, amount, amountIn, amountOut)` (`:230-231`). **quote returns here.**
9. Transfers (`:233-239`): default order is `_transferOut` (maker→taker) then `_transferIn` (taker→maker); with `isFirstTransferFromTaker` it's `_transferIn` then `_transferOut`.
10. `unlock()`; `emit Swapped(orderHash, maker, msg.sender, tokenIn, tokenOut, amountIn, amountOut)` (`:241-242`).

`_transferOut` (`:325-348`): maker `preTransferOut` hook → taker `preTransferOutCallback` → protocol fee on tokenOut (`FeeMetaLib.resolveOutAquaPullMaker` via `AQUA.pull(maker, orderHash, tokenOut, fee, receiver)` in Aqua mode, else `safeTransferFrom(maker, receiver, fee)`, `:338-339`) → `_transferFrom(maker, takerTraits.to(takerData, msg.sender), tokenOut, amountOut, orderHash, useAqua, takerTraits.shouldUnwrapWeth())` (`:341`) → maker `postTransferOut` hook (gets `feeOut`).

`_transferIn` (`:245-303`): maker `preTransferIn` hook → taker `preTransferInCallback` → `require(msg.value == 0 || tokenIn == WETH, MsgValueInvalidToken)` → if `amountIn > 0`: branch on Aqua / native ETH / ERC20 (see §7, §9) → if `amountIn == 0` refund any `msg.value` → maker `postTransferIn` hook (gets `feeIn`).

`_transferFrom` (`:350-357`): if `unwrapWeth && token == WETH` pull to `address(this)` then `WETH.safeWithdrawTo(amount, to)`; else direct. `_transferOrPull` (`:359-365`): `useAqua ? AQUA.pull(from, orderHash, token, amount, to) : IERC20(token).safeTransferFrom(from, to, amount)`.

---

## 7. Aqua mode — exact behaviour with citations

Preconditions on the order: `useAquaInsteadOfSignature=1`; `shouldUnwrapWeth=0` else `MakerTraitsUnwrapIsIncompatibleWithAqua` (`:261`); `receiver == maker` else `MakerTraitsCustomReceiverIsIncompatibleWithAqua` (`:262`) (both checked only when `amountIn > 0` in `_transferIn`).

**(a) Authorization**: no signature. `AQUA.safeBalances(maker, app=address(this), strategyHash=orderHash, tokenIn, tokenOut)` (`:222`, quote `:168`) reverts `SafeBalancesForTokenNotInActiveStrategy` unless both tokens have `tokensCount > 0 && != 0xff(docked)` under `_balances[maker][app][strategyHash][token]` (`refs/aqua/src/Aqua.sol:30-38`). Therefore a swap is authorized iff the maker previously called `Aqua.ship(app=router, abi.encode(order), tokens, amounts)` from the maker EOA (`msg.sender` is the maker key, `Aqua.sol:40-52`) and has not docked. The maker's actual tokens stay in the maker wallet with an ERC-20 approval to Aqua; Aqua only tracks virtual balances (`uint248 amount, uint8 tokensCount` packed, `refs/aqua/src/libs/Balance.sol`). Strategies are immutable: re-shipping same hash → `StrategiesMustBeImmutable` (`Aqua.sol:48`); to change parameters `dock()` then `ship()` a new order (e.g., different `Salt`).

**(b) Balances**: `ctx.swap.balanceIn/balanceOut` are loaded from `safeBalances` **before** `runLoop` (`:222`) — so Aqua programs typically omit `StaticBalances/DynamicBalances` (AquaOpcodes doesn't even include them) and go straight to a curve (`XYCSwap`, `XYCConcentrateSwap`, `PeggedSwap`) with optional `Decay`, fees, guards. Balances are virtual allowances; the actual pull may fail if the maker's wallet balance/approval is insufficient (`Aqua.pull` does `safeTransferFrom(maker, to, amount)`, `Aqua.sol:63-70`).

**(c) Settlement**:
- tokenOut (maker→taker): `AQUA.pull(maker, orderHash, tokenOut, amountOut, to)` (`:341→:361`) — Aqua decrements `_balances[maker][msg.sender=router][orderHash][tokenOut]` and transfers from the maker wallet. Only the router (the `app`) can pull. Protocol fees in tokenOut are additional pulls to fee receivers (`ProtocolFee.sol:177-205`).
- tokenIn (taker→maker), two modes (`:264-280`):
  1. **`useTransferFromAndAquaPush=1`** (taker flag `0x0040`): router `safeTransferFrom(taker, router, amountIn)` (or `WETH.deposit` if paid in ETH, `:265-269`), pays tokenIn protocol fees from the router balance (`resolveInSafeTransfer`), `forceApprove(AQUA, amountIn - fee)`, then `AQUA.push(maker, address(this), orderHash, tokenIn, amountIn - fee)` (`:272-273`) — Aqua transfers router→maker wallet and increments the virtual balance (`Aqua.sol:72-80`, requires active strategy). Requires taker ERC-20 approval to the router. Any EOA can use this; no callback contract needed.
  2. **Callback mode** (flag unset): `require(msg.value == 0, UnexpectedMsgValue)`; the taker is expected to have pushed during `preTransferInCallback` (`ITakerCallbacks.preTransferInCallback(maker, taker, tokenIn, tokenOut, amountIn, amountOut, orderHash, data)` is invoked at `:252-255` before the check) — reference taker does `approve(AQUA); AQUA.push(maker, address(SWAPVM), orderHash, tokenIn, amountIn)` (`test/mocks/MockTaker.sol:46-58`). Router verifies `AQUA.rawBalances(maker, router, orderHash, tokenIn).balance >= originalAquaBalanceIn + amountIn` else `AquaBalanceInsufficientAfterTakerPush(balance, preBalance, amount)` (`:276-277`; tests `test/TakerCallbackAquaNegative.t.sol:89-160`), then tokenIn protocol fees are pulled from the maker (`resolveInAquaPullMaker`, `:279`, i.e., fee is subtracted from what the maker keeps). Because the reentrancy lock is held, no nested swap on the same order can fake the balance increase (mirrors Aqua's `AquaApp._safeCheckAquaPush`, `refs/aqua/src/AquaApp.sol:62-68`).
- `isFirstTransferFromTaker` (flag `0x0020`): swaps the two phases so the taker's tokenIn lands (via push/transferFrom) **before** the maker's tokenOut is pulled (`:233-239`). Useful when the maker-side pull depends on incoming funds (e.g., maker wallet is short) or hooks need the input first. Test: `test/SwapVMAqua.t.sol:62-132` (`MockTakerFirstTransfer`).
- Combination matrix tested in `test/TransferModesCombinations.t.sol`: Aqua-maker×AquaPush, Aqua-maker×Callback, Direct-maker×Direct, Direct-maker×Callback (in signature mode the callback is just a notification; transfer is a plain `safeTransferFrom(taker, receiver)`).

**(d) The "app" is the router**: every Aqua call passes `address(this)` as `app` (`:168, :222, :273, :276`), and `pull` is keyed on `msg.sender` (`Aqua.sol:64`). Consequently: if you deploy your own (modified) router `R`, makers must `ship(app = R, …)` on the official Aqua, and only `R` can pull those balances; strategies shipped to `0x111111338c…` are invisible to `R`. Verified by fork test §16.2.

Aqua-mode limitations: no `shouldUnwrapWeth` on maker side, no custom receiver, `msg.value` only with `useTransferFromAndAquaPush` (`test/NativePayment.t.sol:399-438, 482-493`). Taker-side unwrap (`0x0002`) works in Aqua mode (pull to router, then `withdrawTo`). Aqua amounts are `uint248` (`MAX_AQUA_AMOUNT`).

---

## 8. Hooks and taker callbacks

`IMakerHooks` (`SV/interfaces/IMakerHooks.sol`): `preTransferIn(maker, taker, tokenIn, tokenOut, amountIn, amountOut, orderHash, makerData, takerData)`, `postTransferIn(..., uint256 feeIn, orderHash, makerData, takerData)`, `preTransferOut(...)`, `postTransferOut(..., uint256 feeOut, ...)`. Target = 20-byte prefix of the slice when the `*_HAS_TARGET` bit is set, else the maker itself (`MakerTraits.sol:239-248`). Hook data from maker (in `order.data`) and from taker (TakerTraits slices) are both forwarded. Hooks are called even with `amountIn == 0`. Any revert bubbles up (`test/MakerHooks.t.sol:356-361`). Mock: `test/mocks/MockMakerHooks.sol`.

`ITakerCallbacks` (`SV/interfaces/ITakerCallbacks.sol`): `preTransferInCallback(maker, taker, tokenIn, tokenOut, amountIn, amountOut, orderHash, takerData)` and `preTransferOutCallback(...)`, called on `ctx.query.taker == msg.sender` only when the taker flag is set. No post-callbacks. Use `preTransferOutCallback` for custom rate checks; `preTransferInCallback` for Aqua push or just-in-time funding (flash-swap style: with default transfer order the taker already holds tokenOut when `preTransferInCallback` runs).

---

## 9. Native ETH / WETH paths (main only)

- `swap` is `payable`; `receive()` accepts ETH only from WETH (`OnlyWethReceiver`, `EthDepositRejected`).
- Paying tokenIn with ETH (`:258, :281-289, :305-318`): allowed only if `tokenIn == WETH`; `msg.value >= amountIn` else `NotEnoughMsgValueAttached`; excess refunded to `msg.sender`; router does `WETH.safeDeposit(amountIn)` then either `safeWithdrawTo` (maker `shouldUnwrapWeth`) or `safeTransfer` to receiver, or in Aqua+push mode deposits then pushes. Refund failure → `EthTransferFailed`. If `amountIn == 0` full refund (`:295`).
- Receiving ETH: maker flag bit 255 (signature mode only) or taker flag `0x0002` (both modes) → `_transferFrom` routes through the router and `IWETH.safeWithdrawTo(amount, to)` (`:351-353`). Tests: `test/UnwrapWeth.t.sol`, `test/NativePayment.t.sol`.
- v1.0.2: no `msg.value` support; unwrap uses `IWETH(token)` unconditionally when flag set (`V102/SwapVM.sol:275-282`).

---

## 10. Routers, opcode sets, Debug variants (main)

| Router (`SV/routers/`) | Opcode set | Instructions wired |
|---|---|---|
| `SwapVMRouter` | `Opcodes` (+ externals `DynamicBalancesExternal, InvalidateBitExternal, InvalidateTokenInExternal, InvalidateTokenOutExternal, TWAPSwapExternal, ValidateSeriesEpochExternal`) | Jump, Stop, Revert, JumpIfDirection, JumpIfTokenIn/Out, Deadline, OnlyTaker*{NonZero,Gte,SupplyShareGte}, OnlyTxOriginTokenBalanceNonZero, StaticBalances, DynamicBalances, InvalidateBit/TokenIn/TokenOut, XYCSwap, XYCConcentrateSwap, Decay, LimitSwap, LimitSwapFullAmount, RequireMinRate, AdjustMinRate, DutchAuctionBalanceIn/Out, BaseFeeAdjuster, TWAPSwap, Extruction, Salt, FeeFlatIn, FeeFlatOut, FeeProtocol, PeggedSwap, ValidateSeriesEpoch, PrivateOrder, WhitelistCoequal, WhitelistSequential, PiecewiseLinearScaleBalanceIn/Out, OraclePriceAdjuster (`Opcodes.sol:45-87`) |
| `LimitSwapVMRouter` | `LimitOpcodes` (+ Invalidate*External, ValidateSeriesEpochExternal) | Jump, JumpIfTokenIn/Out, Deadline, OnlyTaker*, StaticBalances, Invalidate*, LimitSwap(+FullAmount), BaseFeeAdjuster, Extruction, Salt, FeeProtocol, ValidateSeriesEpoch, PrivateOrder, WhitelistCoequal/Sequential, PiecewiseLinearScale*, OnlyTxOrigin* (`LimitOpcodes.sol:34-60`). No Stop/Revert/JumpIfDirection/DynamicBalances/XYC/Pegged/Decay/FeeFlat/MinRate/DutchAuction/TWAP/Oracle |
| `AquaSwapVMRouter` | `AquaOpcodes` (no externals) | Jump, JumpIfTokenIn/Out, Deadline, OnlyTaker*, XYCSwap, XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction, OnlyTxOriginTokenBalanceNonZero (`AquaOpcodes.sol:27-45`). **No balances/invalidators/limit/FeeFlatOut/MinRate/whitelists** |
| `*Debug` routers | `OpcodesDebug` / `LimitOpcodesDebug` / `AquaOpcodesDebug` | adds `PrintSwapRegisters(0x10), PrintSwapQuery(0x11), PrintVM(0x12), PrintFreeMemoryPointer(0x13), PrintGasLeft(0x14), PrintFee(0x15), PatchSwapRegisters(0x1a)`; `Debug.sol` imports `forge-std/console.sol` so not for production; hardhat config disables `code-size` warning for `src/routers/*Debug.sol` |

All routers also mix in `Simulator` (`simulate(address delegatee, bytes data) payable` — delegatecalls and reverts with `Simulated(delegatee,data,success,result)`), `Rescuable` (`rescueFunds(IERC20,uint256) onlyOwner` → owner), `EIP712`, `OnlyWethReceiver`. External state getters: `balance(bytes32 orderHash, address token)` (DynamicBalances), `bitInvalidators(maker, slot)`, `invalidateBit(uint256)`, `invalidateBits(slot, mask)`, `tokenInInvalidators/tokenOutInvalidators(maker, orderHash, token)`, `invalidateTokenIn/Out(orderHash, token)`, `twapLastSwap(orderHash)`, `seriesEpoch(maker, seriesId)`, `seriesEpochIncrease/Advance`. Stateful opcodes use ERC-7201 slots in `SV/libs/StorageSlots.sol` (DynamicBalances `0x8a1457da…2e00`, Decay `0xdf4f9c8e…1900`, InvalidateBit `0x7fecc769…b900`, InvalidateTokenIn `0xdec8baa2…4a00`, InvalidateTokenOut `0x3c263435…5900`, TWAPSwap `0x640df918…6f00`, ValidateSeriesEpoch `0xf6109436…1400`).

---

## 11. Instruction catalog (main; encoding = args bytes after the 2-byte header)

| Opcode | Lib (`SV/instructions/`) | Encoding | Semantics |
|---|---|---|---|
| 0x00 Stop | Controls.Stop | `[]` | `nextPC = max` |
| 0x01 Revert | Controls.Revert | `[bytes4]` or `[bytes]` | `revert InstructionRevert(args)` |
| 0x02 Salt | Controls.Salt | `[uint64]` or `[bytes]` | no-op; changes orderHash |
| 0x03 Jump | Jumps.Jump | `[uint16 nextPC]` | unconditional |
| 0x04 Extruction | Extruction | `[address target, bytes args]` | external delegate of registers/PC (§4) |
| 0x20 Deadline | Controls.Deadline | `[uint40 ts]` | `block.timestamp <= ts` |
| 0x23/24/25 OnlyTakerTokenBalance{NonZero,Gte,SupplyShareGte} | TokenValidators | `[address]`, `[address,uint256]`, `[address,uint64 shareE18]` | taker gating (NFT-compatible) |
| 0x26 OnlyTxOriginTokenBalanceNonZero | TokenValidators | `[address]` | tx.origin gating |
| 0x2b PrivateOrder | Whitelist | `[uint80 takerLow80bits]` | `uint80(uint160(taker)) == arg` |
| 0x2c WhitelistCoequal | Whitelist | `[uint16 nextPC, uint80[N]]` | jump if taker whitelisted |
| 0x2d WhitelistSequential | Whitelist | `[uint40 start, uint16 nextPC, (uint16 dur, uint80)[N]]` | time-phased whitelist |
| 0x30/31/32 JumpIf{Direction,TokenIn,TokenOut} | Jumps | `[bool,uint16]`, `[address,uint16]` | conditional jumps |
| 0x40 InvalidateBit | Invalidators | `[uint32 bitIndex]` | maker-scoped nonce bitmap; wraps runLoop; sets bit after (swap only) |
| 0x41/42 InvalidateToken{In,Out} | Invalidators | `[]` | cumulative fill cap = balance; scales other balance pro-rata; wraps runLoop; also scales `fee.meta` surplus estimate |
| 0x48 ValidateSeriesEpoch | SeriesEpochManager | `[uint32 seriesId, uint32 epoch]` | maker's epoch must match |
| 0x50 XYCSwap | XYCSwap | `[]` | x·y=k: exactIn `out = in·bOut/(bIn+in)` floor; exactOut `in = ceil(out·bIn/(bOut-out))` |
| 0x51 XYCConcentrateSwap | XYCConcentrate | `[uint256 sqrtPmin, uint256 sqrtPmax]` (1e18-scaled sqrt prices, price = tokenB/tokenA) | V3-like virtual reserves; clamps to `balanceOut` (partial fill); helpers `computeLiquidity`, `computeLiquidityAndPrice`, `computeBalances`, `computeLiquidityFromAmounts` (`:106-175`) |
| 0x53 LimitSwap | LimitSwap | `[bool direction]` (direction = `tokenIn<tokenOut`, `encodeBool(dir,0)` → `0x80`/`0x00`) | linear rate `bOut/bIn`, partial fills, reverts `LimitSwapDirectionMismatch` |
| 0x54 LimitSwapFullAmount | LimitSwap | `[bool]` | all-or-nothing |
| 0x58 PeggedSwap | PeggedSwap | `[uint256 x0, y0, linearWidth, rateA, rateB]` | stable-swap-like curve (`PeggedSwapMath`) |
| 0x70 FeeFlatIn | FeeFlat | `[uint24 feeBps]` BPS=1e7 (0.3% = 30_000 = `0.003e7`) | maker fee on tokenIn; wraps runLoop |
| 0x71 FeeFlatOut | FeeFlat | `[uint24]` | maker fee on tokenOut; wraps runLoop; may be superadditive with reinvesting curves |
| 0x80 FeeProtocol | FeeProtocol | `[uint8 hdr(isTokenIn bit7 \| count low4), {uint8 flags(isProvider b7, flat b6, surplus b5), address, uint24 feeBps?, uint24 surplusBps?}×count, uint216 surplusEstimate?]` | third-party fees resolved in transfer phase via `ctx.fee`; providers via `IProtocolFeeProvider.getRecipientAndFees(orderHash, maker, taker, tokenIn, tokenOut, isExactIn)`; builder `FeeProtocol.build(isTokenIn, ReceiverConfig[], ProviderConfig[], surplusEstimate)`; test helper `test/utils/FeeBuilders.sol` |
| 0x90 StaticBalances | Balances | `[uint256 balA, uint256 balB]` | sets registers (A/B by token order) |
| 0x91 DynamicBalances | Balances | `[uint256 balA, uint256 balB]` | storage-backed reserves keyed by orderHash; init from args if both zero; wraps runLoop; persists `bIn+=in, bOut-=out` (swap only); `DynamicBalancesReachZero` guard |
| 0x94/95 DutchAuctionBalance{In,Out} | DutchAuction | `[uint40 start, uint16 duration, uint64 decay]` | exponential decay/growth of a balance (`Power.pow`) |
| 0x98/99 PiecewiseLinearScaleBalance{In,Out} | PiecewiseLinearScale | `[uint40 ts, uint24 scales[k], uint16 durations[k-1]]` | time-weighted scale |
| 0x9c Decay | Decay | `[uint16 period]` | Mooniswap-style virtual balance offsets keyed by orderHash/token/direction; wraps runLoop |
| 0x9d TWAPSwap | TWAPSwap | `[uint256 balanceIn, balanceOut, startTime, duration, priceBumpAfterIlliquidity, minTradeAmountOut]` | TWAP sell with dutch bump |
| 0xb0/b1 RequireMinRate/AdjustMinRate | MinRate | `[uint64 rateA, uint64 rateB]` | maker-side min rate guard after runLoop (single-direction) |
| 0xb2 OraclePriceAdjuster | OraclePriceAdjuster | `[uint64 maxPriceDecay, uint16 maxStaleness, uint8 oracleDecimals, address oracle]` | Chainlink-anchored adjustment (`IPriceOracle`) |
| 0xb4 BaseFeeAdjuster | BaseFeeAdjuster | `[uint64 baseGasPrice, uint96 ethPrice, uint24 gasAmount, uint64 maxDecay]` | gas-cost-aware pricing |
| 0x10–0x15, 0x1a | Debug | `[]` / `[4×uint256]` | console prints / register patch (debug routers only) |

Program-building helpers: `SV/libs/MemoryPtr.sol` (`alloc`, `push`, `pushMem`, `skip`, `patch`, `resolve`, `resolveShrink`), `SV/libs/InstructionBuilder.sol` (`sizeOf()=2`, `pushHeader(ptr, opcode)`, `patchLength(ptrStart, end)`, `encodeBool(v, bit) = 128>>bit`), `SV/libs/InstructionArgs.sol` (`args.at(shift).asU8/16/…/asAddress/asBool(bit)` — **no bounds checks**). Programs are typically `bytes.concat(A.build(..), B.build(..), ...)`; multi-instruction single allocation example in `SV/strategies/Strategies.sol:71-103` (`buildLimitOrder`, `buildXYCConcentrateOrder` with validated prefix opcodes). Rounding rule: `amountIn` ceil, `amountOut` floor (favor maker). Direction-dependent args (`StaticBalances`, `LimitSwap`, `RequireMinRate`) are always given in sorted `(tokenA, tokenB)` order and swapped internally by `tokenIn < tokenOut`.

---

## 12. Custom router with a NEW instruction — verified compilable example (main)

Location: `scratchpad/customrouter-example/` (foundry project; remaps `swap-vm/` → `refs/swap-vm/src/`, deps from `refs/swap-vm/node_modules`). `forge test -vv` → 3/3 pass (compile 4.4 s with via-IR).

`src/CapAmountOut.sol` — claims unallocated opcode `0xd0`, nested runLoop:
```solidity
pragma solidity 0.8.30;
import { Context, ContextLib } from "swap-vm/libs/VM.sol";
import { Opcode } from "swap-vm/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "swap-vm/libs/MemoryPtr.sol";
import { InstructionBuilder } from "swap-vm/libs/InstructionBuilder.sol";
import { InstructionArgs } from "swap-vm/libs/InstructionArgs.sol";

/// @dev Encoding: [uint256 maxAmountOut]
library CapAmountOut {
    using InstructionArgs for bytes; using InstructionArgs for bytes32;
    using MemoryPtrLib for MemoryPtr; using InstructionBuilder for MemoryPtr; using ContextLib for Context;
    error CapAmountOutExceeded(uint256 amountOut, uint256 maxAmountOut);
    Opcode constant opcode = Opcode._d0;                       // 0xd0, unallocated bank
    function sizeOf(uint256) internal pure returns (uint256) { return InstructionBuilder.sizeOf() + 32; }
    function build(uint256 maxAmountOut) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf(maxAmountOut)), maxAmountOut).resolve();
    }
    function build(MemoryPtr ptrStart, uint256 maxAmountOut) internal pure returns (MemoryPtr ptr) {
        ptr = ptrStart.pushHeader(opcode); ptr = ptr.push(maxAmountOut, 32); ptrStart.patchLength(ptr);
    }
    function parse(bytes calldata args) internal pure returns (uint256 maxAmountOut) { maxAmountOut = args.at(0).asU256(); }
    function exec(Context memory ctx, bytes calldata args) internal {
        uint256 maxAmountOut = parse(args);
        (, uint256 amountOut) = ctx.runLoop();                 // run the rest of the program first
        require(amountOut <= maxAmountOut, CapAmountOutExceeded(amountOut, maxAmountOut));
    }
}
```
`src/MyAquaOpcodes.sol`:
```solidity
import { Context } from "swap-vm/libs/VM.sol";
import { Opcode, OpcodeOps } from "swap-vm/libs/OpcodeList.sol";
import { AquaOpcodes } from "swap-vm/opcodes/AquaOpcodes.sol";
import { CapAmountOut } from "./CapAmountOut.sol";
contract MyAquaOpcodes is AquaOpcodes {
    using OpcodeOps for Opcode;
    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual override {
        if (opcode == CapAmountOut.opcode.asU8()) CapAmountOut.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);              // official set, else UnknownOpcode
    }
}
```
`src/MyAquaSwapVMRouter.sol`:
```solidity
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { Context } from "swap-vm/libs/VM.sol";
import { SwapVM } from "swap-vm/SwapVM.sol";
import { MyAquaOpcodes } from "./MyAquaOpcodes.sol";
contract MyAquaSwapVMRouter is Simulator, SwapVM, MyAquaOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version) SwapVM(aqua, weth, owner, name, version) { }
    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override { _runOpcode(ctx, opcode, args); }
}
```
Test flow (`test/MyAquaSwapVMRouter.t.sol`): `program = bytes.concat(CapAmountOut.build(25e18), XYCSwap.build(), Salt.build(uint64(1)))`; order via `MakerTraitsLib.build(Args{ useAquaInsteadOfSignature: true, tokenA, tokenB, ... })`; maker approves Aqua and `aqua.ship(address(router), abi.encode(order), [tokenA,tokenB], [100e18,200e18])`; assert `strategyHash == router.hash(order)`; taker approves router and calls `router.swap(order, 50e18, takerData{isExactIn, useTransferFromAndAquaPush:true, isAToB:false})` → `amountOut = 20e18`, maker wallet +50e18 tokenB, `safeBalances` = (80e18, 250e18). Second test: cap 10e18 reverts `CapAmountOutExceeded(20e18, 10e18)`. Third: opcode `0xd1` → `AquaOpcodes.UnknownOpcode(0xd1)`.

### 12.1 Mainnet-fork proof against the OFFICIAL Aqua (`test/ForkOfficialAqua.t.sol`, PASS)
`vm.createSelectFork("https://ethereum-rpc.publicnode.com")`; `new MyAquaSwapVMRouter(0x1111113CCf…, WETH, owner, "MySwapVM", "1")`; program `CapAmountOut(5e18) ‖ FeeFlatIn(0.003e7) ‖ XYCSwap ‖ Salt(42)`; `deal` maker 10 WETH + 30,000 USDC; `AQUA.ship(app=router, abi.encode(order), [WETH,USDC], [10e18, 30_000e6])`; taker 3,000 USDC exactIn with `useTransferFromAndAquaPush`, threshold 0.8 WETH, deadline; `quote == swap`; `amountOut = 906,610,893,880,149,131 wei (0.9066 WETH)`; maker USDC wallet 33,000; Aqua balances `(10e18 - out, 33_000e6)`. Gas 732,948. This satisfies "official Aqua contracts used" + "on-chain token transfers on a local fork".

### 12.2 Recipe for a *modified* SwapVM opcode (allowed by the prize)
Copy the instruction library, change `exec`, keep `opcode` (same number) and wire it in your `_runOpcode` **before** `super._runOpcode` so your version shadows the official one; or change the number to an `0xd0-0xef` slot to keep both. Never reuse `0xf0-0xff`.

---

## 13. Deployment (main)

- **Ignition** (`DEPLOY.md`): `npx hardhat ignition deploy ignition/modules/{SwapVMRouter,AquaSwapVMRouter,LimitSwapVMRouter}.ts --network <net> --parameters ignition/parameters/chain-<chainId>.json [--verify]`. Module factory `ignition/modules/_router.ts` → `m.contract(name, [aqua, weth, owner, name, version])`. Params for chain 1: `weth=0xC02aaA39…`, `name="SwapVMRouter"`, `version="1.2.0"`, aqua/owner placeholders `0x0`. Plain `CREATE` by the deployer nonce — **not** deterministic; the `0x111111…` vanity address was produced by a separate pad/CREATE3 flow not in this repo (see §1).
- **Foundry**: `forge script script/DeployAquaSwapVMRouter.s.sol --rpc-url … --broadcast` reads `config/constants.json` keys `.aqua.<chainId>`, `.weth.<chainId>`, `.swapVmRouterName.<chainId>`, `.swapVmRouterVersion.<chainId>`, `.owner.<chainId>` (`script/utils/Config.sol:19-51`); shipped file only has chain 31337 with zero aqua → must edit. E2E gas script `script/GasSnapshotE2E.s.sol` (spawns local `Aqua`, `SwapVMRouterDebug`).
- Constructor for every router: `(address aqua, address weth, address owner, string name, string version)`; `owner` only rescues stuck funds; `weth` may be `address(0)` in tests (`test/base/AquaSwapVMTest.sol:50`).
- Testing on main is **Hardhat 3** (`npx hardhat test` runs the Solidity tests; ~771 tests; full compile ~7 min via-IR per `AGENTS.md`), but the sources compile fine with **Foundry** given remappings (see §12 `foundry.toml`); `forge` autodetects `node_modules` remappings inside `refs/swap-vm`. Fuzz runs 1024.

---

## 14. Deployed v1.0.2 vs `main` — compatibility matrix

| Aspect | v1.0.2 (on-chain `0x111111338c…`) | `main` (redeploy) |
|---|---|---|
| `swap/quote` signature | `(Order, address tokenIn, address tokenOut, uint256 amount, bytes)` selectors `0xf4d2d412`/`0x44aa5f14`; non-payable | `(Order, uint256 amount, bytes)` selectors `0xa69f95bd`/`0xb7ebf0c5`; payable |
| `order.data` | hooks ‖ program | tokenA ‖ tokenB ‖ hooks ‖ program |
| Taker flags | 7 | 9 (`isAToB 0x80`, `allowPartialFill 0x100`) |
| Dispatch | fn-pointer array, index-based | `Opcode` enum + `_runOpcode` if-chain, `_dispatch` |
| Instruction impl | contracts with `internal` fns (`Controls._jump`, `XYCSwap._xycSwapXD`, …) + `*ArgsBuilder` libs | libraries with `build/parse/exec` + `MemoryPtr` |
| Registers | `+ amountNetPulled` (Aqua push check subtracts it, `V102/SwapVM.sol:240`) | `ProtocolFee` struct in ctx; fee resolution in transfer phase |
| Fees | `Fee`/`FeeExperimental` (progressive fees) | `FeeFlatIn/Out`, `FeeProtocol` (progressive removed in PR #180) |
| Native ETH | no | yes (`msg.value` for WETH in) |
| Unknown opcode | Panic 0x32 | `UnknownOpcode(uint256)` |
| `runLoop` at end | reverts `RunLoopExcessiveCall` | no-op |
| Hash | identical (`ORDER_TYPEHASH` same; Aqua mode `keccak256(abi.encode(order))`) — but `data` layout differs so hashes differ across versions |

If the hackathon demo targets the **live** router, use v1.0.2 encodings (index opcodes, 5-arg swap). If it redeploys a modified router (allowed), use `main` (this KB's primary encodings) and ship to the official Aqua with `app = new router`.

---

## 15. Gotchas
- `quote()` is not `view` in the ABI; call via `asView()`/`eth_call`. Signature is not checked in `quote`.
- Aqua-mode order hash has no domain separator → same order bytes hash identically on all chains; the Aqua mapping is per-chain anyway.
- `Salt` is the only way to make two otherwise-identical strategies distinct (Aqua refuses re-shipping the same hash).
- `InstructionArgs` does not bounds-check; malformed args read zeros/garbage. Program bytes are fixed at ship time so validate off-chain.
- Fee BPS scale is `1e7` (not 1e4). `FeeFlatIn.build` reverts if `feeBps >= 1e7`.
- Aqua balances are `uint248`; `ship` amounts > `uint248` revert (`SafeCast`).
- `AquaOpcodes` has no `StaticBalances/DynamicBalances/LimitSwap` — an Aqua order using them reverts `UnknownOpcode`; extend the set (as in §12) if a limit-style Aqua position is needed.
- `useTransferFromAndAquaPush` is the simplest taker path (EOA + approval); callback path needs a contract taker implementing `ITakerCallbacks`.
- `Debug.sol` imports `forge-std/console.sol`; Debug routers exceed size limits and are test-only.

## 16. UNCERTAIN / open
- How the `0x1111…` vanity addresses were deployed (CREATE3 factory `0xef1aa3c8…`?) and whether `main` will be deployed to the same address (would break the live ABI) — unknown.
- Live opcode map of v1.0.2 was confirmed only at three sample points (0x00, 0x10, 0x50/0xff); the rest is derived from the verified source's array order (`result[i] == instructions[i+1]`).
- Whether 1inch's ETHOnline judging expects the live router ABI or accepts `main`; the prize text explicitly allows "redeployments of a modified SwapVM contract".
