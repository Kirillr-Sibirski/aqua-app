# Uniswap v4 hook developer feedback

Written while porting an existing production-shaped contract onto v4: an RMM-01 covered-call curve
(Angeris–Evans–Chitra 2021 §3.3) that already ran as a custom 1inch SwapVM instruction. The port is
`contracts/src/hooks/StrikelineHook.sol` (12,845 B runtime), a full custom-accounting hook —
`beforeSwapReturnDelta` consumes the entire swap, concentrated liquidity is refused, and the hook
keeps its own reserve ledger. Tests are in `contracts/test/hook/`. Versions: `@uniswap/v4-core`
1.0.2, `@uniswap/v4-periphery` 1.0.3, Foundry `1.0.0-dev` (7461390), solc 0.8.30.

Everything below is something that cost time or that I had to derive from source. The ranking at the
end is what I would actually change.

---

## 1. `PoolManager.sol` is pinned to an exact pragma, and it is the only file that is

Every other file in `v4-core/src` is `^0.8.0`, `^0.8.20` or `^0.8.24`. `PoolManager.sol` alone says
`pragma solidity 0.8.26;`. Because the pin is exact, **no file on a newer exact pragma can import
it** — this is a resolver error, not a compiler downgrade:

```
Error: Found incompatible versions:
test/hook/Spike.t.sol =0.8.30 imports:
    node_modules/@uniswap/v4-core/src/PoolManager.sol =0.8.26
```

Dropping our own `solc_version` pin does not help, because the *importing test file* still declares
`0.8.30` and also imports our own `0.8.30`-pinned contracts. There is no version that satisfies both
graphs.

The hook itself is unaffected — it only needs `IPoolManager` and the libraries, all of which are
caret ranges. But every hook project has tests, and every hook test needs a real `PoolManager`. The
constraint therefore hits 100% of integrators while looking like it hits none of them.

**Fix:** `^0.8.26`. If the exact pin is deliberate (reproducible deployed bytecode), say so in
`README.md` and ship a `PoolManagerDeployer` shim, because right now everyone writes their own.

## 2. v4-core does not compile at ordinary optimizer settings

Removing our version pin surfaced the second wall. At `optimizer_runs = 700` with `via_ir = true`:

```
Error: Yul exception: Variable memPtr_1 is 1 too deep in the stack
  [ memPtr_1 _4 var_self_5349_slot var_amountToProtocol expr var_swapFee _3
    var_amountCalculated var_params_5352_mpos RET var_amountSpecifiedRemaining ... ]
```

That is `Pool.swap`. `v4-core/foundry.toml` builds at `optimizer_runs = 44444444`, so that number is
effectively part of the source contract — but it appears in neither the docs nor the package README,
and the failure mode is a Yul internal error with no mention of optimizer settings. An integrator
whose repo runs at 200 or 700 runs (i.e. anyone optimising for deploy cost, which is the normal
choice for a contract near EIP-170) will hit this and have no idea why.

**Fix:** one line in the hook docs — "v4-core requires `optimizer_runs` in the millions; scope it
with `compilation_restrictions` if your own contracts need fewer" — plus the ready-made TOML block.
That block took me three attempts to get right and is not obvious from Foundry's docs either.

## 3. The escape hatch is undocumented, and it is the best route

Both npm packages ship a full vendored `lib/` (forge-std, openzeppelin-contracts, solmate, permit2)
**and a prebuilt `out/`**: 42 MB and 77 MB unpacked. `node_modules/@uniswap/v4-core/out/
PoolManager.sol/PoolManager.json` contains the canonical 24,009-byte runtime, built with Uniswap's
own settings. Deploying *that* sidesteps §1 and §2 completely:

```solidity
pm = IPoolManager(deployCode(
    "node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json", abi.encode(owner)
));
```

It is also more faithful than compiling it yourself, since it is the bytecode you would meet on
mainnet. Nothing in the docs mentions that the artifacts are shipped. This should be the documented
default for hook test suites.

