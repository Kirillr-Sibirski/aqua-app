# Aqua core — knowledge base (1inch/aqua)

Sources read (local clone, commit `9c5c42e`, 2026-08-21): `src/*`, `examples/*`, `test/*`, `DEPLOY.md`, `README.md`, `LICENSES/Aqua-Source-1.1.txt`, `docs/whitepaper-aqua-1.0.pdf` (8 pages), `Makefile`, `foundry.toml`, `script/*`, `.gas-snapshot`, plus the `@1inch/solidity-utils` sources Aqua depends on (`TransientLock.sol`, `Transient.sol`, `Simulator.sol`, `Multicall.sol`, `Rescuable.sol`, from `refs/swap-vm/node_modules/@1inch/solidity-utils`, v6.9.10).
Repo root: `/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad/refs/aqua` (all `file:line` refs below are relative to it).
Everything in §12 (Foundry recipe) was **executed and passed** both locally and on a Base mainnet fork against the canonical registry.

---

## 0. TL;DR

- Aqua is a ~80-line **non-custodial allowance registry**. It holds no tokens. It stores one packed slot per `(maker, app, strategyHash, token)`: a `uint248 amount` ("virtual balance") + `uint8 tokensCount` (0 = never shipped, 1..254 = active, 0xFF = docked).
- Makers (LPs) `approve(aqua, ∞)` once per token, then `ship(app, strategyBytes, tokens, amounts)` to *virtually* allocate wallet balances to an app+strategy. `dock(app, hash, tokens)` revokes. Neither moves tokens.
- Apps (any contract address) call `pull(maker, hash, token, amount, to)` which does `token.transferFrom(maker, to, amount)` and decrements the virtual balance. **`msg.sender` is the app** — there is no other authorization.
- Anyone (takers) calls `push(maker, app, hash, token, amount)` which does `token.transferFrom(msg.sender, maker, amount)` and increments the virtual balance. Requires the strategy to be active for that token.
- `strategyHash = keccak256(strategy)` where `strategy` is the raw `bytes` passed to `ship` (convention: `abi.encode(StrategyStruct)`, struct must include `maker` so hashes are per-user). Strategies are **immutable** — same hash can never be re-shipped, even after dock.
- `AquaApp` is a tiny abstract base: `IAqua public immutable AQUA`, a per-`(maker, strategyHash)` transient-storage reentrancy lock (`nonReentrantStrategy`), and `_safeCheckAquaPush()` (asserts the lock is held, then `rawBalances >= expected`).
- The deployed contract at `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` is **`AquaRouter`** (= `Aqua` + `Simulator` + `Multicall` + `Rescuable/Ownable`), identical bytecode (codehash `0x720bc02d…341f8`) on Ethereum, Base, Arbitrum (verified via RPC), owner `0x5AFc5DF416640348235a0571dBEEf9064cb0338D`.
- License: `LicenseRef-Degensoft-Aqua-Source-1.1` — source-available, copyleft on modifications, hackathon/non-commercial use explicitly free; requires attribution "Powered by Aqua — © Degensoft Ltd 2025".

---

## 1. Repo layout, toolchain, dependencies

```
src/Aqua.sol               core registry (81 lines)            pragma 0.8.30
src/AquaApp.sol            abstract app base (69 lines)        pragma ^0.8.0
src/AquaRouter.sol         Aqua + Simulator + Multicall + Rescuable (22 lines)
src/interfaces/IAqua.sol   interface, errors, events
src/libs/Balance.sol       packed Balance struct + BalanceLib (1 SLOAD / 1 SSTORE)
examples/apps/XYCSwap.sol                      x*y=k example app (184 lines)
examples/apps/interfaces/IXYCSwapCallback.sol  taker callback interface
examples/test/XYCSwap.t.sol (718 lines), examples/test/XYCNestedSwaps.t.sol (509 lines)
test/base/AquaTestBase.sol, test/mock/ERC20.sol, test/utils/{Dynamic,StorageAccesses}.sol
test/Aqua{Lifecycle,PushPull,Balances,ShipDock,Router,Events,StorageTest}.t.sol
script/DeployAquaRouter.s.sol, script/utils/Config.sol, config/constants.json
docs/whitepaper-aqua-1.0.pdf
```

- `foundry.toml`: `solc = "0.8.30"`, `optimizer = true`, `optimizer_runs = 10_000_000`, `via_ir = true`, `libs = ["node_modules","lib"]`. (SwapVM repo uses `optimizer_runs = 700`.)
- `remappings.txt`: `forge-std/=node_modules/forge-std/src/`, `@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/`, `@1inch/solidity-utils/=node_modules/@1inch/solidity-utils/`.
- `package.json`: name `@1inch/aqua`, version `0.1.0`; deps `forge-std#v1.11.0`, `@1inch/solidity-utils@6.9.7`, `@openzeppelin/contracts@5.4.0`. Installed via `npm install` / `yarn` (CI runs `forge install` then `npm install`). The local clone has **no** `node_modules`; the SwapVM clone at `refs/swap-vm/node_modules/@1inch/aqua` contains an identical copy of this package (diff clean on `Aqua.sol`, `AquaApp.sol`) — usable as a remapping target (`@1inch/aqua/=node_modules/@1inch/aqua/`).
- Imports used by core: `@openzeppelin/contracts/utils/math/SafeCast.sol` (`toUint8`, `toUint248`), `@1inch/solidity-utils/contracts/libraries/SafeERC20.sol` (`safeTransferFrom`), `@1inch/solidity-utils/contracts/libraries/TransientLock.sol`.
- CI (`.github/workflows/ci.yml`): `forge snapshot --check --tolerance 5 --no-match-test "testFuzz_*"` then `forge test`. README badge says coverage 61.54%.
- Makefile targets: `deploy-aqua-router` (forge script `DeployAquaRouter` with `--broadcast -vvvv`), `verify-aqua-router`, `tests` (`forge test -vvv --gas-report`), `anvil` (`anvil --fork-url $(NODE_URL) --steps-tracing --chain-id $(OPS_CHAIN_ID) --host 127.0.0.1 --port 8546`), `snapshot`, `coverage`, `format`, `lint`.
- Deploy config: `config/constants.json` = `{"owner": {"1": "0x000…000"}}`; `Config.readAquaRouterParameters` reverts `OwnerAddressDoesNotExist()` if owner for `block.chainid` is zero — i.e. you must edit the JSON before `make deploy-aqua-router` (script/utils/Config.sol:21-33).
- `DEPLOY.md` (titled "SwapVM Deployment Guide" but describes Aqua): env vars `OPS_NETWORK`, `OPS_CHAIN_ID`, `<NETWORK>_RPC_URL`, `<NETWORK>_PRIVATE_KEY`; artifacts in `broadcast/` and `deployments/<network>/AquaRouter.json`; `make get PARAMETER=OPS_AQUA_ROUTER_ADDRESS` prints the address.

---

## 2. Terminology (code + whitepaper Appendix A)

