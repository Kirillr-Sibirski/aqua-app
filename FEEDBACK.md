# Uniswap v4 hook developer feedback

Strikeline (ETHGlobal ETHOnline 2026) ported an RMM-01 covered-call curve onto v4 as a custom-accounting
hook: `contracts/src/hooks/StrikelineHook.sol`. `beforeSwap` returns a delta that takes over the whole
swap, and the hook keeps its own reserves. We compared it with the same curve on 1inch Aqua in
`contracts/test/hook/VenueExperiment.t.sol`.

Versions: `@uniswap/v4-core` 1.0.2, `@uniswap/v4-periphery` 1.0.3, solc 0.8.30 (exact pin), `via_ir`.
Paths below are relative to `node_modules/@uniswap/`.

---

## 1. `PoolManager.sol` is the only exactly-pinned file

**What we hit.** Our project pins solc `0.8.30` exactly. Our test files could not import `PoolManager`
because Foundry reported incompatible versions.

**Evidence.** `v4-core/src/PoolManager.sol:2` is `pragma solidity 0.8.26;`. Every other file in
`v4-core/src` uses a caret range. The hook itself is fine, since it only imports interfaces and libraries.

**Suggestion.** The pin may be deliberate. If so, a short note on how to deploy `PoolManager` in tests
from a project on a newer exact compiler would help. If not, relaxing it to `^0.8.26` would remove the
problem.

## 2. With `via_ir`, some optimizer settings fail with stack-too-deep

**What we hit.** Our project uses `optimizer_runs = 700`. Compiling v4-core there failed with
`Yul exception: Variable ... is 1 too deep in the stack`, and the error does not point at optimizer
settings.

**Evidence.** With `via_ir`, v4-core 1.0.2 compiled at 200, 10,000, 1,000,000 and 44,444,444 runs, and
failed at 500, 700 and 1,000. So whether a setting works is hard to predict. `v4-core/foundry.toml`
uses 44,444,444.

**Suggestion.** List the compiler settings that are known to work for integrators who compile v4-core
from source.

## 3. The npm package ships a prebuilt `PoolManager` artifact

**What we hit.** Deploying from that artifact avoided both §1 and §2. We found it by looking through
`node_modules`.

**Evidence.** `v4-core/out/PoolManager.sol/PoolManager.json` is 24,009 B runtime, built with solc
0.8.26 at 44,444,444 runs. Periphery ships `foundry-out/`, not `out/`, and its `lib/` contains `permit2`
and `v4-core`. Unpacked sizes are about 43 MB (core) and 79 MB (periphery).

```solidity
pm = IPoolManager(deployCode("node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json", abi.encode(owner)));
```

**Suggestion.** If this is supported, a line in the hook testing docs would save people time.

## 4. Unclear whether to copy `CurrencySettler` or use `DeltaResolver`

**What we hit.** Custom-accounting hooks need a settle/take helper. The one the core examples use is in
a test directory.

**Evidence.** `v4-core/test/utils/CurrencySettler.sol` is used by `v4-core/src/test/CustomCurveHook.sol`.
Periphery has `v4-periphery/src/base/DeltaResolver.sol`, which does a similar job.

**Suggestion.** Say which one production hooks should use.

## 5. The only custom-curve example prices 1:1

**What we hit.** The sign conventions are documented in NatSpec: `v4-core/src/interfaces/IHooks.sol:101`
and `v4-core/src/types/BeforeSwapDelta.sol`. Applying them to a curve where input and output differ took
us longer than expected.

**Evidence.** `v4-core/src/test/CustomCurveHook.sol` handles exact-in and exact-out, and
`test/CustomAccounting.t.sol:134` tests exact-out. But it uses one `amount` for both sides (lines 43–47).
That hides which amount belongs to the specified currency and which to the unspecified one, and which
token each is in each direction.

**Suggestion.** A worked example with a price other than 1:1, covering exact-in and exact-out.

## 6. `take` inside `beforeSwap` pays from the PoolManager's current balance

**What we hit.** Our hook pays a maker inside `beforeSwap`. We wanted to know whether the tokens it
takes out have already been paid in by the swapper.

**Evidence.** `test_Feedback_TakeSpendsThePoolManagersOwnBalance` in
`contracts/test/hook/StrikelineHook.t.sol` calls `take` with no matching credit. When the PoolManager
holds no USDC, the ERC-20 transfer reverts. When the PoolManager holds someone else's USDC, the transfer
succeeds and the call reverts with `CurrencyNotSettled` only when `unlock` closes. This is how flash
accounting is meant to work. Whether the swapper has paid by then depends on the router. Periphery's
`Actions.SETTLE` can pay first, and `v4-core/src/test/PoolSwapTest.sol` settles after `swap` returns
(lines 59, 103–106).

**Suggestion.** A short note in the hook docs saying where a `take` inside `beforeSwap` is paid from,
and which payout pattern (ERC-20 or ERC-6909 claims) is recommended for hooks that pay third parties.
We chose ERC-6909 claims for our wallet-backed legs.

## 7. Where should per-pool hook parameters go?

**What we hit.** Each option leg has its own strike and expiry, so each needs its own pool. `PoolKey` is
`(currency0, currency1, fee, tickSpacing, hooks)`. We put the leg terms into the `fee` field so that each
leg gets a separate pool id, which means `fee` no longer means fee on our pools.

**Evidence.** `IHooks.beforeInitialize(sender, key, sqrtPriceX96)` (`IHooks.sol:21`) gets no `hookData`.
A hook can still set a pool up atomically by calling `initialize` itself in the same transaction. We did
not do that. We register legs first-writer-wins, and that is where the front-running risk in our design
comes from.

**Suggestion.** Guidance or an example showing the intended way to give a pool its own hook parameters.

## 8. `HookMiner` rehashes the creation code for every salt

**What we hit.** Mining a hook address in tests used a lot of gas.

**Evidence.** `v4-periphery/src/utils/HookMiner.sol:54` computes `keccak256(creationCodeWithArgs)` inside
`computeAddress`, and `find` calls it for every salt (line 33). The hash is the same on every iteration.

**Suggestion.** Hash the init code once before the loop. The speedup is small but safe, and this code
only runs in tests and scripts.

## 9. What worked well

- **Flash accounting.** Our hook can price a trade, check a maker's wallet balance and settle from that
  wallet in one `unlock`. The wallet-backed variant depends on this.
- **Zero-amount swaps skip the price-limit check.** `v4-core/src/libraries/Pool.sol:320` returns before
  the `sqrtPriceLimitX96` check at line 323. When a hook takes over the whole swap, the caller's limit has
  no effect. `test_Feedback_ANoOpHookMakesThePriceLimitIrrelevant` swaps with the limit set to the pool's
  current price and the swap goes through.
- **Permission bits in the hook address.** The permissions and the address can't disagree, and
  `BaseHook` checks this in its constructor. `validateHookAddress` is virtual, which makes testing easy.
- **`BaseHook`'s split** between the external `beforeSwap` (with `onlyPoolManager`) and the internal
  `_beforeSwap` works well.

---

## Requests, in order of impact for us

1. Document where a `take` inside `beforeSwap` is paid from and which payout pattern is recommended (§6).
2. Give guidance on per-pool hook parameters and atomic setup (§7).
3. Document how to use `PoolManager` from projects on another compiler: the pragma pin (§1), known-good
   optimizer settings (§2), and the shipped artifact (§3).
4. Add a custom-curve example priced other than 1:1, for exact-in and exact-out (§5), and say whether
   hooks should use `CurrencySettler` or `DeltaResolver` (§4).
5. Hash the init code once in `HookMiner.find` (§8).
