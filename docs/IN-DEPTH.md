# Strikeline in depth

The long form behind the [README](../README.md): the two instructions, the read layer, the Uniswap v4
comparison, the replay study, the test evidence, the limits and prior art.

## The two custom SwapVM instructions

### `RmmSwap` — opcode `0x55` ([src](../contracts/src/instructions/RmmSwap.sol))

RMM-01, the covered-call replicating market maker of Angeris, Evans & Chitra (2021), with the
curvature driven by the block clock:

```
Y = L·K·Φ( Φ⁻¹(1 − X/L) − σ√τ )        τ = max(maturity − block.timestamp, 1h) / 365d
```

At spot `S` the no-arbitrage reserve point gives position value `S·X + Y = L·(S − C_BS(S,K,σ,τ))`:
long spot, short a call struck at `K`. By put-call parity the same 62 bytes are a cash-secured put
when the reserves start stable-heavy. Delta is `Φ(−d₁)`; arbitrageurs perform the hedge and the maker
earns theta.

Liquidity is fixed and the invariant offset is zero, so reserves sit exactly on the curve and the
replication claim is provable. That choice is what makes decay a two-sided spread instead of a fee —
and it is why the program deliberately contains **no fee instruction**: a flat fee would push reserves
off the curve and leak the premium to the next taker.

Pure leaf instruction. Reads only `block.timestamp`, touches no storage, so `quote() == swap()` holds
by construction and it runs under `STATICCALL`.

### `Coverage` — opcode `0x93` ([src](../contracts/src/instructions/Coverage.sol))

Aqua deliberately lets a maker over-allocate: `ship()` checks no balance, and `safeBalances()` returns
the virtual number with no clamp to the wallet. The only real check happens inside `Aqua.pull`'s
`transferFrom` — *after* the quote. So a book can advertise depth it cannot deliver.

`Coverage` runs the curve first via a nested `ctx.runLoop()`, then requires the priced output to be
deliverable from the maker's real `balanceOf` ∧ `allowance(maker, AQUA)`. Because every leg reads the
same wallet, **a fill on one leg shrinks its siblings' deliverable depth in the same block** — no
keeper, no shared storage, no message passing. Over-allocation becomes portfolio margin.

It runs *after* the curve on purpose: clamping `balanceOut` beforehand would move the reserve point and
therefore change the **price**, not just the size — quoting a different option than the maker wrote.

## The read layer: reading a market out of a log

A market needs a price list. Before you sell anything you want to know what the same thing is
fetching from everyone else — and here, nobody publishes one. Each offer is a small program its
maker put on chain, and the registry holding it keys that program by the hash of its own bytes and
relates nothing to anything. Two people offering to sell ETH at the same price on the same date are
two unrelated storage slots. There is no order book to read and no feed to subscribe to.

What there is, is the log. `Aqua.ship` takes the strategy *"fully instead of being pre-hashed, for
data availability"*, so the `Shipped` event carries the whole program, and a Strikeline offer's 62
`RmmSwap` argument bytes hold the price, the date, the size and the volatility **in the clear**.
Anyone holding the log can recover the terms of every offer any maker has ever made here — with no
cooperation from the maker, no off-chain book and no price feed. The market is already public. It
has just never been assembled.

**Status:** everything in this section is built and tested, but neither the subgraph nor the lens is
deployed, and the app does not read from either. The app reads `Shipped` logs directly with
`getLogs` and prices each leg with multicalls against the router (`web/src/hooks/useBook.ts`).

*If you already trade options:* this is an implied-volatility surface reconstructed from on-chain
state alone. Strike on one axis, expiry on the
other, σ read straight out of the program bytes rather than solved for, and a cross-maker best bid
at each cell.

### `subgraph/` — a subgraph that does the assembling ([README](../subgraph/README.md))

A subgraph indexes the official Aqua's `Shipped`, `Docked`, `Pushed` and `Pulled` plus our router's
`Swapped`, and **decodes the strategy bytes inside the AssemblyScript mapping** — so what lands in
the index is not a blob keyed by a hash but four entities: `Leg` (one offer: its price, date, size,
vol, live reserves, and whether its depth is margined), `Maker`, `Fill`, and `SurfacePoint`.

`SurfacePoint` is the one that exists nowhere on chain: a cell of the surface, holding every maker
who wrote that option, the widest live vol among them, and the size written across all of them. The
mapping creates and maintains it on every ship and every dock. **That entity is the price list**, and
this is the query it answers:

```graphql
{ surfacePoints(where: { strikeWad: "2800000000000000000000", liveLegCount_gt: 0 }) {
    liveLegCount  maxSigmaWad  liveLiquidityWad
    bestLeg { maker { id } sigmaWad liquidityWad reserveRisky guarded } } }
```