## 4. `CurrencySettler` — the load-bearing helper — lives in a test directory

The whole custom-accounting pattern routes through `settle`/`take`, and the canonical implementation
is `v4-core/test/utils/CurrencySettler.sol`. So a production hook imports from another package's
`test/` folder. It is 30 lines and it is the correct 30 lines; it belongs in `src/libraries/` or in
periphery next to `BaseHook`.

## 5. `BeforeSwapDelta` sign conventions are the hardest part and are documented by example only

This is the one thing that genuinely required reading `PoolManager.swap` and `Hooks.beforeSwap`
side by side. What I eventually needed, and what no page states:

- `amountToSwap = amountSpecified + deltaSpecified`, so a full no-op is
  `deltaSpecified = -amountSpecified` — in **both** directions and **both** exactness modes.
- The *specified* currency is the **input** currency on exact-in and the **output** currency on
  exact-out. It flips. `deltaUnspecified` therefore refers to a different token depending on a flag
  the hook has to re-derive.
- Both deltas are signed from the **hook's** perspective: positive is a credit the hook must `take`,
  negative is a debt the hook must `settle`.

Written out, the uniform rule is four lines:

```solidity
deltaSpecified   = -amountSpecified;                            // always
deltaUnspecified = exactIn ? -int256(amountOut) : int256(amountIn);
inputCurrency.take(poolManager, ..., amountIn, ...);            // always
outputCurrency.settle(poolManager, ..., amountOut, ...);        // always
```

`CustomCurveHook` demonstrates only the exact-in 1:1 case, which is the case where the two branches
happen to coincide, so it teaches the reader nothing about the flip. Four lines in the docs would
have saved a couple of hours.

## 6. A hook cannot pay ERC-20 to a third party inside `beforeSwap`

This is the finding with real design consequences, and it is the one I would most like written down.

`poolManager.take(currency, recipient, amount)` moves real ERC-20 out of the PoolManager. Inside
`beforeSwap` the taker has **not settled yet**, so the manager does not hold the taker's input. On
mainnet the call still succeeds, because the manager holds every other pool's reserves and flash
accounting nets out by the end of `unlock` — but that means a hook paying an ERC-20 to a wallet is
silently *borrowing other pools' balances* for the rest of the transaction. It works, it is safe by
construction, and it reads as extremely alarming. On a fresh deployment it simply reverts.

The safe route is `claims: true`, i.e. mint ERC-6909. That is correct but it changes the product:
the recipient is paid in claims inside the PoolManager, not in tokens. Spending them costs a second
transaction *and* a second approval (`setOperator`, because only the owner or an operator may burn).

For any hook whose liquidity source is a wallet rather than the pool, this is the defining
constraint. In our measurements it is the single clearest thing a v4 hook cannot do that our
existing venue can: the maker's proceeds arrive as tokens in their wallet in the same call.

**Ask:** state it explicitly in the hook docs — "inside `beforeSwap` the swapper has not settled;
`take` with `claims: false` spends PoolManager's existing balance" — and say which pattern is
intended.

## 7. `PoolKey` has nowhere to put a hook's parameters

`(currency0, currency1, fee, tickSpacing, hooks)`. Our instrument has a strike, an implied vol, an
expiry and a liquidity constant. A four-leg option ladder on one pair therefore needs four distinct
pool ids, and the only fields a maker can vary are `fee` and `tickSpacing` — so `fee` becomes a
nonce and no longer means fee. Any indexer reading `fee` off our pools is wrong.

Compounding it, **`beforeInitialize` receives no `hookData`** — just `(sender, key, sqrtPriceX96)`.
A hook cannot be configured atomically with the pool it belongs to. You need `initialize` then a
separate `configure`, and between them anyone can initialise your key. We ended up with a
`PoolId => Leg` registry and a first-writer-wins rule, which is a squatting surface that exists only
because of the missing field.

