<p align="center"><img src="docs/logo.svg" alt="Strikeline" width="400"></p>

# Strikeline

**Sell covered calls on ETH straight from your wallet, with nothing locked: in the demo, one wallet holding 10.4 ETH backs offers for 15.4 ETH at once, and every trade checks the real balance so it can never owe more than it holds.**

**Name a price you'd be happy to sell your ETH at. Earn from how ETH moves while you wait. The ETH
never leaves your wallet.**

Built for ETHGlobal ETHOnline 2026 on **1inch Aqua**.

**Live demo: [strikeline-mu.vercel.app/app](https://strikeline-mu.vercel.app/app)** · click **Connect wallet → Demo wallet**.
The demo chain is a fork of **Base mainnet** (chain ID 31337) run by an anvil node on a Google Cloud
VM. It uses the official Aqua registry and real WETH/USDC contracts, and the site reaches it through a
relay that blocks admin commands, so anyone can publish and withdraw offers without funds.

![The Strikeline app: premium chart, ticket and positions](docs/screenshot.png)

## The idea

You hold ETH and you'd be happy to sell it at, say, $2,600. Strikeline lets you post that as an offer
with an expiry date. Until then the ETH stays in your wallet, and you earn from how ETH moves.

## Where your earnings come from

- **Who:** 1inch resolvers. Your offer is a quote on 1inch Aqua, and it never updates itself.
- **When they trade:** only after ETH has moved elsewhere, when your offer beats other markets by more
  than a gap. That gap widens every day, in both directions, so small wiggles never trade.
- **What each trade does:** as ETH rises, a resolver buys a little of your ETH; as it falls, one sells
  some back to you. Nobody pays more than the market: resolvers only trade when it pays them.
- **How you earn (your premium):** like selling insurance. You come out ahead of just holding when ETH
  moves less than the volatility you chose.
- **The catch:** no trades, no earnings. If ETH swings more than you priced, you can end up behind
  holding.

**At expiry:** if ETH is above your price, the rest sells at exactly your price. If it is below, you
keep your ETH. Either way you keep what you earned along the way.

*For options traders:* each offer is a covered call written as a pricing curve. The premium arrives as
a spread that widens with theta, not as an up-front credit. No vault, no option token, no oracle, no
keeper.

## How it works

Two custom SwapVM instructions on a redeployed router, settling against the **official Aqua registry**
`0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`.

**`RmmSwap`** (opcode `0x55`, [source](contracts/src/instructions/RmmSwap.sol)) is the option. It
implements RMM-01, the covered-call curve from Angeris, Evans & Chitra,
[*Replicating Market Makers*](https://arxiv.org/abs/2103.14769) and
[*Replicating Monotonic Payoffs Without Oracles*](https://arxiv.org/abs/2111.13740):

```
Y = L·K·Φ( Φ⁻¹(1 − X/L) − σ√τ )        τ = max(maturity − block.timestamp, 1h) / 365d
```

Holding reserves on this curve is exactly long spot and short a call at strike `K` and volatility `σ`.
Because `τ` is read from the block clock, the curve ages with no transaction: a spread opens that the
next taker has to pay. At expiry `τ = 0` and the curve becomes `Y = K·(L − X)`, a plain limit order
at the strike, so assignment is an ordinary swap.

**`Coverage`** (opcode `0x93`, [source](contracts/src/instructions/Coverage.sol)) is the margin. Aqua
lets a maker advertise more than their wallet holds. `Coverage` runs the curve, then refuses any quote
the maker's real balance and allowance cannot deliver. Every offer reads the same wallet, so one
wallet can back many offers, and **a fill on one offer shrinks what the others can deliver, in the
same block**.

## Built with

**1inch Aqua + SwapVM.** Offers are SwapVM programs on the official Aqua registry, priced by the two
instructions above ([`contracts/`](contracts/)).

**Protocol fee.** Every fill pays 0.10% of the taker's input to the protocol treasury, using 1inch
SwapVM's own `FeeProtocol` instruction. The maker's premium is untouched: only the net input reaches
their reserves. See [`docs/PROTOCOL-FEE.md`](docs/PROTOCOL-FEE.md).

## Evidence

| Claim | Proof |
|---|---|
| Decay opens a spread with no transaction | `test_Theta_DecayOpensASpread` |
| A fill on one offer shrinks its siblings' depth | `test_Book_FillOnOneLegShrinksSiblingDepth` |
| Without `Coverage` the depth is phantom | `test_Book_WithoutCoverageTheDepthIsPhantom` |
| Expiry settles at the strike | `test_Expiry_SettlesAtStrikeOneWay` |
| Rolling an offer moves zero tokens | `test_Roll_MovesNoTokensAndCanRepeatParameters` |
| Quotes match swaps | `testFuzz_QuoteEqualsSwap`, 256 runs |
| Works with real liquidity | Offers live on the official Aqua registry and fill through our redeployed SwapVM router; fork tests also fill real third-party WETH/USDC liquidity through the unmodified 1inch router |

**147 offline tests pass** (`make test`), plus 11 fork tests. The router is 23,851 bytes, under the
EIP-170 limit, and a fill costs 211k gas (about a cent on Base).

**Does it pay?** In a replay of a week of real Chainlink ETH/USD prices on Base, a four-offer book beat
holding by **+201 USD** on about 50k of capital. It collected only 31% of its time value, because the
arbitrageur declined 4,409 of 4,740 chances to trade. Written *far below* realised volatility (15% against 46.6%), a
plain pool beats it, and the price never reached the strike, so assignment is untested in the replay.

## Honest limits

- **You are not paid up front.** The premium is only realised when someone crosses the spread.
- **It is short volatility.** It loses when the market moves more than the vol you chose.
- **Offers can be withdrawn at any moment**, so a buyer cannot rely on one like an exchange-listed option.
## Running it

```bash
make install       # once
make fork          # terminal 1: anvil fork of Base at block 50,946,000, using the real Aqua registry
make story-setup   # terminal 2: deploy the router, fund the demo wallets, freeze the state
make story-load    # rewind to a clean wallet (10.4 WETH, no offers), about a second
make web           # http://localhost:3000 (landing), /app (the app), /docs and /docs/technical
```

In the app, **Connect wallet → Demo wallet**, pick Sell or Buy WETH, and publish an offer. Then act
as a buyer from the terminal:

```bash
make buy ARGS="2600 1"   # buy 1 WETH from your 2,600 offer; prints the receipt, decoded transfers and USDC per WETH
```

The positions table updates live: REMAINING, FILLED (progress and average price) and DELIVERABLE
(what the shared wallet can still cover), with an "Offer filled" card. The ✕ withdraws an offer in one
click and moves no tokens.

Optional: `make story-0` to `make story-6` are scripted scenes that each make a real transaction on
the fork and check their own claim; the [runbook](scripts/story/README.md) lists them.

## Further reading

- [`docs/IN-DEPTH.md`](docs/IN-DEPTH.md): the instructions in detail, the full replay study
  and prior art
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): which contract holds the tokens and which holds the price
- [`docs/OPCODES.md`](docs/OPCODES.md): byte layouts and gas
- [`contracts/`](contracts/README.md), [`web/`](web/README.md), [`scripts/`](scripts/README.md):
  per-package READMEs

## What's next

- A mainnet launch on Base, after an audit.
- More pairs beyond ETH/USDC, such as cbBTC and liquid staking tokens.
- Ladders: one click writes a spread of strikes and expiries from a single wallet.
- Automatic rolling into the next expiry when an offer ends.
- Routing, so Strikeline offers appear directly inside 1inch swaps for everyday traders.

## License and AI usage

Contracts under MIT. Consumes `@1inch/aqua` and `@1inch/swap-vm` under their Degensoft source
licenses. AI tooling usage is disclosed in [`docs/AI-USAGE.md`](docs/AI-USAGE.md).
