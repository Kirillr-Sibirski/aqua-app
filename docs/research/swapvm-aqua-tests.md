# SwapVM x Aqua — how the official tests wire an Aqua-backed SwapVM order

Knowledge base distilled from `1inch/swap-vm` tests (`test/*Aqua*.t.sol`, `test/base/*`, `test/mocks/*`, `test/helpers/*`) and the source they exercise. Written for engineers who have NOT read the repo.

Sources (local clone): `swap-vm` (abbreviated `swap-vm/` below).

- swap-vm commit: `f09a41e689240adc645934f965c8061749397cd2` (2026-09-03, "Merge pull request #180 from 1inch/feature/remove-progressive-fees"), package `@1inch/swap-vm@0.0.6`
- Aqua dependency: `@1inch/aqua` resolved from `github:1inch/aqua#v1.0.0` (`package.json` says `"version": "0.1.0"` inside node_modules — the tag is v1.0.0)
- Other deps: `@1inch/solidity-utils@6.9.10`, `@openzeppelin/contracts@5.4.0`, `forge-std v1.11.0`
- Compiler: solc `0.8.30`, `via_ir = true`, `optimizer_runs = 700` (`foundry.toml`)
- Remappings (`remappings.txt`): `forge-std/=node_modules/forge-std/src/`, `@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/`, `@1inch/solidity-utils/=node_modules/@1inch/solidity-utils/`, `@1inch/aqua/=node_modules/@1inch/aqua/`
- Upstream: https://github.com/1inch/swap-vm , https://github.com/1inch/aqua
- Mainnet/L2 deployments (from task context, not from repo): Aqua `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`, SwapVM router `0x111111338c5091e8440b67b168bae16a668ac0de` (Ethereum, Base, Arbitrum, Optimism, Polygon, ...). The repo's `config/constants.json` only has a zero placeholder for chain 31337.

---

## 0. TL;DR recipe (what every Aqua test does)

```
1. aqua   = new Aqua();                                                    // or use deployed registry on a fork
2. router = new AquaSwapVMRouter(address(aqua), weth /*or 0*/, owner, "SwapVM", "1.0.0");
3. tokenA, tokenB = two ERC20s, SORTED so address(tokenA) < address(tokenB)
4. program = bytes.concat(XYCSwap.build(), Salt.build(<unique>));         // maybe FeeProtocol/FeeFlatIn before XYCSwap
5. order   = MakerTraitsLib.build(Args{ maker, tokenA, tokenB, useAquaInsteadOfSignature: true, receiver: 0, shouldUnwrapWeth: false, program, ... });
6. maker: tokenA.approve(aqua, max); tokenB.approve(aqua, max); AND HOLD the real tokens in the wallet
7. maker: strategyHash = aqua.ship(address(router), abi.encode(order), [tokenA, tokenB], [balA, balB]);
          // strategyHash == keccak256(abi.encode(order)) == router.hash(order)
8. taker: takerData = TakerTraitsLib.build(Args{ taker, isExactIn, isAToB, signature: "", useTransferFromAndAquaPush: true (EOA) | hasPreTransferInCallback: true (contract), ... })
          router.swap(order, amount, takerData)         // or router.asView().quote(order, amount, takerData)
9. assert: aqua.safeBalances(maker, address(router), strategyHash, tokenA, tokenB) moved by (amountIn, -amountOut) [minus protocol fee on tokenIn]
```

Key mental model: **Aqua never holds tokens.** `Aqua.ship()` only records per-(maker, app, strategyHash, token) virtual balances. Tokens stay in the maker's wallet and move via `Aqua.pull()` (= `transferFrom(maker, to)`) and `Aqua.push()` (= `transferFrom(msg.sender, maker)`). So the maker needs both an ERC20 approval to Aqua and the actual token balance in the wallet at swap time.

---

## 1. Contract signatures you will call

### 1.1 Aqua (`node_modules/@1inch/aqua/src/Aqua.sol`)

```solidity
contract Aqua is IAqua {
    // Aqua.sol:21-24  storage: _balances[maker][app][strategyHash][token] -> Balance{uint248 amount, uint8 tokensCount}
    function rawBalances(address maker, address app, bytes32 strategyHash, address token)
        external view returns (uint248 balance, uint8 tokensCount);                       // :26
    function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1)
        external view returns (uint256 balance0, uint256 balance1);                       // :30, REVERTS if token not in active strategy
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external returns (bytes32 strategyHash);                                          // :40  strategyHash = keccak256(strategy)
    function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;  // :54  closes ALL tokens, marks 0xff
    function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external; // :63  msg.sender == app
    function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount) external; // :72  transferFrom(msg.sender -> maker)
}
```

Details that matter:
- `ship` (`Aqua.sol:40-52`): `strategyHash = keccak256(strategy)`; `tokens.length` must be `< 255` (`_DOCKED = 0xff`); reverts `StrategiesMustBeImmutable` if any `(maker, app, hash, token)` slot already has `tokensCount != 0`; stores `amounts[i].toUint248()` (so max balance is `type(uint248).max`); emits `Shipped(maker, app, strategyHash, strategy)` and one `Pushed` per token. **No token transfer.**
- `pull` (`:63-70`): only decrements `_balances[maker][msg.sender][hash][token]` (underflow revert if insufficient) then `IERC20(token).safeTransferFrom(maker, to, amount)`. The app (router) is `msg.sender`.
- `push` (`:72-80`): requires strategy active (`tokensCount > 0 && != 0xff`, else `PushToNonActiveStrategyPrevented`), increments balance, `safeTransferFrom(msg.sender, maker, amount)`. Anyone can push (the caller pays).
- `safeBalances` (`:30-38`) reverts with `SafeBalancesForTokenNotInActiveStrategy` if either token was never shipped or the strategy was docked. SwapVM calls this at the start of every `swap`/`quote` in Aqua mode.

### 1.2 SwapVM / AquaSwapVMRouter (`swap-vm/src/SwapVM.sol`, `src/routers/AquaSwapVMRouter.sol`)

