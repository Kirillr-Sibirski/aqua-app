# UX Benchmarks & Frontend Stack for the Aqua/SwapVM Hackathon App

Compiled 2026-09-05 for ETHGlobal ETHOnline 2026, 1inch "Build an Aqua app" track.
Audience: engineers/agents building the UI who have not read the sources.

Provenance legend used throughout:
- **[VERIFIED]** fetched or executed this session (URL / command / file:line given).
- **[KNOWLEDGE]** from model knowledge of the product as of ~2025/2026, not re-verified this session (web-search budget was exhausted; only direct fetches worked). Treat visual details as directional, not exact.
- **UNCERTAIN** explicitly flagged where confidence is low.

---

## 0. TL;DR decisions (read this if nothing else)

1. **Judging criteria are explicit** [VERIFIED, ethglobal.com/events/ethonline2026/info/details]: *Technicality, Originality, Practicality, Usability (UI/UX/DX), WOW Factor*. Usability is 1 of 5 axes; UI is not decoration, it is a scored criterion.
2. **Demo video rules** [VERIFIED, same page]: 2–4 minutes (outside that range = auto-rejected), ≥720p, **no AI voiceover / TTS, no speed-up editing, no phone recordings**, keep intro under 20 s, "show your project in action". Submission deadline **Sun Sep 13 2026, 12:00 pm EDT**. Live finalist round = 4 min demo + 3 min Q&A.
3. **Track rules** [VERIFIED, ethglobal.com/events/ethonline2026/prizes/1inch]: $5k main ($2.5k/$1.5k/$1k) + $2k continuity. Must use official Aqua/SwapVM contracts (modified SwapVM redeploy OK), show **on-chain token transfers during the demo (local fork OK)**, proper commit history ("no single-commit entries on the final day"). SwapVM usage scored higher.
4. **Build the UI as an LP "position terminal", not a swap widget**: Positions list → Position detail → Builder (wizard) → Simulate → Review/Confirm (approve → ship) → Activity. Aqua's own product page says "UI launching in 2026; developer access currently live" [VERIFIED, 1inch.com/aqua] — i.e., there is no official Aqua LP UI yet; ours can look like the one 1inch would ship.
5. **Stack (all versions verified via `npm view` on 2026-09-05)**: Vite 8.2.2 + React 19.2.8 + TypeScript 5.9.3 · wagmi **2.19.5** + viem 2.56.3 + @tanstack/react-query 5.102.8 + RainbowKit 2.2.11 (RainbowKit/ConnectKit still peer-depend on wagmi 2.x, wagmi 3.7.7 renamed hooks) · Tailwind 4.3.3 + shadcn 4.21.0 scaffold on Base UI (or Radix) heavily re-themed · lightweight-charts 5.2.1 (price/time) + hand-rolled SVG with d3-scale 4.0.2 / d3-shape 3.2.0 (payoff & liquidity curves) · motion 13.2.0 · sonner 2.0.8 · @number-flow/react 0.6.2 · @1inch/aqua-sdk 0.3.1 · @1inch/swap-vm-sdk 0.4.1.
6. **Visual direction**: dark-first, near-black neutral surfaces, ONE accent (1inch-style blue ≈ `#2F8AF5`, UNCERTAIN exact), Geist Sans + Geist Mono with `font-variant-numeric: tabular-nums` for every number, 4/8 px spacing grid, 1 px hairline borders instead of shadows, no gradients on surfaces, no emoji, no purple.

---

## 1. Ground truth about the target protocol that shapes the UX

Everything in this section is [VERIFIED] from the local clones.

### 1.1 Aqua registry API (what the UI actually calls)

Registry address (same on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche, Gnosis, zkSync Era, Linea): `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` (SDK README table, chain IDs 1/56/137/42161/43114/100/8453/10/324/59144). SwapVM router: `0x111111338c5091E8440b67B168bAe16a668AC0De` (swap-vm README, 15 chains listed).

`refs/aqua/src/Aqua.sol` (function signatures at lines 26–72):
```solidity
function rawBalances(address maker, address app, bytes32 strategyHash, address token) external view returns (uint248 balance, uint8 tokensCount);   // :26
function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) external view returns (uint256 balance0, uint256 balance1); // :30
function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts) external returns (bytes32 strategyHash); // :40
function dock(address app, bytes32 strategyHash, address[] calldata tokens) external; // :54
function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external; // :63  (app-only, during swaps)
function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount) external; // :72 (during swaps)
```
Events (`refs/aqua/src/interfaces/IAqua.sol:45-69`) — these are the entire data source for a Positions list and an Activity feed:
```solidity
event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy);   // :45
event Docked(address maker, address app, bytes32 strategyHash);                    // :51
event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount); // :60
event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount); // :69
```
Errors worth surfacing verbatim in the UI (IAqua.sol:14-38): `MaxNumberOfTokensExceeded`, `StrategiesMustBeImmutable`, `DockingShouldCloseAllTokens`, `PushToNonActiveStrategyPrevented`, `SafeBalancesForTokenNotInActiveStrategy`.

### 1.2 UX-relevant protocol facts (aqua README)
- **No custody**: "Aqua doesn't hold tokens – it maintains allowance records. Actual tokens remain in maker wallets until pulled during trades." → the UI must say "tokens stay in your wallet" on the Review step, and must show **wallet balance vs shipped (virtual) balance**, because a maker can over-allocate.
- **One approval, many strategies**: `token.approve(address(aqua), type(uint256).max)` once per token → an Allowance panel is a first-class object (show approved-to-Aqua status per token; offer exact vs unlimited).
- **Strategies are immutable**: to edit, `dock()` then `ship()` a new one. → "Edit" in the UI = "Re-ship" (2 txs) and the copy must say so. Docking is accounting-only (no token transfers).
- **strategyHash = keccak256(abi.encode(strategy))**; SDK helper: `AquaProtocolContract.calculateStrategyHash(strategy)` (sdk README). Show the hash truncated with copy button; it is the position's ID.
- **Pull/Push are swap-time only**. Every `Pulled`/`Pushed` log = a fill against the LP → Activity feed rows, and net token deltas = realized inventory change for PnL.