```json
{ "liveLegCount": 2, "maxSigmaWad": "680000000000000000", "liveLiquidityWad": "24000000000000000000",
  "bestLeg": { "maker": { "id": "0x2d4f7b1c…b3a2" }, "sigmaWad": "680000000000000000",
    "liquidityWad": "12000000000000000000", "reserveRisky": "7040000000000000000", "guarded": true } }
```

Three makers wrote that 2,800 call and one withdrew. The better of the two still standing pays 68%
vol, and its size is margined against its wallet rather than merely advertised.

That response is a **transcript from the test harness, not from a deployed index.** `subgraph/tests/` runs the mappings
themselves — compiled with the exact `asc` arguments `graph build` uses, against an in-memory store
playing graph-node's host — and writes the answer out. 18 tests: seven pin the decode to one real
`abi.encode(Order)` captured from the Foundry suite (K, σ, maturity, L, plus the six inputs it must
decline rather than guess at), and eleven ship, push, pull, fill and dock a book of four offers from
three makers and assert the entity graph that comes out.

Aqua's events carry no indexed parameters, so the `app` filter cannot live in the manifest and lives
in the mapping instead — which is also what lets one deployment index every Strikeline offer on the
registry rather than only ours.

### `contracts/src/SurfaceLens.sol` — the numbers a log cannot carry ([src](../contracts/src/SurfaceLens.sol))

The bytes are fixed; the price is not, because it moves with the clock. A view contract prices a
whole book in one call: terms, live Aqua reserves, mark, delta, premium and the theta band per
offer. 9,179 B runtime, a **separate** contract so it spends none of the router's EIP-170
headroom, and it prices the four-leg demo ladder in one `eth_call` for 1,376,728 gas. Every batch
entry is fault-isolated in `try/catch`, so a strategy that is not an offer comes back
`isLeg == false` instead of taking the book down.

This is the read that matters to a solver: one call returns the deliverable depth `Coverage` will
actually honour on every leg at once, which is the number an order book would publish and Aqua does
not have.

The screen that used to render the surface is deleted. The terminal's positions strip decodes the
same `Shipped` bytes in TypeScript for the connected maker's own offers.

```bash
make subgraph                                              # graph codegen && graph build
cd subgraph && npm test                                    # the mapping tests, in WebAssembly
cd contracts && forge test --match-path 'test/surface/*'   # 20 Foundry tests on the lens
```

## The same curve in a pool: a Uniswap v4 hook, and what it costs

[`contracts/src/hooks/StrikelineHook.sol`](../contracts/src/hooks/StrikelineHook.sol) runs the
identical RMM-01 curve as a Uniswap v4 hook, importing
[`RmmPricer.sol`](../contracts/src/hooks/RmmPricer.sol) and the same `Gaussian.sol` / `WadMath.sol`
the Aqua instruction uses. Not a reimplementation: the same code, priced by the same functions.

That makes the comparison a controlled experiment rather than an argument, and we ran it.
[`test/hook/VenueExperiment.t.sol`](../contracts/test/hook/VenueExperiment.t.sol) stands the same
four-leg ladder up in three venues — a v4 pool, a v4 hook paying from the wallet, and Aqua — and
measures four questions. 26 hook tests pass, including a fuzzed parity suite
([`CurveParity.t.sol`](../contracts/test/hook/CurveParity.t.sol)) asserting the pool and the Aqua leg
quote the same price in both directions and across the decay.

| | v4 pooled | v4 wallet-backed | Aqua |
|---|---|---|---|
| Legs of the 4-leg ladder this wallet can fund | **1** | 4 | **4** |
| Gas per fill | **167,618** | 173,866 | 186,995 |
| Standing up 4 legs: on-chain steps / gas | | 8 / 951,363 | **4 / 651,086** |
| Rolling to next expiry: ERC-20 transfers / gas | 14 / 1,141,329 | 0 / 774,083 | **0 / 662,579** |

**Aqua loses on gas per fill and we are not going to pretend otherwise** — a pool holds its own
reserves, so it does not pay for a `pull` and a `push`. It wins on the other three, and the first
row is the whole thesis: the ladder needs **27.51 WETH** of advertised depth against a wallet
holding **10.4 WETH**. A pool must own what it quotes, so the same capital funds one leg instead of
four. The v4 hook can be made wallet-backed and then it writes all four, but it still needs a
CREATE2-mined hook address, eight setup steps instead of four, and a separate pool per leg, because
`PoolKey` has nowhere to put a strike and an expiry.

[`FEEDBACK.md`](../FEEDBACK.md) is our developer feedback on the v4 stack, written during the port.
Two of its findings are backed by tests rather than opinion:
`test_Feedback_ANoOpHookMakesThePriceLimitIrrelevant` and
`test_Feedback_TakeSpendsThePoolManagersOwnBalance`.

