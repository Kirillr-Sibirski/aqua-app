# Protocol fee

## In plain English

Every time someone trades with a Strikeline offer, they pay a small extra fee: **0.10% of what they
put in**. That fee goes to the protocol's treasury. It is paid by the buyer (the taker) on top of the
trade, so the maker's premium is not reduced by it.

- **Who pays:** the taker, on every fill.
- **Who receives it:** the treasury address in the deployment manifest (`protocolFeeReceiver`, or the
  router owner if none is set). On the demo fork that is anvil account #0,
  `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.
- **Rate:** 0.10% of the taker's input, in the token they pay with (USDC when buying WETH, WETH when
  selling it).
- **What the maker gets:** exactly what a fee-less offer would pay for the same trade. The fee never
  touches the maker's reserves.

The ticket shows it in one line under the premium: *Protocol fee 0.10% of each fill*.

## How it works

The fee uses 1inch SwapVM's own `FeeProtocol` instruction, which the Strikeline router already carries
(`StrikelineOpcodes` keeps every official instruction except `PeggedSwap`). No new contract code was
needed.

### Program layout

```
before:  Deadline · Coverage · RmmSwap · Salt
after:   Deadline · FeeProtocol(tokenIn, 0.10% → treasury) · Coverage · RmmSwap · Salt
```

`FeeProtocol` is a wrapper: it runs the rest of the program inside itself. On an exact-in fill it takes
the fee off the taker's input, runs `Coverage · RmmSwap` on the net amount, then adds the fee back onto
what the taker pays. On an exact-out fill it prices first and grosses the input up by the fee. It sits
before `Coverage` so that both the solvency check and the curve see the net trade.

Fee units follow SwapVM: `1e7` is 100%, so 0.10% is `10_000`.

### Why it does not break the option

The leg program deliberately has no *flat* fee: a fee left inside the reserves would push them off the
curve and leak premium to the next taker. A protocol fee is different. During settlement SwapVM sends
the fee straight to the receiver and pushes only `amountIn − fee` into the maker's Aqua balance, which is
exactly the amount `RmmSwap` priced. The reserves stay on the curve, so the covered-call replication,
the decay band and settlement at the strike are unchanged.

### How Coverage treats it

`Coverage` counts a protocol fee as part of the maker's obligation only when it is charged in the
**output** token. Strikeline charges it in the **input** token, which the taker pays, so the amount the
maker's wallet must deliver is unchanged and `Coverage` still refuses exactly the fills it refused before.

## Tests

`contracts/test/strikeline/StrikelineProtocolFee.t.sol`:

| Test | Proves |
|---|---|
| `test_Fee_GoesToTreasury_QuoteEqualsSwap` | The treasury receives 0.10% of the input, the maker receives the rest, and `quote() == swap()` |
| `test_Fee_LeavesTheCurveAndPremiumUnchanged` | A fee leg pays the same output and ends with the same reserves as a fee-less leg given the net input; settlement at expiry differs only by the fee |
| `test_Fee_CoverageStillRefusesUndeliverableSize` | With the fee in the program, `Coverage` still reverts `NotCovered(needed, free)` for a size the wallet cannot deliver |

`web/src/components/curve/__tests__/program.test.ts` checks that the TypeScript builder places
`FeeProtocol` between `Deadline` and `Coverage`, leaves every other instruction byte-identical, and that
the program decoders still find the same curve arguments.

```bash
cd contracts && forge test --match-path test/strikeline/StrikelineProtocolFee.t.sol -vv
```

## Scope

Offers published from the app carry the fee. The scripted demo (`make story-*`) still ships fee-less
legs, so its recorded numbers and assertions are unchanged.
