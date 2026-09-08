# KB: Golden vectors for the swap-vm HEAD (World-B) TypeScript encoder

Written 2026-09-06. Closes `completeness-review.md` G5: the `sdk-ts.md §8` TS skeleton had only been diffed against `@1inch/swap-vm-sdk` (deployed 1.0.2 = "World A"). This file records a Solidity-generated, byte-exact vector set for HEAD (`swap-vm` `f09a41e`, 2026-09-03) and a vitest that proves a TS encoder reproduces every vector — order bytes, `keccak256(abi.encode(order))`, EIP-712 hash, taker data, and the 3-arg `quote/swap` selectors.

Paths (all under ``):
| What | Path |
|---|---|
| Solidity vector generator + e2e (11 tests, all PASS) | `refs/swap-vm/test/GoldenVectors.t.sol` (426 lines, untracked in the clone) |
| Raw forge output | `golden-forge-output.txt` |
| Extractor (forge log → JSON) | `head-vectors/extract-vectors.mjs` |
| Golden JSON (10 fixtures) | `head-vectors/golden-vectors.json` |
| TS encoder (World B) | `head-vectors/src/swapvm-ts.ts` (171 lines; viem 2.56.3) |
| vitest (23 tests, all PASS) | `head-vectors/test/golden.spec.ts` |

Reproduce (≈8 s forge, <1 s vitest):
```sh
cd refs/swap-vm && forge test -vv --match-contract GoldenVectors > ../../golden-forge-output.txt   # forge 1.0.0-dev, solc 0.8.30 via_ir
cd ../../head-vectors && node extract-vectors.mjs ../golden-forge-output.txt && npx vitest run     # node 22, vitest 3.2.4
```

---

## 1. TL;DR

1. **The §8 skeleton's World-B layout was right.** After the small fixes listed in §6 (tokens mandatory, `hasPreTransferInCallback` as an explicit flag, `threshold === 0n` allowed, fee range check) the TS module reproduces all 10 Solidity fixtures byte-for-byte: 6 orders (`traits`, `data`, `abi.encode(order)`, `router.hash(order)` in both Aqua and EIP-712 mode), 7 taker-data blobs, 2 program-only vectors, and the selectors.
2. **HEAD selectors** (from `ISwapVM.sol:36-53`, asserted in `test_meta`): `quote((address,uint256,bytes),uint256,bytes)` = **`0xb7ebf0c5`**, `swap(...)` = **`0xa69f95bd`**, `hash((address,uint256,bytes))` = `0xf5d08521` (unchanged), `ORDER_TYPEHASH` = `0x4ff6e0f284e5bda3bffd2bfd3adc9a8f89d4c787c8be730b8c214c0e10bb3d40` = `keccak256("Order(address maker,uint256 traits,bytes data)")` (`SwapVM.sol:75-80`). Deployed 1.0.2 for contrast: `0x44aa5f14` / `0xf4d2d412` (5-arg, `sdk-ts.md §5`).
3. **The "silent UI killer" is real and reproduced on-chain** (`test_e2e_shipQuoteSwap_and_oneByteOff`): changing `Salt` 12345→12346 (one byte of `order.data`) after `aqua.ship` makes `router.quote` revert with `IAqua.SafeBalancesForTokenNotInActiveStrategy(maker, router, badHash, tokenIn)` — raised at `Aqua.sol:32` from `SwapVM.sol:168` **before the program runs**, so any encoder drift looks like "no liquidity", not like an encoding bug.
4. **New trap found:** the official `1inch/swap-vm-template` (`e9f8def`, pins swap-vm `b44977a` 2026-07-06 "Merge release/1.2 into merge-release-1.0.1") ships `test/utils/SwapVMHelpers.ts` with a TS `MakerTraitsLib`/`TakerTraitsLib` that **already uses the 40-byte `tokenA‖tokenB` prefix, `isAToB=0x0080` and 3-arg `swap`** — but its opcode tables are the old flat ones (`XYC_SWAP_XD: 0x11`, `SALT: 0x14`, `FLAT_FEE_AMOUNT_IN_XD: 0x15`, …) and it has **no `allowPartialFill`**. It is byte-compatible with neither the deployed 1.0.2 router (5-arg, no prefix) nor HEAD (banked opcodes `0x50/0x02/0x70`). Do not copy it blindly; use the module in §5 for HEAD.
5. Numbers from the e2e run (Aqua balances A=1000e18, B=2000e18, FeeFlatIn 30 bps, concentrated in price ∈ [1.0, 4.0], spot 2.0): `quote(1e18 A→B)` = **1 993 417 892 992 630 414** B; `quote(1e18 B→A)` = **498 427 226 001 647 910** A; after `swap` the maker's Aqua balances are A = 1001e18 (full `amountIn` pushed — the flat fee stays in the pool) and B = 1 998 006 582 107 007 369 586.