```solidity
// src/routers/AquaSwapVMRouter.sol:16-23
contract AquaSwapVMRouter is Simulator, SwapVM, AquaOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version) { }
}

// src/SwapVM.sol
abstract contract SwapVM is EIP712, OnlyWethReceiver, Rescuable {
    error BadSignature(address maker, bytes32 orderHash, bytes signature);                       // :40
    error AquaBalanceInsufficientAfterTakerPush(uint256 balance, uint256 preBalance, uint256 amount); // :42  (3 params!)
    error MakerTraitsUnwrapIsIncompatibleWithAqua();                                             // :44
    error MakerTraitsCustomReceiverIsIncompatibleWithAqua();                                     // :46
    error MsgValueInvalidToken(); error NotEnoughMsgValueAttached(); error UnexpectedMsgValue(); error EthTransferFailed(); // :48-54
    event Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut); // :64

    IAqua public immutable AQUA;   // :84
    IWETH public immutable WETH;   // :85

    function asView() external view returns (ISwapVM);                                   // :102  just casts address(this)
    function hash(ISwapVM.Order calldata order) public view returns (bytes32);            // :109
    function quote(ISwapVM.Order calldata order, uint256 amount, bytes calldata takerTraitsAndData)
        external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);        // :123  (non-view in impl; ISwapVM declares it view)
    function swap(ISwapVM.Order calldata order, uint256 amount, bytes calldata takerTraitsAndData)
        external payable returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash); // :176
}
```

`hash()` (`SwapVM.sol:109-120`):
```solidity
if (order.traits.useAquaInsteadOfSignature()) return keccak256(abi.encode(order));   // Aqua mode
return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, order.maker, order.traits, keccak256(order.data)))); // signature mode
```
=> In Aqua mode the SwapVM orderHash and the Aqua strategyHash are the same value **iff** the bytes shipped are exactly `abi.encode(order)`.

The opcode set available in `AquaSwapVMRouter` (`src/opcodes/AquaOpcodes.sol:27-45`): `Jump, JumpIfTokenIn, JumpIfTokenOut, Deadline, OnlyTakerTokenBalanceNonZero, OnlyTakerTokenBalanceGte, OnlyTakerTokenSupplyShareGte, XYCSwap, XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction, OnlyTxOriginTokenBalanceNonZero`. NOT included: `StaticBalances/DynamicBalances` (Aqua supplies balances), `LimitSwap`, `FeeFlatOut`, `TWAP`, `DutchAuction`, invalidators, whitelists, `Stop`, `Revert`. `AquaOpcodesDebug` adds `Print*`/`PatchSwapRegisters` (used by tests only). Opcode numbers: `XYCSwap=0x50`, `XYCConcentrateSwap=0x51`, `PeggedSwap=0x58`, `FeeFlatIn=0x70`, `FeeProtocol=0x80`, `Salt=0x02`, `Deadline=0x20`, `Decay=0x9c`, `Extruction=0x04` (`src/libs/OpcodeList.sol`).

Program bytecode format (`src/libs/VM.sol:125-158`): sequence of `[uint8 opcode][uint8 argsLength][args...]`.

### 1.3 Order struct and maker traits (`src/interfaces/ISwapVM.sol:17-21`, `src/libs/MakerTraits.sol`)

```solidity
struct Order { address maker; MakerTraits traits; bytes data; }   // MakerTraits is `type MakerTraits is uint256`
```

`MakerTraitsLib.Args` (`MakerTraits.sol:79-103`) — all fields required:
```solidity
struct Args {
    address maker; address receiver;                       // receiver: address(0) => maker; MUST be 0/maker in Aqua mode
    address tokenA; address tokenB;                        // REQUIRE tokenA < tokenB  (MakerTraitsTokensNotSorted)
    bool shouldUnwrapWeth;                                 // MUST be false in Aqua mode
    bool useAquaInsteadOfSignature;                        // TRUE for Aqua mode (bit 254)
    bool allowZeroAmountIn;
    bool hasPreTransferInHook; bool hasPostTransferInHook; bool hasPreTransferOutHook; bool hasPostTransferOutHook;
    address preTransferInTarget;  bytes preTransferInData;
    address postTransferInTarget; bytes postTransferInData;
    address preTransferOutTarget; bytes preTransferOutData;
    address postTransferOutTarget; bytes postTransferOutData;
    bytes program;                                         // VM bytecode
}
function build(Args memory args) internal pure returns (ISwapVM.Order memory order);   // :109
```
`order.data` layout = `tokenA(20) | tokenB(20) | [hook target 20?][hook data]... | program` (`:158-169`); `order.traits` packs flags in bits 255..245, four uint16 slice indexes at bit 160, and `receiver` in the low 160 bits (`:143-157`).

### 1.4 Taker traits (`src/libs/TakerTraits.sol`)

`TakerTraitsLib.Args` (`:58-81`):
```solidity
struct Args {
    address taker; bool isExactIn; bool shouldUnwrapWeth; bool isStrictThresholdAmount;
    bool isFirstTransferFromTaker; bool useTransferFromAndAquaPush; bool isAToB; bool allowPartialFill;
    bytes threshold;          // "" or exactly 32 bytes (minOut if exactIn, maxIn if exactOut)
    address to;               // address(0) or == taker => tokens go to taker
    uint40 deadline;          // 0 = none
    bool hasPreTransferInCallback; bool hasPreTransferOutCallback;
    bytes preTransferInHookData; bytes postTransferInHookData; bytes preTransferOutHookData; bytes postTransferOutHookData;
    bytes preTransferInCallbackData; bytes preTransferOutCallbackData;
    bytes instructionsArgs;   // dynamic args consumed by opcodes (tryChopTakerArgs)
    bytes signature;          // maker EIP-712 sig; EMPTY in Aqua mode
}
function build(Args memory args) internal pure returns (bytes memory packed);   // :115
function parse(bytes calldata data) internal pure returns (TakerTraits traits, bytes calldata tail); // :182, header is 22 bytes
```
Packed layout (`:136-174`): `10 x uint16 slice indexes (20 bytes) | uint16 flags | threshold | to(20?) | deadline(5?) | hook datas | callback datas | instructionsArgs | signature`. Flags (`:101-109`): `IS_EXACT_IN=0x0001, SHOULD_UNWRAP=0x0002, HAS_PRE_TRANSFER_IN_CALLBACK=0x0004, HAS_PRE_TRANSFER_OUT_CALLBACK=0x0008, IS_STRICT_THRESHOLD=0x0010, IS_FIRST_TRANSFER_FROM_TAKER=0x0020, USE_TRANSFER_FROM_AND_AQUA_PUSH=0x0040, IS_A_TO_B=0x0080, ALLOW_PARTIAL_FILL=0x0100`.

`isAToB` semantics (`SwapVM.sol:189-190`): `isAToB=true` => `tokenIn = tokenA (lower address)`, `tokenOut = tokenB`; `false` => `tokenIn = tokenB`. Tests call this `zeroForOne`.