| Term | Meaning |
|---|---|
| **Maker** / LP | Wallet that owns tokens and grants Aqua an ERC-20 allowance; `msg.sender` of `ship`/`dock`. Whitepaper: "In Aqua, a Maker is an LP whose balances are shared across Strategies via virtual provisioning." |
| **App** / Aqua Application | Any contract address (`address app` in `ship`). "A smart contract that implements trading strategy logic and interacts with the Aqua protocol." Only the app (as `msg.sender`) can `pull` from balances keyed by its address. Aqua does not validate that `app` is a contract or implements anything. |
| **Strategy** | Opaque `bytes` the maker passes to `ship`; app-specific ABI encoding of immutable parameters (tokens, fee, salt…). Identified by `strategyHash = keccak256(strategy)`. |
| **strategyHash** | `bytes32 keccak256(strategy)` — computed inside `ship` (Aqua.sol:41) and returned. Apps recompute it as `keccak256(abi.encode(strategyStruct))`. |
| **Virtual balance** / "allowance" | `_balances[maker][app][strategyHash][token].amount` — how much the app may still pull of `token` from `maker` under that strategy. Not a token balance; whitepaper calls these "virtual balances". |
| **ship** | Maker activates a strategy and sets initial virtual balances (no token transfer). Nautical metaphor: ship = deploy/launch. |
| **dock** | Maker deactivates a strategy: zeroes balances for *all* its tokens, marks `tokensCount = 0xFF`. No token transfer. |
| **pull** | App moves tokens `maker → to` and decrements virtual balance. |
| **push** | Caller moves tokens `msg.sender → maker` and increments virtual balance. |
| **Taker** | Consumer of liquidity who calls an app's swap function and, in a callback, `push`es the input token. |
| **Strategy builders** | "Developers or teams who design and implement trading Strategies on top of Aqua." (whitepaper) |
| **PMM** | Professional market maker; whitepaper says Aqua "extends seamlessly to Professional Market Maker strategies". |
| **SLAC** | Shared Liquidity Amplification Coefficient (whitepaper §4.1): total liquidity provisioned across all strategies ÷ actual wallet equity, ≥ 1. |
| **Capital efficiency / Utility efficiency** | Whitepaper: notional exposure per unit of wallet equity / number of simultaneous "uses" of the same asset (LP + governance + collateral…). |

---

## 3. Deployments (verified on-chain 2026-09-05)

| Contract | Address (EIP-55) | Notes |
|---|---|---|
| Aqua registry (**AquaRouter**) | `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` | lowercase form in README: `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`. Solidity literals must use the EIP-55 form or compilation fails (`Error 9429`). |
| SwapVM router | `0x111111338c5091E8440b67B168bAe16a668AC0De` | README: "Only interact with these two contracts. Anything else is not Aqua." |

- Runtime bytecode at the registry address is 5,619 bytes; `keccak256(code)` = `0x720bc02d220db318164dc3bade86eec1f3655bdc00fc1174de7d816a95c341f8` on Ethereum (`eth.drpc.org`), Base (`mainnet.base.org`) and Arbitrum (`arb1.arbitrum.io/rpc`) — deterministic deployment, same code everywhere.
- Selectors present in the deployed code: `rawBalances`, `safeBalances`, `ship`, `dock`, `pull`, `push`, **`multicall(bytes[])`**, **`simulate(address,bytes)`**, **`rescueFunds(address,uint256)`**, `owner()`, `transferOwnership`, `renounceOwnership` ⇒ the deployed contract is `AquaRouter`, not bare `Aqua`.
- `owner()` returns `0x5AFc5DF416640348235a0571dBEEf9064cb0338D` on Ethereum and Base. Owner can only `rescueFunds` (tokens/ETH accidentally sent to the registry). No admin power over balances.
- README "Supported Networks": Ethereum Mainnet, Base, Optimism, Polygon, Arbitrum, Avalanche, Binance Smart Chain, Linea, Sonic, Unichain, Gnosis, zkSync, Robinhood, Cronos, Monad, HyperEVM. (Only ETH/Base/Arbitrum verified here.)
- The registry itself uses only regular storage (no EIP-1153). Transient storage (`tload/tstore`) is used by `AquaApp`'s reentrancy lock, so **apps** built on `AquaApp` require a Cancun-capable chain/EVM (`evm_version = "cancun"` or later in Foundry; default in recent forge is fine).

---

## 4. `IAqua` interface (src/interfaces/IAqua.sol) — verbatim signatures + selectors

```solidity
interface IAqua {
    // errors
    error MaxNumberOfTokensExceeded(uint256 tokensCount, uint256 maxTokensCount);                       // 0x7ea50f64  (L14)
    error StrategiesMustBeImmutable(address app, bytes32 strategyHash);                                 // 0x879f237b  (L19)
    error DockingShouldCloseAllTokens(address app, bytes32 strategyHash);                               // 0xbbe8d44d  (L24)
    error PushToNonActiveStrategyPrevented(address maker, address app, bytes32 strategyHash, address token);        // 0x69f7b4f2 (L31)
    error SafeBalancesForTokenNotInActiveStrategy(address maker, address app, bytes32 strategyHash, address token); // 0xb63386a6 (L38)

    // events (NO indexed params — filter client-side or by topic0 only)
    event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy);                    // topic0 0xdc3622e06fb145651f567d421c9ef261d71d43e3778b761907bc0d70d42e52b0 (L45)
    event Docked(address maker, address app, bytes32 strategyHash);                                     // topic0 0xd173a1d140c154eb1ce9298d251d5eb8c4089cc2d16e70f1067bdc810c6fe004 (L51)
    event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount);      // topic0 0x3ad61047071575417c75e3311e5d46ff042e292b5dd8769ff18b4b254098ca7a (L60)
    event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount);      // topic0 0x3f18354abbd5306dd1665c2c90f614a4559e39dd620d04fbe5458e613b6588f3 (L69)

    // views
    function rawBalances(address maker, address app, bytes32 strategyHash, address token)
        external view returns (uint248 balance, uint8 tokensCount);                                     // 0x6d58b4cc (L78)
    function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1)
        external view returns (uint256 balance0, uint256 balance1);                                     // 0x65f2fe14 (L88)

    // maker lifecycle
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external returns (bytes32 strategyHash);                                                        // 0xf50b870f (L96-101)
    function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;               // 0x28defc17 (L108)

    // swap execution
    function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external;   // 0xb00bbd10 (L117)
    function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount) external;  // 0x47d72768 (L126)
}
```

Note the asymmetry: `pull` has **no `app` parameter** (app = `msg.sender`), `push` **does** (anyone can push on behalf of any app).

Extra ABI on the deployed `AquaRouter`: `multicall(bytes[])` `0xac9650d8`, `simulate(address delegatee, bytes data)` `0xbd61951d` (always reverts with `Simulated(address,bytes,bool,bytes)`), `rescueFunds(IERC20,uint256)` `0x78e3214f` (onlyOwner), `owner()` `0x8da5cb5b`.

The `@1inch/aqua` npm package (`package.json` main = `index.js`, but no JS is shipped) — the TS SDK lives in `refs/sdks/typescript/aqua/src/{abi,aqua-protocol-contract,index.ts}` (separate KB task).

---

## 5. Storage layout: `Balance` packing (src/libs/Balance.sol)

