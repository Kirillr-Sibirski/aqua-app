# PRODUCT.md — Strikeline

## Register

Product. This is a working terminal for people putting real inventory to work, not a landing page.
Design serves the numbers; there is no hero section anywhere in the app.

## What it is

Strikeline is a vol-selling desk built on 1inch Aqua. A maker writes a ladder of option-shaped
liquidity legs (covered calls above spot, cash-secured puts below) directly from their own wallet.
Each leg is a SwapVM program whose pricing curve *is* the option: the RMM-01 replicating market
maker, whose shape decays with the block clock, so holding it is short an option struck where the
maker chose, at an implied vol the maker chose.

One wallet balance backs the whole ladder at once. A custom instruction proves, inside the same
call that prices the trade, that every quote is actually deliverable from the real wallet, so
over-allocating across legs becomes portfolio margin rather than phantom depth.

## Who it is for

- **Primary:** semi-professional LPs and small desks holding ETH or BTC who already run v3 ranges
  or ALM vaults. They are already short gamma, at an implied vol nobody chose and nobody paid them
  for. They want the strike, the vol and the expiry to be theirs.
- **Secondary:** treasuries selling upside on a position they will not custody elsewhere, and
  accumulating below spot through the put leg.
- **Takers:** 1inch resolvers and arbitrageurs. They are not an afterthought. Arbitrage flow is the
  mechanism by which the maker earns theta, and the product says so.

## The problem

Passive liquidity provision is a short option position that pays badly. LVR runs about σ²/8 a year;
on WETH-USDC 5bp, fees have covered roughly 80% of arbitrage losses; about half of Uniswap v3 LPs
underperform holding. In 2026 the fee switch took another 17-25% of what was left. The maker never
chose the strike, never chose the vol, and never got a premium.

On-chain options are supposed to be the alternative, but every venue locks the collateral in a
vault, prices from an oracle, mints an option token and needs a settlement transaction. Vault TVL
in the category has collapsed, and an oracle exploit took $2.7M from one of the largest.

## The bet

If the option is expressed as a pricing curve instead of a contract, all of that machinery
disappears: settlement is an ordinary swap, exercise is an arbitrage, and the premium arrives as a
spread that widens with time decay. Aqua is what makes the position a *book* rather than a single
trade: the collateral never leaves the wallet, and the same balance can margin every leg.

## Brand personality

Instrument, not app. Precise, quiet, numerate. It should feel like something a desk already runs,
sitting comfortably next to a charting terminal. Confident enough to state what the position loses
and when.

Voice: specific nouns, real numbers, no marketing register. "Notional written 2.7x, backed 100%"
rather than "unlock capital efficiency". Limits stated on screen, not buried in a README.

## Anti-references

- Retail options UIs with green/red payoff cartoons and confetti.
- DOV marketing pages: yield percentages in 72px type, no mention of what you are short.
- Generic DeFi dashboards: purple gradients, glass cards, identical stat tiles, emoji.
- Anything that hides the mechanism. If a number is modelled rather than measured, it says so.

## Design principles

1. **Every number comes from the chain.** Curve pixels are `eth_call` samples into the VM, not a
   TypeScript reimplementation of the math. Realised theta is read from fills, never from a model.
2. **The mechanism is the interface.** Show the compiled program bytes, the decoded receipt, the
   coverage bound. A user who reads the screen understands the position.
3. **Refuse rather than lie.** When a trade is inside the theta band or beyond real backing, the
   quote reverts with both numbers and the UI explains it in plain language.
4. **Shared inventory is the hero visual.** One fill shrinking every sibling leg's deliverable depth
   in the same block is the thing no pool, vault or hook can render.
5. **No fake data, ever.** Demo inventory is seeded at irregular amounts because round numbers read
   as fake even when they are real.

## Accessibility

Dark only, deliberately: this sits next to a price feed all day. Body text at 4.5:1 or better,
axis labels included. Color is never the only signal (a delta carries a sign and an arrow, a status
carries a text label). Every control is keyboard operable, including the curve cursor and the time
scrubber. Motion respects `prefers-reduced-motion`.

## Success criteria for this build

The submission wins if a 1inch protocol engineer watching three minutes can say: that is a position
the VM could not express before, the maths is right, the margin is enforced where it has to be, and
they showed real tokens moving through the official registry.