`validate` (`:187-230`): `amountOut > 0` (else `TakerTraitsAmountOutMustBeGreaterThanZero(amountOut)`), deadline, and for exactIn without partial fill `takerAmount == amountIn` (`TakerTraitsTakerAmountInMismatch`); for exactOut `takerAmount == amountOut`.

### 1.5 Taker callbacks (`src/interfaces/ITakerCallbacks.sol`)

```solidity
interface ITakerCallbacks {
    function preTransferInCallback (address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, bytes32 orderHash, bytes calldata takerData) external; // :20
    function preTransferOutCallback(address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, bytes32 orderHash, bytes calldata takerData) external; // :40
}
```
Called on `ctx.query.taker` (= the `taker` address in TakerTraits), NOT on `msg.sender` (`SwapVM.sol:254`, `:334`). In the tests `taker` is always a contract that owns the tokens and calls `router.swap` itself.

---

## 2. The official test harness, line by line

### 2.1 `test/base/AquaStrategyBuilders.sol` (abstract, `is TestConstants, Test, AquaOpcodesDebug`)

```solidity
Aqua public immutable aqua = new Aqua();                       // :55  Aqua deployed at contract construction
TokenMock public tokenA; TokenMock public tokenB;              // :57-58
address public maker; uint256 public makerPrivateKey;          // :60-61

function setUp() public virtual {                              // :63-72
    makerPrivateKey = 0x1234; maker = vm.addr(makerPrivateKey);
    tokenA = new TokenMock("Token I", "TKI"); tokenB = new TokenMock("Token J", "TKJ");
    if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);  // sort by address
}
```

`buildProgram(MakerSetup)` (`:74-96`): `[FeeProtocol(protocolFeeBps -> protocolFeeRecipient)]? [FeeFlatIn(feeInBps)]? (XYCConcentrateSwap(sqrtPmin, sqrtPmax) | XYCSwap) Salt(random)` — i.e.
```solidity
bytes.concat(
    setup.protocolFeeBps > 0 ? FeeBuilders.protocolFeeIn(setup.protocolFeeBps, setup.protocolFeeRecipient) : bytes(""),
    setup.feeInBps > 0 ? FeeFlatIn.build(setup.feeInBps) : bytes(""),
    swapProgram,                                        // XYCSwap.build() or XYCConcentrateSwap.build(sqrtPmin, sqrtPmax)
    Salt.build(abi.encodePacked(vm.randomUint()))       // unique hash per test
);
```
(Concentrate: `sqrtP = Math.sqrt(price1e18 * 1e18)` (`:81-83`).)

`createStrategy(bytes program)` (`:98-123`): `MakerTraitsLib.build` with `maker, tokenA, tokenB, useAquaInsteadOfSignature: true`, everything else false/zero/empty. Returns `ISwapVM.Order memory`.

**`shipStrategy` — THE answer to "what bytes are passed as strategy"** (`:131-158`):
```solidity
function shipStrategy(SwapVM swapVM, ISwapVM.Order memory order, TokenMock tokenIn, TokenMock tokenOut, uint256 balanceIn, uint256 balanceOut) public returns (bytes32) {
    bytes32 orderHash = swapVM.hash(order);

    vm.prank(maker); tokenIn.approve(address(aqua), type(uint256).max);
    vm.prank(maker); tokenOut.approve(address(aqua), type(uint256).max);

    bytes memory strategy = abi.encode(order);                 // <-- ABI-encoded ISwapVM.Order struct

    vm.prank(maker);
    bytes32 strategyHash = aqua.ship(
        address(swapVM),                                       // app = the router
        strategy,
        dynamic([address(tokenIn), address(tokenOut)]),        // test/utils/Dynamic.sol: fixed -> dynamic array
        dynamic([balanceIn, balanceOut])
    );
    vm.assume(strategyHash == orderHash);                      // keccak256(abi.encode(order)) == swapVM.hash(order)
    return strategyHash;
}
```
`AquaAccounting.t.sol:307-328` does the same but with `assertEq(strategyHash, orderHash, "Strategy hash mismatch")` and additionally mints `INITIAL_BALANCE_A/B` to the maker wallet inside `shipStrategy`.

Note: nothing forces `tokens[]` order in `ship` to match `tokenA<tokenB`; the router reads balances by token address via `safeBalances(maker, app, hash, tokenIn, tokenOut)`. But you must ship BOTH tokens or `safeBalances` reverts.

### 2.2 `test/base/AquaSwapVMTest.sol` (`is AquaStrategyBuilders`)

```solidity
struct SwapProgram { uint256 amount; MockTaker taker; TokenMock tokenA; TokenMock tokenB; bool zeroForOne; bool isExactIn; } // :22-29
SwapVM public swapVM; MockTaker public taker; MockTaker public taker2; address public protocolFeeRecipient;

function setUp() public override virtual {                                          // :38-47
    super.setUp();
    swapVM = _deployRouter();                                                       // new AquaSwapVMRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0")  (:50)
    taker  = new MockTaker(aqua, swapVM, address(this));
    taker2 = new MockTaker(aqua, swapVM, address(this));
    protocolFeeRecipient = vm.addr(0x8888);
}
```
Helpers:
- `getAquaBalances(strategyHash)` (`:79-83`) = `aqua.safeBalances(maker, address(swapVM), strategyHash, address(tokenA), address(tokenB))`.
- `getTakerBalances(taker)` = ERC20 `balanceOf(taker)` for A and B.
- `mintTokenInToTaker(swapProgram[, amount])` mints tokenIn to the taker contract; `mintTokenOutToMaker(swapProgram, amountOut)` mints tokenOut to the **maker wallet** (needed because `Aqua.pull` does `transferFrom(maker)`); `mintTokenInToMaker` used in protocol-fee tests.
- `takerData(taker, isExactIn, isAToB)` (`:122-146`) — the canonical Aqua taker traits in tests:
```solidity
TakerTraitsLib.build(TakerTraitsLib.Args({
    taker: takerAddress, isExactIn: isExactIn, shouldUnwrapWeth: false,
    hasPreTransferInCallback: true,          // taker contract pushes in callback
    hasPreTransferOutCallback: false, isStrictThresholdAmount: false,
    isFirstTransferFromTaker: false, useTransferFromAndAquaPush: false,
    isAToB: isAToB, allowPartialFill: false,
    threshold: "", to: address(0), deadline: 0,
    preTransferInHookData: "", postTransferInHookData: "", preTransferOutHookData: "", postTransferOutHookData: "",
    preTransferInCallbackData: "", preTransferOutCallbackData: "", instructionsArgs: "",
    signature: ""                            // EMPTY signature in Aqua mode
}));
```
- `swap(swapProgram, order)` (`:165-176`): `swapProgram.taker.swap(order, swapProgram.amount, abi.encodePacked(takerData(...)))` (the `abi.encodePacked` is a no-op wrapper).
- **`quote` via `asView()`** (`:178-191`):
```solidity
(uint256 amountIn, uint256 amountOut,) = swapVM.asView().quote(order, swapProgram.amount, sigAndTakerData);
```
`asView()` returns `ISwapVM(address(this))`; since `ISwapVM.quote` is declared `view`, Solidity emits a STATICCALL. `SwapVM.quote` itself is not `view` (it runs the VM with `isStaticContext: true`), so calling it directly from a `view` test function fails to compile — hence the cast. `quote` also reads `AQUA.safeBalances` (`SwapVM.sol:167-169`) so it reflects the live Aqua balances.
- `tradeToZeroBalance(order, token)` (`:193-223`): reads `aqua.rawBalances(...)`, quotes an exactOut for the full balance, mints, swaps.

