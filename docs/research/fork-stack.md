# Fork stack KB — Aqua / SwapVM local-fork demo (verified 2026-09-05)

All numbers below were measured on 2026-09-05 (~19:00–23:20 UTC) with `cast 1.0.0-dev (7461390, 2025-04-30)` and `anvil 1.1.0-nightly (a63dbe2, 2025-04-30)` on macOS. Anything not measured is marked UNCERTAIN. Scripts used are in `/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad/work/` (`probe.sh`, `cfg.sh`, `hash_and_deploy.sh`, `deploy2.sh`, `logs.sh`, `fullscan.sh`, `basescan.sh`, `oracles.sh`, `whales2.sh`, `forktest.sh`, `forgetest.sh`, `ethfork.sh`, `domaintest.sh`).

## 0. TL;DR / decisions

- **Fork Base (chain 8453)** for the demo, run anvil with **`--chain-id 31337`**, fork from **`https://gateway.tenderly.co/public/base`** (archive, fast; anvil came up in ~1 s) with `https://mainnet.base.org` as fallback. Rationale in §8.
- Both official contracts are live and **source-verified (exact match)** on Ethereum, Base, Arbitrum, Optimism, Polygon; Aqua bytecode is byte-identical on all five chains (`keccak(code) = 0x720bc02d…341f8`). The router's `AQUA()` returns the official Aqua on every chain.
- **Aqua has heavy real usage on Ethereum** (1.83 M Aqua events / 254 k txs / 112 k `ship()`s since 2026-07-19, 1,042 makers) and **modest but real usage on Base** (7,046 events / 1,873 txs / 436 ships / 112 makers since 2026-07-19; 252 events in the last ~28 h). On both chains **the official `AquaSwapVMRouter` is essentially the only app** (ETH: 99.3 % of ships, Base: 435/436; the remainder is an earlier router deployment `0x1111113db0…`, see §2.4). No third-party apps were observed.
- The full recipe (fork → fund via `anvil_setBalance` + whale impersonation → `forge create` our own `AquaSwapVMRouter` pointed at the official Aqua → `Aqua.ship()` → `rawBalances`) was **executed end-to-end on a Base fork and worked** (§6.6).
- Chainlink ETH/USD, BTC/USD, USDC/USD and Aave v3 Pool/aTokens verified on both Ethereum and Base (§9).

## 1. Official deployments

| | Aqua registry (`AquaRouter`) | SwapVM router (`AquaSwapVMRouter`) |
|---|---|---|
| Address (same on all chains) | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` | `0x111111338c5091e8440b67b168bae16a668ac0de` |
| Contract name (verified) | `AquaRouter` (= `Aqua` + `Simulator` + `Multicall` + `Rescuable`, `aqua/src/AquaRouter.sol:18`) | `AquaSwapVMRouter` (`swap-vm/src/routers/AquaSwapVMRouter.sol:16`) |
| Compiler / settings (Blockscout) | solc `v0.8.30+commit.73712a01`, optimizer 10,000,000 runs, evm `prague` | solc `v0.8.30+commit.73712a01`, optimizer **700** runs, evm `prague` |
| Runtime code length | 5,620 bytes (11,241 hex chars) | 20,542 bytes (41,085 hex chars) |
| keccak(runtime code) | `0x720bc02d220db318164dc3bade86eec1f3655bdc00fc1174de7d816a95c341f8` on ETH/Base/Arb/OP/Polygon (identical) | differs per chain (immutables: WETH, EIP-712 cache): ETH `0x1ffc5730…340f9`, Base `0x833541ad…3a51d`, Arb `0x7cb8785d…d580e`, OP `0x326fad13…398be`, Polygon `0xf1c1b001…02871` |
| Ethereum: first block with code | **25567141** (2026-07-19 13:45 UTC), creation tx `0xe37e4dd7e73302a57cbf8ef6cff2424a787df9bf462d69f2de6d149dca43fb1a` | **25618917** (2026-07-26 18:59 UTC), creation tx `0xc7eccb690b89094ab5ef0510164f2dd05a601f61449de45466fc855ccbb7d4cc` |
| Base: first block with code | **48839900** (2026-07-19 13:52 UTC), creation tx `0x6ce475fdeedd0c0df488f5b65bec1b38b714174bd9fbc399a87586f43498045e` | **49151361** (2026-07-26 18:54 UTC), creation tx `0x1398f07ed6a04b785efd8b93dafc6f1cd47521cd85ef6dacbfc37871e4733d69` |
| Creator | EOA `0x0BD61d605C64A857C3D94779aEf7cA295702b3A2` (Etherscan label "deploy-hub.eth" / "1inch: Deployer") via factory `0x6C51dEc3597cf764906306686b8aebbCc83a188B` (Blockscout `creator_address_hash`) | same EOA via factory `0x630CA0f0Cc22Cef1E4A3694Cb2d8914B30192ced` |
| Constructor args (ETH, Blockscout-decoded) | n/a (owner only; not decoded) | `aqua=0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`, `weth=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, `owner=0x4134e66d52EfC4C77DD8Ccc952D87b9E92E0C352`, `name="1inch SwapVM v1.0"`, `version="1.0.2"` |
| Current `owner()` | not queried | `0x5AFc5DF416640348235a0571dBEEf9064cb0338D` on all 5 chains (ownership transferred; on ETH `OwnershipTransferred` at block 25645575) |
| `eip712Domain()` | n/a | `fields=0x0f, name="1inch SwapVM v1.0", version="1.0.2", chainId=<chain>, verifyingContract=0x111111338c…` on all 5 chains |
| Explorer tx count (2026-09-05) | ETH: 151,712 (Etherscan) / 152,223 (Blockscout); Base: 457 (Basescan) | ETH: 215 txs, 144,238 token transfers; Base: 21 txs (Basescan) |

