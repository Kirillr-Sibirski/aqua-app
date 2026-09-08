// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { WadMath } from "./math/WadMath.sol";
import { RmmSwap } from "./instructions/RmmSwap.sol";
import { Coverage } from "./instructions/Coverage.sol";

/// @title StrikelineViews
/// @notice Read-only helpers a maker, a UI or a solver needs in order to interact with a Strikeline leg
///         without reimplementing the curve off-chain.
///
/// @dev The important one is `stableFor`. A leg must be shipped with reserves that sit exactly on the
///      curve as THIS CONTRACT computes it, using the same approximated `Phi`. Sizing the ship from a
///      float or from a true-`Phi` reference is a silent, permanent failure mode: one wei low and every
///      quote reverts (the strategy is bricked, and a docked strategy hash can never be re-shipped), one
///      wei high and the surplus is handed to the first taker. So the maker asks the chain where the
///      curve is, and ships that number.
abstract contract StrikelineViews {
    /// @notice The stable reserve the curve requires at risky reserve `xWad`, rounded up.
    /// @dev Ship with this. `xWad` picks the moneyness (`x = L*(1 - Phi(d1))`); choosing it in floating
    ///      point off-chain is fine because it only selects a point on the curve, whereas `y` must be the
    ///      chain's own value.
    function stableFor(
        uint128 strikeWad,
        uint64 sigmaWad,
        uint40 maturity,
        uint128 liquidityWad,
        uint256 xWad
    )
        external
        view
        returns (uint256 yWad)
    {
        return RmmSwap.stableOf(xWad, strikeWad, _sNow(sigmaWad, maturity), liquidityWad);
    }

    /// @notice The risky reserve the curve requires at stable reserve `yWad`, rounded up.
    function riskyFor(
        uint128 strikeWad,
        uint64 sigmaWad,
        uint40 maturity,
        uint128 liquidityWad,
        uint256 yWad
    )
        external
        view
        returns (uint256 xWad)
    {
        return RmmSwap.riskyOf(yWad, strikeWad, _sNow(sigmaWad, maturity), liquidityWad);
    }

    /// @notice Time to maturity in years (WAD) as the curve currently sees it: floored at one hour, and
    ///         zero once matured (which is what switches the leg into settlement).
    function tauNow(uint40 maturity) external view returns (uint256) {
        return RmmSwap.tauOf(maturity, block.timestamp);
    }

    /// @notice How much of `token` the maker can actually deliver through Aqua right now.
    /// @dev The same quantity `Coverage` enforces, so a caller can size a fill that will not revert. It is
    ///      shared across every leg backed by this wallet, which is the point of the book.
    function coverage(address maker, address token) external view returns (uint256) {
        return Coverage.free(_aqua(), maker, token, 0);
    }

    /// @notice Both sides of the accrued decay band at the given reserves: the smallest trade that clears
    ///         in each direction, in normalised WAD units.
    /// @dev With reserves pinned to the curve, time decay moves the curve away from them in both
    ///      directions, so small trades revert. This publishes that gap so a UI can shade it and an
    ///      arbitrageur can size analytically instead of probing with reverting calls.
    ///
    ///      The published number has to include `RmmSwap.EPS`, not just the curve gap. `exec` does not
    ///      clear a trade *at* the curve: it requires the new output reserve to sit a guard band inside
    ///      what the leg holds, `newOut + epsOut <= balanceOut`, with `epsOut` in the units of whichever
    ///      reserve leaves. So the band is read off the curve at the guarded reserve, not the real one —
    ///      which is the same arithmetic `exec` performs, one step earlier. Reading it at the real
    ///      reserve understates the minimum by one eps (449 ppm on the demo leg), and a taker who sends
    ///      the understated figure gets `RmmInsideSpread`.
    function bandFor(
        uint128 strikeWad,
        uint64 sigmaWad,
        uint40 maturity,
        uint128 liquidityWad,
        uint256 xWad,
        uint256 yWad
    )
        external
        view
        returns (uint256 minRiskyIn, uint256 minStableIn)
    {
        uint256 s = _sNow(sigmaWad, maturity);

        // `exec`'s `epsOut`, both ways round: risky leaves when stable comes in, and vice versa.
        uint256 epsRisky = Math.ceilDiv(uint256(liquidityWad) * RmmSwap.EPS, 1e18);
        uint256 epsStable = Math.ceilDiv(uint256(liquidityWad) * uint256(strikeWad) / 1e18 * RmmSwap.EPS, 1e18);

        // Buying risky needs enough stable to reach the curve's requirement at the risky reserve the
        // guard leaves behind; selling risky needs enough input to pull the curve's stable requirement
        // down to the stable reserve the guard leaves behind.
        uint256 yTarget =
            RmmSwap.stableOf(xWad > epsRisky ? xWad - epsRisky : 0, strikeWad, s, liquidityWad);
        uint256 xTarget =
            RmmSwap.riskyOf(yWad > epsStable ? yWad - epsStable : 0, strikeWad, s, liquidityWad);

        minStableIn = yTarget > yWad ? yTarget - yWad : 0;
        minRiskyIn = xTarget > xWad ? xTarget - xWad : 0;
    }

    /// @dev The Aqua registry this router settles through.
    function _aqua() internal view virtual returns (address);

    /// @dev `s = sigma * sqrt(tau)` at the current block, the single parameter that shapes the curve.
    function _sNow(uint64 sigmaWad, uint40 maturity) private view returns (uint256) {
        uint256 tau = RmmSwap.tauOf(maturity, block.timestamp);
        if (tau == 0) {
            return 0;
        }
        return uint256(sigmaWad) * WadMath.sqrt(tau) / 1e18;
    }
}
