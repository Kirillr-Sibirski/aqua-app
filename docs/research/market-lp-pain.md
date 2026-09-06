# KB: Pain points of liquidity provision & onchain market making (as of 2026-09-05)

Purpose: market-research grounding for an ETHGlobal ETHOnline 2026 submission in the 1inch "Build an Aqua app" track. Written for engineers/agents who have not read the sources. Every number carries a source + date. Items marked **UNCERTAIN** come from secondary/aggregator sources, conflicting reports, or headline-only reads (full article not fetched).

Method note: the session's WebSearch budget was exhausted after the first 10 queries; the remainder was gathered via WebFetch of primary pages, Google News RSS (titles/dates only where the article itself was paywalled or rate-limited), and DefiLlama JSON APIs (live snapshot taken 2026-09-05). Local repo reads: `refs/aqua/README.md`, `refs/aqua/src/Aqua.sol`, `refs/swap-vm/README.md`, `refs/swap-vm/docs/PROGRAMS.md`, `refs/swap-vm/src/instructions/*.sol`.

---

## 0. Executive summary (numbers first)

- **Passive LPs on major pairs lose to arbitrageurs.** Theory: a constant-product LP pays LVR = σ²/8 of pool value per unit time; at 5%/day ETH vol that is 3.125 bp/day ≈ **11%/yr**, requiring daily volume ≈ 10.4% of pool assets at 30 bp fee just to break even (Milionis/Moallemi/Roughgarden/Zhang, a16z, 2022-09-18). Empirics: on Uniswap v3 WETH-USDC 5 bp (Jan 2022–Dec 2023) **fees ≈ 80% of arbitrage losses**; for most large ETH/BTC v3 pools fees were "consistently lower than arbitrage losses" for two years (Fritsch & Canidio, arXiv 2404.05803, Apr 2024). 2021 Bancor/Topaz Blue study: **49.5% of ~17,000 v3 LP addresses underperformed HODL**, IL > fees in 80% of 17 pools, **$260M IL vs ~$200M fees**. 2026: Uniswap's fee switch takes **25% of LP fees on 1/5 bp pools and 17% on 30 bp pools** (Ethereum 2025-12-28, Arbitrum/Base 2026-03-06); Revert Finance reported LP APY falling ~4% → ~1% afterwards (as relayed by Falkenstein, 2026).
- **Depositing into pools/vaults is a custody bet.** $3.41B stolen in 2025 (Chainalysis, 2025-12-18; Bybit $1.5B = 44%); H1 2026: $972M/207 incidents (TRM, 2026-07-01) to $1.3B (CertiK/Forbes, crypto.news 2026-09-04). Pool/vault-specific: Balancer v2 Composable Stable Pools **>$120M** (2025-11-03, rounding bug, multiply-audited), Bunni v2 Uniswap-v4-hook ALM **$8.4M** (2025-09-01), Gamma ALM ≥$4.5M (2024-01-04), Stream Finance xUSD **$93M** loss → 70–77% depeg, Elixir deUSD shutdown (Nov 2025), Resolv USR $25M (Mar 2026), KelpDAO rsETH **$292M** and Drift **$285M** (Apr 2026, key/social-engineering compromises).
- **Capital is fragmented and idle.** DefiLlama lists **657 chains** and **362 spot DEX protocols**; top-3 chains ≈ 80% of TVL (2026-09-05 snapshot). Stablecoin supply **$301.7B** (2026-09-03), with a 2025 Chainalysis estimate of **>$90B USDC+USDT sitting in non-earning EOAs** (secondary citation, UNCERTAIN). DAO treasuries **$24.5–26B**, ~67% in native tokens, ~18% stables (CoinLaw 2025; DeepDAO Q1 2026 via secondary).
- **MEV:** ~**$60M/yr** lost by Ethereum traders to ~95k sandwiches (EigenPhi, Nov 2024–Oct 2025), 38% of attacks on low-volatility pools; single bot "jaredfromsubway" extracted **$295M cumulative** since Mar 2023. Builder concentration: Titan 50.3% of blocks (Aug 2026).
- **ALMs** (Arrakis, Gamma, Mellow) show median APYs of 1–15% with **~50–60% of returns from external incentives** and realized IL on rebalancing (Gauntlet, 2024-01-10); two ALMs were exploited (Gamma 2024, Bunni 2025).
- **Token issuers' liquidity via MM "loan + call option" deals** blew up publicly: Movement Labs' MM made **$38M** dumping MOVE (Binance offboarded the MM, Mar 2025), co-founder suspended (May 2025), Chapter 11 (2026-07-21). DOJ charged Gotbit/ZM Quant/CLS Global/MyTrade (Oct 2024), Gotbit founder sentenced (Jun 2025), 10 more charged (2026-04-01).
- **Peg liquidity:** 2025-10-10 crash: **$19B liquidations**, USDe printed **$0.65 on Binance**, Binance paid **$283M** compensation; USDe supply fell **$8.3B** by Dec 2025.
- **2026 narratives:** perp DEXs did **$6.38T in 2025** (~7% of all perps; 10% DEX:CEX in Apr 2026; Hyperliquid $190B in Apr 2026); prediction markets hit **$50.6B/month** (Jul 2026); tokenized equities **$9B onchain volume YTD** (Aug 2026, +800% since Jan); agentic wallets from Coinbase/MetaMask/Binance/Robinhood; **1inch Aqua public launch 2026-07-28 on 13 EVM chains** with 10M 1INCH LP incentives.

---

## 1. Impermanent loss / LVR: theory and measured magnitude

### 1.1 LVR theory (Milionis, Moallemi, Roughgarden, Zhang)
- Paper: "Automated Market Making and Loss-Versus-Rebalancing", arXiv 2208.06046 (Aug 2022). https://arxiv.org/abs/2208.06046 ; a16z summary 2022-09-18: https://a16zcrypto.com/posts/article/lvr-quantifying-the-cost-of-providing-liquidity-to-automated-market-makers/
- Definition: LVR = the adverse-selection cost LPs pay to arbitrageurs who pick off stale AMM prices after the CEX price moves. LP P&L = (fees) − (LVR) + (market beta of holding the inventory).
- CPMM closed form: instantaneous LVR normalized by pool value = **σ²/8**.
- Worked numbers (a16z): σ = 5%/day → **3.125 bp/day ≈ 11%/yr**; at a 30 bp fee, daily volume must be ≈ **10.4% of pool assets** to offset LVR; LVR is quadratic in vol (σ = 10%/day → 4x the required volume).
- Uniswap v2 ETH-USDC: **>99.991% of LP return variance is market beta**; the alpha (fees − LVR) is small relative to price exposure.
- Counterpoint: Willetts & Harrington, "Rebalancing-versus-Rebalancing" (arXiv 2410.23404, 2024-10-30) argue LVR uses a frictionless CEX benchmark; with realistic CEX fees and any "noise" volume, AMM pools often outperform CEX rebalancing in >1,000 simulated settings. Treat LVR as an upper bound on the arbitrage bleed, not net loss. https://arxiv.org/abs/2410.23404

