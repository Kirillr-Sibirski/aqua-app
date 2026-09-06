// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { FixedPointMathLib as F } from "solady/src/utils/FixedPointMathLib.sol";

/// @notice Thin 1e18 fixed-point adapter over solady 0.1.26 FixedPointMathLib (MIT). All values are 1e18-scaled.
library WadMathSolady {
    uint256 internal constant WAD = 1e18;

    /// @dev e^x. Reverts ExpOverflow() for x >= 135.305999368893231589e18.
    function exp(uint256 x) internal pure returns (uint256) {
        return uint256(F.expWad(int256(x)));
    }

    /// @dev e^-u; returns 0 for u >= 41.4465e18 (result < 0.5 wei).
    function expNeg(uint256 u) internal pure returns (uint256) {
        return uint256(F.expWad(-int256(u)));
    }

    /// @dev Signed ln(x); reverts LnWadUndefined() for x == 0. Native signed output (no inversion trick needed).
    function ln(uint256 x) internal pure returns (int256) {
        return F.lnWad(int256(x));
    }

    /// @dev x^y = exp(y * ln(x)); x must be > 0 (lnWad reverts on 0). Approximation, per solady's own note.
    function pow(uint256 x, uint256 y) internal pure returns (uint256) {
        return uint256(F.powWad(int256(x), int256(y)));
    }

    /// @dev sqrt(x) in 1e18, rounded down.
    function sqrt(uint256 x) internal pure returns (uint256) {
        return F.sqrtWad(x);
    }
}
