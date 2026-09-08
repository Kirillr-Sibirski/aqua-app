# STRIKELINE — final product concept

**Decision: build Strikeline.** All three judge panels converged on it. Two ranked it #1 outright;
the third ranked Fathom #1 on prize-text fit but *composited to Strikeline anyway* once the repo was
priced. The deciding facts are in our own tree, not in the pitch:

- `contracts/src/spikes/CurveProbeSolady.sol` already implements RMM-01 in **all four
  direction/exactness cases**, driven end-to-end through the **official Aqua** by
  `contracts/test/probe/CurveProbeAqua.t.sol`, error **≈5e-12 vs mpmath**, **657–667k gas** measured.
  *(That figure is a whole-test-body `forge test` number — quote, `deal`, two balance snapshots, swap.
  The shipped leg was later measured at 113,283 quote / 211,317 swap; see `contracts/NOTES.md` §3.)*
- `docs/research/router-size-budget.md §12`: `AquaOpcodes + RMM-01 + weighted + prims` = **23,966 B, +610 B under
  EIP-170**. Dropping the weighted/prims probe functions frees ~1–1.5 KB for the second opcode.
  **Mainnet-deployable router. No `--disable-code-size-limit`.**
- `contracts/test/fork/live/AquaBaseLiveFork.t.sol` already fills **real, live, ungated Base maker
  liquidity through the OFFICIAL v1.0.2 router** `0x111111338c…` and ships our own router to the
  **same official registry** `0x1111113ccf…`.
- `web/` is a working Next 16 / React 19 / wagmi 3 / viem 2 app with `useQuote/useShip/useDock/useSwap`
  hooks, a Solidity-verified TypeScript SwapVM encoder (`web/src/lib/swapvm/`), and a **settled**
  visual system (`DESIGN.md`).
- `scripts/fork/` has anvil bootstrap, whale funding, oracle mock, time warp, snapshot, `make` targets.

The one workstream that made every critic write "feasibility 5–6" is **already done and measured**.
What is left is productionisation and two new things: live τ from the block clock, and coverage.

---

## 1. Name, positioning, audience

**Name: Strikeline.** Options-native (*strike*) and nautical (*a strikeline is the line a hull is built
to*), matching Aqua's ship/dock vocabulary. No DeFi collision.

**Positioning sentence (first 15 seconds of the video):**

> **"Every LP is already short an option — at an implied vol nobody chose and nobody got paid for.
> Strikeline lets you choose the strike, the vol and the expiry, write the whole book from your own
> wallet, and margin it like a real desk: one balance backs four legs, and an instruction proves,
> inside the same call that prices the trade, that every quote is actually deliverable."**

Secondary line, for a non-expert: *"Sell my ETH at $2,800 and get paid to wait — from my own wallet,
with no vault, no option token, and no oracle."*

**Never say "options protocol".** Say **vol-selling market making**. Superpose and Smile both pitched
"options on Aqua" and both **lost this exact prize**. The reframe (a) kills the free-cancel objection —
a market maker may pull quotes, a bilateral option writer may not; (b) makes the largest quantified
pain in the KB on-topic; (c) puts us in an untaken lane rather than a $230M graveyard.

**Who it is for**
- **Primary:** semi-pro LPs and small desks holding ETH/BTC who already run v3 ranges or ALM vaults and
  are therefore already short gamma, unpaid. They want the strike and the IV to be *their* choice.
- **Secondary:** treasuries selling upside on a position they refuse to custody elsewhere, and
  accumulating below spot (the cash-secured-put leg).
- **Takers:** 1inch resolvers and arbitrageurs who delta-hedge the curve. They are not an afterthought —
  **arbitrage flow is the mechanism by which the maker earns theta**, and the pitch says so.

---

## 2. The pain, with evidence

| Claim | Evidence (KB) |
|---|---|
| Passive LPs are short vol at an IV they never chose | `market-lp-pain.md §1.1`: LVR = σ²/8 ≈ **11%/yr** at 5% daily vol; §1.2 Fritsch–Canidio: WETH-USDC 5bp fees ≈ **80%** of arbitrage losses; **49.5%** of ~17k v3 LPs under HODL |
| The old LP job stopped paying **this year** — the "why now" | Uniswap fee switch (17–25% of LP fees; Ethereum Dec-2025, **Base Mar-2026**); Revert: LP APY **~4% → ~1%** |
| Existing on-chain options lock collateral and add an oracle | Aevo/Ribbon vaults lost **$2.7M to an oracle exploit, Dec-2025**; Thetanuts TVL **$442**; Premia $0.55M; DOVs pick one strike per epoch |
| Capital cannot do two jobs | `wp-aqua.txt §2/§4.1`: pooled liquidity is "DeFi-disabled"; 1inch Dune Jul-2026: **$1.6B of $1.84B** concentrated liquidity underutilised, **~$542M fully idle**, **$185–195M/yr** fees forgone |
| Judges have named this whitespace | `prior-winners.md §7`: *"structured products / vanilla options priced by an on-chain Black-Scholes-ish instruction with IV as a maker parameter"* — **explicitly untaken**. "Options" is one of 1inch's own four prize examples since Buenos Aires. |
| Over-allocated Aqua depth is a live, measured problem | `overdraft` (competitor, this event): **$25,109 of phantom depth across 14 mainnet positions**, 7 positions with virtual balance > token supply |

The last row is the one we **invert**: the field's sharpest criticism of Aqua becomes a property our
position proves in the VM. We are not the exhibit; we are the fix.

**Prior art, stated on the README's first screen and on a slide** (if a judge finds this before we
show it, we lose the room):

| Prior work | What it was | Our delta |
|---|---|---|
| **Primitive RMM-01** (2021–22) | The same curve, as its own **pooled protocol**; wound down | No pool to bootstrap, no per-strike pre-funded liquidity, no venue of its own — it is 62 bytes inside 1inch's VM, drawing on a wallet |
| **Superpose** (Lisbon) | Covered calls on Aqua with option tokens + a solvency guard | The option **is** the curve: no option token, no exercise transaction, no settlement contract; time decay is **on-chain** |
| **Smile** (NYC) | Vol-surface MM, prices quoted from an **off-chain** Chainlink-CRE surface | **Replication, not pricing.** No oracle anywhere in the pricing path |
| **Aqua Outcome Market** (BA 1st) | Gaussian pm-AMM as an instruction | Different payoff; ours has **time-varying curvature** and a coverage-margined book |
| **overdraft** (live now) | Measures phantom depth, guards over-commitment | We make over-allocation **safe and useful** — portfolio margin, enforced in the pricing call |