---

## 2. HEAD layouts the vectors pin down (source of truth, with line refs)

### 2.1 Order (`src/libs/MakerTraits.sol`)
- `Args` struct (`:79-103`): `maker, receiver, tokenA, tokenB, shouldUnwrapWeth, useAquaInsteadOfSignature, allowZeroAmountIn, has{Pre,Post}Transfer{In,Out}Hook (4 bools), {pre,post}Transfer{In,Out}Target/Data (4 × address+bytes), program`.
- `build(Args) → ISwapVM.Order{maker, traits, data}` (`:109-171`): `require(tokenA < tokenB, MakerTraitsTokensNotSorted())` (`:110`); a hook "has target" iff `target != maker && target != 0` (`:112-115`); if data/target present the matching `has*Hook` flag **must** be set or it reverts `MakerTraitsMissingHas…Flag` (`:116-127`).
- Slice end-offsets are cumulative **from 40** (`:129-132`): `index0 = 40 + (preInHasTarget?20:0) + preInData.length`, `index1 = index0 + …postIn`, `index2 = index1 + …preOut`, `index3 = index2 + …postOut`; packed as `uint64(bytes8(abi.encodePacked(index3,index2,index1,index0)))` and shifted `<< 160` (`:134-139,155`) ⇒ `index_i` lives at bits `160+16i … 175+16i`, i.e. **index0 is the lowest** of the four uint16s.
- Flags (`:34-44`): bit 255 `shouldUnwrapWeth`, 254 `useAquaInsteadOfSignature`, 253 `allowZeroAmountIn`, 252/251/250/249 `has{PreIn,PostIn,PreOut,PostOut}Hook`, 248/247/246/245 `{PreIn,PostIn,PreOut,PostOut}HasTarget`; bits 0-159 receiver (0 ⇒ maker).
- `data = tokenA(20) ‖ tokenB(20) ‖ [preInTarget(20)] ‖ preInData ‖ [postInTarget] ‖ postInData ‖ [preOutTarget] ‖ preOutData ‖ [postOutTarget] ‖ postOutData ‖ program` (`:158-169`); readers: `tokens()` = `data[0:20], data[20:40]` (`:212-217`), `program()` = `data[index3:]` (`:219-221, 250-258`).
- `hash(order)` (`SwapVM.sol:109-120`): `useAqua ? keccak256(abi.encode(order)) : _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, maker, traits, keccak256(data))))`; router domain = ctor `(name, version)` (`SwapVM.sol:95`), tests use `"SwapVM"/"1.0.0"`, HEAD ignition params say `SwapVMRouter/1.2.0`.

### 2.2 Taker data (`src/libs/TakerTraits.sol`)
- `Args` (`:58-81`): `taker, isExactIn, shouldUnwrapWeth, isStrictThresholdAmount, isFirstTransferFromTaker, useTransferFromAndAquaPush, isAToB, allowPartialFill, threshold (bytes: 0 or 32), to, deadline (uint40), hasPreTransferInCallback, hasPreTransferOutCallback, 4× hook data, 2× callback data, instructionsArgs, signature`.
- Flags uint16 (`:101-109`): `0x0001 isExactIn, 0x0002 shouldUnwrapWeth, 0x0004 hasPreTransferInCallback, 0x0008 hasPreTransferOutCallback, 0x0010 isStrictThreshold, 0x0020 isFirstTransferFromTaker, 0x0040 useTransferFromAndAquaPush, 0x0080 isAToB, 0x0100 allowPartialFill`.
- `build(Args) → bytes` (`:115-175`): `require(threshold.length ∈ {0,32})`; callback data without its flag reverts; `index0 = threshold.length`, `index1 += (to != 0 && to != taker ? 20 : 0)`, `index2 += (deadline != 0 ? 5 : 0)`, `index3..index9` += the 7 data slices in order (preInHook, postInHook, preOutHook, postOutHook, preInCallback, preOutCallback, instructionsArgs); packed = `index9‖index8‖…‖index0` (10 × uint16, **index0 last**) ‖ `flags` ‖ slices ‖ signature. Parser: `TakerTraits = uint176(bytes22(data[0:22]))`, tail = `data[22:]` (`:182-185`); `_getOffset(n) = (traits >> 16 >> 16n) & 0xffff` (`:325-328`).
- `quote/swap` derive tokens from the flag (`SwapVM.sol:135-136`): `isAToB ? (tokenIn,tokenOut) = tokens(data) : (tokenOut,tokenIn) = tokens(data)`.
- `allowPartialFill` semantics (`:193-229`): exactIn ⇒ `takerAmount >= amountIn` (else `==`), threshold pro-rated `thr.mulDiv(amountIn, takerAmount, Ceil)`; exactOut symmetric.

