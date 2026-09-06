// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WadMathPRB } from "./WadMathPRB.sol";
import { WadMath } from "../math/WadMath.sol";
import { GaussianPRB } from "./GaussianPRB.sol";
import { Gaussian } from "../math/Gaussian.sol";

/// @notice Gas bench: one external function per primitive so `forge test --gas-report` lists each cost separately.
///         (Reported gas includes ~2.6k of CALL + ABI overhead; see the gasleft() deltas in MathPrimitives.t.sol for the bare cost.)
contract MathBench {
    function prbExp(uint256 x) external pure returns (uint256) { return WadMathPRB.exp(x); }
    function prbExpNeg(uint256 x) external pure returns (uint256) { return WadMathPRB.expNeg(x); }
    function prbLn(uint256 x) external pure returns (int256) { return WadMathPRB.ln(x); }
    function prbPow(uint256 x, uint256 y) external pure returns (uint256) { return WadMathPRB.pow(x, y); }
    function prbSqrt(uint256 x) external pure returns (uint256) { return WadMathPRB.sqrt(x); }
    function prbCdf(int256 z) external pure returns (uint256) { return GaussianPRB.cdf(z); }
    function prbIcdf(uint256 p) external pure returns (int256) { return GaussianPRB.icdf(p); }

    function soladyExp(uint256 x) external pure returns (uint256) { return WadMath.exp(x); }
    function soladyExpNeg(uint256 x) external pure returns (uint256) { return WadMath.expNeg(x); }
    function soladyLn(uint256 x) external pure returns (int256) { return WadMath.ln(x); }
    function soladyPow(uint256 x, uint256 y) external pure returns (uint256) { return WadMath.pow(x, y); }
    function soladySqrt(uint256 x) external pure returns (uint256) { return WadMath.sqrt(x); }
    function soladyCdf(int256 z) external pure returns (uint256) { return Gaussian.cdf(z); }
    function soladyIcdf(uint256 p) external pure returns (int256) { return Gaussian.icdf(p); }
}
