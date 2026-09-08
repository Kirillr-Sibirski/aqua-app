# KB: 1inch TypeScript SDKs for Aqua + SwapVM (what exists, what matches the deployed contracts, what we must write)

Researched 2026-09-05 from local clones + npm registry + live mainnet probes.
Paths below are under ``:
- `sdks/` = clone of https://github.com/1inch/sdks (HEAD `cf377ec`, 2026-09-04). Sparse checkout was expanded; `typescript/{aqua,swap-vm,sdk-core}` and `contracts/` are now present.
- `swap-vm/` = clone of https://github.com/1inch/swap-vm (HEAD `f09a41e`, 2026-09-03, "remove-progressive-fees").
- `swap-vm-be0a9cc/` = raw files of swap-vm at commit `be0a9cc840bb63b9f1abf864a39f4393e1a7312e` (the commit the sdks repo pins as `@1inch/swap-vm`), downloaded from raw.githubusercontent.com.
- `npm/{swap-vm-sdk,aqua-sdk,sdk-core,byte-utils}/package/` = unpacked npm tarballs. `npm/sdk-try/` = node project with the SDKs installed + `vec.cjs` / `probe.cjs` scripts that generated the verified vectors below.

---

## 0. TL;DR (decision-relevant)

1. **Official TS SDKs exist and are published**: `@1inch/aqua-sdk@0.3.1`, `@1inch/swap-vm-sdk@0.4.1`, `@1inch/sdk-core@0.1.3` (all modified 2026-09-04, dist-tag `next` = `0.3.2-rc.0`/`0.4.2-rc.0`/`0.1.4-rc.0`), plus dependency `@1inch/byte-utils@3.1.8`. They ship: viem-based calldata builders for `ship/dock/quote/swap/hash`, event parsers, **a full SwapVM program encoder/decoder (opcode tables + per-instruction arg coders)**, `MakerTraits`/`TakerTraits`/`Order` packers, and ready strategies (`AquaXYCAmmStrategy`, `AquaPeggedAmmStrategy`). No package named `@1inch/aqua` or `@1inch/swap-vm` exists on npm (404) despite the swap-vm README saying `npm install @1inch/swap-vm`.
2. **Two incompatible SwapVM "worlds"**:
   - **World A = what is DEPLOYED** at `0x111111338c5091e8440b67b168bae16a668ac0de` (all chains). Verified live on mainnet: `eip712Domain()` → name `"1inch SwapVM v1.0"`, version `"1.0.2"`; selectors present: `quote((address,uint256,bytes),address,address,uint256,bytes)`=`0x44aa5f14`, `swap(...)`=`0xf4d2d412`, `hash((address,uint256,bytes))`=`0xf5d08521`; opcode table has exactly 34 entries (opcode 34 → `Panic(0x32)` array OOB). **The npm `@1inch/swap-vm-sdk@0.4.1` targets World A** (flat opcode indexes 10..33, 5-arg quote/swap). The sdks repo compiles its e2e contracts from swap-vm commit `be0a9cc`.
   - **World B = local `swap-vm` HEAD (`f09a41e`)**: NOT deployed anywhere we can see. Different ABI (`quote(order, amount, takerTraitsAndData)` — tokenIn/tokenOut derived from a new `isAToB` taker flag + `tokenA/tokenB` stored in `order.data[0:40]`), banked opcode enum (`Jump=0x03`, `XYCSwap=0x50`, `FeeFlatIn=0x70` …), different fee encoding (`uint24`, 1e7 = 100%), new taker flags (`isAToB=0x80`, `allowPartialFill=0x100`), dispatch via `_dispatch` override. **No TS encoder exists for World B anywhere** (swap-vm repo has only `hardhat.config.ts` + ignition modules; tests are all Solidity).
3. **Hackathon implication**: if we use the official deployed `AquaSwapVMRouter` + `Aqua`, we can use the npm SDKs almost as-is (see bug list in §4.9). If we "modify SwapVM opcodes and redeploy" from HEAD (allowed by the prize rules), we must write our own TS encoder for the World-B layouts (skeleton in §8) — the npm SDK's `ProgramBuilder` can be reused only for the outer `[opcode][len][args]` framing with a custom `ixsSet`, but its traits/order/ABI code is wrong for HEAD.
4. **SDK bug found by live probe**: `@1inch/swap-vm-sdk@0.4.1` encodes `jumpIfTokenIn/jumpIfTokenOut` args as `10-byte address tail + uint16` (12 bytes); the deployed router reads a full 20-byte address (`ControlsMissingTokenArg` revert with SDK encoding; works with 20-byte encoding). All other Aqua-set coders we tested match the deployed contract.

---

## 1. Package inventory

| Package | Version | Repo path | Ships | Runtime deps |
|---|---|---|---|---|
| `@1inch/aqua-sdk` | 0.3.1 (latest), 0.3.2-rc.0 (next) | `sdks/typescript/aqua` | `AquaProtocolContract`, `AQUA_ABI`, `AQUA_CONTRACT_ADDRESSES`, `ShippedEvent/DockedEvent/PushedEvent/PulledEvent`, re-exports `Address, HexString, NetworkEnum, CallInfo` | `viem ^2.48.4`, `@1inch/sdk-core 0.1.3`, `tslib` |
| `@1inch/swap-vm-sdk` | 0.4.1 (latest), 0.4.2-rc.0 (next) | `sdks/typescript/swap-vm` | `SwapVMContract`, `SWAP_VM_ABI`, `AQUA_SWAP_VM_CONTRACT_ADDRESSES`, `Order`, `MakerTraits`, `TakerTraits`, `ProgramBuilder`, `AquaProgramBuilder`, `RegularProgramBuilder`, `SwapVmProgram`, `instructions.*` (coders + opcode tables `aquaInstructions`/`_allInstructions`), `AquaXYCAmmStrategy`, `AquaPeggedAmmStrategy`, `SwappedEvent` | `@1inch/byte-utils ^3.1.7`, `@1inch/sdk-core 0.1.3`, `tslib`; **peer** `viem ^2.21.0` |
| `@1inch/sdk-core` | 0.1.3 | `sdks/typescript/sdk-core` | `Address`, `HexString`, `AddressHalf`, `Interaction`, `NetworkEnum`, types `CallInfo`, `LogLike`, `Hex`, `DataFor`; subpath `@1inch/sdk-core/test-utils` (`TestWallet`, `ADDRESSES`) | `viem`, `@1inch/byte-utils` |
| `@1inch/byte-utils` | 3.1.8 | (separate repo 1inch/ts-byte-utils-lib) | `BytesBuilder`, `BytesIter`, `BN`, `BitMask`, `add0x/trim0x`, `UINT_*_MAX`, `isHexBytes` | none |

Build: tsdown, CJS `dist/index.js` + ESM `dist/index.mjs` + `.d.ts`. `sdks/AGENTS.md` warns: **the ESM entry of `swap-vm-sdk` fails under strict Node ESM** (byte-utils extensionless import) — use CJS `require()` in plain Node scripts; bundlers (Vite/Next) are fine. Verified: `require('@1inch/swap-vm-sdk')` works on Node 22.

License: `LicenseRef-Degensoft-Aqua-Source-1.1` / `LicenseRef-Degensoft-SwapVM-1.1` (source-available, not MIT).

GitHub `1inch/sdks` `typescript/` has exactly: `aqua`, `sdk-core`, `swap-vm` (+ workspace also lists `cross-chain`, `fusion`, `limit-order` dirs in `pnpm-workspace.yaml` but they are not in the tree).

Monorepo dev: `pnpm build:contracts` (forge build of `contracts/src/**` into `dist/contracts`, needed before lint/tests), `pnpm nx test aqua|swap-vm`, e2e = vitest + testcontainers anvil (`ghcr.io/foundry-rs/foundry:v1.2.3`) forking mainnet (`FORK_URL`, default `https://eth.llamarpc.com`, often down → use `https://ethereum-rpc.publicnode.com`). `sdks/foundry.toml`: solc 0.8.30, via_ir, optimizer_runs 700. `sdks/remappings.txt`: `@1inch/swap-vm/=node_modules/@1inch/swap-vm/src/`.

---

## 2. `@1inch/sdk-core` primitives (used by both SDKs)

