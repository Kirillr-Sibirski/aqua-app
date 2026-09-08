// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { StrikelineV4Base } from "./StrikelineV4Base.sol";
import { StrikelineHook } from "../../src/hooks/StrikelineHook.sol";
import { RmmPricer } from "../../src/hooks/RmmPricer.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title StrikelineHookTest
/// @notice The v4 port on its own terms: a leg written on a pool prices from RMM-01, decays with the
///         block clock, settles constant-sum at the strike, and refuses what the maker cannot deliver.
contract StrikelineHookTest is StrikelineV4Base {
    uint64 constant SIGMA = 0.6e18;
    uint128 constant K = 2600e18;
    uint128 constant L = 12e18;
    uint256 constant X = 8.41e18;

    uint40 internal maturity;

    function setUp() public override {
        super.setUp();
        maturity = uint40(block.timestamp + 7 days);

        fund(weth, maker, 40e18);
        fund(address(usdc), maker, 120_000e6);
        fund(weth, taker, 50e18);
        fund(address(usdc), taker, 200_000e6);

        approveHook(maker);
        approveSwapRouter(taker);
    }

    function _terms() internal view returns (RmmPricer.Terms memory) {
        return termsFor(K, SIGMA, maturity, L);
    }

    // ------------------------------------------------------------------ the pool holds the leg

    /// @notice A pooled leg is real v4 liquidity: writing it moves the maker's tokens into PoolManager,
    ///         and a swap through the stock `PoolSwapTest` router prices off the option curve.
    function test_Pooled_WriteMovesCustodyAndFillsExactIn() public {
        uint256 makerWethBefore = IERC20(weth).balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        (PoolKey memory key, uint256 usdcReserve) =
            writeLeg(100, _terms(), StrikelineHook.Backing.Pooled, X, maker);

        // Custody moved. This is the line `Aqua.ship` does not have.
        assertEq(IERC20(weth).balanceOf(maker), makerWethBefore - X, "pooled leg must pull WETH from the maker");
        assertEq(usdc.balanceOf(maker), makerUsdcBefore - usdcReserve, "pooled leg must pull USDC from the maker");
        assertEq(IERC20(weth).balanceOf(address(pm)), X, "PoolManager now custodies the risky reserve");
        assertEq(usdc.balanceOf(address(pm)), usdcReserve, "PoolManager now custodies the stable reserve");

        uint256 takerWethBefore = IERC20(weth).balanceOf(taker);
        bool zeroForOne = !wethIsCurrency0; // pay USDC, receive WETH

        (, uint256 quoted) = hook.quoteSwap(key, zeroForOne, true, 2000e6);
        swapV4(taker, key, zeroForOne, -int256(2000e6));

        assertEq(IERC20(weth).balanceOf(taker) - takerWethBefore, quoted, "fill must match the quote exactly");
        assertGt(quoted, 0, "the leg must price");

        StrikelineHook.Leg memory leg = hook.legOf(key);
        assertEq(leg.reserveStable, usdcReserve + 2000e6, "stable reserve must absorb the input");
        assertEq(leg.reserveRisky, X - quoted, "risky reserve must release the output");
        console2.log("v4 pooled: 2000 USDC bought WETH wei:", quoted);
    }

    /// @notice Exact-output works too, which is the direction an aggregator uses when it is filling a
    ///         fixed size for a user.
    function test_Pooled_FillsExactOut() public {
        (PoolKey memory key,) = writeLeg(101, _terms(), StrikelineHook.Backing.Pooled, X, maker);

        bool zeroForOne = !wethIsCurrency0;
        uint256 want = 0.7e18;
        (uint256 quotedIn,) = hook.quoteSwap(key, zeroForOne, false, want);

        uint256 takerUsdcBefore = usdc.balanceOf(taker);
        uint256 takerWethBefore = IERC20(weth).balanceOf(taker);
        swapV4(taker, key, zeroForOne, int256(want));

        assertEq(IERC20(weth).balanceOf(taker) - takerWethBefore, want, "taker must receive exactly what it asked for");
        assertEq(takerUsdcBefore - usdc.balanceOf(taker), quotedIn, "cost must match the quote exactly");
        console2.log("v4 pooled: 0.7 WETH cost USDC:", quotedIn);
    }

    /// @notice Concentrated liquidity is refused. A v3-shaped position in this pool would be reserves the
    ///         option curve does not know about and cannot price.
    function test_Pooled_RefusesConcentratedLiquidity() public {
        (PoolKey memory key,) = writeLeg(102, _terms(), StrikelineHook.Backing.Pooled, X, maker);

        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(pm);
        vm.startPrank(maker);
        IERC20(weth).approve(address(lpRouter), type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        vm.expectRevert();
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({ tickLower: -600, tickUpper: 600, liquidityDelta: 1e18, salt: bytes32(0) }),
            ""
        );
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ the curve is an option

    /// @notice Time decay alone, with no transaction, makes a previously fillable trade revert: the curve
    ///         has moved away from the reserves and the gap is the accrued theta.
    function test_Theta_DecayOpensASpread() public {
        (PoolKey memory key,) = writeLeg(103, _terms(), StrikelineHook.Backing.Pooled, X, maker);
        bool zeroForOne = !wethIsCurrency0;

        (, uint256 before) = hook.quoteSwap(key, zeroForOne, true, 40e6);
        assertGt(before, 0, "a small trade should clear at t0");

        vm.warp(block.timestamp + 3 days);

        vm.expectRevert();
        this.quoteV4(key, zeroForOne, true, 40e6);

        (, uint256 big) = hook.quoteSwap(key, zeroForOne, true, 4000e6);
        assertGt(big, 0, "a large trade should still clear after decay");
        console2.log("v4: after 3 days, 40 USDC reverts; 4000 USDC returns wei:", big);
    }

    /// @notice After maturity the curve is a constant-sum order at exactly K, and only in the assignment
    ///         direction. Same closed form, same one-way gate as the Aqua leg.
    function test_Expiry_SettlesAtStrikeOneWay() public {
        (PoolKey memory key,) = writeLeg(104, _terms(), StrikelineHook.Backing.Pooled, X, maker);
        bool buyWeth = !wethIsCurrency0;

        vm.warp(uint256(maturity) + 1);

        (, uint256 firstOut) = hook.quoteSwap(key, buyWeth, true, 2600e6);
        assertLt(firstOut, 1e18, "the first taker also pays the accrued theta");
        swapV4(taker, key, buyWeth, -int256(2600e6));

        (, uint256 marginalOut) = hook.quoteSwap(key, buyWeth, true, 2600e6);
        assertApproxEqRel(marginalOut, 1e18, 0.0001e18, "after expiry the marginal price is the strike");
        console2.log("v4: theta paid on first assignment (WETH wei withheld):", 1e18 - firstOut);

        // The other side is closed: an expired leg is not a free two-sided straddle.
        vm.expectRevert(RmmSwap.RmmSettlementOneWay.selector);
        this.quoteV4(key, !buyWeth, true, 1e18);
    }

    /// @notice `quoteSwap` and the executed fill agree for any size the curve accepts.
    function testFuzz_QuoteEqualsFill(uint256 amount) public {
        amount = bound(amount, 500e6, 6000e6);
        (PoolKey memory key,) = writeLeg(105, _terms(), StrikelineHook.Backing.Pooled, X, maker);
        bool zeroForOne = !wethIsCurrency0;

        (, uint256 quoted) = hook.quoteSwap(key, zeroForOne, true, amount);
        uint256 takerWethBefore = IERC20(weth).balanceOf(taker);
        swapV4(taker, key, zeroForOne, -int256(amount));
        assertEq(IERC20(weth).balanceOf(taker) - takerWethBefore, quoted, "quote != fill");
    }

    // ------------------------------------------------------------------ the wallet-backed steelman

    /// @notice A wallet-backed leg pays the taker out of the maker's own wallet, so custody never moves
    ///         at write time. What the maker receives, though, is an ERC-6909 claim inside PoolManager,
    ///         not a token: `take`-ing ERC-20 to them inside `beforeSwap` would spend another pool's
    ///         reserves before the taker has settled. Spending it costs a second transaction.
    function test_Wallet_PaysFromTheWalletButIsPaidInClaims() public {
        uint256 makerWethBefore = IERC20(weth).balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        (PoolKey memory key,) = writeLeg(106, _terms(), StrikelineHook.Backing.Wallet, X, maker);

        assertEq(IERC20(weth).balanceOf(maker), makerWethBefore, "wallet leg must not move WETH at write time");
        assertEq(usdc.balanceOf(maker), makerUsdcBefore, "wallet leg must not move USDC at write time");

        bool zeroForOne = !wethIsCurrency0;
        (, uint256 quoted) = hook.quoteSwap(key, zeroForOne, true, 2000e6);
        swapV4(taker, key, zeroForOne, -int256(2000e6));

        // The output left the maker's wallet as real WETH.
        assertEq(IERC20(weth).balanceOf(maker), makerWethBefore - quoted, "output must come out of the wallet");
        // The input did NOT arrive as USDC. It is a claim.
        assertEq(usdc.balanceOf(maker), makerUsdcBefore, "input does not reach the wallet inside beforeSwap");
        uint256 claimId = uint256(uint160(address(usdc)));
        assertEq(pm.balanceOf(maker, claimId), 2000e6, "the maker holds an ERC-6909 claim instead");

        // A second transaction converts it.
        vm.prank(maker);
        hook.sweep(Currency.wrap(address(usdc)), 2000e6);
        assertEq(usdc.balanceOf(maker), makerUsdcBefore + 2000e6, "sweep must deliver the tokens");
        assertEq(pm.balanceOf(maker, claimId), 0, "claim must be burnt");
    }

    /// @notice The coverage check is the Aqua instruction's own `Coverage.free`, with this hook as the
    ///         spender. A wallet-backed leg therefore refuses depth the wallet cannot deliver, in the same
    ///         call that prices it, instead of reverting later inside a transfer.
    function test_Wallet_RefusesWhatTheWalletCannotDeliver() public {
        (PoolKey memory key,) = writeLeg(107, _terms(), StrikelineHook.Backing.Wallet, X, maker);

        // Move the maker's WETH elsewhere. The leg's reserve ledger is untouched; the wallet is not.
        uint256 drain = IERC20(weth).balanceOf(maker) - 0.05e18;
        vm.prank(maker);
        IERC20(weth).transfer(address(0xdead), drain);
        assertEq(hook.deliverable(maker, weth), 0.05e18, "deliverable must track the real wallet");

        bool zeroForOne = !wethIsCurrency0;
        vm.expectRevert(abi.encodeWithSelector(Coverage.NotCovered.selector, uint256(1e18), uint256(0.05e18)));
        this.quoteV4(key, zeroForOne, false, 1e18);

        // A size inside the remaining wallet still prices.
        (, uint256 small) = hook.quoteSwap(key, zeroForOne, true, 60e6);
        assertLe(small, 0.05e18, "a fill must fit inside real coverage");
        console2.log("v4 wallet-backed: undeliverable size refused, small fill clears wei:", small);
    }

    // ------------------------------------------------------------------ what setup costs

    /// @notice v4 hooks are addressed by their permission bits, so shipping one means grinding CREATE2
    ///         salts until the bottom 14 bits match. Measured here rather than asserted.
    function test_Setup_MiningTheHookAddress() public view {
        (address mined, bytes32 salt) =
            HookMiner.find(address(this), HOOK_FLAGS, type(StrikelineHook).creationCode, abi.encode(pm));
        assertEq(uint160(mined) & 0x3FFF, HOOK_FLAGS, "mined address must carry the flags");
        console2.log("hook address mining: salts tried:", uint256(salt));
        console2.log("hook creation code bytes rehashed per salt:", type(StrikelineHook).creationCode.length + 32);
    }
}
