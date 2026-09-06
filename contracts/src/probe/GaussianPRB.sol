// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WadMathPRB } from "./WadMathPRB.sol";

/// @notice Standard-normal CDF Phi(z) and its inverse, 1e18 fixed point, built on WadMathPRB.
/// @dev Phi(z) = (1 + erf(z / sqrt 2)) / 2 with erf from Abramowitz & Stegun 7.1.26 (|err| <= 1.5e-7 on erf;
///      measured max |Phi~ - Phi| = 6.95e-8 on [-8, 8] with mpmath). Phi^-1 is a 40-iteration bisection of Phi~ on
///      [-8, 8] (resolution 16 / 2^40 = 1.46e-11), i.e. 40 Phi evaluations = 40 exp() calls.
library GaussianPRB {
    int256 internal constant WAD = 1e18;
    int256 internal constant SQRT2 = 1_414213562373095048;
    int256 internal constant P = 327591100000000000; // 0.3275911
    int256 internal constant A1 = 254829592000000000; // 0.254829592
    int256 internal constant A2 = -284496736000000000; // -0.284496736
    int256 internal constant A3 = 1_421413741000000000; // 1.421413741
    int256 internal constant A4 = -1_453152027000000000; // -1.453152027
    int256 internal constant A5 = 1_061405429000000000; // 1.061405429

    /// @dev erf(x), odd extension of A&S 7.1.26; saturates to +-1e18 for |x| > 6 (erf(6) = 1 - 2e-17).
    function erf(int256 x) internal pure returns (int256) {
        bool neg = x < 0;
        uint256 ax = uint256(neg ? -x : x);
        if (ax > 6e18) return neg ? -WAD : WAD;
        int256 t = (WAD * WAD) / (WAD + (P * int256(ax)) / WAD); // t = 1 / (1 + p x)
        int256 poly = A5;
        poly = (poly * t) / WAD + A4;
        poly = (poly * t) / WAD + A3;
        poly = (poly * t) / WAD + A2;
        poly = (poly * t) / WAD + A1;
        poly = (poly * t) / WAD; // (a1 t + a2 t^2 + ... + a5 t^5)
        int256 e = int256(WadMathPRB.expNeg((ax * ax) / uint256(WAD))); // e^{-x^2}
        int256 y = WAD - (poly * e) / WAD;
        return neg ? -y : y;
    }

    /// @dev Phi(z) in [0, 1e18].
    function cdf(int256 z) internal pure returns (uint256) {
        int256 r = (WAD + erf((z * WAD) / SQRT2)) / 2;
        if (r <= 0) return 0;
        if (r >= WAD) return uint256(WAD);
        return uint256(r);
    }

    /// @dev Phi^-1(p), p in 1e18; clamps p outside (0, 1) to +-8. 40 bisection steps.
    function icdf(uint256 p) internal pure returns (int256) {
        if (p == 0) return -8e18;
        if (p >= uint256(WAD)) return 8e18;
        int256 lo = -8e18;
        int256 hi = 8e18;
        for (uint256 i = 0; i < 40; ++i) {
            int256 mid = (lo + hi) / 2;
            if (cdf(mid) < p) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    }
}