`sdks/typescript/sdk-core/src/domains/address.ts`:
```ts
class Address { static NATIVE_CURRENCY; static ZERO_ADDRESS; constructor(val: string /* asserts viem isAddress, lowercases */); static fromBigInt(v: bigint); static fromFirstBytes(bytes: string); toString(): Hex; equal(o); lt(o); gt(o); isNative(); isZero(); lastHalf(): string /* '0x'+last 20 hex chars = 10 bytes */; toJSON() }
```
`hex-string.ts`: `class HexString { static EMPTY = '0x'; constructor(hex, name?) /* asserts even length */; static fromBigInt; toBigInt(); isEmpty(); concat(o); bytesCount(); sliceBytes(start, end?); equal(o); toString(): Hex }`
`interaction.ts`: `class Interaction { constructor(target: Address, data: HexString); static decode(bytes) /* first 20 bytes target, rest data */; encode(): HexString }`
`address-half.ts`: `AddressHalf.fromAddress(a)` = last 10 bytes of address (used by the SDK for `jumpIfToken*` and `balances` coders — see bug §4.9).
`types/chain.ts`: `enum NetworkEnum { ETHEREUM=1, POLYGON=137, ZKSYNC=324, BINANCE=56, ARBITRUM=42161, AVALANCHE=43114, OPTIMISM=10, GNOSIS=100, COINBASE=8453, LINEA=59144, SONIC=146, UNICHAIN=130, ROBINHOOD=4663, MONAD=143, CRONOS=25, HYPEREVM=999 }`
`types/tx.ts`: `type CallInfo = { to: Hex; data: Hex; value: bigint }` — every SDK "tx builder" returns this; you send it with viem `walletClient.sendTransaction(callInfo)`.
`types/log.ts`: `type LogLike = { data: Hex; topics: [Hex, ...Hex[]] | [] }`.
`types/data-for.ts`: `DataFor<T>` = non-function props of T (used for `.new({...})` factories).
`test-utils/test-wallet.ts`: `TestWallet(privateKeyOrAddress, transport, chain)` wrapping viem wallet+public client: `send(CallInfo & {allowFail?}) → {txHash, blockTimestamp, blockHash}` (gas 10M), `tokenBalance(token)`, `unlimitedApprove(token, spender)`, `transferToken`, `signTypedData`, `static fromAddress(addr)` (anvil impersonate). `test-utils/addresses.ts`: mainnet `WETH 0xc02a…6cc2`, `USDC 0xa0b8…eb48`, `DAI`, `USDT`, `WBTC`, and donor addresses.

---

## 3. `@1inch/aqua-sdk` API (file: `sdks/typescript/aqua/src/aqua-protocol-contract/aqua-protocol-contract.ts`)

```ts
class AquaProtocolContract {
  constructor(public readonly address: Address)
  static encodeShipCallData(args: ShipArgs): HexString     // viem encodeFunctionData(AQUA_ABI,'ship',[app, strategy, tokens[], amounts[]])
  static encodeDockCallData(args: DockArgs): HexString     // 'dock',[app, strategyHash, tokens[]]
  static buildShipTx(contract: Address, p: ShipArgs): CallInfo   // {to, data, value: 0n}
  static buildDockTx(contract: Address, p: DockArgs): CallInfo
  static calculateStrategyHash(strategy: HexString): HexString   // keccak256(strategy bytes)
  ship(p: ShipArgs): CallInfo
  dock(p: DockArgs): CallInfo
}
type ShipArgs = { app: Address; strategy: HexString; amountsAndTokens: { amount: bigint; token: Address }[] }
type DockArgs = { app: Address; strategyHash: HexString /* keccak256(strategy) */; tokens: Address[] }
```
Constants (`constants.ts`): `AQUA_CONTRACT_ADDRESSES: Record<NetworkEnum, Address>` — all 16 chains → `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`.

ABI (`src/abi/Aqua.abi.ts`, `AQUA_ABI as const`, viem-typed):
- `ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32 strategyHash)`
- `dock(address app, bytes32 strategyHash, address[] tokens)`
- `push(address maker, address app, bytes32 strategyHash, address token, uint256 amount)` (caller transfers tokens in; increases maker/app/strategy balance)
- `pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to)` (caller must be the app)
- `rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248 balance, uint8 tokensCount)`
- `safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) view returns (uint256 balance0, uint256 balance1)` (reverts `SafeBalancesForTokenNotInActiveStrategy` if token not in active strategy)
- events (all fields **non-indexed**, so no topic filtering by maker — filter client-side): `Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)`, `Docked(maker, app, strategyHash)`, `Pushed(maker, app, strategyHash, token, amount)`, `Pulled(maker, app, strategyHash, token, amount)`
- errors: `DockingShouldCloseAllTokens(app, strategyHash)`, `MaxNumberOfTokensExceeded(tokensCount, max)`, `PushToNonActiveStrategyPrevented(maker, app, strategyHash, token)`, `SafeBalancesForTokenNotInActiveStrategy(...)`, `StrategiesMustBeImmutable(app, strategyHash)`, `SafeTransferFromFailed()`.

Event classes (`events/*.ts`): `ShippedEvent.fromLog(log: LogLike)` → `{maker: Address, app: Address, strategyHash: HexString, strategy: HexString}`; `DockedEvent`, `PushedEvent`, `PulledEvent` analogous (`token: Address, amount: bigint`). Topic0 constants:
- `ShippedEvent.TOPIC = 0xdc3622e06fb145651f567d421c9ef261d71d43e3778b761907bc0d70d42e52b0`
- `DockedEvent.TOPIC  = 0xd173a1d140c154eb1ce9298d251d5eb8c4089cc2d16e70f1067bdc810c6fe004`
- `PushedEvent.TOPIC  = 0x3f18354abbd5306dd1665c2c90f614a4559e39dd620d04fbe5458e613b6588f3`
- `PulledEvent.TOPIC  = 0x3ad61047071575417c75e3311e5d46ff042e292b5dd8769ff18b4b254098ca7a`
Implementation is just viem `decodeEventLog({abi: AQUA_ABI, data, topics, eventName})`.

Semantics (from `aqua/src/interfaces/IAqua.sol`): Aqua stores **virtual balances** ("allowances") per `(maker, app, strategyHash, token)`; tokens stay in the maker's wallet until an app `pull`s them, so the **maker must ERC-20-approve the Aqua contract** for each token and actually hold the tokens (`aqua.spec.ts` does `liqProvider.unlimitedApprove(WETH, aqua)`). `ship` is idempotent-protected (`StrategiesMustBeImmutable`); `dock` must list all strategy tokens; `strategyHash == keccak256(strategy)`.

How to read balances (from `sdks/typescript/aqua/tests/aqua.spec.ts:18-32`):
```ts
const [balance] = await publicClient.readContract({ address: AQUA, abi: AQUA_ABI, functionName: 'rawBalances', args: [maker, app, strategyHash, token] })
```
E2E flow in `aqua.spec.ts` (XYCSwap example app from `aqua/examples/apps/XYCSwap.sol`, helper `sdks/contracts/src/aqua/TestTrader.sol`): strategy bytes = `encodeAbiParameters(tuple(address maker,address token0,address token1,uint256 feeBps,bytes32 salt))` → `aqua.ship({app: xycSwap, strategy, amountsAndTokens})` → taker calls `TestTrader.swap(app, strategy, zeroForOne, amountIn)` (TestTrader implements `xycSwapCallback` which does `AQUA.push(maker, app, strategyHash, tokenIn, amountIn)`) → `aqua.dock({app, strategyHash, tokens})`. For SwapVM the "app" is the `AquaSwapVMRouter` and the strategy bytes are the ABI-encoded `Order` (§4.3).

---

## 4. `@1inch/swap-vm-sdk` API (targets the DEPLOYED router, World A)

### 4.1 Contract wrapper (`sdks/typescript/swap-vm/src/swap-vm-contract/swap-vm-contract.ts`)
```ts
class SwapVMContract {
  constructor(public readonly address: Address)
  static encodeQuoteCallData(a: QuoteArgs): HexString  // encodeFunctionData(SWAP_VM_ABI,'quote',[order.build(), tokenIn, tokenOut, amount, takerTraits.encode()])
  static encodeSwapCallData(a: SwapArgs): HexString    // 'swap', same args
  static encodeHashOrderCallData(order: Order): HexString // 'hash',[order.build()]
  static buildQuoteTx / buildSwapTx / buildHashOrderTx(contract: Address, ...): CallInfo  // value: 0n always (no native-ETH path)
  quote(a: QuoteArgs): CallInfo; swap(a: SwapArgs): CallInfo; hashOrder(order): CallInfo
}
type QuoteArgs = SwapArgs = { order: Order; tokenIn: Address; tokenOut: Address; amount: bigint; takerTraits: TakerTraits }
```
`constants.ts`: `AQUA_SWAP_VM_CONTRACT_ADDRESSES: Record<NetworkEnum, Address>` → `0x111111338c5091e8440b67b168bae16a668ac0de` on all 16 chains. Comment there: "Deployed with EIP-712 name `1inch SwapVM v1.0`, version `1.0.2` (Monad, Cronos, HyperEVM report `1.0`). Supersedes previous deployment `0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de`. @see swap-vm blob `fcca73f`/src/routers/AquaSwapVMRouter.sol".

