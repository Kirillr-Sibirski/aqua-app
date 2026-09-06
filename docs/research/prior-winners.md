# Prior hackathon projects on 1inch Aqua / SwapVM, and 1inch-track winner patterns

Research date: 2026-09-05 (ETHOnline 2026 is running Sep 4–16, 2026). Sources: ethglobal.com showcase + prize pages (fetched per-project), 1inch blog, GitHub (`gh search repos/code`, repo metadata, READMEs), local clones of `1inch/aqua`, `1inch/swap-vm`, `1inch/sdks`.

Method notes / caveats:
- `https://ethglobal.com/showcase?search=...` ignores the `search` param server-side (it returns the default event list). Event-filtered listing (`?events=<slug>&page=N`) works and was paged exhaustively for `buenosaires` (16 pages), `newyork2026` (8 pages), `lisbon2026` (6 pages).
- ETHGlobal `/events/<slug>/prizes/1inch` pages list prize structure and requirements but never list winners; placements below come from each project's showcase page ("Prizes won" block).
- GitHub "dependents" pages for `1inch/aqua` and `1inch/swap-vm` show 0 (hackathon repos vendor/submodule the contracts instead of depending on a package). `github.com/topics/aqua-app` is empty. Code search on `AquaApp` (Solidity) / `useAquaInsteadOfSignature` / `IAqua` / the mainnet Aqua address was the productive route.
- No Devfolio / DoraHacks / Encode / HackQuest hackathon with a 1inch Aqua track was found (searched). All Aqua tracks to date are ETHGlobal events. The only non-hackathon Aqua program found is the HackenProof bug bounty (see §7).

---

## 1. Every 1inch "Build an Aqua App" track so far (chronological)

Aqua developer release: 2025-11-17. Public launch (13 chains, Merkl incentives, 10M 1INCH + 500k USDC rewards): 2026-07-28.

| Event | Dates | 1inch Aqua pool | Placements | Other 1inch tracks at event |
|---|---|---|---|---|
| ETHGlobal Buenos Aires | 2025-11-21..23 | $17,000 | 1st $7k, 2nd $3k, 3rd $2k ×2, 4th $1k ×3 | "Utilize 1inch APIs" $3k (3×$1k) |
| ETHGlobal New York 2026 | 2026-06-12..14 | $7,000 | 1st $2.5k, 2nd $2k, 3rd $1.5k, 4th $1k | none |
| ETHGlobal Lisbon 2026 | 2026-07-24..26 | $5,000 main + $2,000 Continuity | main 1st $2.5k / 2nd $1.5k / 3rd $1k; Continuity 1st $1.5k / 2nd $500 | none |
| **ETHOnline 2026 (current)** | 2026-09-04..16 | $5,000 main + $2,000 Continuity | same as Lisbon | none |

1inch did **not** sponsor HackMoney 2026, Cannes 2026, or ETHOnline 2025. Prize text has been essentially identical since NYC 2026: "Create a custom Aqua app that implements a sophisticated DeFi position. If you use SwapVM, you may modify SwapVM opcodes and define your own instructions… Projects that utilize SwapVM will be scored higher. Qualification: (1) official Aqua/SwapVM contracts must be used (redeployments of a modified SwapVM contract allowed); (2) onchain execution of token transfers presented during final demo (local forks ok); (3) proper git commit history." Buenos Aires wording was stricter: "Create a custom Aqua app **based on SwapVM**… SwapVM powers the Aqua app" and listed suggested positions: **leverage, AMM, lending, options**. No explicit rubric (novelty/UI/tests weights) is published; the "SwapVM scored higher" line is the only stated weighting.

Continuity Track (introduced at ETHGlobal NYC 2026): teams may extend an existing open-source repo or ship a new feature on an existing product; pre-existing work must be documented and only hackathon-period work is judged; judged in a separate pool.

---

## 2. Winners of the Aqua track, per event

### 2.1 ETHGlobal Buenos Aires (Nov 2025) — first Aqua track, 6 days after Aqua's dev release

