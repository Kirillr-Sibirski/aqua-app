# Position Catalog: "Sophisticated DeFi positions" as Aqua apps / SwapVM programs

Knowledge base for ETHGlobal ETHOnline 2026, 1inch track "Build an Aqua app" (written 2026-09-05).
Everything below is grounded in the local clones under
`/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad/refs/`
(`aqua/`, `swap-vm/` = HEAD f09a41e "remove-progressive-fees", `swap-vm-v1.0.2/`, `swap-vm-template/`, `sdks/typescript/aqua/`) plus the papers cited in §7.
Anything not verified is marked **UNCERTAIN**.

---

## 0. TL;DR

* Prize: **$5,000** ("Build an Aqua app": 1st $2,500 / 2nd $1,500 / 3rd $1,000) + a **$2,000 continuity track**. Judges score SwapVM usage higher; custom opcodes and modified-router redeploys are explicitly allowed; must show on-chain token transfers (local fork OK) and a real commit history. (ethglobal.com/events/ethonline2026/prizes, fetched 2026-09-05.)
* Aqua's one genuinely new primitive: a maker's **wallet balance can back N strategies simultaneously** (virtual balances may overcommit the real balance; tokens never leave the wallet until `pull`). Re-parameterising a strategy = `dock()` + `ship()` = **zero token transfers**. Any winning idea should make that visible.
* SwapVM's one genuinely new primitive for us: a **custom opcode is ~80-200 lines** (a library with `build/parse/exec(Context memory, bytes calldata)`) wired into a copy of `Opcodes.sol` and a 10-line router. Alternatively `Extruction` lets you call an external contract that mutates the swap registers **without** redeploying a router.
* Recommended top-5 (details §5): (1) **Oracle-anchored self-recentering CLMM + LVR-aware surge fee, re-shipped by an agent**; (2) **JIT lending-backed maker (Aave collateral quotes depth)**; (3) **RMM-01 covered-call curve opcode**; (4) **"Liquidity OS": one wallet backing CLMM + grid + pegged with an honest-quote cap opcode**; (5) **LBP / treasury diversification with time-varying weights**.

---

## 1. Ground truth: what Aqua and SwapVM actually let you do

### 1.1 Aqua registry (`aqua/src/Aqua.sol`, deployed `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` on 16 chains)

```solidity
// aqua/src/interfaces/IAqua.sol
function rawBalances(address maker, address app, bytes32 strategyHash, address token) external view returns (uint248 balance, uint8 tokensCount);
function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) external view returns (uint256 balance0, uint256 balance1); // reverts if token not in ACTIVE strategy
function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts) external returns (bytes32 strategyHash); // strategyHash = keccak256(strategy)
function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;   // must list ALL tokens; sets tokensCount = 0xff (docked)
function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external; // msg.sender == app; balance -= amount; safeTransferFrom(maker, to, amount)
function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount) external; // balance += amount; safeTransferFrom(msg.sender, maker, amount); reverts if docked/never shipped
```

Facts that shape position design:

* Storage is `_balances[maker][app][strategyHash][token]` packed as `uint248 balance | uint8 tokensCount` (`Aqua.sol`). Max 254 tokens per strategy (`tokensCount != 0xff`).
* **`ship()` moves no tokens and checks no balances.** You can ship 3 strategies each with virtual balance = 100% of your wallet WETH. Real tokens are consumed first-come-first-served by `pull` (which does `safeTransferFrom(maker, to)` - so the maker needs an ERC20 `approve(aqua, ...)`). A pull beyond the real wallet balance reverts inside the token transfer, not in Aqua.
* You can ship a **virtual balance for a token you do not hold** (e.g. a DAO selling TOKEN can ship `[TOKEN: 1_000_000e18, USDC: 2_000_000e6]` holding zero USDC; the USDC number only seeds the price ratio for curves).
* Strategies are immutable (`StrategiesMustBeImmutable`); re-parameterise via `dock()` + `ship()` (2 txs, ~4 SSTOREs, no ERC20 transfers). This is the "agent-operated market making is cheap" property.
* An **Aqua app is any contract that calls `pull/push`**; for SwapVM the app **is the router** (`AQUA.safeBalances(order.maker, address(this), orderHash, ...)` in `swap-vm/src/SwapVM.sol`).

### 1.2 SwapVM execution model (`swap-vm/src/SwapVM.sol`, `src/libs/VM.sol`)

```solidity
struct SwapQuery   { bytes32 orderHash; address maker; address taker; address tokenIn; address tokenOut; bool isExactIn; } // read-only
struct SwapRegisters { uint256 balanceIn; uint256 balanceOut; uint256 amountIn; uint256 amountOut; }                     // mutable
struct Context { VM vm; SwapQuery query; SwapRegisters swap; ProtocolFee fee; }
// VM.sol runLoop(): each instruction = [opcode:1 byte][argsLen:1 byte][args]; ctx.vm.dispatch(ctx, opcode, args)
```

* Taker fixes ONE of `amountIn`/`amountOut`; the program computes the other. `quote()` runs the same program with `isStaticContext = true` (instructions must not write storage then).
* **Aqua mode**: `MakerTraits.useAquaInsteadOfSignature` (bit 254). Then `orderHash = keccak256(abi.encode(order))` (no EIP-712, no signature), balances are pre-loaded from Aqua *before* the program runs (`ctx.swap.balanceIn/Out = AQUA.safeBalances(...)`), settlement is `AQUA.pull(maker -> taker)` and either `AQUA.push` by the router (`TakerTraits.useTransferFromAndAquaPush`, EOA-friendly) or by the taker in `preTransferInCallback` (`test/MinimalAquaXYC.t.sol`). Aqua mode forbids `shouldUnwrapWeth` and custom `receiver` (`MakerTraitsUnwrapIsIncompatibleWithAqua`, `MakerTraitsCustomReceiverIsIncompatibleWithAqua`).
* `ship(app=router, strategy=abi.encode(order), tokens=[tokenA,tokenB], amounts)` must satisfy `keccak256(abi.encode(order)) == router.hash(order)` (asserted in `test/MinimalAquaXYC.t.sol`).
* **Transfer ordering is taker-selectable**: `TakerTraits.isFirstTransferFromTaker` (bit 5) → transferIn then transferOut, else out then in (`SwapVM.swap`). Relevant for JIT-borrow designs (§2.n).
* **Maker hooks** (`src/interfaces/IMakerHooks.sol`): `preTransferIn / postTransferIn(…, feeIn, …) / preTransferOut / postTransferOut(…, feeOut, …)` with `(maker, taker, tokenIn, tokenOut, amountIn, amountOut, orderHash, makerData, takerData)`. If no explicit target, **the hook target defaults to the maker itself** (`MakerTraitsLib._getDataSliceWithTarget`: `target = IMakerHooks(maker)`), so a smart-contract maker (vault/Safe module) gets callbacks around settlement for free.
* Taker callbacks (`ITakerCallbacks.preTransferInCallback / preTransferOutCallback`) exist for contract takers (solvers).
* Native ETH payment supported when tokenIn == WETH (`_acceptNativePayment`).

### 1.3 Instruction set (HEAD, `src/libs/OpcodeList.sol` bank layout; `src/opcodes/Opcodes.sol` dispatcher)