### 1.2 Empirical LP profitability
| Study | Sample | Finding | Source |
|---|---|---|---|
| Topaz Blue / Bancor, "Impermanent Loss in Uniswap v3" (arXiv 2111.09192, Nov 2021) | 17 v3 pools with >$10M TVL, ~17,000 LP addresses, ~$100B volume | **49.5% of LPs lost vs HODL**; IL > fees in **80% of pools**; **$260M IL vs ~$200M fees** (net ≈ −$60M); MKR/WETH 74% of LPs lost; passive/long-held positions beat active short-term ones; JIT operated by only 2 searchers then | https://rekt.news/uniswap-v3-lp-rekt (2021-11-18); https://www.nasdaq.com/articles/half-of-uniswap-liquidity-providers-are-losing-money |
| Fritsch (ETH Zurich) & Canidio (CoW), "Measuring Arbitrage Losses and Profitability of AMM Liquidity" (arXiv 2404.05803, Apr 2024) | Uniswap v2 + v3 on Ethereum, Jan 2022–Dec 2023, Binance spot/perp reference | Major ETH/BTC pools: fees **consistently below arbitrage losses** over 2 years; WETH-USDC 5 bp fees ≈ **80% of losses**; v2 fees ≈ **3x losses** in 2023; less-liquid altcoin pairs: fees exceeded losses, sometimes by 50% | https://arxiv.org/html/2404.05803v2 |
| Falkenstein, "Uniswap LPs Losing More After Fee Switch" (Substack, 2026) | 19 v3 + 3 v2 pools, mostly Ethereum plus Arbitrum/Base/Avalanche; theta/fee ratio via markouts to hourly CEX prices and Black-Scholes-style estimates | v2 pools historically profitable but negligible volume; **v3 pools consistently money-losing while carrying most volume**; ratios rising in 2026 after fee switch | https://efalken.substack.com/p/uniswap-lps-losing-more-after-fee ; earlier: https://efalken.substack.com/p/uniswap-lps-are-losing-money |
| CrocSwap follow-ups (2021–22) | v3 pools | Confirms fee income rarely compensates IL for retail LPs | https://crocswap.medium.com/follow-up-analyses-of-lp-profitability-in-uniswap-v3-2cfc8c5e014e |

### 1.3 Uniswap fee switch (structural worsening for LPs)
- Governance vote ~99% in favor (CoinDesk, 2025-12-22). Protocol takes **25% of LP fees on 1 bp and 5 bp pools, 17% on 30 bp pools**; live on Ethereum **2025-12-28**, on Arbitrum/Base **2026-03-06** (Falkenstein, 2026).
- Reported effects: Revert Finance saw LP APY decline **~4% → ~1%** post-switch; Blockworks estimated protocol revenue could reach ~$90M/yr including Robinhood Chain activity (both as relayed by Falkenstein — UNCERTAIN).
- Implication: the LP economic problem is now worse on the largest venue; LPs are searching for venues that let them keep 100% of the spread and control adverse selection.

---

## 2. Capital fragmentation across pools, chains, venues

- DefiLlama `api.llama.fi/v2/chains` (2026-09-05): **657 chains** listed. Top TVL: Ethereum $49.4B, Solana $5.9B, BSC $5.9B, Base $5.7B, Tron $5.4B, Bitcoin $4.3B, Hyperliquid L1 $1.5B, Arbitrum $1.4B, Monad $1.0B, Robinhood Chain $0.9B, Polygon $0.8B, Plasma $0.6B, Avalanche $0.5B, Sui $0.5B, OP Mainnet $0.4B. Top-3 ≈ 80% of TVL; the long tail is hundreds of chains each with sub-$1B liquidity.
- DefiLlama `overview/dexs` (2026-09-05): **362 spot-DEX protocols**; 24h $10.2B, 7d $63.2B, 30d **$243.2B**. Curve alone is deployed on ~20 chains (Ethereum, OP, Gnosis, Avalanche, Polygon, Arbitrum, Fantom, Fraxtal, Celo, Base, Sonic, Hyperliquid L1, Plasma, Mantle, Ink, Unichain, Monad, Stable, Robinhood Chain, BSC) — the same LP must split inventory per chain per pool.
- DefiLlama `overview/aggregators` (2026-09-05): 30d **$67.6B** through aggregators (Jupiter $14.6B, 0x $8.0B, KyberSwap $7.2B, OKX $6.9B, CoW Swap $3.1B (−60% MoM), 1inch $2.9B (−39% MoM), Bebop $1.4B). Aggregators exist precisely because liquidity is scattered; ~28% of spot DEX volume now routes through them.
- Stablecoin distribution (Spark, Jun 2026): Ethereum >50%, Tron ~$79B, Solana ~$16B, Arbitrum ~$10B, Base ~$4.6B — dollar liquidity itself is chain-fragmented. https://www.spark.money/research/stablecoin-supply-420-billion-growth
- Wintermute OTC 2025 report (2026-01-13): BTC+ETH share of OTC notional fell 54% (2023) → 49% (2025) but capital is "trapped" in ETFs/DAT vehicles; altcoin rallies shortened to **~19 days avg in 2025 vs 61 in 2024**, so long-tail liquidity is thin and episodic. https://www.prnewswire.com/news-releases/wintermutes-otc-markets-2025-report-shows-cryptos-upper-tier-becoming-an-established-asset-class-as-liquidity-concentrates-302659976.html
- Narrative: "DeFi Has A Quiet Crisis Nobody's Talking About And It's Killing Yields" (Katana CEO, Yellow.com, 2026-05-21, headline only); "1inch co-founder explains how to fix crypto's fragmented liquidity problem" (TheStreet, 2026-01-09, headline only).
- Why existing fixes fall short: bridges/cross-chain routers move capital (custody + latency + bridge risk); each pool/vault requires a separate deposit, so one LP's $1M cannot simultaneously back an ETH/USDC AMM, an RFQ book and a stablecoin curve.

