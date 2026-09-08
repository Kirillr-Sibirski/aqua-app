// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, console2 } from "forge-std/Test.sol";

import { WadMathPRB } from "../../src/spikes/WadMathPRB.sol";
import { WadMath } from "../../src/math/WadMath.sol";
import { GaussianPRB } from "../../src/spikes/GaussianPRB.sol";
import { Gaussian } from "../../src/math/Gaussian.sol";
import { MathBench } from "../../src/spikes/MathBench.sol";

/// @title MathPrimitivesTest
/// @notice Accuracy (vs mpmath, 50 digits) and gas (gasleft deltas on INTERNAL calls) of PRBMath v4.2.0 UD60x18 and
///         solady 0.1.26 FixedPointMathLib primitives, plus the A&S 7.1.26 Phi and 40-step bisection Phi^-1 built on them.
contract MathPrimitivesTest is Test {
    MathBench internal bench;

    // Inputs live in storage so via_ir cannot constant-fold the pure math away when measuring gas.
    uint256[] internal u;
    int256[] internal z;

    // mpmath references (1e18 fixed point, floor)
    uint256 constant EXP_1 = 2718281828459045235;
    uint256 constant EXP_2_5 = 12182493960703473438;
    uint256 constant EXP_10 = 22026465794806716516957;
    uint256 constant EXPNEG_2_5 = 82084998623898795;
    uint256 constant EXPNEG_10 = 45399929762484;
    int256 constant LN_E = 999999999999999999;
    int256 constant LN_10 = 2302585092994045684;
    int256 constant LN_HALF = -693147180559945310;
    int256 constant LN_1E_6 = -13815510557964274105;
    uint256 constant POW_HALF_0_3 = 812252396356235522;
    uint256 constant POW_1_25_3_5 = 2183660134277138375;
    uint256 constant POW_2_HALF = 1414213562373095048;
    uint256 constant POW_0_9_4 = 656100000000000000;
    uint256 constant SQRT_2 = 1414213562373095048;
    uint256 constant PHI_0 = 500000000000000000;
    uint256 constant PHI_0_5 = 691462461274013103;
    uint256 constant PHI_1_96 = 975002104851779565;
    uint256 constant PHI_M1 = 158655253931457051;
    uint256 constant PHI_M3 = 1349898031630094;
    uint256 constant PHI_2_5 = 993790334674223864;
    uint256 constant PHI_M5 = 286651571879;
    int256 constant PHIINV_0_975 = 1959963984540054235;
    int256 constant PHIINV_0_1 = -1281551565544600467;
    int256 constant PHIINV_0_9 = 1281551565544600466;

    uint256 constant REL_1E12 = 1e6; // assertApproxEqRel: 1e18 == 100%, so 1e6 == 1e-12
    uint256 constant PHI_ABS = 1e11; // 1e-7 (A&S 7.1.26 bound is 1.5e-7 on erf, measured 6.95e-8 on Phi)
    uint256 constant PHIINV_ABS = 3e12; // 3e-6: A&S error / phi(z) at z~2

    function setUp() public {
        bench = new MathBench();
        u.push(1e18); // 0
        u.push(2.5e18); // 1
        u.push(10e18); // 2
        u.push(0.5e18); // 3
        u.push(0.3e18); // 4
        u.push(1.25e18); // 5
        u.push(3.5e18); // 6
        u.push(2e18); // 7
        u.push(0.975e18); // 8
        u.push(0.1e18); // 9
        u.push(1e12); // 10
        z.push(0);
        z.push(1.96e18);
        z.push(-3e18);
    }

    // ------------------------------------------------------------------ accuracy: PRBMath

    function test_PRB_Exp() public pure {
        assertApproxEqRel(WadMathPRB.exp(1e18), EXP_1, REL_1E12);
        assertApproxEqRel(WadMathPRB.exp(2.5e18), EXP_2_5, REL_1E12);
        assertApproxEqRel(WadMathPRB.exp(10e18), EXP_10, REL_1E12);
        assertApproxEqRel(WadMathPRB.expNeg(2.5e18), EXPNEG_2_5, REL_1E12);
        assertApproxEqRel(WadMathPRB.expNeg(10e18), EXPNEG_10, REL_1E12);
        assertEq(WadMathPRB.expNeg(42e18), 0);
    }

    function test_PRB_Ln() public pure {
        assertApproxEqAbs(WadMathPRB.ln(EXP_1), LN_E, 1e6);
        assertApproxEqRel(WadMathPRB.ln(10e18), LN_10, REL_1E12);
        assertApproxEqRel(WadMathPRB.ln(0.5e18), LN_HALF, REL_1E12);
        assertApproxEqRel(WadMathPRB.ln(1e12), LN_1E_6, REL_1E12);
    }

    function test_PRB_Pow() public pure {
        assertApproxEqRel(WadMathPRB.pow(0.5e18, 0.3e18), POW_HALF_0_3, REL_1E12);
        assertApproxEqRel(WadMathPRB.pow(1.25e18, 3.5e18), POW_1_25_3_5, REL_1E12);
        assertApproxEqRel(WadMathPRB.pow(2e18, 0.5e18), POW_2_HALF, REL_1E12);
        assertApproxEqRel(WadMathPRB.pow(0.9e18, 4e18), POW_0_9_4, REL_1E12);
        assertEq(WadMathPRB.pow(0, 0), 1e18);
        assertEq(WadMathPRB.pow(1e18, 123e18), 1e18);
    }

    function test_PRB_Sqrt() public pure {
        assertApproxEqAbs(WadMathPRB.sqrt(2e18), SQRT_2, 1);
        assertApproxEqAbs(WadMathPRB.sqrt(1e12), 1e15, 1);
        assertEq(WadMathPRB.sqrt(4e18), 2e18);
    }

    function test_PRB_Phi() public pure {
        assertApproxEqAbs(GaussianPRB.cdf(0), PHI_0, PHI_ABS);
        assertApproxEqAbs(GaussianPRB.cdf(0.5e18), PHI_0_5, PHI_ABS);
        assertApproxEqAbs(GaussianPRB.cdf(1.96e18), PHI_1_96, PHI_ABS);
        assertApproxEqAbs(GaussianPRB.cdf(-1e18), PHI_M1, PHI_ABS);
        assertApproxEqAbs(GaussianPRB.cdf(-3e18), PHI_M3, PHI_ABS);
        assertApproxEqAbs(GaussianPRB.cdf(2.5e18), PHI_2_5, PHI_ABS);
        assertApproxEqAbs(GaussianPRB.cdf(-5e18), PHI_M5, PHI_ABS);
        assertEq(GaussianPRB.cdf(-9e18), 0);
        assertEq(GaussianPRB.cdf(9e18), 1e18);
    }

    function test_PRB_PhiInv() public pure {
        assertApproxEqAbs(GaussianPRB.icdf(0.5e18), 0, 2e9);
        assertApproxEqAbs(GaussianPRB.icdf(0.975e18), PHIINV_0_975, PHIINV_ABS);
        assertApproxEqAbs(GaussianPRB.icdf(0.1e18), PHIINV_0_1, PHIINV_ABS);
        assertApproxEqAbs(GaussianPRB.icdf(0.9e18), PHIINV_0_9, PHIINV_ABS);
    }

    // ------------------------------------------------------------------ accuracy: solady

    function test_Solady_Exp() public pure {
        assertApproxEqRel(WadMath.exp(1e18), EXP_1, REL_1E12);
        assertApproxEqRel(WadMath.exp(2.5e18), EXP_2_5, REL_1E12);
        assertApproxEqRel(WadMath.exp(10e18), EXP_10, REL_1E12);
        assertApproxEqRel(WadMath.expNeg(2.5e18), EXPNEG_2_5, REL_1E12);
        assertApproxEqRel(WadMath.expNeg(10e18), EXPNEG_10, REL_1E12);
        assertEq(WadMath.expNeg(42e18), 0);
    }

    function test_Solady_Ln() public pure {
        assertApproxEqAbs(WadMath.ln(EXP_1), LN_E, 1e6);
        assertApproxEqRel(WadMath.ln(10e18), LN_10, REL_1E12);
        assertApproxEqRel(WadMath.ln(0.5e18), LN_HALF, REL_1E12);
        assertApproxEqRel(WadMath.ln(1e12), LN_1E_6, REL_1E12);
    }

    function test_Solady_Pow() public pure {
        assertApproxEqRel(WadMath.pow(0.5e18, 0.3e18), POW_HALF_0_3, REL_1E12);
        assertApproxEqRel(WadMath.pow(1.25e18, 3.5e18), POW_1_25_3_5, REL_1E12);
        assertApproxEqRel(WadMath.pow(2e18, 0.5e18), POW_2_HALF, REL_1E12);
        assertApproxEqRel(WadMath.pow(0.9e18, 4e18), POW_0_9_4, REL_1E12);
    }

    function test_Solady_Sqrt() public pure {
        assertApproxEqAbs(WadMath.sqrt(2e18), SQRT_2, 1);
        assertApproxEqAbs(WadMath.sqrt(1e12), 1e15, 1);
        assertEq(WadMath.sqrt(4e18), 2e18);
    }

    function test_Solady_Phi() public pure {
        assertApproxEqAbs(Gaussian.cdf(0), PHI_0, PHI_ABS);
        assertApproxEqAbs(Gaussian.cdf(0.5e18), PHI_0_5, PHI_ABS);
        assertApproxEqAbs(Gaussian.cdf(1.96e18), PHI_1_96, PHI_ABS);
        assertApproxEqAbs(Gaussian.cdf(-1e18), PHI_M1, PHI_ABS);
        assertApproxEqAbs(Gaussian.cdf(-3e18), PHI_M3, PHI_ABS);
        assertApproxEqAbs(Gaussian.cdf(2.5e18), PHI_2_5, PHI_ABS);
        assertApproxEqAbs(Gaussian.cdf(-5e18), PHI_M5, PHI_ABS);
    }

    function test_Solady_PhiInv() public pure {
        assertApproxEqAbs(Gaussian.icdf(0.5e18), 0, 2e9);
        assertApproxEqAbs(Gaussian.icdf(0.975e18), PHIINV_0_975, PHIINV_ABS);
        assertApproxEqAbs(Gaussian.icdf(0.1e18), PHIINV_0_1, PHIINV_ABS);
        assertApproxEqAbs(Gaussian.icdf(0.9e18), PHIINV_0_9, PHIINV_ABS);
    }

    // ------------------------------------------------------------------ exact deltas (logged, for the KB)

    function test_LogDeltas() public pure {
        console2.log("prb    exp(1)  delta wei", _d(WadMathPRB.exp(1e18), EXP_1));
        console2.log("solady exp(1)  delta wei", _d(WadMath.exp(1e18), EXP_1));
        console2.log("prb    exp(10) delta wei", _d(WadMathPRB.exp(10e18), EXP_10));
        console2.log("solady exp(10) delta wei", _d(WadMath.exp(10e18), EXP_10));
        console2.log("prb    ln(10)  delta wei", _d(uint256(WadMathPRB.ln(10e18)), uint256(LN_10)));
        console2.log("solady ln(10)  delta wei", _d(uint256(WadMath.ln(10e18)), uint256(LN_10)));
        console2.log("prb    pow(1.25,3.5) delta wei", _d(WadMathPRB.pow(1.25e18, 3.5e18), POW_1_25_3_5));
        console2.log("solady pow(1.25,3.5) delta wei", _d(WadMath.pow(1.25e18, 3.5e18), POW_1_25_3_5));
        console2.log("prb    pow(0.5,0.3)  delta wei", _d(WadMathPRB.pow(0.5e18, 0.3e18), POW_HALF_0_3));
        console2.log("solady pow(0.5,0.3)  delta wei", _d(WadMath.pow(0.5e18, 0.3e18), POW_HALF_0_3));
        console2.log("prb    Phi(1.96) delta wei", _d(GaussianPRB.cdf(1.96e18), PHI_1_96));
        console2.log("solady Phi(1.96) delta wei", _d(Gaussian.cdf(1.96e18), PHI_1_96));
        console2.log("prb    PhiInv(0.975) delta wei", _d(uint256(GaussianPRB.icdf(0.975e18)), uint256(PHIINV_0_975)));
        console2.log("solady PhiInv(0.975) delta wei", _d(uint256(Gaussian.icdf(0.975e18)), uint256(PHIINV_0_975)));
    }

    function _d(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    // ------------------------------------------------------------------ gas: internal calls (bare cost, no CALL overhead)

    function test_Gas_Internal_PRB() public {
        uint256 g;
        uint256 r;
        g = gasleft(); r = WadMathPRB.exp(u[1]); g -= gasleft(); _log("gas prb.exp(2.5)", g, r);
        g = gasleft(); r = WadMathPRB.expNeg(u[1]); g -= gasleft(); _log("gas prb.expNeg(2.5)", g, r);
        g = gasleft(); r = uint256(WadMathPRB.ln(u[2])); g -= gasleft(); _log("gas prb.ln(10)", g, r);
        g = gasleft(); r = uint256(WadMathPRB.ln(u[3])); g -= gasleft(); _log("gas prb.ln(0.5) (inverted)", g, r);
        g = gasleft(); r = WadMathPRB.pow(u[5], u[6]); g -= gasleft(); _log("gas prb.pow(1.25,3.5)", g, r);
        g = gasleft(); r = WadMathPRB.pow(u[3], u[4]); g -= gasleft(); _log("gas prb.pow(0.5,0.3) (x<1)", g, r);
        g = gasleft(); r = WadMathPRB.sqrt(u[7]); g -= gasleft(); _log("gas prb.sqrt(2)", g, r);
        g = gasleft(); r = GaussianPRB.cdf(z[1]); g -= gasleft(); _log("gas prb.Phi(1.96)", g, r);
        g = gasleft(); r = GaussianPRB.cdf(z[2]); g -= gasleft(); _log("gas prb.Phi(-3)", g, r);
        g = gasleft(); r = uint256(GaussianPRB.icdf(u[8])); g -= gasleft(); _log("gas prb.PhiInv(0.975) 40 iters", g, r);
        g = gasleft(); r = uint256(GaussianPRB.icdf(u[9])); g -= gasleft(); _log("gas prb.PhiInv(0.1) 40 iters", g, r);
    }

    function test_Gas_Internal_Solady() public {
        uint256 g;
        uint256 r;
        g = gasleft(); r = WadMath.exp(u[1]); g -= gasleft(); _log("gas solady.exp(2.5)", g, r);
        g = gasleft(); r = WadMath.expNeg(u[1]); g -= gasleft(); _log("gas solady.expNeg(2.5)", g, r);
        g = gasleft(); r = uint256(WadMath.ln(u[2])); g -= gasleft(); _log("gas solady.ln(10)", g, r);
        g = gasleft(); r = uint256(WadMath.ln(u[3])); g -= gasleft(); _log("gas solady.ln(0.5)", g, r);
        g = gasleft(); r = WadMath.pow(u[5], u[6]); g -= gasleft(); _log("gas solady.pow(1.25,3.5)", g, r);
        g = gasleft(); r = WadMath.pow(u[3], u[4]); g -= gasleft(); _log("gas solady.pow(0.5,0.3)", g, r);
        g = gasleft(); r = WadMath.sqrt(u[7]); g -= gasleft(); _log("gas solady.sqrt(2)", g, r);
        g = gasleft(); r = Gaussian.cdf(z[1]); g -= gasleft(); _log("gas solady.Phi(1.96)", g, r);
        g = gasleft(); r = Gaussian.cdf(z[2]); g -= gasleft(); _log("gas solady.Phi(-3)", g, r);
        g = gasleft(); r = uint256(Gaussian.icdf(u[8])); g -= gasleft(); _log("gas solady.PhiInv(0.975) 40 iters", g, r);
        g = gasleft(); r = uint256(Gaussian.icdf(u[9])); g -= gasleft(); _log("gas solady.PhiInv(0.1) 40 iters", g, r);
    }

    function _log(string memory what, uint256 gas, uint256 result) private pure {
        console2.log(what, gas, "result", result);
    }

    // ------------------------------------------------------------------ gas: external calls (rows in --gas-report)

    function test_Gas_Bench_External() public view {
        bench.prbExp(u[1]);
        bench.prbExpNeg(u[1]);
        bench.prbLn(u[2]);
        bench.prbPow(u[5], u[6]);
        bench.prbPow(u[3], u[4]);
        bench.prbSqrt(u[7]);
        bench.prbCdf(z[1]);
        bench.prbIcdf(u[8]);
        bench.soladyExp(u[1]);
        bench.soladyExpNeg(u[1]);
        bench.soladyLn(u[2]);
        bench.soladyPow(u[5], u[6]);
        bench.soladyPow(u[3], u[4]);
        bench.soladySqrt(u[7]);
        bench.soladyCdf(z[1]);
        bench.soladyIcdf(u[8]);
    }
}
