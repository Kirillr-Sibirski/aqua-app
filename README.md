# Strikeline

**A covered call is a price curve. Strikeline writes that curve as a 1inch SwapVM instruction, so
the option lives in your own wallet: no vault, no option token, no oracle, no keeper.**

Built for ETHGlobal ETHOnline 2026, 1inch "Build an Aqua App" track. Every strategy settles through
the official Aqua registry at `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`.

---

## What it does

You hold 10.4 WETH. Today you can leave it idle, or put it in a pool where you are silently short an
option: someone else picked the strike, someone else picked the implied vol, and arbitrageurs collect
the premium instead of you.

Strikeline lets you say *"I will sell my ETH at $2,800 if it gets there, and be paid to wait."* You
write that as a ladder of quoting positions. The tokens never leave your wallet. Traders trade against
your price, and time decay pays you.

The mechanism is that the option **is** the curve:

- **The premium** arrives as a spread that widens as expiry approaches. Each day the curve moves away
  from the stale reserve point, so a trade only clears once it is large enough to close the gap.
  Whoever crosses it pays the accrued theta. Measured over one leg's life: **0.338 WETH**.
- **Exercise** is an ordinary swap at the strike, performed by whoever wants the arbitrage.
- **Settlement** needs nothing: at maturity the curve degenerates in closed form to a constant-sum
  order at exactly `K`.
- **Cancelling and rolling** move zero tokens: `dock` + `ship` are pure accounting in Aqua.

One wallet backs the whole ladder at once. Ship three calls and a put against the same 10.4 WETH and
you have written 27.5 WETH of notional, because at any given price at most one or two legs can fill.
A second instruction makes that safe rather than fictional.

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

## Proven, not asserted

`contracts/test/strikeline/StrikelineBook.t.sol` — 9 tests, all against a live Aqua deployment:

| Claim | Test | Measured |
|---|---|---|
| Decay opens a two-sided spread with no transaction | `test_Theta_DecayOpensASpread` | 40 USDC reverts after 3 days; 4,000 USDC clears |
| The band is publishable and matches observation | `test_Band_MatchesObservedMinimum` | 133.49 USDC after 2 days |
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
| Router runtime size | **23,633 B** — 943 B under EIP-170, mainnet-deployable, no size override |
| Gas per RMM fill | 657-667k (~$0.01 on Base at 0.005 gwei) |
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
  test/strikeline/  the nine thesis tests
  test/fork/        mainnet-fork fills through the official Aqua + official router
web/                Next.js 16 / React 19 / wagmi 3. Verified TypeScript SwapVM encoder.
scripts/fork/       anvil Base fork, bootstrap, oracle mock, time warp, smoke test.
docs/               CONCEPT.md, research corpus, AI-usage disclosure.
```

## Running it

```bash
make install && make build
make fork          # anvil, Base pinned at block 50946000, chain id 31337
make bootstrap     # deploy the router against the OFFICIAL Aqua, fund wallets
make smoke         # ship a strategy, quote it, swap it, print the receipt
```

## Honest limits

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