### 2.3 Programs (`src/libs/InstructionBuilder.sol`, `src/instructions/*.sol`)
- Instruction = `[uint8 opcode][uint8 argsLen][args]` (`InstructionBuilder.sol:17-29`, `pushHeader` writes opcode + 1 reserved byte, `patchLength` fills it, `require(length < 256)`); `encodeBool(v, bit) = v ? 128 >> bit : 0` (`:31-34`).
- Opcode bytes = `enum Opcode` index in `src/libs/OpcodeList.sol:16-292` (banked; `0xf0-0xff` reserved). Used here: `Salt 0x02`, `Deadline 0x20`, `JumpIfTokenIn 0x31`, `XYCSwap 0x50`, `XYCConcentrateSwap 0x51`, `FeeFlatIn 0x70`, `Decay 0x9c`. The Aqua router dispatches exactly the 16 opcodes in `src/opcodes/AquaOpcodes.sol:27-45` (Jump, JumpIfTokenIn/Out, Deadline, OnlyTakerTokenBalanceNonZero/Gte, OnlyTakerTokenSupplyShareGte, XYCSwap, XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction, OnlyTxOriginTokenBalanceNonZero); anything else → `UnknownOpcode(opcode)`.
- Arg builders verified by the vectors: `Salt.build(uint64)` → 8 bytes (`Controls.sol:25-33`), `Salt.build(bytes)` → raw bytes (`:39-46`); `Deadline.build(uint40)` → 5 bytes (`:141-148`); `JumpIfTokenIn.build(address, uint16 nextPC)` → 20 + 2 bytes (`Jumps.sol:127-134`); `Decay.build(uint16)` → 2 bytes; `XYCSwap.build()` → 0 bytes; `XYCConcentrateSwap.build(uint256 sqrtPriceMin, uint256 sqrtPriceMax)` → 64 bytes; `FeeFlatIn.build(uint24 feeBps)` → **3 bytes**, `BPS = 1e7` (`FeeFlat.sol:31`), `require(feeBps < BPS)` (`:42`), so **30 bps = 30 000 = `0x007530`** (World A/SDK used `uint32` at 1e9 = `0x002dc6c0`).
- `FeeFlatIn.exec` exactIn (`FeeFlat.sol:53-70`): `fee = ceil(amountIn·bps/1e7)`, curve runs on `amountIn - fee`, then (full fill) `amountIn += fee` ⇒ the taker pays the full amount and the router pushes **all of it** into the maker's Aqua balance (`SwapVM.sol:273`), which the e2e assertion `rawA == 1000e18 + 1e18` confirms.

---

## 3. The golden vectors (verbatim from `forge test -vv`, lower-case hex)