| Place (per showcase page) | Project | What it built | SwapVM / custom opcodes? | Links |
|---|---|---|---|---|
| **1st** | **Aqua Outcome Market** | Prediction-market AMM (pm-AMM invariant: liquidity concentrated at p=0.5, decaying toward expiry) implemented as a SwapVM instruction; one maker's capital backs several outcome markets via Aqua virtual reserves; `MakerMintingHook` as a `preTransferOut` hook mints outcome tokens JIT and acts as an Euler EVC operator to pull from a yield vault (credit-based market making) | Yes — custom instruction `src/instruction/pmAMM.sol` + SwapVM hooks | https://ethglobal.com/showcase/aqua-outcome-market-0va0j · https://github.com/yielddev/AquaOutcomeMarket (11 commits) |
| "2nd" (see note) | **aqua-flash-loans** | Gas-optimized flash loans on Aqua for long-tail tokens; LP-set fees; single-token 79,144 gas (claimed 53% < Aave V3), dual-token 128,207 gas | No — started with SwapVM, pivoted to `aqua-app-template` (plain `AquaApp`) | https://ethglobal.com/showcase/aqua-flash-loans-egocw · https://github.com/otonashi-labs/aqua-flash-simple |
| "2nd" (see note) | **Coco** | Non-custodial "savings" UX: routes user liquidity into curated Aqua strategies from the wallet; Next.js + wagmi; The Graph position tracking; Chainlink oracle checks. Also won Circle/Arc 2nd | No custom opcodes (integration/UX layer) | https://ethglobal.com/showcase/coco-dvaxo · https://github.com/eth-ba/coco (25 commits) |
| "2nd" (see note) | **Cleverly Using Money (CUM)** | Privacy pool (Noir, Poseidon2, Tornado-style) whose `AquaVault` deploys pooled anonymous capital into Aqua strategies; yield via rebasing | No custom opcodes | https://ethglobal.com/showcase/cleverly-using-money-pogqu · https://github.com/mcmoodoo/simple-cum · circuits https://github.com/JSeam2/CUM-Circuit |
| 4th | **Aqua0** | Two custom AquaApps on Base + World Chain: Curve-style StableSwap (`StableswapAMM.sol`) and Uniswap-v3-style concentrated liquidity via virtual reserves (`ConcentratedLiquiditySwap.sol`, x_v·y_v = L²); LayerZero composer moves capital cross-chain. Finalist; LayerZero 2nd; World Pool prize. Later incubated by 1inch; sought ~$100k DAO grant | No — custom `AquaApp` contracts, not SwapVM | https://ethglobal.com/showcase/aqua0-u2krx · https://github.com/jackmielke/Aqua0 (39 commits) · https://gov.1inch.network/t/aqua0-cross-chain-shared-liquidity-built-on-1inch-aqua/895 |
| 4th | **ProaqctiveMM** | Proactive (oracle-centred) market maker: Pyth price → liquidity concentrated around oracle price; built from `swap-vm-template` (AquaAMM) with pre/post hooks + money-market integration on a branch | Yes (SwapVM strategy), no new opcodes evident | https://ethglobal.com/showcase/proaqctivemm-f0y6v · https://github.com/velocityResearch/ProAqtive (24 commits) |
| 4th | **1Wave** | Basket-asset vault (Factor SDK) whose shares are market-made through Aqua; Chainlink-driven rebalancing to target weights atomically after each swap ("remove and re-add max liquidity") | No custom opcodes | https://ethglobal.com/showcase/1wave-9ypfs · https://github.com/wave-vault/contracts |

Note on "2nd": three showcase pages each display "1inch – Build an Aqua App 2nd place", while the announced structure had one $3k 2nd and two $2k 3rds. Count matches (1 + 3 + 3 = 7 winners) so the 3 "2nd" badges almost certainly cover the $3k + 2×$2k tier; which got which is UNCERTAIN.

Non-winning Buenos Aires Aqua submissions (useful for "already tried"): **Poorps** (memecoin perps w/ Aqua + Pyth vAMM, 2 commits), **CrossRevEngine** (Chainlink CRE agent compiles SwapVM bytecode → LayerZero/Stargate `composeMsg` → `OAquaExecutor.lzCompose` calls `aqua.ship()` to spawn an ephemeral "ghost AMM", then docks; 72 commits), **Private Deals** (Aqua-compatible privacy pool w/ Aztec; explored `extruction` opcode, settled on maker callbacks; won Aztec prize), **Pagga** (agent credit RFQ/auctions on x402 with mock Aqua liquidity reservation), **omni402** (won "Utilize 1inch APIs" + LayerZero 1st: x402 invoices paid from any chain, settlement via Aqua taker traits `IS_EXACT_IN` + `USE_TRANSFER_FROM_AND_AQUA_PUSH`), **rishav-eulb/swapVM** (repo only).

### 2.2 ETHGlobal New York 2026 (June 2026)

| Place | Project | What it built | Custom opcodes | Links |
|---|---|---|---|---|
| **1st** | **RiverSwap** (River Swap) | Auction-managed AMM (am-AMM): fee rights auctioned; custom opcode `_aquaAccountedDynamicFeeAmountInXD` sets fee at swap time and tracks accrual; Tycho indexer reconstructs distributed order liquidity into virtual pool state; concentrated liquidity | 1 | https://ethglobal.com/showcase/riverswap-bat5v · https://github.com/matcha-bros/river-swap (only 5 commits visible; README = local anvil demo, chain id 900) |
| **2nd** | **Lotus** | "Directional liquidity for big holders: sell on the way up, never re-buy". `LotusSwapVMRouter` inherits real SwapVM and adds `ONEWAY_FILL`, `ONEWAY_FILL_BEST`, `ONEWAY_FILL_LIFI`. Also Uniswap "Best API Integration" 1st | 3 | https://ethglobal.com/showcase/lotus-9vnou · https://github.com/Lotusfi/Lotus_main |
| **3rd** | **TenorFi** | Fixed-for-floating **funding-rate swap for perps**: custom `_fundingSettle` opcode settles `net = clamp(R−F, ±cap) × notional × period/3600` each period; hedger posts zero collateral (premium pulled JIT from wallet), reserve pre-funds one period's worst case as an Aqua balance; Chainlink CRE reads Hyperliquid BTC funding; LI.FI onboarding | 1 | https://ethglobal.com/showcase/tenorfi-06wnb · https://github.com/0xYudhishthra/TenorFi (134 commits; same author as Aqua0) |
| 4th | **Ballast** | Leveraged, oracle-anchored liquidity: `leverageSwapXD` (constant product on `real × λ` virtual reserves, output clamped to real balance) + `oracleAnchorXD` (pre-swap ceiling at `Chainlink × (1+band)`, one-directional maker protection); program order `fee → oracleAnchor → leverageSwap`; mainnet-fork demo on WETH/DAI w/ real ETH/USD feed | 2 | https://ethglobal.com/showcase/ballast-7jpyp · https://github.com/mcmoodoo/Ballast (12 commits) |

