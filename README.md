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

## The app: one screen

One route. A 56px bar naming the instrument, a chart beside a 380px ticket, the positions
underneath. There is no navigation, because there is nowhere to go.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◇ strikeline  ⬡ WETH/USDC 2,442.43 -2.15% 3d   ● 50,946,647   0x70…79C8  │  56px
├────────────────────────────────────────────┬─────────────────────────────┤
│  [ decay | payoff | curve ]                │  SELL          MAX 10.4000  │
│                                            │  ⬡ WETH  [ 10.4          ]  │
│   the decay band widening over             │  STRIKE                     │
│   time; payoff at expiry against           │  ⬡ USDC  [ 2,600    ] +6.5% │
│   holding; the live curve with             │  EXPIRY                  8d │
│   its reserve point — all three            │  [ 18 Sep ]  [1w] [2w] [1m] │
│   sampled from the router, none            │  IV               REAL 21.2 │
│   of them a model                          │  [ 21.2 %          ]  − +   │
│                                            │  ─────────────────────────  │
│                                            │  PREMIUM      +59.08 USDC   │
│                                            │  CAPPED AT   2,605.68 USDC  │
│                                            │  ┌───────────────────────┐  │
│                                            │  │     Publish offer     │  │
│                                            │  └───────────────────────┘  │
├────────────────────────────────────────────┴─────────────────────────────┤
│ POSITIONS                    PROMISED 30.7400 / 10.4000 WETH 2.96×       │
│      SIZE      STRIKE   EXPIRY      EARNED      BACKING                  │
│ ⬡C  9.9251 WETH  3,000.00  16 Sep 6d  0.00 USDC  ▓▓▓▓▓▓▓▓▓ 100%   ×      │
│ ⬡C  9.4551 WETH  2,800.00  16 Sep 6d  0.00 USDC  ▓▓▓▓▓▓▓▓▓ 100%   ×      │
└──────────────────────────────────────────────────────────────────────────┘
```

The four controls arrive pre-filled from the chain, so a person who agrees with the defaults
publishes in **one click** with a wallet already attached, three from cold. Every figure is a chain
read: the amount from a `balanceOf` multicall, the strike from the Chainlink feed the manifest
names, the date from the block clock rather than the browser's, the volatility from the trailing
realised move on that same feed, and the premium from `StrikelineViews.stableFor` asked twice in one
multicall — once at the offer's own date and once with the date set to zero, where the curve
degenerates to the constant-sum order it becomes at expiry. The ticket quotes before a wallet is
connected, because those are view calls and need no signer.

`decay` is the landing view because it is the one of the three that draws a curve. The payoff at
expiry of a covered call written with no cash up front is two straight segments — the position IS
the hold until the assignment point, and flat after it — and the premium on it is fifty-nine USDC
against a position worth twenty-six thousand, which is three pixels. So the payoff view names the
figure beside the kink rather than pretending the region is legible, and the decay view, where the
band genuinely widens, is what the screen opens on.

Everything on the screen is read at one block, and that block is printed in the bar. That is what
lets a fill land on one offer and shrink what the others can deliver in the same commit, rather than
as four figures drifting into place as their own pollers fire.

`PROMISED 30.7400 / 10.4000` is the number no other venue can print: 30.74 WETH written across four
offers against the 10.4 WETH actually in the wallet, none of which ever moved. `BACKING` on each row
is how much of what that offer advertises its wallet could hand over right now — the bound the
`Coverage` guard itself reported when the offer was probed for the whole of it — so it reads 100%
on an untouched book and shrinks on every sibling the moment one of them is filled. There is no
separate `OPEN` column, because `open` is `SIZE × BACKING` by construction and two columns for one
quantity is not density.

There is one route. `next build` prints three entries and two of them are not pages:

```
Route (app)
┌ ○ /
├ ○ /_not-found
└ ○ /icon.svg
```

The read layer and the markout study used to be `/surface` and `/receipt`. They demonstrate what the
contracts publish rather than how an offer is written, so they are documented below and in
`contracts/test` and `scripts/markout` — the code, the queries and the measured numbers all survive;
only the two screens are gone, and so is the footer link that used to reach them: it put a second
product, at a different type scale and density, one click from the terminal.

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

### Three ways to read the same surface, and they cross-check each other

Every offer anyone has made can be reconstructed with nothing connected, because it is all in a
public log. Three independent paths decode it: the subgraph mappings, the same `Shipped` events
pulled straight through viem with the same byte offsets, and — when the lens is not deployed —- the
lens contract's own init code run inside one `eth_call`. If any two of them disagreed about a price,
one would be wrong; `make test-surface` is what asserts they do not.

The screen that used to render this is deleted. The reads are not: they are the same decoders
`useBook` runs on the terminal's positions strip, and the tests below exercise the whole path.

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

## Does it pay? One week, replayed, against holding and against a pool

The two readers with capital both asked for the same missing thing, in almost the same words. An
options trader: *"if they can show realised theta over a few hundred fills versus a straight hold,
I'd look again."* A liquidity provider: *"the thing I actually need is the comparison, and it is
absent."*

It is here, and it is a **simulation** — a model on a replayed tape, not a track record. No capital
has ever traded this book. [`test/markout/MarkoutReplay.t.sol`](contracts/test/markout/MarkoutReplay.t.sol)
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
make markout                                         # tape check, replay, publish the screen's data
cd contracts && forge test --match-path 'test/markout/*' -vv
```