---

## 3. Custody and smart-contract risk of pools/vaults

### 3.1 Aggregate loss totals
| Period | Figure | Source |
|---|---|---|
| 2024 | $3.38B stolen | Chainalysis |
| 2025 | **$3.41B** stolen; Bybit $1.5B (44%); top-3 hacks = 69% of service losses; DPRK $2.02B (cumulative $6.75B); personal-wallet theft $713M across 158k wallets/80k victims; Q1 2025: 88% of losses from CeFi key compromise; "DeFi hack losses remained suppressed despite rising TVL" | Chainalysis 2025-12-18 https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2026/ ; The Block https://www.theblock.co/post/382477/crypto-hack-2025-chainalysis |
| 2025 (other trackers) | CertiK $3.35B; PeckShield $4.04B | via deepstrike/stingrai summaries (secondary) |
| H1 2026 | **$972M across 207 incidents** (record count; vs $2.3B/83 in H1 2025); KelpDAO ~$292M (Apr 2026), Drift ~$285M (Apr 1–2, 2026); DPRK $643M (66%); smart-contract exploits = 60% of incidents but small share of value; infra/ops compromises = 15% of incidents but **76% of losses** | TRM Labs 2026-07-01 https://www.trmlabs.com/resources/blog/h1-2026-crypto-hacks-reach-record-high-as-losses-fall-below-usd-1-billion ; Immunefi via The Block 2026-07-09 |
| H1 2026 (other) | Blockaid: >$1B, Ethereum $332M, Solana $326M; CertiK/Forbes $1.3B; Quill $935M/87 DeFi hacks; PeckShield $750M | The Block 2026-07-28 https://www.theblock.co/news/ecosystems/2026-07-28-crypto-hacks-hit-record-high-in-h1-2026-as-losses-top-1-billion-blockaid-says-409944 |
| 2026 YTD (Sep 4) | DeFi $1.3B; 30+ exploits >$3M; Coldcard $130M (Jul 30); "compromised keys, not broken code, now drive the majority of theft" — first year on record | crypto.news 2026-09-04 https://crypto.news/defi-hacks-2026-billion-lost-same-attack-keeps-working/ |
| DeFi-only trend | DeFi exploit losses ~$680M, −74% from 2022 peak $2.62B; median loss per exploit −75% since 2022 (UNCERTAIN whether this is FY2025 or H1 2026 — sources disagree) | Immunefi via The Block 2026-07-09; deepstrike |