Fixture constants: `MAKER 0x8b83c50040c743e99bd47f4327bfcf7913c505b4`, `TAKER 0x1d83cc9b3fe9ee21c45282bef1bed27dfa689ea2`, `tokenA = USDC 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, `tokenB = WETH 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`, `HOOK 0xdeadbeef…beef`, `TO 0x…cafe`, `SALT 12345 (0x3039)`, `FEE 30 bps`, `sqrtPriceMin 1e18`, `sqrtPriceMax 2e18` (price 1.0 … 4.0), `THRESHOLD 123456 (0x1e240)`, taker `DEADLINE 1_800_000_000 (0x6b49d200)`, order `Deadline 1_900_000_000 (0x713fb300)`, `Decay 600 (0x0258)`.

`meta` (router deployed in `setUp` on the default forge chain): `chainId 31337`, `router 0x2e234DAe75C793f67A35089C9d99245E1C58470b`, `aqua 0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f`, domain `SwapVM` / `1.0.0`.

### 3.1 Programs
| id | assembled bytes |
|---|---|
| f1 `XYCSwap ‖ Salt(12345)` | `0x5000 0208 0000000000003039` |
| f1b `Salt(bytes 0xdeadbeef)` | `0x0204 deadbeef` |
| f2 `FeeFlatIn(30bps) ‖ XYCConcentrateSwap(1e18,2e18) ‖ Salt` | `0x7003 007530` `5140 00…0de0b6b3a7640000 00…1bc16d674ec80000` `0208 0000000000003039` (81 B) |
| f6 `Deadline ‖ JumpIfTokenIn(USDC→pc 35) ‖ Decay(600) ‖ XYCSwap ‖ Salt` | `0x2005 00713fb300` `3116 a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 0023` `9c02 0258` `5000` `0208 0000000000003039` (47 B; pcs 0/7/31/35/37) |

### 3.2 Orders (all with `tokens = [USDC, WETH]`, no receiver unless stated)
| id | traits (hex) | data | `router.hash(order)` |
|---|---|---|---|
| f1_xyc_salt (Aqua mode) | `0x4000000000280028002800280000…0000` = bit 254 ‖ `index3..0 = 0x28 ×4` | `USDC ‖ WETH ‖ f1 program` (52 B) | `0x283c32b98f1510c2f4f9da32c054030ab179b2e6be051119281987e99081237f` |
| f2_fee_concentrate | same traits as f1 | `USDC ‖ WETH ‖ f2 program` (121 B) | `0x177e8a8168befb2d7192a48e49f87ae113c0928e25b619c3b4e4ecc29dca5460` |
| f3_hooks: preIn `{data 0xaaaa}` (maker-targeted), preOut `{target HOOK, data 0xfeedface}` | `0x5440000000420042002a002a0000…0000` — flags `useAqua(254)|hasPreIn(252)|hasPreOut(250)|preOutHasTarget(246)`, indexes `42,42,66,66` | `USDC ‖ WETH ‖ aaaa ‖ HOOK ‖ feedface ‖ f1 program` (78 B) | `0x860ee44cc8f7e7c83a59d1df754dfc3826bee6347c1a63fbf2cdb3281561aa91` |
| f5_eip712: `useAqua=false, shouldUnwrapWeth=true, receiver=TO` | `0x8000000000280028002800280000…0000cafe` | as f1 | **EIP-712** `0x45d2e74b50d7b9a2e2cb4c0421c777ada495b4d53ac14f2a9a9cbf240a97045a` (domain `SwapVM/1.0.0/31337/0x2e23…470b`) |
| f6_guards | same traits as f1 | `USDC ‖ WETH ‖ f6 program` (87 B) | `0xf38fb08fe047efafa255b281c3062be076733926df823606670b042a554113b5` |

`abi.encode(order)` for f1 (the exact `strategy` bytes `aqua.ship` hashes), one 32-byte word per line:
```
0000…0020                                  offset of the tuple (0x20)
0000…8b83c50040c743e99bd47f4327bfcf7913c505b4   maker
4000000000280028002800280000…0000          traits
0000…0060                                  offset of data inside tuple
0000…0034                                  data length = 52
a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 500002080000000000003039 + 12 zero bytes pad
```
Full hex of every `abiEncodedOrder` is in `golden-vectors.json` (f1 = 224 B, f2 = 288 B, f3 = 256 B, f5 = 224 B, f6 = 256 B; = 160 B fixed words + data padded to 32).

### 3.3 Taker data (`TakerTraitsLib.build`)
| id | inputs (on top of `isExactIn, useTransferFromAndAquaPush`) | bytes |
|---|---|---|
| f4 aToB | `threshold 123456, deadline 1.8e9, instructionsArgs 0x0102, isAToB` | `0x 0027 0025 0025 0025 0025 0025 0025 0025 0020 0020 00c1 ‖ 00…01e240 (32) ‖ 006b49d200 ‖ 0102` (61 B) |
| f4 bToA | same, `isAToB=false` | identical except flags `0041` (byte 21 differs by `0x80`) |
| f4c | `isExactIn=false, allowPartialFill, isAToB, to=TO, preTransferInCallbackData 0xc0ffee, signature 0xff` | `0x 0017 0017 0017 0014 0014 0014 0014 0014 0014 0000 01c4 ‖ 00…cafe (20) ‖ c0ffee ‖ ff` |
| f4d default bToA | nothing | `0x 00×20 0041` |
| f4d default aToB | `isAToB` | `0x 00×20 00c1` |
| f4d AquaSwapVMTest shape (`test/base/AquaSwapVMTest.sol:122-146`) | `isAToB, useTransferFromAndAquaPush=false, hasPreTransferInCallback` | `0x 00×20 0085` |

Reading f4 aToB: header words are `index9=39, index8..index2=37, index1=32, index0=32` (threshold 32 B, no `to`, deadline 5 B → 37, no hook/callback data, instructionsArgs 2 B → 39), flags `0x00c1 = isExactIn|useTransferFromAndAquaPush|isAToB`.

---

## 4. What the e2e test proves about the HEAD flow (test_e2e_shipQuoteSwap_and_oneByteOff)
1. Maker: `TokenMock` A/B sorted by address, `approve(aqua)`, `aqua.ship(router, abi.encode(order), [A,B], [1000e18, 2000e18])` → returned `strategyHash == router.hash(order) == keccak256(abi.encode(order))`.
2. Taker (EOA, default flags = `useTransferFromAndAquaPush`): `router.quote(order, 1e18, takerData(isAToB=true))` via the 3-arg ABI returns `(1e18, 1 993 417 892 992 630 414, strategyHash)`; B→A returns `498 427 226 001 647 910`.
3. `approve(router)` + `router.swap(order, 1e18, takerData)` → amounts equal the quote; taker A balance 0, B balance +out; maker wallet B −out (Aqua `pull` does `transferFrom(maker → taker)`); Aqua raw balances A = 1001e18, B = 2000e18 − out.
4. Same order with `Salt(12346)`: `router.hash` differs; `quote` reverts `SafeBalancesForTokenNotInActiveStrategy(maker, router, badHash, tokenA)` (`vm.expectRevert` with exact args). This is the error a UI sees for **any** encoder mismatch (traits bit, offset base 40 vs 0, opcode byte, fee width…), because `SwapVM.sol:168` reads Aqua balances before executing the program.

---

## 5. The TS encoder (`head-vectors/src/swapvm-ts.ts`) — load-bearing parts

```ts
// bytes: uN(v, bytes) = big-endian left-padded hex (MemoryPtr.push / InstructionArgs.asUN); bool8(v, bit) = v ? 128 >> bit : 0
export const assemble = (ixs: Ix[]): Hex => cat(...ixs.map(i => uN(i.opcode, 1) + uN(byteLen(i.args), 1) + i.args))
export const pcOf = (ixs: Ix[], i: number) => ixs.slice(0, i).reduce((a, x) => a + 2 + byteLen(x.args), 0)  // absolute nextPC
export const OP_B = { stop: 0x00, revert: 0x01, salt: 0x02, jump: 0x03, extruction: 0x04, deadline: 0x20, onlyTakerTokenBalanceNonZero: 0x23,
  onlyTakerTokenBalanceGte: 0x24, onlyTakerTokenSupplyShareGte: 0x25, onlyTxOriginTokenBalanceNonZero: 0x26, privateOrder: 0x2b,
  whitelistCoequal: 0x2c, whitelistSequential: 0x2d, jumpIfDirection: 0x30, jumpIfTokenIn: 0x31, jumpIfTokenOut: 0x32, invalidateBit: 0x40,
  invalidateTokenIn: 0x41, invalidateTokenOut: 0x42, validateSeriesEpoch: 0x48, xycSwap: 0x50, xycConcentrate: 0x51, limitSwap: 0x53,
  limitSwapFullAmount: 0x54, peggedSwap: 0x58, feeFlatIn: 0x70, feeFlatOut: 0x71, feeProtocol: 0x80, staticBalances: 0x90, dynamicBalances: 0x91,
  dutchAuctionBalanceIn: 0x94, dutchAuctionBalanceOut: 0x95, piecewiseLinearScaleBalanceIn: 0x98, piecewiseLinearScaleBalanceOut: 0x99,
  decay: 0x9c, twapSwap: 0x9d, requireMinRate: 0xb0, adjustMinRate: 0xb1, oraclePriceAdjuster: 0xb2, baseFeeAdjuster: 0xb4 } as const
