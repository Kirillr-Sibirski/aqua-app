# OPCODES — Strikeline's two SwapVM instructions

The frozen wire format of `RmmSwap` (`0x55`) and `Coverage` (`0x93`), byte by byte, with the registers each
one reads and writes and the errors each one can raise.

**Every constant on this page is asserted on chain.** `contracts/test/invariants/OpcodeLayout.t.sol` pins the
hex strings, the field offsets, the flag bits, the opcode slots and the error selectors, so this document
cannot drift from the compiled contracts without a test failing first.

---

## Why the layout is frozen

An Aqua strategy is identified by `keccak256(abi.encode(order))`, and `order.data` contains the program bytes.
Move one byte and the hash moves with it — but nothing fails at ship time, because **Aqua never reads the
program**. `ship()` succeeds, the maker sees a live strategy, and then every quote reverts inside
`Aqua.safeBalances` with `SafeBalancesForTokenNotInActiveStrategy`, which names a token and says nothing about
encoding. To an aggregator, and to the maker's own UI, that is indistinguishable from an empty market.

`test_Layout_OneByteDriftBricksTheStrategy` reproduces it end to end: flipping the low bit of `rateStable` —
economically meaningless — moves the strategy hash from
`0xc919fb8b…` to `0xf095fd18…`, the quote reverts with Aqua's `0xb63386a6`, and Aqua ships the drifted bytes
without complaint.

That is why there are three independent pins on these bytes:

| Pin | Where | What it catches |
|---|---|---|
| Solidity layout freeze | `contracts/test/invariants/OpcodeLayout.t.sol` | any change to `build()` or `parse()` |
| Cross-language vectors | `contracts/test/encoding/`, `web/src/lib/swapvm/` | the TypeScript encoder disagreeing with Solidity |
| Decimal golden vectors | `contracts/test/invariants/ScaleVectors.t.sol` | a `1e12` applied in the wrong place |

---

## Instruction framing (from `@1inch/swap-vm`)

Every SwapVM instruction is a two-byte header followed by its arguments:

```
[uint8 opcode][uint8 argsLength][ ...argsLength bytes of arguments... ]
```

`InstructionBuilder.sizeOf()` is that 2-byte header. `argsLength` is a single byte, so no instruction may carry
more than 255 argument bytes. Arguments are big-endian and read left to right by
`InstructionArgs.at(offset).asU<N>()`, where `offset` is counted **from the first argument byte**, not from the
opcode. The offsets in the tables below are given both ways.

`ContextLib.runLoop` walks the program: read opcode, read length, slice the arguments, dispatch, advance. There
is no jump table and no alignment — the layout below *is* the ABI.

---

## Registers

Both instructions operate on `Context` (`@1inch/swap-vm/src/libs/VM.sol`):

```solidity
struct SwapQuery {          // read-only
    bytes32 orderHash;
    address maker;          // whose wallet Coverage reads
    address taker;
    address tokenIn;        // Coverage checks receivability of this when FLAG_CHECK_TOKEN_IN is set
    address tokenOut;       // Coverage checks deliverability of this, always
    bool    isExactIn;      // selects RmmSwap's branch
}

struct SwapRegisters {      // mutable; the instruction computes the missing one
    uint256 balanceIn;      // the strategy's virtual reserve of tokenIn, from Aqua
    uint256 balanceOut;     // the strategy's virtual reserve of tokenOut, from Aqua
    uint256 amountIn;       // set by RmmSwap when !isExactIn
    uint256 amountOut;      // set by RmmSwap when isExactIn
}

struct ProtocolFee {
    FeeMeta          meta;      // Coverage reads decodeIsTokenOut(meta)
    FeeReceiver[]    receivers;
    uint256          feeTotal;  // added to the obligation when the fee is taken in tokenOut
}
```

