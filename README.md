# Strikeline

**Name a price you'd be happy to sell your ETH at. Whoever takes it pays you for
the wait. The ETH never leaves your wallet.**

You hold 10.4 WETH. You can leave it idle, or put it in a liquidity pool — where
you are already agreeing to sell it at a price you never chose, for a fee that
mostly goes to arbitrage bots.

Strikeline lets you say *"I will sell my ETH at $2,800 if it gets there, and be
paid to wait."*

You set the price and the date. Your ETH stays in your wallet. There is no
contract to sign: your offer is a quote inside 1inch's Aqua, and it costs a
little more to fill each day nobody takes it.

*If you already trade options:* this is a covered call written as a price curve —
you pick the strike, the vol and the expiry, and the premium arrives as a
two-sided spread that widens with theta rather than as an up-front credit.

*Mechanically:* the curve is a 1inch SwapVM instruction — a small on-chain
program that prices trades against your wallet — so there is no vault, no option
token, no oracle and no keeper anywhere in the path.

Built for ETHGlobal ETHOnline 2026. Every strategy settles through the official
Aqua registry at `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`.

## What you are actually agreeing to

If ETH runs past your price, you sell at your price and keep what you were paid.
That is the trade. If ETH moves more than the volatility you chose, you would
have done better holding. You can withdraw the offer at any moment, and
withdrawing moves no tokens.

## The two custom SwapVM instructions

### `RmmSwap` — opcode `0x55` ([src](contracts/src/instructions/RmmSwap.sol))

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

### `Coverage` — opcode `0x93` ([src](contracts/src/instructions/Coverage.sol))

Aqua deliberately lets a maker over-allocate: `ship()` checks no balance, and `safeBalances()` returns
the virtual number with no clamp to the wallet. The only real check happens inside `Aqua.pull`'s
`transferFrom` — *after* the quote. So a book can advertise depth it cannot deliver.

`Coverage` runs the curve first via a nested `ctx.runLoop()`, then requires the priced output to be
deliverable from the maker's real `balanceOf` ∧ `allowance(maker, AQUA)`. Because every leg reads the
same wallet, **a fill on one leg shrinks its siblings' deliverable depth in the same block** — no
keeper, no shared storage, no message passing. Over-allocation becomes portfolio margin.

It runs *after* the curve on purpose: clamping `balanceOut` beforehand would move the reserve point and
therefore change the **price**, not just the size — quoting a different option than the maker wrote.

## The read layer: reading a market out of a log, with The Graph

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

*If you already trade options:* this is an implied-volatility surface reconstructed from on-chain
state alone, which does not currently exist anywhere in DeFi. Strike on one axis, expiry on the
other, σ read straight out of the program bytes rather than solved for, and a cross-maker best bid
at each cell.

### `subgraph/` — **The Graph**, which is where the assembling happens ([README](subgraph/README.md))

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

That response is a **transcript, not an illustration.** `subgraph/tests/` runs the mappings
themselves — compiled with the exact `asc` arguments `graph build` uses, against an in-memory store
playing graph-node's host — and writes the answer out. 18 tests: seven pin the decode to one real
`abi.encode(Order)` captured from the Foundry suite (K, σ, maturity, L, plus the six inputs it must
decline rather than guess at), and eleven ship, push, pull, fill and dock a book of four offers from
three makers and assert the entity graph that comes out.

Aqua's events carry no indexed parameters, so the `app` filter cannot live in the manifest and lives
in the mapping instead — which is also what lets one deployment index every Strikeline offer on the
registry rather than only ours.

### `contracts/src/SurfaceLens.sol` — the numbers a log cannot carry ([src](contracts/src/SurfaceLens.sol))

The bytes are fixed; the price is not, because it moves with the clock. A view contract prices a
whole book in one call: terms, live Aqua reserves, mark, delta, premium and the theta band per
offer. 9,179 B runtime, a **separate** contract so it spends none of the router's EIP-170
headroom, and it prices the four-leg demo ladder in one `eth_call` for 1,376,728 gas. Every batch
entry is fault-isolated in `try/catch`, so a strategy that is not an offer comes back
`isLeg == false` instead of taking the book down.

This is the read that matters to a solver: one call returns the deliverable depth `Coverage` will
actually honour on every leg at once, which is the number an order book would publish and Aqua does
not have.

### `web/src/app/(app)/surface` — the screen, which needs no wallet ([src](web/src/app/(app)/surface/page.tsx))

Every offer anyone has made, with the best bid across all makers at the top, because that is the
quote the registry structurally lacks. Underneath it sits a panel that names its own sources: which
path answered this page load, how far behind the index is, and the query above with the strike and
expiry currently on screen substituted in, ready to paste into a playground.

It reads a public log, so it works with nothing connected; a wallet only marks which offers are
yours. If the subgraph is not running it pulls the same `Shipped` events straight through viem and
decodes them with the same byte offsets, and says so on screen. If the lens is not deployed it runs
the contract's own init code inside one `eth_call`. The demo never waits on external infrastructure
— and the two decode paths are a cross-check on each other: if they disagreed about a price, one of
them would be wrong.

```bash
make subgraph        # graph codegen && graph build
make test-surface    # 18 mapping tests, 20 Foundry tests on the lens, then the read path on the fork
```

## The same curve in a pool: a Uniswap v4 hook, and what it costs

[`contracts/src/hooks/StrikelineHook.sol`](contracts/src/hooks/StrikelineHook.sol) runs the
identical RMM-01 curve as a Uniswap v4 hook, importing
[`RmmPricer.sol`](contracts/src/hooks/RmmPricer.sol) and the same `Gaussian.sol` / `WadMath.sol`
the Aqua instruction uses. Not a reimplementation: the same code, priced by the same functions.