export const args = { salt: (s: bigint) => uN(s, 8), saltBytes: (b: string) => strip(b), deadline: (ts) => uN(ts, 5),
  jumpIfToken: (token, nextPC) => addr(token) + uN(nextPC, 2), decay: (sec) => uN(sec, 2),
  xycConcentrate: (sqrtMin: bigint, sqrtMax: bigint) => uN(sqrtMin, 32) + uN(sqrtMax, 32),
  feeFlatB: (bps: number) => { const v = Math.round(bps * 1e3); if (v >= 1e7) throw new Error('fee >= 100%'); return uN(v, 3) }, /* … */ }

export function buildOrder(o: OrderInput): { maker: Hex; traits: bigint; data: Hex } {
  if (BigInt(o.tokens[0]) >= BigInt(o.tokens[1])) throw new Error('MakerTraitsTokensNotSorted')
  const hooks = [o.preTransferIn, o.postTransferIn, o.preTransferOut, o.postTransferOut]
  const hasTarget = hooks.map(h => !!h?.target && BigInt(h.target) !== 0n && addr(h.target) !== addr(o.maker))
  let traits = 0n; const bit = (n: number, v?: boolean) => { if (v) traits |= 1n << BigInt(n) }
  bit(255, o.shouldUnwrapWeth); bit(254, o.useAquaInsteadOfSignature ?? true); bit(253, o.allowZeroAmountIn)
  hooks.forEach((h, i) => { bit(252 - i, !!h); bit(248 - i, hasTarget[i]) })
  let data = addr(o.tokens[0]) + addr(o.tokens[1]); let end = 40                       // MakerTraits.sol:129
  hooks.forEach((h, i) => { const slice = (hasTarget[i] ? addr(h!.target!) : '') + strip(h?.data ?? '')
    data += slice; end += slice.length / 2; traits |= BigInt(end) << BigInt(160 + 16 * i) })
  if (o.receiver && BigInt(o.receiver) !== 0n) traits |= BigInt('0x' + addr(o.receiver))
  return { maker: ('0x' + addr(o.maker)) as Hex, traits, data: cat(data, o.program) }
}
export const encodeOrder = (o) => encodeAbiParameters(ORDER_ABI, [o])          // == abi.encode(order) == Aqua `strategy`
export const orderHash = (o, domain?) => (o.traits >> 254n) & 1n ? keccak256(encodeOrder(o))
  : hashTypedData({ domain, primaryType: 'Order', types: { Order: [{name:'maker',type:'address'},{name:'traits',type:'uint256'},{name:'data',type:'bytes'}] }, message: o })