Notes
- `router.WETH()` **reverts** on the deployed 1.0.2 routers on all chains, although `swap-vm/src/SwapVM.sol:85` (repo HEAD) declares `IWETH public immutable WETH`. The deployed version is `1.0.2`; the repo's Ignition params say `1.2.0` (`swap-vm/ignition/parameters/chain-1.json`). So **the deployed router is an older revision than the repo HEAD** — UNCERTAIN exactly which commit; treat opcode tables/ABI of the *deployed* router as possibly different from HEAD. (Our own router will be built from HEAD, which is allowed: "redeployments of a modified SwapVM contract is allowed".)
- Explorer pages: https://etherscan.io/address/0x1111113ccf1426a8e30e2bff5e005d929bf6a90a , https://etherscan.io/address/0x111111338c5091e8440b67b168bae16a668ac0de , https://basescan.org/address/0x1111113ccf1426a8e30e2bff5e005d929bf6a90a , https://basescan.org/address/0x111111338c5091e8440b67b168bae16a668ac0de ; Blockscout JSON (no key): `https://{eth,base}.blockscout.com/api/v2/addresses/<addr>`, `/counters`, `/smart-contracts/<addr>`.
- The swap-vm repo's `broadcast/__DeployPadCreate.s.sol/{1,8453,42161,10,137}/run-latest.json` records an **earlier, different** `AquaSwapVMRouter` at `0x3c4758979ec30ca45857cabc2462a70699ed790e` (2026-06-16, aqua=`0x4a055AA172C98ec32de118B9B5b6AC8B4099A580`, version "1.0.1"), and a still earlier one at `0xdfd05fe230bfe7b212878414270c72c8345506fa` (2026-03-27). Those are **not** the official addresses; ignore them.
- SDK address maps: `sdks/typescript/swap-vm/src/swap-vm-contract/constants.ts:20-33` (`AQUA_SWAP_VM_CONTRACT_ADDRESSES`) and `sdks/typescript/aqua/README.md:191-200` (`AQUA_CONTRACT_ADDRESSES`) — both list the same two addresses for chains 1, 56, 137, 42161, 43114, 100, 8453, 10, 324, 59144, 130, 146, 4663, 143, 25, 999.

### 1.1 Bytecode presence per chain / RPC (measured)

| Chain | RPC | block | Aqua code | Router code |
|---|---|---|---|---|
| Ethereum (1) | `https://ethereum-rpc.publicnode.com` | 25913677 | `0x6080604052600436101561…` ✅ | `0x6101606040526004361015…` ✅ |
| Ethereum | `https://eth.drpc.org`, `https://1rpc.io/eth`, `https://gateway.tenderly.co/public/mainnet` | ✅ | ✅ | ✅ |
| Ethereum | `https://eth.llamarpc.com` (HTTP 521), `https://cloudflare-eth.com` (-32046 "Cannot fulfill request"), `https://rpc.ankr.com/eth` (needs API key) | ❌ dead/keyed | | |
| Base (8453) | `https://mainnet.base.org`, `https://base-rpc.publicnode.com`, `https://base.drpc.org`, `https://gateway.tenderly.co/public/base` | 50926319 | ✅ | ✅ |
| Base | `https://base.llamarpc.com` (521), `https://1rpc.io/base` (410 discontinued) | ❌ | | |
| Arbitrum (42161) | `https://arb1.arbitrum.io/rpc`, `https://arbitrum-one-rpc.publicnode.com` | 502121866 | ✅ | ✅ |
| Optimism (10) | `https://mainnet.optimism.io`, `https://optimism-rpc.publicnode.com` | 156521604 | ✅ | ✅ |
| Polygon (137) | `https://polygon-bor-rpc.publicnode.com` (✅); `https://polygon-rpc.com` → 401 "API key disabled" ❌ | 93291301 | ✅ | ✅ |

## 2. On-chain activity

Event topics (from `aqua/src/interfaces/IAqua.sol:41-71`, all params non-indexed → all in `data`):

```
Shipped(address maker,address app,bytes32 strategyHash,bytes strategy)          0xdc3622e06fb145651f567d421c9ef261d71d43e3778b761907bc0d70d42e52b0
Docked(address maker,address app,bytes32 strategyHash)                          0xd173a1d140c154eb1ce9298d251d5eb8c4089cc2d16e70f1067bdc810c6fe004
Pulled(address maker,address app,bytes32 strategyHash,address token,uint256)    0x3ad61047071575417c75e3311e5d46ff042e292b5dd8769ff18b4b254098ca7a
Pushed(address maker,address app,bytes32 strategyHash,address token,uint256)    0x3f18354abbd5306dd1665c2c90f614a4559e39dd620d04fbe5458e613b6588f3
SwapVM Swapped(bytes32 orderHash,address maker,address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut)  0x54bc5c027d15d7aa8ae083f994ab4411d2f223291672ecd3a344f3d92dcaf8b2
```
Decode: `maker = data[12:32]`, `app = data[44:64]`, `strategyHash = data[64:96]`, token (Pulled/Pushed) = `data[108:128]`.

### 2.1 Ethereum — full history, blocks 25567141 → 25913694 (2026-07-19 → 2026-09-05), via Tenderly