**Fix:** a `bytes32 salt` (or `extraData`) in `PoolKey`, and `hookData` on `initialize`. The first
gives parameterised hooks a real identity; the second makes configuration atomic. Between them they
would remove the ugliest part of this port.

## 8. Address mining is worse than it needs to be

Measured here for three permission bits, each iteration rehashing **13,516 bytes** of creation code:
**6,748 salts / 21.6M gas** inside `forge test` — and then **21,706 salts / 79.7M gas** after the only
change in between was `forge fmt`. Reformatting whitespace moves the source-metadata hash, which moves
the creation code, which moves the salt, which moves the deployed address. A comment edit relocates
your hook. The cause of the cost is one line in `HookMiner.computeAddress`:

```solidity
keccak256(abi.encodePacked(bytes1(0xFF), deployer, salt, keccak256(creationCodeWithArgs)))
```

`keccak256(creationCodeWithArgs)` is loop-invariant and gets recomputed on every salt. Hoisting it
into `find` is a one-line change worth roughly two orders of magnitude. (In tests, `deployCodeTo` to
a hand-picked address with the right low bits is far better, and that *is* what `BaseHook`'s virtual
`validateHookAddress` is for — but it took reading the source to realise it.)

And because the salt depends on the creation code, a project that mines in CI has a build time that
is non-deterministic in wall clock — 3.2x between two runs here, from a formatting pass. Setting
`bytecode_hash = "none"` (which v4-core itself does) removes the metadata sensitivity but not the
grind.

## 9. Toolchain interaction, for whoever owns the Foundry template

Two-compiler projects are fragile in a way that looks like a v4 problem:

- `vm.getCode("PoolManager.sol:PoolManager")` **never** resolved an artifact produced by a
  non-default compiler profile, even with the JSON sitting on disk. Only the explicit
  `out/PoolManager.sol/PoolManager.json` form worked, and that needs an `fs_permissions` entry
  (error: *"the path ... is not allowed to be accessed for read operations"*).
- After `forge build --force` the 0.8.26 artifacts exist; after the next incremental `forge test`
  they are gone and `deployCode` fails with `no matching artifact found`. Reproducible.

Neither is Uniswap's bug, but a v4 hook is the most common reason to end up with two compiler
versions in one project, so the hook template is where the workaround should live.

## 10. What worked well, stated because it is not obvious from the outside

- **Flash accounting made the wallet-backed variant possible at all.** Being able to price, check a
  real wallet balance, and settle from that wallet inside one `unlock` is genuinely more than most
  AMMs allow. The hook that ties our own venue on three of four measured axes exists because of it.
- **`Pool.swap` returns before the price-limit check when `amountSpecified == 0`.** That is exactly
  right for no-op hooks — the caller's `sqrtPriceLimitX96` becomes irrelevant rather than a trap.
  Undocumented, though, so we asserted it in a test rather than trust it.
- **Permission bits in the address** are a good design: `getHookPermissions` and the address agree by
  construction, and `BaseHook` validates it in the constructor. The mining cost is the price.
- **`BaseHook`'s internal `_beforeSwap` / external `beforeSwap` split** with `onlyPoolManager`
  already applied is the right shape. Nothing to change.

---

## Ranked asks

1. **`hookData` on `initialize`, and a `salt`/`extraData` field in `PoolKey`.** Parameterised hooks
   are a whole category — options, structured products, anything with terms — and today they are
   forced into a squattable registry with `fee` abused as a nonce.
2. **Document what a hook may and may not do with currency inside `beforeSwap`** (§6). This changes
   product design, not just code.
3. **Relax `PoolManager.sol` to `^0.8.26`** (§1), and document the optimizer requirement (§2).
   Two lines of source, one paragraph of prose, and the first hour of every port goes away.
4. **Move `CurrencySettler` into `src`** (§4) and add the four-line `BeforeSwapDelta` rule to the
   docs, covering exact-out (§5).
5. **Hoist the codehash out of `HookMiner`'s loop** (§8), and point test authors at `deployCodeTo`
   before they mine anything.
