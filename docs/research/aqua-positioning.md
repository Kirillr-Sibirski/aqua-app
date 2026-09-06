# How 1inch positions Aqua and SwapVM (public narrative, users, stack integration, hackathon signals)

Compiled 2026-09-05 for the ETHOnline 2026 "Build an Aqua app" track. Sources: the two whitepapers (local PDFs), repo READMEs / PROGRAMS.md, 1inch.com/aqua landing page, 1inch blog (18 Aqua posts, Nov 2025 - Sep 2026), business.1inch.com Aqua docs (~40 pages), press release + CoinDesk/Bitcoin.com coverage, HackenProof, GitHub/npm metadata, and ETHGlobal prize/showcase pages for NY 2026, Lisbon 2026 and ETHOnline 2026. Web search quota was exhausted; X/Twitter, CoinDesk (HTTP 429) and the BeInCrypto Kunz interview (HTTP 403) could not be fetched -- see "Open questions".

---

## 0. TL;DR (decision-relevant)

- **Official one-liner (landing page):** "Shared liquidity to unlock DeFi capital." Docs: "a programmable shared liquidity layer." dApp FAQ: "the shared liquidity layer for self-custodial liquidity provision. One wallet balance can back many positions at the same time, and your tokens stay in your wallet until a swap fills."
- **Three pillars repeated everywhere:** *Shared* (one balance backs many strategies), *Self-custodial* (tokens never leave the wallet; only a revocable ERC-20 allowance), *Permissionless/atomic* (pull + push in one tx). New KPI they push: **TVU (Total Value Unlocked)** instead of TVL, and **SLR / SLAC (Shared Liquidity Ratio / Amplification Coefficient)**.
- **Named target users:** *market makers* (Bukov quote: "Aqua solves liquidity fragmentation for market makers by multiplying effective capital"), *strategy builders / developers* ("Transform DeFi with 100 lines of code"), *protocols / DEXes* ("for any DEX or maker to build upon"), *experienced LPs* ("built for experienced users -- do your own research"). Retail is addressed via the 1inch dApp UI but always with heavy risk disclaimers. DAOs appear only as an example of "unlocked capital" (governance voting while providing liquidity).
- **Status today (Sep 2026):** dev release 2025-11-17 -> v1.0.0 2026-03-27 -> public dApp launch 2026-07-28 with a 10M 1INCH + 500k USDC Merkl incentive program -> **$520M+ cumulative swap volume, ~4,500 open positions, ~600 LPs** (blog, 2026-09-04). Makers are permissionless; **takers are gated** to KYB'd 1inch Resolvers holding a soulbound `KycNFT` (symbol `RES`), checked via `tx.origin`.
- **Stack integration:** Aqua is now a first-class 1inch Business product ("Trading & Liquidity: Swap API, Orderbook API, 1inch Aqua"). Pathfinder (1inch routing engine) routes Aqua strategies, but only "KYC-opcode" strategies and only through resolver flows -- Classic-Swap routing through Aqua is blocked. There is an `aqua` MCP tool (public, read-only) and a hosted `/aqua` API (per-plan).
- **Hackathon signal:** 1inch has run the identical "Build an Aqua App" prize at ETHGlobal New York 2026 ($7k), Lisbon 2026 ($5k+$2k) and now ETHOnline 2026 ($5k+$2k). NY prize text named example apps: **"Leverage AMM, Lending, Options."** Known winners: **ArcBook** (Lisbon 1st: order book of executable curves + custom SwapVM instruction + solver), **KSwap-VM** (Lisbon 3rd: formal semantics/verification of swap-vm in K), **Ballast** (NY 4th: leveraged, Chainlink-anchored AMM via two custom opcodes). Natural-language-to-bytecode composers (Aquapilot, Sluice) did not place.

---

## 1. Timeline (dated facts)

