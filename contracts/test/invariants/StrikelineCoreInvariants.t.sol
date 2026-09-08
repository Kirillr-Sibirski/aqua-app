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
/// @notice SwapVM's OWN invariant suite, `node_modules/1inch/swap-vm/test/invariants/CoreInvariants.t.sol`,
///         imported from the installed package and run unmodified against a shipped Strikeline leg.
///
/// @dev Nothing here reimplements the framework. `CoreInvariants` is an abstract contract that ships inside the
///      installed swap-vm package; this file supplies `_executeSwap` and an `InvariantConfig`, and hands it a real
///      Aqua-mode order whose program is `Deadline . Coverage . RmmSwap . Salt`.
///
///      TOLERANCE TABLE. Every cell is asserted in `test_ToleranceTable`, so the framework defaults cannot drift
///      underneath us and our own values cannot be edited without an assertion noticing.
///
///      | knob                     | framework | ours               | numerical reason                           |
///      |--------------------------|-----------|--------------------|--------------------------------------------|
///      | symmetryTolerance        | 2 wei     | 33,714 USDC wei    | L*K * EPS_ROUNDTRIP / 1e12 + 2             |
///      |                          |           | 1.2966e13 WETH wei | L   * EPS_ROUNDTRIP + 2                    |
///      | additivityTolerance      | 0         | 0        (kept)    | the band is charged once per fill, so one  |
///      |                          |           |                    | big fill beats two by exactly one band     |
///      | roundingToleranceBps     | 100 (1%)  | 0   (TIGHTENED)    | dust cannot price better than spot; it     |
///      |                          |           |                    | reverts inside the band instead            |
///      | monotonicityToleranceBps | 0         | 0        (kept)    | at issue the curve is convex and the band  |
///      |                          |           |                    | is EPS-sized                               |
///      | skipSymmetry             | false     | false              |                                            |
///      | skipAdditivity           | false     | false              |                                            |
///      | skipSpotPrice            | false     | false              | kept everywhere; the decayed run is driven |
///      |                          |           |                    | WETH-in so the framework's hard-coded      |
///      |                          |           |                    | `10 ** decimals` probe clears the band     |
///      | skipMonotonicity         | false     | false at issue,    | see below: replaced by a strictly stronger |
///      |                          |           | true once decayed  | check, not dropped                         |
///
///      `symmetryTolerance` is the one loosened value, and it is not a knob: it is `L_in * EPS_ROUNDTRIP / rate_in`
///      plus one unit for each of the two quantisations, where `EPS_ROUNDTRIP = 1.0805e-6` is fixed by the measured
///      `Phi` error 6.95e-8 and `Phi^-1` round-trip error 1.18e-6 (derived in `StrikelineLeg`). The framework's
///      2 wei assumes a rational curve in exact integer arithmetic; RMM-01 is transcendental and one reserve round
///      trip crosses `Phi^-1` and `Phi` twice. `test_Symmetry_ObservedIsInsideTheDerivedBound` prints the observed
///      miss beside the bound, so the headroom is a number on screen rather than an adjective.
///
///      `skipMonotonicity` on the DECAYED leg is the only skip in this directory, and it is replaced rather than
///      dropped. The framework's check compares AVERAGE prices, which for any instrument charging a FIXED premium
///      must rise with size until the premium is amortised; the framework's own comment says the flag exists for
///      "flat rate orders". At issue our band is EPS-sized and the check passes at 0 bps. Two days in, the band is
///      133.49 USDC and average price keeps improving up to about 6,800 USDC of size. That is the option premium,
///      not a pricing defect. What must hold instead, and what
///      `test_Monotonicity_MarginalPriceIsMonotoneInsideAndOutsideTheBand` asserts over a 40-point scan that
///      starts INSIDE the band, is that the MARGINAL price is monotone: equivalently that `amountOut(amountIn)`
///      is concave. Together with `assertAdditivityInvariant` at tolerance 0 (splitting a trade is strictly
///      worse), that is stronger than the statement being skipped, because it is what actually rules out a
///      size-splitting arbitrage.
contract StrikelineCoreInvariantsTest is StrikelineLeg, CoreInvariants {
    ISwapVM.Order internal leg;

    /// @dev Sizes a desk would actually trade on a 12-WETH leg, in each token's own units. They are bounded by
    ///      what `assertAdditivityInvariant` does: it fills `a` and `2a` as well as `a + 2a`, so the largest
    ///      entry times three must stay inside the curve's domain (`X <= L`, `Y <= L*K`).
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
        wethIn.push(1.09e18);

        usdcOut.push(214e6);
        usdcOut.push(980e6);
        usdcOut.push(2_180e6);
    }

    // ------------------------------------------------------------------ framework hook

    /// @notice The framework's execution hook: a REAL fill through the router, in whichever mode `takerData`
    ///         encodes.
    /// @dev The taker is pre-funded past every path the suite walks (`StrikelineLeg.setUp`), so this hook mints
    ///      nothing and therefore cannot paper over a balance-sufficiency failure by conjuring inventory.
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

    // ------------------------------------------------------------------ the framework suite

    /// @notice The whole framework suite, USDC in / WETH out: `balanceIn` scales up by 1e12, `amountOut` by 1.
    function test_CoreInvariants_StableInRiskyOut() public {
        assertAllInvariantsWithConfig(
            SwapVM(payable(address(sl))), leg, address(usdc), weth, _config(address(usdc), usdcIn, wethOut)
        );
    }

    /// @notice The whole framework suite, WETH in / USDC out: the direction that crosses the 1e12 scale the other
    ///         way, so `amountOut` is the number that gets divided.
    function test_CoreInvariants_RiskyInStableOut() public {
        assertAllInvariantsWithConfig(
            SwapVM(payable(address(sl))), leg, weth, address(usdc), _config(weth, wethIn, usdcOut)
        );
    }

    /// @notice The same suite in the state a leg spends most of its life in: two days of decay, a 133.49 USDC
    ///         band open. Run WETH in, because the framework probes spot with a hard-coded `10 ** decimals`
    ///         trade and 1 USDC is inside a 133.49 USDC band while 1 WETH is far outside it. Average-price
    ///         monotonicity is the single skip, and it is replaced, see the contract docblock.
    function test_CoreInvariants_AfterTwoDaysOfDecay() public {
        vm.warp(block.timestamp + 2 days);
        InvariantConfig memory config = _config(weth, wethIn, usdcOut);
        config.skipMonotonicity = true;
        assertAllInvariantsWithConfig(SwapVM(payable(address(sl))), leg, weth, address(usdc), config);
    }

    // ------------------------------------------------------------------ the tolerance table

    /// @notice Print the table, and assert every cell of it.
    function test_ToleranceTable() public view {
        InvariantConfig memory d = _getDefaultConfig();

        uint256 tolUsdc = symmetryToleranceFor(address(usdc), K, L);
        uint256 tolWeth = symmetryToleranceFor(weth, K, L);

        console2.log("--- tolerance table --------------------------------------------------");
        console2.log("EPS_PHI       (WAD, 6.95e-8)             ", EPS_PHI);
        console2.log("EPS_PHI_INV   (WAD, 1.18e-6)             ", EPS_PHI_INV);
        console2.log("EPS_EVAL      = EPS_PHI + phi_max*EPS_INV", EPS_EVAL);
        console2.log("EPS_ROUNDTRIP = 2 * EPS_EVAL             ", EPS_ROUNDTRIP);
        console2.log("RmmSwap.EPS   (band the curve charges)   ", RmmSwap.EPS);
        console2.log("EPS headroom over the round trip, percent", RmmSwap.EPS * 100 / EPS_ROUNDTRIP);
        console2.log("---");
        console2.log("symmetryTolerance    framework", d.symmetryTolerance, "ours USDC wei", tolUsdc);
        console2.log("symmetryTolerance    framework", d.symmetryTolerance, "ours WETH wei", tolWeth);
        console2.log("additivityTolerance  framework", d.additivityTolerance, "ours", uint256(0));
        console2.log("roundingToleranceBps framework", d.roundingToleranceBps, "ours", uint256(0));
        console2.log("monotonicityTolBps   framework", d.monotonicityToleranceBps, "ours", uint256(0));
        console2.log("----------------------------------------------------------------------");

        // The framework defaults we keep, asserted so a package bump that moves them is caught here.
        assertEq(d.symmetryTolerance, 2, "framework symmetry default moved");
        assertEq(d.additivityTolerance, 0, "framework additivity default moved");
        assertEq(d.monotonicityToleranceBps, 0, "framework monotonicity default moved");
        assertEq(d.roundingToleranceBps, 100, "framework rounding default moved");
        assertFalse(d.skipSymmetry || d.skipAdditivity || d.skipMonotonicity || d.skipSpotPrice, "framework skips");

        // The one we loosen is loosened by arithmetic, not by taste.
        assertEq(tolUsdc, Math.ceilDiv(uint256(L) * K / 1e18 * EPS_ROUNDTRIP / 1e18, RATE_STABLE) + 2, "USDC tol");
        assertEq(tolWeth, Math.ceilDiv(uint256(L) * EPS_ROUNDTRIP / 1e18, RATE_RISKY) + 2, "WETH tol");

        // And the config handed to the framework carries exactly those numbers; nothing else moved.
        InvariantConfig memory c = _config(address(usdc), usdcIn, wethOut);
        assertEq(c.symmetryTolerance, tolUsdc, "config symmetry tolerance");
        assertEq(c.additivityTolerance, 0, "config additivity tolerance");
        assertEq(c.roundingToleranceBps, 0, "config rounding tolerance");
        assertEq(c.monotonicityToleranceBps, 0, "config monotonicity tolerance");
        assertFalse(c.skipSymmetry || c.skipAdditivity || c.skipMonotonicity || c.skipSpotPrice, "config skips");
    }

    /// @notice The band the instruction charges must dominate the numerical error budget, or a dust fill could
    ///         settle on the wrong side of the true curve. This is the assertion that stops `EPS` being tuned
    ///         down later to make a small trade go through.
    function test_Eps_DominatesTheRoundTripErrorBound() public pure {
        assertGt(RmmSwap.EPS, EPS_ROUNDTRIP, "RmmSwap.EPS must exceed the curve round-trip error bound");
        assertGe(RmmSwap.EPS * 100 / EPS_ROUNDTRIP, 150, "EPS headroom fell below 1.5x");
    }

    /// @notice The observed symmetry miss, printed against the derived bound. If this ever approaches the bound
    ///         the suite is saying the error budget moved, not that the tolerance needs raising.
    function test_Symmetry_ObservedIsInsideTheDerivedBound() public view {
        _reportSymmetry(address(usdc), usdcIn, "USDC in (wei)");
        _reportSymmetry(weth, wethIn, "WETH in (wei)");
    }

    // ------------------------------------------------------------ replacement for average-price monotonicity

    /// @notice `amountOut(amountIn)` is concave: every additional 200 USDC buys weakly less WETH than the 200
    ///         before it. Asserted from 200 USDC (INSIDE the 133.49 USDC band) up to 8,000 USDC, so the range
    ///         the framework's average-price check cannot cover on a decayed leg is covered here at zero
    ///         tolerance.
    /// @dev This, plus additivity at tolerance 0, is what actually rules out a size-splitting arbitrage. Average
    ///      price is only a proxy for it, and only a valid proxy when no fixed premium is charged.
    function test_Monotonicity_MarginalPriceIsMonotoneInsideAndOutsideTheBand() public {
        vm.warp(block.timestamp + 2 days);
        bytes memory td = takerDataFor(leg, address(usdc), true);

        uint256 step = 200e6;
        uint256 prevOut;
        uint256 prevMarginal = type(uint256).max;
        uint256 firstMarginal;
        for (uint256 i = 1; i <= 40; ++i) {
            (, uint256 out,) = quote(leg, i * step, td);
            if (i > 1) {
                uint256 marginal = out - prevOut;
                assertLe(marginal, prevMarginal, "marginal price rose with size: amountOut is not concave");
                if (firstMarginal == 0) {
                    firstMarginal = marginal;
                }
                prevMarginal = marginal;
            }
            prevOut = out;
        }
        console2.log("WETH per marginal 200 USDC, first step", firstMarginal);
        console2.log("WETH per marginal 200 USDC, last step ", prevMarginal);
    }

    /// @notice Publish the amortisation point: the size above which AVERAGE price starts to fall again, which is
    ///         where the framework's own monotonicity check becomes applicable to a decayed leg.
    function test_Monotonicity_AmortisationPointIsPublished() public {
        uint256 y0 = sl.stableFor(K, SIGMA, maturity, L, X0);
        vm.warp(block.timestamp + 2 days);
        (, uint256 bandStable) = sl.bandFor(K, SIGMA, maturity, L, X0, y0);
        bytes memory td = takerDataFor(leg, address(usdc), true);

        uint256 step = 200e6;
        uint256 prevPrice;
        uint256 peakAt;
        for (uint256 i = 1; i <= 40; ++i) {
            uint256 amount = i * step;
            (, uint256 out,) = quote(leg, amount, td);
            uint256 price = out * 1e18 / amount;
            if (price < prevPrice && peakAt == 0) {
                peakAt = amount - step;
            }
            prevPrice = price;
        }

        assertGt(peakAt, 0, "average price never turned over inside the scanned range");
        console2.log("band after 2 days (USDC)     ", bandStable / RATE_STABLE);
        console2.log("average price peaks at (USDC)", peakAt / 1e6);
        console2.log("that is this many bands      ", peakAt * RATE_STABLE / bandStable);
    }

    // ------------------------------------------------------------------ helpers

    function _reportSymmetry(address tokenIn, uint256[] memory amounts, string memory label) internal view {
        bytes memory tdIn = takerDataFor(leg, tokenIn, true);
        bytes memory tdOut = takerDataFor(leg, tokenIn, false);
        uint256 bound = symmetryToleranceFor(tokenIn, K, L);

        for (uint256 i; i < amounts.length; ++i) {
            (, uint256 out,) = quote(leg, amounts[i], tdIn);
            (uint256 backIn,,) = quote(leg, out, tdOut);
            uint256 diff = backIn > amounts[i] ? backIn - amounts[i] : amounts[i] - backIn;
            console2.log(label, amounts[i]);
            console2.log("    observed miss", diff, "derived bound", bound);
            assertLe(diff, bound, "symmetry miss exceeded the derived bound");
        }
    }

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