`abi/SwapVM.abi.ts` (`SWAP_VM_ABI as const`): `AQUA() view`, `ORDER_TYPEHASH() view`, `asView()`, `eip712Domain()`, `hash((address maker,uint256 traits,bytes data) order) view returns bytes32`, `quote(order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) nonpayable returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)`, `swap(...)` same signature, event `Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)` (non-indexed), plus errors. Note `quote` is declared `nonpayable` (it is `external` non-view in Solidity because instructions may write storage; it is meant to be `eth_call`ed) → in viem use `publicClient.simulateContract` or `call` + `decodeFunctionResult`, not `readContract`.

`events/swapped-event.ts`: `SwappedEvent.fromLog(log)` → `{orderHash: HexString, maker, taker, tokenIn, tokenOut: Address, amountIn, amountOut: bigint}`; `SwappedEvent.TOPIC = 0x54bc5c027d15d7aa8ae083f994ab4411d2f223291672ecd3a344f3d92dcaf8b2`.

### 4.2 `MakerTraits` (`src/swap-vm/maker-traits.ts`)
```ts
class MakerTraits {
  constructor(shouldUnwrap: boolean, useAquaInsteadOfSignature: boolean, allowZeroAmountIn: boolean, customReceiver?: Address, preTransferInHook?: Interaction, postTransferInHook?: Interaction, preTransferOutHook?: Interaction, postTransferOutHook?: Interaction)
  static new(data: DataFor<MakerTraits>)
  static default()   // useAquaInsteadOfSignature=true, shouldUnwrap=false, allowZeroAmountIn=false, no receiver/hooks
  static decode(traits: bigint, hooksData?: HexString): MakerTraits
  static hooksDataEndsAtByte(traits: bigint): number     // = offset index3 = where program starts in order.data
  with(partial): this                                    // mutates in place
  encode(maker?: Address): { traits: bigint; hooksData: HexString }
}
```
Bit layout (identical in World A and World B): bits 255..245 flags: `255 shouldUnwrapWeth, 254 useAquaInsteadOfSignature, 253 allowZeroAmountIn, 252 hasPreTransferInHook, 251 hasPostTransferInHook, 250 hasPreTransferOutHook, 249 hasPostTransferOutHook, 248 preTransferInHookHasTarget, 247 postTransferInHookHasTarget, 246 preTransferOutHookHasTarget, 245 postTransferOutHookHasTarget`; bits 223..160 = 4×uint16 cumulative end-offsets of hook slices (index0 at bits 160..175, index3 at bits 208..223); bits 159..0 = receiver address (0 = maker). A hook "has target" iff `target != 0 && target != maker`; if it has a target the slice is `20-byte target ‖ data`, else just `data` (called on the maker itself). `hooksData = slice0‖slice1‖slice2‖slice3`, and `order.data = hooksData ‖ program`.
Verified: `MakerTraits.default().encode()` → `traits = 0x4000000000000000000000000000000000000000000000000000000000000000`, `hooksData = 0x`.
**World B difference**: at HEAD `order.data = tokenA(20) ‖ tokenB(20) ‖ hooksData ‖ program` and the offsets are computed from base 40 (`index0 = 40 + …`, `MakerTraits.sol:129`); `tokenA < tokenB` is required (`MakerTraitsTokensNotSorted`). The SDK's `MakerTraits`/`Order` do not know about this prefix.

### 4.3 `Order` (`src/swap-vm/order.ts`)
```ts
class Order {
  static ABI = { type:'tuple', components:[{name:'maker',type:'address'},{name:'traits',type:'uint256'},{name:'data',type:'bytes'}] } as const
  constructor(maker: Address, traits: MakerTraits, program: SwapVmProgram /* extends HexString */)
  static new({maker, traits, program})
  static decode(encoded: HexString): Order            // NOTE: README calls it Order.parse — real name is decode
  build(): { maker: Hex; traits: bigint; data: Hex }  // data = hooksData.concat(program)
  encode(): HexString                                  // viem encodeAbiParameters([Order.ABI],[build()])  ← this is the Aqua `strategy` bytes
  hash(domain?: {chainId, name, version, verifyingContract: Address}): HexString
    // Aqua mode (traits.useAquaInsteadOfSignature): keccak256(encode())  — equals Aqua strategyHash AND swapVM.hash(order)
    // signature mode: viem hashTypedData(domain, primaryType 'Order', Order:[maker address, traits uint256, data bytes], message: build())
}
```
On-chain (`SwapVM.sol:109-120`, same in both worlds): `hash(order) = useAqua ? keccak256(abi.encode(order)) : _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, maker, traits, keccak256(data))))`, `ORDER_TYPEHASH = keccak256("Order(address maker,uint256 traits,bytes data)")`. The sdks e2e test (`tests/swap-vm.spec.ts:108-133`) asserts `order.hash(domain) == swapVM.hash(order)` for a TestAquaSwapVMRouter with domain name `TestAquaSwapVMRouter`, version `1.0`.
Verified vector (maker `0x8b83…05b4`, default traits, program `0x1100`):
`order.encode() = 0x0000…0020 | 0000…8b83c50040c743e99bd47f4327bfcf7913c505b4 | 4000…0000 | 0000…0060 | 0000…0002 | 1100 0000…` and `order.hash() = keccak256(that) = 0xd65fa86e3d6772240d398bd9b599b39b92f0171791e6b30d94105d0d93f7a907 == AquaProtocolContract.calculateStrategyHash(order.encode())`.

### 4.4 `TakerTraits` (`src/swap-vm/taker-traits.ts`)
```ts
class TakerTraits {
  constructor(exactIn, shouldUnwrap, preTransferInCallbackEnabled, preTransferOutCallbackEnabled, strictThreshold, firstTransferFromTaker, useTransferFromAndAquaPush, threshold=0n, customReceiver=ZERO, deadline=0n /*uint40*/, preTransferInHookData=EMPTY, postTransferInHookData, preTransferOutHookData, postTransferOutHookData, preTransferInCallbackData, preTransferOutCallbackData, instructionsArgs, signature)
  static new(partial)  // defaults: exactIn=true, useTransferFromAndAquaPush=true, everything else false/empty
  static default()
  static decode(packed: HexString)
  with(partial): this
  encode(): HexString
  validate(amountIn, amountOut): void  // local threshold check mirroring contract
}
```
Packed format = `takerTraitsAndData` bytes: **22-byte header** = 10×uint16 offsets in order `index9, index8, …, index0` (so index0 is the LAST uint16 before flags) ‖ uint16 flags; then variable slices in order: `threshold (0|32 bytes) ‖ to (0|20) ‖ deadline (0|5, uint40) ‖ preTransferInHookData ‖ postTransferInHookData ‖ preTransferOutHookData ‖ postTransferOutHookData ‖ preTransferInCallbackData ‖ preTransferOutCallbackData ‖ instructionsArgs ‖ signature` (signature = everything after index9, only used when `useAquaInsteadOfSignature=false`). index_k = cumulative byte length through slice k (index0 = threshold length, …, index9 = through instructionsArgs). Contract parse: `TakerTraits = uint176(bytes22(data[0:22]))`, `_getOffset(n) = (traits >> 16 >> (16n)) & 0xffff` (`TakerTraits.sol:325-328`).
Flags (uint16): `0x0001 isExactIn, 0x0002 shouldUnwrapWeth, 0x0004 hasPreTransferInCallback, 0x0008 hasPreTransferOutCallback, 0x0010 isStrictThresholdAmount, 0x0020 isFirstTransferFromTaker, 0x0040 useTransferFromAndAquaPush` — World A (deployed, be0a9cc `TakerTraits.sol:93-99`) and SDK. **World B (HEAD) adds `0x0080 isAToB` (tokenIn = tokenA if set) and `0x0100 allowPartialFill`** (`TakerTraits.sol:101-109`).
Verified vectors: `TakerTraits.default().encode() = 0x00000000000000000000000000000000000000000041` (10 zero offsets, flags 0x0041 = exactIn|useTransferFromAndAquaPush). `TakerTraits.new({exactIn:true, threshold:123456n, deadline:1800000000n}).encode() = 0x 0025×8 0020 0020 0041 ‖ 00…01e240 (32 B) ‖ 006b49d200 (5 B)`.
Semantics of `useTransferFromAndAquaPush=true` (default): router does `IERC20(tokenIn).safeTransferFrom(taker, router, amountIn)` then `AQUA.push(maker, router, orderHash, tokenIn, amountIn - fee)` → **taker must approve tokenIn to the router** (`setup-evm.ts:252-253`). If false, the taker (a contract, via `preTransferInCallback`) must itself push to Aqua; router checks `rawBalances >= original + amountIn` (`SwapVM.sol:274-280`). `threshold` = minOut (exactIn) or maxIn (exactOut); strict mode = must equal.