```solidity
struct Balance { uint248 amount; uint8 tokensCount; }   // L11-14, one 32-byte slot
// slot = amount | (tokensCount << 248)
library BalanceLib {
    function load(Balance storage b) internal view returns (uint248 amount, uint8 tokensCount) // L24: sload; amount = packed & (2^248-1); tokensCount = packed >> 248
    function store(Balance storage b, uint248 amount, uint8 tokensCount) internal              // L37: sstore(or(amount, shl(248, tokensCount)))
}
```

- `Aqua.sol:21-24`: `mapping(address maker => mapping(address app => mapping(bytes32 strategyHash => mapping(address token => Balance)))) private _balances;` — comment: "aka makers' allowances". Solidity slot 0; the nested-mapping slot for a given key is `keccak256(token . keccak256(strategyHash . keccak256(app . keccak256(maker . 0))))` (standard Solidity mapping derivation; useful for `vm.load`/`vm.store` in tests).
- `tokensCount` semantics (Balance.sol:10 docs): `0` = inactive/never shipped, `1..254` = active, number of tokens in the strategy, `0xFF (255)` = docked (`_DOCKED`, Aqua.sol:19).
- Max amount `2^248 − 1 ≈ 4.5e74`. `SafeCast.toUint248` reverts (`SafeCastOverflowedUintDowncast(248, value)`) on larger inputs (tests `testPushRevertsOnUint248Overflow`, `testShipRevertsOnUint248AmountOverflow`).
- Every `push`/`pull` is exactly **1 SLOAD + 1 SSTORE** on Aqua; `ship`/`dock` with N tokens are N SLOAD + N SSTORE (test/AquaStorageTest.t.sol verifies with `vm.record()`/`vm.accesses`).

---

## 6. `Aqua.sol` function semantics (exact behavior, preconditions, edge cases)

### 6.1 `ship(app, strategy, tokens, amounts) → strategyHash` (Aqua.sol:40-52)

```solidity
strategyHash = keccak256(strategy);
uint8 tokensCount = tokens.length.toUint8();                               // reverts if > 255
require(tokensCount != _DOCKED, MaxNumberOfTokensExceeded(tokensCount, _DOCKED - 1));  // 255 tokens rejected; max = 254
emit Shipped(msg.sender, app, strategyHash, strategy);                     // emitted BEFORE the loop; full strategy bytes for data availability
for i in tokens:
    Balance storage balance = _balances[msg.sender][app][strategyHash][tokens[i]];
    require(balance.tokensCount == 0, StrategiesMustBeImmutable(app, strategyHash));   // slot must be virgin
    balance.store(amounts[i].toUint248(), tokensCount);
    emit Pushed(msg.sender, app, strategyHash, tokens[i], amounts[i]);     // one Pushed per token
```

Facts:
- **Maker = `msg.sender`**. No signature / delegation path; a contract wallet or a helper contract that ships on the maker's behalf becomes the maker itself.
- **No token transfer, no allowance/balance check.** You can ship amounts you do not hold (`testShipWithZeroAmounts`, and `testShipRevertsOnUint248AmountOverflow` only fails on the cast). Real solvency is checked lazily at `pull` time by `safeTransferFrom`.
- **No validation of `app`, tokens, or `amounts.length`.** `amounts.length < tokens.length` reverts with an out-of-bounds panic; longer is silently truncated. `tokens[i] == address(0)` is stored happily (`testInvalidTokenAddresses` comment: "Aqua doesn't validate them").
- Empty `tokens` array: succeeds, emits `Shipped` only, stores nothing (UNCERTAIN: no test, but follows from code).
- **Duplicate tokens in one call revert** (`StrategiesMustBeImmutable`, `testShipCannotHaveDuplicateTokens` L132-143) because the second iteration sees `tokensCount != 0`.
- **Re-ship of the same `(maker, app, hash)` with any overlapping token reverts** (`testShipCannotBeCalledTwiceForSameStrategy` L47-66, `testShipSameStrategyHashPartiallyOverlappingTokensReverts` L110-130), **including after dock** (`testShipDockShipSameStrategyReverts` L331-373: docked slots have `tokensCount = 0xFF ≠ 0`). ⇒ To re-parameterize or top-up, change the strategy bytes (e.g. bump `salt`) → new hash.
- **Known footgun (documented in the test suite):** re-shipping the same hash with a *disjoint* token set **succeeds** and leaves inconsistent `tokensCount` values (2 for old tokens, 1 for the new one), after which **no `dock` call can ever satisfy the check for all tokens** — the strategy becomes un-dockable per-token-group (`testShipSameStrategyHashDifferentTokens` L68-108, comment: "Docking this strategy would be impossible"). Actually each group could be docked separately with its own token array of matching length (UNCERTAIN—not tested, but the check is per-token `balance.tokensCount == tokens.length`), yet the mixed state is a trap: avoid it.
- `Shipped` carries the full `strategy` bytes → indexers can reconstruct the strategy struct from logs (this is how off-chain discovery works; README/whitepaper: "Aqua liquidity is off-chain discoverable but on-chain accessible").
- Gas (measured, verified recipe, optimizer 700/via_ir): `ship` with 2 tokens ≈ 79.8k gas (2 cold SSTOREs + event with bytes); `.gas-snapshot` `testShip1Token` 46,337 (whole test).

### 6.2 `dock(app, strategyHash, tokens)` (Aqua.sol:54-61)

```solidity
for i in tokens:
    Balance storage balance = _balances[msg.sender][app][strategyHash][tokens[i]];
    require(balance.tokensCount == tokens.length, DockingShouldCloseAllTokens(app, strategyHash));
    balance.store(0, _DOCKED);            // amount = 0, tokensCount = 0xFF
emit Docked(msg.sender, app, strategyHash);
```

Facts:
- Maker = `msg.sender`. Must pass **exactly the shipped token set** (same count, every token actually part of the strategy). Fewer tokens (`testDockRequiresAllTokensFromShip`), a wrong token (`testDockRequiresExactTokensFromShip`), or more tokens (`testDockRequiresCorrectTokenCount`) all revert with `DockingShouldCloseAllTokens`. Order does not matter. Passing the same token twice with length 2 on a 2-token strategy: first iteration passes, second sees `0xFF ≠ 2` → reverts (follows from code).
- Docking a never-shipped hash reverts (`tokensCount 0 ≠ length`) (`testDockNonExistentStrategyReverts`). Docking twice reverts (`testDockAlreadyDockedStrategyReverts`).
- **"Partially consumed" strategies dock fine** — remaining virtual balances are simply zeroed; nothing is transferred (tokens were always in the wallet). `testFullLifecycle` (AquaLifecycle.t.sol:14-57): ship 100/200 → push +50 → pull −30 → dock → balances 0, push reverts `PushToNonActiveStrategyPrevented`, pull reverts with arithmetic underflow (`testPullAfterDockRevertsOnUnderflow`).
- **Not atomic w.r.t. in-flight swaps in the same block** in the sense that ordering matters, but each tx is atomic; a pending pull after dock simply reverts (balance 0 → underflow). There is no timelock.
- Gas: dock 2 tokens ≈ 35.9k (measured).

### 6.3 `pull(maker, strategyHash, token, amount, to)` (Aqua.sol:63-70)

