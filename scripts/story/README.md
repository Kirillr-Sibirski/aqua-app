# The scripted demo

Seven scenes, one anvil fork of Base, and the same numbers every take.

The video is the one artefact a judge actually watches, so nothing in it is allowed to depend on how
long the presenter talked, which RPC answered, or whether a price moved while the camera was rolling.
Every scene is a `make` target that runs in under a second, prints a decoded receipt, and asserts its
own claims. A take that goes wrong is undone in half a second and re-run.

```
make fork          # terminal 1, leave it running
make story-setup   # terminal 2, once
make story-load    # before every take
make story-0 ... make story-6
```

---

## What each scene proves

| | Command | Claim | The line to point at |
|---|---|---|---|
| **0** | `make story-0` | This is the real Aqua, not a mock with the same name | Three strategies that **other people** shipped, filled through the **official unmodified v1.0.2 router** `0x111111338c…`, settling against the **official registry** `0x1111113CCf…`. Real WETH out of a taker, real USDC out of a stranger's wallet. `filled 3 strategies, 0.1005 WETH in, 132.69 USDC out / ours none of it` |
| **1** | `make story-1` | One wallet writes a whole book, and shipping moves nothing | `Shipped x4  Pushed x8`, **0 ERC-20 Transfer logs**, one block, 326,900 gas. Aqua then believes in 30.7395 WETH of depth against a 10.4 WETH wallet: **2.96x over-allocated**, 32 WETH of call notional |
| **2** | `make story-2` | A fill on one leg shrinks its siblings' deliverable depth in the same block | `coverage(maker, WETH)` 10.4 → 9.336371, and two untouched legs flip from `its own reserve` to **`THE WALLET`**. Same call, one block apart: filled at 50946043, `NotCovered(needed=…, free=…)` at 50946044 |
| **3** | `make story-3` | Time decay is the premium, and it accrues with no transaction | One **empty** block moves the clock three days. τ 0.018436 → 0.010216, and the 2,600 leg's buy-side toll opens from 0 to **226.47 USDC**. 461.82 USDC across the book, paid by whoever re-opens the curve |
| **4** | `make story-4` | Over-allocation is refused at quote time, with both numbers | `NotCovered(needed=9925125269064564480, free=9336371101174893524)`. Ask for `free` and it fills first time; ask for `free + 1 wei` and it refuses. Then the **control**: the same leg with `Coverage` deleted quotes 9.925125 WETH, and the fill dies inside `Aqua.pull`'s `transferFrom` with `SafeTransferFromFailed()`, 53,751 gas burnt and **no events at all** |
| **5** | `make story-5` | Settlement needs no oracle, no keeper, no option token | Past maturity τ is **exactly zero** and `stableFor(X) == K·(L−X)` to the wei at five points. The mirror direction reverts `RmmSettlementOneWay()`. Second assignment prices at **exactly 2,600 USDC per WETH**. Settlement costs 134,585 gas against 227,708 for the live curve: **93,123 gas** of Gaussian that is simply gone |
| **6** | `make story-6` | Rolling the book moves zero tokens | `Docked x4  Shipped x4  Pushed x8` in **one block**, 469,464 gas, **0 ERC-20 Transfer logs**, and the maker's wallet identical to the wei |

`make story-all` runs 1 through 6 back to back. Scene 0 is deliberately not in it: it is the cold open
and it fills third-party liquidity, so it is worth running on its own.

---

## Runbook

### Once, on the machine that will record

```bash
make install                 # tsx + viem for scripts/, deps for contracts/ and web/
make build-src               # produces contracts/out/StrikelineRouter.sol/StrikelineRouter.json
```

### Terminal 1, and leave it alone

```bash
make fork
```

anvil forking **Base at block 50946000** (2026-09-05, timestamp 1788681347), chain id 31337,
`--auto-impersonate`, automine. It picks the first upstream that answers `eth_chainId == 0x2105`:
`ANVIL_FORK_URL`, then the Tenderly public gateway, then `mainnet.base.org`, then `base.drpc.org`.
**Measured: 0.57 s to the first served `eth_blockNumber`.**

### Terminal 2, once per fork

```bash
make story-setup
```

