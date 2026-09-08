---
name: Strikeline
has_repo: true
has_demo: false
has_video: true
---

## Tagline

Vol-selling market making on 1inch Aqua — pick the strike, the vol and the expiry yourself.

## Description

Strikeline is a redeployed SwapVM router that settles against the official 1inch Aqua registry
and adds two custom VM instructions, turning a maker's own wallet into an options book.

Every LP is already short an option, at an implied vol nobody chose and nobody got paid for.
Strikeline lets the maker choose the strike, the vol and the expiry, write the whole book from
their own wallet, and margin it like a desk.

A maker ships a ladder of option-shaped liquidity legs — covered calls above spot, cash-secured
puts below. Each leg is a 64-byte SwapVM program whose pricing curve is the option itself: the
RMM-01 replicating market maker, whose curvature decays with the block clock, so holding it is
short a call struck where the maker chose, at an implied vol the maker chose. Arbitrageurs
perform the delta hedge; the maker earns theta.

One wallet balance backs the whole ladder at once. The Coverage instruction proves, inside the
same call that prices the trade, that every quote is deliverable from the maker's real ERC-20
balance and Aqua allowance, so over-allocating across legs is portfolio margin rather than
phantom depth. Fill one leg and its siblings' deliverable depth shrinks in the same block, with
no keeper, no shared storage and no message passing.

Existing on-chain options venues lock the collateral in a vault, price it from an oracle, mint
an option token and need a settlement transaction. Express the option as a pricing curve
instead and all of that machinery disappears: settlement is an ordinary swap, exercise is an
arbitrage, and the premium arrives as a spread that widens with time decay.

It is built for semi-professional LPs and small desks holding ETH who already run Uniswap v3
ranges or ALM vaults, are therefore already short gamma at a vol nobody paid them for, and want
the strike and the vol to be theirs.

## How it's made

Two custom SwapVM instructions on a redeployed router, and no oracle anywhere in the pricing
path.

`RmmSwap` (`Opcode._55`, `contracts/src/instructions/RmmSwap.sol`) is the curve. It implements
the RMM-01 trading function `Y = L*K*Phi(PhiInv(1 - X/L) - sigma*sqrt(tau))` in 62 bytes of
args, with `tau = max(maturity - block.timestamp, TAU_FLOOR) / 365 days` read straight off the
block clock, so the curve ages by itself with no keeper and no maker transaction. Reserves stay
pinned to the curve, so decay moves the curve away from the stale reserve point and opens a
spread the taker has to close first: theta is a toll the arbitrageur pays rather than a fee,
and a trade inside the band reverts with `RmmInsideSpread(shortfall)` carrying the exact
number. At `tau = 0` the Gaussian drops out in closed form to `Y = K*(L - X)`, a constant-sum
limit order at the strike, so assignment is an ordinary swap and there is no option token, no
keeper and no settlement contract. Phi and PhiInv are Solady fixed-point; `CurveProbeSolady.sol`
measures 5e-12 error against mpmath, and the guard band `EPS = 2e-6` WAD is sized from the
measured 1.18e-6 PhiInv-to-Phi round trip rather than from a textbook error bound.

`Coverage` (`Opcode._93`, `contracts/src/instructions/Coverage.sol`) is a 5-byte wrapper
instruction. It runs the curve first, then requires
`amountOut <= min(balanceOf(maker), allowance(maker, AQUA))` and otherwise reverts
`NotCovered(need, free)`. Order matters: clamping the balance before the curve would change
`X/L` and therefore the price, not just the size. `Aqua.safeBalances` returns the virtual
balance with no clamp to the wallet, so this instruction is the only place the maker's real
wallet is read before the quote is returned, and `StrikelineViews.coverage()` publishes the
max fillable so the front end never asks for more.

Written in Solidity 0.8.30 and tested with Foundry: 89 tests, including a quote-equals-swap
fuzz, a theta-monotonicity invariant, and `test_Book_FillOnOneLegShrinksSiblingDepth` in
`test/strikeline/StrikelineBook.t.sol`. `AquaBaseLiveFork.t.sol` fills real third-party
WETH/USDC maker liquidity through the official 1inch v1.0.2 router
`0x111111338c5091E8440b67B168bAe16a668AC0De` on an anvil Base mainnet fork, and our own router
is deployed on that fork against the same official registry
`0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`. Measured gas cost is 657-667k per RMM fill,
around 1 cent on Base, and `forge build --sizes` puts the router at 23,966 bytes, 610 bytes
under the EIP-170 limit. The front end is a Next.js and React app with Tailwind, wagmi and
viem, plus a TypeScript SwapVM encoder checked against Solidity-generated vectors; every curve
pixel on screen is an `eth_call` into the VM rather than a reimplementation of the maths.
