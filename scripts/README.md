# `@aqua-app/scripts` — local Base-fork demo infrastructure

Everything the demo needs to run against the **official 1inch Aqua** (`0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`)
without touching mainnet: an anvil fork of Base, our own SwapVM router deployed on top of it, funded wallets, movable
Chainlink prices, time travel and snapshots. Requires foundry (`anvil`, `cast`, `forge`) and Node 22.

```bash
make fork                      # terminal 1: anvil forking Base @ block 50946000, chain id 31337, automine
make bootstrap                 # terminal 2: forge build + deploy router + fund wallets + write manifests
make smoke                     # ship a WETH/USDC strategy from account #1, quote + swap 0.1 WETH from account #2
make oracle ARGS="eth 3100"    # ETH/USD -> $3,100 (mock installed at the real feed address; never stale)
make time ARGS="+3600"         # evm_increaseTime + mine
make snapshot ARGS="save"      # ... ARGS="restore"
make web                       # next dev (reads web/public/deployments/local.json)
```

`DEMO_ADDRESS=0xYourMetaMask make bootstrap` also funds your own EOA (1,000 ETH, 100 WETH, 500k USDC, 5 cbBTC).
Add the network to MetaMask as RPC `http://127.0.0.1:8545`, chain id `31337`; after every fork restart or
`snapshot restore` clear the wallet's activity/nonce cache.

## Files

| File | Purpose |
| --- | --- |
| `fork/start.sh` | `anvil --fork-url <Base RPC> --fork-block-number 50946000 --chain-id 31337 --auto-impersonate --no-rate-limit`; picks the first working upstream (Tenderly gateway → mainnet.base.org → base.drpc.org, `ANVIL_FORK_URL` first); `--state` persists to `fork/.state/anvil-state.json` (dump every 15 s and on Ctrl-C) so the router address survives restarts. |
| `fork/bootstrap.ts` | Deploys the router from a Foundry artifact (`ROUTER_ARTIFACT`, default `contracts/out/StrikelineRouter.sol/StrikelineRouter.json`; constructor params matched by name, so both the 3-arg and the 5-arg `(aqua,weth,owner,name,version)` shapes work). Refuses to write a manifest unless the deployed address answers `tauNow(uint40)`, so a router without `RmmSwap`/`Coverage` cannot be recorded as the app's with anvil account #0, funds accounts #0–#3 + `DEMO_ADDRESS` via whale impersonation (Aave aTokens / Morpho) with an `anvil_setStorageAt` balance-slot fallback, writes `fork/deployments.local.json` and `web/public/deployments/local.json`. Idempotent: reuses the router and tops balances up. |
| `fork/smoke.ts` | End-to-end proof using the TS encoder in `web/src/lib/swapvm`: `Aqua.ship(router, abi.encode(order), [WETH, USDC], …)`, `quote`, `swap` with `useTransferFromAndAquaPush`, asserts events and every balance delta against off-chain XYC math. |
| `fork/oracle.ts` | `setOraclePrice(feed, priceUsd)` — `anvil_setCode` of `MockAggregatorV3` at the Chainlink **proxy** address + `anvil_setStorageAt`; `decimals()`/`description()` preserved, `updatedAt` follows `block.timestamp`. CLI: `eth|btc|cbbtc|usdc|0x…`, `--tx` (real `setAnswer` tx, emits `AnswerUpdated`), `--updated-at <ts>` (demo staleness reverts). |
| `fork/time.ts` | `+<s>` / `set <ts>` / `now` / `mine [n]`. |
| `fork/snapshot.ts` | `save` / `restore` (re-snapshots after revert — anvil ids are single-use). `evm_revert` also undoes `anvil_setCode`, so snapshot **after** installing oracle mocks. |
| `fork/lib.ts` | Addresses (Aqua, official router, WETH/USDC/cbBTC, Chainlink feeds, Aave v3, whales), anvil accounts, viem clients, manifest types. |
| `fork/MockAggregatorV3.sol` | Source of the embedded mock runtime (solc 0.8.30, via_ir, 700 runs). |

## The scripted demo (`story/`) and the arbitrage bot (`arb/`)

`fork/` is the infrastructure; the show that runs on top of it lives next door and has its own runbook in
[`story/README.md`](story/README.md).

```bash
make story-setup               # deploy StrikelineRouter, seed the wallets, anchor the tape, freeze the fork
make story-load                # anvil_loadState / evm_revert back to take one, ~0.5 s
make story-0 ... make story-6  # one scene each;  make story-all runs 1-6;  make story-status
make bot ARGS="--dry-run"      # the arbitrage bot on its own
make tape                      # re-capture the real Base ETH/USD series (needs an archive Base RPC)
```

| Directory | Purpose |
| --- | --- |
| `story/` | Seven scenes, each a separate process that prints a decoded receipt and asserts its own claims: a live third-party fill through the official v1.0.2 router, shipping a four-leg book from one wallet, one fill tightening its siblings, theta with no transaction, `NotCovered` with both numbers, constant-sum settlement at the strike, and a zero-transfer roll. 122 assertions, about twelve seconds of machine time. |
| `arb/` | The bot that trades the book. Sizes analytically off closed-form RMM-01 (a 40-iteration bisection over `quote()` would be ~26M gas against a 30M block limit), prices against a replayed tape of 1,744 real Chainlink ETH/USD rounds captured from Base, and finds the legs in Aqua's `Shipped` log the way a resolver would. |

## Manifest (`web/public/deployments/local.json`)

`{ chainId, rpcUrl, blockNumber (fork pin), bootstrapBlock, aqua, officialRouter, router, routerName, weth, usdc, cbBtc,
chainlink: { ethUsd, btcUsd, cbBtcUsd, usdcUsd }, aave: { pool, addressesProvider }, accounts: [{ index, address,
privateKey?, role }], funding, generatedAt }`. Anvil private keys are the public test-mnemonic keys; `DEMO_ADDRESS` has none.

## Notes

- Anvil account #0 already has nonce 3,439,001 on Base, so the router lands at `CREATE(account0, 3439001)` =
  `0x59675EAF89150aA8732244986cA32982389a8c87` on a fresh fork at the pinned block — deterministic as long as
  bootstrap is the first tx from #0.
- `eth_call` on anvil runs with the timestamp of the last mined block; `time.ts` always mines after moving time.
- `anvil_setStorageAt` values must be exactly 32 bytes (`lib.hex32`).
- Public RPCs can rate-limit anvil's lazy state fetches; set `ANVIL_FORK_URL` to a keyed Alchemy/Infura Base
  endpoint for a smoother demo, or run `make fork-state` once so touched state is served locally afterwards.