### 4.5 Program builders (`src/swap-vm/programs/`)
```ts
class ProgramBuilder {
  constructor(protected readonly ixsSet: IOpcode[])       // opcode byte = index in ixsSet
  add(ix: IInstruction): this                              // throws if opcode not in set
  build(): SwapVmProgram                                   // for each ix: addByte(index) addByte(argsLen) addBytes(args)
  decode(program: SwapVmProgram): this                     // throws on opcode 0 ("NOT_INSTRUCTION") or missing index
  getInstructions(): IInstruction[]
}
class AquaProgramBuilder extends ProgramBuilder   // ixsSet = [...aquaInstructions]; typed helpers:
  jump({nextPC}) jumpIfTokenIn({tokenTail, nextPC}) jumpIfTokenOut(...) deadline({deadline}) onlyTakerTokenBalanceNonZero({token}) onlyTxOriginTokenBalanceNonZero({token}) onlyTakerTokenBalanceGte({token, minAmount}) onlyTakerTokenSupplyShareGte({token, minShareE18}) salt({salt}) xycSwapXD() concentrateGrowLiquidity2D({sqrtPriceMin, sqrtPriceMax}) peggedSwapGrowPriceRange2D({x0,y0,linearWidth,rateLt,rateGt}) decayXD({decayPeriod}) flatFeeAmountInXD({fee}) protocolFeeAmountInXD({fee,to}) aquaProtocolFeeAmountInXD({fee,to}) dynamicProtocolFeeAmountInXD({feeProvider}) aquaDynamicProtocolFeeAmountInXD({feeProvider}) withDebug() debugPrint*()
  static decode(program)
class RegularProgramBuilder extends ProgramBuilder // ixsSet = _allInstructions (46 entries; for a not-yet-deployed "full SwapVM")
class SwapVmProgram extends HexString {}
```
Instruction model (`instructions/types.ts`, `opcode.ts`): `Opcode<T>(id: symbol, coder: IArgsCoder<T>)` with `createIx(args) → Instruction{opcode, args}`; `IArgsCoder = {encode(T): HexString; decode(HexString): T}`; `IArgsData = {toJSON()}`. Custom instruction = args class + coder + `new Opcode(Symbol('X'), coder)` placed at the right index of your `ixsSet` (README §"Creating your own instructions").

### 4.6 Opcode tables in the SDK (`instructions/index.ts`) — opcode byte = 0-based array index
`aquaInstructions` (34 entries) — **verified against the deployed router**:
| byte | dec | opcode | args coder (bytes) |
|---|---|---|---|
| 0x00–0x09 | 0–9 | EMPTY (debug placeholders; `withDebug()` swaps 0–5 for print ops in Debug routers) | — |
| 0x0a | 10 | `controls.jump` | uint16 nextPC |
| 0x0b | 11 | `controls.jumpIfTokenIn` | SDK: 10-byte tail + uint16 (**WRONG for deployed: contract reads 20-byte address + uint16**) |
| 0x0c | 12 | `controls.jumpIfTokenOut` | same bug |
| 0x0d | 13 | `controls.deadline` | uint40 |
| 0x0e | 14 | `controls.onlyTakerTokenBalanceNonZero` | address(20) |
| 0x0f | 15 | `controls.onlyTakerTokenBalanceGte` | address(20) + uint256 |
| 0x10 | 16 | `controls.onlyTakerTokenSupplyShareGte` | address(20) + uint64 minShareE18 |
| 0x11 | 17 | `xycSwap.xycSwapXD` | none |
| 0x12 | 18 | `concentrate.concentrateGrowLiquidity2D` | uint256 sqrtPriceMin + uint256 sqrtPriceMax (sqrt(P)·1e18, P = tokenGt/tokenLt) |
| 0x13 | 19 | `decay.decayXD` | uint16 period (s) |
| 0x14 | 20 | `controls.salt` | uint64 |
| 0x15 | 21 | `fee.flatFeeAmountInXD` | uint32 fee, 1e9 = 100% (`FlatFeeArgs.fromBps(bps)` = bps·100000) |
| 0x16–0x1a | 22–26 | EMPTY | — |
| 0x1b | 27 | `fee.protocolFeeAmountInXD` | uint32 fee + address to |
| 0x1c | 28 | `fee.aquaProtocolFeeAmountInXD` | uint32 fee + address to (pulls from maker Aqua balance) |
| 0x1d | 29 | `fee.dynamicProtocolFeeAmountInXD` | address feeProvider |
| 0x1e | 30 | `fee.aquaDynamicProtocolFeeAmountInXD` | address feeProvider |
| 0x1f | 31 | `peggedSwap.peggedSwapGrowPriceRange2D` | 5×uint256: x0, y0, linearWidth(1e27-scaled A), rateLt, rateGt |
| 0x20 | 32 | `extruction.extruction` | address target + bytes args |
| 0x21 | 33 | `controls.onlyTxOriginTokenBalanceNonZero` | address(20) |
(The `// 11`, `// 18` comments in the source are 1-based positions of the Solidity static array; the actual byte is index−1, e.g. xycSwap = 0x11 = 17, confirmed by the SDK test `expect(program).toBe('0x1100')` and by mainnet probes.) Old Solidity table: `swap-vm-be0a9cc/src/opcodes/AquaOpcodes.sol:32-83` (34-element static array with `_notInstruction` at 0, then `mstore(result, len-1)` shifts everything by one). be0a9cc lacks opcode 33; the deployed 1.0.2 has it (probe: `TxOriginTokenBalanceIsZero` revert), i.e. deployed code ≈ commit `fcca73f` (UNCERTAIN exact commit).
`_allInstructions` (46 entries, for `RegularProgramBuilder`): 0–9 EMPTY, 10 jump, 11 jumpIfTokenIn, 12 jumpIfTokenOut, 13 deadline, 14–16 onlyTaker*, 17 staticBalancesXD, 18 dynamicBalancesXD, 19 invalidateBit1D, 20 invalidateTokenIn1D, 21 invalidateTokenOut1D, 22 xycSwapXD, 23 concentrateGrowLiquidity2D, 24 decayXD, 25 limitSwap1D, 26 limitSwapOnlyFull1D, 27 requireMinRate1D, 28 adjustMinRate1D, 29 dutchAuctionBalanceIn1D, 30 dutchAuctionBalanceOut1D, 31 baseFeeAdjuster1D, 32 twap, 33 extruction, 34 salt, 35 flatFeeAmountInXD, 36 flatFeeAmountOutXD, 37 progressiveFeeInXD, 38 progressiveFeeOutXD, 39 protocolFeeAmountOutXD, 40 aquaProtocolFeeAmountOutXD, 41 peggedSwapGrowPriceRange2D, 42 protocolFeeAmountInXD, 43 aquaProtocolFeeAmountInXD, 44 dynamicProtocolFeeAmountInXD, 45 aquaDynamicProtocolFeeAmountInXD. **No deployed contract matches this table** (README: "After the Fusaka hardfork a full SwapVM deployment is planned"); and it does not match HEAD either.

### 4.7 Strategies (`src/swap-vm/strategies/`)
`AquaAMMStrategy` (abstract): `.withProtocolFee(bps, receiver)`, `.withDecayPeriod(sec: bigint)`, `.withFeeTokenIn(bps: number)`, `.withTxOriginAccessToken(token)`, `.withSalt(salt: bigint)`.
`AquaXYCAmmStrategy.new()` / `.newConcentrate({rawPriceMin, rawPriceMax} | {sqrtPriceMin, sqrtPriceMax})` → `.build(): SwapVmProgram` emits in order: `[onlyTxOriginTokenBalanceNonZero] [aquaProtocolFeeAmountInXD] [concentrateGrowLiquidity2D] [decayXD] [flatFeeAmountInXD] xycSwapXD [salt]`.
`AquaPeggedAmmStrategy.new({tokenA:{address,decimals,reserve}, tokenB, linearWidth})` → `[…guards/fees…] peggedSwapGrowPriceRange2D [salt]` (rate = 10^(decimals diff)).
Price convention: `P = tokenGt/tokenLt` (token with greater address over lower) in 1e18; `ConcentrateGrowLiquidity2DArgs.fromRawPrices(pMin, pMax)` computes `sqrt(p·1e18)`; helpers `instructions.concentrate.{Price, PriceRange, TokenReserve, ONE_E18}` and `instructions.bigintSqrt`.
Verified vectors: `AquaXYCAmmStrategy.new().build() = 0x1100`; `.withFeeTokenIn(30).withDecayPeriod(600n).withSalt(12345n)` → `0x 1302 0258 | 1504 002dc6c0 | 1100 | 1408 0000000000003039` (decay 600s, fee 3,000,000/1e9 = 0.30 %, xyc, salt); `newConcentrate({rawPriceMin: 1e18/3000n, rawPriceMax: 1e18/1500n})` → `0x1240 <32B sqrtMin=0x40dd06852f7a77> <32B sqrtMax=0x5bbb0d5e7a5cc3> 1100`.