- **1,831,814 Aqua events in 254,631 txs**: Shipped **112,672**, Docked 109,295, Pulled 907,373, Pushed 702,472 (+2 `OwnershipTransferred`).
- **Apps**: `0x111111338c…` (official router): 111,842 ships / 905,603 pulls / 699,873 pushes / 108,555 docks. `0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de`: 830 ships / 1,770 pulls / 2,599 pushes / 740 docks, active blocks 25568872–25897743. **No other app address appears.**
- **1,042 unique makers**. Top by event count: `0x159896390d8a8f3d42fa58191e5c4e958cede14e` (133,609 events; 31,360 ships), `0x3bb5c8a00190da68059f0f66c24794584eb10d07` (111,751), `0x5510accff071694262fcb4dc317bf65a02aaf4f8` (71,271), `0xcb8804d2df7173da7634a6e303149429590105da` (71,171), `0x9919820b06b75c14e2a205089485621dc9b0fefc` (44,197; an EOA with 6,090 txs — the one Etherscan shows spamming ship/dock).
- **Tokens pulled/pushed** (event count): 1INCH `0x111111111117dc0aa78b770fa6a738034120c302` 762,379; WETH 152,864; USDC 143,437; USDT 117,218; UNI 86,351; WBTC 64,184; wstETH 54,712; DAI 28,634; USDe 24,257; AAVE 23,021; stETH 18,717; … (mostly 1INCH/WETH/stables — looks like 1inch's own market-making).
- Ships per 25k-block bucket: 314, 425, 127, 1001, 1564, 8804, 13988, **26035** (blocks 25.725–25.75 M ≈ mid-Aug peak), 17296, 19822, 13419, 4973, 2923, 1253, 728 → activity is **declining** from the mid-August peak but continuous.
- **Last 50,000 blocks (25863677→25913677, ≈7 days)**: 172,306 events in 27,530 txs; Shipped 3,162, Docked 3,182, Pulled 105,524, Pushed 60,438; 276 makers; 99.97 % via the official router (the old router: 22 pulls/21 pushes).
- Blockscout latest `ship`/`dock`/`multicall` calls to Aqua: 2026-09-05T19:46:47Z (i.e. minutes before the probe) — live.

### 2.2 Base — last 50,000 blocks (50876319→50926319, ≈28 h), via mainnet.base.org

- **252 Aqua events**: Pulled 163, Pushed 86, Shipped 2, Docked 1 — **all with app = official router**.
- 8 makers; top `0x181b8e10c8ffe94984964904908c312ab3cf380b` (149 events), `0xad44438923400ce0b520882a796c8d086305e7fc` (66).
- Tokens seen in the last chunk: WETH `0x4200…0006`, cbBTC `0xcbB7…33Bf`, ZRO `0x6985884c4392d348587b19cb9eaaf157f13271cd`.
- Blockscout: 50 most recent Aqua txs are `ship` 30 / `dock` 19 / `multicall` 1, spanning 2026-08-19 → 2026-09-04; router's recent txs: `swap` 18 / `quote` 1 / `transferOwnership` 1, from two taker EOAs (`0x80E5D67193E5dD897C4BFE7eC262F3f3e6F3f999`, `0x964d7d2b6696E65b84D68b1f45eCde442f060999`), 2026-07-30 → 2026-09-03.

### 2.3 Base — full history, blocks 48839900 → 50926400 (2026-07-19 → 2026-09-05), via mainnet.base.org (209 sequential 10k-block `eth_getLogs`, 0 errors, ~5 min)

- **7,046 Aqua events in 1,873 txs**: Shipped **436**, Docked 307, Pulled 3,564, Pushed 2,737 (+2 `OwnershipTransferred`).
- **Apps**: official router `0x111111338c…`: 435 ships / 3,564 pulls / 2,735 pushes / 307 docks. Old router `0x1111113db0…`: 1 ship (block 48875098, maker `0x410326e6…`). **No other apps.**
- **112 unique makers**. Top by events: `0xad44438923400ce0b520882a796c8d086305e7fc` (681), `0x181b8e10c8ffe94984964904908c312ab3cf380b` (627), `0x1a09f7d9b921c93f8fcd4bf04fe448982a3388ec` (506; 96 ships), `0x6dce3b39e9aff1099c7a756c2170593e928cc3f9` (489), `0x2467ebaf6860532384639836ca40706cd8f2cd17` (488), `0x2cfaeced473fe8de0ba8af592ea152ec04abc0c1` (453).
- **Tokens pulled/pushed** (event count): WETH `0x4200…0006` 1,982; USDC `0x8335…2913` 1,971; cbBTC `0xcbB7…33Bf` 533; ZRO `0x6985…71cd` 500; `0xfde4c96c8593536e31f229ea8f37b2ada2699bb2` 231 (USDT on Base — label UNCERTAIN); `0xa53887f7e7c1bf5010b8627f1c1ba94fe7a5d6e0` 201; `0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42` 127 (EURC, UNCERTAIN); `0x50c5725949a6f0c72e6c4a641f24049a917db0cb` 123 (DAI, UNCERTAIN); `0xbaa5cc21fd487b8fcc2f632f3f4e8d37262a0842` 111; `0x22af33fe49fd1fa80c7149773dde5890d3c76f3b` 88; 5 more with <65.
- First ship on the official router: block 49191927 (2026-07-27), tx `0x31212f3857435faef429f9361eaba105cb6613d9bc3fcc4aff1006785a7d61e7`. Last ships before probe: blocks 50876034–50879602 (2026-09-04), makers `0x1a09f7d9…` and `0x76b0340e…`.
- Shipped payload length: 962 hex chars (same shape as Ethereum) → makers on Base use the same SwapVM `Order` encoding; **WETH/USDC is the dominant pair**, which is exactly what the fork demo will use.
- All 436 Base `Shipped` events (block, tx, maker, app, strategyHash, raw `data`) are saved at `/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad/work/base_full3.raw.shipped.json` (520 KB) — use them to decode real SwapVM programs with the SDK / to pick a live strategy to swap against on the fork.

### 2.4 Second app on Ethereum: `0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de`
Verified `AquaSwapVMRouter` (Blockscout, verified 2026-07-19T13:47Z, i.e. same day as Aqua), `AQUA()` = official Aqua, `eip712Domain` = `"1inch SwapVM v1.0" / "1.0.2"`, creator factory `0x4C249c4A33Da39afF18C7c92c53e957Aa0f05E38`. Code also exists on Base. It is the **first** router deployment; the SDK-listed `0x111111338c…` (deployed 2026-07-26) superseded it. Not "another app" in any meaningful sense.

## 3. Repo facts you need for the fork stack

- Aqua interface (`aqua/src/interfaces/IAqua.sol`):
  - `function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts) external returns (bytes32 strategyHash)` — `strategyHash = keccak256(strategy)` (`aqua/src/Aqua.sol:41`); **no validation of `app`** (any address; verified by shipping to a freshly deployed router on the fork), max 254 tokens (`_DOCKED = 0xff`, `Aqua.sol:19,43`); emits `Shipped` then one `Pushed` per token (`Aqua.sol:45-50`).
  - `function dock(address app, bytes32 strategyHash, address[] calldata tokens) external` — must list all tokens (`Aqua.sol:57`).
  - `function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external` — `msg.sender` is the app; does `safeTransferFrom(maker, to, amount)` so **maker must have approved the Aqua address** for the token (`Aqua.sol:63-70`).
  - `function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount) external`.
  - `function rawBalances(address maker, address app, bytes32 strategyHash, address token) external view returns (uint248 balance, uint8 tokensCount)`; `safeBalances(maker, app, strategyHash, token0, token1) returns (uint256, uint256)`.
- SwapVM (`swap-vm/src/interfaces/ISwapVM.sol`): `struct Order { address maker; MakerTraits traits; bytes data; }`; `function swap(Order calldata order, uint256 amount, bytes calldata takerTraitsAndData) external payable returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)`; `quote(...)` same args, view; `hash(Order) view returns (bytes32)`. Strategy shipped to Aqua for SwapVM = `abi.encode(order)` and `strategyHash == orderHash` (`swap-vm/test/AquaAccounting.t.sol:318-326`). Real ETH Shipped payloads are 962 hex chars (94,652 of 112,672), 834 (17,021), 898, 1154, 1026 — i.e. abi-encoded `Order` with ~60–200 byte programs.
- Router constructor: `AquaSwapVMRouter(address aqua, address weth, address owner, string name, string version)` (`swap-vm/src/routers/AquaSwapVMRouter.sol:23`); inherits OpenZeppelin `EIP712` (`SwapVM.sol:7`), which **recomputes the domain separator when `block.chainid != _cachedChainId`** (`node_modules/@openzeppelin/contracts/utils/cryptography/EIP712.sol:83-91`). Measured: official router on a Base fork with `--chain-id 31337` reports `eip712Domain().chainId = 31337`; with `--chain-id 8453` reports 8453. → **Sign typed data with the fork's chain id** (fetch the domain from `eip712Domain()` rather than hard-coding).
- Build settings: `swap-vm/foundry.toml`: `solc_version="0.8.30"`, `optimizer=true`, `optimizer_runs=700`, `via_ir=true`; `aqua/foundry.toml`: `solc="0.8.30"`, `optimizer_runs=10_000_000`, `via_ir=true`. Deployed bytecode is `prague` EVM — anvil must run a prague-capable hardfork (default `latest` on anvil 1.1.0-nightly worked; `--hardfork prague` accepted).
- Deploy scripts: `swap-vm/script/DeployAquaSwapVMRouter.s.sol` reads params via `script/utils/Config.sol` from `config/constants.json` (keys `aqua`, `swapVmRouterVersion`, `swapVmRouterName` keyed by chain id; only `31337` present, aqua = zero address). Official prod deploys used Hardhat Ignition (`swap-vm/DEPLOY.md`) with `ignition/parameters/chain-<id>.json` (`$global.{aqua,weth,owner,name,version}`).
- Official local-fork target: `aqua/Makefile:170`: `anvil --fork-url $(NODE_URL) --steps-tracing --chain-id $(OPS_CHAIN_ID) --host 127.0.0.1 --port 8546 -vvvvv` with `OPS_CHAIN_ID=31337`, `LOCALHOST_RPC_URL=http://127.0.0.1:8546` (`aqua/DEPLOY.md`).
- Anvil default account #0: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, pk `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (10,000 ETH pre-funded on the fork; verified).

## 4. RPC survey (what each public endpoint can do) — measured

| Endpoint | chain | latest state | archive `eth_getCode --block` | `eth_getLogs` range | notes |
|---|---|---|---|---|---|
| `https://gateway.tenderly.co/public/mainnet` (alias `https://mainnet.gateway.tenderly.co`) | 1 | ✅ | ✅ (block 20 M ok) | **10,000 blocks ok** (scanned 346 k blocks in ~35 requests, 1.4 GB of logs, no errors) | best free ETH archive; used for the ETH fork (anvil up in 1 s) |
| `https://gateway.tenderly.co/public/base` | 8453 | ✅ | ✅ | **max 1,000 blocks** ("Block range too large for public access: maximum 1000 blocks") | best Base fork source (anvil up in 1 s, all lazy state fetches fine) |
| `https://mainnet.base.org` | 8453 | ✅ | ✅ | **10,000-block cap** (`-32614`); sequential 10k chunks fine | **429 "over rate limit" under ~20 parallel calls** — serialize |
| `https://ethereum-rpc.publicnode.com` | 1 | ✅ | ❌ (403 "Archive requests require a personal token") | ❌ for old ranges | fine for `cast code`/latest calls only |
| `https://base-rpc.publicnode.com` | 8453 | ✅ | ❌ (403) | ❌ | same |
| `https://eth.drpc.org` | 1 | ✅ | ✅ | ❌ (400 "Can't route your request to suitable provider") | usable for archive `eth_getCode`; sometimes 408 on Base (`base.drpc.org`) |
| `https://1rpc.io/eth` | 1 | ✅ | ❌ | 50-block cap | — |
| `https://rpc.mevblocker.io` | 1 | ✅ | ✅ | "query returned more than 10000 results" for 2k blocks | — |
| `https://eth-mainnet.public.blastapi.io`, `https://eth-pokt.nodies.app` | 1 | ✅ | ✅ | tiny caps (50 blocks / keyed) | — |
| `https://arb1.arbitrum.io/rpc`, `https://mainnet.optimism.io`, `https://polygon-bor-rpc.publicnode.com` | 42161/10/137 | ✅ | not tested | not tested | — |
| dead/keyed: `eth.llamarpc.com` (521), `base.llamarpc.com` (521), `cloudflare-eth.com` (-32046), `rpc.ankr.com/eth` (key), `polygon-rpc.com` (401), `1rpc.io/base` (410), `ethereum.blockpi.network` (521), `rpc.flashbots.net` (504 on logs), `eth.merkle.io` (no getLogs) | | | | |

Recommendation: for the demo keep a fallback list `[Tenderly public gateway, mainnet.base.org, base.drpc.org]`; for a hackathon-grade setup get a free Alchemy/Infura key (`https://base-mainnet.g.alchemy.com/v2/<KEY>`) — anvil's lazy state fetching is bursty and public endpoints can 429 mid-demo.

## 5. Fork recipe (verified on Base; identical on Ethereum with the other RPC/addresses)

### 5.1 Start the fork
```bash
# Base fork, pinned block, local chain id 31337 (see §7 for why), auto-impersonation on
anvil \
  --fork-url https://gateway.tenderly.co/public/base \
  --fork-block-number 50926000 \
  --chain-id 31337 \
  --auto-impersonate \
  --no-rate-limit \
  --port 8545 --host 127.0.0.1
# optional: --hardfork prague   (accepted; default 'latest' also worked)
# optional: --block-time 2      (Base cadence; default = automine per tx, which is better for demos)
# optional: --state ./anvil-state.json --state-interval 10   (persist + reload; see §5.7)
```
Measured: anvil ready in **1 s**; `cast block-number` → 50926000, `cast chain-id` → 31337; Aqua/router code present; `router.AQUA()` = official Aqua; block timestamp 1788641347; `baseFeePerGas` 5,000,000 wei (0.005 gwei), `gasPrice` ~1.0 gwei on Base.
Ethereum equivalent: `--fork-url https://gateway.tenderly.co/public/mainnet --fork-block-number 25913600` (ready in 1 s; whale transfers verified).

Fork block choice: pin a block a few hundred blocks below the head (Base: head 50926319 at probe time; ETH: 25913677) — pinning avoids re-fetching and makes the demo reproducible. Base advances ~43,200 blocks/day (2 s blocks), ETH ~7,150/day (12 s).

### 5.2 Fund the demo wallet
```bash
DEMO=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266     # anvil account #0 (or the MetaMask address)
RPC=http://127.0.0.1:8545
cast rpc anvil_setBalance $DEMO 0x56BC75E2D63100000 --rpc-url $RPC      # 100 ETH
```
Impersonate a whale for ERC-20s (`--auto-impersonate` makes `--unlocked` work without `anvil_impersonateAccount`; if not using it, call `cast rpc anvil_impersonateAccount $WHALE` first). Whales need a little ETH for gas: `cast rpc anvil_setBalance $WHALE 0xDE0B6B3A7640000`.

**Base whales (balances at block ~50926300)**

| Token (decimals) | Holder | Balance |
|---|---|---|
| WETH `0x4200000000000000000000000000000000000006` (18) | Aave v3 aBasWETH `0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7` | 9,069 WETH ✅ used in test |
| WETH | Morpho Blue `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | 77,192 WETH |
| WETH | Uniswap v3 WETH/USDC 0.05 % `0xd0b53D9277642d899DF5C87A3966A349A798F224` | 2,097 WETH |
| WETH | Aerodrome CL100 WETH/USDC `0xcDAC0d6c6C59727a65F871236188350531885C43` | 1,726 WETH |
| WETH | Compound cWETHv3 `0x46e6b214b524310239732D51387075E0e70970bf` | 252 WETH |
| USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6) | Morpho Blue `0xBBBB…FFCb` | 229.3 M USDC ✅ used in test |
| USDC | Aave v3 aBasUSDC `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` | 18.2 M USDC |
| USDC | Aerodrome CL100 `0xcDAC…5C43` | 4.28 M USDC |
| USDC | Uniswap v3 `0xd0b5…F224` | 3.63 M USDC |
| USDC | Compound cUSDCv3 `0xb125E6687d4313864e53df431d5425969c15Eb2F` | 1.59 M USDC |
| USDC | `0x20FE51A9229EEf2cF8Ad9E89d91CAb9312cF3b7A` (Binance, UNCERTAIN label) | 610 k USDC |
| cbBTC `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` (8) | Aave v3 aBascbBTC `0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6` | 2,664 cbBTC |
| cbBTC | Compound cWETHv3 `0x46e6…70bf` | 4.77 cbBTC |
(Coinbase hot wallet `0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A` held ~0 WETH/cbBTC — do not rely on it.)

**Ethereum whales (block ~25913677)**

| Token | Holder | Balance |
|---|---|---|
| WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | Aave v3 aEthWETH `0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8` | 324,279 WETH ✅ used in test |
| WETH | Avalanche bridge `0x8EB8a3b98659Cce290402893d0123abb75E3ab28` | 14,071 WETH |
| WETH | Uniswap v3 USDC/WETH 0.05 % `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640` | 11,584 WETH |
| WETH | Binance 14 `0x28C6c06298d514Db089934071355E5743bf21d60` | 835 WETH |
| USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | Aave v3 aEthUSDC `0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c` | 151.3 M USDC ✅ used in test |
| USDC | Uniswap v3 `0x88e6…5640` | 76.6 M USDC |
| USDC | Circle treasury `0x55FE002aefF02F77364de339a1292923A15844B8` | 34.7 M USDC |
| WBTC `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | Aave v3 aEthWBTC `0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8` | 32,823 WBTC |
| WBTC | Uniswap v3 WBTC/WETH 0.3 % `0xCBCdF9626bC03E24f779434178A73a0B4bad62eD` | 75 WBTC |

Example (verified, Base fork):
```bash
WETH=0x4200000000000000000000000000000000000006; USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
cast send $WETH 'transfer(address,uint256)(bool)' $DEMO 100000000000000000000 \
  --from 0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7 --unlocked --rpc-url $RPC      # 100 WETH
cast send $USDC 'transfer(address,uint256)(bool)' $DEMO 1000000000000 \
  --from 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb --unlocked --rpc-url $RPC      # 1,000,000 USDC
```
Alternative (no whale): mint WETH by `cast send $WETH 'deposit()' --value 100ether --private-key $PK`; for USDC use `cast rpc anvil_setStorageAt` on the balance slot (Base USDC is a FiatToken proxy — slot must be discovered with `forge inspect`/`cast storage`, UNCERTAIN; whale route is simpler).

### 5.3 Approve Aqua (maker side)
```bash
AQUA=0x1111113ccf1426a8e30e2bff5e005d929bf6a90a
cast send $WETH 'approve(address,uint256)(bool)' $AQUA $(cast max-uint) --private-key $PK --rpc-url $RPC   # 46,031 gas measured
```
`Aqua.pull()` does `safeTransferFrom(maker, to, amount)`, so the maker's allowance to **Aqua** (not to the router) is what matters.

### 5.4 Deploy our custom router against the OFFICIAL Aqua
Option A — `forge create` (verified; 1 s):
```bash
cd swap-vm   # repo with foundry.toml (solc 0.8.30, via_ir, 700 runs)
forge create src/routers/AquaSwapVMRouter.sol:AquaSwapVMRouter \
  --rpc-url $RPC --private-key $PK --broadcast \
  --constructor-args 0x1111113ccf1426a8e30e2bff5e005d929bf6a90a 0x4200000000000000000000000000000000000006 $DEMO "Hackathon SwapVM" "1.0.0"
# → Deployed to: 0x2299Ab13C8390CB7E8166C4c59ea15Cf89489b70 (in our run); AQUA()=official, WETH()=0x4200…0006, owner=$DEMO, eip712Domain chainId=31337
```
Option B — `forge script` (mirrors the repo):
```solidity
// script/DeployHackathonRouter.s.sol
contract DeployHackathonRouter is Script {
    address constant AQUA = 0x1111113ccf1426a8e30e2bff5e005d929bf6a90a;   // official, all chains
    address constant WETH = 0x4200000000000000000000000000000000000006;   // Base; use 0xC02a… on ETH
    function run() external {
        vm.startBroadcast();
        new MyAquaSwapVMRouter(AQUA, WETH, msg.sender, "Hackathon SwapVM", "1.0.0");
        vm.stopBroadcast();
    }
}
```
```bash
forge script script/DeployHackathonRouter.s.sol:DeployHackathonRouter --rpc-url $RPC --private-key $PK --broadcast -vvvv
# addresses land in broadcast/DeployHackathonRouter.s.sol/31337/run-latest.json (.transactions[0].contractAddress)
```
Deterministic address for the frontend: deploy from a fresh anvil account with nonce 0 → `cast compute-address $DEPLOYER --nonce 0`, or use `--load-state` (§5.7) so the address never changes.

### 5.5 Ship a strategy (verified on fork)
```bash
NEW=<our router>; STRAT=0x$(printf '%064x' 1234)      # real strategy = abi.encode(ISwapVM.Order)
cast send $AQUA 'ship(address,bytes,address[],uint256[])(bytes32)' $NEW $STRAT "[$WETH]" "[1000000000000000000]" --private-key $PK --rpc-url $RPC
# 51,750 gas; emits Shipped (topic 0xdc3622…) + Pushed
SH=$(cast keccak $STRAT)
cast call $AQUA 'rawBalances(address,address,bytes32,address)(uint248,uint8)' $DEMO $NEW $SH $WETH --rpc-url $RPC   # → 1000000000000000000, 1
```
Aqua does **not** check that `app` is a contract or a "known" app, so any custom router works with the official registry.

### 5.6 Demonstrate on-chain token transfers (judging requirement 2)
Run the taker `swap()` against our router and show `cast receipt <tx> --rpc-url $RPC` — the ERC-20 `Transfer` logs (topic `0xddf252ad…`) plus Aqua `Pulled`/`Pushed` and router `Swapped` (topic `0x54bc5c02…`) are the proof. `cast logs --from-block <fork> --address $AQUA --rpc-url $RPC` lists every Aqua event produced during the demo.

### 5.7 Reset / reproducibility
- `SNAP=$(cast rpc evm_snapshot --rpc-url $RPC)` → `"0x0"`; `cast rpc evm_revert $SNAP` → `true` (verified: burned 1 WETH, reverted, balance restored). Snapshot ids are single-use; take a new one after each revert. (`anvil_snapshot`/`anvil_revert` are aliases.)
- `cast rpc anvil_dumpState > state.json` (44 KB after the funding steps) and later `anvil --fork-url … --fork-block-number … --load-state state.json` (or `--state state.json` to both load and periodically dump). This keeps the funded wallet, our deployed router and shipped strategies across restarts → **fixed router address for the frontend**.
- `anvil_reset` (`cast rpc anvil_reset '{"forking":{"jsonRpcUrl":"…","blockNumber":50926000}}'`) re-forks without restarting the process (wallet nonces reset → see §7 pitfalls).
- Also available: `anvil_mine`, `evm_increaseTime`, `evm_setNextBlockTimestamp` (useful for time-based strategies / oracle staleness), `anvil_setStorageAt`, `anvil_setCode`.

## 6. Wallet + wagmi configuration

- **Use `--chain-id 31337` and configure the UI for chain 31337.** Reasons: (a) MetaMask/Rabby keep per-chain nonce caches; using 8453 while the real Base is also configured causes "nonce too high"/stuck-tx confusion and MetaMask warns/blocks overriding a known chain's RPC; (b) any signed tx/permit for chain 31337 can never be replayed on real Base; (c) the router's EIP-712 domain follows `block.chainid` anyway (§3), so signatures must be made for whatever id anvil runs — 31337 makes the intent explicit. Downside: the 1inch SDK address maps are keyed by real chain ids (`NetworkEnum.COINBASE = 8453`) — just pass the addresses explicitly (`new AquaProtocolContract(new Address('0x1111113ccf…'))`, `new SwapVMContract(address, …)`) instead of the enum lookup.
- MetaMask: Settings → Networks → Add network manually: Name "Anvil Base fork", RPC `http://127.0.0.1:8545`, Chain ID `31337`, symbol `ETH`, no explorer. Import anvil account #0 via private key, or fund the user's own address with `anvil_setBalance` + whale transfers (§5.2). After every anvil restart/reset: MetaMask → Settings → Advanced → **Clear activity tab data** (resets the cached nonce); Rabby: the same via "Clear pending"/re-adding the network.
- wagmi/viem:
```ts
import { defineChain, http } from 'viem'
import { createConfig } from 'wagmi'
export const anvilBase = defineChain({
  id: 31337, name: 'Anvil (Base fork)', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  contracts: { multicall3: { address: '0xca11bde05977b3631167028862be2a173976ca11' } }, // present on Base; anvil forks it
})
export const config = createConfig({ chains: [anvilBase], transports: { [anvilBase.id]: http('http://127.0.0.1:8545') }, ssr: false })
// addresses: AQUA = 0x1111113ccf1426a8e30e2bff5e005d929bf6a90a, OFFICIAL_ROUTER = 0x111111338c5091e8440b67b168bae16a668ac0de, OUR_ROUTER = from broadcast json / --load-state
```
  (`viem/chains` also exports `foundry`/`anvil` with id 31337 and `http://127.0.0.1:8545` — equivalent.) Multicall3 at `0xca11…ca11` exists on Base and Ethereum, so wagmi batching works on the fork (not re-verified here, UNCERTAIN only in the sense that it was not `cast code`-checked on the fork).
- If you insist on chain id 8453 in the UI (e.g. to reuse SDK enums), run `anvil --chain-id 8453` and add a *separate* MetaMask network entry with the local RPC — but remove/disable the real Base entry to avoid MetaMask routing to the wrong RPC.

## 7. Pitfalls (observed or well-known)

1. **Rate limits**: `mainnet.base.org` returned HTTP 429 `over rate limit` with ~20 concurrent `eth_call`s; Tenderly public gateway had no visible limit during forking but caps `eth_getLogs` at 1,000 blocks on Base (10,000 on ETH). `--no-rate-limit` only disables *anvil's own* client-side throttling (its default assumes Alchemy CU limits, `--compute-units-per-second`); it cannot stop a provider from 429-ing. Mitigate with a pinned `--fork-block-number`, `--state` persistence (state is served locally after first touch), and a keyed RPC.
2. **Archive state**: anvil lazily fetches state at `--fork-block-number`; `publicnode` refuses historical state (403) so forks from it break once the pinned block falls out of its window. Use Tenderly/base.org/drpc or a keyed archive node.
3. **`--fork-block-number` + `--chain-id`** both required for `--fork-chain-id` (skips remote chainId fetch); harmless to always pass all three.
4. **Nonce desync** in browser wallets after `anvil_reset`/restart/`evm_revert` (wallet thinks nonce N, chain is at M) → "nonce too high"/tx never mined. Clear activity data or re-import the account.
5. **Snapshot ids are consumed by `evm_revert`** — retake after each revert. `evm_revert` also rewinds contracts deployed after the snapshot (take the snapshot *after* deploying the router and shipping).
6. **Block time**: default automine (one block per tx, timestamp = wall clock-ish) is best for demos; with `--block-time N` the UI shows "pending" for up to N s. `evm_increaseTime` + `anvil_mine` are needed to move time for oracle-staleness or TWAP logic.
7. **Prague EVM**: both contracts are compiled for `prague` (Blockscout). Anvil 1.1.0-nightly (2025-04-30) ran them fine with default hardfork; if a newer/older anvil complains about opcodes, pass `--hardfork prague`.
8. **`--optimism` flag is not needed** for a Base fork in this workflow (state forking, not block replay).
9. **Compiled router size**: our HEAD build of `AquaSwapVMRouter` is 20,443 bytes runtime (40,887 hex chars) — under the 24,576 limit, but adding many custom opcodes could exceed it; keep `via_ir=true` + 700 runs (the official settings) and check `forge build --sizes`.
10. **Router `WETH()` getter reverts on the deployed 1.0.2 router** — do not rely on reading immutables from the official router; use `AQUA()` (works) or hard-code.
11. **Disk**: a full-history ETH `cast logs --json` dump of Aqua is 1.4 GB — never do that in the demo; scope log queries to the fork block onward.
12. `cast` on macOS: no `timeout` binary and `--timeout` is not a `cast` flag on this version; zsh does not word-split `$var` in `set -- $var` (use bash for helper scripts).

## 8. Chain recommendation: fork **Base**

| Criterion | Ethereum | Base |
|---|---|---|
| Aqua activity | very high (1.8 M events; 27.5 k txs / 7 days) — great for "real makers exist" narrative | real but light (252 events / 28 h; ~30 ships in 2 weeks) |
| Fork cost / speed | 1 s startup via Tenderly; state fetch per touched slot; gas price ~real mainnet | 1 s startup; base fee 0.005 gwei; cheaper tx replay in UI |
| Token availability | everything (1INCH/WETH/USDC/USDT/WBTC/wstETH) | WETH, USDC, cbBTC, ZRO…; no WBTC (use cbBTC) |
| Public RPC reliability | Tenderly gateway good; most others crippled | Tenderly + mainnet.base.org (rate-limited) + drpc |
| Chainlink / Aave v3 | ✅ | ✅ (feeds updated within seconds of probe) |
| Track fit | judges will ask "does it run where Aqua lives?" — yes on both | 1inch listed Base in the SDK; Coinbase/Base hackathon ecosystem |

Verdict: **Base (chain 8453) forked at a pinned block, anvil chain id 31337.** Cheaper, faster, and all needed primitives verified. Keep the Ethereum recipe (`ethfork.sh`) as a one-line switch (`--fork-url https://gateway.tenderly.co/public/mainnet`, WETH `0xC02a…`, whales in §5.2) if judges prefer mainnet — every address of Aqua/router is the same. If the pitch leans on "Aqua already has 1,000+ makers", quote the Ethereum numbers from §2.1 while demoing on Base.

## 9. Oracle and Aave v3 addresses (verified with `cast call` / `cast code`)

**Chainlink (all 8 decimals; `latestRoundData()(uint80,int256,uint256,uint256,uint80)`)**

| Chain | Pair | Address | Answer at probe (2026-09-05 ~19:15 UTC) |
|---|---|---|---|
| Ethereum | ETH / USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 247762580561 → $2,477.63 (updatedAt 1788641759) |
| Ethereum | BTC / USD | `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` | 7973725400000 → $79,737.25 |
| Ethereum | USDC / USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | 99985930 → $0.99986 |
| Base | ETH / USD | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` | 248052669545 → $2,480.53 (updatedAt 1788641221) |
| Base | BTC / USD | `0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F` | 7975909277837 → $79,759.09 |
| Base | cbBTC / USD | `0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D` | 7975682683527 → $79,756.83 |
| Base | USDC / USD | `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` | 99986822 |

In the fork the feeds return the value frozen at the fork block (Base fork: ETH/USD 248052669545); to simulate price moves use `anvil_setStorageAt` on the aggregator or wrap the feed in a mock — UNCERTAIN which storage slot; simplest is to deploy a `MockAggregatorV3` and point the strategy at it via constructor/immutable.

**Aave v3**

| Chain | Contract | Address | Check |
|---|---|---|---|
| Ethereum | Pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | code ✅; `ADDRESSES_PROVIDER()` = `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e`; provider `getPool()` round-trips |
| Ethereum | PoolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | code ✅ |
| Ethereum | PoolDataProvider | `0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3` | code ✅ (not otherwise verified) |
| Ethereum | aEthWETH | `0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8` | symbol `aEthWETH`, underlying WETH, totalSupply 2,149,273 WETH |
| Ethereum | aEthUSDC | `0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c` | symbol `aEthUSDC`, underlying USDC, totalSupply 2.305 B USDC |
| Ethereum | aEthWBTC | `0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8` | holds 32,823 WBTC |
| Base | Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | code ✅; `ADDRESSES_PROVIDER()` = `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D`; `getReserveData(WETH).aTokenAddress` = `0xD4a0…8bb7` ✅ |
| Base | PoolAddressesProvider | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` | code ✅ |
| Base | aBasWETH | `0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7` | symbol `aBasWETH`, underlying `0x4200…0006`, totalSupply 82,109 WETH |
| Base | aBasUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` | symbol `aBasUSDC`, underlying `0x8335…2913`, totalSupply 183.0 M USDC |
| Base | aBascbBTC | `0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6` | holds 2,664 cbBTC |
| Base | WETH variable-debt token | `0x24e6e0795b3c7c71D965fCc4f371803d1c…` (truncated in output, UNCERTAIN) | from `getReserveData` |

Token metadata verified: Base WETH `0x4200…0006` (18), Base USDC `0x8335…2913` (6), Base cbBTC `0xcbB7…33Bf` (8), ETH USDC `0xA0b8…eB48` (6), ETH WETH `0xC02a…6Cc2`.

## 10. Verified demo transcript (Base fork, `forktest.sh` + `forgetest.sh`)

```
anvil up after 1s; block=50926000 chainid=31337
aqua code in fork: 0x6080604052…  router.AQUA()=0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a
anvil_setBalance demo → 100 ETH
aBasWETH → demo 100 WETH   status 1 (tx 0x49ecd970…)
Morpho   → demo 1,000,000 USDC   status 1 (tx 0x58f92da4…)
approve WETH→Aqua   gasUsed 46031, allowance 1e20
evm_snapshot "0x0"; burn 1 WETH; evm_revert true; balance restored
Chainlink ETH/USD in fork: 248052669545
anvil_dumpState → 44,263 bytes
forge create AquaSwapVMRouter(AQUA, WETH, demo, "Hackathon SwapVM", "1.0.0") → 0x2299Ab13C8390CB7E8166C4c59ea15Cf89489b70 (1 s)
Aqua.ship(newRouter, 0x…04d2, [WETH], [1e18]) → gasUsed 51750, Shipped event; rawBalances = (1e18, 1)
```

## 11. Open questions / UNCERTAIN

- Exact swap-vm commit behind the deployed `1.0.2` router (repo HEAD is `1.2.0` params; `WETH()` getter differs). If we want on-chain compatibility with *existing* Base strategies (to swap against them in the demo), decode a real `Shipped` payload with the SDK's `SwapVMContract.decode…` against HEAD's instruction set and check it parses.
- Whether Ethereum makers like `0x1598…e14e` are 1inch-internal bots (pattern of thousands of ship/dock in 1INCH token suggests so) — irrelevant for the demo but relevant if we claim "organic" usage.
- Coinbase/Binance hot-wallet labels for Base whales are unverified; the protocol contracts (Aave aTokens, Morpho, Uniswap v3 pools) were verified by balance and are the safer impersonation targets.