`make markout` writes the three paths, the tape they were replayed against, and the ETH the wallet
actually held hour by hour. It is a simulation over a captured tape and it is reported here rather
than in the app: the terminal renders chain reads only, and a replayed study drawn in the same
chrome as a live quote is the one thing a trading screen must not do.

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
  test/markout/     the replay: this book vs holding vs a pool, on a real Base price tape
subgraph/           The Graph. Decodes the shipped bytes in the mapping into Leg / Maker /
                    Fill / SurfacePoint. schema.graphql, subgraph.yaml, src/*.ts (AssemblyScript).
  tests/            the mappings run in WebAssembly against a Node host: 18 tests, one golden
                    abi.encode(Order) shared with the Solidity and TypeScript decoders.
web/                Next.js 16 / React 19 / Mantine 9 / wagmi 3, light theme, one card first.
                    Verified TypeScript SwapVM encoder. No option maths anywhere in it:
                    every curve value and preview number is a router call.
scripts/fork/       anvil Base fork, bootstrap, oracle mock, time warp, smoke test.
scripts/markout/    the replay tape, and the check that the published markout is not stale.
docs/               ARCHITECTURE.md, CONCEPT.md, OPCODES.md, research, AI-usage disclosure.
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the one-page map, with a diagram: which box
holds the tokens, which box holds the price, and which boxes are 1inch's and not ours.
`contracts/`, `web/`, `scripts/` and `subgraph/` each carry their own README.

## Running it

```bash
make install       # required first: Foundry deps resolve through contracts/node_modules
make build
make fork          # anvil, Base pinned at block 50946000, chain id 31337
make bootstrap     # deploy the router against the OFFICIAL Aqua, fund wallets
make smoke         # ship a strategy, quote it, swap it, print the receipt
make story-setup && make story-1   # four live offers from anvil account #1
make web           # the app, on http://localhost:3000
```

`make web` serves exactly the one screen above. The diagnostics pages are named `page.dev.tsx` and
only exist as routes under `make web-dev-routes`; a production build cannot ship them.

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
- **`Coverage` reverts rather than partially filling**, which is honest to the maker
  and a cost to the taker: someone who asks for more than the wallet can deliver
  gets nothing instead of getting some, and may route elsewhere. A clamped partial
  fill would need a second `runLoop` in exact-out mode.
- This is **vol-selling market making, not a written contract**. `dock` is unconditional and instant,
  so a maker can withdraw quotes at any time. A buyer cannot rely on the option the way they can rely
  on a Deribit contract.
- The position is **short volatility**. It loses when realised vol exceeds the implied vol you chose,
  and the sweep above shows the other edge of that: written *below* realised vol it is beaten by an
  ordinary constant-product pool, by 10.57 (5 bp) and 21.52 (30 bp) on the replayed week.
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