| Date | Event | Source |
|---|---|---|
| 2025-10-27 | `1inch/aqua` repo created | GitHub API |
| 2025-11-13 | `1inch/swap-vm` repo created | GitHub API |
| 2025-11-17 | Press release "1inch Launches Aqua: The First Shared Liquidity Protocol, Now Available for Developers" (Road Town, BVI). Dev-preview contracts: Aqua `0x499943e74fb0ce105688beee8ef2abec5d936d31`, SwapVM `0x8fdd04dbf6111437b44bbca99c28882434e0958f`. Bounties up to $100k. Front-end promised "Q1 2026". `@1inch/aqua-sdk` 0.1.0 published. HackenProof "1inch Aqua" program starts. CoinDesk: "1inch launches Aqua, a protocol letting multiple DeFi strategies share the same capital." | news.bitcoin.com, 1inch blog, npm, HackenProof, CoinDesk URL |
| 2025-11-20 | `1inch/swap-vm-template` repo created | GitHub API |
| 2026-02-04 | Blog "LP efficiency loss: why fragmented crypto liquidity earns less and what Aqua changes" ("83% to 95% of liquidity in major pools sits idle ... roughly $12 bln") | 1inch blog |
| 2026-03-27 | `aqua` v1.0.0 and `swap-vm` v1.0.0 ("SwapVM with XYC, XYCConcentrate and PeggedSwap AMMs"); whitepaper PDFs replace dev-preview markdown | GitHub releases |
| 2026-06-12..14 | ETHGlobal New York 2026: "Build an Aqua App" $7,000 (4 places). Workshop "Reimagining the AMM with 1inch Aqua" (Tanner Moore). | ethglobal.com |
| 2026-06-16 | swap-vm v1.0.1: PeggedSwap `linearWidth` cap 5000e27; "KYC check by tx.origin with a new instruction in Controls" (`_onlyTxOriginTokenBalanceNonZero`) | GitHub releases |
| 2026-07-17 | "Universal redeployment" of registry+router on 13 chains incl. Robinhood Chain (4663); aggregation executors redeployed | docs changelog |
| 2026-07-19 / 07-26 | Vanity redeployment: Aqua registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` (ETH block 25567141), AquaSwapVMRouter v1.0.2 `0x111111338c5091e8440b67b168bae16a668ac0de` (block 25618917). Deployed with plain `CREATE` from EOA, not CREATE2. | docs changelog / contract-addresses |
| 2026-07-23 | Blog: Dune research "85% of concentrated liquidity on DEXs is underutilized" ($1.6B of $1.84B tracked idle; ~$542M fully out of range; LPs forgo $185-195M/yr fees) | 1inch blog |
| 2026-07-24..26 | ETHGlobal Lisbon 2026: "Build an Aqua App" $5,000 + Continuity $2,000. Winners: ArcBook (1st), KSwap-VM (3rd). | ethglobal.com |
| 2026-07-28 | **Public launch**: "1inch Aqua launches as a shared liquidity layer" + "1inch Network launches an incentive program for Aqua via Merkl" (10M 1INCH + 500k USDC). dApp at 1inch.com/aqua. | 1inch blog |
| 2026-07-29 | swap-vm v1.0.2: "improved Aqua protocol-fee handling for amountIn settlement edge cases", `ProtocolFeeSkipped` event; SDKs `@1inch/aqua-sdk` 0.3.0 / `@1inch/swap-vm-sdk` 0.4.0 carry vanity addresses | GitHub releases, docs changelog |
| 2026-08-19 | Blog "1inch Aqua security: 8 independent audits, all public" (~190 findings total, all criticals fixed pre-launch) | 1inch blog |
| 2026-08-27 | Blog "How Aqua protects your liquidity position from traditional JIT fee-sniping" | 1inch blog |
| 2026-09-04 | Blog "$500 mln in swaps: 1inch Aqua's new milestone" (>$520M volume, ~4,500 open positions, ~600 LPs). `@1inch/aqua-sdk` 0.3.2-rc.0. | 1inch blog, npm |
| 2026-09-04..16 | ETHOnline 2026 "Build an Aqua App" $5,000 + Continuity $2,000 | ethglobal.com |

---

## 2. Official vocabulary (use these words in the submission)

From the Aqua whitepaper Appendix A ("Terms and definitions"), README, docs glossary and FAQ:

| Term | Official meaning | Where |
|---|---|---|
| **Aqua / Aqua registry** | "Shared liquidity layer" contract; "virtual accounting system that tracks liquidity allowances without taking custody". Holds zero tokens. | WP §3, docs |
| **Aqua Application / AquaApp** | "A smart contract that implements trading strategy logic and interacts with the Aqua protocol." Base contract `AquaApp` (reentrancy lock per (maker, strategyHash), `_safeCheckAquaPush`). The deployed `AquaSwapVMRouter` is itself an AquaApp. | WP App. A, README |
| **Strategy** | "An on-chain object registered via `ship()`, identified by `strategyHash = keccak256(strategy)`"; ABI-encoded opaque bytes; **immutable once shipped**. In the dApp it is called a **position** ("Is a position the same as a strategy? Yes"). | README, FAQ |
| **Strategy builders** | "Developers or teams who design and implement trading Strategies on top of Aqua ... focus on pricing logic, execution algorithms and risk management." | WP App. A |
| **Maker** | "A participant who provides liquidity or quotes (prices) to the market ... In Aqua, a Maker is an LP whose balances are shared across Strategies via virtual provisioning." | WP App. A |
| **Taker** | "A participant who consumes liquidity at the prices offered by Makers." Today: KYB'd 1inch Resolvers holding `KycNFT`. | WP App. A, docs |
| **Resolver** | 1inch's term for KYB-verified professional fillers of Fusion / Fusion+ / Limit orders; for Aqua, "the Aqua resolver NFT" (`KycNFT`, symbol `RES`) is minted to resolver operator EOAs. | docs resolvers, access page |
| **ship() / dock()** | "ship() to allocate balances to a Strategy, and dock() to revoke them"; "activate is pure configuration"; "dock() instantly revokes virtual balances without moving funds". Re-parameterize = dock + ship. | WP §3, README |
| **pull() / push()** | Swap-execution-only accounting: pull decreases virtual balance and `transferFrom(maker -> to)`; push increases it and `transferFrom(msg.sender -> maker)`. "any tokens an AMM receives through trading automatically become available for reinvestment" (auto-compounding). | WP §3, Aqua.sol |
| **Virtual balance** | "an internal counter that represents a claim against the maker's existing ERC-20 allowance"; mapping `balances[maker][app][strategyHash][token]`. | docs core-concepts |
| **Shared liquidity** | "the same tokens in your wallet can back many positions at the same time, instead of being split across separate pools." Explicitly **"not leverage"**. | FAQ |
| **Self-custodial** | "Tokens remain in your wallet and under your control until position conditions are met." | landing page |
| **SLAC / SLR** | Whitepaper: *Shared Liquidity Amplification Coefficient* = total liquidity provisioned across strategies / wallet equity (>= 1). Docs/FAQ rename it *Shared Liquidity Ratio*; analytics page also defines a turnover variant SLR = V/C (swap flow / committed inventory). | WP §4.1, docs |
| **TVU** | "Total Value Unlocked" -- the metric 1inch proposes instead of TVL; landing page shows a "Total value unlocked" counter. | blog, landing |
| **Capital efficiency vs. Utility efficiency** | Capital efficiency = notional liquidity per unit of wallet equity; utility efficiency = "how many independent 'uses' the same assets can serve" (money-market collateral, governance voting, staking) while also backing strategies. | WP App. A |
| **SwapVM** | "the engine that powers 1inch Aqua. Each position is an immutable, hash-addressed config that SwapVM executes"; "A virtual machine for programmable token swaps"; "Programmable AMM ... an alternative to Uniswap v4 hooks and Algebra plugins." | FAQ, README, glossary |
| **Program / opcode / instruction** | Program = byte sequence `[opcode:1][argsLen:1][args]`; instruction signature `function _x(Context memory ctx, bytes calldata args) internal`. | SwapVM WP §3.2, docs |
| **Extruction** | "An opcode delegating pricing to an external non-upgradeable contract" (`IExtruction` / `IStaticExtruction`). | glossary |
| **Fair vs. unfair volume** | WP §4.3: fair = flow won on price via aggregators; unfair = flow that comes "without price optimization for takers"; "there are only fair volumes and unfair volumes -- and both can be highly profitable with proper capital utilization." Rejects the "toxic flow" framing. | WP §4.3 |
| **JIT fee-sniping** | Blog term for just-in-time liquidity bots; Aqua "removes the shared fee position" because each strategy belongs to one LP. | blog 2026-08-27 |

---

## 3. The problems 1inch says Aqua solves (with their numbers)

Whitepaper abstract (verbatim): "Aqua is an LP-centric shared liquidity layer protocol addressing fundamental AMM inefficiencies: locked LP capital sitting idle 90% of the time, capital fragmentation across pairs and protocols, and inability to utilize assets elsewhere in DeFi. To solve these problems, Aqua is built on two principles: capital remains in LP wallets while the same assets back multiple trading strategies simultaneously."

Three named problems (WP §2):
1. **Idle liquidity.** "for 90% of days in 2025, 94% of liquidity in Uniswap v2 pools remained unutilized, along with 85% in Uniswap v3 pools, 84% in Uniswap v4, 83% in Curve pools, 89% in PancakeSwap, and 97% in Balancer pools" (source: https://dune.com/1inch/idle). Later blog (Feb 2026): "83% to 95% ... roughly $12 bln". Dune study (Jul 2026, Uni v3/v4, Pancake v3, Aerodrome Slipstream, 7 chains, Jan-Jun 2026): 29.5% of capital out of range on average, ~$542M fully idle, LPs forgo $185-195M/yr.
2. **Fragmentation** across protocols, pairs, fee tiers and price ranges: "LPs face constant allocation decisions between providing depth in established markets or supporting new opportunities, but never achieving both with the same capital."
3. **DeFi-disabled capital**: pool deposits cannot vote in DAOs, be money-market collateral, or earn staking rewards -- "LPs face a binary choice."

Claimed effects:
- **Multiplicative amplification** (WP §4.1): $1,000 -> 3x leverage via money markets ($3,000 collateral / $2,000 debt) -> provisioned to 3 Aqua strategies = "$9,000 USD of notional liquidity exposure from 1,000 USD of initial equity -- a 9x amplification."
- **"Transforming arbitrage from toxic flow to profitable volume"**: higher utilization means aggregate fees can exceed impermanent loss; "Aqua transforms [AMMs] into efficient spread machines."
- **Specialization over homogenization** (WP §4.2): Aqua deliberately accepts O(n) taker complexity (many small maker-specific AMMs) instead of O(1) pooled swaps, because "DEX aggregators and sophisticated solvers already maintain off-chain indexing systems." "This shifts the competitive landscape from capital accumulation to intellectual property creation ... A breakthrough strategy can go from zero to significant liquidity in minutes, not months."
- **JIT-proof by design** (blog): a "2025 academic study ... found that strategically deployed JIT liquidity could reduce passive LP profits by up to 44%"; in Aqua "an external LP cannot add liquidity to somebody else's Aqua strategy immediately before a swap."
- **LVR awareness** (blog "Risk management for LPs"): "When one asset doubles in price: ~5.7% underperformance vs. holding; fivefold: ~25%" -- fees must compensate.

Explicitly NOT claimed: no guaranteed yield ("Swap fees are not guaranteed"), does not eliminate impermanent loss, market or smart-contract risk. Docs even warn admin keys are still EOAs ("multisig migration proposed but not executed").

---

## 4. Target users named by 1inch

| Segment | Evidence |
|---|---|
| **Professional market makers / PMMs** | Bukov (press release): "Aqua solves liquidity fragmentation for market makers by multiplying effective capital. From now on, the only limit to your capital efficiency is your strategy." Business docs: Aqua serves "market makers and apps building on shared liquidity." WP §3: "the protocol extends seamlessly to Professional Market Maker strategies ... convenient balance accounting ... auditable trail." Resolver onboarding asks for "trading track record and monthly volumes, chains and indicative inventory." |
| **Strategy builders / developers** | Landing page CTA "Build with the 1inch Aqua Protocol", "Transform DeFi with 100 lines of code", "Simplified DX: No need to code deposit/withdrawal logic. Query and execute directly." Press release: "Build from scratch or plug-and-play ... use the SwapVM partner protocol to assemble strategies from the library of instructions." Docs list four archetypes: first-time deployers, protocol learners, strategy authors, router/aggregator operators. |
| **Protocols / DEXes** | Glossary: "Aqua functions as a self-custodial shared liquidity layer for any DEX or maker to build upon." WP §4.2: "For builders, Aqua fundamentally changes the basis of competition ... from TVL acquisition to formula and strategy innovation." |
| **Experienced LPs (via dApp)** | Launch post: "Aqua involves risk, including loss of funds. It's built for experienced users -- do your own research." Position types in UI: full range, concentrated ("Straight"), pegged ("Curved"); guides on "Aave collateral loops". |
| **Agentic / headless LPs** | Docs "Automate & Agentic Liquidity": "headless and agent-driven liquidity provisioning ... keeper strategies: automated re-shipping on illiquidity; LP fees auto-compound via `Pushed` events"; public `aqua` MCP tool. |
| **Takers = resolvers / arbitrage bots** | Launch post: "Every swap executed by verified counterparties (market makers or arbitrage bots)". Taker access "not yet part of the self-service flow" -- email csm@1inch.com. |
| DAOs | Only as an example of utility efficiency (governance voting while LPing); the 1inch DAO funds the 500k USDC incentive boost. Not a named builder segment. |

---

## 5. Product surfaces that exist today

- **Landing page** https://1inch.com/aqua (1inch.io redirects to 1inch.com): headings "Shared liquidity to unlock DeFi capital", "Total value unlocked", "Shared / Self-custodial / Permissionless", "Open architecture to transform liquidity provision" (Shared liquidity, Capital efficiency, Self-custody, Simplified DX), "Transform DeFi with 100 lines of code", "Developer access now live. UI launching in 2026", "bounties up to $100k". CTAs: Build now / Explore protocol / Use SDK / Read whitepaper (`/assets/1inch-aqua-white-paper.pdf`).
- **dApp** (Aqua tab in the 1inch app, live since 2026-07-28): `/aqua/overview`, `/aqua/overview/create`, `/aqua/incentives`, `/aqua/leaderboard`, `/aqua/learn`. Learn page: "One balance. Many positions", "Protection from JIT fee sniping", "Verified counterparties through 1inch Resolvers", "Keep the auto fee, pick a preset or set a custom one", guides incl. "Aave collateral loops", 4 short videos. Position shapes: full range, concentrated (incl. single-sided), pegged. Fees auto-reinvest; positions immutable (close + recreate to change).
- **Docs** https://business.1inch.com/portal/documentation/aqua/overview (redirect target of docs.1inch.io). Sections: Overview (glossary, capability status, changelog), Getting started (build-an-aquaapp, worked-examples, strategy-template, automate-and-agentic-liquidity, liquidity-provider-and-taker-guide), Liquidity layer (core-concepts, strategy, virtual-balances, strategy-lifecycle, access-resolvers-and-pathfinder, supported-chains, risks-and-disclosures), SwapVM (swapvm-engine, program-model, swapvm-vs-uniswap-v4-hooks-vs-algebra, instruction-set-overview, opcode-gallery, write-your-own-opcode, aqua-router-opcodes/*, modifiers-limit-order-fusion-router/*, limit-order-fusion-opcodes/*, patterns/*), Reference (smart-contract, events-and-interfaces, encoding-reference, contract-addresses, verified-contract-addresses, data-and-analytics, sdk-overview, debug), Help (aqua-faq, swapvm-faq).
- **SDKs** (monorepo https://github.com/1inch/sdks): `@1inch/aqua-sdk` (ship/dock calldata, event parsing; latest 0.3.1, 0.3.2-rc.0 on 2026-09-04), `@1inch/swap-vm-sdk` (0.4.0; `Order`, `MakerTraits`, `TakerTraits`, `AquaProgramBuilder` pre-wired to `aquaInstructions`, generic `ProgramBuilder(ixsSet)` for **custom opcode tables**, strategies `AquaXYCAmmStrategy.new()/.newConcentrate()`, `AquaPeggedAmmStrategy`). Rust/Python SDKs "planned".
- **Template** https://github.com/1inch/swap-vm-template (Hardhat; `contracts/AquaAMM.sol` extends `AquaOpcodes`, `buildProgram(maker, tokenA, tokenB, feeBpsIn, sqrtPriceMin, sqrtPriceMax, decayPeriod, protocolFeeBpsIn, feeReceiver, salt, deadline)` composing deadline -> aquaProtocolFee -> flatFee -> decay -> concentrate|xyc -> salt; `MockTaker`; deploy script deploys Aqua + AquaSwapVMRouter). Listed as a hackathon resource.
- **MCP tool `aqua`** (public, no auth): `maker_stats`, `list_maker_strategies`, `strategy_overview`, `strategy_activity`, `strategy_volume`, `list_opened` (cross-chain feed of open strategies, filter by app). Hosted `/aqua` API is per-plan ("keys without it get 404 on /aqua"); hosted APIs/MCP/x402 are "KYB/KYC-gated, payable products under 1inch Business".
- **Workshops**: "The Art of AMM - Workshop by Anton Bukov" (1inch YouTube, https://www.youtube.com/watch?v=bdhba23BEzg); "Reimagining the AMM with 1inch Aqua | Tanner Moore" (ETHGlobal YouTube, https://www.youtube.com/watch?v=VrtWeUR3Vq4; slides https://docs.google.com/presentation/d/1qA9l8lMKBG-Jd9-wVgmM7jOLE8hxaB0e). Content not fetched (UNCERTAIN); watch before the demo.
- **Incentives** (Merkl, from 2026-07-28, 3 months): 5M 1INCH direct volume rewards + 5M 1INCH partner co-incentives + 500k USDC DAO boost; 80+ Ethereum markets pairing 1INCH with ETH/LSTs (35%), stablecoins (30%), BTC wrappers (15%), DeFi majors (14%), RWAs; also Robinhood Chain and BNB Chain; distribution 50/30/20 by month.

---

## 6. How Aqua plugs into the rest of 1inch (aggregator, Fusion, resolvers)

- **Aqua is positioned as a peer product, not a routing detail.** Business docs "Products at a glance" -> Trading & Liquidity: Swap API ("best-execution swaps"), Orderbook API ("limit orders and RFQ"), 1inch Aqua ("programmable shared liquidity and SwapVM").
- **Taker gate.** Docs (access-resolvers-and-pathfinder): "Aqua is live and routable: permitted takers hold `KycNFT` credentials and fills execute on-chain." Gate = Controls opcode `_onlyTxOriginTokenBalanceNonZero(KycNFT)` (reverts `TxOriginTokenBalanceIsZero`), prepended by the dApp's program assembler via `withTxOriginAccessToken(aquaKycToken)`. Because it reads `tx.origin`, "smart-contract wallets, multisigs, and ERC-4337 bundlers cannot satisfy the gate." KycNFT address `0x26FFc7D378E8e49Be2c483295A3e3E511F96a468` on all 13 chains. Makers who ship directly via SDK may omit the gate ("Permissionless pools by removing credential token requirements" -- strategy-template page).
- **Pathfinder.** The 1inch routing engine has (a) an off-chain maker blacklist and (b) a "KYC-routing gate that routes only KYC-opcode Aqua strategies and blocks Classic-Swap routing through Aqua". Practical reading: Aqua liquidity reaches 1inch users through resolver-executed fills (Fusion-style intents), not through user-signed Classic Swap txs. The analytics page warns about "double-counting when a single user swap routes through both Aqua and the aggregation layer" and offers "Rule B: Scope Aqua fills to resolver-executed transactions only" -- confirming resolver-executed Aqua fills are the norm. (UNCERTAIN: exact share of Aqua volume from Fusion vs. direct resolver arbitrage.)
- **Resolver onboarding**: Business Portal KYB (covers Limit Order, Fusion, Fusion+) then email csm@1inch.com "Aqua resolver NFT request" with track record, volumes, chains, inventory, operator EOA(s), key management. "Taker access to 1inch Aqua is not yet part of this self-service flow."
- **No matching layer inside Aqua**: "Aqua performs no off-chain price discovery, no CoW/order matching, and no multi-order aggregation. Solvers must implement their own discovery and routing logic." (This is exactly the gap ArcBook's solver filled.)
- **Fusion/Limit-order opcodes exist in SwapVM but are not on the Aqua router**: docs organize opcodes into "Aqua-router opcodes" vs "Limit Order / Fusion router" opcodes (invalidators, limitSwap, twap, dutchAuction, minRate, oraclePriceAdjuster, baseFeeAdjuster). PROGRAMS.md: "1inch production integrations (including AggregationRouter flows) will use only a strict, predefined subset of SwapVM programs with tightly bounded parameter ranges." SDK README: "After the Fusaka Ethereum hardfork, a full SwapVM deployment is planned."
- **1inch app**: yes, there is an Aqua tab (`/aqua`) alongside Swap/Trade/Limit/Terminal/Portfolio.

---

## 7. Adoption metrics published

- Volume: "More than $500 mln in swap volume" (>$520M at publication, 2026-09-04); "Every fill came directly from liquidity providers' wallets."
- ~4,500 open positions, "nearly 600 liquidity providers" (same post).
- HackenProof Aqua program: 579 submissions, $21,800 paid, 262 active hackers (as of 2026-08-07).
- GitHub: aqua 107 stars, swap-vm 36 stars, sdks 58 stars (2026-09-05).
- Chains: 13 in docs/FAQ (Ethereum, Arbitrum, Base, Optimism, Polygon, BNB, Avalanche, Gnosis, zkSync Era, Linea, Unichain, Sonic, Robinhood Chain); README/SDK tables list 16 (adds Cronos 25, Monad 143, HyperEVM 999). Sepolia testnet also live.
- No published TVU/SLR aggregate numbers found beyond the landing-page counter (UNCERTAIN).

---

## 8. Deployed contracts and the runtime opcode set (for scoping the build)

- Aqua registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`; AquaSwapVMRouter v1.0.2 `0x111111338c5091e8440b67b168bae16a668ac0de` (EIP-712 domain `1inch SwapVM v1.0` / `1.0.2`; `quote` selector `0x44aa5f14`, `swap` `0xf4d2d412`); KycNFT `0x26FFc7D378E8e49Be2c483295A3e3E511F96a468`; owner EOA `0x4134e66d52EfC4C77DD8Ccc952D87b9E92E0C352`. README: "Only interact with these two contracts. Anything else is not Aqua."
- Registry API (`src/interfaces/IAqua.sol`, `src/Aqua.sol`):
  ```solidity
  function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts) external returns (bytes32 strategyHash);
  function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;
  function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external;   // msg.sender == app
  function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount) external;
  function rawBalances(address maker, address app, bytes32 strategyHash, address token) external view returns (uint248 balance, uint8 tokensCount);
  function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) external view returns (uint256, uint256);
  ```
  Events `Shipped`, `Docked`, `Pulled`, `Pushed` (registry) and `Swapped(orderHash, maker, taker, tokenIn, tokenOut, amountIn, amountOut)` (router). Volume attribution: `Swapped.orderHash == Shipped.strategyHash`.