### 2.3 `test/mocks/MockTaker.sol` — the Aqua taker used everywhere

```solidity
contract MockTaker is ITakerCallbacks {
    Aqua public immutable AQUA; SwapVM public immutable SWAPVM; address public immutable owner;
    constructor(Aqua aqua, SwapVM swapVM, address owner_)                                   // :28
    function swap(ISwapVM.Order calldata order, uint256 amount, bytes calldata takerTraitsAndData)
        public onlyOwner returns (uint256 amountIn, uint256 amountOut) { (amountIn, amountOut,) = SWAPVM.swap(order, amount, takerTraitsAndData); } // :34-44
    function preTransferInCallback(address maker, address, address tokenIn, address, uint256 amountIn, uint256, bytes32 orderHash, bytes calldata) public virtual onlySwapVM {
        ERC20(tokenIn).approve(address(AQUA), amountIn);
        AQUA.push(maker, address(SWAPVM), orderHash, tokenIn, amountIn);                    // :56-57  taker pays maker, credits strategy
    }
    function preTransferOutCallback(...) public virtual onlySwapVM { }                     // :60-71 no-op
}
```
Variants: `MockTakerFirstTransfer` (`test/mocks/MockTakerFirstTransfer.sol`) additionally `ERC20(tokenOut).transfer(maker, amountOut)` in the callback to prove ordering with `isFirstTransferFromTaker=true`; `MockTakerBrokenCallback` (`test/mocks/MockTakerBrokenCallback.sol`) has `enum CallbackBehavior { Normal, NoPush, InsufficientPush, WrongOrderHash, WrongToken }` + `setBehavior`, `setPushAmountOverride`.

Other helpers: `test/helpers/AquaSwapVMHelper.sol` (deploys its own `AquaSwapVMRouter(aqua, 0, this, "SwapVM", "1.0.0")` and `createOrder(maker, tokenA, tokenB)` = `XYCSwap + Salt(uint64(keccak(block.timestamp)))`, Aqua mode); `test/helpers/DirectSwapVMHelper.sol` (signature mode, `StaticBalances + LimitSwap`); `test/helpers/DirectModeTaker.sol` (no-op callbacks); `test/utils/Dynamic.sol` (`dynamic([..])` overloads for `uint24/uint16/uint256/address` fixed arrays of length 1-8/1-5); `test/utils/FeeBuilders.sol` (`protocolFeeIn(feeBps, receiver)` = `FeeProtocol.build(true, [ReceiverConfig{receiver, feeBps, 0}], [], 0)`; also `protocolFeeOut`, `protocolSurplusIn/Out`, `protocolProviderIn/Out`); `test/utils/OrderHasher.sol` (EIP-712 typed data for signature mode); `test/base/TestConstants.sol` (`ONE=1e18, INITIAL_BALANCE_A=1000e18, INITIAL_BALANCE_B=2000e18, DUST_AMOUNT=1, SMALL=1e6, MEDIUM=1e18, LARGE=1000e18, MAX_REASONABLE_AMOUNT/BALANCE=type(uint128).max, MAX_AQUA_AMOUNT=type(uint248).max, OVERFLOW_AMOUNT=type(uint256).max`).

`TokenMock` (`@1inch/solidity-utils/contracts/mocks/TokenMock.sol`): `constructor(name, symbol)`, `mint(address,uint256) onlyOwner`, `burn(address,uint256) onlyOwner`; owner = deployer (the test contract).

---

## 3. Swap execution flow in Aqua mode (`SwapVM.sol:176-243`)

```
swap(order, amount, takerTraitsAndData):
  orderHash = hash(order)                                     // keccak256(abi.encode(order))
  _reentrancyGuards[orderHash].lock()                         // transient lock per order
  (takerTraits, takerData) = TakerTraitsLib.parse(...)
  tokenIn/tokenOut from order.data by isAToB
  ctx.swap = {balanceIn:0, balanceOut:0, amountIn: isExactIn?amount:0, amountOut: isExactIn?0:amount}
  if useAquaInsteadOfSignature:
      (ctx.swap.balanceIn, ctx.swap.balanceOut) = AQUA.safeBalances(order.maker, address(this), orderHash, tokenIn, tokenOut)   // :222
  else: verify signature (BadSignature)
  originalAquaBalanceIn = ctx.swap.balanceIn                  // :228
  (amountIn, amountOut) = ctx.runLoop()                       // executes program (XYCSwap etc.)
  order.traits.validate(amountIn); takerTraits.validate(takerData, amount, amountIn, amountOut)
  if isFirstTransferFromTaker: _transferIn; _transferOut      // :233-235
  else:                        _transferOut; _transferIn      // :237-238  (DEFAULT: maker pays first)
  unlock; emit Swapped(...)
```

`_transferOut` (`:325-348`) in Aqua mode:
1. maker preTransferOut hook (if any); taker `preTransferOutCallback` (if flag).
2. `fee = FeeMetaLib.resolveOutAquaPullMaker(ctx.fee, tokenOut, amountOut, AQUA, maker, orderHash)` — protocol fee in tokenOut, each receiver gets `AQUA.pull(maker, orderHash, tokenOut, fee_i, receiver_i)` (`ProtocolFee.sol:177-205`).
3. `AQUA.pull(order.maker, orderHash, tokenOut, amountOut, to)` where `to = takerTraits.to(takerData, msg.sender)` (defaults to `msg.sender`, i.e. the caller of `swap`) (`:341`, `:359-362`). With `shouldUnwrapWeth` on the taker side and `tokenOut == WETH`, pull goes to the router then `WETH.safeWithdrawTo(amount, to)`.