Deploys `StrikelineRouter` against the official Aqua, funds the wallets from Base whales, trims the
maker to exactly **10.4 WETH / 24,850 USDC**, sets every approval, installs the Chainlink mock at the
real ETH/USD proxy address, anchors the price tape, pins the clock, then freezes the fork with
`anvil_dumpState` **and** `evm_snapshot`.

**Measured: 9.4 s the first time on a machine whose Foundry RPC cache is empty, 5.6 s on a fresh fork
after that, 1.3 s against a fork that is already warm.** It ends with

```
  ok   anvil_dumpState wrote 117 KiB of gzipped chain state to scripts/story/state/demo.json
  ok   evm_snapshot 0x0 taken -- a retake inside this anvil session is a full rewind
ready. `make story-load` returns here in about a second; `make story-1` opens the show.
```

### Before every take

```bash
make story-load
```

**Measured: 0.48 s** inside a live anvil session (`evm_revert`), **1.13 s** after restarting anvil
(`anvil_loadState` of the 117 KiB dump). Either way it lands back at take one: nothing shipped, wallet
at 10.4 WETH / 24,850 USDC, clock rewound to the frozen second.

### The take

| | Machine time | Assertions | Suggested narration |
|---|---|---|---|
| `make story-0` | 0.58 s | 26 | 0:20 → 0:45 |
| `make story-1` | 0.69 s | 14 | 0:45 → 1:10 |
| `make story-2` | 0.70 s | 15 | 1:10 → 1:45 |
| `make story-3` | 0.49 s | 12 | 1:45 → 2:05 |
| `make story-4` | 0.71 s | 18 | 2:05 → 2:25 |
| `make story-5` | 0.53 s | 18 | 2:25 → 2:45 |
| `make story-6` | 0.80 s | 19 | 2:45 → 3:00 |
| `make story-all` | 1.6 s | 96 | (1 through 6, one process) |

122 assertions across the seven scenes, and **under five seconds of machine time in a three-minute
video**. Every scene prints faster than it can be read, which is the point: run it, then talk over the
output that is already on screen.

Three of those scenes used to take 4.5 seconds instead of 0.6, intermittently, and scene 0 took 4.5
every time. That was viem sleeping a full default `pollingInterval` of 4,000 ms before re-asking for a
receipt that anvil had already written. Every wait in the demo now polls at 25 ms
(`awaitReceipt` in `lib.ts`). It is worth knowing about because it is invisible: nothing fails, the
scene simply pauses.

Run the sequence once as a dress rehearsal anyway before the camera is on:

```bash
make story-load && for n in 0 1 2 3 4 5 6; do make story-$n; done
```

`make story-status` prints where the show currently is (fork block, coverage, tape time, live legs,
and the history of scenes already run in this take).

---

## Retakes, and why they are exact

Two undo mechanisms, tried in that order, because they fail differently.

**`evm_revert`** is the complete rewind: block height, clock, and every account, *including the
third-party wallets scene 0 fills* which this repo never touched and therefore never dumped. It costs
milliseconds and it is the right answer inside a running anvil. Anvil consumes a snapshot id on revert,
so `load.ts` immediately takes a fresh one.

**`anvil_dumpState` / `anvil_loadState`** is the durable one: it survives restarting anvil, which is
what makes the demo open in a second rather than a full bootstrap. But it *merges* the dump into
the current state rather than replacing it, so accounts the dump never held stay where the last run
left them. After a restart that is exactly right, because those accounts are served from the fork
again. `make story-load ARGS="--dump"` forces this path.

Neither mechanism restores the fork's *clock configuration*, and both ways that can go wrong were
found the hard way. `load.ts` now fixes and proves each of them on every load:

1. **The block interval is node configuration, not chain state.** Without
   `anvil_setBlockTimestampInterval(1)` anvil timestamps blocks from the wall clock, so three seconds
   of the presenter thinking became three seconds of theta and the second take printed different
   numbers from the first.
2. **Anvil's clock counter is separate from the chain head.** `anvil_loadState` moves the head without
   moving the counter, so the first block after a reload was stamped **1788681348 against a head of
   1788681376, twenty-eight seconds backwards**, and every τ in the demo would have been read off
   that. `anvil_setTime` at the restored head re-anchors it.

Both are proved with a block that is mined and then rewound, so the check costs the demo nothing:

```
  ok   one block is one second again (1788681376 -> 1788681377), so the clock cannot drift or run backwards
  ok   the clock is back at the frozen timestamp, so a warped scene really is undone
```

