// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";

import { WadMath } from "../math/WadMath.sol";
import { Gaussian } from "../math/Gaussian.sol";

/// @title RmmSwap
/// @notice A covered call written as a swap curve. RMM-01 (Angeris-Evans-Chitra 2021, §3.3) with the
///         curvature driven by the block clock, so the position decays like an option instead of sitting
///         at a fixed shape.
///
/// @dev The trading function, per unit of liquidity `L`, with risky reserve `X` in `[0, L]`:
///
///          Y = L*K*Phi( Phi^-1(1 - X/L) - s )        s = sigma*sqrt(tau)
///          tau = max(maturity - block.timestamp, TAU_FLOOR) / 365 days,  0 once matured
///
///      At spot `S` the no-arbitrage reserve point is `X = L*(1 - Phi(d1))`, `Y = L*K*Phi(d2)`, so the
///      position value `S*X + Y = L*(S - C_BS(S, K, sigma, tau))`: long spot, short a call struck at K.
///      By put-call parity the same bytes are a cash-secured put when the reserves start stable-heavy.
///      Delta is `Phi(-d1)`; arbitrageurs perform the hedge and the maker earns theta.
///
///      LIQUIDITY IS FIXED AND THE INVARIANT OFFSET IS ZERO. Reserves therefore sit exactly on the curve
///      and the replication claim is provable. The consequence is the fee model: as `tau` falls, the curve
///      moves away from a stale reserve point in BOTH directions (`Phi(z - s)` rises as `s` falls), so a
///      trade clears only once it is large enough to close the gap. Decay is a widening two-sided band,
///      and whoever crosses it pays the accrued theta to the maker. There is deliberately no fee
///      instruction in the program: a flat fee would push reserves off the curve and leak that premium to
///      the next taker.
///
///      Settlement needs no oracle, no keeper and no option token. At `tau == 0` the curve degenerates in
///      closed form to `Y = K*(L - X)`, a constant-sum order selling the remaining risky at exactly `K`,
///      so assignment is an ordinary swap performed by whoever wants the arbitrage. That window is gated
///      one-way, otherwise an expired leg would be a free at-the-money straddle written to the world.
///
///      Pure leaf instruction: reads `block.timestamp`, touches no storage, so `quote() == swap()` holds by
///      construction and it runs under `STATICCALL`.
///
/// @dev Encoding (62 arg bytes, 64 with the instruction header):
///        [uint8 flags][uint64 sigmaWad][uint40 maturity][uint128 strikeWad]
///        [uint128 liquidityWad][uint64 rateRisky][uint64 rateStable]
library RmmSwap {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;
    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    /// @notice The trade is smaller than the accrued decay band; `shortfall` is what it must cover.
    error RmmInsideSpread(uint256 shortfall);
    /// @notice The requested output exceeds the reserve the curve can release.
    error RmmExceedsReserve(uint256 requested, uint256 available);
    /// @notice After maturity the leg only trades in the assignment direction.
    error RmmSettlementOneWay();
    /// @notice Reserves are outside the curve's domain (`X > L` or `Y > L*K`).
    error RmmOutOfDomain();

    Opcode internal constant opcode = Opcode._55;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;

    /// @dev Keeps gamma finite in the last hour, where quote-to-fill drift would otherwise blow up.
    uint256 internal constant TAU_FLOOR = 1 hours;

    /// @dev Maker-favouring guard band, absolute in normalised units. Sized from the measured composite
    ///      `Phi^-1 -> Phi` round-trip error of 1.18e-6, not from the A&S erf bound on `Phi` alone
    ///      (6.95e-8): the inverse is looser because the erf error divides by the density in the tails.
    ///      It buys a documented minimum trade size instead of an unbounded relative error on dust.
    uint256 internal constant EPS = 2e-6 * 1e18;

    uint8 internal constant FLAG_RISKY_IS_TOKEN_A = 1 << 0;
    uint8 internal constant FLAG_POST_EXPIRY_ONE_WAY = 1 << 1;
    uint8 internal constant FLAG_POST_EXPIRY_OUT_IS_RISKY = 1 << 2;

    struct Args {
        uint8 flags;
        uint64 sigmaWad;
        uint40 maturity;
        uint128 strikeWad;
        uint128 liquidityWad;
        uint64 rateRisky;
        uint64 rateStable;
    }

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 62;
    }

    function build(Args memory a) internal pure returns (bytes memory) {
        MemoryPtr start = MemoryPtrLib.alloc(sizeOf());
        MemoryPtr ptr = start.pushHeader(opcode).push(a.flags).push(uint256(a.sigmaWad), 8).push(uint256(a.maturity), 5)
            .push(uint256(a.strikeWad), 16).push(uint256(a.liquidityWad), 16).push(uint256(a.rateRisky), 8).push(
            uint256(a.rateStable), 8
        );
        start.patchLength(ptr);
        return ptr.resolve();
    }

    function parse(bytes calldata args) internal pure returns (Args memory a) {
        a.flags = args.at(0).asU8();
        a.sigmaWad = args.at(1).asU64();
        a.maturity = args.at(9).asU40();
        a.strikeWad = args.at(14).asU128();
        a.liquidityWad = args.at(30).asU128();
        a.rateRisky = args.at(46).asU64();
        a.rateStable = args.at(54).asU64();
    }

    /// @notice Time to maturity in years (WAD), floored below and zero once matured.
    function tauOf(uint40 maturity, uint256 nowTs) internal pure returns (uint256) {
        if (nowTs >= maturity) {
            return 0;
        }
        uint256 remaining = maturity - nowTs;
        if (remaining < TAU_FLOOR) {
            remaining = TAU_FLOOR;
        }
        return remaining * WAD / YEAR;
    }

    function exec(Context memory ctx, bytes calldata args) internal view {
        Args memory a = parse(args);

        bool aToB = ctx.query.tokenIn < ctx.query.tokenOut;
        bool riskyIsA = a.flags & FLAG_RISKY_IS_TOKEN_A != 0;
        bool riskyIn = aToB == riskyIsA;

        uint256 tau = tauOf(a.maturity, block.timestamp);
        if (tau == 0 && a.flags & FLAG_POST_EXPIRY_ONE_WAY != 0) {
            bool outIsRisky = !riskyIn;
            if (outIsRisky != (a.flags & FLAG_POST_EXPIRY_OUT_IS_RISKY != 0)) {
                revert RmmSettlementOneWay();
            }
        }
        // s = sigma * sqrt(tau); zero after maturity, which takes the closed-form constant-sum branch.
        uint256 s = tau == 0 ? 0 : uint256(a.sigmaWad) * WadMath.sqrt(tau) / WAD;

        uint256 rateIn = riskyIn ? a.rateRisky : a.rateStable;
        uint256 rateOut = riskyIn ? a.rateStable : a.rateRisky;

        uint256 balanceIn = ctx.swap.balanceIn * rateIn;
        uint256 balanceOut = ctx.swap.balanceOut * rateOut;

        uint256 K = a.strikeWad;
        uint256 L = a.liquidityWad;

        // Guard band in the units of whichever reserve `tokenOut` is.
        uint256 epsOut = Math.ceilDiv((riskyIn ? L * K / WAD : L) * EPS, WAD);

        if (ctx.query.isExactIn) {
            uint256 newIn = balanceIn + ctx.swap.amountIn * rateIn;
            uint256 newOut = riskyIn ? stableOf(newIn, K, s, L) : riskyOf(newIn, K, s, L);
            if (newOut + epsOut > balanceOut) {
                revert RmmInsideSpread(newOut + epsOut - balanceOut);
            }
            ctx.swap.amountOut = (balanceOut - newOut - epsOut) / rateOut;
        } else {
            uint256 need = ctx.swap.amountOut * rateOut + epsOut;
            if (need > balanceOut) {
                revert RmmExceedsReserve(need, balanceOut);
            }
            uint256 newOut = balanceOut - need;
            uint256 newIn = riskyIn ? riskyOf(newOut, K, s, L) : stableOf(newOut, K, s, L);
            if (newIn < balanceIn) {
                revert RmmInsideSpread(balanceIn - newIn);
            }
            ctx.swap.amountIn = Math.ceilDiv(newIn - balanceIn, rateIn);
        }
    }

    /// @notice `Y(X) = L*K*Phi(Phi^-1(1 - X/L) - s)`, the stable reserve the curve requires at risky
    ///         reserve `X`. Rounded up, which favours the maker whether the result lands in `balanceOut`
    ///         (exact-in) or `balanceIn` (exact-out).
    /// @dev At `s == 0` this is the closed form `K*(L - X)`, so settlement skips the Gaussian entirely.
    function stableOf(uint256 x, uint256 K, uint256 s, uint256 L) internal pure returns (uint256) {
        uint256 r = Math.ceilDiv(x * WAD, L);
        if (r > WAD) {
            revert RmmOutOfDomain();
        }
        if (s == 0) {
            return Math.ceilDiv(K * (L - x), WAD);
        }
        int256 z = Gaussian.icdf(WAD - r) - int256(s);
        return Math.ceilDiv(L * K / WAD * Gaussian.cdf(z), WAD);
    }

    /// @notice The inverse: the risky reserve the curve requires at stable reserve `Y`. Rounded up.
    function riskyOf(uint256 y, uint256 K, uint256 s, uint256 L) internal pure returns (uint256) {
        uint256 lk = L * K / WAD;
        if (y > lk) {
            revert RmmOutOfDomain();
        }
        if (s == 0) {
            return L - Math.mulDiv(y, WAD, K);
        }
        int256 z = Gaussian.icdf(y * WAD / lk) + int256(s);
        return Math.ceilDiv(L * (WAD - Gaussian.cdf(z)), WAD);
    }
}