- **Aqua router opcode table (docs opcode-gallery, decimal index):** 10 `_jump`, 11 `_jumpIfTokenIn`, 12 `_jumpIfTokenOut`, 13 `_deadline`, 14 `_onlyTakerTokenBalanceNonZero`, 15 `_onlyTakerTokenBalanceGte`, 16 `_onlyTakerTokenSupplyShareGte`, 17 `_xycSwapXD`, 18 `_xycConcentrateGrowLiquidity2D`, 19 `_decayXD`, 20 `_salt`, 21 `_flatFeeAmountInXD`, 27 `_protocolFeeAmountInXD`, 28 `_aquaProtocolFeeAmountInXD`, 29 `_dynamicProtocolFeeAmountInXD`, 30 `_aquaDynamicProtocolFeeAmountInXD`, 31 `_peggedSwapGrowPriceRange2D`, 32 `_extruction`, 33 `_onlyTxOriginTokenBalanceNonZero`. Indices 0-9 and 22-26 are no-ops. Local `src/opcodes/AquaOpcodes.sol` matches (dispatcher lists exactly these 16 instructions + Jump). Fee scale `1e9 = 100%` (0.30% = 3,000,000). Canonical strategy bytes in docs: `0x21 0x14 <KycNFT> | 0x11 0x00` = gate + XYC.
- Full `Opcodes.sol` (not deployed on the Aqua router) additionally has: Stop, Revert, JumpIfDirection, StaticBalances, DynamicBalances, InvalidateBit/TokenIn/TokenOut, LimitSwap, LimitSwapFullAmount, RequireMinRate, AdjustMinRate, DutchAuctionBalanceIn/Out, BaseFeeAdjuster, TWAPSwap, FeeFlatOut, ValidateSeriesEpoch, PrivateOrder, WhitelistCoequal/Sequential, PiecewiseLinearScaleBalanceIn/Out, OraclePriceAdjuster (`src/opcodes/Opcodes.sol`). Repo HEAD commit `f09a41e` "remove-progressive-fees".
- Extruction target interface (docs + `src/instructions/Extruction.sol`):
  ```solidity
  function extruction(bool isStaticContext, uint256 nextPC, SwapQuery calldata query, SwapRegisters calldata swap, bytes calldata args, bytes calldata takerData)
      external [view] returns (uint256 updatedNextPC, uint256 choppedLength, SwapRegisters memory updatedSwap);
  ```
  Must be deterministic, non-upgradeable, identical in quote and swap. NatSpec: guard with `RequireMinRate`/`AdjustMinRate` before it; "Execution of the opcode multiple times in strategy flow may lead to quote / swap divergence."