export function buildTakerData(t: TakerInput): Hex {
  const to = t.to && BigInt(t.to) !== 0n && addr(t.to) !== addr(t.taker) ? addr(t.to) : ''
  const slices = [t.threshold !== undefined ? uN(t.threshold, 32) : '', to, t.deadline ? uN(t.deadline, 5) : '',
    t.preTransferInHookData, t.postTransferInHookData, t.preTransferOutHookData, t.postTransferOutHookData,
    t.preTransferInCallbackData, t.preTransferOutCallbackData, t.instructionsArgs].map(s => strip(s ?? ''))
  const ends: number[] = []; let sum = 0; for (const s of slices) { sum += s.length / 2; ends.push(sum) }
  let f = 0
  if (t.isExactIn ?? true) f |= 0x1; if (t.shouldUnwrapWeth) f |= 0x2
  if (t.hasPreTransferInCallback || t.preTransferInCallbackData) f |= 0x4; if (t.hasPreTransferOutCallback || t.preTransferOutCallbackData) f |= 0x8
  if (t.isStrictThreshold) f |= 0x10; if (t.isFirstTransferFromTaker) f |= 0x20; if (t.useTransferFromAndAquaPush ?? true) f |= 0x40
  if (t.isAToB) f |= 0x80; if (t.allowPartialFill) f |= 0x100
  return cat(...ends.slice().reverse().map(e => uN(e, 2)), uN(f, 2), ...slices, strip(t.signature ?? ''))
}
export const SELECTORS_B = { quote: toFunctionSelector('quote((address,uint256,bytes),uint256,bytes)') /* 0xb7ebf0c5 */,
  swap: toFunctionSelector('swap((address,uint256,bytes),uint256,bytes)') /* 0xa69f95bd */, hash: … /* 0xf5d08521 */ }