```solidity
Balance storage balance = _balances[maker][msg.sender][strategyHash][token];   // app == msg.sender
(uint248 prev, uint8 tokensCount) = balance.load();
balance.store(prev - amount.toUint248(), tokensCount);                         // checked math: underflow → Panic(0x11)
IERC20(token).safeTransferFrom(maker, to, amount);                              // maker must have balance AND allowance to Aqua
emit Pulled(maker, msg.sender, strategyHash, token, amount);
```

Facts:
- **Authorization is purely `msg.sender == app`.** Any address that was named as `app` in a `ship` can pull up to the virtual balance. An EOA can be an "app" (tests use `address(0x2222)` with `vm.prank(app)`). A random address pulling against another app's hash gets a 0 balance → `Panic(0x11)` arithmetic underflow (`testAppIsolationPullProtection`, `testPullFromNonExistentStrategy` expect `stdError.arithmeticError`).
- **No active-check** on pull: a docked or never-shipped slot has amount 0, so any non-zero pull underflows; `pull(…, 0, …)` on anything succeeds (emits `Pulled` with 0 and calls `safeTransferFrom(maker,to,0)`; whether a zero-transfer reverts depends on the token).
- `tokensCount` is preserved unchanged.
- Failure modes propagate from `safeTransferFrom`: insufficient maker wallet balance / allowance revert the whole swap. Whitepaper: "When a Maker's actual wallet balance falls below their virtual balance commitments, strategies become illiquid — trades cannot execute because pull() operations will revert."
- Fee-on-transfer / rebasing tokens: Aqua accounts `amount` requested, not received (no balance diffing). Apps must handle this themselves (UNCERTAIN: no explicit statement, follows from code).

### 6.4 `push(maker, app, strategyHash, token, amount)` (Aqua.sol:72-80)

```solidity
Balance storage balance = _balances[maker][app][strategyHash][token];
(uint248 prev, uint8 tokensCount) = balance.load();
require(tokensCount > 0 && tokensCount != _DOCKED, PushToNonActiveStrategyPrevented(maker, app, strategyHash, token));
balance.store(prev + amount.toUint248(), tokensCount);                          // overflow beyond uint248 → Panic(0x11)
IERC20(token).safeTransferFrom(msg.sender, maker, amount);                      // caller must have approved Aqua
emit Pushed(maker, app, strategyHash, token, amount);
```

Facts:
- **Permissionless**: any `msg.sender` can push to any active `(maker, app, hash, token)`; tokens go straight to the **maker's wallet** (not to Aqua, not to the app). Caller must `approve(aqua, amount)` first (README/tests use `forceApprove`/`approve` inside the callback). Over-pushing is just a donation to the maker (`testAppIsolationPushProtection`, `testMaliciousOverPushAttack`: "Malicious push is just a donation to the maker").
- Reverts if token is not part of the strategy (`testPushOnlyForShippedTokens`), strategy never shipped (`testPushRequiresActiveStrategy`), or docked (`testPushFailsAfterDock`).
- State update happens **before** the external `safeTransferFrom` (checks-effects-interactions) in both push and pull; Aqua itself has no reentrancy guard and needs none — balances are updated first and every call is stateless beyond its own slot.
- `push` is how takers pay: because the app has already `pull`ed output to the taker, the app must verify afterward that the input arrived (`_safeCheckAquaPush`). README: "`pull()` and `push()` are used exclusively during swap execution … They are NOT used for liquidity management."

### 6.5 `rawBalances` / `safeBalances` (Aqua.sol:26-38)

- `rawBalances` returns `(amount, tokensCount)` with no checks: `(0, 0)` for unknown, `(0, 255)` for docked.
- `safeBalances(maker, app, hash, token0, token1)` reverts `SafeBalancesForTokenNotInActiveStrategy(maker, app, hash, tokenX)` for the **first** offending token if `tokensCount == 0 || tokensCount == 0xFF`; returns `uint256`s. Two tokens only — for N-token strategies call it pairwise or use `rawBalances` + your own check. Passing the same token twice is fine.
- `safeBalances` is the idiomatic "is this strategy valid for this app" check: in `XYCSwap`, a tampered strategy struct (different `maker`/tokens) hashes to an unshipped hash → `safeBalances` reverts → swap reverts (`testInvalidStrategyVerification`, `testInvalidTokenAddresses` use bare `vm.expectRevert()`).

### 6.6 Event ordering per operation

- `ship`: `Shipped` then `Pushed` × N (AquaEvents.t.sol:30-53).
- `dock`: `Docked` once (after all stores).
- `pull`: ERC-20 `Transfer(maker→to)` (from the token) then `Pulled`.
- `push`: ERC-20 `Transfer(sender→maker)` then `Pushed`.
- A full XYCSwap `swapExactIn` emits, in order: `Transfer(maker→to)`, `Pulled`, [callback: `Approval`, `Transfer(taker→maker)`, `Pushed`]. (Verified via `vm.expectEmit` in the recipe.)

---

## 7. `strategyHash` and what "app" means

- `strategyHash = keccak256(strategy)` over the **raw calldata bytes** (Aqua.sol:41). Aqua tests use plain strings (`keccak256("lifecycle")`); apps use `keccak256(abi.encode(StrategyStruct))`. Any bytes work; the app decides the schema. The struct convention (README "For Developers"): **`maker` must be a field** ("Must-have to make strategyHash unique per user") — otherwise two makers shipping identical params share a hash, which is fine for Aqua (keyed by maker) but the *app* cannot know which maker to pull from unless the strategy carries it. Include a `salt` to allow multiple identical strategies per maker.
- Hash is **not** domain-separated by app or chain. The same bytes shipped to two apps produce the same hash under different `app` keys — independent balances (`testAppIsolationPullProtection` ships the same strategy to the same app twice with different salts).
- `app` is just an `address`. Nothing checks code size, interface, or that the app knows the strategy. `msg.sender` at `pull` time is what matters. Consequences: (a) any contract can be an Aqua app without inheriting `AquaApp`; (b) SwapVM's router is an app (`SwapVM.sol:84 IAqua public immutable AQUA; :168/:222 safeBalances(order.maker, address(this), orderHash, …); :273 push; :276 rawBalances; :361 AQUA.pull(from, orderHash, token, amount, to)`) — it uses the **order hash** as the strategyHash; (c) a maker who ships to a malicious app address is granting that address the right to drain up to the shipped amounts — the shipped `amounts` are the risk cap, together with the ERC-20 allowance.
- `AquaApp.InvalidAquaStrategy(maker, strategyHash, salt, app, actualThis)` (AquaApp.sol:24) exists as an error but is **never thrown anywhere in this repo** (grep) — likely intended for apps whose strategy embeds an `app` field. UNCERTAIN whether SwapVM uses it.

---

## 8. `AquaApp` base contract (src/AquaApp.sol)