---

## 3. Why this is only possible on Aqua

Claim exactly these four, in this order. Each is verified against source. Drop everything else.

**(1) Cross-strategy solvency on one wallet — the only claim that is genuinely impossible elsewhere.**
`Aqua.safeBalances` (`aqua/src/Aqua.sol:30-38`) returns the **raw virtual balance with no clamp to the
wallet**, and `ship()` (`:41-52`) checks no balance and moves no tokens. So one wallet can back four
option legs at once, each shipped at full notional. Our `Coverage` instruction reads the maker's **real
`balanceOf` ∧ `allowance(maker, AQUA)`** inside the same call that prices the trade, so a fill on leg A
**instantly shrinks the deliverable depth of B, C and D in the same block** — no keeper, no shared
storage, no message passing. That is **portfolio margin without a clearinghouse**.
*Why nothing else can do it:* in SwapVM signature mode `DynamicBalances` (0x91) gives each order its own
**isolated** per-orderHash reserves, blind to each other and to the wallet; a Uniswap v4 hook holds the
capital in `PoolManager` and needs one pool per (K, T); Deribit / Aevo / Panoptic lock collateral per
contract. And no stock instruction reads the **maker's** wallet — `OnlyTakerTokenBalance*` reads the
**taker's** (`swapvm-instructions.md §6`: *"no opcode can read or debit another order's counters, share a
fill budget across several orders, or net positions"*).

**(2) A stateful per-strategy reserve ledger with no re-signing and no deposit.**
`Aqua.pull` decrements and `Aqua.push` increments the strategy's virtual balance on every fill
(`Aqua.sol:63-77`). The RMM curve's reserve point therefore **walks across fills by itself** — the option
"ages" through trading with no keeper and no maker transaction. In signature mode the maker must re-sign
after every fill; `SwapVM.sol:167-169` sets `balanceIn/balanceOut` **only** under
`useAquaInsteadOfSignature()` — an AMM curve on virtual reserves literally cannot exist otherwise.

**(3) Rolling the book moves zero tokens.** `dock` + `ship` write storage and emit events; they perform
**no transfer and no balance check**. Rolling four legs to next Friday is one `Aqua.multicall` with
**zero ERC-20 `Transfer` logs**. A DOV rolls through withdraw/deposit windows with capital idle between
epochs; a v3 re-range is burn + swap + mint and realises IL.

**(4) The terms *are* the strategy hash.** `ship()` takes the strategy **fully, not pre-hashed, "for data
availability"**, and `Shipped` carries the bytes. K, σ, T and L are publicly verifiable on-chain, and any
resolver can quote the position without an off-chain book.

**Explicitly dropped** (every Aqua entry can say them; they invite refutation): "tokens stay in your
wallet", "instant cancel", "swap-as-settlement" (that is a property of AMM-as-option, not of Aqua).

**Stated plainly in the README and on camera:** `dock` is unconditional and instant, so this is
**vol-selling market making, not a written contract a buyer can rely on**. Pre-empting that is worth more
than any extra feature.

---

## 4. The position — mechanics and math

### 4.1 The curve

RMM-01, Angeris–Evans–Chitra 2021 §3.3. **Fixed liquidity `L`, absolute curve, no invariant offset.**
Per liquidity `L`, risky reserve `X ∈ [0, L]`, stable reserve `Y ∈ [0, L·K]`:

```
Y = L·K·Φ( Φ⁻¹(1 − X/L) − s )        s = σ·√τ        τ = max(T − block.timestamp, 0)/365d
```

At spot `S` the no-arbitrage reserve point is

```
X = L·(1 − Φ(d1))      Y = L·K·Φ(d2)
d1 = (ln(S/K) + σ²τ/2)/(σ√τ)         d2 = d1 − σ√τ
```

and the position value is

```
V(S) = S·X + Y = L·( S − C_BS(S,K,σ,τ) ) = L·( K − P_BS(S,K,σ,τ) )      (put–call parity, r = 0)
```

i.e. **long spot + short call**, and by parity **the same 62 bytes are simultaneously a covered call and
a cash-secured put** — which side you get is decided only by which side of the strike your reserves
start on. One instruction, the whole wheel. Delta = Φ(−d1); **arbitrageurs perform the delta hedge, the
maker earns theta**.

### 4.2 Why fixed `L` with **no** invariant offset `k` — decided at hour zero, in writing

Three designs exist. We ship the one already implemented in `CurveProbeSolady.sol`.

- **Re-solve `L` from balances every call** (grow-liquidity, like `XYCConcentrateSwap`): ✗ makes the
  curve scale-invariant, the notional silently drifts with τ, and the Black–Scholes replication claim
  becomes **unprovable** — the flagship chart visibly diverges on camera.
- **Fixed `L` + `k` re-derived from balances each call:** ✗ `k` **cancels out of the trade**
  (`amountOut = f(balanceIn) − f(newIn)`), so the curve re-anchors through wherever the reserves happen
  to sit and accrued theta is handed to the first arbitrageur.
- **Fixed `L`, `k ≡ 0`, reserves always exactly on the curve** ✔ — what the probe does, what Primitive
  shipped, and the only one that is *self-financing without a fee*.

**The consequence is the mechanism, and it is beautiful.** With reserves pinned to the curve, time decay
moves the curve **away** from the stale reserve point. Concretely, for reserves `(X₀, Y₀)` on the τ₀
curve, the τ₁ < τ₀ curve requires `Y_new(X₀) = L·K·Φ(d1 − s₁) > Y₀`. The reserves now sit **inside** the
new curve in both directions, so a trade only clears once it is large enough to close the gap:

> **Theta is the spread.** The decay gap is a **toll the arbitrageur pays to re-open the curve**, and
> that toll *is* the premium. Small trades revert with a named error carrying the exact shortfall; the
> UI renders it as a live band and the getter publishes the minimum fillable size.