| Bank | Opcode (hex) | Instruction | Encoding / behaviour (file) |
|---|---|---|---|
| control 0x00-0x0f | 00 Stop, 01 Revert, 02 Salt, 03 Jump, 04 Extruction | `Jump[uint16 nextPC]`; `Extruction[address target, bytes args]` calls `IExtruction.extruction(isStatic,nextPC,query,swap,args,takerData) → (nextPC, choppedLen, SwapRegisters)` (`instructions/Extruction.sol`) |
| guards 0x20-0x3f | 20 Deadline, 23 OnlyTakerTokenBalanceNonZero, 24 OnlyTakerTokenBalanceGte, 25 OnlyTakerTokenSupplyShareGte, 26 OnlyTxOriginTokenBalanceNonZero, 2b PrivateOrder, 2c WhitelistCoequal, 2d WhitelistSequential, 30 JumpIfDirection, 31 JumpIfTokenIn, 32 JumpIfTokenOut | whitelists compare last 10 bytes of addresses; `WhitelistCoequal[uint16 nextPC, uint80[] takers]` *jumps* if whitelisted (tiered pricing) |
| invalidators 0x40-0x4f | 40 InvalidateBit, 41 InvalidateTokenIn, 42 InvalidateTokenOut, 48 ValidateSeriesEpoch | `seriesEpochIncrease(seriesId)` cancels a whole series of signed orders (`SeriesEpochManager.sol`) |
| curves 0x50-0x6f | 50 XYCSwap, 51 XYCConcentrateSwap, 53 LimitSwap, 54 LimitSwapFullAmount, 58 PeggedSwap | see §1.5 for math; **free slots 52, 55-57, 59-6f for custom curves** |
| fees 0x70-0x8f | 70 FeeFlatIn, 71 FeeFlatOut, 80 FeeProtocol | `FeeFlatIn[uint24 feeBps]`, **BPS = 1e7** (0.3% = 30_000) (`FeeFlat.sol`); FeeProtocol supports dynamic `IProtocolFeeProvider.getRecipientAndFees(...)` |
| balances 0x90-0xaf | 90 StaticBalances, 91 DynamicBalances, 94 DutchAuctionBalanceIn, 95 DutchAuctionBalanceOut, 98 PiecewiseLinearScaleBalanceIn, 99 PiecewiseLinearScaleBalanceOut, 9c Decay, 9d TWAPSwap | `DutchAuction*[uint40 start, uint16 duration(≤18.2h), uint64 decayPerSecond<1e18]`; `PiecewiseLinearScale*[uint40 ts, uint24 scale0, (uint16 dur, uint24 scale)…]` scale=(v+1)/2^24; `Decay[uint16 period]`; `TWAPSwap[balanceIn, balanceOut, startTime, duration, priceBumpAfterIlliquidity(≥1e18), minTradeAmountOut]` |
| rates 0xb0-0xcf | b0 RequireMinRate, b1 AdjustMinRate, b2 OraclePriceAdjuster, b4 BaseFeeAdjuster | `RequireMinRate[uint64 rateA, uint64 rateB]` (fails if amountIn/amountOut < rateIn/rateOut); `OraclePriceAdjuster[uint64 maxPriceDecay, uint16 maxStaleness, uint8 oracleDecimals, address chainlink]` — only ever *improves* the taker's price toward the oracle, capped |

**Two dispatchers exist.** `AquaOpcodes.sol` (used by `AquaSwapVMRouter`) wires only 16 opcodes: Jump, JumpIfTokenIn/Out, Deadline, the 4 OnlyTaker*/TxOrigin gates, XYCSwap, XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction. It has **no** StaticBalances/DynamicBalances (Aqua supplies balances), no LimitSwap, TWAPSwap, DutchAuction, PiecewiseLinearScale, OraclePriceAdjuster, MinRate, Invalidators, Whitelists. `Opcodes.sol` (used by `SwapVMRouter`) wires all 40, **and `SwapVMRouter` also supports Aqua mode** (Aqua logic lives in the `SwapVM` base). **UNCERTAIN which of the two is deployed at `0x111111338c5091e8440b67b168bae16a668ac0de`** — `aqua/README.md:492` just says "SwapVM router". Since the prize allows modified-router redeploys, plan to deploy your own router on the fork regardless.

**Two API generations.** `swap-vm-v1.0.2` (and `swap-vm-template`, pinned to swap-vm commit `b44977a`) use the *old* API: `contract AquaAMM is AquaOpcodes { constructor(address aqua) AquaOpcodes(aqua) }`, `Program.build(_xycConcentrateGrowLiquidity2D, XYCConcentrateArgsBuilder.build2D(...))`, opcode index = position in `_opcodes()` array, fee unit 1e9. HEAD uses per-instruction libraries (`XYCConcentrateSwap.build(sqrtMin, sqrtMax)`), the `Opcode` enum bank layout and fee unit 1e7. Pick one and pin it; do not mix. HEAD is cleaner for custom opcodes; the template is Hardhat+TS and closer to what 1inch's own examples use.

### 1.4 How to add a custom opcode (HEAD API)

```solidity
// 1) src/instructions/MyCurve.sol
library MyCurveSwap {
    Opcode constant opcode = Opcode._52;               // take a free slot in the right bank (curves 0x50-0x6f)
    function build(MemoryPtr p, uint256 a, uint256 b) internal pure returns (MemoryPtr ptr) {
        ptr = p.pushHeader(opcode); ptr = ptr.push(a, 32).push(b, 32); p.patchLength(ptr);
    }
    function exec(Context memory ctx, bytes calldata args) internal view {
        // read ctx.swap.balanceIn/Out (already loaded from Aqua), write ctx.swap.amountOut (exactIn) or amountIn (exactOut)
        // rounding: amountOut floor, amountIn ceil; cap amountOut <= balanceOut; must be identical in quote & swap
    }
}
// 2) src/opcodes/MyOpcodes.sol: copy Opcodes.sol, add `else if (opcode == MyCurveSwap.opcode.asU8()) MyCurveSwap.exec(ctx, args);`
// 3) src/routers/MyRouter.sol: contract MyRouter is Simulator, SwapVM, MyOpcodes { constructor(aqua, weth, owner, name, version) SwapVM(...) {} function _dispatch(...) internal override { _runOpcode(ctx, opcode, args); } }
// 4) test against test/invariants/CoreInvariants.t.sol (symmetry, monotonicity, quote==swap, rounding favours maker)
```

Wrapping instructions (fees, Decay, DynamicBalances, TWAPSwap, MinRate) call `ctx.runLoop()` to execute the *rest* of the program and post-process — that is how you build "pre/post" logic (e.g. a fee that depends on the computed price).

`Extruction` is the no-redeploy alternative: the target gets the full registers and may even run sub-programs (`test/mocks/BestRouteSelector.sol` re-enters `ctx.runLoop()` on several candidate bytecodes and returns the best `amountOut`). Judges said "SwapVM opcodes … scored higher"; a real opcode in a redeployed router is the stronger signal, and Extruction can still be used to show routing between strategies.

### 1.5 Existing curve math (exactly as implemented)