That makes the comparison a controlled experiment rather than an argument, and we ran it.
[`test/hook/VenueExperiment.t.sol`](contracts/test/hook/VenueExperiment.t.sol) stands the same
four-leg ladder up in three venues — a v4 pool, a v4 hook paying from the wallet, and Aqua — and
measures four questions. 26 hook tests pass, including a fuzzed parity suite
([`CurveParity.t.sol`](contracts/test/hook/CurveParity.t.sol)) asserting the pool and the Aqua leg
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

[`FEEDBACK.md`](FEEDBACK.md) is our developer feedback on the v4 stack, written during the port.
Two of its findings are backed by tests rather than opinion:
`test_Feedback_ANoOpHookMakesThePriceLimitIrrelevant` and
`test_Feedback_TakeSpendsThePoolManagersOwnBalance`.

```bash
make test-hook       # 26 tests: parity, the venue experiment, the two feedback findings
```

## Proven, not asserted

`contracts/test/strikeline/StrikelineBook.t.sol` — 9 tests, all against a live Aqua deployment:

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
make test                                                   # 78 offline tests
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

## Repository layout

```
contracts/          Foundry. The router, the two instructions, the math, the tests.
  src/instructions/ RmmSwap.sol, Coverage.sol           <- the contribution
  src/math/         Gaussian.sol (A&S 7.1.26 erfc + bisection), WadMath.sol (solady)
  src/StrikelineRouter.sol, StrikelineOpcodes.sol, StrikelineViews.sol
  src/SurfaceLens.sol                                   <- the read layer, off the router
  src/spikes/       the feasibility spikes, with a README saying what each one measured.
                    Nothing here ships; `src/instructions/` is exactly the two files above.
  test/strikeline/  the nine thesis tests
  test/surface/     the lens: decode, mark, delta, premium, band, cross-maker ranking
  test/fork/        mainnet-fork fills through the official Aqua + official router
subgraph/           The Graph. Decodes the shipped bytes in the mapping into Leg / Maker /
                    Fill / SurfacePoint. schema.graphql, subgraph.yaml, src/*.ts (AssemblyScript).
web/                Next.js 16 / React 19 / wagmi 3. Verified TypeScript SwapVM encoder.
scripts/fork/       anvil Base fork, bootstrap, oracle mock, time warp, smoke test.
docs/               ARCHITECTURE.md, CONCEPT.md, OPCODES.md, research, AI-usage disclosure.
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the one-page map, with a diagram: which box
holds the tokens, which box holds the price, and which boxes are 1inch's and not ours.
`contracts/`, `web/`, `scripts/` and `subgraph/` each carry their own README.

## Running it

```bash
make install && make build
make fork          # anvil, Base pinned at block 50946000, chain id 31337
make bootstrap     # deploy the router against the OFFICIAL Aqua, fund wallets
make smoke         # ship a strategy, quote it, swap it, print the receipt
```

## Honest limits

- **You are not paid up front, and the income depends on flow.** A written covered
  call credits you on day one and you keep it whether or not anyone shows up. Here
  the premium accrues inside the spread and is only realised when somebody crosses
  it. If no trader ever reaches your quote you keep your ETH and earn nothing. This
  is the largest risk in the design and it is a property of the mechanism, not a
  bug we intend to fix.
- **`Coverage` reverts rather than partially filling**, which is honest to the maker
  and a cost to the taker: someone who asks for more than the wallet can deliver
  gets nothing instead of getting some, and may route elsewhere. A clamped partial
  fill would need a second `runLoop` in exact-out mode.
- This is **vol-selling market making, not a written contract**. `dock` is unconditional and instant,
  so a maker can withdraw quotes at any time. A buyer cannot rely on the option the way they can rely
  on a Deribit contract.
- The position is **short volatility**. It loses when realised vol exceeds the implied vol you chose.
- `Coverage` **reverts rather than clamping**. A partial fill would need a second `runLoop` in
  exact-out mode. The quote refuses instead of lying, and the error carries both numbers.
- The curve uses an **approximated** Φ. That implies a documented minimum trade size rather than an
  unbounded relative error on dust; the epsilon is sized from the measured composite error, not from
  the textbook erf bound.
- `RmmSwap` is a **redeployed, modified** SwapVM router, which the track permits. The Aqua registry is
  never redeployed and never modified.

## Prior art

| Work | What it was | What is different here |
|---|---|---|
| Primitive RMM-01 (2021-22) | The same curve as its own pooled protocol; wound down | No pool, no venue, no per-strike pre-funding. 62 bytes inside 1inch's VM, drawing on a wallet. |
| Superpose (ETHGlobal Lisbon) | Covered calls on Aqua with option tokens + a solvency guard | The option *is* the curve: no token, no exercise transaction, no settlement contract. Time decay is on-chain. |
| Smile (ETHGlobal NY) | Vol-surface market making, priced off-chain via Chainlink CRE | Replication, not pricing. No oracle anywhere in the pricing path. |
| overdraft (ETHOnline 2026) | Measures Aqua's phantom depth, ships a guard instruction | Same wallet read, independently arrived at. Ours wraps the curve so nothing can execute after the check, includes the protocol fee in the obligation, and margins a *book* of legs rather than one position. |

## License and AI usage

Contracts under MIT. Consumes `@1inch/aqua` and `@1inch/swap-vm` under their respective Degensoft
source licenses. AI tooling usage is disclosed in [docs/AI-USAGE.md](docs/AI-USAGE.md), with the
orchestration scripts that produced the research in [docs/workflows/](docs/workflows/).