### 3.2 Pool / vault / ALM exploits relevant to LPs
- **Balancer v2 Composable Stable Pools, 2025-11-03**: >$120M across Balancer + forks on 9 chains (Balancer's own post-mortem: $94.8M user funds). Root cause: floor rounding in `_upscale` combined with `_scalingFactors` override including exchange rates → invariant D manipulation at low liquidity; profit realized in a separate tx to evade detection. Contracts had multiple audits (OpenZeppelin 2021 x2) but ComposableStablePool/LinearPool were added after audit scope. OpenZeppelin: "audit practices haven't caught up with how fast complex protocols evolve." https://www.openzeppelin.com/news/understanding-the-balancer-v2-exploit ; https://blocksec.com/blog/in-depth-analysis-the-balancer-v2-exploit
- **Bunni v2 (Uniswap v4 hook ALM), 2025-09-01**: $8.4M ($2.3M Ethereum USDC/USDT, $6M Unichain ETH/weETH). Rounding in the custom Liquidity Distribution Function; balances drained to 25 wei broke division precision. Cyfrin's Jun 2025 audit had warned "complex bugs statistically likely"; TVL had been scaled $2.4M → $23.9M anyway. https://rekt.news/bunni-rekt
- **Gamma Strategies (ALM), 2024-01-04**: ≥$4.5M; price-change thresholds set to allow 50–200% moves on some LST/stable vaults → flash-loan-inflated LP-token mints at deposit; 3 audits did not cover configuration. https://rekt.news/gamma-strategies-rekt
- **Stream Finance xUSD, 2025-11-04**: $93M loss disclosed; xUSD fell 70–77% to ~$0.30; Elixir shut down deUSD (2025-11-07); curated lending vaults (Re7 Labs and others on Euler/Morpho) carried exposure; "looping yield bubble" narrative (The Defiant 2025-11-06); Re7 threatened a whistleblower (Protos 2025-12-01). Follow-ons: Resolv USR exploit $25M (Mar 2026); Main Street msUSD collapse as Altura wound down a vault (Protos 2026-06-22). Sources: CoinDesk 2025-11-04, Yahoo 2025-11-07, Tiger Research 2025-11-14 (titles via Google News; curator exposure figures not verified — UNCERTAIN).
- **KelpDAO rsETH, 2026-04-18**: ~$292M; **Drift, 2026-04-01/02**: $285M; both DPRK social engineering of multisig/admin/dev credentials over ~6 months (TRM 2026-04-02; The Hacker News 2026-04-05). Drift is relaunching with a $150M Tether deal (Sep 2026).
- Takeaway: pooled TVL is a honeypot; the loss vector is shifting from pool math to keys/admin/curator trust, i.e. to anything that has custody of pooled funds.

---

## 4. Idle capital: stablecoins, DAO treasuries, issuers

### 4.1 Stablecoins
- Supply: **$301.7B** on 2026-09-03 (USDT $183.3B, USDC $73.6B) per stablecoinbeat.com; **$308.0B** Aug 2026, +14.3% YoY from $269.4B (reap.global); Spark: ~$310B Jun 2026, USDT 61% / USDC 25% (93% combined), USDS $8.4B, DAI $4.7B, PYUSD $3.6B, GHO $0.58B. Projections: $420B by end-2026 (Citi/Bessent), $1.9–4T by 2030 (Citi). https://stablecoinbeat.com/tracker/ ; https://www.spark.money/research/stablecoin-supply-420-billion-growth
- Idle: "A 2025 Chainalysis stablecoin report estimated that **more than $90 billion of USDC and USDT sits in non-earning EOA wallets** at any given moment" (quoted by eco.com, May 2026 — primary report not fetched, UNCERTAIN). Issuers keep the reserve interest. https://eco.com/support/en/articles/15232635-yield-bearing-stablecoin-wallets-2026-earn-on-usdc-usdt-and-usds-idle-balances
- Benchmarks for what idle dollars could earn (2026): Sky Savings Rate 5.5%; Morpho vaults 5–7%; Coinbase USDC rewards 4.7%; sUSDe 9.4% (7-day) / 11.8% (90-day) in Apr 2026 with ~55% of USDe staked; Aave v3 holds >$18B stablecoin deposits (May 2026). Yield-bearing stablecoins grew ~300% in 2025; 21Shares projects >$50B in 2026 (secondary).
- Payments context: Visa $4.6B annualized stablecoin settlement (Q1 2026); B2B stablecoin flows ~$3B/month; autonomous agents processed **$73M across ~176M transactions** (avg $0.01–0.10) May 2025–Apr 2026 (Spark).

### 4.2 DAO treasuries
- CoinLaw 2025 (DeepDAO-derived): total **$24.5B**, liquid $21.4B; composition **67.3% native tokens, 18.2% stablecoins, 11.7% other crypto, 2.8% traditional assets**; top-5 DAOs >60% of assets; ~13,000 DAOs; avg treasury $1.2M; ~60% of large DAOs use diversification strategies; voter participation ~17%. https://coinlaw.io/dao-treasury-holdings-statistics/
- DeepDAO Q1 2026 (via eco.com summary, UNCERTAIN): **>$26B**; Uniswap $4.8B, Sky/MakerDAO $3.9B, Optimism $2.1B, Arbitrum $1.7B, Lido $1.4B. Historical: $25.1B in Mar 2023 (Optimism $5.5B, Arbitrum $4.4B) — i.e. the aggregate has been flat for 3 years while composition remains ~2/3 native token. https://cointelegraph.com/news/dao-treasuries-top-25-billion-for-the-first-time-deepdao
- Pain: treasuries want (a) to sell native tokens for stables without dumping, (b) to provide protocol-owned liquidity without handing tokens to a market maker or locking them in a pool whose contract can be drained, (c) to keep multisig custody.

---

## 5. MEV / sandwich losses

- EigenPhi data, Nov 2024–Oct 2025 (Cointelegraph/TradingView, Oct 2025): **95,000+ sandwiches on Ethereum, ~$60M/yr trader losses**; monthly extraction fell from ~$10M (late 2024) to ~$2.5M (Oct 2025); attackers keep only ~5% margin (builders take the rest via gas); avg profit per attack ~$3; **38% of attacks hit low-volatility pools** (stables, wrappers, LSTs), 12% stableswaps; ~70% attributed to "Jared"; 515 bots active Oct 2025 but ~100 in a typical month; only 6 attackers >$10k total profit. https://www.tradingview.com/news/cointelegraph:fa12ba092094b:0-exclusive-data-from-eigenphi-reveals-that-sandwich-attacks-on-ethereum-have-waned/
- jaredfromsubway.eth: **$295M / 117,007 ETH cumulative** since Mar 2023; lost $7.5M to an approvals honeypot in Jun 2026. Relay/builder concentration (24h, Aug 2026): top-3 relays 88%; Titan builder 50.3%, Quasar 16%, Buildernet 16%. https://news.bitcoin.com/learning-insights/mev-sandwich-attacks-explained/ (2026-08-30)
- Private-mempool sandwiches exist: Nov–Dec 2024, 2,932 private sandwiches on 3,126 private victim txs, $409k victim losses (arXiv 2512.17602).
- Solana: "1.55M sandwiches extracted ~$13.4M in 2025" (Phemex, secondary) vs "$370–500M over 16 months to May 2025" (Accelerate 2025 talk, secondary) — order-of-magnitude conflict, **UNCERTAIN**; either way Solana sandwiching exceeds Ethereum's.
- LP-side MEV: JIT liquidity and toxic-flow arbitrage are the LP's version (this is LVR); LPs cannot see who is filling them.
- Why existing fixes fall short: private RPCs/MEV Blocker protect traders, not LPs; batch auctions (CoW) require solvers; dynamic-fee hooks (Uniswap v4) are still nascent.

---

## 6. Rebalancing cost, gas, and Automated Liquidity Managers (ALMs)

- Gauntlet "Uniswap ALM Analysis" (2024-01-10): Arrakis V1 median APY **1–3%** (>90% in USDC/DAI); Arrakis V2 median **14%** on ETH vaults but **60% from Lido incentives**; Gamma median ~**15%** with ~half from incentives; Mellow BTC vaults ~5%, some periods negative. Problems named: dependence on external incentives, **realized IL from frequent rebalancing**, no standardized performance metrics, thin history. https://www.gauntlet.xyz/resources/uniswap-alm-analysis
- Arrakis strategy: weekly Monte Carlo re-ranging to keep price in range with 95% probability (Uniswap blog). Each rebalance = burn + swap + mint on-chain, crystallizing IL and paying gas/slippage; narrow ranges earn more fees but need more rebalances (DeSpread; Atis E).
- ALM contract risk: Gamma (2024, ≥$4.5M), Bunni v2 (2025, $8.4M). Uniswap v4 hooks expand the ALM design space and the bug surface.
- Structural issue: the LP hands custody to the ALM vault and pays a management/performance fee, yet returns are dominated by emissions.

---

## 7. Professional market makers and how they provide onchain liquidity

- Landscape: Wintermute, GSR, Flow Traders, Jump, Cumberland, B2C2, DWF. Wintermute got **US broker-dealer approval (SEC) on 2026-08-07** to trade equities/ETF blocks; GSR acquired broker-dealer Equilibrium Capital Services; Ripple and Crypto.com also built regulated US securities arms (CoinDesk 2026-08-07, headline; article rate-limited).
- Wintermute OTC 2025 (2026-01-13): options volume >2x YoY (~4x notional by year-end); execution becoming "more selective, structured"; liquidity concentrates in majors.
- Onchain mechanics: PMMs quote via **RFQ** (signed quotes filled by aggregator routers — e.g., Bebop $1.4B/30d, Hashflow; 0x RFQ), act as **solvers/resolvers** in intent systems (CoW solvers, UniswapX fillers, 1inch Fusion resolvers — specific firm participation UNCERTAIN), and run inventory on CEXs to hedge. They rarely deposit into AMM pools because of LVR and custody risk; their inventory stays in their own wallets and is committed per-quote.
- The "loan option model" (tokens lent by issuer + call option at a strike) is the standard issuer–MM deal; criticized as "disproportionately benefiting market makers at the expense of smaller projects, often resulting in sharp token price crashes" (OKX Learn, 2025-11-22). https://www.okx.com/en-us/learn/fluid-wintermute-crypto-market-trends
- Gap: PMM liquidity is off-chain-signed, opaque, permissioned, and offline when the MM is offline; AMM liquidity is always-on but bleeds LVR. Nothing lets a maker publish an always-on, self-custodial, programmable quote.

---

## 8. Token issuers' need for liquidity: MM loan deals and their cost

- **Movement Labs (MOVE)**: CoinDesk investigation "Inside Movement's Token-Dump Scandal: Secret Contracts, Shadow Advisers and Hidden Middlemen" (2025-04-30). A market maker (Web3Port/Rebase-linked) received a large MOVE loan and **realized ~$38M** selling; Binance cut ties with the MM (CryptoRank 2025-03-25); Movement launched an investigation (Apr 15); Coinbase delisted; co-founder Rushi Manche suspended (Blockworks, 2025-05-02); civil suit (Jul 2025); Move Industries relaunch (Dec 2025); **Chapter 11 on 2026-07-21** (CoinDesk). Exact contract terms (reported: loan of a large share of circulating supply with a "$5B FDV" trigger) — UNCERTAIN, article rate-limited.
- Binance banned a "mystery market maker" and seized profits for manipulation of GPS/SHELL launches (Yellow.com, 2025-03-10).
- Enforcement: DOJ/SEC charged Gotbit, ZM Quant, CLS Global, MyTrade for wash trading (2024-10-09); Gotbit founder sentenced (Decrypt 2025-06-13); DOJ charged 10 people from 4 "financial services firms", 3 extradited from Singapore (2026-04-01); CoinDesk: wash trading "far more common than investors think" (2026-04-02).
- Newsweek, "The Secret Deals Driving Crypto Markets…and Leeching Into Wall Street" (2025-08-04) — headline only.
- Cost structure to issuers (industry knowledge, UNCERTAIN in specifics): token loan typically ~0.5–2% of supply plus retainer; MM holds call options struck above listing price; incentive to sell the loan immediately and buy back lower; issuer bears dump risk and opacity.
- Why it persists: exchanges require depth for listings; issuers lack tooling to run their own transparent, bounded liquidity from treasury.

---

## 9. Stablecoin and RWA issuers needing peg / secondary liquidity

- **2025-10-10 crash**: ~$19B liquidations (largest ever), ~$600B market-cap wipe; on Binance USDe traded to **$0.65**, wBETH and BNSOL depegged; Binance compensated **$283M**; Binance introduced a Spot Price Range Execution Rule (Apr 2026). USDe supply fell **$8.3B** by 2025-12-23 amid "loss of confidence". Sources: CoinDesk 2025-10-11, The Block 2025-10-11, Binance post-mortem 2026-01-30, TradingView 2025-12-23 (titles via Google News).
- Stream xUSD (−77%), Elixir deUSD (shut down), Main Street msUSD (collapsed Jun 2026), Resolv USR ($25M exploit) — yield-bearing "stables" whose secondary liquidity evaporated once a curator/vault failed.
- RWA/tokenized stocks: tokenized equities **$9B onchain volume YTD** (+800% since Jan; Crypto Briefing 2026-08-19); Solana tokenized-equity volume **$5.77B in Q2 2026**; xStocks reported **$25B cumulative** (Kraken blog 2026-02-19, metric definition UNCERTAIN) and 58% share of DeFi deposits; tokenized US Treasuries ~**$16B** with Aave v3 capturing 64% (Crypto Briefing 2026-08-19); Anchored launching tokenized stocks on Arbitrum via UniswapX (2026-08-20); Ondo on tokenized-stock collateral for equity perps (2026-07-07); Robinhood Chain TVL ~$0.9B (DefiLlama). "RWA hit $10B" (Yellow, 2026-08-13) conflicts with the treasuries figure — UNCERTAIN scope.
- Pain: pegged/oracle-priced assets need deep two-sided liquidity around a reference price 24/7 (stock hours vs 24/7 crypto), with issuer-controlled inventory and often KYC gating; AMM pools mis-price them during off-hours and get arbitraged (LVR is maximal when the reference price is observable off-chain but the pool is stale).

---

## 10. 2026-specific narratives (fit for a demo story)

| Narrative | Numbers | Source/date |
|---|---|---|
| Perp DEX dominance | 2025: perp CEX $85.3T vs perp DEX **$6.38T** (~7%); Jan–Apr 2026 DEX avg $611.6B/mo (+15% YoY) vs CEX $4.69T/mo (−34% YoY); DEX:CEX 10% Apr 2026 (peak 13% Nov 2025); OI Apr 2026 $99.1B (DEX 13.5%); Hyperliquid **$190.3B in Apr 2026** (#9 of all perp venues, 3.9%); HL share of perp-DEX volume 70% (Apr 2025) → 44% (Mar 2026) as Aster/Lighter grew; HL OI $11B (Jul 2026) | CoinGecko "State of Crypto Perpetuals 2026" (2026-05-21) https://www.coingecko.com/research/publications/state-of-crypto-perpetuals-report-2026 ; Yellow.com 2026-03-23, 2026-07-16 |
| Intents / solver networks | CoW $3.1B/30d, Bebop $1.4B/30d (DefiLlama 2026-09-05); Bitget Wallet solver program (2026-08-05); TheStreet "DeFi aggregators moving to intent-based trading, clear winner" (2026-07-31, headline) | DefiLlama; Google News |
| AI agents / agentic finance | Binance AI-agent trading for 300M users (2026-08-21); MetaMask Agent Wallet live on 10 chains (2026-06-09); Robinhood "agentic trading" core product (2026-07-01); OKX Agent Payments Protocol; SwarmBase $7M (2026-07-17); agent payments $73M/176M tx May 2025–Apr 2026 | Google News; Spark |
| Prediction markets | Jul 2026 record **$50.6B** monthly volume; Jun 2026 $44.8B; Kalshi Jun $31B; World Cup ≈$20B | CoinDesk/Yellow/DeFi Rate (Jun–Aug 2026 headlines) |
| Restaking | EigenLayer TVL ~$15B (Apr 2026, "96 ETH rule change") vs ~$6.5B and "96% price decline" (May 2026 Kraken piece) — UNCERTAIN; KelpDAO rsETH hack $292M; Ether.fi pivoting to neobank | Google News |
| Tokenized stocks/RWA | see §9 | |
| 1inch Aqua itself | Announced 2025-11-17 (The Block/CoinDesk: "multiple DeFi strategies share the same capital"); **public launch 2026-07-28 across 13 EVM chains**, 10M 1INCH LP incentive program; Messari "State of 1inch Q1 2026" (2026-05-22); "LPs reassess core risks as Aqua reshapes liquidity economics" (Crypto Economy 2026-08-12) | Google News; https://1inch.com/aqua/ |

---

## 11. RANKED pain points

Ranking weighs (magnitude in $) × (breadth of sufferers) × (how directly a self-custodial programmable liquidity primitive changes the outcome).

### #1 Passive LPs structurally lose to arbitrage (LVR/IL > fees), now with a protocol fee on top
- (a) Who: retail LPs, DAO/protocol-owned liquidity, ALM depositors on Uniswap v3-style venues.
- (b) Evidence: σ²/8 ≈ 11%/yr at 5% daily vol (a16z 2022); WETH-USDC 5 bp fees ≈ 80% of arb losses, major v3 pools net-negative 2022–23 (Fritsch–Canidio 2024); 49.5% of v3 LPs under HODL, $260M IL vs $200M fees (2021); v3 LPs "consistently money-losing" and worse after the 17–25% fee switch (Falkenstein 2026; Revert 4%→1%).
- (c) Why existing solutions fall short: dynamic-fee/LVR hooks are early and pool-level (all LPs share one policy); ALMs charge fees and depend on emissions; oracle-based AMMs need a trusted feed; PMM RFQ is off-chain and permissioned.
- (d) Aqua+SwapVM: each maker ships an isolated, immutable program with its *own* pricing policy: `OraclePriceAdjuster(maxPriceDecay, maxStaleness, oracleDecimals, oracle)` re-anchors quotes to a reference price (kills stale-price arbitrage); `Decay(period)` (Mooniswap-style virtual-balance decay) throttles the arb after each fill; `DutchAuction(start,duration,decay)` / `MinRate` turn quoting into an auction that captures the arb spread for the maker; `Whitelist`/`OnlyTakerTokenBalanceNonZero` restrict fills to chosen solvers. Because inventory stays in the wallet (`Aqua.pull()` only at fill), the same tokens can sit in yield-bearing form until traded. LPs keep 100% of the spread (no venue fee switch).

### #2 Custody / contract / key risk of pooled liquidity
- (a) Who: every depositor in pools, vaults, ALMs, curated lending vaults; DAO treasuries; issuers.
- (b) Evidence: $3.41B (2025), ~$1–1.3B H1 2026; Balancer >$120M, Bunni $8.4M, Gamma ≥$4.5M, Stream $93M + deUSD/msUSD contagion, Resolv $25M, Kelp $292M, Drift $285M; 76% of H1-2026 losses from infra/key compromise of custodial systems.
- (c) Shortfalls: audits miss added modules (Balancer) and configuration (Gamma); insurance thin; curators are trust intermediaries; pooled TVL is a honeypot.
- (d) Aqua: `Aqua.sol` holds no tokens; balances are virtual (`_balances[maker][app][strategyHash][token]`), tokens move only via `pull()` at swap time within a single atomic tx. Blast radius per maker = the approval granted to Aqua (bounded per strategy via `ship(app, strategy, tokens, amounts)`), not the whole TVL of a pool; no admin keys over user funds; strategies immutable (`dock()` to exit). Residual risk: the ERC-20 approval to the Aqua registry and any bug in the maker's chosen SwapVM program.

### #3 Fragmentation across chains, pools, and venues
- (a) Who: LPs and PMMs who must pre-fund every pool/chain; takers who suffer thin depth; long-tail tokens.
- (b) Evidence: 657 chains, 362 DEXs, Curve on ~20 chains; top-3 chains 80% of TVL; ~28% of spot DEX volume routed via aggregators ($67.6B/30d) to stitch depth together; stablecoins split Ethereum/Tron/Solana/L2s.
- (c) Shortfalls: bridges and cross-chain routers move custody; each pool requires isolated deposits; aggregators only re-route, they don't unify inventory.
- (d) Aqua: "single approval enables participation in unlimited strategies" — one balance can back an XYC pool, a pegged curve and a limit book simultaneously on the same chain (`useAquaInsteadOfSignature = true` in SwapVM). Same contract addresses on 13–15 chains (`0x111111338c5091E8440b67B168bAe16a668AC0De` router; registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`) simplify multi-chain deployment, though cross-chain balances are still separate (Aqua is per-chain).

### #4 Idle treasury and stablecoin capital
- (a) Who: DAO treasuries ($24–26B, 67% native tokens, 18% stables), token issuers, corporates/agents holding stables (>$90B idle USDC/USDT — UNCERTAIN).
- (b) Evidence: DAO aggregate flat ~$25B for 3 years; stables at 4.7–11.8% elsewhere; Aave >$18B stablecoin deposits.
- (c) Shortfalls: deploying treasury into pools means giving up multisig custody and taking contract risk (see #2) and IL (see #1); MM loans mean giving tokens away (see #5).
- (d) Aqua: a multisig can `ship()` strategies without moving tokens; e.g. `PeggedSwap(x0,y0,A,rateA,rateB)` for stables, `XYCConcentrateSwap(sqrtPriceMin,sqrtPriceMax)` for protocol-owned native-token liquidity in a bounded band, `TWAPSwap`/`DutchAuction` for programmatic diversification sales. Treasury remains in the treasury wallet.

### #5 Token issuers dependent on opaque MM loan/option deals
- (a) Who: new and mid-cap token projects; their holders.
- (b) Evidence: Movement: MM realized $38M, delistings, suspension, bankruptcy (2026-07-21); Binance MM bans (Mar 2025); DOJ actions Oct 2024 → Apr 2026 (Gotbit sentenced; 10 charged).
- (c) Shortfalls: deals are bilateral, off-chain, misaligned (call-option payoff rewards dumping); exchanges demand depth; issuers lack self-serve tooling.
- (d) Aqua/SwapVM: issuer runs transparent, on-chain, bounded market making from its own treasury: concentrated XYC around a target band + `FeeFlat`, `Deadline`/`Salt` controls, optional `Whitelist` to route through vetted solvers; every parameter is public bytecode and immutable per strategy; no tokens leave the treasury except on fills. Removes the loan; keeps the option-like upside with the issuer.

### #6 MEV extraction from takers and LPs
- (a) Who: traders (~$60M/yr on Ethereum, more on Solana), LPs via JIT/toxic flow.
- (b) Evidence: 95k sandwiches/yr, 38% on low-vol pools; jared $295M cumulative; builders capture most of the value (Titan 50%).
- (c) Shortfalls: private RPCs protect only the taker; pools cannot discriminate takers or slow arbs.
- (d) SwapVM: `Decay` virtual balances (Mooniswap lineage) reduce the extractable value after each trade; `Whitelist` (solver-only fills) removes public-mempool sandwiching of the maker's own quotes; signature-mode programs are private until filled; `MinRate` + `Deadline` bound execution; `BaseFeeAdjuster` prices gas conditions.

### #7 Rebalancing cost and ALM dependence
- (a) Who: concentrated-liquidity LPs; ALM depositors.
- (b) Evidence: ALM returns 50–60% emissions-dependent; realized IL on each re-range; Bunni/Gamma exploits.
- (c) Shortfalls: re-ranging requires burn/swap/mint with slippage; ALMs custody funds.
- (d) Aqua: strategies are immutable, but `dock()` + `ship()` a new program moves no tokens (virtual balances only), so re-ranging is a state update, not a swap; `Extruction` + conditional `Jump*` allow "best branch" selection (XYC vs Pegged) inside one program (`test/RunLoop.t.sol: test_BestRouteSelector_XYC_vs_Pegged`). Gas numbers for `ship`/`dock` — UNCERTAIN, measure in the demo.

### #8 Peg / reference-price liquidity for stablecoin and RWA issuers
- (a) Who: stablecoin issuers (USDe $0.65 print; xUSD, deUSD, msUSD), tokenized-stock/treasury issuers ($9B YTD equity volume, $16B treasuries), their holders.
- (b) Evidence: §9.
- (c) Shortfalls: AMMs are stale off-hours; CEX books thin at stress; issuers can't gate takers or anchor to NAV.
- (d) SwapVM: `PeggedSwap` (Curve-like) + `OraclePriceAdjuster` (NAV/Chainlink anchor with `maxStaleness`) + `OnlyTakerTokenBalanceNonZero(gateToken)` for KYC/allowlist tokens; issuer inventory remains in the issuer's wallet, so a redemption desk becomes an always-on onchain quote.

### #9 Professional MMs lack an always-on, self-custodial onchain venue
- (a) Who: Wintermute/GSR/Flow-tier firms and smaller quant makers.
- (b) Evidence: PMM volume sits in RFQ rails (Bebop $1.4B/30d) and intent fills; OTC report shows structured, selective execution.
- (c) Shortfalls: RFQ quotes die when the signer is offline; AMM deposits bleed LVR and require capital lock-up.
- (d) SwapVM signature mode = programmable RFQ (1D `StaticBalances` + `LimitSwap` + `DutchAuction` + `Invalidators`); Aqua mode = persistent inventory without pre-funding pools; resolvers/solvers/AI agents become takers.

### #10 New flows (AI agents, intents, prediction markets, perps) need programmable, guard-railed liquidity
- (a) Who: agent wallets (Coinbase/MetaMask/Binance/Robinhood), solver networks, prediction-market makers, spot venues losing share to perps.
- (b) Evidence: §10.
- (c) Shortfalls: agents holding raw approvals to pools are a key-compromise risk; solvers need reliable fills; outcome tokens need pegged/bounded curves.
- (d) SwapVM programs act as policy: an agent can only trade through a program with `Deadline`, `MinRate`, `Whitelist`, per-strategy balance caps; `SeriesEpochManager` for rolling series; binary-outcome tokens fit `PeggedSwap` with bounds.

---

## 12. Aqua / SwapVM facts used above (from local repos)

- `refs/aqua/src/Aqua.sol`: `ship(address app, bytes calldata strategy, address[] tokens, uint256[] amounts) returns (bytes32 strategyHash)` (line 40); `dock(address app, bytes32 strategyHash, address[] tokens)` (54); `pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to)` (63); `push(address maker, address app, bytes32 strategyHash, address token, uint256 amount)` (72); `rawBalances(maker, app, strategyHash, token) returns (uint248 balance, uint8 tokensCount)` (26). Storage: `mapping(maker => mapping(app => mapping(strategyHash => mapping(token => Balance))))`. Strategies immutable once shipped; `strategyHash = keccak256(abi.encode(strategy))`.
- `refs/swap-vm/README.md`: router `0x111111338c5091E8440b67B168bAe16a668AC0De` on Ethereum, Base, Optimism, Polygon, Arbitrum, Avalanche, BSC, Linea, Sonic, Unichain, Gnosis, zkSync, Cronos, Monad, HyperEVM. Registers: `balanceIn, balanceOut, amountIn, amountOut, amountNetPulled`.
- `refs/swap-vm/src/instructions/`: Balances, BaseFeeAdjuster, Controls, Decay, DutchAuction, Extruction, FeeFlat, FeeProtocol, Invalidators, Jumps, LimitSwap, MinRate, OraclePriceAdjuster, PeggedSwap, PiecewiseLinearScale, SeriesEpochManager, TokenValidators, TWAPSwap, Whitelist, XYCConcentrate, XYCSwap. Builders seen: `OraclePriceAdjuster.build(uint64 maxPriceDecay, uint16 maxStaleness, uint8 oracleDecimals, address oracle)`, `DutchAuction.build(uint40 start, uint16 duration, uint64 decay)`, `Decay.build(uint16 period)`, `PeggedSwap.build(x0, y0, A, rateA, rateB)`, `XYCConcentrateSwap.build(sqrtPriceMin, sqrtPriceMax)`, `Whitelist.build(address allowedTaker)` / multi-taker variant with `nextPC`.
- `refs/swap-vm/docs/PROGRAMS.md`: catalog of 1D limit programs, 2D AMM programs (XYC, Concentrated, Pegged, Decay-enhanced), Aqua-backed programs (`useAquaInsteadOfSignature = true`, "same Aqua-backed liquidity can be reused across multiple different strategies at the same time"), conditional-flow programs (`OnlyTakerTokenBalanceNonZero`, `Extruction` best-route selector). Warning: instruction order is security-critical; invariant suites in `test/invariants/`.
- Public site https://1inch.com/aqua/ : "shared", "self-custodial" (tokens stay in wallet until position conditions are met), "permissionless" (pull and return in one atomic tx); SwapVM as developer toolkit; bounty up to $100k; UI planned 2026.

---

## 13. Idea seeds (from the research)
1. **Treasury-native market maker**: a DAO multisig ships an immutable concentrated-XYC + oracle-anchored program for its token/stable pair; demo shows zero token transfer until fill, versus a MM loan deal.
2. **Peg-defense desk for stablecoin/RWA issuers**: `PeggedSwap` + `OraclePriceAdjuster` + KYC gate (`OnlyTakerTokenBalanceNonZero`), inventory in the issuer wallet; simulate an Oct-10-style shock on a fork.
3. **LVR-aware LP**: same wallet balance backs an oracle-anchored AMM and a Dutch-auction rebalancer; compare markout P&L against a vanilla XYC pool on a fork.
4. **Agent-safe liquidity policy**: an AI agent can only trade a treasury through a SwapVM program with `Deadline`, `MinRate`, `Whitelist`, and per-strategy caps.
5. **Shared inventory across strategies**: one Aqua balance behind XYC, Pegged, and limit-order programs simultaneously; show fills draining the same virtual balance.

## 14. Open questions
- Gas cost of `ship`/`dock`/`pull` vs Uniswap v3 mint/burn/swap (measure on fork).
- Exact Movement–MM contract terms and the Newsweek deal-structure numbers (articles rate-limited/paywalled).
- Whether Wintermute/GSR/Flow Traders act as 1inch Fusion resolvers or Aqua makers today.
- True Solana sandwich totals for 2025 ($13M vs $370–500M conflict).
- Scope of the Immunefi "$680M DeFi losses" figure (FY2025 vs H1 2026).
- Aqua post-launch TVL/volume and LP-incentive results (no public numbers found).
- Whether `OraclePriceAdjuster` supports arbitrary oracle interfaces (Chainlink-only?) and its behavior when `maxStaleness` is exceeded.

## 15. Source index (fetched unless noted)
- a16z LVR (2022-09-18) https://a16zcrypto.com/posts/article/lvr-quantifying-the-cost-of-providing-liquidity-to-automated-market-makers/
- Milionis et al. arXiv 2208.06046; Willetts & Harrington arXiv 2410.23404
- Fritsch & Canidio arXiv 2404.05803 (2024-04) https://arxiv.org/html/2404.05803v2
- Falkenstein Substack (2026) https://efalken.substack.com/p/uniswap-lps-losing-more-after-fee
- rekt.news Uniswap v3 LP (2021-11-18) https://rekt.news/uniswap-v3-lp-rekt ; Bunni (2025-09) https://rekt.news/bunni-rekt ; Gamma (2024-01) https://rekt.news/gamma-strategies-rekt
- Chainalysis 2025 theft (2025-12-18) https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2026/ ; The Block https://www.theblock.co/post/382477/crypto-hack-2025-chainalysis
- TRM H1 2026 (2026-07-01) https://www.trmlabs.com/resources/blog/h1-2026-crypto-hacks-reach-record-high-as-losses-fall-below-usd-1-billion ; The Block/Immunefi (2026-07-09) https://www.theblock.co/news/ecosystems/2026-07-09-crypto-hack-losses-fall-below-1-billion-in-h1-2026-even-as-attack-volume-hits-record-immunefi-407707 ; The Block/Blockaid (2026-07-28) https://www.theblock.co/news/ecosystems/2026-07-28-crypto-hacks-hit-record-high-in-h1-2026-as-losses-top-1-billion-blockaid-says-409944 ; crypto.news (2026-09-04) https://crypto.news/defi-hacks-2026-billion-lost-same-attack-keeps-working/
- OpenZeppelin Balancer post-mortem https://www.openzeppelin.com/news/understanding-the-balancer-v2-exploit ; BlockSec https://blocksec.com/blog/in-depth-analysis-the-balancer-v2-exploit
- EigenPhi sandwich data (Oct 2025) https://www.tradingview.com/news/cointelegraph:fa12ba092094b:0-exclusive-data-from-eigenphi-reveals-that-sandwich-attacks-on-ethereum-have-waned/ ; Bitcoin.com MEV (2026-08-30) https://news.bitcoin.com/learning-insights/mev-sandwich-attacks-explained/ ; arXiv 2512.17602 (private sandwiches)
- Gauntlet ALM analysis (2024-01-10) https://www.gauntlet.xyz/resources/uniswap-alm-analysis
- Wintermute OTC 2025 (2026-01-13) https://www.prnewswire.com/news-releases/wintermutes-otc-markets-2025-report-shows-cryptos-upper-tier-becoming-an-established-asset-class-as-liquidity-concentrates-302659976.html ; OKX Learn on loan-option model (2025-11-22) https://www.okx.com/en-us/learn/fluid-wintermute-crypto-market-trends ; CoinDesk Wintermute broker-dealer (2026-08-07, headline) https://www.coindesk.com/business/2026/08/07/wintermute-gains-u-s-broker-dealer-status-in-wall-street-push
- Movement Labs: CoinDesk (2025-04-30, 2025-05-02, 2026-07-21), Blockworks (2025-05-02), CryptoRank (2025-03-25) — via Google News RSS titles; CoinDesk article URL https://www.coindesk.com/tech/2025/04/30/inside-movement-s-token-dump-scandal-secret-contracts-shadow-advisers-and-hidden-middlemen (rate-limited)
- Stablecoins: https://stablecoinbeat.com/tracker/ ; https://www.spark.money/research/stablecoin-supply-420-billion-growth ; eco.com (Chainalysis $90B quote) https://eco.com/support/en/articles/15232635-yield-bearing-stablecoin-wallets-2026-earn-on-usdc-usdt-and-usds-idle-balances
- DAO treasuries: https://coinlaw.io/dao-treasury-holdings-statistics/ ; https://cointelegraph.com/news/dao-treasuries-top-25-billion-for-the-first-time-deepdao (2023-03-31)
- CoinGecko perps 2026 (2026-05-21) https://www.coingecko.com/research/publications/state-of-crypto-perpetuals-report-2026
- DefiLlama APIs (2026-09-05): https://api.llama.fi/v2/chains ; https://api.llama.fi/overview/dexs ; https://api.llama.fi/overview/aggregators
- 1inch Aqua: https://1inch.com/aqua/ ; Google News RSS titles (Decrypt/Cryptonews/The Block, 2025-11-17 and 2026-07-28/29)
- Oct-10 crash, Stream/Elixir, prediction markets, tokenized stocks, AI agents, restaking: Google News RSS titles (CoinDesk, The Block, Yellow.com, Crypto Briefing, TRM, Protos), dates as cited inline.