`_transferIn` (`:245-303`) in Aqua mode:
1. maker preTransferIn hook (if any); **taker `preTransferInCallback`** (if `hasPreTransferInCallback`) — this is where `MockTaker` does `AQUA.push` (`:252-255`).
2. `require(msg.value == 0 || tokenIn == WETH, MsgValueInvalidToken())` (`:258`).
3. If `amountIn > 0` and Aqua mode (`:260-280`):
   - `require(!shouldUnwrapWeth, MakerTraitsUnwrapIsIncompatibleWithAqua())`; `require(maker == receiver, MakerTraitsCustomReceiverIsIncompatibleWithAqua())`.
   - **Mode A — `useTransferFromAndAquaPush`** (`:264-273`): router pulls tokenIn from taker (`safeTransferFrom(taker, this, amountIn)`, or wraps `msg.value` into WETH), pays protocol fee from the router's balance (`resolveInSafeTransfer`), then `forceApprove(AQUA, amountIn - fee)` and `AQUA.push(maker, this, orderHash, tokenIn, amountIn - fee)`. Requires the taker to have approved the ROUTER. Works for EOAs. `msg.value` allowed only here.
   - **Mode B — callback/self-push** (`:274-280`): `require(msg.value == 0, UnexpectedMsgValue())`; then re-reads `AQUA.rawBalances(maker, this, orderHash, tokenIn)` and requires `balanceIn >= originalAquaBalanceIn + amountIn`, else `AquaBalanceInsufficientAfterTakerPush(balanceIn, originalAquaBalanceIn, amountIn)`. Then protocol fee via `resolveInAquaPullMaker` = `AQUA.pull(maker, orderHash, tokenIn, fee_i, receiver_i)` (`ProtocolFee.sol:121-148`), i.e. the fee is pulled back out of the maker's strategy balance after the taker's full push.
4. maker postTransferIn hook gets `fee`.

Transfer-order gotcha: with the default order (`_transferOut` first), a callback-mode taker receives tokenOut BEFORE its `preTransferInCallback` runs — `MockTakerFirstTransfer` + `isFirstTransferFromTaker=true` reverses this (`SwapVMAqua.t.sol:62-132`).

---

## 4. Accounting rules (what the tests assert)

Notation: `balA/balB` = `aqua.safeBalances(maker, router, hash, A, B)`; `p` = protocol fee bps (`BPS = 1e7`, so `0.05e7` = 5%), `f` = flat fee bps.

1. **No fees, exactIn A->B** (`XYCSwapAqua.t.sol:64-87`, `SwapVMAqua.t.sol:33-60`):
   `amountOut = amountIn * balB / (balA + amountIn)` (floor, `XYCSwap.sol:40`); after swap `balA' = balA + amountIn`, `balB' = balB - amountOut`; taker ERC20: `-amountIn`, `+amountOut`; maker wallet ERC20 mirrors Aqua deltas.
2. **No fees, exactOut** (`XYCSwapAqua.t.sol:89-112`): `amountIn = ceil(amountOut * balIn / (balOut - amountOut))` (`XYCSwap.sol:43`); same balance deltas.
3. **Flat fee in (`FeeFlatIn`) — stays in the pool** (`FeeAqua.t.sol:50-101`): maker's Aqua `balA' = balA + amountIn` (full amount incl. fee; fee is LP revenue), `amountOut = balB * (amountIn - fee)/(balA + amountIn - fee)` with `fee = ceil(amountIn*f/BPS)` for exactIn; exactOut: `amountIn = base + ceil(base*f/(BPS-f))`. 100% fee => `TakerTraitsAmountOutMustBeGreaterThanZero(0)` for tiny exactIn; exactOut reverts.
4. **Protocol fee in (`FeeProtocol`, isTokenIn=true) — leaves the pool** (`ProtocolFeeAqua.t.sol:50-112`): exactIn: `protocolFee = amountIn * p / BPS` (floor, `FeeProtocol.sol:230`), `balA' = balA + amountIn - protocolFee`, `protocolFeeRecipient` receives `protocolFee` in tokenIn, `amountOut = balB * (amountIn - protocolFee)/(balA + amountIn - protocolFee)`. exactOut: `protocolFee = base * p / (BPS - p)`, `amountIn = base + protocolFee`, same `balA'` rule. Token B side unchanged by fees.
5. **Protocol fee + flat fee** (`ProtocolFeeAqua.t.sol:114-146`): protocol fee first (program order `FeeProtocol, FeeFlatIn, XYCSwap`): `afterProtocol = amountIn - amountIn*p/BPS`, `feeIn = afterProtocol*f/BPS`, `effective = afterProtocol - feeIn`; `balA' = balA + amountIn - protocolFee`.
6. **Conservation law** (`AquaAccounting.t.sol:139-151`, all XYC/Concentrate/Decay/Pegged variants): `balA' + protocolFee == INITIAL_BALANCE_A + sum(amountIn)` and `balB' + sum(amountOut) == INITIAL_BALANCE_B`. In Aqua mode the same program works with fee ordering "wrong" (`FeeProtocol` before vs after concentrate) — `AquaAccounting.t.sol:441-463` only asserts `correctBal >= wrongBal`, whereas the non-Aqua `SwapVmAccounting.t.sol:422-448` asserts strictly `correctBal < wrongBal` because there `DynamicBalances` is an explicit instruction that must come AFTER `FeeProtocol`. In Aqua mode there is no balances instruction; balances are injected before `runLoop`.
7. **Insufficient push** (`TakerCallbackAquaNegative.t.sol`): callback pushes nothing / half / `amount-1` => revert `AquaBalanceInsufficientAfterTakerPush(balanceAfterPush, originalBalance, amountIn)`; pushing to a wrong orderHash => Aqua `PushToNonActiveStrategyPrevented`. **Note:** the test encodes the error with a 4th arg `0 // amountNetPulled (no protocol fee)` (`:93-99`, `:112-118`, `:152-158`), but the error at HEAD has only 3 params (`SwapVM.sol:42`, selector `0x61d85d88`). No `amountNetPulled` identifier exists anywhere in `src/` (grep). The tests still pass under forge 1.0.0-dev because the actual 100-byte revert data is a prefix of the expected 132-byte data (verified with `-vvvv`: actual = `AquaBalanceInsufficientAfterTakerPush(2e20, 2e20, 5e19)`). UNCERTAIN whether a future version adds a 4th `amountNetPulled` field; use the 3-param form in your own code.
8. **Rounding / invariants** (`XYCSwapAqua.t.sol:121-322`): round trips never decrease strategy balances; `K = balA*balB` never decreases (dust 1 wei and `uint128.max` balances; exactOut max amount uses `>> 8` because Aqua balance is `uint248`); dust exactIn on a 1:1 pool reverts `TakerTraitsAmountOutMustBeGreaterThanZero(0)`; exactOut dust succeeds with `amountIn >= amountOut`. 1000 sequential 1-wei exactIn swaps add exactly 1000 wei to `balA`.
9. **Overflow** (`:589-613`): `amount = type(uint256).max` reverts with panic 0x11.