Non-winning NYC Aqua submission: **Smile** — options market: SwapVM for volatility-surface market making, Aqua to spread collateral across strikes, Chainlink CRE settlement, Uniswap v4 hook reprices vol surface (won Uniswap 3rd only; 114 commits, 825-line README; https://github.com/oslinin/Smile).

### 2.3 ETHGlobal Lisbon 2026 (July 2026) — the deepest Aqua field so far (≈20 Aqua projects of ~196)

| Place | Project | What it built | Custom opcodes | Links |
|---|---|---|---|---|
| **1st** | **ArcBook** | On-chain order book where each maker position is a bounded **executable pricing curve** (buy/sell inventory, price range, alpha shape); fixed-point curve kernel compiles params into SwapVM state; custom instructions execute fills, update state and **recycle incoming inventory into the opposite curve without moving marginal price**; Lens + Quoter contracts; deterministic multi-maker solver; Subgraph; read-only "Executable Liquidity MCP"; Base Sepolia; adversarial tests, release gate. Finalist; The Graph 2nd | yes (several) | https://ethglobal.com/showcase/arcbook-twp2a · https://github.com/Ryad2/liquid_OB (69 commits) · https://arcbook-nu.vercel.app |
| **2nd** | **Votive** | "Wishes" (funded AI tasks) as Aqua positions quoting themselves; `AquaSwapVMRouter` extended with **seven** opcodes: capability-open, condition-met, still-live, performance-fee, human-backed-filler, good-standing, standing-bonus; browser encodes program with pinned opcode indices and checks `keccak(program)` vs router hash | 7 | https://ethglobal.com/showcase/votive-p78qo · https://github.com/resistingdestiny/wishing-well-votive (213 commits) |
| **3rd** | **KSwap-VM** | **Formal verification** of SwapVM: 281 Kontrol-proved properties across 13 instruction suites (bounds, rounding direction, overflow); hand-written K semantics for 20/52 opcodes; theorem for the `OnlyTakerTokenBalanceNonZero` gate with the program tail left symbolic; demo app "DustProof/sweeper" (4-instruction dust-sweeping program: `0x23 gate, 0x20 Deadline, 0x50 XYCSwap, 0x02 Salt`) | none (verification) | https://ethglobal.com/showcase/kswap-vm-aix5n · https://github.com/vovunku/swap-vm-verified (613 commits, fork of swap-vm) · https://github.com/vovunku/sweeper |
| Continuity 1st | **Pool Party** | OAMS investor app; "Active Reserve" track: managed USDC reserve on Arbitrum market-made through Aqua/SwapVM; companion contracts repo `0xmvercosa/pool-party-aqua`. Also Uniswap "Best Stack Contribution" 1st | UNCERTAIN | https://ethglobal.com/showcase/pool-party-s7i6a · https://github.com/PoolPartyLabs/pool-party-v2-frontend (228 commits) |
| Continuity 2nd | **Agora Markets** | Prediction-market-based governance; live market phase entirely on Aqua/SwapVM: makers `shipQuote` fill-or-kill lots, takers fill via `router.swap`; backend indexes Shipped/Swapped/Docked into candles | UNCERTAIN | https://ethglobal.com/showcase/agora-markets-0ke7v · https://github.com/0xbri3t/Agora |

Lisbon Aqua projects that did **not** place in the 1inch track (all worth reading — many are stronger engineering than some winners):

| Project | Idea | Opcodes / mechanics | Repo (commits) |
|---|---|---|---|
| Bebecita | Order book whose maker inventory stays inside a Uniswap v4 LP position; custom instruction **0x92** (balance-tuning bank) clamps `balanceOut = min(balanceOut, free float + reachable collateral)`; pre/post-transfer hooks unwind/redeposit via Uniswap API in the fill tx; 17–19 fills on Ethereum Sepolia via canonical Aqua `0x499943E74FB0cE105688beeE8Ef2ABec5D936d31` | 1 | https://github.com/gamween/bebecita (104) |
| Doca | "Budget layer": `InventorySkewProvider` = `IProtocolFeeProvider` plugged into stock `AquaDynamicProtocolFeeAmountIn` (opcode 30 at swap-vm `b44977a1`; note "upstream main has since re-banked the opcode space"); fee flat while budget healthy, quadratic as it drains, directional (outgoing token only); off-chain "Harbormaster" docks/re-ships when wallet balance moves. Explicitly identifies that `Aqua.ship` doesn't check balance/allowance (Aqua.sol:40-52) | 0 new (fee provider) | https://github.com/ottodevs/doca (143) |
| QilinSwap | Visual (React Flow) strategy builder → SwapVM bytecode; 2 self-authored opcodes `0x22 InventorySkew`, `0x23 IfInventoryAbove` in a redeployed router (`BacalhauRouter`) on Base Sepolia; 235 vitest + 19 forge tests; Substreams + subgraph; MCP copilot | 2 | https://github.com/AdCazzum/qilinswap (65) |
| Sluice | NL intent → risk-rated Aqua strategies; LLM only fills slots in 4 fork-tested templates (XYC curve, band, fee, deadline); deterministic validator + compiler; 0G TEE inference; ships via Multicall | 0 | https://github.com/subvisual/sluice (58) |
| Aquapilot | "First SwapVM strategy composer": TS port of encoder byte-verified against `ProgramBuilder`; uses `SwapVMRouter` with Aqua trait rather than `AquaSwapVMRouter` to get the full instruction set | 0 | https://github.com/erdemasik001/aquaPilot (9) |
| Wave | Social feed where "likes are capital"; deterministic compiler (Zod→AST→IR→bytecode); 2 new opcodes `_inventorySkew2D`, `_oracleGuard2D`; ENS subnames per strategy; Sepolia | 2 | https://github.com/ppezzull/wave |
| Superpose | One wallet balance backs a covered call, a guarded XYC AMM and a tokenized option; `SolvencyGuard` enforces `headroom = walletBalance − totalReserved` across all apps (addresses `Aqua.pull()` not checking coverage); `GuardedAquaSwapVMRouter` with a custom opcode for the option secondary market; 0G AI risk agent. Won 0G prize | 1 | https://github.com/Thirumurugan7/Ethglobal-Lisbon (98) |
| Turing Swap / Turing Pool | Identity-priced liquidity: custom instruction `_humanGate` reads World AgentBook `humanId` at quote time; per-human daily quota; revenue-neutral fee controller targeting 30 bps blended; **World Chain mainnet** deployment (Aqua at `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec`). Won World 3rd | 1 | https://github.com/virajbhartiya/turing-pool (56) |
| ScubaSwap | Two instructions `_onlyHumanTaker`, `_jumpIfHumanTaker` verifying World ID v4 proofs on-chain; human 0.05% vs bot 0.30% fee tiers in one pool; `ScubaSwapVMRouter` on unmodified Aqua | 2 | https://github.com/shuva10v/scuba-swap |
| Baywatch Radar | Toxic-flow defence: Graph Messari DEX-AMM markout score → on-chain `ParamOracle` → 3 custom opcodes (global spread, per-taker toll, depeg circuit breaker); same oracle drives a Uniswap v4 hook | 3 | https://github.com/mcmoodoo/baywatch (12) |
| Aqua Prime (Prime Desk) | Inventory-healing desk: `SkewPricer` opcode shades quotes by virtual-balance imbalance; `PrimeSelector` as an **Extruction target** that runs 2–3 candidate programs and picks by `takerValue − λ·|postSkew|`; voice agent "Jarvis" on 0G + ENS | 1 + extruction | https://github.com/MiguelBits/ETH-Global-Lisbon-Aqua-Prime (50) |
| Vortex | Dual-venue router (Aqua vs Uniswap API, pick by net output); "Vortex Grow" same-asset compounding through a custom Aqua app (WBTC→USDC→WBTC atomic cycle, succeeds only if profitable); Uniswap v4 dynamic-fee "PermAMM" | custom app | https://github.com/ander-deran-arteaga/vortex (217) |
| RWA Outlet | Instant liquidity for tokenized RWAs: official Aqua + `AquaSwapVMRouter` redeployed **unmodified** on Sepolia (Aqua `0xA787Dd5eF559569b068283D2617e0D8484C08e9B`, router `0xc4D05Fc049B819DAAf2753d5a0D32402b8a76d47`); pricing via `NavExtruction` (IExtruction/IStaticExtruction duals so quote==swap); 3 modes (fixed spread / Dutch decay / AMM); KYC via soulbound NFT checked by **stock** opcodes; ERC-7540 queue; 93 forge tests. Won Uniswap 3rd | extruction only | https://github.com/rwa-outlets/rwa-outlet-contracts-core (22) |
| Alba | Keeper-free revolving credit: `TermRouter` inherits `AquaSwapVMRouter`, overrides `_instructions()` to add 3 opcodes; relies on `useAquaInsteadOfSignature` so settlement months later needs no signature. Won Hedera prize | 3 | https://github.com/acollette/alba |
| SeaLevel | Stablecoin AMM Aqua app written in **Plank** (new language) with ABI wrapper; Rust indexer/quoter | app | https://github.com/Philogy/sealevel |
| signalflo | Fund-manager "rounds" backed by members' self-custodial Aqua positions on Base; EIP-7702 `PositionMandate` delegate lets manager close positions; salt-less program re-salted per member | 0 | https://github.com/droplinked/signalflo |
| Omega | Compliance-gated yield desk routing via 1inch; touches Aqua registry address in code | 0 | https://github.com/DZ-Ramzy/ETH-Lisbon-2026 (15) |
| aqua-arkiv-indexer | Read layer: reconstructs live strategies from events and computes maker **solvency** across all apps; stored on Arkiv | 0 | https://github.com/marcos-golem/aqua-arkiv-indexer (14) |

### 2.4 Other Aqua repos found (not tied to a placed submission)
- `nbailo/ai-web3` "CryptoCatalyst" (Nov–Dec 2025): agentic RFQ maker on Aqua; real Base mainnet trade tx.
- `ctb0k33/1inch-SwapVM` (Nov 2025): fork of swap-vm.
- `yellowBirdy/aqua-propAMM` (Aug–Sep 2026): `OracleSwap` Aqua app priced by immutable Chainlink feeds; exact-in/out both directions; "three ways to build on Aqua" diagram.
- `alextianyushi/agentarena-1inch-contest` (2026-08-02): vendored aqua + swap-vm, 1 commit, no README (an AI-agent contest scaffold; nothing public found about the contest).
- `lfglabs-dev/ethereum-verification-benchmark`: includes `cases/1inch/xycswap_curve_safety` (XYCSwap as a verification benchmark case).
- `1inch/aqua-app-template` (contracts: `AquaImport.sol`, `SwapExecutor.sol`, `XYCSwap.sol`; Hardhat; `yarn build/test/node/deploy:localhost`) and `1inch/swap-vm-template` (`contracts/AquaAMM.sol`) are the official starters; several BA projects were built directly from them.

### 2.5 Projects being built RIGHT NOW for ETHOnline 2026 (your direct competition; all created 2026-09-02..05)

| Repo | Track | Idea | Status (README) |
|---|---|---|---|
| https://github.com/Khalid-000-ME/keel (19 commits) | main | **Avellaneda–Stoikov reservation-price** market maker: custom instruction (opcode `0x92`) reads `aqua.safeBalances(maker, app, strategyHash, tokenIn, tokenOut)` and skews quotes by inventory imbalance; same kernel as a Uniswap v4 dynamic-fee hook; sim "receipt" (stock −26.6 PnL vs Keel −4.26 over 40 adversarial fills) | Live on Base Sepolia: Aqua `0xAf5Bb8e83F3d22Ec349dB641E0Bd7edA5d9574CD`, `KeelRouter` `0x1771093A5094FCc818775806eD8a729f6cF7DA0E`, `KeelSkewHook` `0x52EBAdE332113825827b4Ad2Dc55B1743E9A40C0`; subgraph live; 24 forge + 4 SDK tests |
| https://github.com/LeonardoRyuta/overdraft (16) | main | "Phantom depth" measurement: `coverage = min(wallet, allowance→Aqua) / Σ virtual committed`; finding on Ethereum mainnet 2026-09-05: 35 live positions, $134,510 quoted vs $131,288 backed, $25,109 phantom across 14 under-backed positions, 7 positions with virtual balance > token supply; ships a SwapVM instruction that stops over-commitment | Ethereum done, Base pending subgraph |
| https://github.com/EndPx/slope (40) | main (Start Fresh) | Taker-side execution: split a large swap over time along Aggressive/Neutral/Conservative curves (better than linear TWAP); Privy embedded wallet + delegated keeper; settles through official Aqua/SwapVM **v1.0.2 self-deployed to Base Sepolia**; Graph benchmark vs linear TWAP; spec-first repo with rules-compliance doc | spec + research committed, implementation in progress |
| https://github.com/barkermoney/barker-alm-engine (13) | **Continuity** | Yield-backed market making: maker capital sits in an ERC-4626 vault (steakUSDC) while quoting stable pairs; on fill atomically redeem exactly what's needed; solvency guard live on mainnet fork; plus Uniswap v4 single-sided CL on Arc | Arc leg deployed; Aqua settlement hooks "next" |
| https://github.com/Aqua0-fi/aqua0-ethglobal (1) | likely Continuity (Aqua0 team) | Cross-chain shared liquidity for **non-USD stablecoins**: `FXSwap` opcode on Aqua, agentic Graph indexer, deployed on Arc, terminal-driven | 1 commit, empty README as of 2026-09-05 |
| https://github.com/maulana-tech/qia-1inch (40) | main | "Iqia": ZK-shielded balances (Noir/UltraHonk) + liquidity that never leaves maker wallet; **two custom SwapVM opcodes, 29 tests**; Base Sepolia | migration from prior chain in progress (README in Indonesian) |
| https://github.com/yellowBirdy/aqua-propAMM (14) | unknown | oracle-priced propAMM app (see 2.4) | experimental |

---

## 3. Historical 1inch-track winners before Aqua (2024–2025) and what they show

- **ETHGlobal Singapore 2024** (Sep): 1inch $8k "integrate Fusion+". **Bangkok 2024** (Nov): 1inch sponsored (Fusion+ / LOP / APIs). Winners not recoverable from indexed sources (UNCERTAIN).
- **Prague 2025 / Cannes 2025 / New Delhi 2025**: identical 3-track menu — (a) "Non-EVM extensions for Fusion+" $12k (Prague: up to 6 × $2k; Cannes/New Delhi: $6k/$4k/$2k; escrow must be deployed via LOP `fillOrderArgs`, hashlock/timelock preserved, bidirectional, on-chain transfers shown); (b) "Extend Limit Order Protocol" $6.5k ($3k/$2k/$1.5k; "options hooks, concentrated liquidity, TWAP"; judged on "innovation, code quality, documentation"); (c) "Utilize 1inch APIs" $1.5k.
- **Unite DeFi (online, Jul 25–Aug 6 2025)**: $525k, 1,120 hackers, 403 submissions. Cross-chain track: 11 chain-specific winners (Nether Swap/Sui, GattaiSwap/Bitcoin+Monad, AptosIntegration, 1inch Fusion+ Bridge/Tron, StarknetFusion+, XRoute/Tezos, CardanoSwap, CellJMP/TON, X3 Fusion/NEAR, AvgInch/ICP). LOP track: **Super Order** (stop-market hook ~99k gas, iceberg orders with 4 reveal strategies ~80k gas, OCO via `PreInteraction` cancelling the pair; all via `IAmountGetter`, Chainlink automation) and **1delta Unite** (margin trading through LOP: `preInteraction` deposits/borrows on Aave/Morpho, `takerInteraction` swaps via Uniswap v3, Morpho flash loan wraps settlement — filler needs no inventory). API track: 1inchTeleport, BYOB. 1inch's own commentary was generic ("overwhelming number and quality of submissions"); no rubric published.
- **Buenos Aires 2025** was the pivot: LOP/Fusion+ tracks disappeared and the Aqua track took the whole $17k; from NYC 2026 on, Aqua is the **only** 1inch track.

Pattern in pre-Aqua LOP winners: real protocol-level extension (hooks/interactions), gas numbers quoted, composability with lending/DEX venues, institutional order types. This carried directly into what wins on Aqua.

---

## 4. What actually wins the Aqua track (evidence-based)

1. **A custom SwapVM instruction that encodes a genuinely new position economics.** Every 1st/2nd/3rd at NYC and Lisbon modified the VM: RiverSwap (dynamic fee opcode), Lotus (3 one-way-fill opcodes), TenorFi (`_fundingSettle`), Ballast (2), ArcBook (curve + recycling instructions), Votive (7), KSwap-VM (verifies the instruction set). The only pure-`AquaApp` (no SwapVM) placements are from Buenos Aires, 6 days after release, when nobody knew the VM; even there the 1st place was a SwapVM instruction (pm-AMM). Treat "SwapVM scored higher" as decisive.
2. **A recognisable DeFi primitive, named in TradFi/DeFi terms, with a formula.** pm-AMM invariant; am-AMM fee auction; interest-rate swap for funding; leverage + oracle anchor; executable pricing curves; Avellaneda–Stoikov. Judges are 1inch protocol engineers (Anton Bukov ran the BA workshops); mechanism clarity beats product polish.
3. **Real settlement shown on-chain, with addresses.** Winners either ran on a mainnet fork with real tokens/feeds (Ballast: WETH/DAI + real ETH/USD feed; TenorFi: Base-mainnet fork moving real USDC) or deployed to a public testnet with verified contracts and multiple fills (ArcBook Base Sepolia; Bebecita 17+ fills on Ethereum Sepolia; Turing Pool on World Chain **mainnet**). Note: canonical Aqua is mainnet-only; most testnet projects self-deployed Aqua + a modified router (explicitly allowed).
4. **Tests and reproducibility as a visible feature.** ArcBook: adversarial tests + `pnpm release:verify`; KSwap-VM: 281 proofs + negative-control twins; Keel: fuzzed quote/swap parity + reproducible sim receipt; RWA Outlet: 93 forge tests; QilinSwap: 235+19 tests. Winners' READMEs lead with what is proven, and state limitations honestly (KSwap-VM "read this before believing anything").
5. **Git history that reads as work.** Explicit rule. Winning repos have 39–213 commits over the weekend; ArcBook's README says "Protocol work was introduced through small, reviewable commits". RiverSwap's public repo shows only 5 commits (UNCERTAIN whether history was squashed/private) — the exception.
6. **Multi-track composition is common but not what wins the 1inch prize.** Many Lisbon Aqua projects bolted on The Graph/0G/World/Uniswap tracks; those won *those* prizes (Superpose→0G, Turing→World, RWA Outlet→Uniswap) but not 1inch. The 1inch winners were the ones whose *core* was the Aqua position.
7. **UI is optional; a script/test demo is fine.** Ballast's "live demo" link is `http://localhost:3000`; RiverSwap is a barebones local DEX; KSwap-VM has no product UI. Prize text says "tests scripts or a UI".
8. **Prize sizes are small ($1k–$2.5k per placement) but 1inch follows up**: Aqua0 (a 4th place) was incubated by 1inch and marketed as "one of the first projects built on 1inch Aqua"; TenorFi is the same author's second win. Continuity Track exists precisely for this.

Anti-patterns observed in non-placing entries: mock Aqua (Pagga), integration-only "Aqua as a routing backend" without a new position (Coco placed at BA but wouldn't now), leaving SwapVM for the plain template (aqua-flash-loans), heavy AI/agent framing where the on-chain position is thin, 1–5 commit repos.

---

## 5. Version note for anyone reusing prior projects' code

Prior projects cite numeric opcodes (`0x92` balance bank, `AquaDynamicProtocolFeeAmountIn` = opcode 30 at swap-vm `b44977a1`, `0x22/0x23` custom, `0x50 XYCSwap`, `0x23 OnlyTakerTokenBalanceNonZero`, "52 opcodes"). Doca's README notes "upstream main has since re-banked the opcode space". In the local `1inch/swap-vm` clone (HEAD `f09a41e`, 2026-09-03, "remove-progressive-fees"), opcodes are an enum in `src/libs/OpcodeList.sol` with banks: `0x00-0x0f` control flow, `0x10-0x1f` debug, `0x20-0x3f` conditions/guards, `0x40-0x4f` invalidators/epochs, `0x50-0x6f` swap curves, `0x70-0x8f` fees, `0x90-0xaf` balance tuning, `0xb0-0xcf` rate tuning, `0xd0-0xef` unallocated, `0xf0-0xff` reserved. `AquaOpcodes._runOpcode` currently dispatches only: Jump, JumpIfTokenIn, JumpIfTokenOut, Deadline, OnlyTakerTokenBalanceNonZero/Gte, OnlyTakerTokenSupplyShareGte, XYCSwap, XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction, OnlyTxOriginTokenBalanceNonZero (`src/opcodes/AquaOpcodes.sol:27-44`); `AquaSwapVMRouter is Simulator, SwapVM, AquaOpcodes` with `_dispatch` → `_runOpcode` (`src/routers/AquaSwapVMRouter.sol:16-27`). Instruction files present: Balances, BaseFeeAdjuster, Controls, Decay, DutchAuction, Extruction, FeeFlat, FeeProtocol, Invalidators, Jumps, LimitSwap, MinRate, OraclePriceAdjuster, PeggedSwap, PiecewiseLinearScale, SeriesEpochManager, TokenValidators, TWAPSwap, Whitelist, XYCConcentrate, XYCSwap. Pin the exact commit you build against and state it in the README (Slope pins `v1.0.2`; Doca pins `b44977a1`).

Extension patterns used by prior winners (all valid under "redeploy modified SwapVM"):
- Subclass `AquaSwapVMRouter` and override `_instructions()` / `_dispatch` to append opcodes (Alba, Votive, Lotus, QilinSwap, ScubaSwap, Keel).
- Use stock `Extruction` with a custom `IExtruction`/`IStaticExtruction` contract, keeping the official router untouched (RWA Outlet `NavExtruction`, Aqua Prime `PrimeSelector`) — cleanest "official contracts used as-is" story.
- Plug a custom `IProtocolFeeProvider` into the stock dynamic-fee instruction (Doca) — note that instruction may no longer exist after "remove-progressive-fees" (UNCERTAIN; check `FeeProtocol.sol`).
- Plain `AquaApp` with custom invariant and hooks (`preTransferOut` etc.) without SwapVM (Aqua0, Aqua Outcome Market's minting hook, aqua-flash-loans).

---

## 6. Ideas already taken (do not resubmit as-is)

- Prediction-market pm-AMM with JIT minting + Euler credit (Aqua Outcome Market, BA 1st).
- Auction-managed AMM / fee-rights auction (RiverSwap, NYC 1st).
- One-way / directional fills for large holders (Lotus, NYC 2nd).
- Fixed-for-floating perp funding-rate swap (TenorFi, NYC 3rd).
- Leverage on virtual reserves + Chainlink oracle ceiling (Ballast, NYC 4th).
- Executable pricing-curve order book with inventory recycling + solver + MCP (ArcBook, Lisbon 1st).
- Funded-task/"wish" positions with filler gating opcodes (Votive, Lisbon 2nd).
- Formal verification of SwapVM (KSwap-VM, Lisbon 3rd).
- Managed reserve market-made via Aqua (Pool Party, Continuity 1st); FOK quote lots for prediction-market governance (Agora, Continuity 2nd).
- Cross-chain Aqua via LayerZero: StableSwap + concentrated-liquidity AquaApps (Aqua0), ghost AMMs shipped via composeMsg (CrossRevEngine), FX stablecoin cross-chain (aqua0-ethglobal, in progress now).
- Oracle-centred proactive MM (ProaqctiveMM, aqua-propAMM); inventory-skew pricing (Aqua Prime `SkewPricer`, QilinSwap `InventorySkew`, Wave `_inventorySkew2D`, Doca fee curve, **Keel's Avellaneda–Stoikov — live now**).
- Uniswap-v4-position-backed order book with JIT unwind (Bebecita); yield-vault-backed quoting with JIT redeem (barker-alm-engine — live now; Aqua Outcome Market hook; Smile).
- Solvency/over-commitment guards: `SolvencyGuard` shared headroom (Superpose), budget fee + Harbormaster (Doca), coverage measurement (overdraft — live now), Arkiv solvency indexer.
- Identity-priced liquidity (World ID / AgentBook gates: Turing Pool, ScubaSwap); toxic-flow tolls from Graph markout (Baywatch).
- NL/visual strategy composers → SwapVM bytecode (Sluice, Aquapilot, QilinSwap, Wave, CryptoCatalyst); Aqua strategy indexers/read layers (aqua-arkiv-indexer, several subgraphs).
- Options on Aqua: covered calls / tokenized options (Superpose), vol-surface MM across strikes (Smile).
- Flash loans on Aqua (aqua-flash-loans); privacy pools feeding Aqua (CUM, Private Deals, Iqia); basket-vault MM with rebalancing (1Wave); RWA NAV pricing via extruction with KYC gate (RWA Outlet); keeper-free revolving credit via `useAquaInsteadOfSignature` (Alba); memecoin perps vAMM (Poorps); taker-side adaptive TWAP execution (Slope — live now); dual-venue Aqua-vs-Uniswap routing with profit-only compounding (Vortex); x402 payments settled through Aqua (omni402, Pagga).

## 7. Whitespace (not found in any prior submission)

Positions nobody has built as a SwapVM instruction yet:
- **Lending/borrowing as an Aqua position** (explicitly listed by 1inch as a suggested example since BA; only Alba's revolving credit and 1delta's LOP margin trading come close). E.g. a maker quoting a collateralised loan (token-out = principal, token-in = collateral) with interest accrual and liquidation encoded as instructions; or a repo/lending-book where the same wallet balance backs both an AMM curve and a lending offer.
- **Perpetual / synthetic exposure where Aqua virtual balances *are* the margin account** (Poorps was a 2-commit stub; TenorFi only swapped funding). Funding, mark-vs-index, and liquidation as opcodes.
- **Structured products / vanilla options priced by an on-chain Black-Scholes-ish or binomial instruction** (Smile used off-chain CRE; Superpose used simple covered calls). A `_bsQuote` instruction with IV as maker parameter + Decay toward expiry is untaken.
- **Bonding curves / token launches (Dutch-decay + XYC handoff) as an Aqua position**: `DutchAuctionBalanceIn/Out`, `PiecewiseLinearScale`, `SeriesEpochManager` instructions exist in swap-vm but no hackathon project has built a launch/vesting/epoch-series product on them.
- **Stable-stable / pegged-asset curves with depeg protection using stock `PeggedSwap` + `OraclePriceAdjuster` + `RequireMinRate`** — only SeaLevel (Plank experiment) and Baywatch's circuit breaker touched this; a Curve-v1-style stableswap *instruction* (Aqua0 did it as an AquaApp, not SwapVM) is open.
- **Maker-side risk controls beyond inventory skew**: `Whitelist`/`PrivateOrder` RFQ books for institutions, `InvalidateBit`/epoch-based order series — none used in submissions (Private Deals tried privacy, not RFQ). An "RFQ desk on Aqua" with sequential whitelist + series invalidation is untaken.
- **Yield-bearing collateral inside the fill path using official instructions only** (barker is doing vault-redeem hooks now; nobody has done ERC-4626 share-denominated quoting via `Extruction`, which keeps the official router unmodified).
- **Cross-venue arbitrage/hedging positions where the taker callback (`IAquaAppSwapCallback`) hedges on Uniswap v4 within the same tx** (Vortex Grow is maker-side compounding; a taker-side atomic hedge / basis trade position is open).
- **Multi-token (≥3-asset) positions** — every submission is a 2-token pair; a triangular/basket invariant over one wallet balance is untaken.
- **Insurance / parametric payout positions** on Aqua (Canary at NYC used prediction markets on Arc, not Aqua).
- Tooling gaps repeatedly complained about in READMEs (and therefore good "Continuity"-style or side deliverables, but *not* sufficient alone): no public Aqua frontend (Aquapilot, Sluice), no solvency/coverage tooling (overdraft now), no TS encoder parity tests (Aquapilot/Wave built their own), canonical Aqua being mainnet-only (every testnet project self-deploys).

Calibration for the current field: as of 2026-09-05 the visible ETHOnline 2026 Aqua entrants are Keel (inventory-skew MM, already deployed with tests), overdraft (coverage tool + guard instruction), Slope (taker TWAP), barker (Continuity, vault-backed MM), aqua0-ethglobal (Continuity, FX cross-chain), Iqia (ZK + 2 opcodes). A lending/perp/structured-product position with a custom instruction, real-token fork demo, fuzzed quote/swap parity, and a 50+-commit history would be differentiated from all of them.