`balanceIn` / `balanceOut` arrive in **token units**. `RmmSwap` multiplies them into one normalised WAD space
by `rateRisky` / `rateStable`, computes there, and divides back out. That is the only place decimals exist —
see [Decimals](#decimals).

---

## `RmmSwap` — opcode `0x55`

`contracts/src/instructions/RmmSwap.sol`. A covered call written as a swap curve: RMM-01 with the curvature
driven by `block.timestamp`.

```
Y = L·K·Φ( Φ⁻¹(1 − X/L) − s )        s = σ·√τ
τ = max(maturity − block.timestamp, 1 hour) / 365 days,   and 0 once matured
```

**64 bytes total: 2 header + 62 arguments.**

| Arg offset | Byte offset | Size | Field | Type | Meaning |
|---:|---:|---:|---|---|---|
| — | 0 | 1 | opcode | `uint8` | `0x55` |
| — | 1 | 1 | argsLength | `uint8` | `0x3e` = 62 |
| 0 | 2 | 1 | `flags` | `uint8` | see below |
| 1 | 3 | 8 | `sigmaWad` | `uint64` | implied vol, WAD. `0.6e18` = 60% annualised |
| 9 | 11 | 5 | `maturity` | `uint40` | unix seconds. Past it, `τ = 0` and the curve is constant-sum at `K` |
| 14 | 16 | 16 | `strikeWad` | `uint128` | `K`, stable per risky, WAD |
| 30 | 32 | 16 | `liquidityWad` | `uint128` | `L`, the risky-side scale, WAD. Fixed; the invariant offset is zero |
| 46 | 48 | 8 | `rateRisky` | `uint64` | multiplier taking the risky token's units into WAD |
| 54 | 56 | 8 | `rateStable` | `uint64` | multiplier taking the stable token's units into WAD |

### Flags

| Bit | Mask | Name | Effect |
|---:|---|---|---|
| 0 | `0x01` | `FLAG_RISKY_IS_TOKEN_A` | the risky leg is the order's `tokenA` (the lower address). Set it to match how `MakerTraitsLib.build` sorted the pair, or the curve runs backwards |
| 1 | `0x02` | `FLAG_POST_EXPIRY_ONE_WAY` | after maturity, refuse one direction. Without it an expired leg is a free at-the-money straddle written to the world |
| 2 | `0x04` | `FLAG_POST_EXPIRY_OUT_IS_RISKY` | which direction survives: set means the leg only *delivers the risky token*, i.e. assignment |

A covered-call leg on a `WETH < USDC` pair is `0x07`.

### Canonical bytes

`flags = 0x07`, `σ = 0.6e18`, `maturity = 1800000000`, `K = 2600e18`, `L = 12e18`, `rateRisky = 1`,
`rateStable = 1e12`:

```
55 3e
07
0853a0d2313c0000
006b49d200
00000000000000008cf23f909c0fa000
0000000000000000a688906bd8b00000
0000000000000001
000000e8d4a51000
```

flat:

```
0x553e070853a0d2313c0000006b49d200000000000000008cf23f909c0fa000000000000000000000a688906bd8b000000000000000000001000000e8d4a51000
```

### Registers

Reads `query.tokenIn`, `query.tokenOut`, `query.isExactIn`, `swap.balanceIn`, `swap.balanceOut`, and
`block.timestamp`. Writes exactly one of `swap.amountOut` (when `isExactIn`) or `swap.amountIn` (when not).

Direction is derived, not passed: `riskyIn = (tokenIn < tokenOut) == FLAG_RISKY_IS_TOKEN_A`.

Touches no storage. It is a pure leaf instruction over `block.timestamp`, so `quote() == swap()` holds by
construction and it runs under `STATICCALL`.

### The guard band

`EPS = 2e-6` in normalised units, charged against `balanceOut` in whichever reserve `tokenOut` is:

```
epsOut = ceil( (riskyIn ? L·K : L) · EPS / WAD )
```

It is not a fee — it is a maker-favouring numerical margin, and it is sized from the measured error budget, not
picked. `Gaussian.cdf` is accurate to `6.95e-8` in probability units and the `Gaussian.icdf` round trip to
`1.18e-6` in z units, so one curve evaluation carries at most

```
EPS_EVAL      = 6.95e-8 + sup(φ)·1.18e-6 = 6.95e-8 + 0.39894·1.18e-6 = 5.4025e-7
EPS_ROUNDTRIP = 2 · EPS_EVAL                                          = 1.0805e-6
```

`2e-6 / 1.0805e-6 = 1.85`, so the band strictly dominates the error: a quote is wrong in the maker's favour or
not at all. `test_Eps_DominatesTheRoundTripErrorBound` asserts that ratio; shrinking `EPS` to let a smaller
trade through fails the suite. The cost is a documented minimum trade size instead of an unbounded relative
error on dust.

### Errors

| Selector | Error | Raised when |
|---|---|---|
| `0xe2047c83` | `RmmInsideSpread(uint256 shortfall)` | the trade is smaller than the accrued decay band. `shortfall` is what it must still cover, in normalised WAD of the relevant reserve |
| `0xcb39c036` | `RmmExceedsReserve(uint256 requested, uint256 available)` | exact-out asked for more than the reserve can release |
| `0x40f74638` | `RmmSettlementOneWay()` | past maturity, and the trade is in the closed direction |
| `0x18c40ced` | `RmmOutOfDomain()` | reserves outside the curve's domain: `X > L`, or `Y > L·K` |

`RmmInsideSpread` is the normal, expected refusal. `StrikelineViews.bandFor` publishes both sides of that band
so a caller can size analytically instead of probing with reverting calls.

---

## `Coverage` — opcode `0x93`

`contracts/src/instructions/Coverage.sol`. Portfolio margin for a book, enforced inside the call that prices
the trade.

**5 bytes total: 2 header + 3 arguments.**

| Arg offset | Byte offset | Size | Field | Type | Meaning |
|---:|---:|---:|---|---|---|
| — | 0 | 1 | opcode | `uint8` | `0x93` |
| — | 1 | 1 | argsLength | `uint8` | `0x03` = 3 |
| 0 | 2 | 1 | `flags` | `uint8` | bit 0 = `FLAG_CHECK_TOKEN_IN` |
| 1 | 3 | 2 | `haircutBps` | `uint16` | reserve held back from the wallet, `1e4` = 100%. Must be `< 10000` |

### Canonical bytes

```
no haircut, no tokenIn check   0x9303000000
tokenIn check, 2.5% haircut    0x93030100fa
```

### Registers

`Coverage` is a **wrapper**, not a leaf. It calls `ctx.runLoop()` first, which executes the rest of the program
— so pricing happens on the true shipped reserves — and only then reads

```
free(token) = min( IERC20(token).balanceOf(maker), IERC20(token).allowance(maker, AQUA) ) · (1 − haircutBps/1e4)
```

and requires `swap.amountOut` (plus `fee.feeTotal` when `FeeMetaLib.decodeIsTokenOut(fee.meta)`) to fit inside
`free(tokenOut)`.

Two consequences worth stating explicitly:

- **It runs after the curve on purpose.** Clamping `balanceOut` before the curve would move the reserve point and
  therefore change the **price**, not just the size — quoting a different option than the maker wrote.
- **It reverts rather than clamping.** A partial fill would need a second `runLoop` in exact-out mode, roughly
  doubling the gas of an already transcendental curve. The quote is a hard solvency bound and the error carries
  both numbers, so a caller can resize on the next attempt. `StrikelineViews.coverage(maker, token)` publishes
  the same figure, and `test_Liveness_PublishedCoverageIsTheEnforcedBound` asserts that the published number is
  fillable and one wei past it is not.

Because every leg of a book reads the same wallet, a fill on one leg shrinks what its siblings can deliver **in
the same block**, with no keeper, no shared storage and no message passing between strategies.

### Errors

| Selector | Error | Raised when |
|---|---|---|
| `0x09d16e81` | `NotCovered(uint256 needed, uint256 free)` | the priced output exceeds what the maker's wallet can actually deliver. Both numbers are in `tokenOut` units |
| `0xb1f0d0c9` | `CoverageHaircutTooLarge(uint256 haircutBps)` | **build time only**: `haircutBps >= 10000` |

---

## The leg program

A Strikeline leg is four instructions, 86 bytes:

```
Deadline(maturity + grace) . Coverage(flags, haircut) . RmmSwap(...) . Salt(n)
    7 bytes                        5 bytes               64 bytes      10 bytes
```

```
0x2005006b49d908 9303000000 553e07…e8d4a51000 02080000000000000065
```

**The order is load-bearing.**

- `Coverage` must precede the curve, because it *wraps* it. Placing it after would check a register the curve
  had already finished with, outside the nested loop, and the wrapper semantics would be lost.
- `Deadline` must precede `Coverage`, or an expired leg pays for a full Gaussian evaluation before being
  refused.
- `Salt` is last and does nothing at run time. It exists only to move the strategy hash: Aqua marks a docked
  hash `0xff` forever, so a rolled leg with identical economics would otherwise collide with the one it
  replaces. `test_Liveness_DockIsTerminalAndTheHashIsBurned` demonstrates both halves.

### Other errors a caller will see

| Selector | Error | Meaning |
|---|---|---|
| `0x446d79e8` | `StrikelineOpcodes.UnknownOpcode(uint256)` | an opcode this router does not dispatch. `PeggedSwap` (`0x58`) is the one official instruction not wired, to fit under EIP-170 |
| `0xb63386a6` | `IAqua.SafeBalancesForTokenNotInActiveStrategy(address,address,bytes32,address)` | the strategy hash is unknown or docked. **This is also what encoding drift looks like** |

---

## Decimals

`RmmSwap` has one normalised WAD space and carries decimals as two `uint64` multipliers. There are exactly six
places the scale is applied, and `contracts/test/invariants/ScaleVectors.t.sol` pins all six against literals
read off the chain:

| | Path | Scale applied |
|---|---|---|
| P1 | exact-in, stable in / risky out | `balanceIn × rateStable`, `amountIn × rateStable`, `amountOut ÷ rateRisky` |
| P2 | exact-in, risky in / stable out | `balanceIn × rateRisky`, `amountIn × rateRisky`, `amountOut ÷ rateStable` — **truncates** |
| P3 | exact-out, stable in / risky out | `amountOut × rateRisky`, `amountIn = ceil(· ÷ rateStable)` — **carries** |
| P4 | exact-out, risky in / stable out | `amountOut × rateStable`, `amountIn = ceil(· ÷ rateRisky)` |
| P5 | view `stableFor` | the maker's ship amount, `yWad ÷ rateStable` |
| P6 | view `bandFor` | the minimum fillable size a UI publishes, `÷ rateStable` |

For USDC(6)/WETH(18): `rateRisky = 1`, `rateStable = 1e12`.

The control in that file is the same leg shipped against an 18-decimal stable with both rates set to `1` and
byte-identical normalised reserves, which lets each vector name the exact digit the 6-decimal path moved:

```
exact-in  486 stable  ->  195559373061486364 wei WETH on both legs.        Identical.
exact-in  0.514 WETH  ->  1268028694.567645426400 stable.
                          USDC gets 1268028694: TRUNCATED toward the maker.
exact-out 0.412 WETH  ->  1025989444.720966964800 stable.
                          USDC pays 1025989445: CARRIED toward the maker.
exact-out 980 stable  ->  396768828946486052 wei WETH on both legs.        Identical.
```

Rounding direction is asserted per path and asserted **tight**: for exact-in, one more unit of output would
overdraw the reserve the curve leaves behind; for exact-out, one less unit of input would underpay it.

`rateRisky` and `rateStable` are `uint64`, so the largest representable scale is ~1.8e19 — enough for any pair
down to 0 decimals against an 18-decimal counterpart.

---

## Gas

Measured with `gasleft()` deltas around real external calls on real Aqua-mode orders
(`contracts/test/invariants/GasReport.t.sol`). Each instruction is priced as the difference between two
programs identical except for it, on a second pass so that no program is charged for cold slots the others then
find warm.

| Program | quote | swap |
|---|---:|---:|
| `RmmSwap . Salt` | 109,440 | 207,480 |
| `Coverage . RmmSwap . Salt` | 112,702 | 210,738 |
| `Deadline . Coverage . RmmSwap . Salt` (the shipped leg) | 113,148 | 211,182 |
| `XYCSwap . Salt` (official instruction, same router, reference) | 8,809 | 106,848 |

| Instruction | quote | swap |
|---|---:|---:|
| `RmmSwap` (over `XYCSwap`) | 100,631 | 100,632 |
| `Coverage` | 3,262 | 3,258 |
| `Deadline` | 446 | 444 |

The two columns agree to within two gas per instruction, which is what a view-only instruction should look
like. Of `RmmSwap`'s 100,631, the Gaussian is **99,062**: at `τ = 0` the curve degenerates to the closed form
`Y = K·(L − X)` and a quote costs 14,056.

`StrikelineRouter` runtime code is **23,633 bytes**, 943 under the EIP-170 limit of 24,576, with no size
override anywhere in `foundry.toml`. `test_Size_RouterIsUnderEip170` asserts it against the deployed contract.