* **XYCSwap** (`XYCSwap.sol:172`): `amountOut = amountIn·bOut / (bIn + amountIn)` (floor); `amountIn = ceil(amountOut·bIn / (bOut − amountOut))`.
* **XYCConcentrateSwap** (`XYCConcentrate.sol:237-300`): args `[sqrtPriceMin, sqrtPriceMax]` in 1e18, P = tokenGt/tokenLt. Liquidity is *solved from balances* every swap: with `β = A·√Pmin + B/√Pmax`, `L = (β + √(β² + 4(√Pmax−√Pmin)·A·B/√Pmax)) · √Pmax / (2(√Pmax−√Pmin))`; virtual reserves `A + L/√Pmax`, `B + L·√Pmin`; then constant-product on virtuals; partial-fill clamps `amountOut ≤ balanceOut`. Fees auto-reinvest because L is recomputed. Helpers `computeBalances(L, √Pspot, √Pmin, √Pmax)` and `computeLiquidityFromAmounts(...)` exist for shipping the right amounts.
* **PeggedSwap** (`PeggedSwap.sol`, `libs/PeggedSwapMath.sol`): invariant `√u + √v + A(u+v) = C` with `u = x/X0`, `v = y/Y0`, A in 1e27 (0…5000e27), closed-form solve `w = 2R/(1+√(1+4aR))`, `v = w²`. Guidance in-source: stables A≈100e27-300e27, LST/LRT 20e27-100e27, wrapped BTC 5e27-20e27. Finite reserves → hard price bounds.
* **LimitSwap** (`LimitSwap.sol:625`): `amountOut = amountIn·bOut/bIn`, partial fill up to balances. **Gotcha:** in Aqua mode balances are *dynamic*, so after a partial fill the ratio `bOut/bIn` moves (price worsens for takers) — LimitSwap over Aqua balances is *not* a fixed-price order. For fixed price on Aqua you need `StaticBalances` (which overrides the Aqua balances → quotes ignore remaining capacity) or a custom opcode (§5.4 `AquaLimitSwap`).
* **TWAPSwap** (`TWAPSwap.sol`): linear unlock `unlocked = balanceOut·elapsed/duration`; price anchored to last fill and decayed by `0.9999^seconds` (= −0.6%/min, −5.8%/10min, −30.2%/h); after an illiquid gap the price bumps by up to `priceBumpAfterIlliquidity`; `minTradeAmountOut` enforced during the window. Storage per orderHash; readable via `twapLastSwap(orderHash)`.
* **Decay** (`Decay.sol`): Mooniswap-style; after each swap, an offset equal to the traded amounts is added *against* the counter-direction and decays linearly over `period` seconds — cheap MEV/sandwich resistance.
* **BaseFeeAdjuster**: gives the taker a discount = `(basefee − baseGasPrice)·gasAmount·ethPrice` capped at `maxDecay` of amountIn.

Fixed point conventions: 1e18 for prices/sqrtPrices/decays, 1e27 for PeggedSwap, 1e7 for fee bps, 2^24 for piecewise scales. `libs/Power.sol` only does integer-exponent `pow` (square-and-multiply); fractional powers/ln/exp/Φ must be brought in (PRBMath UD60x18 or hand-rolled).

---

## 2. Catalog of candidate positions

Format per candidate: payoff → who/pain → math → existing instructions → custom opcode → complexity (strong 3-4 person team, overnight) → demo-ability → wow.

### (a) Replicating market maker: covered call / put-writing as a CFMM curve (RMM-01)

* **Payoff.** LP portfolio value tracks the Black-Scholes price of a covered call: `V(c) = c·(1−Φ(d1)) + K·Φ(d2)`, `d1 = (ln(c/K) + σ²τ/2)/(σ√τ)`, `d2 = d1 − σ√τ` (Angeris-Evans-Chitra 2021 §3.3). Arbitrageurs do the delta-hedging for you; no oracle needed; as τ→0 it becomes a limit sell at K (§3.2: the terminal-payoff CFMM is the constant-sum `K − K·R1 − R2 = 0`, i.e. "hold 1 unit or K stable"). Put-writing = same with roles swapped (hold K stable, sell it for the asset below K).
* **Who / pain.** Yield-seeking holders who want to sell covered calls on-chain without an options venue; options-vault (DOV) users who today accept weekly auctions with poor pricing. Pain: no liquid on-chain options for long-tail assets; DOVs need custody.
* **Math to implement (per unit liquidity, R1 ∈ [0,1] risky, R2 ∈ [0,K] stable).** Trading function: `R2 = K·Φ(Φ⁻¹(1 − R1) − σ√τ)` (paper eq. after (5), `ψ = 0 iff R2 − KΦ(Φ⁻¹(1−R1) − σ√τ) ≤ 0`); reserves at price c: `R1 = 1 − Φ(d1)`, `R2 = KΦ(d2)`. Spot price `p(R1) = −dR2/dR1 = K·exp(σ√τ·Φ⁻¹(1−R1) − σ²τ/2)` (check: plugging `Φ⁻¹(1−R1)=d1` gives `p = c`). With total liquidity L and an invariant offset k (fees accumulate in k):
  * risky in, exact-in: `x' = x + Δx(1−f)`; `y' = L·K·Φ(Φ⁻¹(1 − x'/L) − σ√τ) + k`; `Δy = y − y'` (floor).
  * stable in, exact-in: `y' = y + Δy(1−f)`; `x' = L·(1 − Φ(Φ⁻¹((y'−k)/(LK)) + σ√τ))`; `Δx = x − x'`.
  * exact-out: same equations inverted; both directions are closed-form given Φ and Φ⁻¹.
  * τ = `maturity − block.timestamp` recomputed each swap → the curve self-updates ("theta") without any oracle. The paper notes a fee-less RMM is not self-financing across theta decay (§3.3, "we conjecture that fees may restore…"), so charge a fee.
  * Φ: `Φ(z) = ½·erfc(−z/√2)`, Abramowitz-Stegun 7.1.26 (|err| ≤ 1.5e-7): `erf(x) ≈ 1 − (a1 t + a2 t² + a3 t³ + a4 t⁴ + a5 t⁵)e^{−x²}`, `t = 1/(1+0.3275911x)`, a = (0.254829592, −0.284496736, 1.421413741, −1.453152027, 1.061405429). Φ⁻¹: Acklam rational approximation (rel err 1.15e-9) or 40-step bisection on Φ (simplest; ~40×(exp+mul) ≈ 150-250k gas, fine on a fork). Primitive Finance's `solstat/Gaussian.sol` is the reference Solidity implementation (**UNCERTAIN license**).
  * L: either fixed in args (surplus balances = un-reinvested fees; simplest) or solved by bisection from balances like XYCConcentrate does (adds another ~40 iterations).
* **Existing instructions.** None computes this curve. Wrap with `FeeFlatIn`, `Deadline` (= maturity), `Decay`, `Salt`.
* **Custom opcode.** `RMM01Swap[uint256 strikeK(1e18), uint64 sigma(1e18), uint40 maturity, uint256 liquidity, uint256 invariantK]` in the curves bank (e.g. 0x55). ~250 lines incl. Gaussian lib.
* **Complexity.** 10-14 h (math lib + rounding + symmetry tests). Highest numerical risk of the list.
* **Demo.** Fork: ship WETH/USDC RMM strategy from an EOA, warp time, show the quote curve drifting toward the strike, arb bot swaps, transfers visible. UI plot of V(c) vs reserves is very compelling.
* **Wow.** 5/5 — "options written by a bytecode curve, no custody".

### (b) Grid trading bot as a set of range orders

* **Payoff.** Buy-low/sell-high ladder around a mid price: rungs at `p_k = p0·(1+s)^k`, k = −n…n, size q per rung; earns the spread s on every round-trip; loses if price trends out of the grid (inventory risk).
* **Who / pain.** Retail/CEX grid-bot users (Binance/Pionex grid bots are among the most-used retail strategies) who have no non-custodial on-chain equivalent; today on-chain grids require locking capital per rung in a CLMM.
* **Math.** Grid = CLMM whose liquidity density is a sum of deltas at discrete ticks. State is derivable from balances alone: with x risky held and q per rung, the number of unfilled sell rungs is `x/q`; a stable-in swap of Δy consumes rungs from the lowest unfilled sell rung upward: `Δx = Σ_k min(q, remaining_k)` with `Δy_k = q·p_k`; symmetric for buys. Loop over ≤ 64 rungs.
* **Existing instructions (no custom code).** N Aqua strategies each `FeeFlatIn + XYCConcentrateSwap(√p_k, √p_{k+1})` (each a one-tick range order that flips between 100% A and 100% B) — `Strategies.buildXYCConcentrateOrder` already packages this. All N can be shipped against the **same** wallet balance (Aqua overcommit), which is the Aqua-native trick; downside: once real balance is consumed by rung 1, quotes for rung 2 still succeed but `pull` reverts (needs §5.4 `RealBalanceCap`).
* **Custom opcode.** `GridSwap[uint256 p0(1e18), uint32 stepBps, uint8 nLevels, uint256 rungSize]` (curves bank) — single strategy, balances are the state, exact-in/out both loops. ~150 lines.
* **Complexity.** 3 h with existing instructions; 6-8 h with `GridSwap` + invariant tests.
* **Demo.** Very visual: price oscillates (arb bot), each fill is a transfer, PnL accrues; show the same 10 WETH backing 20 rungs.
* **Wow.** 3/5 alone; 4/5 inside the "Liquidity OS" story (§2.l).

