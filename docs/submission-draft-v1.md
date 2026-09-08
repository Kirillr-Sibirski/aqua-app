---
name: Strikeline
has_repo: true
has_demo: false
has_video: true
---

## Tagline

Vol-selling market making on 1inch Aqua — pick the strike, the vol and the expiry yourself.

## Description

Every LP is already short an option, at an implied vol nobody chose and nobody got paid for.
Strikeline lets you choose the strike, the vol and the expiry, write the whole book from your
own wallet, and margin it like a real desk.

A maker writes a ladder of option-shaped liquidity legs — covered calls above spot,
cash-secured puts below — directly from their own wallet. Each leg is a SwapVM program whose
pricing curve is the option itself: the RMM-01 replicating market maker, whose shape decays
with the block clock, so holding it is short an option struck where the maker chose, at an
implied vol the maker chose.

One wallet balance backs the whole ladder at once. A custom instruction proves, inside the same
call that prices the trade, that every quote is actually deliverable from the real wallet, so
over-allocating across legs becomes portfolio margin rather than phantom depth.

Existing on-chain options venues lock the collateral in a vault, price from an oracle, mint an
option token and need a settlement transaction. If the option is expressed as a pricing curve
instead, all of that machinery disappears: settlement is an ordinary swap, exercise is an
arbitrage, and the premium arrives as a spread that widens with time decay.

It is built for semi-professional LPs and small desks holding ETH who already run v3 ranges or
ALM vaults, are therefore already short gamma at a vol nobody paid them for, and would like the
strike and the vol to be theirs.

## How it's made

We redeployed a SwapVM router against the official 1inch Aqua registry and added two custom VM
instructions to it.

The first is RmmSwap, a covered-call pricing curve. It implements the RMM-01 trading function,
where the curvature is a function of the time left to expiry read from the block timestamp, so
the curve decays on its own with no keeper and no maker transaction. Time decay moves the curve
away from the stale reserve point, which opens a spread that a taker has to close before a
trade clears — so theta arrives as a toll the arbitrageur pays rather than as a fee. At expiry
the curve degenerates in closed form to a constant-sum limit order at the strike, so physical
assignment is just an ordinary swap, and there is no oracle, no option token and no settlement
contract anywhere in the path.

The second is Coverage, a wrapper instruction. It runs the curve first, and then requires the
priced output to be deliverable from the maker's real wallet balance and Aqua allowance.
Because every leg reads the same wallet, a fill on one leg immediately shrinks the deliverable
depth of its siblings in the same block. That is portfolio margin enforced inside the pricing
call rather than by a clearinghouse, and it is only meaningful because Aqua lets a maker
over-allocate in the first place.

Everything is written in Solidity and tested with Foundry, including fills of real WETH and
USDC through the official contracts on a fork of Base. The front end is a Next.js app using
wagmi and viem that samples the curve straight out of the VM rather than reimplementing the
maths in TypeScript.
