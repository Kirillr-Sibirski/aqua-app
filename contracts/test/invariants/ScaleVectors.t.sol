// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { StrikelineLeg } from "./StrikelineLeg.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";
import { WadMath } from "../../src/math/WadMath.sol";

/// @title ScaleVectorsTest
/// @notice Golden vectors for USDC(6)/WETH(18) across every path where the 1e12 decimal scale is applied,
///         each with an independent proof that the rounding lands on the maker's side.
///
/// @dev A silent 1e12 is the failure this file exists to catch. `RmmSwap` works in one normalised WAD space and
///      carries the decimals as two `uint64` multipliers, `rateRisky` and `rateStable`, so every number crossing
///      the instruction boundary is multiplied on the way in and divided on the way out. There are exactly six
///      places that happens, and all six are pinned here:
///
///        P1  exact-in,  stable in / risky out   balanceIn x 1e12, amountIn x 1e12, amountOut / 1
///        P2  exact-in,  risky in / stable out   balanceIn x 1,    amountIn x 1,    amountOut / 1e12   <- truncates
///        P3  exact-out, stable in / risky out   amountOut x 1,    amountIn = ceil(. / 1e12)           <- carries
///        P4  exact-out, risky in / stable out   amountOut x 1e12, amountIn = ceil(. / 1)
///        P5  view `stableFor`                   the maker's own ship amount, yWad / 1e12
///        P6  view `bandFor`                     the minimum fillable size a UI publishes, / 1e12
///
///      THE CONTROL. The same leg is shipped a second time against an 18-decimal stable (`dai`) with both rates
///      set to 1, and both legs are given byte-identical NORMALISED reserves. The two legs must then price the
///      same economic trade identically, so every assertion below can name the exact digit the 6-decimal path
///      dropped or carried:
///
///        exact-in  486 units of stable   ->  195559373061486364 wei WETH on BOTH legs. Identical.
///        exact-in  0.514 WETH            ->  1268028694.567645426400 stable. USDC gets 1268028694: TRUNCATED,
///                                            the 0.567645426400 stays with the maker.
///        exact-out 0.412 WETH            ->  1025989444.720966964800 stable. USDC pays 1025989445: CARRIED,
///                                            the taker rounds up 0.279033035200 to the maker.
///        exact-out 980 units of stable   ->  396768828946486052 wei WETH on BOTH legs. Identical.
///
///      Every literal below was read off the chain, not computed off it. `test_Golden_*` asserts them with
///      `assertEq`, so a one-wei drift anywhere in the scale handling fails the suite rather than quietly
///      repricing the book.
contract ScaleVectorsTest is StrikelineLeg {
    // ------------------------------------------------------------------ golden literals

    /// @dev `stableFor(K, sigma, maturity, L, 8.41e18)` at issue, normalised WAD.
    uint256 internal constant GOLD_Y_WAD = 8_454_182_435_616_095_568_000;
    /// @dev The same number as a USDC ship amount: floor(GOLD_Y_WAD / 1e12).
    uint256 internal constant GOLD_Y_USDC = 8_454_182_435;

    uint256 internal constant IN_STABLE = 486; // 486 units of the stable, exact-in
    uint256 internal constant IN_RISKY = 0.514e18; // exact-in
    uint256 internal constant OUT_RISKY = 0.412e18; // exact-out
    uint256 internal constant OUT_STABLE = 980; // 980 units of the stable, exact-out

    /// @dev P1: 486 stable in -> WETH out. Identical on the 6- and 18-decimal legs.
    uint256 internal constant GOLD_P1_OUT = 195_559_373_061_486_364;
    /// @dev P2: 0.514 WETH in -> stable out. 18dp exact value, and the 6dp truncation of it.
    uint256 internal constant GOLD_P2_OUT_18 = 1_268_028_694_567_645_426_400;
    uint256 internal constant GOLD_P2_OUT_6 = 1_268_028_694;
    /// @dev P3: 0.412 WETH out -> stable in. 18dp exact value, and the 6dp carry of it.
    uint256 internal constant GOLD_P3_IN_18 = 1_025_989_444_720_966_964_800;
    uint256 internal constant GOLD_P3_IN_6 = 1_025_989_445;
    /// @dev P4: 980 stable out -> WETH in. Identical on the 6- and 18-decimal legs.
    uint256 internal constant GOLD_P4_IN = 396_768_828_946_486_052;
    /// @dev P6: the decay band two days in, normalised and as USDC. 133.49 USDC, the published figure.
    uint256 internal constant GOLD_BAND_RISKY_2D = 53_431_834_517_850_644;
    uint256 internal constant GOLD_BAND_STABLE_2D_WAD = 133_487_323_328_896_399_200;
    uint256 internal constant GOLD_BAND_STABLE_2D_USDC = 133_487_323;

    // ------------------------------------------------------------------ fixture

    ISwapVM.Order internal usdcLeg;
    ISwapVM.Order internal daiLeg;
    uint256 internal yWad;

    function setUp() public override {
        super.setUp();
        fund(address(dai), maker, 41_700e18);
        fund(address(dai), taker, 380_000e18);
        approveRouter(taker, address(dai), type(uint256).max);

        (usdcLeg,, yWad) = shipDemoLeg(301);
        daiLeg = _shipDaiLeg();
    }

    // ------------------------------------------------------------------ P1 - P4: the four swap paths

    /// @notice P1. Exact-in, stable in / risky out. `balanceIn` and `amountIn` scale UP by 1e12, `amountOut` is
    ///         already in risky units so nothing scales on the way out.
    function test_Golden_P1_ExactIn_StableIn_RiskyOut() public view {
        (uint256 inUsdc, uint256 outUsdc,) =
            quote(usdcLeg, IN_STABLE * 1e6, takerDataFor(usdcLeg, address(usdc), true));
        (uint256 inDai, uint256 outDai,) = quote(daiLeg, IN_STABLE * 1e18, takerDataFor(daiLeg, address(dai), true));

        assertEq(inUsdc, IN_STABLE * 1e6, "P1 exact-in must consume exactly what was offered");
        assertEq(inDai, IN_STABLE * 1e18, "P1 control exact-in amount");
        assertEq(outUsdc, GOLD_P1_OUT, "P1 golden");
        assertEq(outDai, GOLD_P1_OUT, "P1 must be decimal-blind: 6dp and 18dp stables price identically");

        _assertExactInRoundsToMaker(usdcLeg, address(usdc), weth, IN_STABLE * 1e6, outUsdc);
    }

    /// @notice P2. Exact-in, risky in / stable out. The output is divided by 1e12, so this is the path where a
    ///         6-decimal token TRUNCATES - and the truncated dust must stay with the maker.
    function test_Golden_P2_ExactIn_RiskyIn_StableOut() public view {
        (, uint256 outUsdc,) = quote(usdcLeg, IN_RISKY, takerDataFor(usdcLeg, weth, true));
        (, uint256 outDai,) = quote(daiLeg, IN_RISKY, takerDataFor(daiLeg, weth, true));

        assertEq(outUsdc, GOLD_P2_OUT_6, "P2 golden (6dp)");
        assertEq(outDai, GOLD_P2_OUT_18, "P2 golden (18dp control)");

        // The 6-decimal answer is exactly the floor of the 18-decimal one. Not "about", exactly.
        assertEq(outUsdc, outDai / RATE_STABLE, "P2 scale: USDC out must be floor(DAI out / 1e12)");
        // And the floor is strict here, so the maker really did keep something.
        assertGt(outDai, outUsdc * RATE_STABLE, "P2 chose a vector where truncation is observable");
        console2.log("P2 dust withheld from the taker (wad)", outDai - outUsdc * RATE_STABLE);

        _assertExactInRoundsToMaker(usdcLeg, weth, address(usdc), IN_RISKY, outUsdc);
    }

    /// @notice P3. Exact-out, stable in / risky out. The input is ceiled after the 1e12 divide, so this is the
    ///         path where a 6-decimal token CARRIES - and the carry must go to the maker.
    function test_Golden_P3_ExactOut_StableIn_RiskyOut() public view {
        (uint256 inUsdc, uint256 outUsdc,) = quote(usdcLeg, OUT_RISKY, takerDataFor(usdcLeg, address(usdc), false));
        (uint256 inDai,,) = quote(daiLeg, OUT_RISKY, takerDataFor(daiLeg, address(dai), false));

        assertEq(outUsdc, OUT_RISKY, "P3 exact-out must deliver exactly what was asked");
        assertEq(inUsdc, GOLD_P3_IN_6, "P3 golden (6dp)");
        assertEq(inDai, GOLD_P3_IN_18, "P3 golden (18dp control)");

        // The 6-decimal answer is exactly the ceiling of the 18-decimal one.
        assertEq(inUsdc, Math.ceilDiv(inDai, RATE_STABLE), "P3 scale: USDC in must be ceil(DAI in / 1e12)");
        assertGt(inUsdc * RATE_STABLE, inDai, "P3 chose a vector where the carry is observable");
        console2.log("P3 carry paid to the maker (wad)", inUsdc * RATE_STABLE - inDai);

        _assertExactOutRoundsToMaker(usdcLeg, address(usdc), weth, OUT_RISKY, inUsdc);
    }

    /// @notice P4. Exact-out, risky in / stable out. `amountOut` scales UP by 1e12; the input is risky so the
    ///         ceiling divides by 1 and cannot lose anything.
    function test_Golden_P4_ExactOut_RiskyIn_StableOut() public view {
        (uint256 inUsdc, uint256 outUsdc,) = quote(usdcLeg, OUT_STABLE * 1e6, takerDataFor(usdcLeg, weth, false));
        (uint256 inDai,,) = quote(daiLeg, OUT_STABLE * 1e18, takerDataFor(daiLeg, weth, false));

        assertEq(outUsdc, OUT_STABLE * 1e6, "P4 exact-out amount");
        assertEq(inUsdc, GOLD_P4_IN, "P4 golden");
        assertEq(inDai, GOLD_P4_IN, "P4 must be decimal-blind: 6dp and 18dp stables cost the same WETH");

        _assertExactOutRoundsToMaker(usdcLeg, weth, address(usdc), OUT_STABLE * 1e6, inUsdc);
    }

    // ------------------------------------------------------------------ P5 - P6: the two view paths

    /// @notice P5. `stableFor` is the maker's own scale path: the number they ship. It is returned normalised and
    ///         floored into USDC, and the floor must not brick the leg.
    /// @dev Shipping ABOVE the curve hands the surplus to the first taker; shipping below only means the first
    ///      trade has to be marginally larger. The floor is therefore the safe direction, and the cost of it is
    ///      bounded by exactly one USDC wei of normalised reserve, which this pins.
    function test_Golden_P5_View_StableForShipAmount() public view {
        assertEq(yWad, GOLD_Y_WAD, "P5 golden: stableFor at issue");
        assertEq(yWad / RATE_STABLE, GOLD_Y_USDC, "P5 golden: USDC ship amount");

        // What was actually shipped, read back out of Aqua.
        (uint256 stableShipped,) = aquaSafe(maker, sl.hash(usdcLeg), address(usdc), weth);
        assertEq(stableShipped, GOLD_Y_USDC, "P5 the shipped reserve is the floored view value");

        // The quantisation cost, in normalised units, is under one USDC wei.
        uint256 lost = yWad - stableShipped * RATE_STABLE;
        assertLt(lost, RATE_STABLE, "P5 quantisation must cost less than one USDC wei of reserve");
        console2.log("P5 reserve lost to 6-decimal quantisation (wad)", lost);

        // And the leg is live at issue, so the floor did not brick it.
        (, uint256 out,) = quote(usdcLeg, 486e6, takerDataFor(usdcLeg, address(usdc), true));
        assertGt(out, 0, "P5 a leg shipped at the floored reserve must still quote");
    }

    /// @notice P6. `bandFor` is what a UI publishes as the minimum fillable size. Its stable side is normalised,
    ///         so it must be divided by 1e12 before it is shown - and the number it produces must actually be
    ///         the edge.
    function test_Golden_P6_View_BandForMinimumSize() public {
        (uint256 mr0, uint256 ms0) = sl.bandFor(K, SIGMA, maturity, L, X0, yWad);
        assertEq(mr0, 0, "P6 at issue the reserves sit on the curve, so the band is zero");
        assertEq(ms0, 0, "P6 at issue the reserves sit on the curve, so the band is zero");

        vm.warp(block.timestamp + 2 days);
        (uint256 mr, uint256 ms) = sl.bandFor(K, SIGMA, maturity, L, X0, yWad);
        assertEq(mr, GOLD_BAND_RISKY_2D, "P6 golden: risky band after 2 days");
        assertEq(ms, GOLD_BAND_STABLE_2D_WAD, "P6 golden: stable band after 2 days (normalised)");
        assertEq(ms / RATE_STABLE, GOLD_BAND_STABLE_2D_USDC, "P6 golden: stable band after 2 days (USDC)");

        // The published number is the edge: comfortably under it reverts, comfortably over it fills.
        bytes memory buy = takerDataFor(usdcLeg, address(usdc), true);
        uint256 band = ms / RATE_STABLE;
        (bool under,) = address(sl).staticcall(abi.encodeCall(ISwapVM.quote, (usdcLeg, band / 2, buy)));
        assertFalse(under, "P6 half the published band must not clear");
        (, uint256 out,) = quote(usdcLeg, band * 2, buy);
        assertGt(out, 0, "P6 twice the published band must clear");

        console2.log("P6 band after 2 days (USDC)", band);
    }

    // ------------------------------------------------------------------ maker-favouring rounding, per path

    /// @dev Re-derives the exact-in answer from the curve library the instruction itself calls, and asserts that
    ///      the division by `rateOut` was floored, and floored TIGHTLY: one more unit of output would overdraw
    ///      the reserve the curve leaves behind. That is the strongest form of "rounds toward the maker" - it is
    ///      also "and by no more than it had to".
    function _assertExactInRoundsToMaker(
        ISwapVM.Order memory order,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    )
        internal
        view
    {
        bool riskyIn = tokenIn == weth;
        (uint256 rateIn, uint256 rateOut) =
            riskyIn ? (uint256(RATE_RISKY), uint256(RATE_STABLE)) : (uint256(RATE_STABLE), uint256(RATE_RISKY));

        (uint256 bIn, uint256 bOut) = aquaSafe(maker, sl.hash(order), tokenIn, tokenOut);
        uint256 balanceIn = bIn * rateIn;
        uint256 balanceOut = bOut * rateOut;
        uint256 s = _sNow();
        uint256 epsOut = Math.ceilDiv((riskyIn ? uint256(L) * K / 1e18 : uint256(L)) * RmmSwap.EPS, 1e18);

        uint256 newIn = balanceIn + amountIn * rateIn;
        uint256 newOut = riskyIn ? RmmSwap.stableOf(newIn, K, s, L) : RmmSwap.riskyOf(newIn, K, s, L);

        assertEq(amountOut, (balanceOut - newOut - epsOut) / rateOut, "exact-in: quote is not the curve's own value");
        assertLe(amountOut * rateOut + newOut + epsOut, balanceOut, "exact-in: output overdraws the reserve");
        assertGt((amountOut + 1) * rateOut + newOut + epsOut, balanceOut, "exact-in: output was rounded down too far");
    }

    /// @dev The mirror image for exact-out: the division by `rateIn` was ceiled, and ceiled tightly.
    function _assertExactOutRoundsToMaker(
        ISwapVM.Order memory order,
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 amountIn
    )
        internal
        view
    {
        bool riskyIn = tokenIn == weth;
        (uint256 rateIn, uint256 rateOut) =
            riskyIn ? (uint256(RATE_RISKY), uint256(RATE_STABLE)) : (uint256(RATE_STABLE), uint256(RATE_RISKY));

        (uint256 bIn, uint256 bOut) = aquaSafe(maker, sl.hash(order), tokenIn, tokenOut);
        uint256 balanceIn = bIn * rateIn;
        uint256 balanceOut = bOut * rateOut;
        uint256 s = _sNow();
        uint256 epsOut = Math.ceilDiv((riskyIn ? uint256(L) * K / 1e18 : uint256(L)) * RmmSwap.EPS, 1e18);

        uint256 newOut = balanceOut - (amountOut * rateOut + epsOut);
        uint256 newIn = riskyIn ? RmmSwap.riskyOf(newOut, K, s, L) : RmmSwap.stableOf(newOut, K, s, L);

        assertEq(amountIn, Math.ceilDiv(newIn - balanceIn, rateIn), "exact-out: quote is not the curve's own value");
        assertGe(balanceIn + amountIn * rateIn, newIn, "exact-out: input underpays the curve");
        assertLt(balanceIn + (amountIn - 1) * rateIn, newIn, "exact-out: input was rounded up too far");
    }

    function _sNow() internal view returns (uint256) {
        uint256 tau = RmmSwap.tauOf(maturity, block.timestamp);
        return tau == 0 ? 0 : uint256(SIGMA) * WadMath.sqrt(tau) / 1e18;
    }

    // ------------------------------------------------------------------ the leg's 18-decimal twin

    function _daiProgram(uint64 salt) internal view returns (bytes memory) {
        uint8 flags = (weth < address(dai) ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0) | RmmSwap.FLAG_POST_EXPIRY_ONE_WAY
            | RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY;
        return bytes.concat(
            Deadline.build(uint40(maturity + 30 minutes)),
            Coverage.build(0, 0),
            RmmSwap.build(
                RmmSwap.Args({
                    flags: flags,
                    sigmaWad: SIGMA,
                    maturity: maturity,
                    strikeWad: K,
                    liquidityWad: L,
                    rateRisky: 1,
                    rateStable: 1
                })
            ),
            Salt.build(salt)
        );
    }

    /// @dev Shipped with the SAME normalised reserves as the USDC leg (the floored value, re-scaled), so any
    ///      difference between the two legs can only come from the decimal handling.
    function _shipDaiLeg() internal returns (ISwapVM.Order memory order) {
        order = buildAquaOrder(maker, weth, address(dai), _daiProgram(302));
        uint256 stable = yWad / RATE_STABLE * RATE_STABLE;
        (address a,) = orderTokens(order);
        (uint256 amountA, uint256 amountB) = a == weth ? (X0, stable) : (stable, X0);
        shipOrder(maker, order, amountA, amountB);
    }
}