```solidity
abstract contract AquaApp {
    using TransientLockLib for TransientLock;
    error InvalidAquaStrategy(address maker, bytes32 strategyHash, bytes32 salt, address app, address actualThis); // 0x6d030538, unused
    error MissingTakerAquaPush(address token, uint256 newBalance, uint256 expectedBalance);                        // 0xc7d7d77b
    error MissingNonReentrantModifier();                                                                           // 0x2b38c10f
    IAqua public immutable AQUA;                                                                                    // L36
    mapping(address maker => mapping(bytes32 strategyHash => TransientLock)) internal _reentrancyLocks;             // L39 (transient-backed)
    modifier nonReentrantStrategy(address maker, bytes32 strategyHash) {                                           // L44-48
        _reentrancyLocks[maker][strategyHash].lock(); _; _reentrancyLocks[maker][strategyHash].unlock();
    }
    constructor(IAqua aqua) { AQUA = aqua; }                                                                       // L52
    function _safeCheckAquaPush(address maker, bytes32 strategyHash, address token, uint256 expectedBalance) internal view { // L62-68
        require(_reentrancyLocks[maker][strategyHash].isLocked(), MissingNonReentrantModifier());
        (uint256 newBalance,) = AQUA.rawBalances(maker, address(this), strategyHash, token);
        require(newBalance >= expectedBalance, MissingTakerAquaPush(token, newBalance, expectedBalance));
    }
}
```

- `TransientLock` (solidity-utils `TransientLock.sol`) wraps a `tuint256` whose value lives in **EIP-1153 transient storage** at the struct's storage slot (`Transient.sol:87-100`: `tload(add(self.slot, OFFSET))`). `lock()` = `inc()` must return 1 else `UnexpectedLock()` (`0x3e26409c`); `unlock()` = `dec()` reverting `UnexpectedUnlock()` (`0xfed3ca24`) at 0; `isLocked()` = value == 1. Transient ⇒ auto-cleared at tx end, ~100 gas per op, no storage refunds games.
- **Lock granularity is per `(maker, strategyHash)`** — not global. Nested swaps across *different* strategies (or the same strategy of a different maker) inside a callback are allowed by design; re-entering the *same* strategy reverts with `UnexpectedLock()`. `XYCNestedSwaps.t.sol` has a `performNestedSwap` path (callback swaps on a `secondPool`/`secondStrategy`, L464-505) but no test sets it to `true`; `attemptMaliciousPull` is set (L104) but never read in the callback — so nested swaps are not actually exercised by the shipped tests (fact from reading the file).
- Why `_safeCheckAquaPush` requires the lock: the check is "balance after ≥ balance before + amountIn" read from Aqua. Without the lock, a taker could re-enter the same strategy during the callback and have a *single* push satisfy two swaps' checks (double-spend of the push). With the per-strategy lock, the second entry reverts. README offers the alternative: skip the lock, `transferFrom(taker → app)`, `approve(AQUA)`, `AQUA.push(...)` yourself (README L292-317) — then no callback and no reentrancy concern.
- `_safeCheckAquaPush` only checks `>=`; extra pushes are accepted (donation to maker). It reads `rawBalances` (not `safeBalances`), so it would also "pass" on a docked strategy if expected were 0 — irrelevant in practice because `safeBalances` ran earlier in the swap.
- `AquaApp` has **no** `ship`/`dock` helpers, no strategy validation, no fee logic; apps add these. It is `pragma ^0.8.0` but transient storage needs solc ≥ 0.8.24 + cancun EVM.

---

## 9. `AquaRouter` (src/AquaRouter.sol) — what is actually deployed

```solidity
contract AquaRouter is Aqua, Simulator, Multicall, Rescuable {
    constructor(address owner) Rescuable(owner) { }   // owner only used for rescueFunds
}
```

- `Multicall.multicall(bytes[] data)` — delegatecalls itself for each entry, bubbles the first revert. Use it to batch e.g. `ship` × N or `dock` + `ship` (re-parameterize atomically) in a single tx from the maker. `msg.sender` is preserved through delegatecall, so `ship` inside `multicall` still records the EOA as maker.
- `Simulator.simulate(address delegatee, bytes data) payable` — delegatecalls and **always reverts** with `Simulated(delegatee, data, success, result)`; for `eth_call`-based dry-runs. Note: `delegatee` is arbitrary code run in Aqua's storage context — it is safe only because it always reverts.
- `Rescuable.rescueFunds(IERC20 token, uint256 amount) onlyOwner` → `uniTransfer(msg.sender, amount)` (`address(0)`/ETH sentinel supported). `AquaRouter.t.sol` is the only test (`test_RescueFundsERC20`). Deployment gas in that test: 1,820,965 (whole test).
- Deploy script: `script/DeployAquaRouter.s.sol` → `new AquaRouter(owner)` with owner from `config/constants.json` (keyed by chain id). Redeploying your own `AquaRouter` (e.g. on Anvil) is `forge create src/AquaRouter.sol:AquaRouter --constructor-args <owner>`.

---

## 10. `XYCSwap` example app end-to-end (examples/apps/XYCSwap.sol)

### Strategy struct and hashing
```solidity
struct Strategy { address maker; address token0; address token1; uint256 feeBps; bytes32 salt; }   // L35-41, abi.encode = 5×32 = 160 bytes
bytes32 strategyHash = keccak256(abi.encode(strategy));
uint256 internal constant BPS_BASE = 10_000;                                                          // L44
error InsufficientOutputAmount(uint256 amountOut, uint256 amountOutMin);                              // L22
error ExcessiveInputAmount(uint256 amountIn, uint256 amountInMax);                                    // L27
constructor(IAqua aqua_) AquaApp(aqua_) { }                                                           // L48
```
Ship it (README L169-190 / XYCSwap.t.sol:83-101):
```solidity
bytes32 h = aqua.ship(address(xycSwap), abi.encode(strategy), [token0, token1], [amount0, amount1]);
```
Balances are then "reserves" the app reads live from Aqua — there is no per-pool state in the app at all (XYCSwap has **zero storage variables** besides the transient locks).

### Views
- `quoteExactIn(Strategy calldata, bool zeroForOne, uint256 amountIn) → amountOut` (L55-63) and `quoteExactOut(…, amountOut) → amountIn` (L70-78): read reserves via `_getInAndOut` → `AQUA.safeBalances(maker, address(this), hash, tokenIn, tokenOut)` (L179-183; reverts for unknown/docked strategies).
- Formulas (L148-176), fee taken on input:
  - exactIn: `amountInWithFee = amountIn * (10000 − feeBps) / 10000; amountOut = amountInWithFee * balanceOut / (balanceIn + amountInWithFee)`
  - exactOut: `amountOutWithFee = amountOut * 10000 / (10000 − feeBps); amountIn = ceilDiv(balanceIn * amountOutWithFee, balanceOut − amountOutWithFee)` (underflows/reverts if `amountOutWithFee ≥ balanceOut`).
  - Note: the fee stays in the maker's wallet as extra `tokenIn` (k grows); `feeBps` is not range-checked (9999 allowed, `testMaxFeeScenario`; ≥10000 would underflow in the fee math).

### Swap flow — `swapExactIn(strategy, zeroForOne, amountIn, amountOutMin, to, takerData)` (L88-109)
```
modifier nonReentrantStrategy(strategy.maker, keccak256(abi.encode(strategy)))     // tstore lock
1. hash = keccak256(abi.encode(strategy))
2. (tokenIn, tokenOut, balanceIn, balanceOut) = _getInAndOut(...)                   // AQUA.safeBalances  → reverts if strategy unknown/docked
3. amountOut = _quoteExactIn(...); require(amountOut >= amountOutMin, InsufficientOutputAmount)
4. AQUA.pull(strategy.maker, hash, tokenOut, amountOut, to)                         // maker wallet → `to`, virtual balanceOut −= amountOut   (optimistic!)
5. IXYCSwapCallback(msg.sender).xycSwapCallback(tokenIn, tokenOut, amountIn, amountOut, strategy.maker, address(this), hash, takerData)
      // taker must: approve(AQUA, amountIn); AQUA.push(maker, app, hash, tokenIn, amountIn)
6. _safeCheckAquaPush(strategy.maker, hash, tokenIn, balanceIn + amountIn)          // rawBalances(tokenIn) >= balanceIn + amountIn else MissingTakerAquaPush
// modifier unlocks
```
`swapExactOut` (L119-140) is symmetric with `ExcessiveInputAmount` and `_quoteExactOut`.