### 4.8 E2E reference flow (`sdks/typescript/swap-vm/tests/swap-vm.spec.ts:135-217`)
```ts
const program = AquaXYCAmmStrategy.new().build()
const order = Order.new({ maker: new Address(maker), program, traits: MakerTraits.default() })
const strategyHash = order.hash().toString()                    // aqua mode → keccak256(order.encode())
await makerWallet.send(aqua.ship({ app: new Address(ROUTER), strategy: order.encode(), amountsAndTokens: [{amount: parseUnits('10000',6), token: USDC}, {amount: parseUnits('5',18), token: WETH}] }))
const swapParams = { order, amount: parseUnits('100',6), takerTraits: TakerTraits.default(), tokenIn: USDC, tokenOut: WETH }
const sim = await publicClient.call({ account: taker, ...swapVM.quote(swapParams) })
const [amountIn, amountOut, orderHash] = decodeFunctionResult({ abi: SWAP_VM_ABI, functionName: 'quote', data: sim.data! })
await takerWallet.send(swapVM.swap(swapParams))                 // taker pre-approved USDC to ROUTER
// then rawBalances(maker, ROUTER, strategyHash, USDC/WETH) moved by +amountIn / -amountOut
```
Test contracts used: `sdks/contracts/src/swap-vm/TestAquaSwapVMRouter.sol` (`AquaSwapVMRouterDebug(aqua, weth, owner, "TestAquaSwapVMRouter", "1.0")`), `TestCustomSwapVM.sol` (example of a **custom opcode set** in World A style: overrides `_opcodes()` returning `[_notInstruction, _xycSwapXD, _onlyAllowedTaker]` → opcodes 0 = xycSwap, 1 = onlyAllowedTaker(20-byte taker)), `TestMakerHooks.sol` (IMakerHooks emitting `HookCalled`).

### 4.9 Known SDK problems / gotchas (verified)
1. `jumpIfTokenIn/Out` coder emits `AddressHalf` (10 bytes) → deployed router reverts `ControlsMissingTokenArg()` (`0x6cac7aec`). Encode `address(20) ‖ uint16 nextPC` yourself (22 bytes) — probe with that layout executed correctly. Same 10-byte-tail scheme is used by `balances.BalancesArgs` (uint16 count ‖ 10-byte tails ‖ uint256 values) — only relevant to the undeployed `_allInstructions` set; treat as UNCERTAIN.
2. README says `Order.parse(...)`; the method is `Order.decode(HexString)`.
3. README lists `PROGRESSIVE_FEE_*` and `*_OUT` fee opcodes; they exist only in `_allInstructions` (and HEAD removed progressive fees entirely).
4. `MakerTraits.with()` / `TakerTraits.with()` mutate in place (not immutable).
5. `SwapVMContract` never sets `value` → no native-ETH-in path (deployed router accepts `msg.value` only when `tokenIn == WETH`; HEAD `SwapVM.sol:258`). Build the tx yourself if you need it.
6. `quote` ABI is `nonpayable` → use `simulateContract`/`call`, never `readContract` (viem type error / eth_call is what the contract expects anyway).
7. The e2e concentrated-range tests assert floating-point prices tied to a fork block; they can differ at the ~13th digit (AGENTS.md).

---