### (c) TWAMM / DCA accumulation with price bands

* **Payoff.** Sell (or buy) S tokens linearly over T with execution near TWAP; band = floor/ceiling price; unfilled tranches roll forward with a price bump.
* **Who / pain.** DAOs/treasuries and whales executing large orders; today: CoW TWAP (offchain), Paradigm's TWAMM (virtual orders against an embedded x·y=k pool: `X' = √(X0² + 2·sx·sy·t)` for opposing flows; ~hourly expiry granularity) — needs pooled liquidity; Aqua keeps the treasury in the Safe.
* **Math.** Already in `TWAPSwap` (§1.5). Band: `RequireMinRate[rateA, rateB]` as the floor (reverts fills below), or `AdjustMinRate` to clamp; `Deadline` for the end; `BaseFeeAdjuster` to compensate gas. "Buy-side DCA" = same opcode with tokens swapped.
* **Existing instructions.** `TWAPSwap`, `RequireMinRate`, `Deadline`, `Salt` — but these are only in `Opcodes.sol`, not `AquaOpcodes.sol`; use `SwapVMRouter`(-style) with `useAquaInsteadOfSignature`. Note TWAPSwap **sets** `balanceIn/balanceOut` itself (from its own args and storage) and then `runLoop()`s into a `LimitSwap`; the Aqua virtual balance only acts as the settlement cap.
* **Custom opcode.** Optional `TWAPOracleBand` (Chainlink-referenced floor/ceiling instead of a static rate) ~60 lines.
* **Complexity.** 2-4 h. **Demo.** Fine (warp time, fills). **Wow.** 2/5 (exists in 1inch's own catalog).

### (d) Auto-rebalancing weighted portfolio / Liquidity Bootstrapping Pool (time-varying weights)

* **Payoff.** Balancer weighted invariant `V = Π B_i^{w_i}`; spot `SP = (B_i/w_i)/(B_o/w_o)`; `A_o = B_o·(1 − (B_i/(B_i+A_i))^{w_i/w_o})` (docs.balancer.fi weighted math). With `w(t)` sliding linearly (LBP, e.g. 96/4 → 50/50 — **UNCERTAIN** exact typical values), the pool auto-sells the project token at a declining price while arbitrageurs keep the portfolio at target weights. Constant-weight version = passive index that auto-rebalances (TokenSets-like).
* **Who / pain.** Token launches and DAO treasury diversification (Balancer LBPs, Fjord); pain: LBP capital must be deposited into a pool contract and the launch is a large custody/ops event. With Aqua the treasury never leaves the multisig, and the DAO can dock/re-ship to change the schedule.
* **Math (Solidity).** Need fractional `pow`: `A_o = B_o·(1 − exp((w_i/w_o)·ln(B_i/(B_i+A_i))))` with PRBMath `UD60x18.pow`/`ln`/`exp` (≈ 5-8k gas). Weight schedule: `w_A(t) = w_start + (w_end − w_start)·clamp((t − t0)/(t1 − t0), 0, 1)`; `w_B = 1 − w_A`. Rounding: round `pow` up for amountIn, down for amountOut (PRBMath is round-to-nearest; add ±1 wei guards). Two-token only.
* **Existing instructions.** None does fractional-power curves. `PiecewiseLinearScaleBalanceIn/Out` are the closest analogue (time-piecewise scaling of balances) but cannot express a weight change of a curve. `RequireMinRate` = price floor; `Deadline`; `Decay` for anti-sniping at start.
* **Custom opcode.** `WeightedSwap[uint40 t0, uint40 t1, uint64 wStartA(1e18), uint64 wEndA(1e18)]` (curves bank) ~120 lines + PRBMath import.
* **Complexity.** 6-8 h. **Demo.** Warp time, show price gliding down, buyers arrive, treasury Safe balance changes only on fills. **Wow.** 4/5 — "LBP without a pool".

### (e) Volatility-responsive / LVR-aware dynamic fee ("toxic flow" pricing, am-AMM-like)

* **Payoff.** Fee adapts to realised volatility or to the deviation between the pool price and an oracle, so arbitrage ("toxic") flow pays for the adverse selection it causes and uninformed flow keeps paying the base fee.
* **Who / pain.** Every passive LP. Milionis-Moallemi-Roughgarden-Zhang (2022, arXiv 2208.06046): instantaneous LVR `ℓ(σ,P) = ½·σ²·P²·|x*'(P)|` (eq. 8); CPMM: `ℓ/V = σ²/8` (eq. 19) → daily σ = 5% loses **3.125 bp/day ≈ 11.4%/yr** of pool value to arbitrageurs; for a Uniswap-v3 range order `ℓ` is the same but V is smaller, so per-dollar LVR "can be arbitrarily high" (Example 4). Own calc: a ±10% range has `V_range/V_full = 1 − (√0.9 + 1/√1.1)/2 ≈ 0.049`, i.e. **~20× the per-dollar LVR** (≈ 92%/yr at 60% annualised vol). 99.991% of a Uniswap-v2 ETH/USDC LP's P&L variance is just ETH beta; the alpha (fees − LVR) is what a fee policy can move. am-AMM (Adams-Moallemi-Reynolds-Robinson 2024) shows an auction-managed fee setter beats any fixed fee in equilibrium liquidity; Bunni v2 ships am-AMM + "surge fees".
* **Math (two workable variants).**
  1. *Surge fee*: keep `(lastPrice, ewmaVar, lastTs)` per orderHash; on each swap `r = ln(p_now/p_last)`, `ewmaVar = λ·ewmaVar + (1−λ)·r²/Δt`; fee = `clamp(base + κ·√ewmaVar·√blockTime, min, max)`. Needs ln (PRBMath) or use `|Δp|/p` as a proxy (no ln).
  2. *Oracle-deviation fee* (no storage): `dev = |p_pool − p_oracle|/p_oracle`; if the trade moves the pool price **toward** the oracle: fee = base; if **away**: fee = base + κ·dev (the trade is informed). Cheap: one Chainlink read. Compose as a wrapping instruction: compute the pre-trade pool price from `balanceIn/balanceOut` (or from the inner `runLoop()` result), then adjust `amountIn`/`amountOut` like `FeeFlatIn` does.
  Sizing rule of thumb: per-12s-block σ at 60%/yr ≈ 0.6·√(12/31.5e6) ≈ 3.7 bp; the "no-trade region" equals the fee, so a 5-10 bp base with surge to 50-100 bp during jumps captures most small-move LVR.
* **Existing instructions.** `FeeFlatIn/Out` (static), `Decay` (a crude version: makes immediate counter-trades expensive), `OraclePriceAdjuster` (only *improves* taker price toward oracle — the opposite direction), `FeeProtocol` with an `IProtocolFeeProvider` (dynamic **protocol** fee via external `staticcall` — can host a vol model off-VM but the fee goes to a receiver, not the LP).
* **Custom opcode.** `SurgeFeeIn[uint24 baseBps, uint24 maxBps, uint32 kappa, uint16 halfLife]` (fees bank 0x72) with storage, or `OracleSpreadFee[uint24 baseBps, uint32 kappa, uint16 staleness, address oracle]` (stateless). 100-150 lines.
* **Complexity.** 4-6 h. **Demo.** Simulate a price jump on the fork (move the mocked Chainlink answer or trade on Uniswap), show the arb quote getting a 60 bp fee while a retail trade gets 5 bp. **Wow.** 3/5 alone, 5/5 when combined with (f).