---

## 5. Native ETH / WETH in Aqua mode (`test/NativePayment.t.sol`, `test/UnwrapWeth.t.sol`)

- Router must be constructed with a real WETH (`new AquaSwapVMRouter(aqua, address(weth), owner, "SwapVM", "1.0.0")`, `NativePayment.t.sol:66`). Direct ETH transfers to the router revert `EthReceiver.EthDepositRejected` (`UnwrapWeth.t.sol:132-139`); only WETH can send ETH to it.
- Aqua + native payment works ONLY with `useTransferFromAndAquaPush = true` and `tokenIn == WETH`: `aquaRouter.swap{value: amountIn}(order, amountIn, takerData)` wraps into WETH and pushes; Aqua WETH balance grows by `amountIn`; excess `msg.value` is refunded to `msg.sender` (`NativePayment.t.sol:399-436`).
- Aqua order without the push flag + `msg.value > 0` => `SwapVM.UnexpectedMsgValue` (`:482-493`).
- `shouldUnwrapWeth` on the MAKER side is rejected in Aqua mode (`MakerTraitsUnwrapIsIncompatibleWithAqua`); taker-side unwrap (`TakerTraits.shouldUnwrapWeth`) is fine and is applied on `_transferOut` (`SwapVM.sol:350-357`). Signature-mode ETH/WETH details (maker receives ETH, custom receiver, refund failures `EthTransferFailed`) live in the same two files but do not use Aqua.

---

## 6. Other Aqua tests worth knowing

- `test/ControlsAqua.t.sol`: `Deadline.build(uint40)` before `XYCSwap` => `Deadline.DeadlineReached(deadline)` after warp; `OnlyTakerTokenBalanceNonZero.build(nft)` => `TakerTokenBalanceIsZero(taker, nft)`; `OnlyTxOriginTokenBalanceNonZero.build(nft)` checks `tx.origin` (uses `vm.prank(address(this), trader)`), error `TxOriginTokenBalanceIsZero(trader, nft)`. Failed swaps leave balances untouched.
- `test/TransferModesCombinations.t.sol`: the 4 combos. Aqua maker + EOA taker with `useTransferFromAndAquaPush=true` (taker approves ROUTER, `vm.prank(taker); router.swap(...)`) (`:62-87`); Aqua maker + contract taker callback (`:91-112`); Direct (signature) maker + EOA taker (`:116-145`); Direct maker + callback taker (`:149-178`). Aqua ship there: `aqua.ship(address(router), abi.encode(order), dynamic([tokenA, tokenB]), dynamic([BALANCE_A, BALANCE_B]))` (`:182-195`).
- `test/SwapVMAqua.t.sol`: 100:200 pool, swap 50 B->A => `amountOut = 50e18*100e18/(200e18+50e18) = 20e18`; plus the `isFirstTransferFromTaker` variant.
- Non-Aqua mirror: `test/SwapVmAccounting.t.sol` uses `SwapVMRouterDebug(address(0), address(0), owner, ...)`, `DynamicBalances.build(A, B)` in the program, EIP-712 signing (`vm.sign(makerPrivateKey, swapVM.hash(order))`, `abi.encodePacked(r, s, v)`), EOA taker with approvals to the router, balances read via `DynamicBalancesExternal(address(swapVM)).balance(orderHash, token)`.

---

## 7. Gotchas checklist

1. `MakerTraitsLib.build` requires `tokenA < tokenB` (`MakerTraits.sol:110`). Sort first.
2. Aqua mode forbids `shouldUnwrapWeth` (maker) and a custom `receiver` (`SwapVM.sol:261-262`).
3. Ship exactly `abi.encode(order)`; any other encoding gives a strategyHash that the router will never look up (it always uses `keccak256(abi.encode(order))`).
4. Maker must hold the tokens AND approve Aqua (not the router). Taker in `useTransferFromAndAquaPush` mode approves the ROUTER; taker in callback mode approves AQUA inside the callback.
5. `Aqua.ship` reverts `StrategiesMustBeImmutable` if the same `(maker, app, hash, token)` was shipped before — that is why every test program ends with `Salt.build(abi.encodePacked(vm.randomUint()))` (or `Salt.build(uint64)`); `Salt.exec` is a no-op.
6. Balances are `uint248`; `ship` amounts use `toUint248()`.
7. Reentrancy lock is per `orderHash` (transient), so the callback cannot re-enter the same order.
8. `TokenMock.mint` is `onlyOwner` (owner = deployer test contract).
9. Default `to` is `msg.sender` of `swap`, not the `taker` field. With a taker contract these coincide.
10. `FeeProtocol` must appear BEFORE the swap opcode in the program (it wraps `ctx.runLoop()` recursively, `FeeProtocol.sol:228-248`); `FeeFlatIn` likewise.
11. `quote`/`swap` revert with `SafeBalancesForTokenNotInActiveStrategy` after `dock` or if you ship only one token.
12. `Simulator.simulate(delegatee, data)` (`solidity-utils/contracts/mixins/Simulator.sol`) always reverts `Simulated(...)`; not used by tests.

---

## 8. Copy-pasteable minimal Foundry test (verified: 4/4 pass)

File: `swap-vm/test/MinimalAquaXYC.t.sol` (written and run in this session; placed at `swap-vm/test/MinimalAquaXYC.t.sol`). Run: `forge test --match-contract MinimalAquaXYC -vv`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";

import { ISwapVM } from "../src/interfaces/ISwapVM.sol";
import { ITakerCallbacks } from "../src/interfaces/ITakerCallbacks.sol";
import { AquaSwapVMRouter } from "../src/routers/AquaSwapVMRouter.sol";
import { MakerTraitsLib } from "../src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "../src/libs/TakerTraits.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { Salt } from "../src/instructions/Controls.sol";

