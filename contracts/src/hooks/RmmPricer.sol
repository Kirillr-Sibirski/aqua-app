// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { WadMath } from "../math/WadMath.sol";
import { RmmSwap } from "../instructions/RmmSwap.sol";

/// @title RmmPricer
/// @notice The RMM-01 pricing step of `RmmSwap`, lifted out of the SwapVM so a Uniswap v4 hook can run
///         the identical curve on pool reserves instead of Aqua reserves.
///
/// @dev THIS FILE CONTAINS NO MATHS. It imports `RmmSwap.stableOf`, `RmmSwap.riskyOf`, `RmmSwap.tauOf`,
///      `RmmSwap.EPS` and `RmmSwap.TAU_FLOOR` and reverts with `RmmSwap`'s own custom errors. Everything
///      here is the same reserve bookkeeping `RmmSwap.exec` does around those calls, expressed against
///      plain numbers rather than a `Context`. Forking the Gaussian would have made the venue comparison
///      meaningless: the whole point of the experiment is that only the plumbing differs.
///
///      The one structural difference is where the reserves come from. In Aqua they are
///      `ctx.swap.balanceIn/balanceOut`, the registry's per-strategy virtual ledger, which `pull`/`push`
///      walk on every fill. Uniswap v4 has no such ledger - `PoolManager` stores a tick-indexed
///      concentrated-liquidity position, which is not the same object at all - so the hook has to keep
///      `(X, Y)` itself and walk it in `beforeSwap`. That storage is the hook's, not the pool's.
library RmmPricer {
    uint256 internal constant WAD = 1e18;

    /// @notice The terms of one option leg. Same fields as `RmmSwap.Args`, minus the SwapVM packing:
    ///         a hook reads them from its own storage, not from instruction bytes.
    struct Terms {
        uint40 maturity;
        uint64 sigmaWad;
        uint128 strikeWad;
        uint128 liquidityWad;
        /// @dev Scales token units into the curve's normalised WAD space (1 for 18 decimals, 1e12 for 6).
        uint64 rateRisky;
        uint64 rateStable;
        /// @dev After maturity the leg trades in the assignment direction only, never as a free straddle.
        bool oneWayAfterExpiry;
        /// @dev Which direction assignment is: true when the expired leg pays out the risky asset.
        bool assignmentPaysRisky;
    }

    /// @notice `s = sigma * sqrt(tau)` at the current block: the single parameter that shapes the curve.
    function sNow(Terms memory t) internal view returns (uint256) {
        uint256 tau = RmmSwap.tauOf(t.maturity, block.timestamp);
        if (tau == 0) {
            return 0;
        }
        return uint256(t.sigmaWad) * WadMath.sqrt(tau) / WAD;
    }

    /// @notice Price one trade against reserves `(reserveIn, reserveOut)`, both in token units of their
    ///         own side, and return the pair the caller must move.
    /// @param riskyIn True when the taker is selling the risky asset into the leg.
    /// @param exactIn True when `amount` is the input, false when it is the desired output.
    /// @dev Mirrors `RmmSwap.exec` statement for statement, including the maker-favouring `EPS` guard
    ///      band and the `ceilDiv` on the exact-out input. A trade smaller than the accrued decay band
    ///      reverts with `RmmInsideSpread(shortfall)` - the theta toll, not a fee.
    function price(
        Terms memory t,
        bool riskyIn,
        bool exactIn,
        uint256 amount,
        uint256 reserveIn,
        uint256 reserveOut
    )
        internal
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        uint256 tau = RmmSwap.tauOf(t.maturity, block.timestamp);
        if (tau == 0 && t.oneWayAfterExpiry) {
            if (!riskyIn != t.assignmentPaysRisky) {
                revert RmmSwap.RmmSettlementOneWay();
            }
        }
        uint256 s = tau == 0 ? 0 : uint256(t.sigmaWad) * WadMath.sqrt(tau) / WAD;

        uint256 rateIn = riskyIn ? t.rateRisky : t.rateStable;
        uint256 rateOut = riskyIn ? t.rateStable : t.rateRisky;

        uint256 balanceIn = reserveIn * rateIn;
        uint256 balanceOut = reserveOut * rateOut;

        uint256 K = t.strikeWad;
        uint256 L = t.liquidityWad;

        // Guard band in the units of whichever reserve `tokenOut` is.
        uint256 epsOut = Math.ceilDiv((riskyIn ? L * K / WAD : L) * RmmSwap.EPS, WAD);

        if (exactIn) {
            amountIn = amount;
            uint256 newIn = balanceIn + amount * rateIn;
            uint256 newOut = riskyIn ? RmmSwap.stableOf(newIn, K, s, L) : RmmSwap.riskyOf(newIn, K, s, L);
            if (newOut + epsOut > balanceOut) {
                revert RmmSwap.RmmInsideSpread(newOut + epsOut - balanceOut);
            }
            amountOut = (balanceOut - newOut - epsOut) / rateOut;
        } else {
            amountOut = amount;
            uint256 need = amount * rateOut + epsOut;
            if (need > balanceOut) {
                revert RmmSwap.RmmExceedsReserve(need, balanceOut);
            }
            uint256 newOut = balanceOut - need;
            uint256 newIn = riskyIn ? RmmSwap.riskyOf(newOut, K, s, L) : RmmSwap.stableOf(newOut, K, s, L);
            if (newIn < balanceIn) {
                revert RmmSwap.RmmInsideSpread(balanceIn - newIn);
            }
            amountIn = Math.ceilDiv(newIn - balanceIn, rateIn);
        }
    }

    /// @notice The stable reserve the curve requires at risky reserve `xWad`, in normalised WAD units.
    /// @dev A leg must be funded with reserves that sit exactly on the curve as THIS chain computes it,
    ///      with this approximated `Phi`. One wei low and every quote reverts; one wei high and the
    ///      surplus goes to the first taker. Ask the chain, do not compute it off-chain.
    function stableFor(Terms memory t, uint256 xWad) internal view returns (uint256) {
        return RmmSwap.stableOf(xWad, t.strikeWad, sNow(t), t.liquidityWad);
    }

    /// @notice The risky reserve the curve requires at stable reserve `yWad`, in normalised WAD units.
    function riskyFor(Terms memory t, uint256 yWad) internal view returns (uint256) {
        return RmmSwap.riskyOf(yWad, t.strikeWad, sNow(t), t.liquidityWad);
    }
}
