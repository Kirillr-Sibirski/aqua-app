// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { CoreInvariants } from "@1inch/swap-vm/test/invariants/CoreInvariants.t.sol";

import { StrikelineLeg } from "./StrikelineLeg.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";

/// @title StrikelineCoreInvariantsTest
/// @notice SwapVM's OWN invariant suite, `node_modules/1inch/swap-vm/test/invariants/CoreInvariants.t.sol`, imported from the
///         installed package and run unmodified against a shipped Strikeline leg.
///
/// @dev Nothing here reimplements the framework. `CoreInvariants` is an abstract contract that ships inside the
///      installed swap-vm package; this file supplies `_executeSwap` and the `InvariantConfig` and hands it a real
///      Aqua-mode order whose program is `Deadline . Coverage . RmmSwap . Salt`.
///
///      TOLERANCES. Every deviation from `_getDefaultConfig()` is listed in `test_ToleranceTable` with the number
///      it comes from, and each one is asserted, not assumed:
///
///      | knob                     | framework default | ours          | why                                        |
///      |--------------------------|-------------------|---------------|--------------------------------------------|
///      | symmetryTolerance        | 2 wei             | derived       | `StrikelineLeg.symmetryToleranceFor`       |
///      | additivityTolerance      | 0                 | 0 (kept)      | the band is charged per fill, so one big   |
///      |                          |                   |               | fill is strictly better than two           |
///      | roundingToleranceBps     | 100 (1%)          | 0 (TIGHTENED) | dust never prices better than spot; it     |
///      |                          |                   |               | reverts inside the band instead            |
///      | monotonicityToleranceBps | 0                 | 0 (kept)      | above the band the curve is convex         |
///      | skipAdditivity           | false             | false         |                                            |
///      | skipMonotonicity         | false             | false         |                                            |
///      | skipSpotPrice            | false             | false         |                                            |
///      | skipSymmetry             | false             | false         |                                            |
///
///      Only ONE knob moves off its default, and it moves in the strict direction. Nothing is skipped.
///
///      `symmetryTolerance` is the single loosened value and it is not a knob: it is
///      `L_in * EPS_ROUNDTRIP / rate_in + 2`, where `EPS_ROUNDTRIP = 1.0805e-6` is fixed by the measured
///      `Phi` error 6.95e-8 and `Phi^-1` round-trip error 1.18e-6 (see `StrikelineLeg`). The framework's 2 wei
///      assumes a rational curve evaluated in exact integer arithmetic; RMM-01 is transcendental and the reserve
///      round trip crosses `Phi^-1` and `Phi` twice. `test_Symmetry_ObservedIsInsideTheDerivedBound` prints the
///      observed miss next to the bound so the headroom is visible rather than asserted.
contract StrikelineCoreInvariantsTest is StrikelineLeg, CoreInvariants {
    ISwapVM.Order internal leg;

    /// @dev Amounts are the sizes a desk actually trades on a 12-WETH leg, in each token's own units.
    uint256[] internal usdcIn; // exact-in, USDC -> WETH
    uint256[] internal wethOut; // exact-out, USDC -> WETH
    uint256[] internal wethIn; // exact-in, WETH -> USDC
    uint256[] internal usdcOut; // exact-out, WETH -> USDC

    function setUp() public override {
        super.setUp();
        (leg,,) = shipDemoLeg(101);

        usdcIn.push(486e6);
        usdcIn.push(2_140e6);
        usdcIn.push(5_320e6);

        wethOut.push(0.037e18);
        wethOut.push(0.412e18);
        wethOut.push(1.63e18);

        wethIn.push(0.093e18);
        wethIn.push(0.514e18);
        wethIn.push(1.27e18);

        usdcOut.push(214e6);
        usdcOut.push(1_180e6);
        usdcOut.push(2_930e6);
    }

    // ------------------------------------------------------------------ framework hook

    /// @notice The framework's execution hook.
    /// @dev The framework drives a REAL fill through the router, in whichever mode `takerData` encodes. The taker
    ///      is pre-funded past every path in `StrikelineLeg.setUp`, so this hook mints nothing and therefore cannot
    ///      accidentally paper over a balance-sufficiency failure.
    function _executeSwap(
        SwapVM swapVM,
        ISwapVM.Order memory order,
        address, /* tokenIn */
        address, /* tokenOut */
        uint256 amount,
        bytes memory takerData
    )
        internal
        override
        returns (uint256 amountIn, uint256 amountOut)
    {
        vm.prank(taker);
        (amountIn, amountOut,) = swapVM.swap(order, amount, takerData);
    }

    // ------------------------------------------------------------------ the suite, both directions

    /// @notice The whole framework suite, USDC in / WETH out.
    function test_CoreInvariants_StableInRiskyOut() public {
        assertAllInvariantsWithConfig(
            SwapVM(payable(address(sl))), leg, address(usdc), weth, _config(address(usdc), usdcIn, wethOut)
        );
    }

    /// @notice The whole framework suite, WETH in / USDC out. The direction that crosses the 1e12 scale the other
    ///         way: `balanceIn` is multiplied by 1 and `amountOut` is divided by 1e12.
    function test_CoreInvariants_RiskyInStableOut() public {
        assertAllInvariantsWithConfig(
            SwapVM(payable(address(sl))), leg, weth, address(usdc), _config(weth, wethIn, usdcOut)
        );
    }

    /// @notice The same suite once decay has opened a real band, which is the state a leg spends most of its life in.
    function test_CoreInvariants_AfterTwoDaysOfDecay() public {
        vm.warp(block.timestamp + 2 days);
        assertAllInvariantsWithConfig(
            SwapVM(payable(address(sl))), leg, address(usdc), weth, _config(address(usdc), usdcIn, wethOut)
        );
    }

    // ------------------------------------------------------------------ the tolerance table

    /// @notice Print the table, and assert every cell of it.
    function test_ToleranceTable() public view {
        InvariantConfig memory d = _getDefaultConfig();

        uint256 tolUsdc = symmetryToleranceFor(address(usdc), K, L);
        uint256 tolWeth = symmetryToleranceFor(weth, K, L);

        console2.log("--- tolerance table -------------------------------------------------");
        console2.log("EPS_PHI       (WAD, 6.95e-8)             ", EPS_PHI);
        console2.log("EPS_PHI_INV   (WAD, 1.18e-6)             ", EPS_PHI_INV);
        console2.log("EPS_EVAL      = EPS_PHI + phi_max*EPS_INV", EPS_EVAL);
        console2.log("EPS_ROUNDTRIP = 2 * EPS_EVAL             ", EPS_ROUNDTRIP);
        console2.log("RmmSwap.EPS   (charged guard band)       ", RmmSwap.EPS);
        console2.log("---");
        console2.log("symmetryTolerance   framework", d.symmetryTolerance, "ours (USDC wei)", tolUsdc);
        console2.log("symmetryTolerance   framework", d.symmetryTolerance, "ours (WETH wei)", tolWeth);
        console2.log("additivityTolerance framework", d.additivityTolerance, "ours", uint256(0));
        console2.log("roundingTolBps      framework", d.roundingToleranceBps, "ours", uint256(0));
        console2.log("monotonicityTolBps  framework", d.monotonicityToleranceBps, "ours", uint256(0));
        console2.log("---------------------------------------------------------------------");

        // The three knobs we keep at (or tighten past) the framework default.
        assertEq(d.additivityTolerance, 0, "framework additivity default moved");
        assertEq(d.monotonicityToleranceBps, 0, "framework monotonicity default moved");
        assertEq(d.roundingToleranceBps, 100, "framework rounding default moved");

        // The one we loosen is loosened by arithmetic, not by taste: it is exactly the round-trip error of the
        // reserve the input lands in, plus one unit for each of the two quantisations.
        assertEq(tolUsdc, Math.ceilDiv(uint256(L) * K / 1e18 * EPS_ROUNDTRIP / 1e18, RATE_STABLE) + 2, "USDC tol");
        assertEq(tolWeth, Math.ceilDiv(uint256(L) * EPS_ROUNDTRIP / 1e18, RATE_RISKY) + 2, "WETH tol");
    }

    /// @notice The guard band the instruction charges must dominate the numerical error budget, or a dust fill
    ///         could be settled on the wrong side of the true curve. This is the assertion that keeps `EPS`
    ///         from being tuned down later.
    function test_Eps_DominatesTheRoundTripErrorBound() public pure {
        assertGt(RmmSwap.EPS, EPS_ROUNDTRIP, "RmmSwap.EPS must exceed the curve round-trip error bound");
        // 1.85x, printed so the headroom is a number rather than an adjective.
        assertGe(RmmSwap.EPS * 100 / EPS_ROUNDTRIP, 150, "EPS headroom fell below 1.5x");
    }

    /// @notice The observed symmetry miss, printed against the derived bound. If this ever approaches the bound the
    ///         suite is telling you the error budget moved, not that the tolerance needs raising.
    function test_Symmetry_ObservedIsInsideTheDerivedBound() public view {
        _reportSymmetry(address(usdc), weth, usdcIn, "USDC in ");
        _reportSymmetry(weth, address(usdc), wethIn, "WETH in ");
    }

    function _reportSymmetry(address tokenIn, address, uint256[] memory amounts, string memory label) internal view {
        bytes memory tdIn = takerDataFor(leg, tokenIn, true);
        bytes memory tdOut = takerDataFor(leg, tokenIn, false);
        uint256 bound = symmetryToleranceFor(tokenIn, K, L);

        for (uint256 i; i < amounts.length; ++i) {
            (, uint256 out,) = quote(leg, amounts[i], tdIn);
            (uint256 backIn,,) = quote(leg, out, tdOut);
            uint256 diff = backIn > amounts[i] ? backIn - amounts[i] : amounts[i] - backIn;
            console2.log(label, amounts[i]);
            console2.log("    observed miss", diff, "bound", bound);
            assertLe(diff, bound, "symmetry miss exceeded the derived bound");
        }
    }

    // ------------------------------------------------------------------ config

    function _config(
        address tokenIn,
        uint256[] memory amountsIn,
        uint256[] memory amountsOut
    )
        internal
        view
        returns (InvariantConfig memory config)
    {
        config = _getDefaultConfig();
        config.testAmounts = amountsIn;
        config.testAmountsExactOut = amountsOut;
        config.exactInTakerData = takerDataFor(leg, tokenIn, true);
        config.exactOutTakerData = takerDataFor(leg, tokenIn, false);

        // Derived, not chosen. See the contract docblock.
        config.symmetryTolerance = symmetryToleranceFor(tokenIn, K, L);
        // Tightened past the framework default: dust must never price better than spot, not "within 1%".
        config.roundingToleranceBps = 0;
    }
}
