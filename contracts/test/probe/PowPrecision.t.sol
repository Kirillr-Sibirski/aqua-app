// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, console2 } from "forge-std/Test.sol";
import { UD60x18, ud } from "@prb/math/src/UD60x18.sol";
import { FixedPointMathLib as F } from "solady/src/utils/FixedPointMathLib.sol";

/// @notice Attribution probe: where does the ~1e-8 relative error of pow(x, 4) come from?
contract PowPrecisionTest is Test {
    function test_LogPowInternals() public pure {
        uint256 x = 909090909090909090; // 10/11 floored
        uint256 inv = 1e36 / x; // PRB pow inverts x < 1
        console2.log("x", x, "inv", inv);
        console2.log("prb    log2(inv)", ud(inv).log2().unwrap());
        console2.log("prb    ln(inv)  ", ud(inv).ln().unwrap());
        console2.log("prb    exp2(4*log2(inv))", ud(inv).log2().mul(ud(4e18)).exp2().unwrap());
        console2.log("prb    pow(x,4)   ", ud(x).pow(ud(4e18)).unwrap());
        console2.log("prb    powu(x,4)  ", ud(x).powu(4).unwrap());
        console2.log("solady lnWad(x)  ", uint256(-F.lnWad(int256(x))));
        console2.log("solady powWad(x,4)", uint256(F.powWad(int256(x), 4e18)));
        uint256 y = 1052631578947368422; // 20000/19000 ceiled (exactOut DAI->WETH base)
        console2.log("prb    pow(y,4)   ", ud(y).pow(ud(4e18)).unwrap());
        console2.log("prb    powu(y,4)  ", ud(y).powu(4).unwrap());
        console2.log("solady powWad(y,4)", uint256(F.powWad(int256(y), 4e18)));
        console2.log("prb    log2(1.1e18)", ud(1.1e18).log2().unwrap());
        console2.log("prb    log2(1.5e18)", ud(1.5e18).log2().unwrap());
        console2.log("prb    exp2(0.55e18)", ud(0.55e18).exp2().unwrap());
    }
}