### 1.3 SwapVM (what a "sophisticated position" can be made of)
`refs/swap-vm/docs/PROGRAMS.md` catalog (sections at :50/:98/:174/:187): Limit-order programs (1D, static balances), AMM programs (2D, dynamic balances: `XYCSwap`, `XYCConcentrateSwap`, `PeggedSwap`, add-ons `FeeFlatIn/Out`, `FeeProtocol`, `Decay`, `TWAPSwap`, control flow `Jump*`, `Deadline`, `Salt`), Aqua-backed programs (`useAquaInsteadOfSignature = true`), conditional-flow programs (`OnlyTakerTokenBalanceNonZero`, `Extruction` best-route selector).

Range encoding that the range-selector must produce (`refs/swap-vm/src/instructions/XYCConcentrate.sol`):
```solidity
/// @dev Encoding: [uint256 sqrtPriceMin, uint256 sqrtPriceMax]           // :18
uint256 constant ONE = 1e18;                                                // :34
function build(uint256 sqrtPriceMin, uint256 sqrtPriceMax) internal pure returns (bytes memory); // :38
require(0 < sqrtPriceMin && sqrtPriceMin < sqrtPriceMax, ConcentrateInvalidPriceBounds(...));     // :43
error ConcentrateSpotOutOfRange(uint256 sqrtPriceMin, uint256 sqrtPriceSpot, uint256 sqrtPriceMax); // :28
```
So `sqrtPrice*` are **1e18-scaled fixed-point square roots of price** (not Uniswap's Q64.96). Direction is `tokenIn < tokenOut` (:57), so "price" is defined relative to sorted token order — the UI must render an "invert price" toggle exactly like Uniswap's.
Other builder params: `FeeFlat.build(uint24 feeBps)` (FeeFlat.sol:37/:97), `Decay.build(uint16 period)` (Decay.sol:38), `PeggedSwap.build(x0, y0, linearWidth, rateA, rateB)` (PeggedSwap.sol:49; comment :45-48 shows decimals normalisation `rateA = 1e12` for USDC/DAI).

PROGRAMS.md explicitly warns "Instruction order is security-critical" — a good UI shows the compiled instruction list in order on the Review step (this doubles as a "wow" for judges: they see the bytecode program they are shipping).

---

## 2. Benchmarks: what best-in-class DeFi products do

All entries [KNOWLEDGE] unless marked. Focus on transferable patterns.

### 2.1 Uniswap (app.uniswap.org, v4 era, 2025–26 redesign)
- **Create-position wizard** at `/positions/create`: left rail stepper with numbered steps ("1 Select token pair and fees" → "2 Set price range" → deposit amounts on the same page; older v3 flow had 3 explicit steps). Completed steps collapse to a one-line summary with an "Edit" link; the right column holds the live form. This is the pattern to copy: *summary rail + single active panel*.
- **Fee tier picker**: cards per tier (0.01% / 0.05% / 0.30% / 1%), each showing "x% select" share and TVL, and a "Highest TVL" pill on the recommended one; v4 adds "Add a hook" (advanced, address input) and dynamic fees. Uniswap v4 supports "any fee percentage (e.g., 4.9 bips, 10 bips)" and dynamic fees via `updateDynamicLPFee` or `beforeSwap` [VERIFIED, developers.uniswap.org v4 dynamic-fees concept page]. v3 fixed tiers were 0.05/0.30/1.0% [VERIFIED same page].
- **Range selector**: segmented control "Full range | Custom range"; a liquidity-depth histogram behind a draggable band with handles; current price as a vertical dashed line; min/max price inputs with −/+ steppers; quick-select chips (e.g., ±1%, ±5%, ±10%, ±20% — exact set UNCERTAIN); "invert" toggle to show price as A/B or B/A. Out-of-range → amber warning "Your position will not earn fees or be used in trades until the market price moves into your range."
- **Deposit step**: two amount inputs auto-linked by the range math (single-sided when out of range; the other input is disabled with an explanation), balance + "Max", USD equivalents.
- **Review modal**: token amounts + USD, min/max/current price, fee tier, then a button that morphs through states: "Approve USDC" (Permit2 signature) → "Create" → "Confirm in wallet" → "Pending" → success with "View on Explorer".
- **Position card**: pair avatars, fee tier pill, version pill (v2/v3/v4), hook badge, status dot ("In range" green / "Out of range" amber / "Closed" grey), Min–Max, current price, value, unclaimed fees, actions (Add / Remove / Collect).
- **Empty state**: illustration + "Your active V3 liquidity positions will appear here." + primary CTA "+ New position".

### 2.2 Aave v3 app (app.aave.com)
- Dashboard = two "yours" panels (Your supplies / Your borrows, with Net APY and Health Factor gauge) above two market tables (Assets to supply / Assets to borrow). Health factor colour-coded (green > 3, amber ~1.5–3, red < 1.5 — thresholds UNCERTAIN) with a "Risk details" modal containing a slider.
- **Action modals**: amount input with balance/Max, an "Overview" block showing *before → after* for the metrics the action changes (Health factor 2.3 → 1.9 with an arrow), gas estimate, then a **two-step button** "Approve" → "Supply" with checkmarks as each completes, then "All done!" with "Review tx details" (explorer) and "Add aToken to wallet". This *before→after delta* block is the single most reusable pattern for a position simulator.
- Aave v4 app (2026) — UNCERTAIN whether shipped; do not cite.

### 2.3 Morpho (app.morpho.org)
- Cleanest IA in lending: Earn (vaults) / Borrow (markets); dense but airy tables (APY with a tooltip breaking down native + rewards, TVL, curator with avatar, collateral icons stacked). Vault detail: header KPIs, TVL/APY charts, "Curator" trust panel, allocation table, right-hand sticky Deposit/Withdraw panel that stays in view while scrolling. Light-first with dark mode; Inter-like sans; blue accent; minimal borders; rounded-xl cards.
- Pattern to copy: **sticky action panel on the right of a detail page** and **KPI header row**.

### 2.4 Hyperliquid (app.hyperliquid.xyz)
- Pure density: dark teal-black background with mint-green accent (≈ `#50D2C1` / `#97FCE4`, UNCERTAIN), tabular monospace-ish numbers, 12–13 px body, order book + TradingView chart + positions table with no decoration. Everything updates live without layout shift. Loading uses skeletons that match final row height.
- Pattern to copy: **number-first tables, no chrome, fixed-height rows, live values without jitter** (use `tabular-nums` and fixed-width columns).

### 2.5 Jupiter (jup.ag)
- Dark navy with green accent; swap card with settings drawer; token selector with search, verified badges, and per-token stats; "Ultra" mode hides complexity by default with "Manual" mode for pros. Toasts are compact, bottom-right, with explorer link and copy-hash.
- Pattern: **Simple/Pro mode toggle** (also Pendle) — let the demo run in "Pro" to show depth.

### 2.6 Pendle (app.pendle.finance)
- Markets table with Maturity, Underlying APY, Implied APY, Long-yield APY, Fixed APY and liquidity; PT/YT detail with a **calculator** ("If you hold to maturity you receive X"). Uses "Simple" vs "Pro" mode. Charts show APY over time with time-range chips (1D/1W/1M/…).
- Pattern: **outcome calculator with explicit assumptions** ("Assuming price stays at…").

### 2.7 Ethena (app.ethena.fi)
- Minimal: one number (sUSDe APY) huge, one CTA; light/dark, blue accent; trust strip (TVL, backing, audits). Pattern: **hero KPI + trust strip** for a landing/overview.

### 2.8 Aerodrome (aerodrome.finance)
- Dark blue; Liquidity table with pool *type* pills (Basic Stable / Basic Volatile / Concentrated with tick-spacing shown), TVL, fees, APR; Deposit flow for CL pools offers preset ranges plus "Full range" and a "Reset to current price" link; explicit "Range: in/out" status. Pattern: **pool-type pill + tick/width shown as data, not hidden**.

### 2.9 Definitive.fi
- Institutional look (dark, grey-blue, restrained), execution-focused (TWAP, limit, smart routing, smart accounts), positions tracked with cost basis and realized/unrealized PnL. Pattern: **PnL with cost basis and fees separated**; **execution progress** (filled / remaining / average price).

### 2.10 Arrakis (arrakis.finance)
- ALM vaults; earthy "Dune" brand (sand/brown accents on light), vault detail with TVL, APR, fees earned, price range currently managed, rebalance history. Pattern: **"managed range" visualised as a band on a price chart with rebalance markers**.

### 2.11 Bunni v2 (bunni.xyz)
- Its defining UX was choosing a **Liquidity Density Function** shape from presets (Uniform, Geometric, Double Geometric, Carpeted variants) with a live plot of the resulting liquidity distribution across price, plus toggles for surge fees / am-AMM / rehypothecation. Caution: Bunni suffered an exploit in Sept 2025 and announced a wind-down (details UNCERTAIN) — reference only the UX idea: **shape presets with a live distribution plot**. This maps directly to SwapVM programs (XYC vs Concentrated vs Pegged vs Decay).

### 2.12 1inch (1inch.com, app) — the sponsor's visual language
- [VERIFIED 1inch.com] Navigation: **Swap, Trade (Limit/Market), Terminal, Aqua, Portfolio**; swap widget labels are **"Pay on" / "Receive"**, CTA "Connect wallet"; messaging around MEV protection and zero gas fees; landing is light-themed with a whale mascot on the Aqua page; Aqua headline **"Shared liquidity to unlock DeFi capital"**, CTAs "Build now", "Explore protocol", "Use SDK", "Read whitepaper".
- [KNOWLEDGE, UNCERTAIN exact hex — the app is a JS SPA and its CSS could not be fetched; brand page returned 404] The dApp is dark by default: near-black page (≈ `#06070A`), card surfaces ≈ `#131823`, elevated ≈ `#1B2130`, primary/action blue ≈ `#2F8AF5`, secondary text ≈ `#6C86AD`, positive ≈ `#21C187`, negative ≈ `#F04832`; rounded 16–24 px cards; large pill-shaped primary button; token avatars 24–40 px with chain badge; numbers with 2–6 decimals and a `≈ $x` grey line. Font: a neutral grotesque (historically Roboto; newer surfaces look Inter-like) — UNCERTAIN. Verify with DevTools on app.1inch.io before committing to hex values; use them as tokens (`--accent`, `--surface-1`) so swapping is trivial.
- Aqua's own imagery is "whale/ocean"; the verbs are **ship / dock / pull / push** — using these verbs in the UI (with a one-line gloss) reads as native to the sponsor.

### 2.13 Rabby / Zerion (wallet & portfolio UX)
- Rabby: pre-sign **simulation** showing balance changes and approvals before you sign, risk warnings (contract age, phishing lists), auto chain switching, gas account. Zerion: portfolio grouped by chain with per-position PnL, categorised **History** (Send/Receive/Trade/Approve) with icons and USD deltas.
- Pattern: **"What will happen" preview before signing** (for us: "Aqua will record 1,000 USDC + 0.5 WETH as available to strategy 0xab…; nothing leaves your wallet") and a **categorised activity feed**.

### 2.14 Dune / DefiLlama (data density)
- DefiLlama: dense sortable tables, compact number notation (`$1.23b`, `$45.6m`), inline 7-day sparklines, category pills, light/dark toggle, chart time-range chips, "TVL / Fees / Revenue" tab switchers. Dune: dashboard grid of cards with big "counter" widgets and titled charts.
- Pattern: **compact notation + sparkline per row + range chips**.

---

## 3. Information architecture for our LP/position product

Routes (SPA; keep URLs stable so the demo can deep-link):

```
/                      Overview: KPI strip (Total shipped value, Fees earned, Active strategies, 24h volume through your liquidity) + Positions table + "New position"
/positions             Positions table (filters: chain, app, status, pair)      ← list
/positions/:hash       Position detail                                          ← detail
/new                   Builder wizard (steps below)                             ← builder
/new/review            Simulate + Review (same wizard, last step)               ← simulate/confirm
/activity              Activity feed (Shipped / Docked / Pulled / Pushed)       ← activity
/allowances            Token approvals to Aqua (secondary; also inline in wizard)
```

**Positions table columns** (from Uniswap/Aerodrome/Morpho): Pair (stacked avatars + symbols) · Strategy type pill (Concentrated / xy=k / Pegged / Limit / Custom) · Chain badge · Range or Rate (min–max, with in/out-of-range dot) · Shipped (virtual balances, both tokens) · Backing (wallet balance ÷ shipped, %; amber < 100%) · Fees earned / est. APR · Status (Active / Docked) · Row actions (View, Dock, Re-ship).

**Position detail** (Morpho layout): header (pair, type pill, hash with copy, explorer link, status) → KPI row (Value, Fees, Volume routed, Age) → main column: price chart with range band + fills as markers; liquidity-shape plot; parameters table (fee bps, decay period, sqrtPriceMin/Max both raw and human); compiled program (instruction list in order) → right sticky panel: Dock, Re-ship (dock+ship), Top-up allowance. Below: Activity for this strategy.

**Builder wizard** (Uniswap stepper, Aave before→after):
1. *Pair & app* — token pair selector (search, balances, chain), app = SwapVM (default) or custom AquaApp address.
2. *Strategy shape* — preset cards (see §4) with mini liquidity-shape thumbnails.
3. *Parameters* — range selector on price chart, fee bps, optional decay/TWAP/gates; instruction list updates live on the right.
4. *Liquidity* — amounts per token (virtual), wallet balance and allowance state inline; warn if amount > wallet balance ("You are allocating more than you hold; fills beyond your balance will fail").
5. *Simulate & Review* — payoff curve, projected APR (with assumptions), risk badges, the exact `ship(app, strategy, tokens, amounts)` calldata (collapsible), then the stepper: Approve token A → Approve token B → Ship.

Left rail = completed steps as one-liners with "Edit". Wizard state in URL query or zustand, survives refresh.

---

## 4. Position-builder UX patterns

1. **Presets first, parameters second.** Cards: *Concentrated (XYCConcentrateSwap)* "Earn more fees in a range", *Classic xy=k (XYCSwap)* "Always in range", *Stable/Pegged (PeggedSwap)* "For correlated assets", *Limit / Dutch auction (1D)* "Sell at my price", *Custom program* (advanced). Each card shows a 64×32 thumbnail of the liquidity shape. This is the Bunni LDF idea mapped onto SwapVM's catalog.
2. **Range slider on a price chart**, not on a bare track: lightweight-charts price history (or synthetic fork prices) as an Area series; a series-primitive draws the shaded band + two draggable handles; current price line labelled; min/max inputs with −/+ steppers snapped to a sensible tick (e.g., 0.1%); quick chips `±2% ±5% ±10% ±25% Full`; "Invert" toggle (A per B ↔ B per A). Under the chart show the derived `sqrtPriceMin/Max` in 1e18 units in a muted mono line — judges love seeing the raw encoding.
3. **Live payoff/value curve** (see §6 formulas): LP value vs price with HODL line for comparison; shade the in-range region; annotate "all token0 below X, all token1 above Y". Update on every param change with a 150 ms spring (motion) and animated numbers (number-flow).
4. **Projected APR with assumptions stated**: `fees = volume_share × fee_bps`, where volume is either historical (fork) or a user-editable "assumed daily volume" input; show "Assumes price stays in range" in small text. Never show an APR without its assumption line.
5. **Risk badges** (pill + tooltip): "Out of range at ship" (error, blocks submit — matches `ConcentrateSpotOutOfRange`), "Narrow range (<5%)", "Under-backed allowance", "Custom program (unaudited)", "No deadline set", "Unlimited approval". Colours: red / amber / grey; never more than 3 visible.
6. **Amount inputs**: token avatar, symbol, balance, `Max`, USD line, decimals-aware formatting; when one side is implied by the curve, the other input shows a computed value with a lock icon and "derived from range".
7. **Compiled program panel**: ordered list `1 DynamicBalances(…)  2 FeeFlatIn(30 bps)  3 XYCConcentrateSwap(min,max)`; each row links to the instruction's docs; a "Copy bytecode" button. This makes SwapVM usage *visible* (scored higher).

---

## 5. Transaction UX

1. **Stepper with real states** (Aave/Uniswap): `Approve WETH → Approve USDC → Ship`. Each step: idle / needs-signature ("Confirm in wallet") / pending (spinner + "~12 s" + hash link) / done (check) / failed (error + Retry). Skip approval steps automatically when allowance ≥ amount (read `allowance(owner, aqua)` on load and after each receipt). Offer "Approve exact" vs "Unlimited" as a small toggle (unlimited default is fine for demo; label it).
2. **Wallet-connect UX**: RainbowKit modal; show chain pill; if wrong chain, primary button becomes "Switch to Base" (never a disabled button with no explanation).
3. **Pending & receipts**: use `useWaitForTransactionReceipt`; show a Sonner toast bottom-right: title ("Shipped 1,000 USDC + 0.5 WETH"), hash truncated with copy, "View on BaseScan ↗" (`chain.blockExplorers.default.url + '/tx/' + hash`), and the toast persists until receipt. Parse `Shipped` log from the receipt to get `strategyHash` and navigate to `/positions/:hash` automatically.
4. **Errors**: map viem `ContractFunctionRevertedError` → decoded custom error name → plain-English copy + "Show raw" disclosure. Distinguish user rejection (`UserRejectedRequestError`, quiet inline message) from revert (red callout) from RPC/network (retry button). Never show a raw hex blob as the primary message.
5. **Simulation before signing**: call `simulateContract` for `ship` (and for a sample SwapVM `swap` in the demo) and show "Simulation OK · gas 143,210" or the decoded revert *before* the wallet opens (Rabby-style).
6. **Local-fork affordances for the demo**: a "Demo controls" drawer (only when chainId is Anvil 31337 or an env flag): buttons "Fund wallet", "Execute taker swap 0.1 WETH → USDC", "Mine block"; every one of these performs *real on-chain token transfers* the rules require, and the Activity feed updates from logs within a second.
7. **Idempotence and refresh**: the wizard remembers the in-flight tx hash in localStorage so a refresh mid-pending resumes the stepper.

---

## 6. Data viz: liquidity curves, payoff diagrams, PnL

**Charts to build** (and the library for each):
| Chart | Purpose | Lib |
|---|---|---|
| Price/time with range band + fill markers | Builder step 3, Position detail | lightweight-charts 5.2.1 (Area/Line series + `ISeriesApi.attachPrimitive()` series primitive for the band/handles; plugin system supports custom series, series primitives, pane primitives — [VERIFIED docs/plugins/intro]) |
| Liquidity shape L(P) | Preset thumbnails, builder | inline SVG with d3-scale/d3-shape (`area()` + `curveMonotoneX`), 40–200 pts |
| Payoff: position value vs price, HODL overlay | Simulate & detail | same SVG approach (needs two lines + shaded region + annotations) |
| PnL over time (fees, inventory delta) | Detail | lightweight-charts Baseline series (green above 0 / red below) or Recharts 3.10.1 `AreaChart` + `ReferenceLine` |
| Sparkline per row | Positions table | 80×24 inline SVG path, no axes |

**Formulas (concentrated liquidity, v3-style — valid for XYCConcentrateSwap up to its own rounding/fee reinvest details, UNCERTAIN exact equivalence):** with liquidity L and range [Pa, Pb], value in token1 units at price P:
- P ≤ Pa (all token0): `V = L·(1/√Pa − 1/√Pb)·P`
- Pa < P < Pb: `V = L·(2√P − √Pa − P/√Pb)`
- P ≥ Pb (all token1): `V = L·(√Pb − √Pa)`
HODL line: `V_hodl = x0·P + y0`. Impermanent loss vs price ratio k for full range: `IL(k) = 2√k/(1+k) − 1`.
Liquidity from balances (as the contract does, XYCConcentrate.sol `computeLiquidity`, line ~58): derive L from (balance0, balance1, √Pmin, √Pmax) — port the Solidity to TS with `bigint` and 1e18 scaling so the UI's numbers match on-chain numbers exactly (judges may compare).

**Viz conventions** (dataviz skill / DefiLlama): one accent colour for "your position", grey for baselines (HODL), dashed for current price, semi-transparent fill 12–18% alpha for range band, axis labels in mono tabular, ≤ 5 tick labels per axis, tooltip with crosshair, no 3D, no gradients on data marks, dark-mode-safe colours (avoid pure #fff lines; use `rgba(255,255,255,.72)`).

---

## 7. Trust signals

Place in the footer and/or an "About" popover, and in the Review step:
- Contract addresses with explorer links (Aqua `0x1111113c…` verified; SwapVM `0x11111133…`), and the note "Official 1inch deployments" — this maps to qualification rule (1).
- Links: Aqua repo, SwapVM repo, Aqua SDK, both whitepapers (URLs listed under §11 resources).
- Immutability + non-custody explainer with one sentence each (from the README): "Strategies are immutable once shipped" / "Tokens stay in your wallet".
- "Unaudited hackathon build" banner for custom instructions (honesty is a trust signal for judges).
- Network status chip (block number ticking, RPC latency) — proves it's live.
- Real numbers only: all TVL/APR shown must come from the fork; if unavailable, show "—" not a fake value.

---

## 8. Visual design conventions in top DeFi apps (2026)

- **Theme**: dark-first (Uniswap/Hyperliquid/Jupiter/Aerodrome/1inch) with a real light mode where cheap. Backgrounds are near-black *neutral* (not navy-purple): e.g., page `#0B0D10`, surface `#131619`, surface-2 `#1A1E23`, hairline `rgba(255,255,255,.08)`. Text: primary `#F2F4F7`, secondary `#9AA4B2`, tertiary `#6B7280`.
- **Accent**: exactly one brand accent used for primary buttons, active states, "your position" in charts. Recommended 1inch-adjacent blue `#2F8AF5` (UNCERTAIN as exact 1inch value) → hover `#4B9BF8`, pressed `#1F78E0`. Semantic: positive `#22C55E`-ish, negative `#EF4444`-ish, warning `#F59E0B`-ish, all slightly desaturated on dark.
- **Typography**: Geist Sans (UI) + Geist Mono (numbers, hashes, bytecode) — OFL-licensed, weights Thin→Ultra Black, available via npm `geist` or `@fontsource-variable/geist` [VERIFIED vercel.com/font]. Inter (5.3.0 fontsource) is the safe alternative; Space Grotesk only for display headings if you want personality. Scale: 12 / 13 / 14 (body) / 16 / 20 / 24 / 32 px; line-height 1.4; `font-variant-numeric: tabular-nums slashed-zero` globally on numeric cells.
- **Surfaces**: flat, 1 px hairline borders, radius 10–14 px for cards, 8 px for inputs, full-pill only for chips and the primary CTA if you follow 1inch. Glassmorphism: at most one blurred overlay (modal backdrop); no frosted cards.
- **Density**: table rows 44–48 px, 12–16 px cell padding, page gutters 24 px, max content width 1200–1280 px, 2-column detail layout (2fr / 1fr sticky).
- **Motion**: 120–200 ms ease-out for state changes; spring for numbers and range handle; `AnimatePresence` for wizard step transitions (x-slide 8 px + fade); respect `prefers-reduced-motion`.
- **Icons**: one set, one stroke width (Lucide 1.5 px), 16/20 px; token/chain logos from a token list; never emoji as icons.
- **Focus & a11y**: visible 2 px focus ring in accent at 60% alpha on every interactive element; sliders keyboard-operable (arrow keys ±1 tick, shift ±10); labels on inputs; colour never the only status signal (dot + text).

---

## 9. "Vibe-coded UI" tells to AVOID (explicit checklist)

1. Default shadcn/Tailwind look unchanged: zinc-950 bg, `rounded-lg` everywhere, default ring colour, default Inter weight, "Card / CardHeader / CardTitle" rhythm with the same 24 px padding on every box.
2. Purple/indigo/violet accents and blue→purple→pink gradients (hero text gradients especially); "mesh gradient" backgrounds; glowing orbs.
3. Emoji as icons or bullets; sparkle ✨ / rocket 🚀 in copy.
4. Marketing-speak copy ("Unlock the power of…", "Seamlessly…", "Revolutionary"); placeholder copy; a hero section on a tool.
5. Fake data that looks fake: round numbers ($10,000.00), repeated values in every row, APRs like 420.69%, "0x1234…5678" addresses, timestamps all "2 min ago".
6. Missing states: no empty state, no skeletons, no error state, no wrong-network state, no disconnected state; buttons that are just `disabled` without explanation.
7. Inconsistent spacing/radius/typography between pages; centred-everything layouts; giant 48 px headings on an app screen; cards inside cards inside cards.
8. Numbers in proportional font that jitter as they update; 18-decimal raw values; missing thousands separators; USD without token amount or vice versa.
9. Toasts that say "Success!" with no hash/link; alerts via `window.alert`; console errors visible; hydration warnings.
10. No keyboard focus states; non-semantic divs for buttons; no `aria-label` on icon buttons; sliders not operable by keyboard.
11. Everything animated (bouncing cards, parallax) or nothing animated; page-load spinners instead of skeletons.
12. Charts with default library styling (Recharts default blue `#8884d8`/green `#82ca9d`, default Cartesian grid, legend at the bottom in default font).
13. Dark mode as a filter: pure black `#000` with pure white text, neon borders, box-shadows on dark.
14. Wallet connect button that says "Connect Wallet" in Title Case with a wallet emoji; addresses not truncated with middle ellipsis; no ENS/avatar.
15. Stock illustrations / lottie animations from template packs; a "Built with ❤️" footer.

Positive tells of a shipped product: real explorer links, ENS resolution, chain badges on avatars, decoded custom errors, copy buttons on hashes, tabular numbers, consistent 4/8 px grid, a changelog/version tag in the footer, keyboard shortcuts (`n` = new position, `/` = search).

---

## 10. What makes a 3-minute (actually 2–4 min) demo compelling to judges

Rules [VERIFIED]: 2–4 min, ≥720p, human voice, no speed-ups, no phone recording, intro < 20 s, "show your project in action". Criteria: Technicality, Originality, Practicality, Usability, WOW.

Structure that maps to the criteria (target 3:00):
- **0:00–0:15 hook** (Originality): one sentence + the position on screen already. "This is a self-custodial concentrated-liquidity position on 1inch Aqua, compiled to a SwapVM program — nothing leaves the wallet."
- **0:15–0:45 problem → idea** (Practicality): fragmented LP capital; Aqua shared liquidity; what's new in our program/opcode (if modified SwapVM: show the opcode diff for 10 s).
- **0:45–2:15 live flow** (Usability + Technicality): builder → range on chart → payoff curve reacts → review shows compiled instructions and calldata → approve → ship (wallet pops, tx pending, explorer link) → taker swap executes on the fork (real ERC-20 transfers; show the balance change + `Pulled`/`Pushed` rows appear) → position detail shows fees/PnL → dock.
- **2:15–2:45 under the hood** (Technicality): 15 s of the Foundry test output / invariant test, 15 s of the modified opcode.
- **2:45–3:00 close**: what's next + repo link on screen.

Production notes: record at 1440p/2× DPR in a 1280×800 window so text is legible when compressed; hide bookmarks bar; dark theme; cursor highlighting; pre-seed the fork so no waiting; put chain + block number on screen; use `@playwright/test` 1.63.0 `recordVideo` for a deterministic take if narration is added afterwards (allowed: the restriction is on AI voice/TTS, not on screen recorders). Live finalist demo is 4 min; rehearse the same script.

Judges skim: first 20 s and the "money shot" (real tx + balances moving). Make the Activity feed row appear with a subtle highlight animation exactly when the swap lands.

---

## 11. Proposed component inventory

**App shell**: `AppShell` (topbar: logo, nav Overview/Positions/New/Activity, chain pill, ConnectButton, theme toggle), `Page`, `PageHeader` (title, subtitle, actions), `Footer` (addresses, links, version, block number).

**Primitives** (shadcn scaffold, re-themed): Button (primary/secondary/ghost/danger; loading state), IconButton, Input, NumberInput (bigint-safe, decimals-aware), Select/Combobox, SegmentedControl, Tabs, Card, Sheet/Drawer (vaul 1.1.2 for mobile), Dialog, Tooltip, Popover, Badge/Pill, Skeleton, Table (TanStack 9.2.4), Toast (sonner), Kbd, CopyButton, ExplorerLink, Address (truncate + ENS + avatar), TokenAvatar (+ chain badge), TokenAmount (amount + symbol + USD), Percent, Delta (+/− coloured), StatTile/KPI, EmptyState, ErrorState, Callout (info/warn/error).

**Domain**: `PositionsTable`, `PositionRow`, `PositionStatusDot`, `StrategyTypePill`, `RangeStatus`, `PositionHeader`, `PositionParams`, `ProgramList` (instruction rows), `CalldataDisclosure`, `AllowanceCard`, `BackingMeter` (wallet vs shipped), `ActivityFeed` / `ActivityRow` (Shipped/Docked/Pulled/Pushed), `DemoControls` (fork only).

**Builder**: `WizardRail` (steps summary), `PairSelector`, `TokenPicker` (search/balances), `PresetCards`, `ShapeThumbnail`, `RangeChart` (lightweight-charts + band primitive), `RangeInputs` (min/max steppers + chips + invert), `FeeInput`, `AdvancedParams` (decay, deadline, salt, gates), `AmountsForm`, `SimulationPanel` (payoff chart, APR with assumptions, risk badges), `ReviewSummary`, `TxStepper` (approve→ship), `TxStatusToast`.

**Charts**: `PriceRangeChart`, `LiquidityShapeChart`, `PayoffChart`, `PnlChart`, `Sparkline`, shared `ChartTheme` tokens.

**Hooks/data**: `useAquaPositions(maker)` (getLogs Shipped/Docked → active set), `useStrategyBalances(hash)` (`rawBalances`/`safeBalances` multicall), `useActivity(maker)` (Pulled/Pushed logs + watchContractEvent), `useAllowance(token)`, `useShip()`, `useDock()`, `useSimulateShip()`, `useProgramBuilder()` (pure TS encoder matching `InstructionBuilder` layout; or @1inch/swap-vm-sdk 0.4.1 if it covers the needed instructions — UNCERTAIN, inspect before relying on it), `usePrices()` (fork spot from the pool or a mocked oracle).

---

## 12. Recommended stack with verified version pins (npm view, 2026-09-05)

| Layer | Package | Version | Why |
|---|---|---|---|
| Build | `vite` / `@vitejs/plugin-react` | 8.2.2 / 6.1.1 | SPA is enough; no SSR/hydration issues with wallet state; fastest iteration for a 1-week hackathon. (Next 16.3.4 is fine if you want `geist` font package + Vercel; `next` peer-deps React ^19.) |
| Lang | `typescript` | **5.9.3** (not 7.0.2) | wagmi requires TS ≥ 5.9.3; TS 7 (Go port) is new — ecosystem/plugin risk. |
| UI runtime | `react` / `react-dom` | 19.2.8 | — |
| Chain | `viem` | 2.56.3 | Aqua SDK depends on `viem ^2.48.4`; @privy-io/wagmi pins `viem 2.56.0` exactly if you go Privy. |
| Hooks | `wagmi` | **2.19.5** | Last 2.x (published 2025-11-19, same day as 3.0.0). RainbowKit 2.2.11 peer = `wagmi ^2.9.0`; ConnectKit 1.9.2 peer = `wagmi 2.x`. wagmi 3.7.7 renamed `useAccount→useConnection`, made connector SDKs optional peers, TS ≥ 5.9.3 [VERIFIED wagmi.sh migration guide] — no kit officially supports it yet. |
| Query | `@tanstack/react-query` | 5.102.8 | wagmi peer ≥ 5. |
| Wallet UI | `@rainbow-me/rainbowkit` | 2.2.11 | Best-looking default modal; `darkTheme({ accentColor, accentColorForeground, borderRadius, fontStack, overlayBlur })` [VERIFIED theming docs]; default accent `#0E76FD`. Alternatives: `connectkit` 1.9.2 (React peer `17.x || 18.x` — **not React 19**, avoid); `@reown/appkit` 1.8.23 (peer wagmi `>=2.19.5`, works with 2.19.5); `@privy-io/react-auth` 3.40.0 + `@privy-io/wagmi` 4.0.17 for embedded/email wallets (overkill for judges who use MetaMask/Rabby). |
| Local fork | Foundry `anvil --fork-url` | — | Add Anvil chain (31337) to wagmi config with `http('http://127.0.0.1:8545')`; import an Anvil key into Rabby/MetaMask for the demo; wagmi `mock` connector (`@wagmi/connectors` 8.2.0) for e2e tests. |
| Styling | `tailwindcss` + `@tailwindcss/vite` | 4.3.3 | CSS-first `@theme` tokens; define the palette in §8 as CSS variables. |
| Components | `shadcn` CLI | 4.21.0 | Scaffold only; Base UI is now the default primitive (`@base-ui-components/react` 1.0.0-rc.0, July 2026 changelog [VERIFIED ui.shadcn.com/docs/changelog]); Radix (`@radix-ui/react-dialog` 1.1.23, `react-slider` 1.4.7) still available. Utilities: `class-variance-authority` 0.7.1, `tailwind-merge` 3.6.0, `clsx` 2.1.1 (or shadcn's new `cn` 0.2.5). Re-theme every token; delete default `--ring`/radius. |
| Time-series charts | `lightweight-charts` | 5.2.1 | TradingView-grade, ~45 KB, series primitives for range band/handles; client-only (mount in `useEffect`). |
| Curve charts | `d3-scale` / `d3-shape` | 4.0.2 / 3.2.0 | Hand-rolled SVG payoff/liquidity plots; full control of styling; tiny. (`recharts` 3.10.1 acceptable for quick bar/line + `ReferenceArea`; `@visx/visx` 4.0.0 if you prefer React-first primitives.) |
| Motion | `motion` | 13.2.0 | Import from `"motion/react"`; `AnimatePresence`, `layout`, springs; peer React ^18 ‖ ^19. |
| Numbers | `@number-flow/react` | 0.6.2 | Animated tabular numerals for KPIs; peer React ^18 ‖ ^19. |
| Tables | `@tanstack/react-table` / `react-virtual` | 9.2.4 / 3.14.10 | Sorting/filtering; virtualise Activity feed. |
| Toasts | `sonner` | 2.0.8 | Promise toasts for tx lifecycle. |
| Icons | `lucide-react` | 1.41.0 | Single set; 1.5 px stroke; never emoji. |
| Fonts | `@fontsource-variable/geist` + `geist-mono` | 5.3.0 | (Next: `geist` 1.7.2.) Fallback `@fontsource-variable/inter` 5.3.0. |
| State/validation | `zustand` / `zod` | 5.0.15 / 4.5.4 | Wizard state; param validation mirroring contract `require`s (e.g., `0 < sqrtPriceMin < sqrtPriceMax`). |
| 1inch SDKs | `@1inch/aqua-sdk` / `@1inch/swap-vm-sdk` | 0.3.1 / 0.4.1 | `AquaProtocolContract.ship/dock`, `calculateStrategyHash`, `ShippedEvent.fromLog` etc. [VERIFIED sdk README]. swap-vm-sdk content not inspected — UNCERTAIN coverage. |
| Tests / recording | `vitest` / `@playwright/test` | 5.0.0 / 1.63.0 | Playwright can drive the demo flow against Anvil and record video. |

Minimal wagmi + RainbowKit wiring (wagmi 2.x API):
```ts
import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider, http } from 'wagmi';
import { base, mainnet, anvil } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@rainbow-me/rainbowkit/styles.css';

const config = getDefaultConfig({
  appName: 'Aqua Positions', projectId: import.meta.env.VITE_WC_PROJECT_ID,
  chains: [anvil, base, mainnet],
  transports: { [anvil.id]: http('http://127.0.0.1:8545'), [base.id]: http(), [mainnet.id]: http() },
});
const theme = darkTheme({ accentColor: '#2F8AF5', accentColorForeground: '#fff', borderRadius: 'medium', fontStack: 'system', overlayBlur: 'small' });
// <WagmiProvider config={config}><QueryClientProvider client={qc}><RainbowKitProvider theme={theme}>…
```

---

## 13. Resources (URLs)

- Prize page: https://ethglobal.com/events/ethonline2026/prizes/1inch — SwapVM https://github.com/1inch/swap-vm/tree/main · Aqua https://github.com/1inch/aqua · Aqua SDK https://github.com/1inch/sdks/tree/master/typescript/aqua · SwapVM whitepaper https://github.com/1inch/swap-vm/blob/release/1.1/docs/whitepaper-swap-vm-1.0.pdf · Aqua whitepaper https://github.com/1inch/aqua/blob/main/docs/whitepaper-aqua-1.0.pdf
- Rules/judging: https://ethglobal.com/events/ethonline2026/info/details · showcase style reference https://ethglobal.com/showcase (taglines are 10–15 words, benefit-first)
- 1inch product/Aqua: https://1inch.com/ · https://1inch.com/aqua/ (brand page https://1inch.com/brand/ returned 404 on 2026-09-05)
- Uniswap v4 dynamic fees: https://developers.uniswap.org/docs/protocols/v4/concepts/dynamic-fees
- lightweight-charts plugins: https://tradingview.github.io/lightweight-charts/docs/plugins/intro
- RainbowKit theming: https://www.rainbowkit.com/docs/theming · wagmi v3 migration: https://wagmi.sh/react/guides/migrate-from-v2-to-v3
- shadcn changelog (Base UI default): https://ui.shadcn.com/docs/changelog · Geist: https://vercel.com/font · Motion: https://motion.dev/docs/react

---

## 14. Open questions / to verify before building

1. Exact 1inch dApp palette and font (DevTools on app.1inch.io) — current hex values are from memory.
2. Whether `@1inch/swap-vm-sdk` 0.4.1 exposes builders for `XYCConcentrateSwap`, `FeeFlat`, `Decay` etc. or only decoding; otherwise port `InstructionBuilder` encoding to TS.
3. Whether the Uniswap v4 app's quick-range chips are ±1/5/10/20% (UNCERTAIN) — irrelevant to correctness, only to parity.
4. Price source on the fork for the range chart: derive from the strategy's own balances (`safeBalances` → √(y/x)) vs. an external pool; decide before building `PriceRangeChart`.
5. Does the modified SwapVM (if any) need a Custom-program step in the wizard, or only new presets? Affects `ProgramList` editing capability (read-only is far cheaper).
6. Reown AppKit 1.8.23 vs RainbowKit 2.2.11: both fine on wagmi 2.19.5; RainbowKit chosen for the cleaner default modal. Revisit only if a wagmi-3-compatible RainbowKit release appears before Sep 13.