**What reproducibility buys, measured.** Scene 2 was run on two different anvil processes, from two
different `story-setup` runs whose anchors differed by nine seconds. Both filled at **tape step 14**,
for **2,644.81 USDC in → 1.063629 WETH out**, in block **50946044**, for **227,708 gas**. Only the
transaction hash differed.

---

## What makes the numbers real

**Fixed addresses.** The router lands at `0x59675EAF89150aA8732244986cA32982389a8c87` on every setup,
because anvil account #0's nonce is read from Base at the pinned block and is therefore itself pinned
(3,439,001), so `CREATE` is deterministic. The manifests written to
`scripts/fork/deployments.local.json` and `web/public/deployments/local.json` therefore stay valid
across a re-setup, and the web app does not need re-pointing between takes.

| | |
|---|---|
| Aqua registry | `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` (official, never redeployed, 5,619 bytes of code on this fork) |
| Official router v1.0.2 | `0x111111338c5091E8440b67B168bAe16a668AC0De` (scene 0 fills through it, unmodified) |
| StrikelineRouter | `0x59675EAF89150aA8732244986cA32982389a8c87` |
| maker | anvil #1 `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` — 10.4 WETH / 24,850 USDC |
| arb bot | anvil #2 `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| taker | anvil #3 `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

(`bootstrap.ts` labels #2 "taker" and #3 "spare" for its own smoke test; the story reassigns them, and
`story-status` prints the roles that are actually in force.)

**No fake data.** Every figure a scene prints is a chain read: `eth_call` into the router's own
`stableFor` / `riskyFor` / `tauNow` / `coverage` / `bandFor` views, `Aqua.safeBalances` for the ledger,
decoded event logs for the receipts. The maker's inventory is seeded at 10.4 WETH and 24,850 USDC
rather than 10 and 25,000 because round numbers read as fabricated even when they are not.

**No slider.** The bot's price reference is `latestRoundData()` on the Chainlink ETH/USD proxy at its
canonical Base address `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`. On the fork that address holds a
mock whose answer is kept equal to the round the **real aggregator actually published** at the tape
time the fork clock maps to: 1,744 rounds spanning 10.70 days, $2,358.11 to $2,558.63, captured at the
pinned block so a re-capture is byte-identical. Warp the fork three days and the tape advances three
real days.

Nothing in the *pricing* path reads that feed. `RmmSwap` is oracle-free: the curve is K, σ, T, L and
`block.timestamp`. The feed is only how the arbitrageur decides what is mispriced, which is exactly
what an oracle does for a real arbitrageur.

---

## The arbitrage bot

```bash
make bot ARGS="--dry-run --steps 1"                 # plan only: the band and the sizes, no transaction
make bot ARGS="--leg 2600 --until-fill"             # advance the tape until the 2,600 leg is worth filling
make bot ARGS="--steps 24 --step-seconds 1800"      # walk half a day of real tape, trade when it pays
make bot ARGS="--selftest"                          # the normal CDF against published values
```

**It sizes analytically. There is no bisection anywhere.** RMM-01's marginal price at risky reserve `X`
is `K·exp(z·s − s²/2)` with `z = Φ⁻¹(1 − X/L)`, so setting it equal to spot inverts in closed form:
`X* = L·(1 − Φ(d₁))`. One normal CDF, no iteration. This is not a stylistic preference: a `RmmSwap`
quote costs **657-667k gas**, so a 40-iteration binary search over `quote()` is **~26M gas against a
30M block limit**. It does not fit in a block, and off-chain it is 40 round trips per leg per tick.

Measured in scene 2: **3.8 `eth_calls` per plan**, and none of them a search.

Everything that has to agree with the chain to the wei is read back *from the chain*: `X*` only selects
a point on the curve, and `stableFor` / `riskyFor` evaluate the router's own approximated Φ to price
it. The bot prints its predicted `amountOut` beside the router's `quote()` on every trade and stops if
they differ by one wei:

```
    predicted 1063629202262614236  ==  router.quote() 1063629202262614236   (exact, 0 wei apart)
    re-derived at block 50946044 == Swapped.amountOut (1063628898825106476); theta collected in the
    one second between quote and fill: 303437507760 raw units
```