- Three sanctioned authoring paths (docs build-an-aquaapp): **Path A** custom `AquaApp` contract; **Path B** compose deployed opcodes (no contract); **Path C** Extruction. Plus the hackathon-only fourth path: **redeploy a modified router with new opcodes** (docs write-your-own-opcode: append to `_runOpcode` and `_opcodes()` at the same index; `via_ir`, solc 0.8.30, Cancun; EIP-170 budget).
- Instruction ordering is "security-critical". UNCERTAIN discrepancy: whitepaper Fig. 2 / SDK examples order `concentrate -> flatFee -> xycSwap` ("flat fee is placed after concentration so that the retained fee amount grows liquidity correctly"), whereas `swap-vm-template/AquaAMM.buildProgram` orders `flatFee -> decay -> concentrate|xyc`. Follow the SDK (`AquaXYCAmmStrategy`) and test with `CoreInvariants`.

---

## 9. Roadmap / capability status (docs "capability-status", changelog, SDK notes)

- Available: maker `ship()/dock()` permissionless on 13 chains; SDK strategy building; deployed opcode set "Controls, XYCSwap, XYCConcentrate, Decay, Fee, PeggedSwap, Extruction".
- Gated: taker `swap()` (KycNFT, default-deny); smart-account/4337 takers **not supported**.
- Not on the Aqua router: experimental fees (`FeeExperimental.sol`: `_flatFeeAmountOutXD`, `_progressiveFeeIn/OutXD`, `_protocolFeeAmountOutXD`), limit/Fusion opcodes. "In v1 only the LP swap fee is non-zero; protocol fees are 0."
- Planned: full SwapVM deployment "after the Fusaka Ethereum hardfork" (SDK README); multisig migration for admin keys "proposed but not executed"; Rust/Python SDKs; "Future automated strategies could operate on top of shared liquidity infrastructure" (blog on vaults). Earlier promise of "Q1 2026 frontend" slipped to 2026-07-28.
- "Strategy bytecode is not portable across router versions due to opcode table changes."

