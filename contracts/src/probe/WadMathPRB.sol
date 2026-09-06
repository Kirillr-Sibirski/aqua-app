// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { UD60x18, ud } from "@prb/math/src/UD60x18.sol";

/// @notice Thin 1e18 fixed-point adapter over PRBMath v4 UD60x18 (MIT). All inputs/outputs are 1e18-scaled.
library WadMathPRB {
    uint256 internal constant WAD = 1e18;
    /// @dev e^-u < 0.5 wei for u >= 41.4465..., so return 0 (mirrors solady's expWad cutoff).
    uint256 internal constant EXP_NEG_CUTOFF = 41_446531673892822313;

    /// @dev e^x. Reverts PRBMath_UD60x18_Exp_InputTooBig for x > 133.084258667509499440e18.
    function exp(uint256 x) internal pure returns (uint256) {
        return ud(x).exp().unwrap();
    }

    /// @dev e^-u via 1e36 / e^u (UD60x18 has no negative exponent).
    function expNeg(uint256 u) internal pure returns (uint256) {
        if (u >= EXP_NEG_CUTOFF) return 0;
        return 1e36 / ud(u).exp().unwrap();
    }

    /// @dev Signed ln(x) for any x > 0. UD60x18.ln reverts for x < 1e18 (Log_InputTooSmall), so the x < 1 branch
    ///      computes -ln(1/x). Reverts for x == 0.
    function ln(uint256 x) internal pure returns (int256) {
        if (x >= WAD) return int256(ud(x).ln().unwrap());
        return -int256(ud(1e36 / x).ln().unwrap());
    }

    /// @dev x^y, both 1e18. Handles 0 <= x < 1 (via inversion) and x >= 1. 0^0 == 1e18.
    function pow(uint256 x, uint256 y) internal pure returns (uint256) {
        return ud(x).pow(ud(y)).unwrap();
    }

    /// @dev sqrt(x) in 1e18 (rounded toward zero). Reverts Sqrt_Overflow for x > MAX/1e18.
    function sqrt(uint256 x) internal pure returns (uint256) {
        return ud(x).sqrt().unwrap();
    }
}