**Therefore: zero fee on the option leg.** A `FeeFlatIn` would push reserves off the absolute curve
(the probe's own `newIn < balanceIn` revert), leak the fee to the next taker, and force a fee/rounding
interaction into every invariant. Removing it deletes an entire bug class and gives the better line on
stage: *"the arbitrageur pays theta, not a fee."*

### 4.3 Settlement is the same 62 bytes

At `τ = 0`, `s = 0` and the trading function degenerates **in closed form** to

```
Y = K·(L − X)
```

a **constant-sum limit order selling the remaining risky at exactly K**. Physical assignment is an
ordinary swap executed by whoever wants the arb. **No oracle, no keeper, no settlement contract, no
option token, no exercise transaction.** The τ = 0 branch skips the Gaussian entirely (≈200k gas saved)
and is gated **one-way** (see flags) so the post-expiry window is an *assignment* window, not a free
two-sided ATM straddle written to the world.

### 4.4 τ handling

```
if (block.timestamp >= maturity)  τ = 0                      // closed-form settlement branch, one-way
else                              τ = max(maturity − now, TAU_FLOOR) / 365d,   TAU_FLOOR = 1 hour
```

The floor bounds gamma and keeps quote-to-fill drift finite in the final hour — exactly the moment the
demo dramatises. The residual discontinuity at expiry (a 1h, 60%-IV curve is already within ~0.25% of
the straight line) is the visual "snap", and it is honest.

### 4.5 The book (demo numbers; recompute at the live fork price via `curvePoint`)

Wallet: **10.4 WETH + 24,850 USDC** (irregular by design — `DESIGN.md` bans round demo numbers).
Base fork block 50926000, ETH ≈ **$2,480.53**, 7-day expiry, σ = 60%.

| Leg | K | L (risky WAD) | X = L(1−Φ(d1)) | Y = L·K·Φ(d2) | What it is |
|---|---|---|---|---|---|
| 1 | 2,600 | 12 | 8.41 WETH | 8,449 USDC | covered call, near |
| 2 | 2,800 | 10 | 9.22 WETH | 1,864 USDC | covered call, mid |
| 3 | 3,000 | 10 | 9.88 WETH | 295 USDC | covered call, far |
| 4 | 2,300 | 6 | 1.03 WETH | 11,116 USDC | **cash-secured put** — same instruction, stable-heavy start |
| | | **totals** | **28.5 WETH virtual** | **21,724 USDC** | vs **10.4 WETH / 24,850 USDC real** |

**Notional written 2.7×. Backed 100%.** The book is over-allocated **by design** — that is portfolio
margin, because at any spot at most one or two legs can actually be swept, and `Coverage` enforces the
true simultaneous obligation at fill time, inside the pricing call. Leg 4 is USDC-collateralised and
never competes for WETH.

**KPI language, non-negotiable:** *"Notional written 2.7× · Backed 100% · every quote deliverable."*
**Never** "SLR 2.7" and **never** "phantom depth $0".

---

## 5. SwapVM design

### 5.1 Router

```solidity
contract StrikelineRouter is Simulator, SwapVM, AquaOpcodes, StrikelineViews {
    function _dispatch(Context memory ctx, uint256 op, bytes calldata a) internal override { _runOpcode(ctx, op, a); }
    function _runOpcode(Context memory ctx, uint256 op, bytes calldata a) internal override {
        if (op == RmmSwap.opcode.asU8())  RmmSwap.exec(ctx, a);
        else if (op == Coverage.opcode.asU8()) Coverage.exec(ctx, a);
        else super._runOpcode(ctx, op, a);
    }
}
```

Redeployed on a **Base fork against the OFFICIAL Aqua registry** `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`
(explicitly permitted by the prize).

**Size budget.** Measured baseline `AquaOpcodes + RMM + weighted + prims` = **23,966 B (+610)**. Removing
the weighted/prims probe functions removes `powWad`/`lnWad` (~1.0–1.5 KB); adding `Coverage` (~250–450 B)
and `StrikelineViews` (~400–700 B) lands **~23.0–23.5 KB**. **Hard gate at hour 2: `forge build --sizes`
≤ 24,000 B.** Pre-approved lever if it overruns: **drop `PeggedSwap` (−1,394 B)**, which this program does
not use. **Do NOT drop `FeeProtocol`** — deleting 1inch's own fee opcode from a router you hand to 1inch
judges, to save bytes you do not need, is bad optics.

### 5.2 Program layout

```
Deadline(T + 30m) · Coverage(flags, haircutBps) · RmmSwap(K, σ, T, L, rates, flags) · Salt(nonce)
```

- `Deadline` **0x20** — hard end of the assignment window, **30 minutes** past expiry, not days.
- `Coverage` **0x93** — custom **wrapper**: nested `ctx.runLoop()` runs the curve on the true shipped
  reserves at the true price, then checks deliverability. Wrappers precede the leaf they wrap.
- `RmmSwap` **0x55** — custom **leaf**, the curve.
- `Salt` **0x02** — a **maker-owned strictly monotonic nonce**. `Aqua.ship` requires `tokensCount == 0`
  and `dock` writes `0xff` permanently (`Aqua.sol:48/54-61`), so a docked `strategyHash` can **never** be
  re-shipped. Every roll must bump the salt. A test rolls to *identical economic parameters twice* and
  asserts both ships succeed.

`FeeFlatIn` is deliberately absent (§4.2). `Decay` is deliberately absent — it adds a third orderHash-keyed
state and forces `skipAdditivity`, weakening the invariant table for no benefit against a curve that
already decays.

### 5.3 Custom opcode 1 — `RmmSwap`, `Opcode._55`

Curves bank `0x50–0x6f`; **`_55` verified free** in `OpcodeList.sol:111`. **Leaf, `view`, reads only
`block.timestamp`, touches no storage ⇒ `quote() == swap()` by construction, works under `STATICCALL`.**

**Args — 62 bytes** (`[opcode][len]` header ⇒ 64 program bytes). Frozen and published at hour 1.

| Off | Type | Field | Notes |
|---|---|---|---|
| 0 | `uint8` | `flags` | bit0 `riskyIsTokenA`; bit1 `postExpiryOneWay`; bit2 `postExpiryOutIsRisky` |
| 1 | `uint64` | `sigmaWad` | annualised vol, 1e18 (`0.6e18` = 60%) |
| 9 | `uint40` | `maturity` | unix seconds |
| 14 | `uint128` | `strikeWad` | K, WAD, **normalised** stable-per-risky |
| 30 | `uint128` | `liquidityWad` | L, WAD, risky units |
| 46 | `uint64` | `rateRisky` | raw → normalised multiplier (WETH 18: `1`) |
| 54 | `uint64` | `rateStable` | (USDC 6: `1e12`) |

**Register semantics** (`ctx.swap = {balanceIn, balanceOut, amountIn, amountOut}`):

```
aToB    = ctx.query.tokenIn < ctx.query.tokenOut          // MakerTraits enforces tokenA < tokenB
riskyIn = (aToB == flags.riskyIsTokenA)
rateIn  = riskyIn ? rateRisky : rateStable ;  rateOut = riskyIn ? rateStable : rateRisky
Bin  = balanceIn  * rateIn ;  Bout = balanceOut * rateOut          // normalised WAD space

if (now >= maturity) {                                             // ---- settlement branch
    if (flags.postExpiryOneWay && (tokenOut is risky) != flags.postExpiryOutIsRisky)
        revert RmmSettlementOneWay();
    s = 0                                                          // closed form, no Gaussian
} else {
    tau = max(maturity - now, TAU_FLOOR) * WAD / 365 days
    s   = sigmaWad * sqrtWad(tau) / WAD
}

EPS_OUT = ceil( (riskyIn ? L*K/WAD : L) * EPS / WAD )              // EPS = 2e-6 WAD, maker-favour band

exactIn:
    newIn  = Bin + amountIn * rateIn
    newOut = riskyIn ? stableOf(newIn, K, s, L) : riskyOf(newIn, K, s, L)      // both ceil
    if (newOut + EPS_OUT > Bout) revert RmmInsideSpread(newOut + EPS_OUT - Bout)
    ctx.swap.amountOut = (Bout - newOut - EPS_OUT) / rateOut                   // floor

exactOut:
    need = amountOut * rateOut + EPS_OUT
    if (need > Bout) revert RmmExceedsReserve(need, Bout)
    newOut = Bout - need
    newIn  = riskyIn ? riskyOf(newOut, K, s, L) : stableOf(newOut, K, s, L)    // both ceil
    if (newIn < Bin) revert RmmInsideSpread(Bin - newIn)
    ctx.swap.amountIn = ceilDiv(newIn - Bin, rateIn)                           // ceil
```

`stableOf` / `riskyOf` are **the existing, tested bodies** in `CurveProbeSolady.sol`, both rounded up so
the maker is favoured whichever register they land in. `s == 0` takes `stableOf → K·(L−X)` /
`riskyOf → L − Y/K` in closed form.

**Errors:** `RmmInsideSpread(uint256 shortfall)`, `RmmExceedsReserve(uint256 requested, uint256 available)`,
`RmmSettlementOneWay()`, `RmmOutOfDomain()`.

**Rounding / epsilon.** `EPS_OUT` is an **absolute** guard band in normalised units, sized from the
**measured composite `Φ⁻¹ → Φ` error (1.18e-6 round-trip; Φ alone 6.95e-8)**, *not* from the A&S erf
bound — the inverse is ~20× looser because A&S error divides by the density in the tails. A relative
1e-6 epsilon does **not** dominate it. `EPS = 2e-6` gives ≈0.02 USDC of band on `L·K ≈ 31,200`, which
implies a **documented minimum trade size** rather than an unbounded relative error on small trades.

**Why it must be an opcode.** `swapvm-instructions.md §6` item 3: *"There is no Balancer-style weighted
invariant, no TWAMM, no curve whose parameters move with time — only balances can be time-scaled."*
Curvature that is a function of `block.timestamp` cannot be composed from `DutchAuction*`,
`PiecewiseLinearScale*`, `Decay` or `TWAPSwap`, which scale **balances**. An `Extruction` target is a
`CALL` that returns registers **before** the curve runs, cannot reuse the router's libraries, has a
235-byte arg cap, and its selector differs between the deployed v1.0.2 router (`0xb77cc3e2`) and HEAD.
This is the "new position economics with a citable formula" that every recent 1st/2nd/3rd shipped.

### 5.4 Custom opcode 2 — `Coverage`, `Opcode._93`

Balances-tuning bank `0x90–0xaf`; **`_93` verified free** in `OpcodeList.sol:177`.
**Deliberately NOT `_92`** — Keel is live on Base Sepolia with a custom instruction at 0x92, and
Bebecita used 0x92 at Lisbon. **Wrapper, `view`, no storage.**

**Args — 3 bytes:** `[uint8 flags][uint16 haircutBps]`. The token is `ctx.query.tokenOut`; no address
argument is needed, which keeps the instruction to 5 program bytes.

```
exec(ctx, args):
    ctx.runLoop();                       // the curve prices on the TRUE shipped reserves, unmodified
    address t = ctx.query.tokenOut;
    uint256 free = min( IERC20(t).balanceOf(ctx.query.maker),
                        IERC20(t).allowance(ctx.query.maker, address(AQUA)) );
    free -= free * haircutBps / 1e4;
    uint256 need = ctx.swap.amountOut + protocolFeeOn(ctx, t);   // tokenOut protocol fee, if configured
    if (need > free) revert NotCovered(need, free);
```

It **never reprices, never rewinds the PC, never writes storage.** It runs *after* the curve because
clamping `balanceOut` *before* the curve would change `X/L` and therefore the **price**, not just the
size — a subtlety most designs get wrong.

**Deliberate design choice: it reverts, it does not clamp.** A clamped partial fill would require a
second `runLoop` in exact-out mode (~1.3M gas). Instead the quote is a **hard solvency bound**, the error
carries both numbers, and `StrikelineViews.coverage()` publishes the max fillable so the UI never asks
for more. We say this out loud: *"the quote refuses rather than lying."*

**Protocol fee.** `SwapVM` issues an **additional `AQUA.pull` for the tokenOut fee after** the clamp and
hooks. Our program contains no `FeeProtocol` instruction, so `ctx.fee` is empty — but `Coverage` adds
`ctx.fee.feeTotal` when the fee token is `tokenOut`, **and** a test asserts the router's ProtocolFee is
unset and **fails if one is later configured**.

**Why it must be an opcode.** `swapvm-instructions.md §6` item 6: *"All stateful opcodes key on
orderHash or maker. No opcode can read or debit another order's counters, share a fill budget across
several orders, or net positions."* Nothing in the instruction set reads the **maker's real wallet**:
`TokenValidators` read taker balances, and `Aqua.safeBalances` returns the virtual number **with no
wallet clamp** (`Aqua.sol:30-38`) — the only real check today is inside `Aqua.pull`'s `safeTransferFrom`,
i.e. **after** the quote. An `Extruction` target is a `CALL` that cannot wrap the curve with a nested
`runLoop`. And the mechanism is only *meaningful* because Aqua permits over-allocation: remove Aqua and
there is nothing to margin.

### 5.5 Router views (`StrikelineViews` mixin — external, not opcodes)

- `stableFor(uint128 K, uint64 sigmaWad, uint40 maturity, uint128 L, uint256 xWad) → uint256 yWad`
  — the raw trading function with the **same approximated Φ**, rounded **up**.
  **Every ship is sized through this.** `contracts/test/probe/` already proves that reserves computed
  with the *true* Φ instead of the on-chain A&S Φ **brick the strategy** (every quote reverts) if one wei
  low, or hand the surplus to the first taker if high. TypeScript picks the moneyness `x = 1 − Φ(d1)`
  (a float is fine — it only chooses *where* on the curve you start); the chain returns the exact `y`.
  **No `ln` in the router**, which also saves bytes.
- `coverage(address maker, address token) → uint256 free` — drives the "max fillable now" number.
- `bandFor(bytes calldata rmmArgs, uint256 balIn, uint256 balOut) → (uint256 minInRisky, uint256 minInStable)`
  — the current theta band, so the UI can render it and the arb bot can size analytically.

### 5.6 Hooks / Extruction

**None.** No maker hooks, no taker callbacks, no `Extruction`. The maker is a plain EOA (a Safe is a
day-2 stretch; Aqua's maker is `msg.sender`, so it is plumbing, not risk). Removing the whole hook
surface removes the largest class of authorization bugs and keeps `quote() == swap()` trivially true.

### 5.7 Invariants we ship and publish

1. **`quote() == swap()` fuzz.** The program runs to completion *before* any transfer or hook in both
   paths, so `Coverage`'s `balanceOf` read is identical in both. `RmmSwap` reads only `block.timestamp`.
2. **No profitable round trip** — buy then sell in one block never returns more than you started with.
3. **Theta monotonicity** — with reserves fixed, warping time never improves the taker's fill.
4. **τ = 0 constant-sum equality** — executed price equals K in both directions, within tolerance.
5. **Coverage** — fuzz: `amountOut ≤ min(balanceOf, allowance)` always; and a fill on leg A strictly
   reduces the deliverable depth of legs B, C, D **in the same block**.
6. **Black–Scholes replication** at fixed L — at the no-arb reserve point, `V = S·X + Y ≈ L(S − C_BS)`.
7. **Roll safety** — roll to identical economic parameters twice; both ships succeed (monotonic salt).
8. **`CoreInvariants`** with an **explicit, justified config and a measured-error table** in the README:
   framework default | our value | the numerical reason. Defaults are `symmetryTolerance = 2 wei` and
   `additivityTolerance = 0`; an approximated transcendental curve across 18/6 decimals cannot meet them.
   Symmetry tolerance = `2·EPS_OUT + 1 wei` per leg, from §5.3. **Never silently widen a knob** — an
   honest numerical-analysis table is a strength (Lisbon gave 3rd place to a project whose entire
   contribution was proving these bounds); a loosened knob discovered by a judge is not.
9. **Gas, published, measured, not estimated:** **657–667k per RMM fill** (`docs/research/router-size-budget.md §12`),
   ~**$0.01 on Base** at 0.005 gwei. A judge runs `--gas-report` in ten seconds; a number that is 5–20×
   off invites distrust of everything else.

---

## 6. Aqua usage pattern

- **ONE maker wallet.** ONE `approve` per token to the **official** Aqua registry.
- **FOUR strategies** shipped to **our redeployed router** against the **official registry**, in a single
  `Aqua.multicall`. Three covered calls share the WETH; the cash-secured put is USDC-collateralised.
- `Σ` shipped risky **deliberately exceeds** the wallet (28.5 virtual vs 10.4 real). That is not phantom
  depth — it is portfolio margin, and `Coverage` proves it every block and survives exogenous drift
  (the maker spending the ETH elsewhere, or another Aqua app filling first).
- **Roll = `Aqua.multicall([ ship(new ×4), dock(old ×4) ])` — SHIP FIRST, THEN DOCK.** `safeBalances`
  reverts `SafeBalancesForTokenNotInActiveStrategy` on a docked strategy, so docking first would brick
  quotes mid-roll. Receipt: `Shipped ×4`, `Docked ×4`, `Pushed ×8`, **zero ERC-20 `Transfer` logs**.
- **`dock` requires all tokens** (`Aqua.sol:54-61`: `tokensCount == tokens.length`), and a docked hash is
  dead forever — hence the monotonic salt.
- The same wallet keeps quoting to the **official router** simultaneously; `test_Live_C_OneWallet_TwoApps_OneRegistry`
  already proves one wallet, two apps, one registry.

---

## 7. Three-minute demo (Base fork, block 50926000, chain 31337, `--load-state`)

Pre-baked with `anvil_dumpState` so router/vault addresses are fixed and nothing waits on camera.
No speed-up editing (ETHGlobal rule).

**0:00–0:20 — OPEN ON SOMEONE ELSE'S LIQUIDITY.**
Fill one of the **159 ungated live Base maker strategies through the OFFICIAL v1.0.2 router**
`0x111111338c…` — a real third-party maker, real WETH/USDC, real `Pulled` / `Pushed` / `Swapped`.
*"That was official 1inch Aqua, unmodified. Now watch what we ship into the same registry."*
**Qualification rules 1 and 2 are closed in twenty seconds, before the product appears**, with an
external counterparty. This test already passes (`AquaBaseLiveFork.t.sol:190/:205`). **Budget 1.5h** for
the separate World-A encoder path (5-arg `swap` `0xf4d2d412`, 5-field `SwapRegisters`) — it is not a
10-second afterthought.

**0:20–0:50 — WRITE THE BOOK.**
Wizard: 10.4 WETH, 7 days, IV 60% (defaulted from trailing realised vol, **red state if IV < realised**),
strikes 2600 / 2800 / 3000 + a 2300 put. Payoff chart: `V(S)` vs HODL, assigned region shaded. Review
shows the **compiled bytes** (`20 · 93 · 55 · 02`). One multicall → `Shipped ×4 + Pushed ×8`,
**wallet balances unchanged**, backing meter **100%**, notional **2.7×**.

**0:50–1:40 — MONEY SHOT.**
The arb bot buys ETH from the 2600 leg. One receipt decodes:
`Transfer WETH maker→taker (Pulled) · Transfer USDC taker→maker (Pushed) · Swapped`.
**In the same animation frame the deliverable-depth bars on 2800, 3000 and the 2300 put collapse
together**, because all four read one wallet. *"One collateral pool. Four legs. The margin is enforced by
the VM, not by a clearinghouse."* This frame is structurally impossible for a pool, a vault, a v4 hook or
a signed order to render.

**1:40–2:05 — THETA AS A TOLL.**
`evm_increaseTime` +3 days, `anvil_mine`. Every curve visibly tightens toward its strike **with no
transaction**, and the **theta band opens on screen** — the shaded gap between the stale reserve point
and the decayed curve, read from `bandFor()`. *"Three days of theta just became a toll the next
arbitrageur pays you."* A small quote reverts `RmmInsideSpread(…)`, decoded as *"inside the theta band —
the next fill pays 41.20 USDC of decay"*. Then the arb clears it and the toll lands.

**2:05–2:25 — THE GUARD REFUSES.**
Taker asks 12 WETH on the 3000 leg → quote reverts `NotCovered(12.0, 3.1)`, decoded in the UI with
*"max fillable now: 3.1 WETH"* read from `coverage()`.
*"A competitor measured $25,109 of phantom depth on mainnet last week. Ours cannot exist — coverage is
checked in the same call that prices the trade."*

**2:25–2:45 — EXPIRY AND ROLL.**
Warp past T: the curve **snaps to a straight line at K**, one-way; the arb assigns (buys the remaining
ETH at exactly 2,600); the put keeps its ETH. *"Settlement is the same 62 bytes."* Then roll:
one multicall, `Shipped ×4 + Docked ×4`, **zero `Transfer` logs**, next Friday's book live.

**2:45–3:00 — UNDER THE HOOD.**
`forge test` (probe suite, CoreInvariants with the tolerance table, coverage fuzz, roll-twice, live-fork),
`forge build --sizes` with the margin visible, 10 seconds of `RmmSwap.sol` and `Coverage.sol`, repo +
commit graph.

**The demo's price source is independent of the maker.** The arb bot is driven by a **replayed real Base
ETH/USD series** (or live Uniswap v3 on the fork), never by a slider the presenter moves that is also the
curve's reference. Our own bot + our own oracle + our own curve = a puppet show, and technical judges
discount it entirely. The mocked feed exists only to drive the bot's reference — **the curve reads no
oracle at all**, which is also the direct answer to the Aevo/Ribbon $2.7M oracle exploit.

---

## 8. UI

**Stack: the existing `web/` app** — Next 16, React 19, Tailwind 4, wagmi 3, viem 2, with the working
`useQuote/useShip/useDock/useSwap/useAquaBalances/useShippedStrategies` hooks. **Do NOT start a Vite
project.** Visual system: `DESIGN.md` is **settled** — dark-only, OKLCH tokens, Geist Sans + Geist Mono
with `tabular-nums slashed-zero`, hairlines not shadows, one accent under 10% of pixels, 44px table rows,
140–200ms ease-out-quart motion, five states on every data surface, **no fake data ever**. Do not
re-litigate it per component.

### Screens (three finished, one drawer — not six at 70%)

**1. The Book (`/`) — hero.**
A single **shared-inventory instrument** at the top: one bar per token (WETH, USDC) with each leg's claim
stacked inside it, live. Beneath it the four legs as rows/cards: strike, expiry countdown, IV, moneyness
dot, **deliverable-depth bar**, theta band, realised toll. KPI strip: *Notional written · Backed % ·
Theta captured (realised, from fills — never a Black-Scholes model number) · Book delta · Fills 24h*.

**2. Write (`/write`).**
Pair → multi-strike chips (±5/10/20% moneyness) with IV defaulted from 30d realised vol → notional per
leg → payoff chart (position value vs S, HODL line, shaded assigned region) + **margin preview**
("this book needs 10.4 WETH of backing; you have 10.4") → Review with the compiled program bytes and the
`ship` calldata → Approve ×2 → Ship multicall.

**3. Leg detail (`/leg/[hash]`).**
The trading curve `y(x)` with the live reserve point and a **ghost of the τ = 0 constant-sum line that
the live curve morphs into as you drag a time scrubber**; the **theta band shaded** between the stale
point and the decayed curve; fills as markers; `ProgramInspector` (decoded instruction list + raw bytes);
Roll (ship-then-dock, with a **"0 tokens will move"** pre-sign preview) / Dock.

**4. Tape + demo drawer.**
Decoded receipt timeline (`Transfer` / `Pulled` / `Pushed` / `Swapped` / `Shipped` / `Docked`), decoded
custom errors in plain English, and a **chain-31337-only** drawer: market price (bot reference only),
run arb, warp time, mine, fund.

### The rule that deletes the highest-consequence bug class

**Every curve pixel and every preview number comes from `router.asView().quote()` sampled over a
multicall.** No TypeScript reimplementation of Φ or Φ⁻¹ anywhere. A wei-exact TS port of A&S erf plus an
inverse CDF is the single most likely thing to make the on-screen chart disagree with the chain during
the recording. It is also less work, and a better line: *"every point on this chart is an `eth_call` into
the VM."* TS float math is allowed **only** for the illustrative payoff overlay, labelled "model".

### The wow, ranked

1. **Four deliverable-depth bars collapsing together on one fill** — portfolio margin made visible, and
   structurally impossible for any pool/vault/v4-hook competitor to render.
2. **The curve breathing into a hockey stick and snapping to a straight line at K.**
3. **The theta band opening with zero transactions**, then a fill paying it.
4. **The zero-`Transfer`-log roll receipt.**
5. **`NotCovered(12.0, 3.1)` refusing on camera.**

---

## 9. Architecture and workstreams — one night, ~14 agents

**File ownership is exclusive.** Nobody edits a file another agent owns; cross-cutting needs go through
the owner. Small commits from hour 0.

### Contracts — 5 agents

| Agent | Owns | Work | Hours |
|---|---|---|---|
| **C1** | `contracts/src/math/{GaussianSolady,WadMathSolady}.sol`, `contracts/src/instructions/RmmSwap.sol` | Promote the probe math out of `src/probe/` (now `src/spikes/`). Productionise `RmmSwap` from `CurveProbeSolady._rmm`: **live τ + 1h floor**, τ=0 closed form, one-way settlement flags, 18/6 decimal normalisation, `EPS_OUT` band, 62-byte codec, named errors. *This is productionisation, not research.* | h0–h3 |
| **C2** | `contracts/src/instructions/Coverage.sol`, `contracts/src/StrikelineViews.sol` | `Coverage` wrapper (balance ∧ allowance, haircut, protocol-fee term, fail-closed). Views: `stableFor`, `coverage`, `bandFor`. | h0–h2 |
| **C3** | `contracts/src/StrikelineRouter.sol`, `contracts/script/Deploy.s.sol`, `contracts/foundry.toml` | Router + dispatcher; **`forge build --sizes` HARD GATE at h2** with the `PeggedSwap` drop-lever pre-approved; deterministic-nonce deploy so the address survives `--load-state`. | h0–h2 |
| **C4** | `contracts/test/strikeline/**` | The nine invariants of §5.7 + the justified-tolerance table + **USDC(6)/WETH(18) golden vectors first** (six scale paths: 2 pairs × 2 directions × exactIn/exactOut, each rounding toward the maker). | h1–h7 |
| **C5** | `contracts/test/fork/strikeline/**` | Fork e2e against the **official Aqua**: ship the 4-leg book, fill, coverage binds, warp, expiry, roll-twice. Extend `AquaBaseLiveFork.t.sol` so the **official-router fill is literally scene 1** of the recording (**budget 1.5h for the World-A path**). | h1–h6 |

### SDK / encoder — 1 agent

| **S1** | `web/src/lib/swapvm/{opcodes,instructions,index}.ts`, `web/src/lib/swapvm/__tests__/`, `contracts/test/encoding/vectors.json` | Add `rmmSwap()` and `coverage()` arg coders to the **existing, Solidity-verified** encoder; regenerate golden vectors **from Solidity**; vitest byte-equality. **HARD GATE h3 — no UI transaction path before this is green.** | h1–h3 |

### Scripts / integration — 2 agents

| **I1** | `scripts/fork/{bootstrap,book,arb,story,oracle,time,snapshot}.ts`, `Makefile` | Extend bootstrap: whale funding at irregular amounts, ship the 4-leg book **through `stableFor`**, `anvil_dumpState`. **Arb bot sizing is analytic and off-chain** — at ~660k gas/quote a 40-iteration on-chain bisection is ~26M gas against anvil's 30M limit, one block from failing live. Replay a real ETH/USD tape. | h2–h7 |
| **I2** | `docs/**`, `README.md`, `web/e2e/**` | Playwright run of the 3-minute script; README (mechanism note, prior-art table, invariant + tolerance table, measured gas/size, honest limits, "read this before believing anything"); **AI-usage disclosure + spec artifacts committed** (ETHGlobal rule); licence headers; video script; commit hygiene. | h5–h10 |

### UI — 5 agents

| **U1** | `web/src/app/{layout,providers,globals.css}`, `web/src/components/ui/**` | Shell, theme tokens from `DESIGN.md`, chain 31337, primitives (Button, Table, StatTile, Skeleton, Toast, Address, TokenAmount, Delta, ExplorerLink). | h0–h2 |
| **U2** | `web/src/app/page.tsx`, `web/src/components/book/**`, `web/src/hooks/useBook.ts` | The Book: shared-inventory instrument, four legs, deliverable bars, **live sibling coupling**, KPI strip. | h2–h7 |
| **U3** | `web/src/app/write/**`, `web/src/components/write/**` | Wizard, payoff chart, margin preview, `ProgramInspector` with raw bytes, Approve/Ship stepper. | h2–h7 |
| **U4** | `web/src/app/leg/[hash]/**`, `web/src/components/curve/**`, `web/src/hooks/useCurveSamples.ts` | Curve sampled from `quote()` via multicall, time scrubber, ghost expiry line, theta-band shading, Roll/Dock. | h2–h8 |
| **U5** | `web/src/components/tape/**`, `web/src/components/demo/**`, `web/src/hooks/useReceipts.ts` | Receipt/log decoder, decoded custom errors, activity feed, demo drawer, final polish pass against the vibe-coded checklist. | h3–h9 |

### Gates

| Hour | Gate |
|---|---|
| **h1** | Opcode arg layouts **frozen** and published in `docs/OPCODES.md`. A one-byte drift changes `keccak256(strategy)`, so `ship` succeeds and every quote reverts `SafeBalancesForTokenNotInActiveStrategy` — which reads as "no liquidity", not "encoding bug", and eats hours at 3am. |
| **h2** | `forge build --sizes` ≤ 24,000 B with the lever **decided, not discovered**. |
| **h3** | Golden vectors green (Solidity ↔ TS). **No UI transaction path before this.** |
| **h4** | First RMM fill on the fork with live τ and a printed quote. |
| **h5** | USDC(6)/WETH(18) vectors green in all six scale paths. |
| **h6** | `Coverage` clamp binds in a fork test; book shipped; `anvil_dumpState` written. |
| **h8** | UI running on the dumped state. |
| **h9** | Full rehearsal, stopwatch. |

### The hedge

**The curve and the coverage opcode are independent workstreams.** If the τ/decimals work slips,
`Coverage` + a stock `XYCConcentrateSwap` ladder still ships a complete, differentiated product. If
coverage slips, the options curve still ships. **Neither failure kills the submission** — which is not
true of any JIT-lending variant.

---

## 10. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Decimals.** The probe is validated on 18/18 DAI; the demo pair is WETH(18)/USDC(6). `rateRisky/rateStable` through `ceilDiv` on both legs is where a silent 1e12 error hides and surfaces at hour 8. | **Golden vectors before any UI work** (C4, h1). Six scale paths, each rounding toward the maker. Gate at h5. |
| 2 | **Shipping off-curve bricks the strategy.** One wei low ⇒ every quote reverts; one wei high ⇒ the surplus goes to the first taker. | **Every ship is sized through `stableFor()`** on-chain, rounded up. Never compute reserves with a true-Φ float. |
| 3 | **Router size.** Only +610 B of measured margin on the combined probe router. | Drop weighted/prims (frees `pow`/`ln`); **h2 hard gate**; pre-approved lever `PeggedSwap −1,394 B`. Keep `FeeProtocol`. |
| 4 | **Invariant tolerances.** `CoreInvariants` defaults (2 wei symmetry, 0 additivity) are unattainable for an approximated transcendental curve across 18/6 decimals. | Publish a **justified table** (default \| ours \| the numerical reason) with the measured Φ 6.95e-8 / Φ⁻¹ 1.18e-6 and the stated **minimum trade size**. Never silently widen a knob. |
| 5 | **Reverting quotes look like "no liquidity"** to an aggregator (`RmmInsideSpread`, `NotCovered`). | Two named errors with both numbers, decoded in the UI in plain English, plus `coverage()` and `bandFor()` getters so the UI never asks for more than is fillable. Framed as a **spread**, which is what it is. |
| 6 | **Docked siblings / roll order.** `safeBalances` reverts on a docked strategy; a docked hash is dead forever. | **Ship-then-dock** in one multicall; **monotonic maker-owned salt**; a test that rolls to identical parameters twice. |
| 7 | **Gas is 657–667k**, not the 12–160k several drafts claimed. | Publish the measured table in the README; state Base as the target (~$0.01 at 0.005 gwei). A judge runs `--gas-report` in ten seconds. |
| 8 | **Post-expiry two-sided book** would be a free ATM straddle written to the world. | `postExpiryOneWay` flag + `Deadline(T + 30m)`. Tested. |
| 9 | **"Isn't this Primitive / Superpose / Smile?"** | Prior-art table on the README's **first screen** and on a slide, with a one-line delta each (§2). If a judge draws the comparison first, we lose it by default. |
| 10 | **Demo authenticity** — our bot trading our curve. | Scene 1 is a real fill against a **third-party live Base maker** through the **official router**; the arb bot's reference is a **replayed real price tape**, not a presenter's slider. |
| 11 | **Scope.** Six 70%-done screens score worse on Usability than three that look shipped. | Protect, in order: the Book with collapsing coverage bars, the decoded receipt, the zero-transfer roll. Everything else is expendable. |
| 12 | **Honesty about the position.** It is short vol; it loses when realised vol exceeds the chosen IV; `dock` cancels quotes. | On screen, not only in the README. "Theta captured" is the **realised** number from fills, never a model output. Winners in this track are rewarded for stating limits plainly. |

---

## 11. What we will explicitly NOT build

- **No Aave / JIT-borrow / leverage leg.** Best single receipt in the field, worst feasibility: the KB
  prices it at 10–14h on the critical path, its fallback lands on top of competitor `barker`, and it is
  the consensus idea (expect 2–4 collisions). Day-2+ stretch at most: the *stable* leg on aTokens so the
  cash-secured side earns supply APY while it writes puts — **no borrow, no liquidation leg**.
- **No oracle in the pricing path.** The curve reads only `block.timestamp`. This is a differentiator,
  not an omission, and it removes the most fragile part of most fork demos from the critical path.
- **No third opcode.** `PhaseJump` (conditional flow on time/router storage) is the best "missing VM
  primitive" argument anyone made — and we do not need it: the one-way settlement gate is three lines
  inside `RmmSwap`. Mentioned in the README as future work; not built.
- **No router-storage `k` ledger, no `initLeg`, no `DynamicBalances`.** Fixed L, `k ≡ 0`, pure leaf
  (§4.2). Keeps `quote() == swap()` true by construction.
- **No fee on the option leg.** Theta is the spread.
- **No maker hooks, no taker callbacks, no `Extruction`, no vault, no custody contract.** Maker is an EOA
  (Safe/Zodiac ship-dock-only key is a day-2 stretch).
- **No option token, no exercise transaction, no settlement contract, no keeper, no indexer.**
- **No second pair (cbBTC), no second expiry, no full parameter builder** beyond the strike presets.
- **No TypeScript Φ/Φ⁻¹.** Every curve pixel is an `eth_call`.
- **No Vite project, no light mode, no fake data, no round demo numbers.**
- **No SLR / "phantom depth $0" boasting.** The KPI is *Backed 100%*.
- **No on-chain arb bisection** (26M gas). Analytic, off-chain, one swap.
- **No PC-rewind partial fill.** `Coverage` reverts with the numbers; day-2 if at all.
- **No claim that Aqua is required for anything except §3's four points.** In particular: not for
  "swap-as-settlement", not for "tokens stay in your wallet", not for "instant cancel".

---

## Runner-up (for the record, not for tonight)

**Fathom — Leverage AMM on Aave credit.** Highest mean score (7.17) and the best raw materials in the
set: "Leverage" is the **first** word in 1inch's own example list; the position **is** the Aqua
whitepaper's §4.1 worked example (1,000 → 3,000 collateral / 2,000 debt → 3 strategies → 9×); Bukov named
it on stage *and* named the exact taker flag (`isFirstTransferFromTaker`) that makes it settle; and
`prior-winners.md §7` confirms lending-as-a-position is untaken. The money shot — Aave `Borrow` + Aqua
`Pulled` + `Swapped` decoded in **one receipt from a wallet holding zero WETH** — is the most legible
15 seconds anyone could show.

**Why it is not the pick:** (a) the custom opcode is a `min()` clamp, and every recent 1st/2nd/3rd
encoded new position **economics** — Bebecita shipped a structurally identical 0x92 clamp-plus-hooks at
Lisbon and did **not** place; (b) EulerSwap is a live Uniswap v4 hook doing precisely JIT-borrow-for-depth,
so "impossible without Aqua" is refutable on stage; (c) a vault holding aTokens with borrow authority
re-introduces the custody Aqua exists to remove; (d) `completeness-review.md §4` prices the Aave leg at 10–14h on the
critical path against a one-night build, and its stated fallback (withdraw-only) *is* competitor
`barker`; (e) six of twenty candidate ideas were this, which tells you every other team reading the same
public sources lands here too.

**What we harvest from it:** the one-receipt demo discipline, and — as a **day-2** extension only —
catalog level 1 Aave (aTokens/stata wrappers, **no borrow**) under the cash-secured put, which lands the
whitepaper's "utility efficiency" claim with none of Fathom's risk.

---

### Day 2–7 (the deadline is Sun 13 Sep, not tomorrow), in priority order

1. **The markout receipt.** Replay a real Base ETH/USD tape twice on the fork — the Strikeline book vs a
   fee-tier-matched `XYCConcentrateSwap` strategy on identical capital — and publish maker P&L,
   realised-vs-implied vol, and vs-HODL. Keel already ships this pattern; **asserted economics lose to
   measured economics.**
2. **Safe as the maker** (Zodiac Roles, ship/dock-only key) — custody is the thesis.
3. **Aave level 1** on the stable leg (supply APY only, no borrow).
4. **A second expiry**, turning the ladder into a surface.
5. `PhaseJump` and the clamped partial fill.