---

## 10. Security posture and bounty (what "quality" means to them)

- 8 audits of "Aqua contracts, SwapVM engine, and supporting libraries": OpenZeppelin, Bailsec, Hexens, Nethermind, Theori, Decurity, Hashlock, MixBytes; ~190 findings; reports at https://github.com/1inch/1inch-audits/tree/master/Aqua%20and%20SwapVM%20v1 (files `Aqua_SwapVM_v1_<Firm>.pdf`).
- HackenProof "1inch Aqua" (https://hackenproof.com/programs/1inch-aqua): scope repos aqua, swap-vm, solidity-utils; Critical $20k-$100k, High $5k-$20k, Medium $2k-$5k, Low $100-$2k; **improvement proposals up to $25k** for "accounting/invariant correctness, MEV/price-manipulation resistance, security hardening, gas >= 1k"; "AI-generated reports will not be considered."
- SwapVM's 7 core invariants (WP §4, README): Exact In/Out Symmetry; Swap Additivity (prefer subadditive); Quote/Swap Consistency ("Essential for MEV protection"); Price Monotonicity; Rounding Favors Maker (amountIn ceil, amountOut floor); Balance Sufficiency; Strategy Liveness. Reusable test base `test/invariants/CoreInvariants.t.sol` (`assertAllInvariantsWithConfig`).
- PROGRAMS.md recommendations to program authors: "Provide analytical proof (or strong formal/empirical evidence) of model stability; public notes or papers are encouraged. Constrain dangerous parameter ranges in instruction builders ... Provide a thorough composition guide when your design supports multiple instruction-order variants." "Thorough testing and audit are mandatory for every program before production use."
- Whitepaper: "this design supports formal verification of SwapVM programs and facilitates the development of ZK provers and verifiers for them."

---

## 11. Hackathon track history (the strongest evidence of judge taste)

### Prize text (identical across NY, Lisbon, ETHOnline 2026)
"Create a custom Aqua app that implements a sophisticated DeFi position. If you use SwapVM, you may modify SwapVM opcodes and define your own instructions. The final positions must be demonstrated through tests, scripts or UI." Judging: "Projects that utilize SwapVM will be scored higher during the final judging." Qualification: official Aqua/SwapVM contracts (modified SwapVM redeployments allowed); on-chain token transfers in the demo (local forks ok); proper git history ("no single-commit final-day submissions"). NY page listed example apps verbatim: **"Leverage AMM Lending Options"**. Resources: aqua, sdks/typescript/aqua, swap-vm (whitepaper at `release/1.1` branch), swap-vm-template, Bukov's "The Art of AMM" video, Tanner Moore's slides.

### ETHGlobal New York 2026 (Jun 12-14) -- $7,000, 4 places
- **Ballast** -- 4th place. "leveraged, oracle-anchored liquidity on 1inch Aqua." Two custom opcodes: a **leverage opcode** ("quotes prices as though the pool holds multiplied capital ... safety mechanism preventing quotes exceeding actual token holdings") and an **oracle anchor opcode** (reads Chainlink ETH/USD in-swap with decimals + stale-price rejection; "capping trades at fair market value"). Foundry, mainnet fork, 17 tests; demo showed anchor cut an arb from ~11.9 ETH to 5.94 ETH. https://github.com/mcmoodoo/Ballast
- Smile (options market using SwapVM "for volatility surface market-making" + Aqua for cross-strike liquidity + Chainlink CRE + Uniswap hooks) won a Uniswap prize, not 1inch. 1st-3rd 1inch winners not identified (UNCERTAIN; showcase pages 1-2 show only Ballast with a 1inch label).

### ETHGlobal Lisbon 2026 (Jul 24-26) -- $5,000 + $2,000 continuity
- **ArcBook** -- 1st place (also Graph 2nd, ETHGlobal finalist). "An onchain order book where makers publish executable curves instead of fixed-price orders." Each maker position is a bounded pricing curve (inventory, price range, alpha distribution parameter); **custom SwapVM instruction for exact-in/exact-out fills and inventory recycling**; Aqua as settlement/shared-liquidity layer; subgraph indexes positions; **deterministic solver routes across multiple makers with atomic settlement** (Base Sepolia); Python reference model for tests. https://github.com/Ryad2/liquid_OB
- **KSwap-VM** -- 3rd place. "A formal semantics for 1inch's swap-vm, and formal verification for its modules." Kontrol/KEVM/K symbolic execution of instruction property tests ("uncovered bugs reported accordingly") + K semantics for composite programs + a custom app "sweeper". https://github.com/vovunku/swap-vm-verified
- Did not place: **Aquapilot** ("first SwapVM strategy composer: a sentence in, validated bytecode out"; TS port of the encoder, golden-fixture tests) and **Sluice** (NL -> Aqua strategies inferred in a 0G TEE, 4 templates, subgraph). Both are UX/tooling wrappers over existing opcodes.
- 2nd place not identified (UNCERTAIN).

### ETHOnline 2026 (Sep 4-16) -- $5,000 + $2,000 continuity; Cannes 2026 had no 1inch sponsorship. No 1inch workshop found on the ETHOnline schedule page (404) -- UNCERTAIN.

---

## 12. What 1inch engineers publicly value (evidence)

1. **Capital efficiency, quantified.** SLAC/SLR, the 9x example, "unlimited capital efficiency", TVU vs TVL. They like numbers (Dune dashboards, worked examples with exact `ceilDiv` arithmetic).
2. **Formula / curve innovation over TVL games.** WP: "transforms TVL competition into formula and strategy innovation"; "specialized approaches for different market conditions and asset classes"; "thousands of small, specialized AMMs".
3. **Composability of instructions** and "canonical instruction ordering" -- they think in programs, invariants and conservation laws (`pool_balance + protocol_fee = initial_balance + total_amountIn`).
4. **MEV / manipulation resistance**: `_decayXD` (Mooniswap heritage), quote/swap consistency, JIT immunity, oracle anchoring (Ballast), bounty category "MEV and price-manipulation resistance".
5. **Correctness culture**: 7 invariants, `CoreInvariants` harness, 8 audits, formal verification praised (KSwap-VM placed with zero product UI), "AI-generated reports will not be considered".
6. **Self-custody and immutability** as design principles ("Out of the Tar Pit" cited in README).
7. **Utility efficiency**: same tokens as money-market collateral / governance / staking while LPing; the dApp's own "Aave collateral loops" guide.
8. **Aggregator-native thinking**: takers are solvers; discovery is off-chain; a solver/route-selector is a first-class pattern (Best Route Selector via Extruction).
9. **Gas efficiency** ("Maximize gas efficiency" is a stated SwapVM requirement; bounty pays for >= 1k gas).
10. **Agentic/keeper automation** on top of ship/dock (docs section + MCP tool) -- but pure NL-to-bytecode UX did not win prizes.

---

## 13. What would impress the 1inch team (evidence-based checklist)

Ranked by strength of evidence:

1. **Use SwapVM and add real new opcodes in a redeployed router** (prize text says SwapVM scores higher; all three known winners shipped custom instructions or verified them). Implement `function _myIx(Context memory ctx, bytes calldata args) internal`, append it to `_runOpcode`/`_opcodes()` in a router inheriting `SwapVM` + your opcode contract, and build programs with `ProgramBuilder`/a TS `ProgramBuilder(customIxsSet)`. Keep the official Aqua registry at `0x1111113ccf...` as the balance layer (qualification rule) and ship strategies with `useAquaInsteadOfSignature = true`.
2. **Pick a position in the category they named -- Leverage AMM, Lending, Options -- or an equally "sophisticated DeFi position"** (their words). Ballast (leverage + oracle anchor) and ArcBook (executable-curve order book + solver) are the reference points. A mechanism that makes the same wallet balance serve two roles (e.g., LP inventory that is simultaneously lending collateral, or an options-writing curve) directly demonstrates "utility efficiency" from the whitepaper.
3. **Demonstrate the shared-liquidity thesis on-chain**: one maker wallet, one allowance, several strategies (different pairs/curves) backed by the same tokens; show SLR > 1 from `rawBalances()` and fills via `Pulled/Pushed/Swapped` events on a mainnet fork. Show that a fill on strategy A changes what strategy B can quote (illiquidity is "economic, not a pause").
4. **Prove the invariants**: run `assertAllInvariantsWithConfig` from `test/invariants/CoreInvariants.t.sol` on every new instruction/program; explicitly show exact-in/exact-out symmetry, quote==swap, monotonicity, rounding-favors-maker, liveness after one side depletes. Judges (Bukov et al.) wrote these; a table of invariant results is cheap and high-signal.
5. **Write a short analytical note + composition guide** (PROGRAMS.md asks for "analytical proof (or strong formal/empirical evidence) of model stability; public notes or papers are encouraged" and a "thorough composition guide"). Include the canonical instruction order for your program and why fee placement is where it is.
6. **MEV awareness**: compose `_decayXD` or an oracle/min-rate guard before custom pricing; explain why quote/swap cannot diverge (deterministic, non-upgradeable Extruction target if used). Cite the JIT-immunity property.
7. **Respect the taker gate realistically**: in the fork demo either (a) `vm.prank`/deal a `KycNFT` (`0x26FFc7...`) balance to an EOA taker and call `swap()` with `tx.origin` = that EOA, or (b) ship without the gate and say so. Do not use a 4337/smart-account taker (documented unsupported).
8. **Use the official SDKs** for at least ship/dock and program encoding (`@1inch/aqua-sdk`, `@1inch/swap-vm-sdk`); decode `Shipped/Swapped` events with the SDK event classes. Docs call the SDK path "the recommended surface".
9. **Show economics with numbers** in the demo (worked-example style: fee in base units, `ceilDiv`, realized vs. quoted, SLR). 1inch's own docs and blog are number-heavy; mirror that.
10. **Git hygiene**: commit early and often (explicit rule). Add a README that uses their vocabulary (maker/taker, ship/dock, strategy, virtual balance, TVU/SLR).
11. **Avoid** submitting a pure NL/AI strategy composer, a front-end-only wrapper, or a pooled-vault design that re-introduces custody -- these contradict the self-custodial narrative and did not place in Lisbon.
12. Optional bonus that matches their roadmap: a keeper/agent loop (dock -> ship on illiquidity, auto-compound), or a "Best Route Selector"-style Extruction that picks among sub-curves at runtime (documented advanced pattern).

---

## 14. Open questions / UNCERTAIN

- Content of Bukov's "The Art of AMM" workshop and Tanner Moore's "Reimagining the AMM" slides (not fetchable; likely contain judge hints).
- X/Twitter threads by @1inch, @1inchdevs, Anton Bukov, Sergej Kunz (no accessible mirror; Nitter shut down 2026-08-24).
- CoinDesk 2025-11-17 article body (HTTP 429) and BeInCrypto NL interview with Sergej Kunz "Aqua, de eerste gedeelde liquiditeit en de volgende sprong in DeFi" (HTTP 403) -- may contain additional target-user/roadmap quotes.
- NY 2026 1st-3rd and Lisbon 2026 2nd-place Aqua winners.
- Whether ETHOnline 2026 has a 1inch workshop/office hours (schedule page 404).
- Actual share of Aqua volume coming via Fusion resolvers vs. direct arbitrage; whether Classic Swap will ever route through Aqua.
- Fee-vs-concentrate instruction ordering discrepancy (whitepaper/SDK vs. swap-vm-template).
- Whether the "SwapVM whitepaper at `release/1.1`" branch differs from the local 1.0 PDF (title says 1.0).

---

## 15. Source URLs

Official: https://1inch.com/aqua | https://1inch.com/aqua/learn | https://1inch.com/blog/tag/1inch-aqua | https://1inch.com/blog/post/aqua-developer-release | https://1inch.com/blog/post/1inch-aqua-bounty-program | https://1inch.com/blog/post/lp-efficiency-loss-and-what-aqua-changes | https://1inch.com/blog/post/85-of-concentrated-liquidity | https://1inch.com/blog/post/the-liquidity-problems | https://1inch.com/blog/post/1inch-aqua-launch | https://1inch.com/blog/post/1inch-incentive-program-for-aqua | https://1inch.com/blog/post/what-is-shared-liquidity | https://1inch.com/blog/post/aqua-vs-concentrated-liquidity | https://1inch.com/blog/post/aqua-vs-lp-vaults-and-liquidity-managers | https://1inch.com/blog/post/aqua-vs-classic-amm-pools | https://1inch.com/blog/post/risk-management-for-lps | https://1inch.com/blog/post/what-positions-can-i-create-on-aqua | https://1inch.com/blog/post/1inch-aqua-security | https://1inch.com/blog/post/how-aqua-protects-you-from-jit | https://1inch.com/blog/post/how-can-you-keep-control-of-your-tokens | https://1inch.com/blog/post/500-mln-in-swaps
Docs: https://business.1inch.com/portal/documentation/aqua/overview (+ sub-pages listed in §5) | https://business.1inch.com/portal/documentation/overview/products | https://business.1inch.com/portal/documentation/resolvers/introduction | https://business.1inch.com/portal/documentation/ai-integration/tools-reference
Code: https://github.com/1inch/aqua | https://github.com/1inch/swap-vm | https://github.com/1inch/sdks | https://github.com/1inch/swap-vm-template | https://github.com/1inch/1inch-audits/tree/master/Aqua%20and%20SwapVM%20v1 | https://hackenproof.com/programs/1inch-aqua
Press: https://news.bitcoin.com/nl/1inch-lanceert-aqua-het-eerste-gedeelde-liquiditeitsprotocol-nu-beschikbaar-voor-ontwikkelaars/ | https://www.coindesk.com/web3/2025/11/17/1inch-launches-aqua-a-protocol-letting-multiple-defi-strategies-share-the-same-capital | https://nl.beincrypto.com/gesprek-met-1inch-medeoprichter-sergej-kunz/
Hackathons: https://ethglobal.com/events/ethonline2026/prizes/1inch | https://ethglobal.com/events/lisbon2026/prizes/1inch | https://ethglobal.com/events/newyork2026/prizes/1inch | https://ethglobal.com/showcase/arcbook-twp2a | https://ethglobal.com/showcase/kswap-vm-aix5n | https://ethglobal.com/showcase/ballast-7jpyp | https://ethglobal.com/showcase/aquapilot-03izt | https://ethglobal.com/showcase/sluice-mxbqy | https://ethglobal.com/showcase/smile-fictr
Videos: https://www.youtube.com/watch?v=bdhba23BEzg (Bukov, "The Art of AMM") | https://www.youtube.com/watch?v=VrtWeUR3Vq4 (Moore, "Reimagining the AMM with 1inch Aqua")
Local: refs/aqua/docs/whitepaper-aqua-1.0.pdf (8 pp) | refs/swap-vm/docs/whitepaper-swap-vm-1.0.pdf (6 pp) | refs/swap-vm/docs/PROGRAMS.md | refs/swap-vm/src/opcodes/AquaOpcodes.sol | refs/sdks/typescript/swap-vm/src/swap-vm/instructions/index.ts
