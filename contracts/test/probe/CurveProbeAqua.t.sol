// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { ProbeRouter } from "../../src/ProbeRouter.sol";
import { CurveProbeRouterPRB } from "../../src/CurveProbeRouterPRB.sol";
import { CurveProbeRouterSolady } from "../../src/CurveProbeRouterSolady.sol";
import { CurveProbePRB } from "../../src/instructions/CurveProbePRB.sol";
import { AquaSwapVMTestBase } from "../base/AquaSwapVMTestBase.sol";

/// @title CurveProbeAquaTest
/// @notice End-to-end through Aqua: weighted-product (Balancer 80/20) and RMM-01 covered-call curves as opcode 0xd1,
///         quote == swap, full token accounting, values checked against mpmath (50 digits).
///         WETH (18 dec) / DAI (18 dec) so numbers compare 1:1 with the Python reference (mywork/fpmath/ref2.py).
abstract contract CurveProbeAquaTest is AquaSwapVMTestBase {
    // weighted 80/20: 10 WETH (w=0.8) / 20,000 DAI (w=0.2) => spot 8,000 DAI/WETH
    uint256 constant WETH_LIQ = 10e18;
    uint256 constant DAI_LIQ = 20_000e18;
    uint256 constant W_WETH = 0.8e18;
    uint256 constant W_DAI = 0.2e18;

    // RMM-01: K = 2000 DAI, sigma = 0.8, tau = 0.25y => s = 0.4, L = 10; reserves at c == K
    uint256 constant K = 2000e18;
    uint256 constant S = 0.4e18;
    uint256 constant L = 10e18;
    uint256 constant RMM_X = 4207402905608969769; // L * (1 - Phi(d1)), d1 = s/2
    uint256 constant RMM_Y = 8414805811217939539151; // L * K * Phi(d2), d2 = -s/2

    // mpmath references
    uint256 constant REF_W_IN_1WETH_OUT = 6339730892698586162147;
    uint256 constant REF_W_OUT_1000DAI_IN = 129058949799601673;
    uint256 constant REF_W_IN_1000DAI_OUT = 121234525769258958;
    uint256 constant REF_W_OUT_HALFWETH_IN = 4554753263096507853685;
    uint256 constant REF_RMM_RISKYIN_EXACTIN_OUT = 198982243947718798931; // dx = 0.1 WETH
    uint256 constant REF_RMM_RISKYIN_EXACTOUT_IN = 100514110704172996; // dy = 200 DAI
    uint256 constant REF_RMM_STABLEIN_EXACTIN_OUT = 99491121973859399; // dy = 200 DAI
    uint256 constant REF_RMM_STABLEIN_EXACTOUT_IN = 201028221408345990160; // dx = 0.1 WETH

    uint256 constant REL_1E9 = 1e9; // 1e-9 (pow/exp/ln precision dominated)
    uint256 constant REL_1E5 = 1e13; // 1e-5 (A&S 7.1.26 Phi error 7e-8 / phi(z), times L*K)

    ISwapVM.Order internal wOrder;
    bytes32 internal wHash;
    ISwapVM.Order internal rOrder;
    bytes32 internal rHash;
    ISwapVM.Order internal eOrder; // equal weights 50/50, must match XYC
    bool internal wethIsA;

    function _deployRouter() internal virtual returns (address);

    function setUp() public virtual override {
        super.setUp();
        router = ProbeRouter(payable(_deployRouter()));
        vm.label(address(router), "CurveProbeRouter");
        wethIsA = weth < address(dai);

        fund(weth, maker, WETH_LIQ * 2 + RMM_X);
        fund(address(dai), maker, DAI_LIQ * 2 + RMM_Y);

        (uint256 wA, uint256 wB) = wethIsA ? (W_WETH, W_DAI) : (W_DAI, W_WETH);
        wOrder = buildAquaOrder(
            maker, weth, address(dai), bytes.concat(CurveProbePRB.build(0, wA, wB, 0), Salt.build(uint64(11)))
        );
        wHash = _ship(wOrder, WETH_LIQ, DAI_LIQ);

        rOrder = buildAquaOrder(
            maker, weth, address(dai), bytes.concat(CurveProbePRB.build(wethIsA ? 1 : 2, K, S, L), Salt.build(uint64(12)))
        );
        rHash = _ship(rOrder, RMM_X, RMM_Y);

        eOrder = buildAquaOrder(
            maker, weth, address(dai), bytes.concat(CurveProbePRB.build(0, 0.5e18, 0.5e18, 0), Salt.build(uint64(13)))
        );
        _ship(eOrder, WETH_LIQ, DAI_LIQ);

        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(dai), type(uint256).max);
    }

    function _ship(ISwapVM.Order memory o, uint256 wethAmt, uint256 daiAmt) internal returns (bytes32) {
        return wethIsA ? shipOrder(maker, o, wethAmt, daiAmt) : shipOrder(maker, o, daiAmt, wethAmt);
    }

    /// @dev quote, fund, swap; asserts quote == swap and full wallet/Aqua accounting.
    function _roundTrip(ISwapVM.Order memory o, address tokenIn, bool isExactIn, uint256 amount)
        internal
        returns (uint256 qIn, uint256 qOut)
    {
        bytes memory td = takerDataFor(o, tokenIn, isExactIn);
        (qIn, qOut,) = quote(o, amount, td);
        fund(tokenIn, taker, qIn);
        Snapshot memory before = snapshot(o, taker);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, o, amount, td);
        assertEq(sIn, qIn, "swap amountIn == quote amountIn");
        assertEq(sOut, qOut, "swap amountOut == quote amountOut");
        assertSwapDelta(before, snapshot(o, taker), isAToB(o, tokenIn), sIn, sOut);
    }

    // ------------------------------------------------------------------ weighted 80/20

    function test_Weighted_ExactIn_WETHtoDAI() public {
        (uint256 qIn, uint256 qOut) = _roundTrip(wOrder, weth, true, 1e18);
        assertEq(qIn, 1e18);
        assertApproxEqRel(qOut, REF_W_IN_1WETH_OUT, REL_1E9, "1 WETH -> ~6339.73 DAI");
        // NOTE: neither PRBMath nor solady guarantees the rounding DIRECTION of pow: PRB lands 362,147 wei below the
        // exact value, solady 117,853 wei above (5.7e-17 / 1.9e-17 relative). A production weighted curve needs an
        // explicit error margin (Balancer's MAX_POW_RELATIVE_ERROR-style powUp/powDown), not just floor/ceil.
        assertApproxEqAbs(qOut, REF_W_IN_1WETH_OUT, 1e6, "within 1e6 wei (1e-12 DAI) of exact");
        console2.log("weighted exactIn 1 WETH -> DAI out", qOut, "ref", REF_W_IN_1WETH_OUT);
    }

    function test_Weighted_ExactOut_WETHtoDAI() public {
        (uint256 qIn, uint256 qOut) = _roundTrip(wOrder, weth, false, 1_000e18);
        assertEq(qOut, 1_000e18);
        assertApproxEqRel(qIn, REF_W_OUT_1000DAI_IN, REL_1E9, "1000 DAI out costs ~0.129 WETH");
        console2.log("weighted exactOut 1000 DAI <- WETH in", qIn, "ref", REF_W_OUT_1000DAI_IN);
    }

    function test_Weighted_ExactIn_DAItoWETH() public {
        (uint256 qIn, uint256 qOut) = _roundTrip(wOrder, address(dai), true, 1_000e18);
        assertEq(qIn, 1_000e18);
        assertApproxEqRel(qOut, REF_W_IN_1000DAI_OUT, REL_1E9, "1000 DAI -> ~0.1212 WETH");
        console2.log("weighted exactIn 1000 DAI -> WETH out", qOut, "ref", REF_W_IN_1000DAI_OUT);
    }

    function test_Weighted_ExactOut_DAItoWETH() public {
        (uint256 qIn, uint256 qOut) = _roundTrip(wOrder, address(dai), false, 0.5e18);
        assertEq(qOut, 0.5e18);
        assertApproxEqRel(qIn, REF_W_OUT_HALFWETH_IN, REL_1E9, "0.5 WETH out costs ~4554.75 DAI");
        console2.log("weighted exactOut 0.5 WETH <- DAI in", qIn, "ref", REF_W_OUT_HALFWETH_IN);
    }

    function test_Weighted_EqualWeights_MatchesXYC() public {
        (, uint256 qOut) = _roundTrip(eOrder, weth, true, 1e18);
        uint256 xyc = xycOut(WETH_LIQ, DAI_LIQ, 1e18); // 1818.181818... DAI
        assertApproxEqAbs(qOut, xyc, 1e9, "50/50 weighted == constant product (within 1e-9 DAI)");
        console2.log("weighted 50/50 exactIn 1 WETH -> DAI", qOut, "xyc", xyc);
    }

    function testFuzz_Weighted_QuoteEqualsSwap(uint256 amountIn, bool wethIn) public {
        amountIn = bound(amountIn, 1e12, wethIn ? 5e18 : 10_000e18);
        _roundTrip(wOrder, wethIn ? weth : address(dai), true, amountIn);
    }

    function testFuzz_Weighted_ExactOut_QuoteEqualsSwap(uint256 amountOut, bool wethIn) public {
        amountOut = bound(amountOut, 1e12, wethIn ? 10_000e18 : 5e18);
        _roundTrip(wOrder, wethIn ? weth : address(dai), false, amountOut);
    }

    // ------------------------------------------------------------------ RMM-01 covered call

    function test_RMM_RiskyIn_ExactIn() public {
        (uint256 qIn, uint256 qOut) = _roundTrip(rOrder, weth, true, 0.1e18);
        assertEq(qIn, 0.1e18);
        assertApproxEqRel(qOut, REF_RMM_RISKYIN_EXACTIN_OUT, REL_1E5, "0.1 WETH -> ~198.98 DAI");
        console2.log("rmm riskyIn exactIn 0.1 WETH -> DAI out", qOut, "ref", REF_RMM_RISKYIN_EXACTIN_OUT);
    }

    function test_RMM_RiskyIn_ExactOut() public {
        (uint256 qIn, uint256 qOut) = _roundTrip(rOrder, weth, false, 200e18);
        assertEq(qOut, 200e18);
        assertApproxEqRel(qIn, REF_RMM_RISKYIN_EXACTOUT_IN, REL_1E5, "200 DAI out costs ~0.1005 WETH");
        console2.log("rmm riskyIn exactOut 200 DAI <- WETH in", qIn, "ref", REF_RMM_RISKYIN_EXACTOUT_IN);
    }

    function test_RMM_StableIn_ExactIn() public {
        (uint256 qIn, uint256 qOut) = _roundTrip(rOrder, address(dai), true, 200e18);
        assertEq(qIn, 200e18);
        assertApproxEqRel(qOut, REF_RMM_STABLEIN_EXACTIN_OUT, REL_1E5, "200 DAI -> ~0.0995 WETH");
        console2.log("rmm stableIn exactIn 200 DAI -> WETH out", qOut, "ref", REF_RMM_STABLEIN_EXACTIN_OUT);
    }

    function test_RMM_StableIn_ExactOut() public {
        (uint256 qIn, uint256 qOut) = _roundTrip(rOrder, address(dai), false, 0.1e18);
        assertEq(qOut, 0.1e18);
        assertApproxEqRel(qIn, REF_RMM_STABLEIN_EXACTOUT_IN, REL_1E5, "0.1 WETH out costs ~201.03 DAI");
        console2.log("rmm stableIn exactOut 0.1 WETH <- DAI in", qIn, "ref", REF_RMM_STABLEIN_EXACTOUT_IN);
    }

    function test_RMM_SpotPriceIsK() public view {
        // Marginal price at the initial reserves (c == K) must be ~K = 2000 DAI/WETH in both directions.
        // Measured as a finite difference of two quotes: a single quote carries a constant offset of
        // L*K*(Phi_true - Phi_AS) ~ 1e15 wei (the initial reserves were computed with the TRUE Phi, the curve runs the
        // A&S approximation), which is 0.5% of a 0.2 DAI trade but cancels in the difference.
        bytes memory td = takerDataFor(rOrder, weth, true);
        (, uint256 out1,) = quote(rOrder, 1e15, td);
        (, uint256 out2,) = quote(rOrder, 2e15, td);
        assertApproxEqRel((out2 - out1), 1e15 * 2000, 1e15, "risky-in marginal price ~K (0.1%)");
        td = takerDataFor(rOrder, address(dai), true);
        (, out1,) = quote(rOrder, 2e18, td);
        (, out2,) = quote(rOrder, 4e18, td);
        assertApproxEqRel((out2 - out1) * 2000, 2e18, 1e15, "stable-in marginal price ~K (0.1%)");
    }

    function test_RMM_DustTrade_RevertsWhenReservesAreOffTheApproxCurve() public {
        // Shipped reserves come from the TRUE Phi; the opcode evaluates A&S Phi (|err| <= 7e-8). For a stable-in trade
        // smaller than ~L * 7e-8 * K (~1.4e-3 DAI here) the recomputed risky reserve exceeds the actual one => revert.
        // Lesson: initial reserves (or an invariant offset k) must be computed with the SAME on-chain Phi.
        bytes memory td = takerDataFor(rOrder, address(dai), true);
        vm.expectRevert(CurveProbePRB.CurveProbeInsufficientLiquidity.selector);
        quote(rOrder, 1e12, td);
    }

    function test_RMM_Reverts_BeyondL() public {
        // x + dx > L => R1 > 1 => Phi^-1 undefined => CurveProbeInsufficientLiquidity
        bytes memory td = takerDataFor(rOrder, weth, true);
        vm.expectRevert(CurveProbePRB.CurveProbeInsufficientLiquidity.selector);
        quote(rOrder, L - RMM_X + 1, td);
    }

    function testFuzz_RMM_QuoteEqualsSwap(uint256 amountIn, bool wethIn) public {
        // Lower bounds stay above the off-curve dust threshold (see test_RMM_DustTrade_*).
        amountIn = wethIn ? bound(amountIn, 1e14, 4e18) : bound(amountIn, 1e16, 5_000e18);
        _roundTrip(rOrder, wethIn ? weth : address(dai), true, amountIn);
    }

    function testFuzz_RMM_ExactOut_QuoteEqualsSwap(uint256 amountOut, bool wethIn) public {
        amountOut = wethIn ? bound(amountOut, 1e16, 5_000e18) : bound(amountOut, 1e14, 3e18);
        _roundTrip(rOrder, wethIn ? weth : address(dai), false, amountOut);
    }
}

contract CurveProbeAquaPRBTest is CurveProbeAquaTest {
    function _deployRouter() internal override returns (address) {
        return address(new CurveProbeRouterPRB(address(aqua), weth, address(this)));
    }
}

contract CurveProbeAquaSoladyTest is CurveProbeAquaTest {
    function _deployRouter() internal override returns (address) {
        return address(new CurveProbeRouterSolady(address(aqua), weth, address(this)));
    }
}
