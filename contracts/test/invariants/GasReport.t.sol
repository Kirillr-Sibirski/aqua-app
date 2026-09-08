// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";

import { StrikelineLeg } from "./StrikelineLeg.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title GasReportTest
/// @notice Gas for each custom instruction and for the whole shipped program, plus the EIP-170 margin, measured
///         rather than estimated.
///
/// @dev METHOD. Every number is a `gasleft()` delta around a real external call into the deployed router, on a
///      real Aqua-mode order, after a warm-up call on the same order. The warm-up matters: `Coverage` reads
///      `balanceOf` and `allowance`, and a cold SLOAD would otherwise be attributed to the instruction rather
///      than to the access list. Instruction costs are reported as DIFFERENCES between programs that are
///      identical except for one instruction, because a SwapVM instruction has no meaning outside a program.
///
///        A  `RmmSwap . Salt`                        the bare curve
///        B  `Coverage . RmmSwap . Salt`             B - A is what portfolio margin costs
///        C  `Deadline . Coverage . RmmSwap . Salt`  the shipped leg; C - B is what the expiry guard costs
///        X  `XYCSwap . Salt`                        an official instruction on the same router, as a reference
///
///      The transcendental cost is isolated separately: at `tau == 0` the curve degenerates to the closed form
///      `Y = K*(L - X)` and skips `Phi` and `Phi^-1` entirely, so the settlement fill prices the SAME instruction
///      with no Gaussian in it. That difference is the price of writing an option instead of a limit order.
contract GasReportTest is StrikelineLeg {
    ISwapVM.Order internal legA; // RmmSwap . Salt
    ISwapVM.Order internal legB; // Coverage . RmmSwap . Salt
    ISwapVM.Order internal legC; // Deadline . Coverage . RmmSwap . Salt
    ISwapVM.Order internal legX; // XYCSwap . Salt

    /// @dev A size clear of the band in both directions, so no measurement is dominated by a revert path.
    uint256 internal constant BUY = 1_940e6;

    function setUp() public override {
        super.setUp();
        // Each leg needs its own wallet room, so fund past the demo book: this contract measures gas, not margin.
        fund(weth, maker, 91.3e18);
        fund(address(usdc), maker, 214_600e6);

        (legA,,) = shipLeg(_bareProgram(401), K, L, X0);
        (legB,,) = shipLeg(_coveredProgram(402), K, L, X0);
        (legC,,) = shipDemoLeg(403);
        legX = _shipXyc(404);
    }

    // ------------------------------------------------------------------ the table

    function test_GasReport() public {
        // Pass 1 is discarded. Every account, token slot and Aqua slot any of the four programs touches is cold
        // exactly once, and whichever program ran first would otherwise be charged for all of it.
        _measureQuiet(legA);
        _measureQuiet(legB);
        _measureQuiet(legC);
        _measureQuiet(legX);

        console2.log("=== per-instruction gas, Strikeline on the official Aqua flow ===");
        console2.log("");
        console2.log("program                                    quote      swap");

        (uint256 qA, uint256 sA) = _measure(legA, "A  RmmSwap . Salt                       ");
        (uint256 qB, uint256 sB) = _measure(legB, "B  Coverage . RmmSwap . Salt            ");
        (uint256 qC, uint256 sC) = _measure(legC, "C  Deadline . Coverage . RmmSwap . Salt ");
        (uint256 qX, uint256 sX) = _measure(legX, "X  XYCSwap . Salt          (reference)  ");

        console2.log("");
        console2.log("instruction                                quote      swap");
        _diff("   RmmSwap        (A - X, over XYCSwap) ", qA, qX, sA, sX);
        _diff("   Coverage       (B - A)               ", qB, qA, sB, sA);
        _diff("   Deadline       (C - B)               ", qC, qB, sC, sB);

        console2.log("");
        console2.log("The swap column is the cost of a FILL. `forge test` separately reports 657,504-667,243");
        console2.log("for test/probe/CurveProbeAqua.t.sol's test_RMM_* cases, but that is the whole test body:");
        console2.log("a quote, a cheatcode `deal`, two full balance snapshots and then the swap.");

        // Sanity, so the table cannot silently invert.
        assertGt(qA, qX, "the RMM curve must cost more than a constant-product step");
        assertGt(qB, qA, "Coverage must cost something");
        assertGe(qC, qB, "Deadline must not be free");
        assertGt(sA, sX, "the RMM fill must cost more than a constant-product fill");
        assertGt(sB, sA, "Coverage must cost something on the fill path too");
        assertGe(sC, sB, "Deadline must not be free on the fill path either");
    }

    function _measureQuiet(ISwapVM.Order memory order) internal {
        bytes memory td = takerDataFor(order, address(usdc), true);
        _quoteGas(order, BUY, td);
        _swapGas(order, td);
    }

    /// @notice What the transcendental part costs: the same instruction, once with `Phi`/`Phi^-1` and once at
    ///         `tau == 0` where the curve is the closed-form constant-sum settlement order.
    function test_GasReport_TranscendentalShare() public {
        bytes memory buy = takerDataFor(legC, address(usdc), true);

        _quoteGas(legC, BUY, buy); // discarded: both measurements must see the same warmth
        uint256 live = _quoteGas(legC, BUY, buy);

        vm.warp(uint256(maturity) + 1);
        assertEq(sl.tauNow(maturity), 0, "must be measuring the settlement branch");
        _quoteGas(legC, 2_600e6, buy); // discarded
        uint256 settled = _quoteGas(legC, 2_600e6, buy);

        console2.log("quote with the Gaussian (tau > 0)  ", live);
        console2.log("quote at settlement     (tau == 0) ", settled);
        console2.log("cost of Phi + Phi^-1 per quote     ", live - settled);
        assertGt(live, settled, "the closed form must be cheaper than the Gaussian branch");
    }

    // ------------------------------------------------------------------ EIP-170

    /// @notice The router is under the EIP-170 limit with real margin, asserted rather than asserted-in-a-README.
    ///         No size override is used anywhere in `foundry.toml`.
    ///
    /// @dev THE NUMBER THAT COUNTS IS THE ARTIFACT'S, not the one this test contract deploys. A test that says
    ///      `new StrikelineRouter(...)` does not load `out/StrikelineRouter.sol/StrikelineRouter.json`: solc
    ///      inlines the router's creation code into the TEST contract, so it is generated inside the test file's
    ///      compilation unit, and under `via_ir` the Yul optimiser's inlining decisions there can differ from
    ///      the standalone build. The gap is not a constant: it was 14 bytes (23,619 artifact vs 23,633 in
    ///      test) before `Coverage` gained its wire-level haircut check, and it is 0 after. It also moves when
    ///      unrelated code is added to this file.
    ///
    ///      `forge build --sizes`, `forge script` and every real deployment all use the standalone artifact, so
    ///      that is the figure asserted. Both are printed, because the difference is otherwise invisible and a
    ///      README quoting whichever one happened to be larger is quoting a number that drifts on its own.
    function test_Size_RouterIsUnderEip170() public view {
        uint256 artifact = vm.getDeployedCode("StrikelineRouter.sol:StrikelineRouter").length;
        uint256 inTest = address(sl).code.length;
        uint256 limit = 24_576;

        console2.log("StrikelineRouter, compiled artifact (what deploys)", artifact);
        console2.log("  EIP-170 limit                                   ", limit);
        console2.log("  margin                                          ", limit - artifact);
        console2.log("same contract deployed from inside this test file ", inTest);

        assertLt(artifact, limit, "router exceeds EIP-170 and cannot be deployed to mainnet");
        assertLt(inTest, limit, "even the test-unit build must fit, or the harness stops matching production");
    }

    // ------------------------------------------------------------------ measurement

    /// @dev Reported numbers come from the SECOND pass over all four programs. The first pass is discarded, so
    ///      no program is charged for cold slots that the ones measured after it then find warm. Without that,
    ///      the table inverts by a few thousand gas and reads as if `Coverage` were free.
    function _measure(ISwapVM.Order memory order, string memory label) internal returns (uint256 q, uint256 s) {
        bytes memory td = takerDataFor(order, address(usdc), true);

        q = _quoteGas(order, BUY, td);
        s = _swapGas(order, td);

        console2.log(label, q, s);
    }

    function _swapGas(ISwapVM.Order memory order, bytes memory td) internal returns (uint256 used) {
        uint256 snap = vm.snapshotState();
        vm.prank(taker);
        uint256 before = gasleft();
        sl.swap(order, BUY, td);
        used = before - gasleft();
        vm.revertToState(snap);
    }

    function _quoteGas(
        ISwapVM.Order memory order,
        uint256 amount,
        bytes memory td
    )
        internal
        view
        returns (uint256 used)
    {
        uint256 before = gasleft();
        ISwapVM(address(sl)).quote(order, amount, td);
        used = before - gasleft();
    }

    function _diff(string memory label, uint256 q, uint256 qBase, uint256 s, uint256 sBase) internal pure {
        console2.log(label, q - qBase, s - sBase);
    }

    // ------------------------------------------------------------------ programs

    function _bareProgram(uint64 salt) internal view returns (bytes memory) {
        return bareProgram(K, L, salt);
    }

    function _coveredProgram(uint64 salt) internal view returns (bytes memory) {
        uint8 flags = weth < address(usdc) ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0;
        return bytes.concat(
            Coverage.build(0, 0),
            RmmSwap.build(
                RmmSwap.Args({
                    flags: flags,
                    sigmaWad: SIGMA,
                    maturity: maturity,
                    strikeWad: K,
                    liquidityWad: L,
                    rateRisky: RATE_RISKY,
                    rateStable: RATE_STABLE
                })
            ),
            Salt.build(salt)
        );
    }

    /// @dev The reference: an official instruction on the same router, shipped with the same reserves so the
    ///      comparison is like for like.
    function _shipXyc(uint64 salt) internal returns (ISwapVM.Order memory order) {
        order = buildAquaOrder(maker, weth, address(usdc), bytes.concat(XYCSwap.build(), Salt.build(salt)));
        uint256 y = sl.stableFor(K, SIGMA, maturity, L, X0);
        (address a,) = orderTokens(order);
        (uint256 amountA, uint256 amountB) = a == weth ? (X0, y / RATE_STABLE) : (y / RATE_STABLE, X0);
        shipOrder(maker, order, amountA, amountB);
    }
}