/// @dev Contract taker for the "callback" transfer mode: SwapVM calls preTransferInCallback,
///      and the taker itself pushes tokenIn into the maker's Aqua strategy balance.
contract CallbackTaker is ITakerCallbacks {
    Aqua public immutable AQUA;
    AquaSwapVMRouter public immutable ROUTER;

    constructor(Aqua aqua, AquaSwapVMRouter router) { AQUA = aqua; ROUTER = router; }

    function swap(ISwapVM.Order calldata order, uint256 amount, bytes calldata takerTraitsAndData)
        external returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) = ROUTER.swap(order, amount, takerTraitsAndData);
    }

    function preTransferInCallback(
        address maker, address, address tokenIn, address, uint256 amountIn, uint256, bytes32 orderHash, bytes calldata
    ) external override {
        require(msg.sender == address(ROUTER), "not router");
        IERC20(tokenIn).approve(address(AQUA), amountIn);
        AQUA.push(maker, address(ROUTER), orderHash, tokenIn, amountIn); // transferFrom(this -> maker) + credit strategy
    }

    function preTransferOutCallback(address, address, address, address, uint256, uint256, bytes32, bytes calldata)
        external view override
    {
        require(msg.sender == address(ROUTER), "not router");
    }
}

contract MinimalAquaXYCTest is Test {
    Aqua public aqua;
    AquaSwapVMRouter public router;
    TokenMock public tokenA; // lower address
    TokenMock public tokenB; // higher address

    address public maker = makeAddr("maker");
    address public taker = makeAddr("taker"); // EOA taker (useTransferFromAndAquaPush mode)

    uint256 constant BALANCE_A = 1000e18;
    uint256 constant BALANCE_B = 2000e18;

    ISwapVM.Order internal order;
    bytes32 internal orderHash;

    function setUp() public {
        aqua = new Aqua();                                   // on a fork: Aqua(0x1111113ccf1426a8e30e2bff5e005d929bf6a90a)
        router = new AquaSwapVMRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");

        tokenA = new TokenMock("Token A", "TKA");
        tokenB = new TokenMock("Token B", "TKB");
        if (address(tokenA) > address(tokenB)) (tokenA, tokenB) = (tokenB, tokenA);

        bytes memory program = bytes.concat(XYCSwap.build(), Salt.build(uint64(0xC0FFEE)));

        order = MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            receiver: address(0),                 // must be 0 (== maker) in Aqua mode
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            shouldUnwrapWeth: false,              // must be false in Aqua mode
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            hasPreTransferInHook: false, hasPostTransferInHook: false,
            hasPreTransferOutHook: false, hasPostTransferOutHook: false,
            preTransferInTarget: address(0),  preTransferInData: "",
            postTransferInTarget: address(0), postTransferInData: "",
            preTransferOutTarget: address(0), preTransferOutData: "",
            postTransferOutTarget: address(0), postTransferOutData: "",
            program: program
        }));

        // Maker WALLET holds the liquidity; Aqua.ship does not move tokens, Aqua.pull does transferFrom(maker)
        tokenA.mint(maker, BALANCE_A);
        tokenB.mint(maker, BALANCE_B);
        vm.startPrank(maker);
        tokenA.approve(address(aqua), type(uint256).max);
        tokenB.approve(address(aqua), type(uint256).max);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA); tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BALANCE_A; amounts[1] = BALANCE_B;
        orderHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);   // strategy bytes = abi.encode(order)
        vm.stopPrank();

        assertEq(orderHash, router.hash(order), "ship hash must equal router.hash(order)");
        assertEq(orderHash, keccak256(abi.encode(order)), "aqua hash is keccak256(abi.encode(order))");
    }

    function _takerDataEOA(bool isExactIn, bool isAToB) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: taker, isExactIn: isExactIn, shouldUnwrapWeth: false, isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: true,     // router does transferFrom(taker) + Aqua.push
            isAToB: isAToB, allowPartialFill: false,
            threshold: "", to: address(0), deadline: 0,
            hasPreTransferInCallback: false, hasPreTransferOutCallback: false,
            preTransferInHookData: "", postTransferInHookData: "", preTransferOutHookData: "", postTransferOutHookData: "",
            preTransferInCallbackData: "", preTransferOutCallbackData: "", instructionsArgs: "",
            signature: ""                         // empty in Aqua mode
        }));
    }

    function _takerDataCallback(address takerContract, bool isExactIn, bool isAToB) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: takerContract, isExactIn: isExactIn, shouldUnwrapWeth: false, isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: false,    // taker pushes itself in callback
            isAToB: isAToB, allowPartialFill: false,
            threshold: "", to: address(0), deadline: 0,
            hasPreTransferInCallback: true,       // required for callback mode
            hasPreTransferOutCallback: false,
            preTransferInHookData: "", postTransferInHookData: "", preTransferOutHookData: "", postTransferOutHookData: "",
            preTransferInCallbackData: "", preTransferOutCallbackData: "", instructionsArgs: "",
            signature: ""
        }));
    }

    function _aquaBalances() internal view returns (uint256 balA, uint256 balB) {
        return aqua.safeBalances(maker, address(router), orderHash, address(tokenA), address(tokenB));
    }

    function test_ExactIn_AtoB_EOA() public {
        uint256 amountIn = 100e18;
        tokenA.mint(taker, amountIn);
        vm.prank(taker);
        tokenA.approve(address(router), amountIn);
        bytes memory takerData = _takerDataEOA(true, true);

        (uint256 qIn, uint256 qOut, bytes32 qHash) = router.asView().quote(order, amountIn, takerData);  // static quote
        assertEq(qHash, orderHash);
        assertEq(qIn, amountIn);
        uint256 expectedOut = amountIn * BALANCE_B / (BALANCE_A + amountIn);       // XYC floor
        assertEq(qOut, expectedOut, "quote amountOut");

        (uint256 aBefore, uint256 bBefore) = _aquaBalances();
        vm.prank(taker);
        (uint256 actualIn, uint256 actualOut,) = router.swap(order, amountIn, takerData);
        assertEq(actualIn, amountIn);
        assertEq(actualOut, expectedOut);

        (uint256 aAfter, uint256 bAfter) = _aquaBalances();
        assertEq(aAfter, aBefore + amountIn, "aqua A += amountIn");
        assertEq(bAfter, bBefore - actualOut, "aqua B -= amountOut");
        assertEq(tokenA.balanceOf(maker), BALANCE_A + amountIn);
        assertEq(tokenB.balanceOf(maker), BALANCE_B - actualOut);
        assertEq(tokenA.balanceOf(taker), 0);
        assertEq(tokenB.balanceOf(taker), actualOut);
        assertEq(tokenA.balanceOf(address(router)), 0, "router holds nothing");
    }

    function test_ExactOut_BtoA_EOA() public {
        uint256 amountOut = 100e18;                                   // want exactly 100 A, pay B
        bytes memory takerData = _takerDataEOA(false, false);         // isExactIn=false, isAToB=false (B->A)

        (uint256 qIn, uint256 qOut,) = router.asView().quote(order, amountOut, takerData);
        assertEq(qOut, amountOut);
        uint256 expectedIn = (amountOut * BALANCE_B + (BALANCE_A - amountOut) - 1) / (BALANCE_A - amountOut); // XYC ceil
        assertEq(qIn, expectedIn, "quote amountIn");

        tokenB.mint(taker, qIn);
        vm.prank(taker);
        tokenB.approve(address(router), qIn);

        (uint256 aBefore, uint256 bBefore) = _aquaBalances();
        vm.prank(taker);
        (uint256 actualIn, uint256 actualOut,) = router.swap(order, amountOut, takerData);
        assertEq(actualOut, amountOut);
        assertEq(actualIn, expectedIn);

        (uint256 aAfter, uint256 bAfter) = _aquaBalances();
        assertEq(aAfter, aBefore - amountOut, "aqua A -= amountOut");
        assertEq(bAfter, bBefore + actualIn, "aqua B += amountIn");
        assertEq(tokenA.balanceOf(taker), amountOut);
        assertEq(tokenB.balanceOf(taker), 0);
    }

    function test_ExactIn_AtoB_CallbackTaker() public {
        CallbackTaker cb = new CallbackTaker(aqua, router);
        uint256 amountIn = 50e18;
        tokenA.mint(address(cb), amountIn);                           // no approval to router needed
        bytes memory takerData = _takerDataCallback(address(cb), true, true);
        (uint256 aBefore, uint256 bBefore) = _aquaBalances();

        (uint256 actualIn, uint256 actualOut) = cb.swap(order, amountIn, takerData);
        assertEq(actualIn, amountIn);
        assertEq(actualOut, amountIn * BALANCE_B / (BALANCE_A + amountIn));

        (uint256 aAfter, uint256 bAfter) = _aquaBalances();
        assertEq(aAfter, aBefore + amountIn);
        assertEq(bAfter, bBefore - actualOut);
        assertEq(tokenB.balanceOf(address(cb)), actualOut);
    }

    function test_RoundTrip_PoolNeverLoses() public {
        uint256 amountIn = 100e18;
        tokenA.mint(taker, amountIn);
        vm.startPrank(taker);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        (, uint256 out1,) = router.swap(order, amountIn, _takerDataEOA(true, true));
        router.swap(order, out1, _takerDataEOA(true, false));
        vm.stopPrank();

        (uint256 aAfter, uint256 bAfter) = _aquaBalances();
        assertGe(aAfter * bAfter, BALANCE_A * BALANCE_B, "K never decreases");
        assertGe(aAfter, BALANCE_A);
        assertEq(bAfter, BALANCE_B);
    }
}
```

Expected numbers with the 1000:2000 pool: exactIn 100e18 A->B gives `amountOut = 100e18*2000e18/1100e18 = 181818181818181818181`; exactOut 100e18 A (paying B) costs `ceil(100e18*2000e18/900e18) = 222222222222222222223`.

To use the deployed registry on a fork instead: `Aqua aqua = Aqua(0x1111113ccf1426a8e30e2bff5e005d929bf6a90a)` and `vm.createSelectFork(rpc)`; keep deploying your own `AquaSwapVMRouter` (or a modified one) — Aqua does not care which app address you ship to.

---

## 9. Build & test results (this machine, forge 1.0.0-dev, commit 7461390b, 2025-04-30)

Commands run from `swap-vm/`:

| Command | Result | Wall time |
|---|---|---|
| `forge build` (cold, 254 files, via_ir) | `EXIT=0`, compiler warnings only (unused vars / mutability `2018` in tests) | **5m16s** (298.7s user) |
| `forge build` (incremental, +1 test file) | `Compiling 1 files with Solc 0.8.30` / `Compiler run successful!` | 4.0s |
| `forge test --match-contract SwapVMAqua` | `2 passed; 0 failed` (`test_Aqua_XYC_SimpleSwap` gas 316319, `test_Aqua_XYC_SwapWithFirstTransferFromTaker` gas 690501) | 0.85s (suite 132ms) |
| `forge test --match-contract MinimalAquaXYC -vv` | `4 passed; 0 failed` (gas 193436 / 190840 / 465587 / 283769) | 0.81s |
| `forge test --match-contract TakerCallbackAquaNegative` | `5 passed; 0 failed` | 0.80s |

- `node_modules/@1inch` contained `aqua` and `solidity-utils` already (no `yarn install` needed).
- No compile errors. AGENTS.md says the intended runner is `npx hardhat test` (Hardhat 3 solidity tests, ~7 min compile), but `forge build`/`forge test` work unmodified with `foundry.toml` + `remappings.txt` (`fs_permissions` for `./deployments` and `./config`).
- Full-suite `forge test` was NOT run (771+ tests incl. invariant/fuzz suites; not requested).

---

## 10. Open questions / UNCERTAIN

- Whether upstream intends to add `amountNetPulled` as a 4th field of `AquaBalanceInsufficientAfterTakerPush` (test encodes it; source does not). Treat the 3-arg form as canonical at commit `f09a41e`.
- `forge` prefix-matching of `expectRevert` bytes is observed behavior on 1.0.0-dev; newer forge may compare exactly and then `TakerCallbackAquaNegative` would fail.
- Whether the deployed router at `0x111111338c5091e8440b67b168bae16a668ac0de` is `AquaSwapVMRouter` (Aqua opcode set) or `SwapVMRouter`; the repo ships Ignition modules for `SwapVMRouter`, `AquaSwapVMRouter`, `LimitSwapVMRouter` (`DEPLOY.md`) but `config/constants.json` only has 31337 placeholders. Verify on-chain (`AQUA()` getter + try an Aqua-only opcode) before relying on it.
- `IAqua` in node_modules is v1.0.0 tag with `package.json` version `0.1.0` — check the deployed Aqua ABI matches (`ship/dock/pull/push/rawBalances/safeBalances`) before using the mainnet address.