## 5. Deployed contract facts (World A) — from live probes 2026-09-05 via `https://ethereum-rpc.publicnode.com`
- Router `0x111111338c5091e8440b67b168bae16a668ac0de`: code 20,541 bytes; `eip712Domain()` = fields 0x0f, name `1inch SwapVM v1.0`, version `1.0.2`, chainId 1, verifyingContract itself. Selectors present: `44aa5f14 quote5`, `f4d2d412 swap5`, `f5d08521 hash`, `63fccba9 AQUA()`, `ceb9a5d8 asView()`, `84b0196e eip712Domain()`, `f973a209 ORDER_TYPEHASH()`; absent: 3-arg `quote/swap` (HEAD), `WETH()`.
- Opcode probes (signature-mode order, `quote` eth_call): `0x0d05<uint40 1>` → `DeadlineReached(address taker,uint256 deadline)` (`0x09e99adc`); `0x2114<USDC>` from an empty account → `TxOriginTokenBalanceIsZero(address,address)` (`0x39c4052c`); `0x0e14<USDC>` → `TakerTokenBalanceIsZero` (`0x9669f955`); opcode `0x22` → `Panic(0x32)` (table length 34); `0x0b0c<10-byte tail><pc>` → `ControlsMissingTokenArg()`; `0x0b16<20-byte addr><pc>` → executes. A program that runs to completion with zero Aqua balances reverts with selector `0x1a5af45f(uint256 0)` — UNCERTAIN name (be0a9cc's `TakerTraitsAmountOutMustBeGreaterThanZero(uint256)` hashes to `0xf6ab88ca`, so the deployed 1.0.2 renamed it).
- Aqua `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` on the same 16 chains (SDK constants + swap-vm README "Deployment").
- `swap-vm/broadcast/__DeployPadCreate.s.sol/<chainId>/run-*.json` document the CREATE-pad deployments (chains 1,10,56,100,130,137,146,324,4663,8453,42161,43114,59144); ignition params at HEAD (`ignition/parameters/chain-1.json`) say name `SwapVMRouter` / version `1.2.0` with placeholder aqua/owner — i.e. HEAD is prepared for a *future* 1.2.0 deployment, not the live 1.0.2.

---

## 6. Byte layouts we must reproduce (with exact bit positions)

### 6.1 Program bytecode (both worlds)
`program = Σ [uint8 opcode][uint8 argsLen][args…]`; HEAD `VM.sol:130-155` reads `opcode = word>>248`, `len = (word>>240)&0xff`, reverts `RunLoopExceedProgramLength` if `pc` overruns; deployed `runLoop` (be0a9cc `VM.sol:118-135`) does `ctx.vm.opcodes[opcode](ctx, args)` with unchecked slicing. Instructions that wrap the rest of the program (fees, decay, dynamic balances, invalidators) call `ctx.runLoop()` recursively → **order matters**: guards first, then fee/decay wrappers, then the curve, then salt. `Jump` targets are absolute byte offsets (`nextPC`, uint16). Args are big-endian, left-aligned (`InstructionArgs.at(shift).asUN()` = first N bytes of the 32-byte word at `shift`; bools = single bit read with `asBool(bit)` where bit 0 is the MSB of the byte: `encodeBool(v, bit) = v ? 128 >> bit : 0`, HEAD `InstructionBuilder.sol:31-34`). Max args 255 bytes.

### 6.2 MakerTraits / Order.data — World A (deployed) vs World B (HEAD)
| | World A (SDK, be0a9cc, deployed 1.0.2) | World B (HEAD `MakerTraits.sol`) |
|---|---|---|
| flags bits | 255..245 as in §4.2 | identical |
| slice offsets | bits 160..223, 4×uint16, cumulative from **0** | identical positions, cumulative from **40** (`index0 = 40 + …`) |
| receiver | bits 0..159 | identical |
| `order.data` | `hooks ‖ program` | `tokenA(20) ‖ tokenB(20) ‖ hooks ‖ program`, require `tokenA < tokenB` |
| hook slice | `[target(20) if hasTarget] ‖ data` | identical |
| `hash()` | `useAqua ? keccak256(abi.encode(order)) : EIP-712` | identical |
| Aqua-mode constraints | no `shouldUnwrapWeth`, receiver must be maker (`MakerTraitsUnwrapIsIncompatibleWithAqua`, `MakerTraitsCustomReceiverIsIncompatibleWithAqua`) | identical (`SwapVM.sol:261-262`) |
Solidity reference builders: HEAD `MakerTraitsLib.build(Args)` (`swap-vm/src/libs/MakerTraits.sol:109-171`, Args struct lines 79-103), old one at `swap-vm-be0a9cc/src/libs/MakerTraits.sol`.

### 6.3 TakerTraits — see §4.4; World B adds flags `0x0080 isAToB`, `0x0100 allowPartialFill` and the router no longer takes `tokenIn/tokenOut` args: `(tokenIn, tokenOut) = isAToB ? (tokenA, tokenB) : (tokenB, tokenA)` (`SwapVM.sol:135-136`). `allowPartialFill` relaxes `takerAmount == amountIn` to `>=` and pro-rates the threshold (`TakerTraits.sol:193-229`).

### 6.4 Instruction arg encodings — World B (HEAD `src/instructions/*.sol`, `@dev Encoding` comments) with the World-A/SDK equivalent
| HEAD opcode (byte) | args | SDK/World A equivalent |
|---|---|---|
| Stop 0x00 | [] | n/a |
| Revert 0x01 | [bytes4 exception] or [bytes] | n/a |
| Salt 0x02 | [uint64] or [bytes] | 0x14 uint64 ✔ |
| Jump 0x03 | [uint16 nextPC] | 0x0a ✔ |
| Extruction 0x04 | [address target, bytes] | 0x20 ✔ |
| Deadline 0x20 | [uint40] | 0x0d ✔ |
| OnlyTakerTokenBalanceNonZero 0x23 / OnlyTxOrigin… 0x26 | [address] | 0x0e / 0x21 ✔ |
| OnlyTakerTokenBalanceGte 0x24 | [address, uint256] | 0x0f ✔ |
| OnlyTakerTokenSupplyShareGte 0x25 | [address, uint64 share(1e18)] | 0x10 ✔ |
| PrivateOrder 0x2b | [uint80 allowedTaker (last 10 bytes)] | — |
| WhitelistCoequal 0x2c | [uint16 nextPC, uint80[] takers] | — |
| WhitelistSequential 0x2d | [uint40 start, uint16 nextPC, (uint16 duration, uint80 taker)[]] | — |
| JumpIfDirection 0x30 | [bool(bit0) direction(tokenIn<tokenOut), uint16 nextPC] | — |
| JumpIfTokenIn 0x31 / Out 0x32 | [address, uint16 nextPC] | 0x0b/0x0c (deployed reads address(20); SDK emits 10-byte tail ✘) |
| InvalidateBit 0x40 | [uint32 bitIndex] | — (all-set only) |
| InvalidateTokenIn 0x41 / Out 0x42 | [] | — |
| ValidateSeriesEpoch 0x48 | [uint32 seriesId, uint32 epoch] | — |
| XYCSwap 0x50 | [] | 0x11 ✔ |
| XYCConcentrateSwap 0x51 | [uint256 sqrtPriceMin, uint256 sqrtPriceMax] | 0x12 ✔ |
| LimitSwap 0x53 / LimitSwapFullAmount 0x54 | [bool(bit0) direction] | — |
| PeggedSwap 0x58 | [uint256 x0, y0, linearWidth, rateA, rateB] | 0x1f ✔ |
| FeeFlatIn 0x70 / FeeFlatOut 0x71 | [**uint24** feeBps, **BPS = 1e7**] | 0x15 = **uint32, 1e9** ✘ (different width & scale) |
| FeeProtocol 0x80 | [uint8 header(bit0 isTokenIn, low nibble count), (uint8 flags(bit0 isProvider, bit1 flat, bit2 surplus), address, uint24 feeBps?, uint24 surplusBps?)×count, uint216 surplusEstimate?] | 0x1b/0x1c/0x1d/0x1e (uint32+address / address) ✘ |
| StaticBalances 0x90 / DynamicBalances 0x91 | [uint256 balanceA, uint256 balanceB] (A = lower token address) | `_allInstructions` 17/18 with count+tails ✘ |
| DutchAuctionBalanceIn 0x94 / Out 0x95 | [uint40 start, uint16 duration, uint64 decay] | — |
| PiecewiseLinearScaleBalanceIn 0x98 / Out 0x99 | [uint40 ts, uint24 scales[k], uint16 durations[k-1]] | — |
| Decay 0x9c | [uint16 period] | 0x13 ✔ |
| TWAPSwap 0x9d | [6×uint256: balanceIn, balanceOut, startTime, duration, priceBumpAfterIlliquidity, minTradeAmountOut] | — |
| RequireMinRate 0xb0 / AdjustMinRate 0xb1 | [uint64 rateA, uint64 rateB] | — |
| OraclePriceAdjuster 0xb2 | [uint64 maxPriceDecay, uint16 maxStaleness, uint8 oracleDecimals, address oracle] | — |
| BaseFeeAdjuster 0xb4 | [uint64 baseGasPrice, uint96 ethPrice, uint24 gasAmount, uint64 maxDecay] | — |
| Debug 0x10–0x15, PatchSwapRegisters 0x1a | [] / [4×uint256] | only in `*Debug` routers |
Which opcodes a HEAD router accepts: `AquaOpcodes.sol:27-45` (Jump, JumpIfTokenIn/Out, Deadline, OnlyTaker*, XYCSwap, XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction, OnlyTxOrigin…), `Opcodes.sol:45-87` (everything), `LimitOpcodes.sol:34-60`. `Strategies.sol:46-53` whitelists "prefix" opcodes (guards/salt/epoch) for on-chain validated order templates.

---

## 7. World B (HEAD) specifics for a "modify SwapVM + redeploy" submission
- Router ctor (all three): `(address aqua, address weth, address owner, string name, string version)`; deploy with Hardhat 3 Ignition: `npx hardhat ignition deploy ignition/modules/AquaSwapVMRouter.ts --network <net> --parameters ignition/parameters/chain-<id>.json` (`DEPLOY.md`), or Foundry scripts in `script/`. Compiler 0.8.30, viaIR, runs 700 (`hardhat.config.ts:8-18`). Deps: `@1inch/aqua#v1.0.0`, `@1inch/solidity-utils 6.9.10`, OZ 5.4.0.
- Custom opcodes: add to `enum Opcode` (`src/libs/OpcodeList.sol`, take a free slot in the family bank; 0xf0-0xff reserved), write a library with `Opcode constant opcode`, `build()` (via `MemoryPtr.pushHeader/push/patchLength`), `parse()`, `exec(Context memory, bytes calldata)`, and add an `else if` branch in your `*Opcodes._runOpcode` (`AquaOpcodes.sol:27-45`); the router just overrides `_dispatch` → `_runOpcode` (`AquaSwapVMRouter.sol:26-28`).
- `Context` (`VM.sol:21-76`): `vm{isStaticContext, nextPC, programPtr, takerArgsPtr, dispatch}`, `query{orderHash, maker, taker, tokenIn, tokenOut, isExactIn}`, `swap{balanceIn, balanceOut, amountIn, amountOut}`, `fee{meta, receivers, feeTotal}`; `ctx.tryChopTakerArgs(n)` consumes taker `instructionsArgs`.
- Solidity-side TS-equivalent references for tests: `test/base/AquaStrategyBuilders.sol:74-123` (build program via `bytes.concat(FeeFlatIn.build(bps), XYCConcentrateSwap.build(sqrtMin, sqrtMax), Salt.build(bytes))`, then `MakerTraitsLib.build(Args{... tokenA, tokenB, useAquaInsteadOfSignature: true, program})`), `test/base/AquaSwapVMTest.sol:122-146` (taker data with `isAToB`), `:178-191` (`swapVM.asView().quote(order, amount, takerData)`), `test/helpers/AquaSwapVMHelper.sol`, `docs/PROGRAMS.md` (program catalog + ordering/invariant guidance), `TESTING.md`.
- Solidity `Salt.build(bytes)` allows arbitrary-length salt; `Salt.build(uint64)` = 8 bytes.

---

## 8. What we must write ourselves, and a `swapvm-ts` skeleton

Needed for a frontend regardless of world: viem wiring (approve → ship → quote → swap → dock), event decoding, balance reads, price/liquidity helpers (SDK has `Price/PriceRange/TokenReserve/PeggedSwapCalculator` for World A curves — reusable math). For World A additionally: fix `jumpIfToken*` (or avoid it). For World B: everything below (program assembler with banked opcodes, arg encoders incl. uint24 fees, MakerTraits with tokenA/tokenB prefix, TakerTraits with `isAToB/allowPartialFill`, 3-arg quote/swap ABI).

```ts
// swapvm-ts/bytes.ts — zero-dependency hex helpers (viem optional)
export type Hex = `0x${string}`
const strip = (h: string) => (h.startsWith('0x') ? h.slice(2) : h)
export const cat = (...parts: string[]): Hex => ('0x' + parts.map(strip).join('')) as Hex
export const byteLen = (h: string) => strip(h).length / 2
export const uN = (v: bigint | number, bytes: number): string => {
  const b = BigInt(v); if (b < 0n || b >= 1n << BigInt(8 * bytes)) throw new Error(`u${8 * bytes} overflow: ${b}`)
  return b.toString(16).padStart(bytes * 2, '0')          // big-endian, left-padded — matches InstructionArgs.asUN
}
export const addr = (a: string): string => { const s = strip(a).toLowerCase(); if (s.length !== 40) throw new Error(`bad address ${a}`); return s }
export const bool8 = (v: boolean, bit = 0): string => uN(v ? 128 >> bit : 0, 1)   // InstructionBuilder.encodeBool

// swapvm-ts/program.ts — [opcode][len][args] assembler, opcode table injected
export type Ix = { opcode: number; args: string }
export const ix = (opcode: number, args = ''): Ix => {
  const n = byteLen(args); if (opcode > 255 || n > 255) throw new Error('opcode/args out of range'); return { opcode, args: strip(args) }
}
export const assemble = (ixs: Ix[]): Hex => cat(...ixs.map(i => uN(i.opcode, 1) + uN(byteLen(i.args), 1) + i.args))
export const disassemble = (program: string): Ix[] => {
  const s = strip(program); const out: Ix[] = []; let p = 0
  while (p < s.length) { const op = parseInt(s.slice(p, p + 2), 16); const n = parseInt(s.slice(p + 2, p + 4), 16); out.push({ opcode: op, args: s.slice(p + 4, p + 4 + 2 * n) }); p += 4 + 2 * n }
  if (p !== s.length) throw new Error('truncated program'); return out
}
export const pcOf = (ixs: Ix[], i: number) => ixs.slice(0, i).reduce((a, x) => a + 2 + byteLen(x.args), 0)  // absolute nextPC for jumps

// Opcode tables. A = deployed AquaSwapVMRouter 1.0.2 (== @1inch/swap-vm-sdk aquaInstructions index). B = swap-vm HEAD OpcodeList.sol enum.
export const OP_A = { jump: 0x0a, jumpIfTokenIn: 0x0b, jumpIfTokenOut: 0x0c, deadline: 0x0d, onlyTakerTokenBalanceNonZero: 0x0e, onlyTakerTokenBalanceGte: 0x0f, onlyTakerTokenSupplyShareGte: 0x10, xycSwap: 0x11, xycConcentrate: 0x12, decay: 0x13, salt: 0x14, feeFlatIn: 0x15, protocolFeeIn: 0x1b, aquaProtocolFeeIn: 0x1c, dynamicProtocolFeeIn: 0x1d, aquaDynamicProtocolFeeIn: 0x1e, peggedSwap: 0x1f, extruction: 0x20, onlyTxOriginTokenBalanceNonZero: 0x21 } as const
export const OP_B = { stop: 0x00, revert: 0x01, salt: 0x02, jump: 0x03, extruction: 0x04, deadline: 0x20, onlyTakerTokenBalanceNonZero: 0x23, onlyTakerTokenBalanceGte: 0x24, onlyTakerTokenSupplyShareGte: 0x25, onlyTxOriginTokenBalanceNonZero: 0x26, privateOrder: 0x2b, whitelistCoequal: 0x2c, whitelistSequential: 0x2d, jumpIfDirection: 0x30, jumpIfTokenIn: 0x31, jumpIfTokenOut: 0x32, invalidateBit: 0x40, invalidateTokenIn: 0x41, invalidateTokenOut: 0x42, validateSeriesEpoch: 0x48, xycSwap: 0x50, xycConcentrate: 0x51, limitSwap: 0x53, limitSwapFullAmount: 0x54, peggedSwap: 0x58, feeFlatIn: 0x70, feeFlatOut: 0x71, feeProtocol: 0x80, staticBalances: 0x90, dynamicBalances: 0x91, dutchAuctionBalanceIn: 0x94, dutchAuctionBalanceOut: 0x95, decay: 0x9c, twapSwap: 0x9d, requireMinRate: 0xb0, adjustMinRate: 0xb1, oraclePriceAdjuster: 0xb2, baseFeeAdjuster: 0xb4 } as const

// swapvm-ts/instructions.ts — arg encoders (shared where identical; fee differs per world)
export const args = {
  jump: (nextPC: number) => uN(nextPC, 2),
  jumpIfToken: (token: string, nextPC: number) => addr(token) + uN(nextPC, 2),          // 22 bytes (deployed + HEAD)
  jumpIfDirection: (aToB: boolean, nextPC: number) => bool8(aToB) + uN(nextPC, 2),      // HEAD only
  deadline: (ts: bigint | number) => uN(ts, 5),
  onlyToken: (token: string) => addr(token),
  onlyTakerTokenBalanceGte: (token: string, min: bigint) => addr(token) + uN(min, 32),
  onlyTakerTokenSupplyShareGte: (token: string, shareE18: bigint) => addr(token) + uN(shareE18, 8),
  salt: (s: bigint) => uN(s, 8),
  xycConcentrate: (sqrtPriceMin: bigint, sqrtPriceMax: bigint) => uN(sqrtPriceMin, 32) + uN(sqrtPriceMax, 32),
  decay: (periodSec: number) => uN(periodSec, 2),
  balances: (balanceA: bigint, balanceB: bigint) => uN(balanceA, 32) + uN(balanceB, 32), // HEAD Static/DynamicBalances (A = lower address)
  limitSwap: (tokenIn: string, tokenOut: string) => bool8(BigInt(tokenIn) < BigInt(tokenOut)),   // HEAD
  pegged: (x0: bigint, y0: bigint, linearWidth: bigint, rateA: bigint, rateB: bigint) => [x0, y0, linearWidth, rateA, rateB].map(v => uN(v, 32)).join(''),
  extruction: (target: string, data: string) => addr(target) + strip(data),
  feeFlatA: (bps: number) => uN(Math.round(bps * 1e5), 4),          // deployed: uint32, 1e9 = 100 %
  feeFlatB: (bps: number) => uN(Math.round(bps * 1e3), 3),          // HEAD: uint24, 1e7 = 100 % (must be < 1e7)
  protocolFeeA: (bps: number, to: string) => uN(Math.round(bps * 1e5), 4) + addr(to),
  dutchAuction: (start: number, duration: number, decay: bigint) => uN(start, 5) + uN(duration, 2) + uN(decay, 8), // HEAD
  invalidateBit: (bit: number) => uN(bit, 4),                                                                        // HEAD
}
export const sqrtPriceE18 = (rawPriceE18: bigint) => bigintSqrt(rawPriceE18 * 10n ** 18n)  // P = tokenGt/tokenLt scaled 1e18
export function bigintSqrt(n: bigint): bigint { if (n < 2n) return n; let x = n, y = (n >> 1n) + 1n; while (y < x) { x = y; y = (y + n / y) >> 1n } return x }

// swapvm-ts/maker.ts — MakerTraits packing (World A: tokens undefined; World B: pass sorted [tokenA, tokenB])
export type Hook = { target?: string; data?: string }
export interface OrderInput { maker: string; program: string; receiver?: string; shouldUnwrapWeth?: boolean; useAquaInsteadOfSignature?: boolean; allowZeroAmountIn?: boolean; preTransferIn?: Hook; postTransferIn?: Hook; preTransferOut?: Hook; postTransferOut?: Hook; tokens?: [string, string] }
export function buildOrder(o: OrderInput): { maker: Hex; traits: bigint; data: Hex } {
  const hooks = [o.preTransferIn, o.postTransferIn, o.preTransferOut, o.postTransferOut]
  const hasTarget = hooks.map(h => !!h?.target && BigInt(h.target) !== 0n && addr(h.target) !== addr(o.maker))
  let traits = 0n
  const bit = (n: number, v?: boolean) => { if (v) traits |= 1n << BigInt(n) }
  bit(255, o.shouldUnwrapWeth); bit(254, o.useAquaInsteadOfSignature ?? true); bit(253, o.allowZeroAmountIn)
  hooks.forEach((h, i) => { bit(252 - i, !!h); bit(248 - i, hasTarget[i]) })
  let data = o.tokens ? addr(o.tokens[0]) + addr(o.tokens[1]) : ''
  if (o.tokens && BigInt(o.tokens[0]) >= BigInt(o.tokens[1])) throw new Error('tokens must be sorted tokenA < tokenB')
  let end = data.length / 2                              // 0 (World A) or 40 (World B)
  hooks.forEach((h, i) => { const slice = (hasTarget[i] ? addr(h!.target!) : '') + strip(h?.data ?? ''); data += slice; end += slice.length / 2; traits |= BigInt(end) << BigInt(160 + 16 * i) })
  if (o.receiver) traits |= BigInt(addr(o.receiver)) === 0n ? 0n : BigInt('0x' + addr(o.receiver))
  return { maker: ('0x' + addr(o.maker)) as Hex, traits, data: cat(data, o.program) }
}
// ABI encode + hash (viem)
import { encodeAbiParameters, keccak256, hashTypedData } from 'viem'
export const ORDER_ABI = [{ type: 'tuple', components: [{ name: 'maker', type: 'address' }, { name: 'traits', type: 'uint256' }, { name: 'data', type: 'bytes' }] }] as const
export const encodeOrder = (o: ReturnType<typeof buildOrder>) => encodeAbiParameters(ORDER_ABI, [o])   // = Aqua `strategy` bytes
export const orderHash = (o: ReturnType<typeof buildOrder>, domain?: { name: string; version: string; chainId: number; verifyingContract: Hex }) =>
  (o.traits >> 254n) & 1n ? keccak256(encodeOrder(o))
  : hashTypedData({ domain: domain!, primaryType: 'Order', types: { Order: [{ name: 'maker', type: 'address' }, { name: 'traits', type: 'uint256' }, { name: 'data', type: 'bytes' }] }, message: o })

// swapvm-ts/taker.ts — TakerTraits packing (World B flags optional)
export interface TakerInput { taker: string; isExactIn?: boolean; shouldUnwrapWeth?: boolean; isStrictThreshold?: boolean; isFirstTransferFromTaker?: boolean; useTransferFromAndAquaPush?: boolean; isAToB?: boolean; allowPartialFill?: boolean; threshold?: bigint; to?: string; deadline?: number; preTransferInHookData?: string; postTransferInHookData?: string; preTransferOutHookData?: string; postTransferOutHookData?: string; preTransferInCallbackData?: string; preTransferOutCallbackData?: string; instructionsArgs?: string; signature?: string }
export function buildTakerData(t: TakerInput): Hex {
  const to = t.to && BigInt(t.to) !== 0n && addr(t.to) !== addr(t.taker) ? addr(t.to) : ''
  const slices = [t.threshold ? uN(t.threshold, 32) : '', to, t.deadline ? uN(t.deadline, 5) : '', t.preTransferInHookData, t.postTransferInHookData, t.preTransferOutHookData, t.postTransferOutHookData, t.preTransferInCallbackData, t.preTransferOutCallbackData, t.instructionsArgs].map(s => strip(s ?? ''))
  const ends: number[] = []; let sum = 0; for (const s of slices) { sum += s.length / 2; ends.push(sum) }
  let flags = 0
  if (t.isExactIn ?? true) flags |= 0x1; if (t.shouldUnwrapWeth) flags |= 0x2
  if (t.preTransferInCallbackData) flags |= 0x4; if (t.preTransferOutCallbackData) flags |= 0x8
  if (t.isStrictThreshold) flags |= 0x10; if (t.isFirstTransferFromTaker) flags |= 0x20; if (t.useTransferFromAndAquaPush ?? true) flags |= 0x40
  if (t.isAToB) flags |= 0x80; if (t.allowPartialFill) flags |= 0x100                         // HEAD only — must be 0 for the deployed router
  return cat(...ends.slice().reverse().map(e => uN(e, 2)), uN(flags, 2), ...slices, strip(t.signature ?? ''))
}
// Sanity vectors: buildTakerData({taker}) === '0x00000000000000000000000000000000000000000041';
// buildTakerData({taker, threshold:123456n, deadline:1800000000}) === '0x00250025002500250025002500250025002000200041' + '0'.repeat(58)+'01e240' + '006b49d200'

// swapvm-ts/client.ts — viem calls (World A ABI; for World B drop tokenIn/tokenOut and set isAToB)
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
export const SWAPVM_A = parseAbi([
  'function quote((address maker,uint256 traits,bytes data) order,address tokenIn,address tokenOut,uint256 amount,bytes takerTraitsAndData) returns (uint256 amountIn,uint256 amountOut,bytes32 orderHash)',
  'function swap((address maker,uint256 traits,bytes data) order,address tokenIn,address tokenOut,uint256 amount,bytes takerTraitsAndData) payable returns (uint256 amountIn,uint256 amountOut,bytes32 orderHash)',
  'function hash((address maker,uint256 traits,bytes data) order) view returns (bytes32)',
  'event Swapped(bytes32 orderHash,address maker,address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut)'])
export const SWAPVM_B = parseAbi([
  'function quote((address maker,uint256 traits,bytes data) order,uint256 amount,bytes takerTraitsAndData) returns (uint256 amountIn,uint256 amountOut,bytes32 orderHash)',
  'function swap((address maker,uint256 traits,bytes data) order,uint256 amount,bytes takerTraitsAndData) payable returns (uint256 amountIn,uint256 amountOut,bytes32 orderHash)',
  'function hash((address maker,uint256 traits,bytes data) order) view returns (bytes32)'])
export const AQUA = parseAbi([
  'function ship(address app,bytes strategy,address[] tokens,uint256[] amounts) returns (bytes32)',
  'function dock(address app,bytes32 strategyHash,address[] tokens)',
  'function rawBalances(address maker,address app,bytes32 strategyHash,address token) view returns (uint248 balance,uint8 tokensCount)',
  'function safeBalances(address maker,address app,bytes32 strategyHash,address token0,address token1) view returns (uint256,uint256)',
  'event Shipped(address maker,address app,bytes32 strategyHash,bytes strategy)', 'event Docked(address maker,address app,bytes32 strategyHash)',
  'event Pushed(address maker,address app,bytes32 strategyHash,address token,uint256 amount)', 'event Pulled(address maker,address app,bytes32 strategyHash,address token,uint256 amount)'])
export async function quoteA(pc: ReturnType<typeof createPublicClient>, router: Hex, order: ReturnType<typeof buildOrder>, tokenIn: Hex, tokenOut: Hex, amount: bigint, takerData: Hex, taker: Hex) {
  const { result } = await pc.simulateContract({ address: router, abi: SWAPVM_A, functionName: 'quote', args: [order, tokenIn, tokenOut, amount, takerData], account: taker })
  return { amountIn: result[0], amountOut: result[1], orderHash: result[2] }
}
export const swapA = (wc: ReturnType<typeof createWalletClient>, router: Hex, order: ReturnType<typeof buildOrder>, tokenIn: Hex, tokenOut: Hex, amount: bigint, takerData: Hex, value = 0n) =>
  wc.writeContract({ address: router, abi: SWAPVM_A, functionName: 'swap', args: [order, tokenIn, tokenOut, amount, takerData], value } as any)
// Maker: approve(token → AQUA) for each token, then aqua.ship(router, encodeOrder(order), tokens, amounts); strategyHash = keccak256(encodeOrder(order)) = router.hash(order)
// Taker (default flags): approve(tokenIn → router), quote, then swap with the same takerData; parse `Swapped` + `Pushed/Pulled` from the receipt with viem parseEventLogs.
// Balances: rawBalances(maker, router, strategyHash, token) after each swap; dock(router, strategyHash, [tokenA, tokenB]) to close.
```
Validation: the skeleton above was executed (`refs/npm/sdk-try/skel.cjs`) and matches `@1inch/swap-vm-sdk@0.4.1` byte-for-byte for: both program vectors, `MakerTraits`+`Order` (default and with hooks incl. a targeted hook: data `0xaaaa‖0000…0002‖bbbb‖feedface`), `Order.hash`, and three `TakerTraits` cases (default; threshold+deadline; custom `to`+instructionsArgs+signature = `0x0016 0014×8 0000 0041 ‖ 00…02 ‖ 0102 ‖ ff`). Note: `Interaction` is exported from `@1inch/sdk-core`, not re-exported by `@1inch/swap-vm-sdk`.
Example World-A program with the skeleton (equals the SDK vector): `assemble([ix(OP_A.decay, args.decay(600)), ix(OP_A.feeFlatIn, args.feeFlatA(30)), ix(OP_A.xycSwap), ix(OP_A.salt, args.salt(12345n))]) === '0x130202581504002dc6c0110014080000000000003039'`. Same strategy for HEAD: `assemble([ix(OP_B.decay, args.decay(600)), ix(OP_B.feeFlatIn, args.feeFlatB(30)), ix(OP_B.xycSwap), ix(OP_B.salt, args.salt(12345n))])` = `0x9c0202587003007530500002080000000000003039`, and `buildOrder({..., tokens:[USDC, WETH] /* sorted */})`, `buildTakerData({taker, isAToB: tokenIn === tokenA})`, `SWAPVM_B` 3-arg calls.

---

## 9. Open questions / uncertainties
- UNCERTAIN which exact swap-vm commit the deployed 1.0.2 router was built from (SDK comment points at `fcca73f`; be0a9cc lacks opcode 33 which the deployed contract has). Selector/opcode-table probes confirm the World-A layout regardless.
- UNCERTAIN whether the `0x1a5af45f(uint256)` revert seen after zero-balance runs is a renamed `TakerTraitsAmountOutMustBeGreaterThanZero`; irrelevant for encoding.
- The SDK `aquaInstructions` list is authoritative for runtime-available opcodes on today's deployments; `_allInstructions` (RegularProgramBuilder) has no deployed target — do not ship programs built with it to `0x1111…c0de`.
- HEAD (World B) has no released version/deployment; if we redeploy it we own the TS encoder and must keep it in sync with our modified `OpcodeList.sol`/`_runOpcode`.
- `Salt` at HEAD may be arbitrary bytes; SDK only supports uint64 — fine either way for hashing uniqueness.
- Native ETH input (`msg.value` with `tokenIn == WETH`) exists in both worlds but is not exposed by the SDK builders.