```bash
make test-hook       # 26 tests: parity, the venue experiment, the two feedback findings
```

## Does it pay? One week, replayed, against holding and against a pool

The two readers with capital both asked for the same missing thing, in almost the same words. An
options trader: *"if they can show realised theta over a few hundred fills versus a straight hold,
I'd look again."* A liquidity provider: *"the thing I actually need is the comparison, and it is
absent."*

It is here, and it is a **simulation** — a model on a replayed tape, not a track record. No capital
has ever traded this book. [`test/markout/MarkoutReplay.t.sol`](../contracts/test/markout/MarkoutReplay.t.sol)
replays **every Chainlink ETH/USD round published on Base** in a 10.7-day capture through the demo
ladder, on the real router and the real Aqua registry, against two controls holding identical capital
over the identical path: the coins untouched, and a constant-product position at 5 bp and 30 bp.
There is one taker, an arbitrageur who sizes in closed form and declines anything that does not pay
them at the reference price.

| One 7-day window: 2,442 -> 2,381 USD, 1,185 rounds, 60% implied | |
|---|---|
| Strikeline book | **+201.45 USD** vs holding, on 50,251.26 of capital, over 7 days |
| The same, vs a constant-product position | **+190.12** at 5 bp, **+179.17** at 30 bp |
| Fills | **92**, out of 4,740 chances to trade |
| Quotes the taker looked at and declined | **4,409** |
| Realised vol on the window | **46.57%**, against the 60% the book was written at |
| Of the ladder's own time value | **31.1%** captured |

**The uncomfortable number is 4,409.** Against an arbitrage-only taker the cash markout on the fills
is negative *by construction*: −65.53, which is exactly minus what the arbitrageur made, because a bot
only crosses when crossing pays it. What the maker is actually paid is the other half of the split —
the ETH the book did not sell into the rise and bought back into the fall, +266.97 — and the two add
back to +201.45, which the test asserts (to within one wei of integer division per step) rather than
argues. So the premium in this design is not
a credit that lands in a wallet. It is inventory management, and it stops the moment nobody trades.
That is the disclosed risk below, with a number on it.

**Where it loses.** The vol sweep brackets the tape's own realised vol on both sides, and every cell
is published rather than the flattering one:

| Written at | Fills | Time value on offer | vs hold | vs 5 bp pool | vs 30 bp pool | Captured |
|---|---|---|---|---|---|---|
| 15% | 519 | 0.51 | +0.75 | **−10.57** | **−21.52** | — |
| 30% | 1,120 | 69.14 | +61.94 | +50.61 | +39.66 | 89.6% |
| 45% | 412 | 296.00 | +251.56 | +240.24 | +229.29 | 85.0% |
| **60%** | 92 | 648.75 | +201.45 | +190.12 | +179.17 | 31.1% |
| 75% | 23 | 1,102.08 | +253.02 | +241.70 | +230.75 | 23.0% |
| 90% | 4 | 1,637.74 | +257.20 | +245.88 | +234.93 | 15.7% |

Written at 15%, below what the market actually did, the leg is a very tight fee-less AMM and **an
ordinary pool beats it.** That is the condition under which this loses and it is the one the theory
predicts: sell vol below realised and the arbitrageur takes more than the decay pays. The sweep also
shows the tension that decides everything in between — a higher written vol puts more time value on
offer *and* a wider spread in front of it, so less and less of it is ever collected.

**Where it wins, and how narrow that evidence is.** Above realised vol, on a range-bound tape. The
same book written on eight start dates twelve hours apart beat holding in **8 of 8** windows, by 31 to
639 USD. Those windows overlap and all sit inside one quiet fortnight of one market that realised
45–47% throughout, so they are eight views of one regime, not eight independent trials. And the price
never once reached the 2,600 the ladder offered to sell at, so **the assignment case is untested here**:
a week that runs through the strike and keeps going sells the ETH at the strike and leaves the rest of
the move behind, and nothing in this capture measures that.

```bash
cd contracts && forge test --match-path 'test/markout/*' -vv   # the replay, the vol sweep, the window sweep
```

It is a simulation over a captured tape and it is reported here rather than in the app: the terminal renders chain reads only, and a replayed study drawn in the same
chrome as a live quote is the one thing a trading screen must not do.

## Proven, not asserted

`contracts/test/strikeline/StrikelineBook.t.sol` — 9 tests, all against a freshly deployed Aqua (the fork suites below use the official one):