That last line is the fill landing one second after the quote, so the difference between the two is
exactly one second of theta rather than an unknown amount of wall clock.

**It is given no privileged knowledge of the book.** `discover.ts` reads every `Shipped` event on the
official registry, keeps the ones whose `app` is the Strikeline router, decodes `strategy` back into an
order, disassembles the program, and keeps the legs carrying `RmmSwap` (0x55) that are still active.
K, σ, T and L are all in the clear, because `Aqua.ship` takes the strategy unhashed "for data
availability". An option written this way needs no off-chain order book and no API.

`scripts/arb/gauss.ts` is Hart's rational approximation as given by Graeme West (Wilmott, 2005);
`--selftest` checks it at ten points against published values (worst relative error **8.70e-9**,
tolerance 1e-8).

---

## Files

| | |
|---|---|
| `run.ts` | The driver. `0`-`6`, `all`, `status`. Every scene is a separate process on purpose: a scene that goes wrong is retaken with `make story-load` and re-run, and the presenter's terminal history is the script |
| `setup.ts` | Everything above, then `anvil_dumpState` + `evm_snapshot` |
| `load.ts` | `evm_revert`, falling back to `anvil_loadState`; re-anchors and re-pins the clock and proves both |
| `context.ts` | The pre-flight every scene repeats: the fork is the fork we think it is, the router is ours and points at the official registry, the TypeScript encoders still match the Solidity, the tape is anchored |
| `book.ts` | The four-leg ladder: strikes 2,600 (L=12) / 2,800 / 3,000 and a 2,300 put, σ 60%, 7-day expiry. Compiles each leg to `Deadline · Coverage · RmmSwap · Salt`, 86 bytes, and reads coverage and deliverable depth back |
| `live.ts` | The three third-party Base strategies scene 0 fills, pinned by hash at block 50946000, ported from `contracts/test/fork/live/AquaBaseLiveFork.t.sol` |
| `lib.ts` | Receipt decoding, assertions, formatting, the story state file, and `awaitReceipt` (every wait in the demo, at a 25 ms poll) |
| `scenes/scene0.ts` … `scene6.ts` | One scene each. The docblock at the top of each is the argument it is making |
| `../arb/bot.ts` | The bot: analytic sizing, the prediction-versus-`quote()` check, the fill |
| `../arb/rmm.ts` | Closed-form RMM-01 in bigint, reproducing `RmmSwap.exec` wei for wei including the maker-favouring EPS guard band |
| `../arb/tape.ts`, `capture.ts`, `series/base-ethusd.json` | The replayed Chainlink series. `make tape` re-captures it (needs an archive-capable Base RPC; the committed file is already reproducible) |
| `../arb/discover.ts`, `feed.ts`, `clock.ts`, `gauss.ts` | Book discovery from the log, the mock feed, deterministic time, the CDF |

State lives in `scripts/story/.story-state.json` (shipped legs, tape anchor, maturity, scene history)
and `scripts/story/state/` (the dump, the snapshot id, the pristine copy of the story state). Both are
gitignored: `make story-setup` regenerates all three.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `the story was set up against router 0x… but the manifest says 0x…` | `bootstrap` redeployed without a re-setup | `make story-setup` |
| `the deployed router at 0x… has no StrikelineViews.coverage()` | the probe router is deployed, not Strikeline | `make story-setup` (it forces the right artifact) |
| `scripts/story/state/demo.json not found` | never set up on this machine | `make story-setup` |
| `one block is one second again` fails | anvil restarted under a different flag set | restart with `make fork`, then `make story-load` |
| Scene 0 reverts, or a live strategy hash no longer matches | the fork is not at block 50946000 | those three strategies are pinned by hash at that block; restart with `make fork` |
| A scene fills at a different tape step | the book was shipped in a different second | `make story-load` and re-run from scene 1 |
| anvil says `no working Base RPC found` | all three upstreams unreachable | `ANVIL_FORK_URL=https://… make fork` |
| `npm test` in `web/` intermittently fails one test with `replacement transaction underpriced` (2 runs in 3, measured) | the `*.fork.test.ts` files that ship from anvil #1 run in parallel vitest workers, so their nonces race. Only possible while a fork is up | `npx vitest run --no-file-parallelism`, which has been green on every run |

If a take goes sideways mid-scene, `make story-load` is always safe: it is a full rewind, not a
compensating transaction.
