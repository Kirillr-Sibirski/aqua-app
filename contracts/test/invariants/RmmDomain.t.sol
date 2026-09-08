// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, console2 } from "forge-std/Test.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { RmmSwap } from "../../src/instructions/RmmSwap.sol";

/// @title RmmDomainTest
/// @notice The representable domain of the curve, proved from the argument types rather than asserted.
///
/// @dev `RmmSwap` carries `strikeWad` and `liquidityWad` as `uint128`, and the two products the curve forms
///      from them are `L*K` and `(L*K/WAD)*Phi`. Whether those can overflow is not a matter of taste: it is
///      decided by the widths, and it is worth pinning because the failure mode is `Panic(0x11)` on every
///      quote of a strategy whose hash can never be re-shipped.
///
///        (2^128 - 1)^2 = 2^256 - 2^129 + 1 < 2^256
///
///      so `L*K` is safe for EVERY pair of `uint128` values, with no check needed and none paid for. The
///      second product inherits it: `L*K/WAD <= (2^256-1)/1e18`, and `Gaussian.cdf` returns at most `WAD`, so
///      `(L*K/WAD) * cdf <= L*K < 2^256`. That is why neither `stableOf` nor `riskyOf` carries a bound check
///      on the strike or the liquidity, and it is why widening either field to `uint256` would be a breaking
///      change in more than the wire format.
///
///      What is NOT bounded by the types is the reserve. `stableOf` computes `ceilDiv(x * WAD, L)` before it
///      can compare `x` against `L`, so a reserve past ~1.16e59 normalised units panics rather than reaching
///      `RmmOutOfDomain`. In the shipped program that reserve is `balanceIn + amountIn*rateIn`, all of it
///      maker- or taker-supplied, so the bound is documented here rather than checked: reaching it needs a
///      quantity around 1e41 whole tokens, which no ERC-20 supply reaches, and buying a named error for it
///      would cost every real quote a comparison.
contract RmmDomainTest is Test {
    uint256 internal constant WAD = 1e18;
    uint128 internal constant MAX = type(uint128).max;

    /// @notice The largest strike and liquidity the wire can carry evaluate without overflowing.
    /// @dev Both branches: `s == 0` (the closed-form settlement path) and `s > 0` (the Gaussian path).
    function test_Domain_MaxUint128StrikeAndLiquidityDoNotOverflow() public pure {
        // Settlement branch, reserves at the origin of each axis.
        uint256 yAtZero = RmmSwap.stableOf(0, MAX, 0, MAX);
        assertEq(yAtZero, Math.ceilDiv(uint256(MAX) * MAX, WAD), "settlement branch must be K*(L-x)/WAD");

        // Gaussian branch at the same extremes. `x = L/2` is the middle of the domain, so `Phi^-1` is
        // evaluated at 0.5 rather than in a tail.
        uint256 y = RmmSwap.stableOf(uint256(MAX) / 2, MAX, 0.6e18, MAX);
        assertGt(y, 0, "the curve must evaluate at the largest representable strike and liquidity");
        assertLe(y, uint256(MAX) * MAX / WAD, "and stay inside L*K");

        // The inverse, at the largest stable reserve the same parameters admit.
        uint256 lk = uint256(MAX) * MAX / WAD;
        uint256 x = RmmSwap.riskyOf(lk / 2, MAX, 0.6e18, MAX);
        assertLe(x, MAX, "riskyOf must stay inside L");

        console2.log("L = K = 2^128-1;  L*K fits in", 256, "bits with room to spare");
        console2.log("  stableOf(L/2)           ", y);
        console2.log("  riskyOf(L*K/2)          ", x);
    }

    /// @notice Outside the domain the curve raises its own named error, not an arithmetic panic — for every
    ///         reserve the types can reach.
    function test_Domain_OutOfRangeReservesAreNamed() public {
        vm.expectRevert(RmmSwap.RmmOutOfDomain.selector);
        this.stableOf(uint256(MAX) + 1, MAX, 0.6e18, MAX);

        uint256 lk = uint256(MAX) * MAX / WAD;
        vm.expectRevert(RmmSwap.RmmOutOfDomain.selector);
        this.riskyOf(lk + 1, MAX, 0.6e18, MAX);
    }

    /// @notice Where the named error stops and a panic begins, stated as a number rather than left to be
    ///         discovered. `stableOf` scales `x` by WAD before it can compare it to `L`.
    /// @dev Asserted so the boundary cannot move unnoticed. It is far outside anything an ERC-20 can hold:
    ///      the measured ceiling is 115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457
///      normalised units, about 1.158e41 whole 18-decimal tokens.
    function test_Domain_TheReserveCeilingIsWhereScalingOverflows() public {
        uint256 ceiling = type(uint256).max / WAD;

        // One below the ceiling: the multiply survives, so the curve reaches its own domain check.
        vm.expectRevert(RmmSwap.RmmOutOfDomain.selector);
        this.stableOf(ceiling, MAX, 0.6e18, MAX);

        // One above: `x * WAD` overflows first, and 0.8.30's checked arithmetic panics. It does NOT wrap,
        // which is the only property that actually matters here.
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        this.stableOf(ceiling + 1, MAX, 0.6e18, MAX);

        console2.log("reserve ceiling, normalised units", ceiling);
        console2.log("  = whole 18-decimal tokens      ", ceiling / WAD);
    }

    // ------------------------------------------------------------------ external wrappers for expectRevert

    function stableOf(uint256 x, uint128 k, uint256 s, uint128 l) external pure returns (uint256) {
        return RmmSwap.stableOf(x, k, s, l);
    }

    function riskyOf(uint256 y, uint128 k, uint256 s, uint128 l) external pure returns (uint256) {
        return RmmSwap.riskyOf(y, k, s, l);
    }
}
