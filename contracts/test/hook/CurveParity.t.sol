// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import { StrikelineV4Base } from "./StrikelineV4Base.sol";
import { StrikelineHook } from "../../src/hooks/StrikelineHook.sol";
import { RmmPricer } from "../../src/hooks/RmmPricer.sol";

/// @title CurveParityTest
/// @notice The control in the experiment. Before comparing two venues you have to show they are running
///         the same instrument, otherwise every difference downstream is just a different option.
///
/// @dev Both legs are given identical terms and identical reserves, and every quote is compared for
///      EXACT equality - not a tolerance. That holds because `RmmPricer` does not reimplement anything:
///      it calls `RmmSwap.stableOf`, `RmmSwap.riskyOf` and `RmmSwap.tauOf`, and applies the same `EPS`
///      guard band, so the two venues execute the same opcodes on the same integers.
contract CurveParityTest is StrikelineV4Base {
    uint64 constant SIGMA = 0.6e18;
    uint128 constant K = 2600e18;
    uint128 constant L = 12e18;
    uint256 constant X = 8.41e18;

    uint40 internal maturity;
    PoolKey internal key;
    ISwapVM.Order internal order;
    uint256 internal usdcReserve;

    /// @dev True when selling WETH into the leg means `zeroForOne` on the v4 side.
    bool internal sellWethIsZeroForOne;

    function setUp() public override {
        super.setUp();
        maturity = uint40(block.timestamp + 7 days);

        fund(weth, maker, 80e18);
        fund(address(usdc), maker, 240_000e6);
        fund(weth, taker, 50e18);
        fund(address(usdc), taker, 200_000e6);
        approveHook(maker);
        approveSwapRouter(taker);
        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);

        RmmPricer.Terms memory t = termsFor(K, SIGMA, maturity, L);

        // Bare curve on the Aqua side: no Coverage wrapper, so this compares curve against curve.
        uint256 aquaStable;
        (order, aquaStable) = shipAquaLeg(t, X, 1, false, maker);
        (key, usdcReserve) = writeLeg(200, t, StrikelineHook.Backing.Pooled, X, maker);

        assertEq(aquaStable, usdcReserve, "both venues must be funded on the same point of the curve");
        sellWethIsZeroForOne = wethIsCurrency0;
    }

    // ------------------------------------------------------------------ the four cases

    function test_Parity_ExactIn_StableIn() public view {
        _assertParity(address(usdc), true, 2000e6);
    }

    function test_Parity_ExactIn_RiskyIn() public view {
        _assertParity(weth, true, 1.3e18);
    }

    function test_Parity_ExactOut_RiskyOut() public view {
        _assertParity(address(usdc), false, 0.7e18);
    }

    function test_Parity_ExactOut_StableOut() public view {
        _assertParity(weth, false, 1500e6);
    }

    // ------------------------------------------------------------------ across the leg's life

    /// @notice Parity is not a property of one block. The curvature is driven by `block.timestamp`, so it
    ///         has to hold at every point of the decay, including inside the settlement branch.
    function test_Parity_HoldsAcrossTheDecay() public {
        uint256 start = block.timestamp;
        uint256[6] memory offsets = [uint256(0), 1 hours, 1 days, 3 days, 6 days, 7 days + 1];
        for (uint256 i = 0; i < offsets.length; ++i) {
            vm.warp(start + offsets[i]);
            _assertParity(address(usdc), true, 4000e6);
        }
    }

    /// @notice Both venues refuse the same trades for the same reason. A size inside the accrued decay
    ///         band reverts on Aqua and on the pool alike; neither venue quietly rounds it to zero.
    function test_Parity_BothRefuseInsideTheSpread() public {
        vm.warp(block.timestamp + 3 days);
        bytes memory td = takerDataFor(order, address(usdc), true);

        vm.expectRevert();
        this.quote(order, 40e6, td);

        vm.expectRevert();
        this.quoteV4(key, !sellWethIsZeroForOne, true, 40e6);

        // And both clear the same larger size, to the wei.
        _assertParity(address(usdc), true, 4000e6);
    }

    function testFuzz_Parity_ExactIn(uint256 amount, uint256 skipSeconds) public {
        amount = bound(amount, 500e6, 8000e6);
        vm.warp(block.timestamp + bound(skipSeconds, 0, 7 days));
        _assertParity(address(usdc), true, amount);
    }

    function testFuzz_Parity_ExactOut(uint256 amount, uint256 skipSeconds) public {
        amount = bound(amount, 0.2e18, 3e18);
        vm.warp(block.timestamp + bound(skipSeconds, 0, 6 days));
        _assertParity(address(usdc), false, amount);
    }

    // ------------------------------------------------------------------

    /// @dev External so the parity check can `try` it and compare failures as well as successes.
    function quoteAqua(address tokenIn, bool exactIn, uint256 amount) public view returns (uint256, uint256) {
        (uint256 amountIn, uint256 amountOut,) =
            ISwapVM(address(sl)).quote(order, amount, takerDataFor(order, tokenIn, exactIn));
        return (amountIn, amountOut);
    }

    /// @dev Quote `amount` on both venues in the same direction and require the OUTCOMES to match, not
    ///      just the happy paths: a size inside the decay band must be refused by both, with the same
    ///      custom error carrying the same shortfall. Anything less would let a venue pass parity by
    ///      quietly widening its spread.
    function _assertParity(address tokenIn, bool exactIn, uint256 amount) internal view {
        bool zeroForOne = (tokenIn == weth) == sellWethIsZeroForOne;

        bool aquaOk;
        uint256 aquaIn;
        uint256 aquaOut;
        bytes memory aquaErr;
        try this.quoteAqua(tokenIn, exactIn, amount) returns (uint256 i, uint256 o) {
            (aquaOk, aquaIn, aquaOut) = (true, i, o);
        } catch (bytes memory e) {
            aquaErr = e;
        }

        bool hookOk;
        uint256 hookIn;
        uint256 hookOut;
        bytes memory hookErr;
        try this.quoteV4(key, zeroForOne, exactIn, amount) returns (uint256 i, uint256 o) {
            (hookOk, hookIn, hookOut) = (true, i, o);
        } catch (bytes memory e) {
            hookErr = e;
        }

        assertEq(hookOk, aquaOk, "one venue accepted a trade the other refused");
        if (aquaOk) {
            assertEq(hookIn, aquaIn, "amountIn differs between venues");
            assertEq(hookOut, aquaOut, "amountOut differs between venues");
        } else {
            assertEq(keccak256(hookErr), keccak256(aquaErr), "venues refused for different reasons");
        }
    }
}
