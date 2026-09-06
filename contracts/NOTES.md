# Contracts test harness notes

Foundry harness for Aqua-backed SwapVM strategies executed through our custom router (`src/ProbeRouter.sol`
= Simulator + SwapVM + AquaOpcodes + custom `ProbeScale` opcode at `0xd0`).

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