- The **caller must be a contract** implementing `IXYCSwapCallback.xycSwapCallback(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address maker, address app, bytes32 strategyHash, bytes calldata takerData)` (selector `0x2c7e784a`, examples/apps/interfaces/IXYCSwapCallback.sol:21-30). An EOA cannot call `swapExactIn` directly (call to EOA returns success with empty data? No — Solidity's high-level call to an address without code reverts via `extcodesize` check; and a contract without the function reverts). Doc comment: "The callback is invoked after the output tokens are sent but before input validation."
- Failure to push → `MissingTakerAquaPush(tokenIn, actual, expected)` (`testMissingTakerAquaPush` L482-495: expects `(token0, 50, 60)` for 50 reserve + 10 in).
- `to` may be any address (`testSwapWithDifferentRecipients`), including the taker contract itself; output tokens come **directly from the maker's wallet**.
- Rounding: integer division floors output; tiny swaps yield 0 (`testVerySmallAmounts`) and a swap with `amountIn = 0` yields 0 (`testZeroAmountSwap`). Pool can never be fully drained (`testSwapExceedingPoolBalance`).
- Gas (measured, recipe): `swapExactIn` ≈ 77.9k on a warm pair, including pull + callback + push; taker wrapper total 111k; `quoteExactIn` ≈ 10.2k.
- Security tests in `examples/test/XYCNestedSwaps.t.sol`: cross-app pull isolation (random address pulling under another hash → underflow), unauthorized push = donation, over-push during callback = donation with no advantage. There is **no maker-side protection against price staleness**: reserves are whatever the virtual balances are; MEV/arbitrage against a maker's stale strategy is by design ("arbitrage transforms from a cost into a revenue stream" — whitepaper §4.1).

---

## 11. Security model and invariants (code-derived)

1. **Custody**: Aqua never holds tokens (asserted in the recipe: `tokenA.balanceOf(aqua) == 0` after a swap). Exposure of a maker = min(ERC-20 allowance to Aqua, wallet balance, Σ shipped virtual balances per app).
2. **Authorization**: `ship`/`dock` by maker (`msg.sender`); `pull` by app (`msg.sender`); `push` by anyone. No owner/admin path touches balances.
3. **Immutability**: a `(maker, app, hash, token)` slot transitions `0 → N → 0xFF` exactly once; never back. Change = dock + ship with new bytes (new `salt`).
4. **Accounting**: virtual balance changes only via `ship` (set), `push` (+), `pull` (−), `dock` (→0). `Σ pulled ≤ shipped + Σ pushed` per token.
5. **Isolation**: balances are keyed by app; an app cannot pull another app's allocation (`testAppIsolationPullProtection`), nor a different strategy's, nor a different maker's.
6. **Reentrancy**: Aqua itself is CEI-safe; apps using optimistic pull-then-callback must use the per-strategy transient lock, and `_safeCheckAquaPush` enforces that the lock is held.
7. **Economic (whitepaper §6.2)**: illiquidity when wallet < virtual (pulls revert, quotes still computed on virtual balances → stale price risk when liquidity returns), IL bounded for invariant AMMs, path-dependent losses for Dutch-auction-like strategies. Best practices §6.3: set ERC-20 approvals aligned with active strategy needs; monitor virtual vs real; dock underperformers; diversify.

---

## 12. Minimal Foundry recipe (VERIFIED: passes locally and on a Base fork against the canonical registry)

Scratch project used: `/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad/aqua-recipe/` (`foundry.toml`, `remappings.txt`, `test/AquaRecipe.t.sol`).

`foundry.toml`
```toml
[profile.default]
solc_version = "0.8.30"
optimizer = true
optimizer_runs = 700
via_ir = true
evm_version = "cancun"      # transient storage for AquaApp locks
```
`remappings.txt` (point at any checkout of the npm packages; SwapVM's node_modules has all four)
```
forge-std/=node_modules/forge-std/src/
@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/
@1inch/solidity-utils/=node_modules/@1inch/solidity-utils/
@1inch/aqua/=node_modules/@1inch/aqua/
```
`test/AquaRecipe.t.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { XYCSwap } from "@1inch/aqua/examples/apps/XYCSwap.sol";
import { IXYCSwapCallback } from "@1inch/aqua/examples/apps/interfaces/IXYCSwapCallback.sol";

contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) { }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// Taker: initiates the swap and, inside the app's callback, pushes tokenIn into the maker's strategy balance.
contract Taker is IXYCSwapCallback {
    IAqua public immutable AQUA;
    constructor(IAqua aqua) { AQUA = aqua; }
    function swap(XYCSwap app, XYCSwap.Strategy calldata s, bool zeroForOne, uint256 amountIn, uint256 minOut) external returns (uint256) {
        return app.swapExactIn(s, zeroForOne, amountIn, minOut, msg.sender, "");
    }
    function xycSwapCallback(address tokenIn, address, uint256 amountIn, uint256, address maker, address app, bytes32 strategyHash, bytes calldata) external override {
        IERC20(tokenIn).approve(address(AQUA), amountIn);
        AQUA.push(maker, app, strategyHash, tokenIn, amountIn);   // Aqua does transferFrom(taker -> maker)
    }
}

contract AquaRecipeTest is Test {
    IAqua aqua; XYCSwap app; MockERC20 tokenA; MockERC20 tokenB; Taker taker;
    address maker = makeAddr("maker");
    address trader = makeAddr("trader");
    uint256 constant LIQ = 1_000e18;

    function _aqua() internal virtual returns (IAqua) { return new Aqua(); }

    function setUp() public virtual {
        aqua = _aqua();
        app = new XYCSwap(aqua);
        tokenA = new MockERC20("A", "A"); tokenB = new MockERC20("B", "B");
        taker = new Taker(aqua);
        tokenA.mint(maker, LIQ); tokenB.mint(maker, LIQ); tokenA.mint(address(taker), 100e18);
        vm.startPrank(maker);
        tokenA.approve(address(aqua), type(uint256).max);   // one-time; tokens never leave the wallet until a swap
        tokenB.approve(address(aqua), type(uint256).max);
        vm.stopPrank();
    }

    function test_ship_swap_dock() public {
        XYCSwap.Strategy memory s = XYCSwap.Strategy({ maker: maker, token0: address(tokenA), token1: address(tokenB), feeBps: 30, salt: bytes32(0) });
        bytes memory enc = abi.encode(s);
        bytes32 h = keccak256(enc);
        address[] memory tokens = new address[](2); tokens[0] = address(tokenA); tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2); amounts[0] = LIQ; amounts[1] = LIQ;

        // ---- ship ----
        vm.expectEmit(true, true, true, true, address(aqua)); emit IAqua.Shipped(maker, address(app), h, enc);
        vm.expectEmit(true, true, true, true, address(aqua)); emit IAqua.Pushed(maker, address(app), h, address(tokenA), LIQ);
        vm.expectEmit(true, true, true, true, address(aqua)); emit IAqua.Pushed(maker, address(app), h, address(tokenB), LIQ);
        vm.prank(maker);
        bytes32 got = aqua.ship(address(app), enc, tokens, amounts);
        assertEq(got, h, "strategyHash == keccak256(abi.encode(strategy))");
        (uint256 b0, uint256 b1) = aqua.safeBalances(maker, address(app), h, address(tokenA), address(tokenB));
        assertEq(b0, LIQ); assertEq(b1, LIQ);
        (, uint8 cnt) = aqua.rawBalances(maker, address(app), h, address(tokenA)); assertEq(cnt, 2);
        assertEq(tokenA.balanceOf(maker), LIQ, "ship moved no tokens");

        // ---- swap A -> B through the app ----
        uint256 amountIn = 10e18;
        uint256 expectedOut = app.quoteExactIn(s, true, amountIn);
        vm.expectEmit(true, true, true, true, address(aqua)); emit IAqua.Pulled(maker, address(app), h, address(tokenB), expectedOut);
        vm.expectEmit(true, true, true, true, address(aqua)); emit IAqua.Pushed(maker, address(app), h, address(tokenA), amountIn);
        vm.prank(trader);
        uint256 out = taker.swap(app, s, true, amountIn, expectedOut);
        assertEq(out, expectedOut);
        assertEq(tokenB.balanceOf(trader), out, "trader received tokenB directly from maker wallet");
        assertEq(tokenA.balanceOf(maker), LIQ + amountIn); assertEq(tokenB.balanceOf(maker), LIQ - out);
        assertEq(tokenA.balanceOf(address(aqua)), 0, "Aqua never custodies tokens");
        (b0, b1) = aqua.safeBalances(maker, address(app), h, address(tokenA), address(tokenB));
        assertEq(b0, LIQ + amountIn); assertEq(b1, LIQ - out);

        // ---- dock ----
        vm.expectEmit(true, true, true, true, address(aqua)); emit IAqua.Docked(maker, address(app), h);
        vm.prank(maker); aqua.dock(address(app), h, tokens);
        (uint248 raw, uint8 cnt2) = aqua.rawBalances(maker, address(app), h, address(tokenA));
        assertEq(raw, 0); assertEq(cnt2, 0xff, "docked marker");
        vm.expectRevert(abi.encodeWithSelector(IAqua.StrategiesMustBeImmutable.selector, address(app), h));
        vm.prank(maker); aqua.ship(address(app), enc, tokens, amounts);   // cannot re-ship same hash
    }
}

/// Same recipe against the canonical registry on a Base fork.
contract AquaRecipeForkTest is AquaRecipeTest {
    address constant AQUA_REGISTRY = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;   // must be EIP-55 checksummed
    function _aqua() internal override returns (IAqua) {
        vm.createSelectFork("https://mainnet.base.org");
        assertGt(AQUA_REGISTRY.code.length, 0, "registry deployed");
        return IAqua(AQUA_REGISTRY);
    }
}
```
Run: `forge test -vv` → `AquaRecipeTest` 2/2 pass (211,665 gas for the lifecycle test), `AquaRecipeForkTest` 2/2 pass on Base (3.1 s). For a demo on Anvil: `anvil --fork-url https://mainnet.base.org` then `forge script`/`cast send` against `0x1111113CCf…`; `make anvil NODE_URL=…` in the aqua repo does the same on port 8546.

Cheat-sheet for hand-rolled `cast` calls:
```
cast send $AQUA "ship(address,bytes,address[],uint256[])" $APP $STRATEGY_BYTES "[$T0,$T1]" "[$A0,$A1]" --private-key $MAKER_PK
cast call $AQUA "safeBalances(address,address,bytes32,address,address)(uint256,uint256)" $MAKER $APP $HASH $T0 $T1
cast send $AQUA "dock(address,bytes32,address[])" $APP $HASH "[$T0,$T1]" --private-key $MAKER_PK
cast keccak $STRATEGY_BYTES            # == strategyHash
```

---

## 13. Whitepaper (docs/whitepaper-aqua-1.0.pdf, "1inch Aqua — Shared Liquidity Layer", Release 1.0; authors Anton Bukov, Sergej Kunz, Gleb Alekseev, Sergey Prilutskiy)

**Thesis**: "LP-centric shared liquidity layer" built on two principles: (1) capital remains in LP wallets; (2) the same assets back multiple trading strategies simultaneously. Claims 85–97% of AMM liquidity sits idle on 90% of days in 2025 (Uniswap v2 94%, v3 85%, v4 84%, Curve 83%, PancakeSwap 89%, Balancer 97%; source dune.com/1inch/idle). Three problems: idle capital, fragmentation across pools/fee tiers/ranges, "DeFi-disabled" locked capital (no governance, no collateral use).

**Protocol design (§3)**: four-level mapping `Maker → App → Strategy Hash → Token → Balance` ("virtual balance storage hierarchy"). "Each Maker can authorize multiple Apps, each App can run multiple Strategies (identified by a hash of their immutable parameters), and each Strategy tracks balances for multiple tokens." "The AMM never owns the liquidity (only receives shared access)." `push()` auto-reinvests: "any tokens an AMM receives through trading automatically become available for reinvestment". Illiquidity: when wallet < virtual, pulls revert; "the AMM continues quoting prices based solely on virtual balances without checking real balances or allowances, preserving price continuity" — exposes makers to IL-like loss on the first trade after liquidity returns; "Makers are strongly recommended to manually dock strategies that become chronically underfunded". PMMs can share LP capital via virtual balances ("this grants PMMs the ability to pull funds (creating custodial exposure)").

**Economics (§4)**: "Dual efficiency" (capital + utility). Example: 1,000 USD equity → 3,000 USD collateral via money markets → provisioned across 3 strategies = 9,000 USD notional (9× = 3× leverage × 3× sharing). SLAC formula = Σ over strategies of token liquidity ÷ Σ wallet liquidity ≥ 1. Arbitrage becomes "fair volume" revenue when utilization is high; §4.3 "Fair and Unfair Volumes" (unfair = flow without price optimization, e.g. dapps routing only to their own AMM — extra profit). §4.2 "Specialization over Homogenization": Aqua accepts O(n) per-maker/strategy complexity instead of pooled O(1), relying on aggregators/solvers to discover liquidity off-chain; "a breakthrough strategy can go from zero to significant liquidity in minutes"; competition shifts "from TVL to formula optimization".

**Lifecycle (§5)**: ship = "assembly and activation" (pure configuration), utilization = "auto-compounding yields", continuous optimization (test 15 bps vs 30 bps on the same pair with identical backing), retirement via dock ("instantly revokes virtual balances without moving funds"). Figure 3 shows one wallet backing WETH/stETH "Stable AMM", USDC/USDT "Stable AMM", and four "Concentrated AMM" cross pairs simultaneously — i.e. **multi-strategy, multi-app composition from one wallet is the intended use**.

**Security (§6)**: three pillars — maker-controlled custody, allowance-based access, "balance invariants guarantee settlement: every pull() checks real wallet balances, reverting if insufficient … no partial fills, no bad debt, no protocol insolvency". Economic risks: illiquidity (temporary), bounded IL for invariant AMMs, path-dependent losses for e.g. Dutch auctions.

**Future-direction hints** (explicit or implied): dynamic-fee AMMs, inventory-based pricing, concentrated liquidity, Dutch auctions, RFQ/PMM strategies, money-market leverage on top of Aqua balances, off-chain indexers/solvers reading `Shipped` events, DAO-voting while providing liquidity. The license text mentions an "Aqua Manifest" artifact and "Aqua App (strategy runner)" — not present in this repo (UNCERTAIN what they are; possibly SwapVM-side).

---

## 14. License: `LicenseRef-Degensoft-Aqua-Source-1.1` (LICENSES/Aqua-Source-1.1.txt) — hackathon-relevant points

- **§4 Non-Commercial Free Use**: "Non-commercial use (including experimentation, prototyping, **hackathons**, research, community pilots) is free of charge, subject to Section 3 for any Modifications". ⇒ A hackathon submission is explicitly OK.
- **§2.1/§2.2**: may use/copy/distribute unmodified source; "Pure Caller Use" (forming calldata, reading state via ABIs) triggers nothing.
- **§3 Copyleft for Modifications** (applies if you modify/extend/incorporate — building an `AquaApp` subclass or a modified SwapVM **is** a Modification per §1.7 "any change to, or work based on or incorporating, the Licensed Work, including … instruction sets executing in the same virtual machine/address space"): you must (A) publish your modifying/extending code under the **same license** at no charge, (B) preserve notices, (C) add prominent attribution **"Powered by Aqua — © Degensoft Ltd 2025"** in README and UI, (D) mark changes and dates, (E) provide reproducible build/deploy instructions. §3.3: independent code that merely calls Aqua is exempt from A–B.
- **§2.4**: any public communication of outputs/analysis must preserve notices and attribute "Aqua — © Degensoft Ltd 2025".
- **§5 Commercial triggers**: Charged Fees > US$100k in a rolling year or LUC > US$10M, or any commercial use → Commercial License needed (contact license@degensoft.com within 15 days). §5.3 currently waives enforcement for "Volume Activities" (routing, aggregation, arbitrage, market-making), revocable.
- **§7.2 Trademarks**: no right to use Degensoft/Aqua/1inch names/logos except truthful compatibility statements; "Powered by Aqua" designation requires compliance with brand guidelines (tension with §3.1C — UNCERTAIN; safest: include the exact attribution string, no logos).
- **§7.1**: you may not patent anything incorporating Aqua.
- Practical checklist for the submission repo: keep `// SPDX-License-Identifier: LicenseRef-Degensoft-Aqua-Source-1.1` + `@custom:license-url` + `@custom:copyright © 2025 Degensoft Ltd` headers on any file derived from Aqua/SwapVM; add `LICENSES/Aqua-Source-1.1.txt`; README line "Powered by Aqua — © Degensoft Ltd 2025"; a CHANGES section with dates; build/deploy instructions. Third-party deps: forge-std (Apache-2.0/MIT), OpenZeppelin 5.4.0 (MIT), solidity-utils (MIT) — keep `THIRD_PARTY_NOTICES`.

---

## 15. Design implications / gotchas for building an Aqua app (hackathon)

1. **Optimistic pull → callback → check** is the canonical pattern (flash-swap-like: taker receives output before paying). Alternative without callback: app `transferFrom`s from taker and pushes itself (README L294-316).
2. **Include `maker` (and a `salt`) in your strategy struct**; compute `hash = keccak256(abi.encode(strategy))` identically on-chain and off-chain (`cast keccak`/viem `keccak256(encodeAbiParameters(...))`).
3. **Multi-token strategies work natively** (up to 254 tokens; `safeBalances` is pairwise; `dock` must list all). Nothing stops N-asset AMMs, baskets, or multi-leg positions.
4. **Balances are per app address**: an upgraded/redeployed app needs makers to re-ship. Strategy bytes can embed anything (curves, oracles, expiry, allowed takers) — Aqua doesn't care.
5. **Anyone can `push`** into an active strategy, so apps can implement deposit-like flows (third-party top-ups, fee accrual, donations). Maker-controlled rebalancing is `dock` + `ship` (no transfers). An app can also move value between two of the same maker's strategies by `pull`ing tokenA to itself and then `push`ing it into the other strategy — the maker's wallet is net-zero, only virtual balances move; this compiles against the interface and is cheap, but UNCERTAIN whether 1inch considers it idiomatic (README says pull/push are "swap execution only"). `pull(..., to = maker)` is possible too: it lowers the virtual balance without changing the wallet.
6. **Virtual ≠ real**: over-ship is allowed; build quoting that tolerates `pull` reverts, or check `IERC20.balanceOf(maker)`/`allowance(maker, aqua)` in views for UX.
7. **Same strategy → many makers**: because balances are keyed by maker, a "shared curve" (same params, many wallets) requires the app to iterate makers off-chain (whitepaper's O(n)); aggregators do routing.
8. **Events are un-indexed** — indexers filter by topic0 and decode; `Shipped` includes full strategy bytes.
9. **SwapVM router is itself an Aqua app** (uses `orderHash` as strategyHash; pulls at `SwapVM.sol:361`, pushes at `:273`, reads via `safeBalances` `:168/:222`, `rawBalances` `:276`). A custom SwapVM opcode set that re-deploys a modified SwapVM keeps talking to the same registry — no Aqua changes needed.
10. **Transient storage** ⇒ app tests need `evm_version = "cancun"` (or newer); Anvil defaults are fine.
11. **Gas budget**: registry ops are ~1 slot each; an XYCSwap-like swap ≈ 78k gas.

---

## 16. Cross-references
- SwapVM (separate KB): `refs/swap-vm/src/SwapVM.sol` lines 10, 84, 96, 168, 222, 273, 276, 361; `src/libs/ProtocolFee.sol:5,125,181` take `IAqua`.
- TS SDK (separate KB): `refs/sdks/typescript/aqua/src/{abi, aqua-protocol-contract, index.ts}`, tests `tests/aqua.spec.ts`, `tests/setup-evm.ts`.
- README ASCII diagram (README.md:26-54) and Figure 1/2 of the whitepaper illustrate LP → Aqua → {App A, App B, App C} → Takers.

## 17. Open questions / UNCERTAIN
- Exact `AquaRouter` deployment tx/CREATE2 factory and compiler settings of the on-chain bytecode (metadata not compared); only codehash equality across 3 chains verified.
- Whether `InvalidAquaStrategy` is thrown by SwapVM or any official app.
- What the license's "Aqua Manifest" / "Aqua App (strategy runner)" refer to.
- Behavior of `ship` with empty `tokens` and of `pull` with `amount = 0` on tokens that reject zero transfers (not tested upstream).
- Whether 1inch intends `pull`-to-self / cross-strategy rebalancing by apps as a supported pattern.
- Full list of chains where the registry is live beyond ETH/Base/Arbitrum (README list not verified).
