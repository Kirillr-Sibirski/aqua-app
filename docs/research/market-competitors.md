# KB: Competitive landscape for "self-custodial programmable liquidity" (as of 2026-09-05)

Purpose: map every product category adjacent to 1inch Aqua + SwapVM, with custody model, programmability, users, traction and weakness per product; then a positioning matrix and the whitespace Aqua occupies; then concrete product angles that need Aqua. Written for ETHOnline 2026 ("Build an Aqua app", 1inch track).

Method / provenance. The session's WebSearch budget was already exhausted, so everything below comes from (a) live DefiLlama JSON endpoints fetched 2026-09-05 (`api.llama.fi/tvl/<slug>`, `api.llama.fi/summary/dexs/<slug>`, `api.llama.fi/summary/aggregators/<slug>`), (b) protocol docs fetched directly (URLs cited inline), (c) Google News RSS headlines (title/date/source only, where noted), (d) the local Aqua/SwapVM clones and the sibling KB files (`aqua-core.md`, `aqua-positioning.md`, `swapvm-core.md`, `swapvm-instructions.md`, `market-lp-pain.md`). Anything from background knowledge rather than a fetched source is marked **(background)**; anything doubtful is marked **UNCERTAIN**. DefiLlama "TVL" for DEXs is pool-locked value; volumes are DefiLlama-adapter volumes and can be wrong for young protocols (EulerSwap adapter looks broken, see §3.1).

---

## 0. TL;DR

1. **Nobody else combines (a) tokens staying in the LP's own wallet until fill, (b) on-chain, maker-composed strategy logic, and (c) one balance backing many strategies at once.** Every AMM/hook/ALM/vault/options/PoL product locks funds in a contract (pool, vault, singleton, L2); every wallet-native system (1inch LOP, UniswapX, CoW programmatic orders, Orbs dTWAP, RFQ/PMM) is order-shaped (static or predicate-gated price), not a live two-sided curve with `quote()==swap()` consistency and auto-reinvest.
2. The two closest *conceptual* neighbours are (i) **professional PMMs** (Bebop/0x RFQ/Hashflow/Native): one inventory quotes many pairs, funds stay in the MM's wallet — but pricing is off-chain, permissioned, and needs 24/7 infra; and (ii) **lending-collateral-as-AMM** (EulerSwap, Fluid DEX): capital does two jobs at once — but it is locked in the lending layer and, for EulerSwap, one operator per pool. Aqua is "PMM-style shared inventory for permissionless LPs, enforced on-chain by SwapVM bytecode".
3. Traction reality check (DefiLlama, 2026-09-05): **1inch Aqua 30d volume $561M** (24h $53.8M, all-time $630M, 13 chains) already exceeds Balancer V3 ($173M/30d), Hashflow ($447M), Angstrom ($238M), Velodrome V3 ($508M) and is ~18% of Fluid DEX ($3.05B) and ~1.9% of Uniswap V4 ($30.3B). Aqua has **no TVL by construction** — the "TVU" framing is the correct comparison and the pitch should say so.
4. 2025-26 hack history is the strongest argument for the custody axis: Bunni v2 ($8.4M, shut down Oct 2025), Balancer V2 ($116-128M, Nov 2025; Balancer Labs wound down Mar 2026; V1 pool hit again Aug 31 2026), Yearn yETH ($2.8M, Nov 2025), Aevo/Ribbon vaults ($2.7M oracle exploit, Dec 2025), Kelp DAO (~$300M, Apr 2026), CoW Swap DNS hijack (Apr 2026). Pooled TVL is the honeypot; Aqua's blast radius is per-maker, per-strategy.
5. Whitespace Aqua+SwapVM uniquely occupies: **wallet-custody × bytecode-programmable × fully shared**. The nearest occupied cells are "wallet-custody × contract-programmable × partially shared" (CoW programmatic orders / 1inch LOP) and "locked × parametric × partially shared" (EulerSwap / Fluid). See §5.
6. Ten-plus product angles that are impossible or very hard without Aqua are in §7 (one-inventory-many-pairs treasury MM, formula A/B on the same capital, yield-bearing inventory that quotes in the underlying, options premium + swap fees on the same collateral, tiered per-resolver pricing, DAO-Safe-native LP without vaults/timelocks, agentic LP with ship/dock-only session keys, etc.).

---

## 1. Reference point: what Aqua + SwapVM actually are (from local sources)

Source: `refs/aqua/src/Aqua.sol`, `refs/aqua/src/interfaces/IAqua.sol`, `refs/swap-vm/src/*`, summarised in `docs/research/aqua-core.md` and `docs/research/swapvm-core.md`.