| Claim | Test | Measured |
|---|---|---|
| Decay opens a two-sided spread with no transaction | `test_Theta_DecayOpensASpread` | 40 USDC reverts after 3 days; 4,000 USDC clears |
| The band is publishable and matches observation | `test_Band_MatchesObservedMinimum` | 133.547310 USDC after 2 days |
| **A fill on one leg shrinks its siblings' depth** | `test_Book_FillOnOneLegShrinksSiblingDepth` | shared wallet 10.4 → 5.4 WETH; both siblings refuse 6 WETH, still fill 2.7 |
| Without `Coverage` the depth is phantom | `test_Book_WithoutCoverageTheDepthIsPhantom` | unguarded leg quotes 6 WETH against a 1 WETH wallet |
| Expiry settles constant-sum at the strike | `test_Expiry_SettlesAtStrikeOneWay` | 0.338 WETH of theta paid on first assignment |
| Rolling moves zero tokens | `test_Roll_MovesNoTokensAndCanRepeatParameters` | 0 ERC-20 `Transfer` logs |
| `quote() == swap()` | `testFuzz_QuoteEqualsSwap` | 256 fuzz runs |

Plus mainnet-fork suites that fill **real WETH/USDC through the official contracts**, including a fill
against a live third-party maker strategy via the unmodified official router.

```bash
make install                                                # once, before anything else
make test                                                   # 170 offline tests
FORK_RPC_URL=https://ethereum-rpc.publicnode.com make test-fork   # 11 fork tests, real tokens
```

## Engineering numbers

| | |
|---|---|
| Router runtime size | **23,851 B** — 725 B under EIP-170, mainnet-deployable, no size override |
| Gas: quote / swap, the shipped leg | **113,283 / 211,317** (`docs/OPCODES.md`; ~$0.01 on Base at 0.005 gwei) |
| Of which `RmmSwap` itself | 100,632 gas, over the official `XYCSwap` baseline of 106,848 |
| Curve accuracy | ~5e-12 relative error vs a 50-digit mpmath reference |
| Φ approximation error | 6.95e-8; Φ⁻¹ round-trip 1.18e-6, which sets the maker-favouring epsilon |

`StrikelineOpcodes` drops `PeggedSwap` (−1,394 B, a stableswap curve has no role in writing options)
to fit under EIP-170. Every other official instruction is kept, `FeeProtocol` included, so programs
written for the official router still run here.

## Honest limits

- **You are not paid up front, and the income depends on flow.** A written covered
  call credits you on day one and you keep it whether or not anyone shows up. Here
  the premium accrues inside the spread and is only realised when somebody crosses
  it. If no trader ever reaches your quote you keep your ETH and earn nothing. This
  is the largest risk in the design and it is a property of the mechanism, not a
  bug we intend to fix. **The replay above puts a number on it:** over one week the
  simulated arbitrageur looked at the book 4,740 times, crossed 92 times, and walked
  away 4,409 times because the spread was wider than its edge. The book still ended
  ahead of holding on that path, but it collected only 31.1% of the time value it had
  written.
- This is **vol-selling market making, not a written contract**. `dock` is unconditional and instant,
  so a maker can withdraw quotes at any time. A buyer cannot rely on the option the way they can rely
  on a Deribit contract.
- The position is **short volatility**. It loses when realised vol exceeds the implied vol you chose,
  and the sweep above shows the other edge of that: written *below* realised vol it is beaten by an
  ordinary constant-product pool, by 10.57 (5 bp) and 21.52 (30 bp) on the replayed week.
- `Coverage` **reverts rather than partially filling**. That is honest to the maker and a cost to the
  taker: someone who asks for more than the wallet can deliver gets nothing and may route elsewhere.
  A clamped partial fill would need a second `runLoop` in exact-out mode. The error carries both numbers.
- The curve uses an **approximated** Φ. That implies a documented minimum trade size rather than an
  unbounded relative error on dust; the epsilon is sized from the measured composite error, not from
  the textbook erf bound.
- `StrikelineRouter` is a **redeployed, modified** SwapVM router, which the track permits. The Aqua registry is
  never redeployed and never modified.

## Prior art

| Work | What it was | What is different here |
|---|---|---|
| Primitive RMM-01 (2021-22) | The same curve as its own pooled protocol; wound down | No pool, no venue, no per-strike pre-funding. 62 bytes inside 1inch's VM, drawing on a wallet. |
| Superpose (ETHGlobal Lisbon) | Covered calls on Aqua with option tokens + a solvency guard | The option *is* the curve: no token, no exercise transaction, no settlement contract. Time decay is on-chain. |
| Smile (ETHGlobal NY) | Vol-surface market making, priced off-chain via Chainlink CRE | Replication, not pricing. No oracle anywhere in the pricing path. |
| overdraft (ETHOnline 2026) | Measures Aqua's phantom depth, ships a guard instruction | Same wallet read, independently arrived at. Ours wraps the curve so nothing can execute after the check, includes the protocol fee in the obligation, and margins a *book* of legs rather than one position. |
