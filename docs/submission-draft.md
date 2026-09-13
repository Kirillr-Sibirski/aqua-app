---
name: Strikeline
has_repo: true
has_demo: false
has_video: true
---

## Tagline

Name a price you'd sell your ETH at, get paid to wait, and never move it out of your wallet.

## Description

Strikeline lets someone holding ETH say "I will sell at $2,800 if it gets there, and be paid for
the wait", without depositing anything. The offer is a quote inside 1inch Aqua. The ETH stays in
the maker's wallet until a taker actually fills it.

Putting ETH in a liquidity pool already means agreeing to sell it at prices you never chose, for a
fee that mostly goes to arbitrage bots. Strikeline hands those choices back: the maker picks the
price (the strike), the date (the expiry) and the volatility they are willing to sell. To an
options trader, each offer is a covered call written as a pricing curve. The premium is not paid
up front. It builds up as a spread that widens each day nobody takes the offer, and whoever
eventually crosses it pays it.

Under the hood each offer is a 62-byte SwapVM program. Its curve is RMM-01, the replicating
market maker whose shape decays with the block clock, so holding it is exactly short a call at the
maker's strike and volatility. At expiry the curve turns into a plain limit order at the strike,
so assignment is an ordinary swap. There is no vault, no option token, no oracle in the pricing
path, no keeper and no settlement transaction.

One wallet can back many offers at once. A second instruction, `Coverage`, checks inside the same
call that prices the trade that the quote can be delivered from the maker's real balance and
allowance. So writing 30.74 WETH of offers against a 10.4 WETH wallet is honest portfolio margin
rather than phantom depth: fill one offer and what the others can deliver shrinks in the same
block. Withdrawing an offer, or rolling it to a new date, moves zero tokens.

The app is one screen. A chart shows the decay band, the payoff at expiry or the live curve. A
ticket arrives pre-filled from chain reads (balance, a Chainlink strike, the block-clock date,
trailing realised vol) and publishes an offer in one click. A positions table shows every offer,
what it has earned, and how much of it the wallet can actually back right now.

We also say where it loses. In a replay of a week of real Base ETH/USD prices, the book beat holding
by +201 USD on about 50k of capital, but it collected only 31% of its time value because the
arbitrageur walked away from 4,409 quotes. Written below realised volatility, an ordinary pool
beats it. The replay never reached the strike, so the assignment case is untested there.

## How it's made

The work is two custom SwapVM instructions on a redeployed router that settles against the official,
unmodified Aqua registry `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`. There is no oracle anywhere
in the pricing path.

`RmmSwap` (opcode `0x55`, `contracts/src/instructions/RmmSwap.sol`) is the curve. It implements
`Y = L*K*Phi(PhiInv(1 - X/L) - sigma*sqrt(tau))` in 62 bytes of args, with
`tau = max(maturity - block.timestamp, 1 hour) / 365 days` read straight off the block clock, so
the curve ages without any transaction. Reserves stay pinned to the curve and the program has no
fee instruction, so decay opens a two-sided spread instead of a fee. A trade inside the band
reverts with `RmmInsideSpread(shortfall)`, which carries the exact shortfall. At `tau = 0` the
Gaussian drops out to `Y = K*(L - X)`, a constant-sum order at the strike. Phi and PhiInv are
fixed-point on Solady. They measure about 5e-12 relative error against a 50-digit mpmath reference,
and the maker-favouring epsilon is sized from the measured 1.18e-6 round trip.

`Coverage` (opcode `0x93`, `contracts/src/instructions/Coverage.sol`) wraps the curve. It runs the
curve first, then requires `amountOut <= min(balanceOf(maker), allowance(maker, AQUA))`, and
otherwise reverts `NotCovered(need, free)`. The order matters: clamping the balance first would
change `X/L` and therefore the price, not just the size. `Aqua.safeBalances` never looks at the
wallet, so this is the only place the real balance is checked before a quote is returned.

- **Contracts:** Solidity 0.8.30, Foundry. `make test` runs 170 offline tests, including a
  `quote() == swap()` fuzz and `test_Book_FillOnOneLegShrinksSiblingDepth`. Eleven more fork tests
  fill real WETH/USDC through the official contracts, including a third-party maker strategy filled
  through the unmodified official router `0x111111338c5091E8440b67B168bAe16a668AC0De`. The router is
  23,851 bytes, 725 under EIP-170. A fill costs 211,317 gas, about a cent on Base.
- **The Graph:** Aqua's `Shipped` event carries the whole program, so a subgraph decodes every offer's
  strike, date, size and vol inside the AssemblyScript mapping. It maintains a `SurfacePoint` entity,
  a cross-maker implied-vol surface built from on-chain state alone. There are 18 mapping tests, and
  a separate `SurfaceLens` view contract prices a whole book in one `eth_call`.
- **Uniswap v4 comparison:** the same curve code runs as a v4 hook, with fuzzed price parity against
  the Aqua leg. A controlled experiment shows the pool is cheaper per fill, but with the same capital
  it can fund 1 of the 4 offers where Aqua funds all 4, and rolling costs 14 transfers against 0.
  `FEEDBACK.md` records two v4 findings, each backed by a test.
- **Front end:** Next.js 16, React 19, Mantine and Tailwind, wagmi and viem, with a TypeScript SwapVM
  encoder checked against Solidity-generated vectors. The app contains no option maths: every curve
  point and preview number is a router call, all read at one block.
- **Demo:** runs on an anvil fork of Base against the real registry. The scripted scenes in
  `scripts/story` are deterministic `make` targets that assert their own claims.