### (f) Oracle-anchored, self-recentering concentrated liquidity

* **Payoff.** The CLMM range is not static: at every quote `[Pmin, Pmax] = P_oracle·[1−w, 1+w]` (optionally skewed by inventory). The position is therefore always in range and always quoting around the oracle; arbitrage profit is bounded by oracle lag + fee instead of by range staleness.
* **Who / pain.** Uniswap-v3 LPs whose ranges go out of range (no fees, full LVR) and who pay gas to rebalance; vault managers (Arrakis, Gamma) exist purely to do this off-chain. Because `XYCConcentrateSwap` solves L from balances, moving the bounds needs no state migration: `computeLiquidity` always returns a spot inside the new bounds (virtual reserves `A + L/√Pmax`, `B + L√Pmin` ⇒ `Pmin ≤ spot ≤ Pmax`).
* **Math.** `√Pmin = √(P_o·(1−w))`, `√Pmax = √(P_o·(1+w))` via `Math.sqrt` on 1e36-scaled values; then reuse `XYCConcentrateSwap.exec` body verbatim. Inventory skew (Avellaneda-Stoikov reservation price): `center = P_o·(1 − γ·q)`, `q = (x·P_o − y)/(x·P_o + y) ∈ [−1,1]`, so a maker long risky quotes slightly lower to shed inventory. Staleness check identical to `OraclePriceAdjuster` (`block.timestamp ≤ updatedAt + maxStaleness`). Quote/swap consistency holds as long as both read the same oracle round in the same block.
* **Existing instructions.** `XYCConcentrateSwap` (static bounds), `OraclePriceAdjuster` (adjusts only in the taker's favour), `FeeFlatIn`, `Decay`.
* **Custom opcode.** `XYCConcentrateOracle[uint32 widthBps, uint32 skewGammaBps, uint16 maxStaleness, uint8 oracleDecimals, address oracle]` (curves bank 0x52). ~120 lines, 80 of them copied from `XYCConcentrate.sol`.
* **Complexity.** 3-5 h. **Demo.** Move the fork's Chainlink mock (or use a real feed + `vm.warp`), show the quote following it, an arb bot filling both directions, LP balances staying balanced. **Wow.** 4/5; 5/5 with (e) and (o).

### (g) Stop-loss / take-profit / trailing stop as maker strategies

* **Payoff.** Non-custodial conditional orders: liquidity that only exists when an oracle condition holds (`P ≤ stop` → sell everything via Dutch/TWAP; `P ≥ take` → sell). Trailing stop: stop = HWM·(1 − d).
* **Who / pain.** Retail traders on DEXs have no native stop orders; existing solutions (1inch limit orders w/ predicates, Gelato) require signed orders + keepers; Aqua keeps tokens in the wallet and the *same* WETH can simultaneously sit in a CLMM and a stop-loss (§2.l).
* **Math.** Gate: `require(cond(oraclePrice, threshold))`. Exit pricing: `DutchAuctionBalanceIn` starting from oracle price (avoid dumping at a stale static price), `RequireMinRate` floor, `InvalidateTokenOut`/Aqua balance as the cap. Trailing: store `hwm[orderHash] = max(hwm, oracle)`; storage can only be written in non-static context, so either update it on every swap (wrong: nobody swaps before trigger) or expose a permissionless `poke(orderHash)` on the router (like `seriesEpochIncrease`) that keepers call; the opcode then reads `hwm`.
* **Existing instructions.** `Deadline`, `DutchAuctionBalanceIn/Out`, `PiecewiseLinearScale*`, `RequireMinRate`, `LimitSwap`, `JumpIf*` (but no oracle-conditional jump).
* **Custom opcode.** `OracleGate[address oracle, uint8 decimals, uint16 staleness, uint256 threshold(1e18), uint8 mode(below/above)]` (guards bank 0x21) ~60 lines; `TrailingStopGate` + router `poke` ~120 lines.
* **Complexity.** 2-3 h (gate) / 5 h (trailing). **Demo.** Clear. **Wow.** 3/5.

### (h) Dutch-auction liquidation / DAO treasury diversification sale with a floor

* **Payoff.** Sell S TOKEN for USDC over T with price decaying from `p_start` and a hard floor; unfilled inventory keeps decaying until arbs bite.
* **Who / pain.** DAO treasuries (diversify into stables), protocols liquidating collateral (Gnosis Auction, CoW auctions), Fjord/LBP alternatives. Pain: OTC deals leak price; pooled auctions require deposits; with Aqua the treasury multisig just approves and ships.
* **Math.** Existing: `TWAPSwap` (linear unlock + exponential decay + bump) or `StaticBalances + DutchAuctionBalanceIn(start, ≤18.2h, decay/s) + LimitSwap + InvalidateTokenOut + RequireMinRate` or `PiecewiseLinearScaleBalanceIn` for arbitrary piecewise schedules (>18 h via multiple segments). Decay parameter for −20 %/h: `decay = exp(ln(0.8)/3600)·1e18 ≈ 0.999938e18`.
* **Existing instructions cover 100 %** (on the full `Opcodes` router in Aqua mode). Custom opcode not needed → weaker SwapVM score; could add `OracleFloor` (floor relative to Chainlink rather than static).
* **Complexity.** 2-3 h. **Demo.** Good (warp + fills). **Wow.** 3/5.

### (i) Peg-defense / stablecoin-issuer liquidity that only quotes near peg with widening spreads

* **Payoff.** Issuer quotes STABLE/USDC with a `PeggedSwap` curve, but only within an oracle band (e.g. ±1 %) and with a fee/spread that widens with inventory skew and with deviation from peg; outside the band the strategy refuses (so the issuer's reserves are not drained during a depeg).
* **Who / pain.** Stablecoin/LST issuers and their PSMs (Maker PSM, Ethena, LST protocols): they must lock hundreds of millions in Curve pools; with Aqua the reserves stay in the issuer's treasury and can back several venues at once; EulerSwap's whitepaper explicitly pitches JIT stable liquidity for "new stable asset issuers".
* **Math.** `PeggedSwap(x0, y0, A≈100e27…300e27, rateA, rateB)`; gate `|P_oracle − 1| ≤ band`; skew fee `fee = base + κ·|x − y|/(x + y)`; optionally one-directional (`JumpIfDirection` → `Revert`) when the issuer only wants to buy back below peg.
* **Existing instructions.** `PeggedSwap`, `FeeFlatIn`, `JumpIfDirection`, `Revert`, `Decay`.
* **Custom opcode.** `PegBandGate` (= `OracleGate` from (g)) + `SkewFee[uint24 baseBps, uint32 kappa]` (fees bank). ~100 lines total.
* **Complexity.** 3-4 h. **Demo.** OK (mock oracle depeg → quotes stop). **Wow.** 3/5.

### (j) Perpetual / funding-style positions

* **Payoff.** Leverage/funding needs margin accounting, liquidation and a mark price; SwapVM is a spot-swap VM whose only settlement is `pull/push` of two tokens. You could mimic "funding" as a time-varying price adjustment (`Decay`, `PiecewiseLinearScale`) but there is no way to express a position that is not a spot exchange of two tokens.
* **Verdict.** Poor fit; skip. (A "basis trade" with a real perp venue belongs to (m).)

### (k) Conditional / gated liquidity for allowlisted solvers

* **Payoff.** Tighter spread or exclusive liquidity for takers who hold a token/NFT or are on a list; tiered pricing with `WhitelistCoequal` jumping to a cheaper fee branch; `WhitelistSequential` gives time-phased exclusivity (RFQ-like "first solver gets 10 s").
* **Existing instructions cover 100 %**: `OnlyTakerTokenBalanceNonZero/Gte`, `OnlyTakerTokenSupplyShareGte`, `PrivateOrder`, `WhitelistCoequal[nextPC, takers]`, `WhitelistSequential[start, nextPC, (dur, taker)…]`. No custom opcode; low sophistication. Use as a *feature* of a bigger app (e.g. "solver tier pays 1 bp, public pays 10 bp").
* **Complexity.** 1-2 h. **Wow.** 1/5.

### (l) "Liquidity OS": one wallet sharing balances across several curves simultaneously

* **Payoff.** An LP's WETH/USDC backs, at once: a CLMM around the oracle (f), a grid/limit ladder (b), a pegged/PSM strategy (i) and a stop-loss (g). Whichever strategy a taker hits pulls the real tokens; the others keep quoting until the wallet is empty. Capital efficiency = N× (bounded by real balance), no fragmentation, no pool contracts, re-parameterisation is free.
* **Who / pain.** Professional/semi-pro LPs and DAOs who today split capital between venues and pay to rebalance; 1inch's own pitch ("access the same asset across multiple positions with one approval", 1inch.com/aqua).
* **The one thing that is broken today** (own analysis of `Aqua.pull`): virtual balances can exceed the real balance, so `quote()` can promise more than `pull` can deliver → reverting swaps and solver blacklisting. Fix = a guard opcode that clamps `balanceOut` (and `balanceIn` for pegged curves) to `min(virtual, IERC20(tokenOut).balanceOf(maker), IERC20(tokenOut).allowance(maker, AQUA))` before the curve runs — an *honest-quote* instruction that only makes sense in Aqua mode. Second useful opcode: `SharedBudget` that additionally subtracts what sibling strategies have consumed this block (via transient storage), preventing two fills in one block from over-drawing.
* **Existing instructions.** All the curves; `Extruction` with a `BestRouteSelector`-style target could even route one taker call to the best of the maker's strategies.
* **Custom opcode.** `RealBalanceCap[]` (balances bank 0x92, ~40 lines) — trivially small but *conceptually* the most Aqua-specific opcode in this document.
* **Complexity.** 5-8 h for the app (ship/dock UI or script for N strategies, dashboard reading `rawBalances`, arb bot), 1 h for the opcode. **Demo.** Excellent: one `approve`, four `ship`s, live table of virtual vs real balances, fills coming from different strategies, then `dock`+`ship` re-tuning with zero transfers. **Wow.** 5/5 for the narrative.

### (m) Basis / carry, delta-neutral LP hedged via lending (Aqua ↔ lending interplay through hooks)

* **Payoff.** LP provides WETH/USDC liquidity but keeps net ETH delta ≈ 0 by borrowing the ETH side against USDC collateral (EulerSwap §3 "risk-neutral LP strategies": "use USDC collateral to borrow ETH and then supply liquidity"). After each fill the hook rebalances: on selling ETH (ETH out), the vault borrows more ETH; on buying ETH (ETH in), it repays. Carry = fees + supply yield − borrow rate.
* **Mechanics in SwapVM.** Maker = a `HedgedMakerVault` contract implementing `IMakerHooks` (hook target defaults to maker): `preTransferOut` → `POOL.borrow(tokenOut, amountOut, 2, 0, address(this))` (or `withdraw` if it has aTokens); `postTransferIn` → `POOL.supply(tokenIn, amountIn − feeIn)` / `repay`. Taker sets `isFirstTransferFromTaker = true` so collateral arrives before the borrow. Vault must `approve(AQUA)` for both tokens. Quoting depth = borrowing power (see (n)).
* **Complexity.** 10-14 h (Aave v3 on a mainnet fork, health-factor guards, hedging math). **Demo.** Strong but fiddly (need real Aave addresses on the fork). **Wow.** 4/5.

### (n) JIT liquidity from lending positions (EulerSwap / Fluid style): quote from collateral that stays productive

* **Payoff.** The maker's capital sits in Aave (earning supply APY, usable as collateral) and is only pulled/borrowed at fill time. EulerSwap claims "up to 50× greater depth" for correlated pairs ($1M USDC at LTV 0.95 → $20M deposits / $19M debt swing per side, whitepaper §2), and pitches it to stable issuers as an alternative to liquidity mining.
* **Two implementation levels.**
  1. *Productive wallet balances (2-3 h)*: ship strategies on **non-rebasing yield tokens** (wstETH, sDAI/sUSDS, Aave "stata" ERC-4626 wrappers, Morpho vault shares). A custom `Erc4626RateAdjuster[address vaultA, address vaultB]` (balances bank) rescales `balanceIn/Out` by `convertToAssets(1e18)` so the curve prices in underlying terms while the tokens transferred are shares; takers can unwrap in `preTransferOutCallback`. Rebasing aTokens also work as plain ERC20s (virtual balance ≤ real balance keeps growing) but price drift must be handled by the curve.
  2. *True JIT borrow (8-12 h)*: maker vault + hooks as in (m); plus custom `LendingCapacityBalances[address pool, address oracle, uint32 maxLtvBps]` that sets `ctx.swap.balanceOut = min(aToken balance + availableBorrows/price, cap)` from `IPool.getUserAccountData(maker).availableBorrowsBase` (8-decimals base currency) so quotes reflect borrowing power, not wallet balance — this is exactly what `getLimits()` does in EulerSwap.
* **Aqua fit.** Natural: Aqua never custodies, `pull` is just `transferFrom(maker)`, so "the maker's tokens are in Aave until the block they are needed" is the default, not a hack. This is the strongest "impossible without Aqua-style non-custody" story besides (l).
* **Risks to state in the write-up.** Liquidation risk of the leveraged vault (EulerSwap §2.1), interest cost vs fee income, oracle dependence.
* **Complexity.** 3 h (level 1) / 10-12 h (level 2). **Demo.** Level 2 on a mainnet fork with real Aave v3: Aave `Borrow`/`Supply` events + Aqua `Pulled`/`Pushed` in one tx is a great screenshot. **Wow.** 5/5.

### (o) Agent-operated market making (off-chain agent re-ships strategies on signals)

* **Payoff.** An off-chain agent (rule-based or LLM) watches vol/oracle/inventory and re-ships strategies: widen/narrow the CLMM band, change fee tier, pause during depegs, roll the covered-call strike. Each re-ship = `dock` + `ship` (~120-150k gas, **no ERC20 transfers**), vs. a Uniswap-v3 rebalance (burn + collect + swap + mint, ~500k+ gas and real token movement).
* **Who / pain.** Every "active LP vault" (Arrakis, Gamma, Bunni managers) — and 1inch's own framing that Aqua strategies "can be freely deployed and removed based on current market conditions" (SwapVM whitepaper §6).
* **Implementation.** TS script with `@1inch/aqua-sdk` (`AquaProtocolContract.ship/dock`, `AQUA_CONTRACT_ADDRESSES`, `PushedEvent.fromLog`) + a strategy-params generator (the same `buildProgram` used by the app) + a signal source (Chainlink round, realised vol from fork trades, or an LLM prompt). Aqua-native: yes; SwapVM opcode: none by itself — so pair it with (f)/(e).
* **Complexity.** 4-6 h. **Demo.** Very good live: agent log → dock/ship txs → quotes change → arb fills. **Wow.** 5/5 (hackathon crowd), but judges will look for on-chain substance underneath.

---

## 3. Scoring table (1 = low, 5 = high)

| # | Position | Sophistication | Aqua-necessity | SwapVM usage (custom opcode natural?) | Market pain | Demo wow | Feasibility overnight | Sum |
|---|---|---|---|---|---|---|---|---|
| a | RMM-01 covered-call curve | 5 | 3 | 5 | 3 | 5 | 3 | 24 |
| b | Grid bot (range ladder) | 3 | 4 | 4 | 3 | 3 | 5 | 22 |
| c | TWAMM/DCA with bands | 3 | 3 | 2 (exists) | 3 | 2 | 5 | 18 |
| d | LBP / weighted portfolio | 4 | 4 | 5 | 4 | 4 | 4 | 25 |
| e | Vol/LVR-aware dynamic fee | 4 | 2 | 5 | 5 | 3 | 4 | 23 |
| f | Oracle-anchored self-recentering CLMM | 4 | 4 | 5 | 5 | 4 | 5 | **27** |
| g | Stop-loss / TP / trailing | 2 | 4 | 4 | 4 | 3 | 5 | 22 |
| h | Dutch treasury sale | 3 | 4 | 2 (exists) | 4 | 3 | 5 | 21 |
| i | Peg defense | 3 | 4 | 4 | 4 | 3 | 4 | 22 |
| j | Perp / funding | 4 | 2 | 2 | 3 | 3 | 1 | 15 |
| k | Gated liquidity | 1 | 2 | 1 (exists) | 3 | 1 | 5 | 13 |
| l | Liquidity OS (shared balance, honest quotes) | 4 | **5** | 3 | 4 | 5 | 4 | 25 |
| m | Delta-neutral / basis via lending hooks | 5 | 4 | 4 | 4 | 4 | 2 | 23 |
| n | JIT from lending / productive collateral | 5 | **5** | 4 | 4 | 5 | 3 | **26** |
| o | Agent-operated MM (re-ship loop) | 3 | **5** | 2 | 3 | 5 | 4 | 22 |

"Aqua-necessity" = how much of the value disappears if you replace Aqua with signed `DynamicBalances` orders. "SwapVM usage" = whether a *new opcode* is the natural implementation (judges: "projects that utilize SwapVM will be scored higher", "you may modify SwapVM opcodes").

---

## 4. Recommended top 5 (with the custom opcodes each needs)

### #1 — "Oracle-anchored, LVR-aware, agent-tuned CLMM"  (f + e + o)

*Why:* highest pain (LVR ≈ σ²/8 per year for CPMM, ×20 for ±10 % ranges), lowest implementation risk (80 % of the curve code is copy-paste from `XYCConcentrate.sol`), and it exercises all three prize signals (custom opcodes, Aqua non-custody, visible transfers). Adding the agent re-ship loop makes the Aqua advantage tangible (rebalance = dock+ship, zero transfers).

Opcodes (HEAD API, custom `Opcodes` + router):

```text
0x52 XYCConcentrateOracle  args: [uint32 widthBps, uint32 skewGammaBps, uint16 maxStaleness, uint8 oracleDecimals, address oracle]
   exec: P = chainlink→1e18 (staleness check as OraclePriceAdjuster.sol) ; q = (x·P − y)/(x·P + y) (signed 1e18)
         center = P·(1 − γ·q); sqrtMin = sqrt(center·(1−w)·1e18); sqrtMax = sqrt(center·(1+w)·1e18)
         then exactly XYCConcentrateSwap.exec body with (sqrtMin, sqrtMax)
0x72 SurgeFeeIn            args: [uint24 baseBps, uint24 maxBps, uint32 kappa, uint16 halfLifeSec]   (fees bank; wraps runLoop like FeeFlatIn)
   storage: mapping(orderHash => (uint128 lastPrice1e18, uint64 lastTs, uint64 ewmaVar)) ; written only if !isStaticContext
   fee = clamp(base + kappa·sqrt(ewmaVar), base, max) ; ewma decays with halfLife; variant B: oracle-deviation fee (stateless)
```

Program: `Deadline · SurgeFeeIn · Decay(60) · XYCConcentrateOracle · Salt`. Ship with `computeLiquidityFromAmounts` to size balances. Agent: every N blocks read realised vol → if changed by >20 % → `dock` + `ship` with new `widthBps`. Demo on a Base or mainnet fork with the real ETH/USD Chainlink feed (mock its `latestRoundData` via `vm.mockCall`/`vm.store` to move price). Effort: ~8-10 h contracts+tests, 4-6 h agent+UI.

### #2 — "Aqua × Aave: quote from collateral" (n, level 2, with m's hedging as stretch)

*Why:* the only candidate that is *categorically* impossible on pooled AMMs and that reproduces EulerSwap's "50× depth" pitch inside 1inch's stack. Judges from 1inch know EulerSwap/Fluid; showing Aqua doing it with 1 vault + 2 hooks + 1 opcode is a strong statement.

```text
contract LendingMakerVault is IMakerHooks {        // maker == hook target (default), approves AQUA for both tokens
  preTransferOut : if aToken(tokenOut).balance >= amountOut → POOL.withdraw(tokenOut, amountOut, this) else POOL.borrow(tokenOut, amountOut, 2, 0, this)
  postTransferIn : POOL.supply(tokenIn, amountIn − feeIn, this, 0)  (or repay if debt in tokenIn)
}
0x92 LendingCapacityBalances args: [address pool, address oracle, uint32 maxLtvBps, uint256 capOut]
   exec: (,,availableBorrowsBase,,,hf) = IPool.getUserAccountData(maker); depth = aTokenBal(tokenOut) + availableBorrowsBase·1e10/priceOut(1e18)
         ctx.swap.balanceOut = min(ctx.swap.balanceOut, depth·maxLtvBps/1e4, capOut)   // Aqua virtual balance stays the hard cap
```

Curve: `PeggedSwap` for USDC/USDT (stables → highest JIT multiplier) or `XYCConcentrateOracle` from #1 for ETH/USDC. Taker traits: `isFirstTransferFromTaker = true`, `useTransferFromAndAquaPush = true`. Effort: 10-14 h; mainnet-fork only. Risk: Aave integration details; keep a `PeggedSwap`-only fallback.

### #3 — "Covered calls as a curve" (a)

*Why:* maximal sophistication and novelty (RMM-01 has never shipped as a bytecode opcode); a self-updating time-decaying curve is a perfect showcase of "the curve is a program". Choose it if the team has one person comfortable with fixed-point Gaussian math.

```text
0x55 RMM01Swap args: [uint256 strike(1e18 stable/risky), uint64 sigma(1e18), uint40 maturity, uint256 liquidity, uint256 invariantK]
   exec: tau = (maturity − now)/365d in 1e18 ; s = sigma·sqrt(tau)
         risky in : R1' = (x + dx)/L ; y' = L·K·Φ(Φ⁻¹(1 − R1') − s) + k ; dy = y − y'  (floor; revert if R1' > 1)
         stable in: R2' = (y + dy − k)/(L·K) ; x' = L·(1 − Φ(Φ⁻¹(R2') + s)) ; dx = x − x'
         exact-out: same, inverted ; after maturity (tau=0) degenerate to LimitSwap at K
   lib Gaussian: Φ via A&S 7.1.26 erfc (1.5e-7), Φ⁻¹ via bisection (40 iters) or Acklam
```

Wrap with `FeeFlatIn(30bps)` (fees fund theta), `Deadline(maturity + grace)`, `Decay`. Effort 12-16 h incl. symmetry/monotonicity tests; sell the demo with a chart of pool value vs Black-Scholes price as `vm.warp` advances.

### #4 — "Liquidity OS" (l + b + honest-quote cap) — best *product* framing, can wrap #1

*Why:* it demonstrates the core Aqua thesis (one balance, many strategies) and the `RealBalanceCap` opcode fixes a real, demonstrable failure mode (overcommitted virtual balances → reverting pulls) that any solver integrating Aqua will hit.

```text
0x92 RealBalanceCap args: []      (balances bank; must run BEFORE the curve)
   exec: realOut = min(IERC20(tokenOut).balanceOf(maker), IERC20(tokenOut).allowance(maker, AQUA))
         ctx.swap.balanceOut = min(ctx.swap.balanceOut, realOut)   // optional: same for balanceIn
0x56 GridSwap args: [uint256 p0, uint32 stepBps, uint8 nLevels, uint256 rungSize]   (optional; else N×XYCConcentrate strategies)
```

App: script/UI that ships (i) `XYCConcentrateOracle` band, (ii) 10-rung grid, (iii) `PeggedSwap` USDC/USDT, (iv) `OracleGate` stop-loss — all from one EOA/Safe with one `approve` per token; dashboard shows virtual vs real balances and which strategy each fill hit. Effort 8-12 h.

### #5 — "LBP / treasury diversification without a pool" (d, with h's floor)

*Why:* clear DAO use-case, moderate math, clean custom opcode; distinct from anything in 1inch's catalog (`PROGRAMS.md` has no weighted curve).

```text
0x57 WeightedSwap args: [uint40 t0, uint40 t1, uint64 wStartA, uint64 wEndA]   (1e18 weights, tokenA = lower address)
   exec: wA = lerp(wStartA, wEndA, clamp((now−t0)/(t1−t0))) ; wB = 1e18 − wA ; (wIn, wOut) by direction
         exactIn : amountOut = bOut·(1e18 − pow(bIn/(bIn+amountIn), wIn/wOut))   (PRBMath UD60x18; round down)
         exactOut: amountIn = bIn·(pow(bOut/(bOut−amountOut), wOut/wIn) − 1e18)  (round up)
```

Program: `Deadline(t1) · RequireMinRate(floor) · FeeFlatIn · Decay · WeightedSwap · Salt`. Effort 6-8 h. Demo: warp through the schedule, show the price gliding, treasury Safe never holds the pool.

Not recommended as the headline: (c), (h), (k) (existing instructions only → weak SwapVM score), (j) (bad fit), (g)/(i) (fine as sub-features of #4).

---

## 5. Practical notes for the build / demo

1. **Fork setup.** Use Foundry against a mainnet/Base fork; real Aqua at `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`; deploy your own router `new MyRouter(aqua, WETH, owner, "SwapVM", "1.0.0")` (allowed by the rules). `test/MinimalAquaXYC.t.sol` is the copy-paste starting point for ship + swap in both taker modes. For real Chainlink feeds on a fork, move the price with `vm.mockCall(feed, abi.encodeWithSelector(latestRoundData.selector), abi.encode(...))`.
2. **Visible token transfers** (prize requirement): every fill emits ERC20 `Transfer` (maker → taker via `Aqua.pull`, taker → maker via `push`), `Aqua.Pulled/Pushed`, and `SwapVM.Swapped(orderHash, maker, taker, tokenIn, tokenOut, amountIn, amountOut)`. Re-ship shows only `Docked`/`Shipped` — make that contrast explicit in the demo.
3. **Invariants to test for any new curve opcode** (`test/invariants/CoreInvariants.t.sol`): exactIn/exactOut symmetry, quote == swap, monotonic price, rounding favours maker (`amountIn` ceil / `amountOut` floor), `amountOut ≤ balanceOut`, liveness when one side is depleted. Oracle-driven opcodes must read the oracle identically in `quote` and `swap` (same block ⇒ same round).
4. **Instruction ordering is security-critical** (`docs/PROGRAMS.md`): fees wrap curves; `Decay`/`DynamicBalances`/`TWAPSwap` expect to be executed once; `DutchAuction*`/`PiecewiseLinearScale*` must not be combined with `InvalidateTokenIn/Out` (they mutate the balance the invalidator tracks).
5. **Gas.** A `Simulator` mixin is on the routers for off-chain simulation; keep custom opcodes ≲ 200k gas (a 40-iteration bisection with PRBMath `exp` is ~150-250k, acceptable on a fork/L2 demo, not for mainnet production).
6. **Git history.** The rules explicitly reject single-commit last-day submissions; commit opcode, tests, app, agent as separate steps.

---

## 6. Open questions (UNCERTAIN)

* Which router (`SwapVMRouter` full set vs `AquaSwapVMRouter` 16-opcode subset) is at `0x111111338c5091e8440b67b168bae16a668ac0de`, and whether it was compiled from the old (`_opcodes()` array) or new (bank enum) API. Check bytecode/verified source on Etherscan before relying on it; a self-deployed router sidesteps the question.
* License of Primitive's `solstat` Gaussian library for reuse in (a); a hand-rolled A&S erfc + bisection avoids the issue.
* Balancer's "typical" LBP start/end weights and Bunni's exact surge-fee/am-AMM parameters were not retrievable (docs pages 404/partial); the formulas above do not depend on them.
* Whether ETHOnline judges weight a UI more than a Foundry test suite ("demonstrated through tests scripts or a UI" — either qualifies).

---

## 7. Sources

* Local: `refs/aqua/src/{Aqua.sol,AquaApp.sol,interfaces/IAqua.sol}`, `refs/aqua/README.md` (§Deployments lines 486-497), `refs/swap-vm/src/{SwapVM.sol,libs/VM.sol,libs/OpcodeList.sol,libs/MakerTraits.sol,libs/TakerTraits.sol,opcodes/Opcodes.sol,opcodes/AquaOpcodes.sol,instructions/*.sol,strategies/Strategies.sol}`, `refs/swap-vm/docs/PROGRAMS.md`, `refs/swap-vm/docs/whitepaper-swap-vm-1.0.pdf` (§5.5 canonical ordering, §6 Aqua), `refs/swap-vm/test/{MinimalAquaXYC.t.sol,RunLoop.t.sol,mocks/BestRouteSelector.sol}`, `refs/swap-vm-template/{README.md,contracts/AquaAMM.sol,contracts/MockTaker.sol,package.json}`, `refs/sdks/typescript/aqua/README.md`.
* Prize text: https://ethglobal.com/events/ethonline2026/prizes (1inch "Build an Aqua app" $5,000 + continuity $2,000).
* 1inch Aqua product page: https://1inch.com/aqua/ ("Developer access now live, UI launching in 2026").
* Angeris, Evans, Chitra, *Replicating Market Makers*, arXiv:2103.14769 (2021) — §3.2-3.3 covered-call trading functions; appendix "Hedging a covered call".
* Milionis, Moallemi, Roughgarden, Zhang, *Automated Market Making and Loss-Versus-Rebalancing*, arXiv:2208.06046 — eq. (8) `ℓ = σ²P²x*'(P)/2`, eq. (19) `ℓ/V = σ²/8`, Example 4 (range orders), 99.991 % beta-variance finding.
* Adams, Moallemi, Reynolds, Robinson, *am-AMM: An Auction-Managed Automated Market Maker*, arXiv:2403.03367 — Harberger lease (deposit ≥ R·K, K-block delay, fee cap, withdrawal fee < 0.13 bp at 1 % cap), Theorem 1.
* EulerSwap white paper (github.com/euler-xyz/euler-swap, docs/whitepaper) — JIT borrowing example (LTV 0.95, $1M → $20M/$19M), eqs. (2)-(3) piecewise curve with `cx, cy`, §2.1 liquidation risk, §3 risk-neutral LP.
* Paradigm, *TWAMM* (2021), https://www.paradigm.xyz/2021/07/twamm — `X' = √(X0² + 2·sx·sy·t)`.
* Balancer weighted math docs, https://docs.balancer.fi/concepts/explore-available-balancer-pools/weighted-pool/weighted-math.html — invariant, spot price, `outGivenIn`.
* Bunni v2 docs (LDF, am-AMM), https://docs.bunni.xyz/docs/v2/concepts/ldf and /amamm (partial).
