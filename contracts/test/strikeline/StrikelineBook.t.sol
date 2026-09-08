// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { AquaSwapVMTestBase } from "../base/AquaSwapVMTestBase.sol";
import { StrikelineRouter } from "../../src/StrikelineRouter.sol";
import { ProbeRouter } from "../../src/ProbeRouter.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title StrikelineBookTest
/// @notice The thesis, end to end: one wallet writes a multi-leg option book on the official Aqua flow,
///         every leg prices off the block clock, and a fill on one leg immediately shrinks what the
///         others can deliver.
contract StrikelineBookTest is AquaSwapVMTestBase {
    StrikelineRouter internal sl;

    // A deliberately irregular book, because round demo numbers read as fake even when they are real.
    uint256 constant WALLET_WETH = 10.4e18;
    uint256 constant WALLET_USDC = 24_850e6;

    uint64 constant SIGMA = 0.6e18; // 60% annualised
    uint40 internal maturity;

    /// @dev USDC is 6 decimals, WETH is 18: the curve works in normalised WAD space.
    uint64 constant RATE_RISKY = 1;
    uint64 constant RATE_STABLE = 1e12;

    function setUp() public override {
        super.setUp();
        sl = new StrikelineRouter(address(aqua), weth, address(this), "Strikeline", "1");
        vm.label(address(sl), "StrikelineRouter");
        // The base helpers drive `router`; point them at the Strikeline router.
        router = ProbeRouter(payable(address(sl)));

        maturity = uint40(block.timestamp + 7 days);

        fund(weth, maker, WALLET_WETH);
        fund(address(usdc), maker, WALLET_USDC);
        fund(weth, taker, 50e18);
        fund(address(usdc), taker, 200_000e6);
        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    /// @dev One leg: Deadline . Coverage . RmmSwap . Salt
    function _legProgram(uint128 strikeWad, uint128 liquidityWad, uint64 salt) internal view returns (bytes memory) {
        bool riskyIsA = weth < address(usdc);
        uint8 flags = (riskyIsA ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0) | RmmSwap.FLAG_POST_EXPIRY_ONE_WAY;
        // After expiry the leg only sells the remaining risky at K: assignment, not a free straddle.
        flags |= RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY;

        return bytes.concat(
            Deadline.build(uint40(maturity + 30 minutes)),
            Coverage.build(0, 0),
            RmmSwap.build(
                RmmSwap.Args({
                    flags: flags,
                    sigmaWad: SIGMA,
                    maturity: maturity,
                    strikeWad: strikeWad,
                    liquidityWad: liquidityWad,
                    rateRisky: RATE_RISKY,
                    rateStable: RATE_STABLE
                })
            ),
            Salt.build(salt)
        );
    }

    /// @dev Ship a leg with reserves the chain itself says are on the curve.
    ///      `xWad` picks the moneyness; `y` must come from `stableFor` or the strategy is bricked.
    function _shipLeg(
        uint128 strikeWad,
        uint128 liquidityWad,
        uint256 xWad,
        uint64 salt
    )
        internal
        returns (ISwapVM.Order memory order, bytes32 hash_, uint256 yWad)
    {
        order = buildAquaOrder(maker, weth, address(usdc), _legProgram(strikeWad, liquidityWad, salt));
        yWad = sl.stableFor(strikeWad, SIGMA, maturity, liquidityWad, xWad);

        uint256 usdcAmount = yWad / RATE_STABLE;
        (address a,) = orderTokens(order);
        (uint256 amountA, uint256 amountB) = a == weth ? (xWad, usdcAmount) : (usdcAmount, xWad);
        hash_ = shipOrder(maker, order, amountA, amountB);
    }

    // ------------------------------------------------------------------ tests

    /// @notice A leg prices, fills, and moves real tokens through the official Aqua interface.
    function test_Leg_FillsAndMovesTokens() public {
        (ISwapVM.Order memory order,,) = _shipLeg(2600e18, 12e18, 8.41e18, 1);

        uint256 makerUsdcBefore = usdc.balanceOf(maker);
        uint256 takerWethBefore = IERC20(weth).balanceOf(taker);

        // Buy WETH from the leg with USDC.
        bytes memory td = takerDataFor(order, address(usdc), true);
        (, uint256 quoted,) = quote(order, 2000e6, td);
        (, uint256 got,) = swapAs(taker, order, 2000e6, td);

        assertEq(got, quoted, "quote != swap");
        assertGt(got, 0, "no output");
        assertEq(IERC20(weth).balanceOf(taker), takerWethBefore + got, "taker did not receive WETH");
        assertEq(usdc.balanceOf(maker), makerUsdcBefore + 2000e6, "maker did not receive USDC");
        console2.log("bought WETH for 2000 USDC:", got);
    }

    /// @notice Time decay alone, with no transaction, makes a previously-fillable trade revert: the
    ///         curve has moved away from the reserves and the gap is the accrued theta.
    function test_Theta_DecayOpensASpread() public {
        (ISwapVM.Order memory order,,) = _shipLeg(2600e18, 12e18, 8.41e18, 2);
        bytes memory td = takerDataFor(order, address(usdc), true);

        (, uint256 before,) = quote(order, 40e6, td);
        assertGt(before, 0, "small trade should clear at t0");

        vm.warp(block.timestamp + 3 days);

        vm.expectRevert();
        this.quote(order, 40e6, td);

        // A large enough trade still clears: it pays the band.
        (, uint256 big,) = quote(order, 4000e6, td);
        assertGt(big, 0, "large trade should still clear after decay");
        console2.log("after 3 days, 40 USDC reverts; 4000 USDC returns:", big);
    }

    /// @notice The published band matches the observed minimum fillable size.
    function test_Band_MatchesObservedMinimum() public {
        uint128 K = 2600e18;
        uint128 L = 12e18;
        uint256 x = 8.41e18;
        (ISwapVM.Order memory order,, uint256 y) = _shipLeg(K, L, x, 3);

        // `_shipLeg` ships `y / RATE_STABLE` raw USDC, so the reserve Aqua actually holds is that
        // number normalised back — not `stableFor`'s sub-wei-of-USDC answer. The band has to be read
        // at the reserve that is on chain or it is a band for a leg that does not exist.
        uint256 reserveY = (y / RATE_STABLE) * RATE_STABLE;

        vm.warp(block.timestamp + 2 days);
        (, uint256 minStableIn) = sl.bandFor(K, SIGMA, maturity, L, x, reserveY);
        assertGt(minStableIn, 0, "decay should have opened a band");

        // The strict property the UI prints under "Anything below this reverts": the published number
        // is the FIRST amount that clears, not merely a number in the right neighbourhood. Rounded up
        // into raw USDC, because a minimum that rounds down is not a minimum.
        bytes memory td = takerDataFor(order, address(usdc), true);
        uint256 band = Math.ceilDiv(minStableIn, RATE_STABLE);

        (, uint256 out,) = quote(order, band, td);
        assertGt(out, 0, "the published band must clear");

        vm.expectRevert(); // one wei less must not
        this.quote(order, band - 1, td);

        console2.log("band (USDC wei):", band);
    }

    /// @notice The thesis: three legs on one wallet, deliberately over-allocated, and a fill on leg 1
    ///         shrinks what legs 2 and 3 can actually deliver — in the same block, with no keeper and no
    ///         message between strategies. Proven by QUOTING the siblings before and after, not by
    ///         re-reading a shared counter.
    function test_Book_FillOnOneLegShrinksSiblingDepth() public {
        (ISwapVM.Order memory leg1,,) = _shipLeg(2600e18, 12e18, 8.41e18, 11);
        (ISwapVM.Order memory leg2,,) = _shipLeg(2800e18, 10e18, 9.22e18, 12);
        (ISwapVM.Order memory leg3,,) = _shipLeg(3000e18, 10e18, 9.88e18, 13);

        uint256 virtualWeth = 8.41e18 + 9.22e18 + 9.88e18;
        assertGt(virtualWeth, WALLET_WETH, "the book must be over-allocated for this to mean anything");

        // A size each sibling can deliver right now, but will not be able to after leg 1 is filled.
        uint256 probe = 6e18;
        bytes memory leg2Out = takerDataFor(leg2, address(usdc), false);
        bytes memory leg3Out = takerDataFor(leg3, address(usdc), false);

        (uint256 leg2CostBefore,,) = quote(leg2, probe, leg2Out);
        (uint256 leg3CostBefore,,) = quote(leg3, probe, leg3Out);
        assertGt(leg2CostBefore, 0, "leg 2 must be able to deliver the probe before the fill");
        assertGt(leg3CostBefore, 0, "leg 3 must be able to deliver the probe before the fill");

        // Fill leg 1 hard, moving real WETH out of the shared wallet.
        uint256 coverageBefore = sl.coverage(maker, weth);
        bytes memory leg1Out = takerDataFor(leg1, address(usdc), false);
        (uint256 spent,,) = swapAs(taker, leg1, 5e18, leg1Out);
        assertGt(spent, 0);

        uint256 coverageAfter = sl.coverage(maker, weth);
        assertEq(coverageAfter, coverageBefore - 5e18, "the fill must reduce the shared wallet");
        assertLt(coverageAfter, probe, "the probe must now exceed what the wallet can deliver");

        // The siblings were never touched: their own virtual reserves and curves are unchanged. What
        // changed is the wallet behind all three, and both refuse the same size they just quoted.
        vm.expectRevert();
        this.quote(leg2, probe, leg2Out);

        vm.expectRevert();
        this.quote(leg3, probe, leg3Out);

        // They are still live, just smaller: a size inside the remaining wallet still prices.
        uint256 smaller = coverageAfter / 2;
        (uint256 leg2CostAfter,,) = quote(leg2, smaller, leg2Out);
        (uint256 leg3CostAfter,,) = quote(leg3, smaller, leg3Out);
        assertGt(leg2CostAfter, 0, "leg 2 must still quote within the remaining wallet");
        assertGt(leg3CostAfter, 0, "leg 3 must still quote within the remaining wallet");

        console2.log("shared WETH before fill:", coverageBefore, "after:", coverageAfter);
        console2.log("siblings refused:", probe, "but still fill:", smaller);
    }

    /// @notice The siblings' own liquidity is untouched by the fill: only the shared wallet moved.
    ///         Without `Coverage` the same book would happily quote depth it cannot deliver.
    function test_Book_WithoutCoverageTheDepthIsPhantom() public {
        (ISwapVM.Order memory guarded,,) = _shipLeg(2800e18, 10e18, 9.22e18, 14);

        // The same leg, same curve, same reserves, but without the Coverage wrapper.
        bool riskyIsA = weth < address(usdc);
        uint8 flags = (riskyIsA ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0);
        bytes memory bare = bytes.concat(
            RmmSwap.build(
                RmmSwap.Args({
                    flags: flags,
                    sigmaWad: SIGMA,
                    maturity: maturity,
                    strikeWad: 2800e18,
                    liquidityWad: 10e18,
                    rateRisky: RATE_RISKY,
                    rateStable: RATE_STABLE
                })
            ),
            Salt.build(15)
        );
        ISwapVM.Order memory unguarded = buildAquaOrder(maker, weth, address(usdc), bare);
        uint256 y = sl.stableFor(2800e18, SIGMA, maturity, 10e18, 9.22e18);
        (address a,) = orderTokens(unguarded);
        (uint256 amountA, uint256 amountB) =
            a == weth ? (uint256(9.22e18), y / RATE_STABLE) : (y / RATE_STABLE, uint256(9.22e18));
        shipOrder(maker, unguarded, amountA, amountB);

        // Drain the wallet down to less than either leg claims to hold.
        vm.prank(maker);
        IERC20(weth).transfer(address(0xdead), WALLET_WETH - 1e18);
        assertEq(sl.coverage(maker, weth), 1e18);

        // The unguarded leg still quotes 6 WETH it cannot possibly deliver: phantom depth.
        bytes memory td = takerDataFor(unguarded, address(usdc), false);
        (uint256 phantomCost,,) = quote(unguarded, 6e18, td);
        assertGt(phantomCost, 0, "the unguarded leg quotes depth the wallet does not have");

        // The guarded leg refuses the same size.
        bytes memory tdG = takerDataFor(guarded, address(usdc), false);
        vm.expectRevert();
        this.quote(guarded, 6e18, tdG);

        console2.log("unguarded quote for 6 WETH against a 1 WETH wallet:", phantomCost);
    }

    /// @notice Coverage refuses a quote the wallet cannot actually deliver, and says by how much.
    function test_Coverage_RefusesUndeliverableQuote() public {
        // A leg whose virtual reserve far exceeds the wallet.
        (ISwapVM.Order memory order,,) = _shipLeg(2600e18, 12e18, 9.9e18, 21);

        // Drain most of the maker's WETH elsewhere: the virtual balance is untouched, the real one is not.
        vm.prank(maker);
        IERC20(weth).transfer(address(0xdead), WALLET_WETH - 0.05e18);

        assertEq(sl.coverage(maker, weth), 0.05e18, "coverage should track the real wallet");

        bytes memory td = takerDataFor(order, address(usdc), true);
        vm.expectRevert();
        this.quote(order, 20_000e6, td);

        // A trade inside the remaining coverage still works.
        (, uint256 small,) = quote(order, 60e6, td);
        assertLe(small, 0.05e18, "fill must fit inside real coverage");
        console2.log("undeliverable quote refused; small fill still clears:", small);
    }

    /// @notice After maturity the curve is a constant-sum order at exactly K, and it only trades in the
    ///         assignment direction.
    function test_Expiry_SettlesAtStrikeOneWay() public {
        uint128 K = 2600e18;
        (ISwapVM.Order memory order,,) = _shipLeg(K, 12e18, 8.41e18, 31);

        vm.warp(uint256(maturity) + 1);
        assertEq(sl.tauNow(maturity), 0, "tau must be zero after maturity");

        // Assignment: buy the remaining WETH with USDC. The first trade also has to clear the theta the
        // leg accrued over its life (the reserves sit below the settlement curve by exactly that much),
        // so the average price beats the strike. Once the band is closed, the curve is constant-sum and
        // the MARGINAL price is exactly K, which is what "settles at the strike" means.
        bytes memory buy = takerDataFor(order, address(usdc), true);
        (, uint256 firstOut,) = quote(order, 2600e6, buy);
        assertLt(firstOut, 1e18, "the first taker also pays the accrued theta");
        swapAs(taker, order, 2600e6, buy);

        (, uint256 marginalOut,) = quote(order, 2600e6, buy);
        assertApproxEqRel(marginalOut, 1e18, 0.0001e18, "after expiry the marginal price is the strike");

        // Constant-sum: the next increment gets the same rate again.
        swapAs(taker, order, 2600e6, buy);
        (, uint256 nextOut,) = quote(order, 2600e6, buy);
        assertApproxEqRel(nextOut, marginalOut, 0.0001e18, "settlement leg must be constant-sum");
        console2.log("theta paid on first assignment (WETH withheld):", 1e18 - firstOut);

        // The other direction is closed: an expired leg is not a two-sided market.
        bytes memory sell = takerDataFor(order, weth, true);
        vm.expectRevert();
        this.quote(order, 1e18, sell);
    }

    /// @notice Rolling the book to a new expiry moves zero tokens, and the same economic parameters can
    ///         be re-shipped because the salt is a monotonic nonce.
    function test_Roll_MovesNoTokensAndCanRepeatParameters() public {
        (ISwapVM.Order memory old, bytes32 oldHash,) = _shipLeg(2600e18, 12e18, 8.41e18, 41);

        uint256 makerWethBefore = IERC20(weth).balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        // Ship the replacement first so quotes never go dark, then dock the old one.
        (, bytes32 newHash,) = _shipLeg(2600e18, 12e18, 8.41e18, 42);
        assertTrue(newHash != oldHash, "salt must make the rolled leg a distinct strategy");
        dockOrder(maker, old);

        assertEq(IERC20(weth).balanceOf(maker), makerWethBefore, "roll must not move WETH");
        assertEq(usdc.balanceOf(maker), makerUsdcBefore, "roll must not move USDC");
    }

    /// @notice `quote()` and `swap()` agree for any size the curve accepts.
    function testFuzz_QuoteEqualsSwap(uint256 amount) public {
        amount = bound(amount, 500e6, 6000e6);
        (ISwapVM.Order memory order,,) = _shipLeg(2600e18, 12e18, 8.41e18, 51);
        bytes memory td = takerDataFor(order, address(usdc), true);

        (, uint256 quoted,) = quote(order, amount, td);
        (, uint256 got,) = swapAs(taker, order, amount, td);
        assertEq(got, quoted, "quote != swap");
    }
}