```
Usage for a UI (HEAD router): `const program = assemble([ix(OP_B.feeFlatIn, args.feeFlatB(30)), ix(OP_B.xycConcentrate, args.xycConcentrate(sqrtMin, sqrtMax)), ix(OP_B.salt, args.salt(salt))])`; `const order = buildOrder({ maker, tokens: [lower, higher], program })`; maker: `aqua.ship(router, encodeOrder(order), [lower, higher], [amtA, amtB])`; taker: `quote(order, amount, buildTakerData({ taker, isAToB: tokenIn === lower, threshold: minOut }))`, then `swap` with the same bytes; `orderHash(order)` is the Aqua `strategyHash` for `rawBalances/dock`.

---

## 6. Deltas vs. the `sdk-ts.md §8` skeleton (what the vectors forced)
| Skeleton | Fixed in `swapvm-ts.ts` | Why |
|---|---|---|
| `tokens?: [a,b]` optional (World A/B switch) | `tokens` required, sorted check throws | HEAD `build()` reverts `MakerTraitsTokensNotSorted`; there is no prefix-less HEAD order |
| taker flag `0x4/0x8` only when callback **data** non-empty | also when `hasPreTransferInCallback/OutCallback: true` | Solidity flag is independent of data; `AquaSwapVMTest.sol:122` uses flag=true, data="" (vector f4d `0x…0085`) |
| `t.threshold ? …` (truthy) | `t.threshold !== undefined` | a 32-byte zero threshold is legal (`threshold.length == 32`) |
| `feeFlatB` unchecked | throws for `≥ 1e7` and on `uint24` overflow | `FeeFlat.sol:42 require(feeBps < BPS)` |
| — | `saltBytes` (arbitrary-length `Salt.build(bytes)`) | used by `AquaStrategyBuilders.sol:94` (`Salt.build(abi.encodePacked(vm.randomUint()))` = 32-byte salt) |
| jump target computed once | **two-pass**: size every instruction (jump included) first, then `pcOf` | the first spec draft used an empty placeholder for the jump and produced `nextPC = 13` instead of 35 — the f6 vector caught it; kept as a negative test |
Everything else in the skeleton (bit positions, offset base 40, 22-byte taker header with reversed indexes, `keccak256(abi.encode)`, EIP-712 `hashTypedData`) matched Solidity unchanged.

---

## 7. Gotchas / decision notes
- **Solidity-side**: the first draft of `GoldenVectors.t.sol` put all fixtures in one function and failed with `Variable _2 is 1 too deep in the stack … memoryguard was present` under `via_ir` (foundry.toml: solc 0.8.30, optimizer_runs 700). Fix = one test per fixture + e2e state in storage vars. `///` natspec on a test function must not contain a bare `@` (solc error 6546).
- `vm.serializeUint` writes JSON numbers; the fixture stores `sqrtPriceMin/Max` via `vm.toString` as strings so JS never rounds them.
- The forge default chain id is 31337 and the router address `0x2e234DAe75C793f67A35089C9d99245E1C58470b` is deterministic for this test contract (second `new` in `setUp`); the EIP-712 vector f5 is only meaningful with that domain — for a real deployment recompute with the real `(name, version, chainId, router)` (`eip712Domain()` on the router returns them).
- The vectors are for **stock HEAD**. If the workshop adds/renumbers opcodes (`OpcodeList.sol` + `AquaOpcodes._runOpcode`), regenerate: add a fixture using the new `build()` and re-run the two commands at the top; the vitest reads `golden-vectors.json`, nothing else needs to change.
- Only the 16 `AquaOpcodes` are dispatchable by `AquaSwapVMRouter`; `OP_B` lists all HEAD opcodes because `SwapVMRouter` (`src/opcodes/Opcodes.sol`) accepts more — a program using e.g. `staticBalances 0x90` on the Aqua router reverts `UnknownOpcode(144)`.
- UNCERTAIN (not tested here): `LimitSwapVMRouter` opcode set and `FeeProtocol 0x80` arg layout (`sdk-ts.md §6.4` documents the encoding but no vector was generated); `Extruction`, `PeggedSwap` likewise. Add fixtures the same way if the position uses them.
- The World-A (deployed 1.0.2) vectors in `sdk-ts.md §4/§8` remain valid for the official router; these HEAD vectors apply only to a redeployed HEAD router (allowed by the prize rules: "redeployments of a modified SwapVM contract is allowed").