- **Aqua = ~80-line non-custodial allowance registry.** Holds no tokens. One packed slot per `(maker, app, strategyHash, token)`: `struct Balance { uint248 amount; uint8 tokensCount; }` (`src/libs/Balance.sol:11-14`); mapping declared at `Aqua.sol:21-24` ("aka makers' allowances").
- `ship(address app, bytes strategy, address[] tokens, uint256[] amounts)` — sets virtual balances, **no token transfer, no balance/allowance check**; strategies are immutable (`StrategiesMustBeImmutable`). `dock(app, strategyHash, tokens)` zeroes them (marks `tokensCount = 0xFF`).
- `pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to)` (`Aqua.sol:117`, selector `0xb00bbd10`) — **`msg.sender` is the app**; does `token.transferFrom(maker, to, amount)` and decrements the virtual balance. `push(maker, app, strategyHash, token, amount)` — anyone; `transferFrom(msg.sender, maker, amount)` and increments (auto-reinvest). Every push/pull = 1 SLOAD + 1 SSTORE.
- Solvency is lazy: a maker may ship 100% of a balance to N strategies; the first fill wins, later pulls revert if the wallet is short (SwapVM's "strategy liveness" invariant, `TESTING.md`). Whitepaper term: SLAC = provisioned liquidity ÷ wallet equity (≥1).
- Deployed registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` is `AquaRouter` (adds `multicall`, `simulate`, `rescueFunds`; owner `0x5AFc…338D` can only rescue stray tokens). SwapVM router `0x111111338c5091e8440b67b168bae16a668ac0de` = `AquaSwapVMRouter` v1.0.2.
- **SwapVM = serialized strategy bytecode** (2-byte header + args per instruction) executed by `runLoop`. Opcode banks (`src/libs/OpcodeList.sol`, from `docs/research/swapvm-core.md`): control `0x00-0x0f` (Stop, Revert, Salt, Jump, Extruction 0x04); guards `0x20-0x3f` (Deadline 0x20, OnlyTakerTokenBalanceNonZero/Gte/SupplyShareGte 0x23-25, OnlyTxOriginTokenBalanceNonZero 0x26, PrivateOrder 0x2b, WhitelistCoequal/Sequential 0x2c/0x2d, JumpIfDirection/TokenIn/TokenOut 0x30-32); invalidators `0x40-0x48`; curves (XYCSwap 0x50, XYCConcentrateSwap 0x51, LimitSwap 0x53, LimitSwapFullAmount 0x54, PeggedSwap 0x58); fees (FeeFlatIn 0x70, FeeFlatOut 0x71, FeeProtocol 0x80); balances (StaticBalances 0x90, DynamicBalances 0x91, DutchAuctionBalanceIn/Out 0x94/0x95, PiecewiseLinearScaleBalanceIn/Out 0x98/0x99, Decay 0x9c, TWAPSwap 0x9d); rates (RequireMinRate 0xb0, AdjustMinRate 0xb1, OraclePriceAdjuster 0xb2, BaseFeeAdjuster 0xb4); **`0xd0-0xef` free for custom instructions**.
- The deployed `AquaSwapVMRouter` exposes only: Jump, JumpIfTokenIn/Out, Deadline, OnlyTaker*, XYCSwap, XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction, OnlyTxOriginTokenBalanceNonZero (`AquaOpcodes.sol:27-45`). Limit/Dutch/TWAP/Oracle/Whitelist opcodes exist in `SwapVMRouter`/`Opcodes` and can be included in a **redeployed modified router** (explicitly allowed by the prize).
- Production taker access is **default-deny**: `swap()` requires `tx.origin` to hold the soulbound KycNFT (`RES`) of KYB-verified 1inch Resolvers (opcode 0x26). Mock on a fork.
- Public numbers: launch 2026-07-28 on 13 chains; 2026-09-04 blog: >$520M cumulative volume, ~4,500 open positions, ~600 LPs; CMC/Kunz mid-Aug: $12.2M deposited backing $22.5M shared liquidity (SLAC ≈ 1.85). DefiLlama 2026-09-05: "1inch Aqua" DEX, 24h $53.77M, 7d $258.5M, 30d $561.2M, all-time $630.4M; chains Arbitrum, Ethereum, BSC, Gnosis, Base, Polygon, Linea, Sonic, Avalanche, Unichain, OP Mainnet, ZKsync Era, Robinhood Chain; DefiLlama description: "LPs keep tokens in their own wallets while multiple trading strategies (AMMs, limit orders, custom logic) share the same capital; swaps pull/push tokens atomically against maker wallets."

Honest weaknesses to keep in mind when positioning (from code, not marketing): (1) takers are KYC'd resolvers, so there is no permissionless demand side yet; (2) the app contract can pull up to the shipped amount — an app bug is a maker loss bounded by `ship` amounts, and the ERC-20 approval to the registry is unbounded unless the maker caps it; (3) no LP token / ERC-4626 share, so an Aqua position is not itself composable as collateral; (4) "shared" means shared across Aqua strategies — tokens must sit in the wallet, not in Aave (unless the strategy holds yield-bearing wrappers, see §7.5); (5) Aqua does no discovery/matching — Pathfinder/resolvers do.

---

## 2. DefiLlama snapshot table (2026-09-05, USD)

| Product | Slug | TVL | Vol 24h | Vol 7d | Vol 30d | Vol all-time | Notes |
|---|---|---|---|---|---|---|---|
| Uniswap (all) | uniswap | — | 2.95B | 16.9B | 58.5B | 3,848B | 50 chains |
| Uniswap V4 | uniswap-v4 | 1.024B | 1.59B | 9.79B | 30.3B | 430.9B | 19 chains; change_1m +9% |
| Uniswap V3 | uniswap-v3 | 1.54B | — | — | — | — | |
| Curve DEX | curve-dex | 1.31B | 47.6M | 834M | 3.5B | 349B | 14 chains |
| Balancer V3 | balancer-v3 | 29.1M | 3.46M | 53.8M | 173M | 25.7B | post-hack; Labs wound down |
| Maverick V2 / V1 | maverick-v2 / maverick-protocol | 1.23M / 2.30M | — | — | — | — | |
| Ambient | ambient | 2.30M | — | — | — | — | |
| Fluid DEX | fluid-dex | 316.6M | 73.9M | 778M | 3.05B | 230B | ETH, Arb, Polygon, Base, Plasma; Fluid Lending TVL 749M |
| Aerodrome Slipstream / V1 | aerodrome-slipstream / aerodrome-v1 | 199M / 118M | 299M | 2.86B | 12.7B | 404B | Base only |
| Velodrome V3 | velodrome-v3 | 24.8M | 8.3M | 122M | 508M | 33.6B | 9 OP-stack chains |
| EulerSwap | eulerswap | (Euler total 352M) | 14k | 40k | 137k | 4.34B | **adapter numbers look broken** (change_7d +22,790%) — UNCERTAIN |
| Bunni V2 | bunni-v2 | 0.215M | — | — | — | — | shut down Oct 2025 |
| Angstrom | angstrom | — | 3.09M | 67.0M | 238M | 2.83B | Ethereum only |
| 1inch (aggregator) | 1inch | — | 88.6M | 471M | 2.90B | 796B | 15 chains |
| **1inch Aqua** | 1inch-aqua | none (by design) | 53.8M | 258.5M | 561M | 630M | 13 chains |
| CoW Swap | cowswap | — | 34.8M | 577M | 3.11B | 181B | 8 chains |
| 0x | 0x-protocol | — | 640M | 2.96B | 8.0B | 135B | 26 chains |
| Bebop | bebop | — | 52.6M | 285M | 1.40B | 74.1B | 13 chains |
| Hashflow | hashflow | 0.27M | 8.4M | 79.3M | 447M | 22.2B | 8 chains |
| Native | native | 24.2M | 100M | 463M | 1.02B | 30.3B | change_1m +335% |
| Gamma / Steer / Charm / ICHI | gamma / steer-protocol / charm-finance / ichi | 3.1M / 20.2M / 2.2M / 7.8M | | | | | ALMs |
| Arrakis | arrakis-finance / arrakis-v2 | 56.8M / 0.16M | | | | | |
| Aera | aera | 199M | | | | | Gauntlet |
| Morpho | morpho | 9.77B | | | | | vaults+markets |
| Yearn | yearn-finance | 188M | | | | | |
| Balmy | balmy | 0.22M | | | | | DCA |
| Enzyme | enzyme-finance | 92M | | | | | |
| Derive V2 | derive-v2 | 162M | | | | | options/perps L2 |
| Rysk | rysk-finance | 48.5M | | | | | |
| Aevo | aevo | 15.5M | | | | | |
| Smilee / Thetanuts / Premia V3 | smilee-finance / thetanuts-finance / premia-v3 | 0.78M / 0.0004M / 0.55M | | | | | effectively dormant |
| Ajna | ajna-protocol | 0.086M | | | | | |

Not resolvable on DefiLlama with the slugs tried: CoW AMM, Panoptic, IVX, Olympus (returns 0), Auto/Tokemak, Doppler, Flaunch, UniswapX, Arrakis Pro. Context from `market-lp-pain.md`: DefiLlama lists 657 chains and 362 spot DEXs; aggregators moved $67.6B in 30d.

---

## 3. Category-by-category map

Format per product: what it does · custody (where funds sit) · programmability · who uses it · traction · key weakness.

### 3.1 AMMs and hooks

**Uniswap v4 + hooks** — Singleton `PoolManager` holds all pool tokens; pools are keyed by (tokens, fee, tickSpacing, hook). Hooks are contracts with permission flags in their address; `beforeSwapReturnDelta`-style hooks can override pricing and settle deltas themselves (background). Custody: locked in `PoolManager` (ERC-6909 claim tokens for in-protocol balances). Programmability: high (deploy a hook contract), but one hook = one pool family; hooks cannot make another pool's capital available. Traction (DefiLlama 2026-09-05): TVL $1.02B, 30d volume $30.3B, 19 chains. 2026 news (Google News RSS): "Uniswap v4 hits over 90K hooks initialized and linked to deployed pools" (Crypto Briefing, 2026-09-05); "Introducing Permissioned Pools on Uniswap v4" (GlobeNewswire 2026-07-23; "for tokenized funds and equities"); v4 protocol-fee switch vote (The Defiant 2026-07-10 → "Uniswap Protocol Revenue Nearly Triples After v4 Fee Switch", 2026-07-30); "Spark Seeds $150M Into Uniswap v4 to Build Shared FX Layer for Stablecoins" (2026-06-26); "Robinhood Chain becomes a playground for Uniswap v4 hook strategies targeting tokenized stocks" (Crypto Briefing 2026-09-03) and "Uniswap v4 hooks drive $1B+ tokenized stock tra[ding]" (Pluang 2026-09-03); "Uniswap v4 Hook Library Adds Automated Liquidity Tools" (Bitcoinist 2026-09-04); "Uniswap expands liquidity layer to Arc network" (2026-08-18); "UniswapX Partners with Securitize" (2026-02-13). Weakness: capital still per-pool and locked; LP fee take by protocol (25% on 1/5bp, 17% on 30bp pools per `market-lp-pain.md`); hook security surface ("Uniswap v4 Hook Security: Architecture, Common Vulnerabilities", KuCoin 2026-06-17).

Notable hooks:
- **Bunni v2** (Bacon Labs). Docs: "BunniHub … The main contract liquidity providers interact with to deposit/withdraw funds. Stores all user funds."; "BunniHook … Uniswap v4 hook responsible for handling swaps … Implements auto-rebalancing executed via flood.bid"; LDFs = "smart contracts describing different liquidity distributions"; features: shapeshifting, autonomous rebalancing, surge fee, rehypothecation ("idle assets to earn additional yield from external protocols"), am-AMM ("auction-managed mechanism … recapture MEV"). https://docs.bunni.xyz/docs/v2/technical/overview. Custody: locked in BunniHub (+ ERC-4626 rehypothecation). Status: exploited 2025-09-02 ($8.4M; rounding in the LDF), **permanently shut down 2025-10-22/23** (The Block, CoinDesk). DefiLlama TVL $215k. Lesson: the most programmable v4 hook died of custody + math complexity.
- **Arrakis (Pro / HOT / Modular)**. Docs (https://docs.arrakis.finance/arrakis-pro.md): "Token issuer owns the vault NFT, self-custodial"; "Whoever holds the vault NFT controls the assets"; core parameter changes "subject to a two-day timelock"; off-chain Arrakis infra executes Bootstrap/Flagship/Yield-Bearing-Asset/Treasury-Diversification strategies; v4 hooks offered: Price Convergence (RWA/CEX alignment) and Dynamic Fees; "over 100 token issuers", "more than $5B in onchain volume". HOT (Valantis Sovereign Pool with signed RFQ quotes + AMM fallback + "AMM Stale-Quote Fee"): per Valantis docs it "has since been deprecated" after ~6 months at ~$6M TVL (https://docs.valantis.xyz/design-space/hot.md). DefiLlama arrakis-finance TVL $56.8M. Custody: user-owned vault NFT, but tokens are in the vault/DEX and an executor rebalances. Weakness: still pooled per vault; requires trusting Arrakis' off-chain executor within timelocked bounds; issuer-only product.
- **Angstrom (Sorella Labs)**. DefiLlama: "a hybrid DEX built on Uniswap V4 that uses app-level sequencing to internalize MEV, allowing LPs to earn arbitrage profits"; site: "high-frequency auctions are continuously conducted as off-chain prices move", "Liquidity Providers Have lost $198,924,442 To Arbitragers since the Merge" (https://angstrom.xyz). Traction: 30d $238M, all-time $2.83B, Ethereum only. Custody: PoolManager. Programmability: none for LPs beyond ranges. Weakness: needs its own node network/consensus; single chain.
- **EulerSwap** — see §3.8.
- **Doppler (Whetstone)**. "an onchain protocol for launching tokens through various price discovery auctions"; multicurve auctions; used by "Zora, Paragraph, Noice, and Bankr"; Base + Solana devnet per docs; contracts deployed on Ethereum, Monad, Robinhood Chain, Base, Arbitrum (https://docs.doppler.lol, github whetstoneresearch/doppler). Custody: v4 pools (Airlock). Not a liquidity product for LPs; a launch product.
- **Flaunch (Flayer Labs)**. "a token launch protocol for creators, communities, and developers"; "Fixed-Price Fair Launch Window", "Creator Revenue Paid In ETH", "Automatic Community Buybacks" (https://docs.flaunch.gg). Base, v4 hook (background). Same comment as Doppler.

**Balancer v3** — "The Vault … holds and manages all tokens in each Balancer pool"; custom pools "plugged directly into Balancer's existing liquidity"; hooks at 10 points (`onBeforeSwap`, `onAfterSwap`, `onComputeDynamicSwapFeePercentage`, …), pool-hook link "cannot change after the pool is registered", and "the vault only supports modifying the calculated part of the operation" — hooks **cannot** source liquidity from outside the Vault (https://docs.balancer.fi/concepts/core-concepts/hooks.html). Boosted pools: "100% of an LP position … held in a yield-bearing token" (ERC-4626, Aave/Morpho) via Vault buffers. Custody: locked in the Vault. Traction: TVL $29.1M, 30d $173M after the 2025-11-03 exploit ($116-128M; "TVL cut by two-thirds", Yahoo 2025-11-27); "Balancer Proposes Winding Down Labs, Ending BAL Emissions" (The Defiant 2026-03-24); V1 pool hit for $234K on 2026-08-31 (same rounding bug family). Weakness: the single-vault design that enabled boosted pools is the same thing that made one bug drain many pools.

**Curve** — StableSwap/CryptoSwap pools, ve-gauge emissions (background). TVL $1.31B, 30d $3.5B, 14 chains. Custody: pool contracts. Programmability: none (A parameter / gamma). Weakness: capital idle in stable pools; governance-driven emissions.

**Maverick v2** — bins with movement "modes" (static / right / left / both) that auto-shift with price; Boosted Positions; docs page fetched only covers v1 ("the first Dynamic Distribution AMM, capable of automating liquidity strategies", https://docs.mav.xyz). Custody: pool contract. TVL tiny now ($1.2M v2, $2.3M v1). Weakness: lost mindshare; directional modes are a fixed menu, not code.

**Ambient (CrocSwap)** — "runs the entire DEX inside a single smart contract, where individual AMM pools are lightweight data structures"; concentrated + ambient + **knockout liquidity that "behaves like limit orders which atomically fill and lock in a position"**; dynamic fees; auto-reinvest of fees; JIT prevention via minimum TTL on concentrated positions; "surplus collateral" for net settlement; permissioned-pool governance (https://docs.ambient.finance). Custody: single contract. TVL $2.3M. Relevance: the closest *in-pool* analogue to mixing curve + limit orders on one balance — but locked.

**Fluid DEX (Instadapp)** — see §3.8.

**Aerodrome / Velodrome** — ve(3,3) emissions + Slipstream concentrated liquidity (background; docs 403). Aerodrome Slipstream TVL $199M, 30d $12.7B (Base's dominant DEX); Velodrome V3 30d $508M across 9 OP-stack chains. Custody: pools + gauges. Programmability: none for LPs (ALM partners run vaults on top). Weakness: emissions-dependent; per-chain silos.

### 3.2 Intent / RFQ / PMM systems

**1inch Fusion / Fusion+ / Limit Order Protocol v4** — LOP: orders are "data structure signed according to EIP-712", funds stay in the wallet (allowance to Router v6, same address on 16+ chains); extensions: predicates ("conditions that must be met before execution … stop-loss, take-profit"), interactions ("arbitrary maker's code … before and after order filling"), dynamic getters ("functions to calculate, on-chain, the exchange rate … dutch auctions … or range orders"), ERC-721/1155 proxies (https://github.com/1inch/limit-order-protocol). Fusion = Dutch-auction orders filled by KYC'd resolvers on LOP; Fusion+ = cross-chain HTLC: `EscrowSrc` "Holds user tokens on the source chain", `EscrowDst` holds resolver tokens, `Timelocks` windows, resolver "safety deposit in native tokens on both chains", Merkle-indexed secrets for partial fills (https://github.com/1inch/cross-chain-swap). Custody: wallet until fill (escrow only after fill). Traction: 1inch aggregator 30d $2.90B. Weakness vs Aqua: order-shaped (one-directional, fixed amount, price by formula-of-time), no auto-reinvest, no two-sided curve. Note: LOP is Aqua's own sibling — SwapVM's `LimitSwapVMRouter` is effectively LOP-as-bytecode.

**UniswapX** — "a permissionless, open source, auction-based swapping protocol"; "swappers generate signed orders which specify the outputs of their swap, and fillers compete"; Dutch decay "starts at a maximum price and decays down to a minimum price"; "sign a message that uses Permit2 to allow token transfer"; "Anyone can fill orders"; gas-free, MEV-protected, "no cost for failed transactions" (https://developers.uniswap.org/docs/liquidity/uniswapx/overview). Custody: wallet until fill (Permit2). Programmability: order-type menu (Dutch, exclusive Dutch, priority, cross-chain — background), not user code. Weakness: swapper-side intents only; LPs are fillers with their own inventory/infra.

**CoW Swap / CoW Protocol** — batch auctions + solver competition; **Programmatic Order Framework**: ERC-1271 smart-contract orders, ComposableCoW, "conditional orders that execute when certain on-chain conditions are met (such as asset prices, wallet balances, time elapsed…)", TWAP built on it, stop-loss/GAT/take-profit, DAO payroll/treasury diversification (https://docs.cow.fi/cow-protocol/concepts/order-types/programmatic-orders). **CoW Hooks**: pre-hooks ("Unstaking tokens just-in-time", "Claiming an airdrop", permits) and post-hooks ("Bridging funds to L2s", "Staking"), solver executes "as one atomic transaction", gas paid in sell token only on success (https://docs.cow.fi/cow-protocol/concepts/order-types/cow-hooks). Custody: wallet/Safe with allowance to the Vault Relayer. Traction 30d $3.11B. 2026: "DAO behind CoW Swap urges users to stay off platform after 'hijacking'" (DNS, 2026-04-14); "Lido reintroduces integrated fast swaps … via CoWSwap" (2026-07-13). Weakness: still one-sided intents; conditional orders are Safe-centric; solvers gate execution.

**CoW AMM** — Balancer-based `BCoWPool`: "Gives infinite ERC20 approval to the CoW Protocol's VaultRelayer contract at finalization time", validates swap intents via IERC1271, `commit` in transient storage to prevent conflicting settlements (https://github.com/balancer/cow-amm). Function-Maximising AMM: solvers rebalance the pool inside batches and surplus goes to LPs (background). Custody: pool contract. Traction: not resolvable on DefiLlama (UNCERTAIN, small). Weakness: locked pool; LVR protection only within CoW's batch cadence.

**Bebop (Wintermute)** — RFQ ("Institutional market maker liquidity with guaranteed execution and guaranteed fill") + JAM ("Route trades through competing solvers"); contracts BebopRouter `0xBeb0009ACa35087ce7cCF11637E24dd1Aad3bf2A`, BebopSettlement `0xbbbbbBB520d69a9775E85b458C58c648259FAD5F`, Balance Manager `0xC5a350853E4e36b73EB0C24aaA4b8816C9A3579a`, JamSettlement `0xbeb0b0623f66bE8cE162EbDfA2ec543A522F4ea6`; "If any condition fails, the entire transaction reverts" (https://docs.bebop.xyz/core-concepts/settlement-smart-contracts.md). Custody: taker wallet via approval; MM inventory in MM wallets (background). Traction 30d $1.40B, 13 chains. Weakness: MM side permissioned and off-chain; no way for a non-professional to "be the PMM".

**Hashflow** — "DeFi-native RFQs to fetch quotes from market makers"; "Market makers are required to cryptographically sign quotes that remain unchanged for the duration of the trade" (https://docs.hashflow.com). MM funds sit in Hashflow pool contracts (background, UNCERTAIN). Traction: 30d $447M; TVL $0.27M. Weakness: declining; closed MM set.

**Native** — "Non-custodial, Autonomous Trading Infrastructure"; "decouples pricing logic from asset settlement"; **Native Core** = "a high-performance, first-in-first-out (FIFO) central limit order book (CLOB) that is fully on-chain", "50ms block finality", "Max 1M TPS" claim; **Native Pool**: "Deposit supported assets … directly into Native Pool", yield from "demand for capital on Native Core, including market maker utilisation and trading fees", scheduled vs instant withdrawal; LP model is "single-sided, loan-based … eliminates impermanent loss" (https://docs.native.org/native-dev/modules/native-pool.md, …/native-liquidity-provisioning.md). Custody: **locked** in Native Pool; MMs borrow it. Traction: 30d $1.02B (+335% m/m), TVL $24.2M, 11 chains incl. Robinhood Chain and "Native Core". Relevance: **closest business-model neighbour** — "LP capital lent to MMs so one inventory quotes many pairs", but via deposit + credit, not via wallet allowances + on-chain strategies. (Native previously marketed a credit layer literally called "Aqua" in 2024 — background, UNCERTAIN; the current docs do not use the name.)

**0x** — Swap API "Aggregated liquidity from 150+ sources", Gasless API; RFQ from professional MMs via Settler/Permit2 (background) (https://docs.0x.org). Traction 30d $8.0B, 26 chains. Same weakness as Bebop.

### 3.3 ALMs / vaults

| Product | What | Custody | Programmability | Traction | Weakness |
|---|---|---|---|---|---|
| Gamma | "Non-custodial, automated rebalancing liquidity vaults" (Hypervisors) on Uniswap V4/V3, Algebra…; v4 "MultiPosition" up to 20 positions with Exponential/Order Book/Gaussian/Triangle/Uniform shapes (https://docs.gamma.xyz) | vault contract; Gamma rebalances | menu of strategies | TVL $3.1M | Jan-2024 exploit (~$6M, background UNCERTAIN); trust in rebalancer; TVL collapsed |
| Steer | "Automated concentrated liquidity management across 27+ chains and 32 DEXs"; Development Kit + backtesting; "protocol-validated services" keeper network (https://docs.steer.finance) | vault contract | write your own strategy (off-chain app) | TVL $20.2M | still pooled; keeper trust |
| Charm Alpha Vaults | "permissionless liquidity manager … the only way to create fully permissionless LP vaults" (https://learn.charm.fi) | vault | passive rebalancing params | TVL $2.2M | tiny |
| ICHI Yield IQ | single-sided deposits into CL pools; "token projects, DAOs, asset managers" (https://docs.ichi.org) | vault | none | TVL $7.8M | tiny |
| Arrakis Modular | see §3.1 | NFT-owned vault + executor | menu | $56.8M | issuer-only |
| Aera (Gauntlet) | "onchain vaults with off chain intelligence"; guardians "take onchain actions while complying to specified constraints"; Merkle-tree calldata constraints; DAO treasuries (https://docs.aera.finance) | owner vault; guardian executes | constraint whitelists | TVL $199M | funds leave the treasury wallet into a vault |
| Morpho Vaults V2 | roles Owner/Curator/Allocator/Sentinel, "no single party controls user assets", timelocks "0 to 3 weeks", `forceDeallocate` in-kind exits, "All vault contracts are immutable" (https://docs.morpho.org/learn/concepts/vault/) | ERC-4626 vault | curator allocations | Morpho TVL $9.77B | curator trust; lending only |
| Yearn V3 | ERC-4626 allocator vaults + tokenized strategies, "Anyone can deploy a strategy or manage a vault" (https://docs.yearn.fi/developers/v3/overview) | vault | strategy contracts | TVL $188M; yETH exploit $2.8M (2025-11-30) | pooled |

Common pattern: every ALM/vault is **locked + third-party-executed**; programmability means "deploy a strategy contract that the vault trusts", and the LP's money is commingled.

### 3.4 On-chain limit / DCA / grid / TWAP tooling

- **1inch LOP** — see §3.2; wallet-custody, predicate/getter programmable, keeper-less (takers fill).
- **Balmy (ex-Mean Finance)** — DCA v2 `DCAHub`: users deposit into the hub; "swappers" execute intervals; yield-while-waiting via platforms (background; docs host unreachable, README fetched had no mechanics). Custody: deposited. TVL $0.22M. Weakness: deposit model; tiny.
- **Orbs dTWAP / dLIMIT** — the contract "does not hold any funds, has no owners, administrators or other roles"; maker sets duration/size/interval; "Takers … submit bids for those chunks, including a fee"; Orbs Guardians act as backup bidder; integrated into partner DEX UIs (QuickSwap etc.) (https://docs.orbs.network/v3/protocols/dtwap-protocol.md; code github.com/orbs-network/twap). Custody: allowance only. Programmability: 3 parameters. Weakness: white-label, single-sided, no curve.
- **Hummingbot** — "The open source framework for crypto market makers"; "$47B+ Total Trade Volume", "111K+ Hummingbot Instances", "318 Connectors"; Gateway for DEXs; Condor AI harness (https://hummingbot.org). Custody: keys on the user's machine (CEX accounts for CEX strategies). Programmability: full Python. Weakness: strategy enforcement is off-chain (bot uptime, key exposure); on-chain it can only post orders/LP into locked venues.
- **GMX v2 / Gains** — GMX: "decentralized spot and perpetual exchange on Arbitrum, Avalanche, and MegaETH", up to 100x, Chainlink Data Streams; orders routed "against these pools" (GM/GLV) with LPs earning "63% of the fees"; keeper-executed limit/stop/TP/SL (https://docs.gmx.io/docs/intro). Custody: collateral in market contracts; LPs in GM/GLV. Not a spot-LP product.

### 3.5 Self-custodial trading / treasury tools

- **Definitive** — "a CeFi-like experience on DeFi rails via a fully non-custodial platform & API"; "Clients maintain full control over placing trade orders and withdrawals, while whitelisted Definitive 'performers' manage pre-determined trading actions"; "Advanced order types (TWAPs, Limits, Stops/Take Profit)"; "Aggregated liquidity across 200+ DEXs, onchain venues and professional market makers"; Solana, Base, Robinhood Chain, EVM; "4x-20x cheaper fees" (https://docs.definitive.fi). Custody: user smart account with performer role. Programmability: order menu. Traction: not published. Weakness: execution-side only (taker), not LP-side.
- **karpatkey (kpk)** — DAO treasury manager using Safe + Zodiac Roles Modifier so the manager can only execute whitelisted calls; clients historically GnosisDAO, ENS, Balancer, CoW, Lido (background; kpk.io returned 403). AUM ~$1-2B (UNCERTAIN). Custody: DAO Safe. Weakness: human execution; permissions engineering per protocol.
- **Enzyme** — "Enzyme.Onyx — The tech stack to issue and administer tokenized funds"; "Enzyme.Blue — decentralized strategy management"; "Enzyme.Myso — creating and trading on-chain options" (https://docs.enzyme.finance). TVL $92M. Custody: vault with manager + policies. Weakness: depositor→manager trust.
- **Nested** — site now shows only the word "Nested"; product appears sunset (UNCERTAIN). Was portfolio-NFT / copy-trading with funds in Nested contracts.
- **Safe Apps** — iframe dApps that propose transactions to a Safe for owner signatures (background; help page 404). Custody: Safe. Relevance: an Aqua "ship/dock" Safe App is trivially non-custodial because ship/dock never move tokens.

### 3.6 Options / structured products

| Product | Model | Custody | 2026 status / traction | Weakness |
|---|---|---|---|---|
| Panoptic | "perpetual, oracle-free options protocol" where options are Uniswap LP positions moved in/out of range; "Perpetual Option Vaults (POVs)" (https://panoptic.xyz/docs/intro); news: v2 launched enabling "onchain trading of tokenized assets such as SpaceX" (2026-06-15), POV vaults on Uniswap liquidity (2026-09-03) | collateral in PanopticPool/CollateralTracker (background) | TVL not on DefiLlama | collateral locked; complex |
| Rysk | "DeFi volatility yield protocol" — covered calls / cash-secured puts "priced by counterparties through a fast on-chain auction" (RFQ); "collateral remains locked in smart contracts"; HyperEVM + Ethereum (https://docs.rysk.finance) | locked | TVL $48.5M | one-sided vaults |
| Thetanuts V4 | "builder-first, RFQ-powered options infrastructure", "all settlements on-chain … fully collateralized" (https://docs.thetanuts.finance) | locked | TVL $442 (dormant) | — |
| Aevo (ex-Ribbon) | "decentralized derivatives exchange built on a custom OP Stack Layer 2 … off-chain order matching and on-chain settlement" (https://www.aevo.xyz/docs/); "Aevo's Ribbon Vaults Lose $2.7M in Oracle Exploit" (2025-12-15) | L2 deposits | TVL $15.5M | CEX-like custody |
| Derive (ex-Lyra) | API-driven options/perps exchange on its own chain (https://docs.derive.xyz) | L2 subaccounts | TVL $162M | same |
| Premia Blue | "peer-to-peer market making and trading of options"; Vault Depot (https://docs.premia.blue) | locked | TVL $0.55M | dormant |
| Smilee | "Impermanent Gain" volatility products on Arbitrum (background) | locked | TVL $0.78M | dormant |
| IVX | "a 0dte options AMM on Hyperliquid EVM and Berachain … $BTC $ETH $SOL $HYPE and $BERA" (https://documentation.ivx.fi) | LP vault | n/a | niche |

Signal: "Vitalik Buterin Proposes Options-Based DeFi to Replace Liquidation-Driven Debt Model" (The Defiant, 2026-06-01, headline only) — options written from wallet-held collateral is a live narrative (see §7.7).

### 3.7 Liquidity-as-a-service and PoL

- **Berachain PoL** — "Berachain's system for directing network emissions toward useful economic activity"; **"BGT was deprecated on July 8, 2026"** ("PoL Next" hard fork replaced the dual-token model with WBERA rewards, Crypto Briefing 2026-07-08); per block 0.4 WBERA baseRate to validators + 1.305 WBERA rewardRate routed to Reward Vaults or "Dedicated Emission Streams"; users "stake PoL-eligible receipt tokens directly in Reward Vaults" (https://docs.berachain.com/learn/pol/). Custody: LP tokens staked in reward vaults; underlying in DEX pools. Weakness: emissions-for-TVL, the exact model Aqua's "TVU" narrative attacks.
- **Olympus** — protocol-owned liquidity, RBS, Cooler loans (background; docs index only). DefiLlama slug returns 0 (UNCERTAIN). Custody: protocol treasury.
- **Tokemak → Auto** — "Autopools … fully autonomous, transparent and sophisticated rebalance solution focused solely on liquidity provision" (https://docs.auto.finance); v1 "liquidity direction" model retired (background). Custody: deposit into autopool.
- **Arrakis Pro** — see §3.1 (issuer-owned vault NFT, executor, 2-day timelock).
- **Market-maker loans (the CEX-era alternative)** — token issuers lend inventory + call option to an MM (background). Weakness: opaque, off-chain, issuer loses custody entirely. Aqua lets an issuer *be* the MM with wallet custody (§7.1).

### 3.8 Lending-collateral-as-AMM and capital-efficiency designs

- **EulerSwap** — "EulerSwap operators … borrow output tokens using input tokens as collateral, creating just-in-time liquidity"; "up to 40x the liquidity depth of traditional AMMs by making idle assets in Euler more efficient"; "A single cross-collateralized credit vault can support multiple asset pairs"; funds "reside in underlying Euler lending vaults"; `getLimits` for utilisation/supply-cap/borrow-cap limits; `EulerSwapFactory`, `EulerSwapRegistry` ("validity bond"); swap via Uniswap v4 hook or a V2-ABI `swap`; "experimental" (https://github.com/euler-xyz/euler-swap). The Defiant (2025-05-28): "Euler Swap pools are owned and controlled by single LPs, whereas traditional AMMs use shared liquidity pools"; "ideal for DAOs, token teams, and sophisticated market makers"; euler.finance homepage still labels EulerSwap "Coming soon". Custody: locked in Euler vaults (EVC-controlled). Programmability: curve parameters per operator. Traction: all-time $4.34B, current DefiLlama volume ~zero (adapter UNCERTAIN); Euler TVL $352M. Weakness: single operator per pool; liquidation risk on the borrowed leg; vault caps.
- **Fluid DEX (Instadapp)** — "LPs are now able to utilize their position as collateral in Fluid and deploy it as AMM liquidity on the DEX" (DefiLlama description); docs: Dex Protocol enables "Smart collateral and Smart debt … earn LP fees whilst providing collateral or even on their borrowed debt position"; all funds in the Liquidity Layer `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` which "only interacts with protocols built on top of it, not end users"; `x * y = k`; `swapIn()`, `swapOut()`, `swapInWithCallback()`, `DexReservesResolver.estimate()` (https://docs.fluid.io/integrate/dex-swaps.html). Traction: DEX TVL $316.6M, 30d $3.05B, all-time $230B (ETH, Arb, Polygon, Base, Plasma); Fluid Lending TVL $749M; "Fluid Proposes Establishing a Foundation Funded by $3M Annual Grant" (The Defiant 2026-02-23). Custody: locked in the Liquidity Layer, governed by auth contracts (LimitsAuth, RatesAuth, DexFeeAuth). Programmability: none (ranges/fee tiers set by governance). Weakness: the strongest incumbent on "capital does two jobs", but only for the pairs/ranges Fluid governance lists, with funds locked and oracle/liquidation dependence.
- **Ajna** — "non-custodial, peer-to-peer, permissionless lending … no governance or external price feeds"; lenders choose price buckets (order-book-like) (https://github.com/ajna-finance/contracts). TVL $86k. Relevance: bucket = limit order; still deposit-based.
- **Ambient surplus collateral** and **Balancer boosted pools** are weaker cousins (see §3.1).

---

## 4. Custody × programmability × sharing — classification of every product

Axis definitions used below:
- **Custody**: L = locked in protocol contract/pool/vault/L2; V = user-owned vault/NFT/Safe with delegated executor; W = tokens stay in the EOA/Safe until fill (allowance/Permit2 only).
- **Programmability**: 0 = fixed formula; 1 = parametric menu; 2 = pluggable contract (hook/strategy/conditional-order contract you must deploy); 3 = serialized program the maker composes without deploying code (+ custom opcodes if you redeploy a router).
- **Sharing** (can the same unit of capital back several independent strategies simultaneously?): 0 = siloed per pool/position; 1 = partial (one vault/pool serves several pairs, or several orders can over-commit one balance without coordinated accounting); 2 = full (one balance backs N strategies with per-strategy virtual caps, first-fill-wins, auto-reinvest).

| Product | Custody | Prog. | Sharing | Note |
|---|---|---|---|---|
| Uniswap v4 pool | L | 2 (hook) | 0 | ERC-6909 claims only inside PoolManager |
| Bunni v2 | L | 1-2 | 0 | dead |
| Arrakis Pro / HOT | V | 1 | 0 | executor + 2-day timelock |
| Angstrom | L | 0 | 0 | |
| Doppler / Flaunch | L | 1 | 0 | launch products |
| Balancer v3 | L | 2 | 1 | single Vault; hooks can't pull outside liquidity |
| Curve | L | 0 | 0 | |
| Maverick v2 | L | 1 | 0 | |
| Ambient | L | 1 | 1 | surplus collateral across pools in one contract |
| Fluid DEX | L | 0-1 | 1 | collateral+debt double as liquidity |
| EulerSwap | L | 1 | 1 | one cross-collateral vault, many pairs, one operator |
| Aerodrome / Velodrome | L | 0 | 0 | |
| 1inch LOP / Fusion | W | 2 (predicates, getters, interactions) | 1 | many orders can over-commit one balance |
| UniswapX | W | 1 | 1 | Permit2 |
| CoW programmatic orders + hooks | W | 2 (ERC-1271 contract) | 1 | Safe-centric |
| CoW AMM | L | 0 | 0 | |
| Bebop / 0x RFQ / Hashflow (MM side) | W (Bebop/0x) / L (Hashflow, UNCERTAIN) | off-chain only | 2 (off-chain) | permissioned professionals |
| Native Pool → MMs | L | off-chain | 2 (credit) | closest business model |
| Gamma / Steer / Charm / ICHI | L | 1 (Steer 2) | 0 | |
| Aera | V | 2 (constraints) | 0 | |
| Morpho / Yearn vaults | L | 1-2 | 1 | |
| Balmy DCA | L | 1 | 0 | |
| Orbs dTWAP | W | 1 | 1 | |
| Hummingbot | W (keys local) | 3 (Python) | 2 (off-chain) | no on-chain enforcement |
| GMX / Gains | L | 0 | 1 | |
| Definitive | V | 1 | 1 | taker side |
| karpatkey / Safe apps | V | 2 (roles) | 0 | human execution |
| Enzyme | L/V | 1-2 | 0 | |
| Panoptic / Rysk / Thetanuts / Premia / Smilee / IVX | L | 1 | 1 (Panoptic collateral shared within a pool) | |
| Aevo / Derive | L (L2) | 0 | 1 (cross-margin) | |
| Berachain PoL / Olympus / Auto | L | 0 | 0-1 | |
| Ajna | L | 1 | 0 | |
| **Aqua + SwapVM** | **W** | **3** (+2 via custom router) | **2** | virtual balances, pull/push, immutable strategy bytes |

---

## 5. Positioning matrix and the whitespace

Reading the table as a 3-D grid (custody W/V/L × programmability 0-3 × sharing 0-2):

```
                      sharing = 0 (siloed)        sharing = 1 (partial)              sharing = 2 (full)
custody W  prog 0-1   UniswapX, Orbs dTWAP        UniswapX/Orbs (over-commit)         PMM/RFQ MMs (off-chain only)
           prog 2     —                            1inch LOP, CoW programmatic orders  —
           prog 3     —                            —                                   >>> Aqua + SwapVM <<<  (also Hummingbot, but off-chain enforcement only)
custody V  prog 1-2   Arrakis Pro, Aera, kpk, Definitive(taker)   Definitive          —
custody L  prog 0-1   Curve, Aero, Maverick, Ambient, Gamma…       Fluid, EulerSwap, GMX, Morpho, Panoptic, Native Pool   —
           prog 2     Uniswap v4 hooks, Bunni, Yearn, Steer        Balancer v3         —
```

What the grid says:
1. **The W × 3 × 2 cell is empty except Aqua.** The only other things in "sharing = 2" are professional PMMs and Hummingbot users, and their sharing is enforced by nothing but their own off-chain risk engine; their pricing is invisible and permissioned.
2. The **L-row is crowded and shrinking in capital** (Balancer v3 $29M, Bunni dead, Maverick/Ambient/Charm/Gamma single-digit millions). The survivors are either mega-scale (Uniswap v4 $1B TVL, Aerodrome $199M) or lending-backed (Fluid $317M DEX + $749M lending; EulerSwap). The market has already voted that "locked idle LP capital" is a losing product unless it also earns lending yield.
3. **Lending-backed AMMs are the real competitor on capital efficiency** (Fluid: $3.05B/30d on $317M ≈ 9.6x monthly turnover; Aqua: $561M/30d on ~$12M deposited (Aug) ≈ 45x, UNCERTAIN because the Aug deposit figure is stale). They win on "your collateral also LPs"; Aqua wins on "you never deposit". The two can be combined (§7.5).
4. **Intent systems own the taker side; Aqua owns the maker side.** UniswapX/CoW/Fusion/Bebop/0x are all demand rails that need someone's inventory. An Aqua strategy is a *supply* primitive that any of those fillers can hit (§7.6).
5. **Wallet-custody competitors are all "orders"**: LOP/UniswapX/CoW orders have a fixed direction, a fixed max amount, a price that is a function of time or a predicate — no two-sided curve, no `quote()`/`swap()` symmetry, no `push()` reinvest, and (except LOP interactions) no maker-side code at fill time. SwapVM adds curves (XYC/XYCConcentrate/Pegged/Decay), balance transforms (Dutch/Piecewise/TWAP), fee/rate guards, taker gating and Extruction on top of exactly the same custody model.

Whitespace statement for the pitch: *"Aqua is the first venue where a wallet can run many on-chain-enforced market-making programs against the same balance at once, with tokens leaving the wallet only inside the swap that uses them. Everyone else either locks your capital (AMMs, vaults, lending-AMMs, options, PoL) or lets you post one-shot orders (LOP, UniswapX, CoW)."*

Threats / how competitors could close the gap (watch list):
- A Uniswap v4 hook with `beforeSwapReturnDelta` that settles from an EOA via allowance ("JIT-from-wallet hook") gets W-custody for one pool, but still no cross-strategy virtual balances; someone could build an Aqua-like registry for v4 — the registry *is* Aqua's moat only if 1inch keeps the resolver network exclusive and the router/opcode ecosystem grows.
- CoW ComposableCoW could grow AMM-like conditional orders ("CoW AMM from a Safe"): W × 2 × 1 today; would need per-strategy virtual accounting to reach sharing = 2.
- Native could open its Pool to permissionless MMs with on-chain pricing; today pricing is off-chain and LP funds are deposited.
- 1inch's own LOP already covers W × 2 × 1 — Aqua apps should lean on what LOP cannot do (two-sided curves, auto-reinvest, multi-strategy accounting), not compete with it.

---

## 6. Per-category "who wins today" cheat-sheet (for slides)

| Need | Incumbent(s) | Custody cost | What Aqua changes |
|---|---|---|---|
| Deep passive liquidity for majors | Uniswap v4/v3, Curve, Aerodrome, Fluid | locked, idle 85-97% (1inch Dune study, Jul 2026) | same wallet backs many pairs; zero idle |
| Active LP management | Gamma/Steer/Arrakis/Bunni | vault + rebalancer trust; 2 of 4 hacked/dead | strategy immutability + `push` compounding; no rebalancer keys |
| Token issuer market making | Arrakis Pro, MM loans, Native | vault NFT / lend inventory away | issuer keeps inventory, quotes N pairs, revokes with `dock` |
| Capital doing two jobs | EulerSwap, Fluid smart debt | locked in lending layer, liquidation risk | wallet-held yield-bearing tokens quoted in underlying (§7.5) |
| Limit/DCA/TWAP without deposits | 1inch LOP, UniswapX, CoW, Orbs | already wallet-custody | adds curves, tiering, reinvest, shared accounting |
| Options yield on collateral | Panoptic, Rysk, Thetanuts | collateral locked | premium + swap fees on the same wallet collateral (§7.7) |
| DAO treasury liquidity | kpk, Aera, Safe apps | funds move to a vault or a manager gets roles | ship/dock from the Safe; nothing leaves until a fill |
| Emissions for TVL | Berachain PoL, ve(3,3) | locked LP tokens | incentives per *filled volume* (TVU), not per deposited TVL |

---

## 7. Product angles that are impossible or very hard without Aqua (each maps to concrete opcodes/APIs)

1. **One-inventory, N-pair treasury market maker.** A token issuer or DAO ships the *same* USDC balance at 100% to strategies for TOKEN/USDC, ETH/USDC, WBTC/USDC, USDC/USDT (`ship(app, strategy_i, [USDC, X_i], [full, full])` for each i); first fill wins; SLAC ≈ N. In any pool/vault the capital must be split N ways; PMMs do this only off-chain and permissioned. Uses `XYCConcentrateSwap` (0x51) or `PeggedSwap` (0x58) per pair + `FeeFlatIn` (0x70).
2. **Formula A/B testing on identical capital ("strategy ladder").** Ship five strategies on one balance — XYC, three XYCConcentrate widths, PeggedSwap — let resolvers pick the best quote, read `Pulled`/`Pushed` events per `strategyHash`, `dock` the losers. Pools would require 5x capital; vaults give one strategy per vault. This is Bukov's "formula competition instead of TVL competition" made literal.
3. **Concentrated curve + outer limit orders on one balance (Ambient-style knockout, self-custodial).** A custom router (redeployment allowed) combining `LimitSwap` (0x53) strategies at the range edges with `XYCConcentrateSwap` in the middle, all shipped from the same wallet. Ambient does this only inside a single locked contract.
4. **Safe-native DAO liquidity without vaults, curators, or timelocks.** The DAO's Safe `approve`s Aqua once and `ship`s; a Zodiac Roles policy allowing only `ship`/`dock` is sufficient because neither moves tokens; `dock` is an instant, unilateral kill-switch. Compare Aera (guardian + Merkle constraints), Morpho V2 (0-3 week timelocks), Arrakis Pro (2-day timelock, NFT transfer = custody transfer). Deliverable: a Safe App + Roles preset.
5. **Yield-bearing inventory that quotes in the underlying (EulerSwap/Fluid efficiency without depositing into an AMM).** Maker holds aUSDC / sUSDe / any ERC-4626 share in the wallet; the Aqua app `pull`s the share to itself, unwraps, and delivers the underlying to the taker in the same tx; price = curve × `convertToAssets` via `OraclePriceAdjuster` (0xb2) or a custom `0xd0` "4626-rate" instruction; `push` re-wraps. Capital earns lending yield until the block it is used, with no liquidation leg (unlike EulerSwap's borrow) and no governance-listed range (unlike Fluid).
6. **Multi-venue "JIT-from-wallet" filler.** An Aqua app that is simultaneously a Uniswap v4 hook (custom-curve / return-delta), a UniswapX/CoW/Fusion filler, and an Aqua strategy, all drawing from the same maker wallets at fill time. Today fillers need their own inventory per venue; the Lisbon 2026 prize winner did the inverse (clamped SwapVM quotes to a v4 LP position, opcode 0x92), which shows judges like venue bridging.
7. **Options premium and swap fees on the same collateral.** Ship ETH to (a) an AMM strategy and (b) a covered-call strategy: taker `push`es premium in USDC and gains a right, valid for one `ValidateSeriesEpoch` (0x48) epoch, to `pull` ETH at strike (custom opcode enforcing strike/expiry, `Deadline` 0x20). Panoptic/Rysk/Thetanuts all lock collateral per contract; here the same ETH can be hit by either the swap or the exercise, first-come. Fits the Jun-2026 "options-based DeFi" narrative and the 1inch prize text (options explicitly listed).
8. **Lending-as-a-strategy (the inverse of EulerSwap).** Lender ships USDC; a borrower strategy lets a taker `pull` USDC only after `push`ing over-collateral (guard via `OnlyTakerTokenBalanceGte` 0x24 or custom collateral opcode); repayment is a `push` at a rate that drifts with time (`PeggedSwap` bounds or `DutchAuctionBalance` 0x94/95 as an interest curve). Lender never deposits into a pool; the same USDC also backs their AMM strategies. Listed category ("lending") in the 1inch prize.
9. **Keeper-free auto-compounding passive positions.** `push()` reinvests taker payments into the virtual balance, and `Decay` (0x9c, Mooniswap-style virtual balances) makes prices converge after each trade — an arbitrage-damped, self-compounding LP with no rebalancer bot, no vault, no performance fee (Gamma/Steer/Arrakis need keepers + custody).
10. **Tiered pricing per taker on the same inventory (on-chain PMM).** `PrivateOrder` (0x2b) / `WhitelistCoequal`/`Sequential` (0x2c/0x2d) / `OnlyTakerTokenSupplyShareGte` (0x25) gate strategies with tighter spreads for specific resolvers or token holders, wider for everyone else — same balance. Pools give one curve to all; RFQ tiers exist only off-chain.
11. **Compliance-gated liquidity for tokenized stocks/RWAs without a new pool type.** Uniswap needed "Permissioned Pools on v4" (Jul 2026) for tokenized equities; Aqua strategies already gate by `OnlyTxOriginTokenBalanceNonZero` (0x26, any soulbound credential) or whitelist opcodes, and Aqua is live on Robinhood Chain where tokenized-stock hook strategies just did $1B+. The issuer keeps custody of inventory.
12. **DCA / TWAP / Dutch price discovery that never parks funds.** `TWAPSwap` (0x9d) and `DutchAuctionBalanceIn/Out` (0x94/95) in a custom router give Balmy/Orbs/UniswapX-style execution where the maker's capital simultaneously remains available to other strategies. Balmy requires deposit into `DCAHub`; Orbs is single-order.
13. **Agent-operated LP with a ship/dock-only session key.** An AI agent (1inch already advertises "AI-assisted provisioning via 1inch Business MCP") holds a scoped key that may only call `ship`/`dock` (or a Safe Roles permission) — it can reprogram strategies but can never withdraw. Every vault/ALM alternative forces the agent to control custody.
14. **Strategy marketplace / copy-strategy without pooling.** Strategy bytes are immutable and content-addressed (`strategyHash`); a leaderboard of hashes by realised spread lets anyone `ship` the identical program with their own capital. Nested/Enzyme copy-trading requires depositing into the leader's vault.
15. **Multi-market prediction/event AMMs sharing collateral** (Buenos Aires winner precedent: pm-AMM on SwapVM). One USDC balance backs outcome strategies across many markets with `Deadline`/epoch resolution; in pooled designs each market needs its own locked collateral.

---

## 8. Open questions / UNCERTAIN items

- EulerSwap live volume: DefiLlama adapter shows ~$14k/day against $4.34B all-time and euler.finance labels EulerSwap "Coming soon" — either the adapter broke or activity collapsed; verify on-chain before quoting.
- CoW AMM current TVL/volume (no resolvable DefiLlama slug this session).
- Hashflow MM custody (pool contracts vs MM wallets) — background only.
- karpatkey AUM and client list — site 403; numbers from memory.
- Gamma Jan-2024 exploit size — from memory.
- Native's earlier "Aqua" credit-layer branding — not in current docs; do not cite in public materials without checking.
- Aqua's current deposited/committed capital (only the mid-Aug CMC figure $12.2M backing $22.5M is public); the turnover ratio in §5.3 depends on it.
- Panoptic v2 collateral model on Uniswap v4 (news headline only).

---

## 9. Sources (fetched 2026-09-05 unless noted)

DefiLlama: https://api.llama.fi/summary/dexs/uniswap-v4 ; …/dexs/fluid-dex ; …/dexs/eulerswap ; …/dexs/balancer-v3 ; …/dexs/aerodrome-slipstream ; …/dexs/velodrome-v3 ; …/dexs/angstrom ; …/dexs/hashflow ; …/dexs/native ; …/dexs/1inch-aqua ; …/aggregators/1inch ; …/aggregators/cowswap ; …/aggregators/bebop ; …/aggregators/0x-protocol ; https://api.llama.fi/tvl/{uniswap-v4,uniswap-v3,curve-dex,balancer-v3,bunni-v2,ambient,maverick-v2,maverick-protocol,fluid-dex,fluid-lending,aerodrome-slipstream,aerodrome-v1,velodrome-v3,euler,gamma,steer-protocol,charm-finance,ichi,arrakis-finance,arrakis-v2,aera,morpho,yearn-finance,balmy,enzyme-finance,derive-v2,rysk-finance,aevo,smilee-finance,thetanuts-finance,premia-v3,hashflow,native,ajna-protocol}
Docs: https://github.com/euler-xyz/euler-swap ; https://docs.fluid.io/ ; https://docs.fluid.io/integrate/dex-swaps.html ; https://docs.bunni.xyz/docs/v2/overview ; https://docs.bunni.xyz/docs/v2/technical/overview ; https://docs.arrakis.finance/arrakis-pro.md ; https://docs.valantis.xyz/design-space/hot.md ; https://docs.balancer.fi/concepts/vault/ ; https://docs.balancer.fi/concepts/core-concepts/hooks.html ; https://docs.balancer.fi/concepts/explore-available-balancer-pools/boosted-pool.html ; https://docs.mav.xyz/ ; https://docs.ambient.finance/ ; https://angstrom.xyz/ ; https://docs.doppler.lol/ ; https://github.com/whetstoneresearch/doppler ; https://docs.flaunch.gg/ ; https://developers.uniswap.org/docs/liquidity/uniswapx/overview ; https://github.com/1inch/limit-order-protocol ; https://github.com/1inch/cross-chain-swap ; https://docs.cow.fi/cow-protocol/concepts/order-types/programmatic-orders ; https://docs.cow.fi/cow-protocol/concepts/order-types/cow-hooks ; https://github.com/balancer/cow-amm ; https://docs.bebop.xyz/core-concepts/settlement-smart-contracts.md ; https://docs.hashflow.com/ ; https://docs.native.org/native-dev/modules/native-core.md ; https://docs.native.org/native-dev/modules/native-pool.md ; https://docs.native.org/native-dev/products/native-liquidity-provisioning.md ; https://docs.0x.org/ ; https://docs.gamma.xyz/ ; https://docs.gamma.xyz/gamma/lp-vaults/strategies ; https://docs.steer.finance/ ; https://learn.charm.fi/ ; https://docs.ichi.org/ ; https://docs.aera.finance/ ; https://docs.morpho.org/learn/concepts/vault/ ; https://docs.yearn.fi/developers/v3/overview ; https://docs.orbs.network/v3/protocols/dtwap-protocol.md ; https://hummingbot.org/ ; https://docs.gmx.io/docs/intro ; https://docs.definitive.fi/ ; https://docs.enzyme.finance/ ; https://panoptic.xyz/docs/intro ; https://docs.rysk.finance/ ; https://docs.thetanuts.finance/ ; https://www.aevo.xyz/docs/ ; https://docs.derive.xyz/ ; https://docs.premia.blue/ ; https://documentation.ivx.fi/ ; https://docs.berachain.com/learn/pol/ ; https://docs.auto.finance/ ; https://github.com/ajna-finance/contracts ; https://thedefiant.io/news/defi/euler-continues-comeback-with-euler-swap-dex-launch (2025-05-28)
News (Google News RSS headlines): Bunni shutdown (The Block 2025-10-22, CoinDesk 2025-10-23); Balancer exploit (Halborn 2025-11-05; Yahoo 2025-11-27; The Defiant 2026-03-24; Pluang 2026-08-31); Yearn yETH (BeInCrypto 2025-11-30); Aevo Ribbon vaults (CMC 2025-12-15); CoW DNS hijack (TradingView 2026-04-14); Berachain PoL Next (Crypto Briefing 2026-07-08); Uniswap v4 items (GlobeNewswire 2026-07-23; The Defiant 2026-07-10/30; Crypto Briefing 2026-09-03/05; Pluang 2026-09-03; Bitcoinist 2026-09-04; The Defiant 2026-06-25); Panoptic v2 (TradingView 2026-06-15; gen.xyz 2026-09-03); Vitalik options-based DeFi (The Defiant 2026-06-01); Fluid Foundation (The Defiant 2026-02-23); Lido fast swaps via CoWSwap (Crypto Briefing 2026-07-13); Bitget Wallet X solver program (GlobeNewswire 2026-08-05).
Local: `refs/aqua/src/Aqua.sol`, `refs/aqua/src/interfaces/IAqua.sol`, `refs/swap-vm/src/libs/OpcodeList.sol`, `refs/swap-vm/src/opcodes/AquaOpcodes.sol`; sibling KB files `aqua-core.md`, `aqua-positioning.md`, `swapvm-core.md`, `swapvm-instructions.md`, `market-lp-pain.md`.
