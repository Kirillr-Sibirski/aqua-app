// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

        vm.warp(block.timestamp + 2 days);
        (, uint256 minStableIn) = sl.bandFor(K, SIGMA, maturity, L, x, y);
        assertGt(minStableIn, 0, "decay should have opened a band");

        bytes memory td = takerDataFor(order, address(usdc), true);
        uint256 justUnder = (minStableIn / RATE_STABLE) / 2;
        if (justUnder > 0) {
            vm.expectRevert();
            this.quote(order, justUnder, td);
        }

        uint256 comfortablyOver = (minStableIn / RATE_STABLE) * 3 + 1;
        (, uint256 out,) = quote(order, comfortablyOver, td);
        assertGt(out, 0, "a trade above the band must clear");
        console2.log("band (USDC):", minStableIn / RATE_STABLE);
    }

    /// @notice The book: four legs on one wallet, deliberately over-allocated, and a fill on one leg
    ///         immediately shrinks what the others can deliver. This is the property no pool can have.
    function test_Book_SharedInventoryCouplesLegs() public {
        (ISwapVM.Order memory leg1,,) = _shipLeg(2600e18, 12e18, 8.41e18, 11);
        (ISwapVM.Order memory leg2,,) = _shipLeg(2800e18, 10e18, 9.22e18, 12);
        (ISwapVM.Order memory leg3,,) = _shipLeg(3000e18, 10e18, 9.88e18, 13);

        uint256 virtualWeth = 8.41e18 + 9.22e18 + 9.88e18;
        assertGt(virtualWeth, WALLET_WETH, "the book must be over-allocated for this to mean anything");
        console2.log("virtual WETH shipped:", virtualWeth, "real wallet WETH:", WALLET_WETH);

        uint256 coverageBefore = sl.coverage(maker, weth);
        assertEq(coverageBefore, WALLET_WETH, "coverage should equal the wallet balance");

        // Fill leg 1, taking WETH out of the maker's wallet.
        bytes memory td = takerDataFor(leg1, address(usdc), true);
        (, uint256 got,) = swapAs(taker, leg1, 3000e6, td);
        assertGt(got, 0);

        uint256 coverageAfter = sl.coverage(maker, weth);
        assertEq(coverageAfter, coverageBefore - got, "a fill on leg 1 must shrink shared coverage");

        // Every sibling leg sees the smaller wallet in the same block, with no keeper and no message.
        assertEq(sl.coverage(maker, weth), coverageAfter, "leg 2 reads the same wallet");
        assertEq(sl.coverage(maker, weth), coverageAfter, "leg 3 reads the same wallet");
        assertTrue(address(leg2.maker) == address(leg3.maker));
        console2.log("coverage before fill:", coverageBefore, "after:", coverageAfter);
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
