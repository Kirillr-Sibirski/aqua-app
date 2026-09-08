// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { AquaSwapVMTestBase } from "../base/AquaSwapVMTestBase.sol";
import { ProbeRouter } from "../../src/spikes/ProbeRouter.sol";
import { StrikelineRouter } from "../../src/StrikelineRouter.sol";
import { StrikelineHook } from "../../src/hooks/StrikelineHook.sol";
import { RmmPricer } from "../../src/hooks/RmmPricer.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title StrikelineV4Base
/// @notice Both venues in one fixture: the Aqua registry + Strikeline router from `AquaSwapVMTestBase`,
///         and a real Uniswap v4 `PoolManager` with `StrikelineHook` on top of it, sharing the same WETH
///         and USDC mocks. Any test can therefore price the identical leg on both and diff the numbers.
///
/// @dev The PoolManager is deployed from the bytecode the `@uniswap/v4-core` npm package ships, not
///      compiled here: v4-core pins `PoolManager.sol` to `pragma solidity 0.8.26;` exactly, so no file on
///      our own `0.8.30` pin can import it, and it does not survive our `optimizer_runs = 700` either.
///      `deployCode` on their artifact runs the tests against Uniswap's own canonical build.
abstract contract StrikelineV4Base is AquaSwapVMTestBase {
    IPoolManager internal pm;
    PoolSwapTest internal swapRouter;
    StrikelineHook internal hook;
    StrikelineRouter internal sl;

    /// @dev Bottom 14 bits: beforeSwap (1<<7) | beforeSwapReturnsDelta (1<<3) | beforeAddLiquidity (1<<11).
    uint160 internal constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

    /// @dev A hook address carrying exactly `HOOK_FLAGS`. Production mines one with CREATE2; the fixture
    ///      etches to a fixed one so 30 tests do not pay for 30 grinds. `test_Setup_MiningTheHookAddress`
    ///      measures what the grind actually costs.
    address internal constant HOOK_ADDRESS = address(uint160(0x5111000000000000000000000000000000000888));

    /// @dev sqrt(1) in Q64.96: tick zero. The pool's own price never moves, because the hook consumes
    ///      every swap before `Pool.swap` sees a non-zero amount.
    uint160 internal constant SQRT_PRICE_1_1 = 79_228_162_514_264_337_593_543_950_336;

    Currency internal currency0;
    Currency internal currency1;
    bool internal wethIsCurrency0;

    function setUp() public virtual override {
        super.setUp();

        // Venue A: the Strikeline router settling through the Aqua registry the base fixture deployed.
        sl = new StrikelineRouter(address(aqua), weth, address(this), "Strikeline", "1");
        vm.label(address(sl), "StrikelineRouter");
        router = ProbeRouter(payable(address(sl)));

        // Venue B: a canonical Uniswap v4 PoolManager with the hook on top.
        pm = IPoolManager(
            deployCode("node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json", abi.encode(address(this)))
        );
        vm.label(address(pm), "PoolManager");

        swapRouter = new PoolSwapTest(pm);
        vm.label(address(swapRouter), "PoolSwapTest");

        deployCodeTo("StrikelineHook.sol:StrikelineHook", abi.encode(pm), HOOK_ADDRESS);
        hook = StrikelineHook(HOOK_ADDRESS);
        vm.label(HOOK_ADDRESS, "StrikelineHook");
        assertEq(uint160(HOOK_ADDRESS) & Hooks.ALL_HOOK_MASK, HOOK_FLAGS, "hook address must carry its flags");

        wethIsCurrency0 = weth < address(usdc);
        (currency0, currency1) = wethIsCurrency0
            ? (Currency.wrap(weth), Currency.wrap(address(usdc)))
            : (Currency.wrap(address(usdc)), Currency.wrap(weth));
    }

    // ------------------------------------------------------------------ pool plumbing

    /// @notice One pool per leg. `fee` and `tickSpacing` carry no economic meaning here - they are the
    ///         only fields of a `PoolKey` a maker can vary, so a ladder burns them as a nonce.
    function poolKeyFor(uint24 nonce) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: nonce,
            tickSpacing: 60,
            hooks: IHooks(HOOK_ADDRESS)
        });
    }

    function initPool(PoolKey memory key) internal {
        pm.initialize(key, SQRT_PRICE_1_1);
    }

    /// @notice Approvals a maker needs before writing a leg through the hook.
    /// @dev Two ERC-20 allowances to the HOOK, which is bespoke code, where the Aqua leg approves the
    ///      canonical registry. Wallet-backed legs also need `setOperator` so `sweep` can burn the
    ///      ERC-6909 claims a fill pays them.
    function approveHook(address who) internal {
        vm.startPrank(who);
        IERC20(weth).approve(HOOK_ADDRESS, type(uint256).max);
        usdc.approve(HOOK_ADDRESS, type(uint256).max);
        pm.setOperator(HOOK_ADDRESS, true);
        vm.stopPrank();
    }

    function approveSwapRouter(address who) internal {
        vm.startPrank(who);
        IERC20(weth).approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ leg construction

    /// @notice The terms both venues share. WETH is the risky asset, USDC (6 decimals) the stable one,
    ///         so the stable rate lifts it into the curve's normalised WAD space.
    function termsFor(
        uint128 strikeWad,
        uint64 sigmaWad,
        uint40 maturity,
        uint128 liquidityWad
    )
        internal
        pure
        returns (RmmPricer.Terms memory)
    {
        return RmmPricer.Terms({
            maturity: maturity,
            sigmaWad: sigmaWad,
            strikeWad: strikeWad,
            liquidityWad: liquidityWad,
            rateRisky: 1,
            rateStable: 1e12,
            oneWayAfterExpiry: true,
            assignmentPaysRisky: true
        });
    }

    function legFor(
        RmmPricer.Terms memory t,
        StrikelineHook.Backing backing
    )
        internal
        view
        returns (StrikelineHook.Leg memory leg)
    {
        leg.backing = backing;
        leg.riskyIsCurrency0 = wethIsCurrency0;
        leg.maturity = t.maturity;
        leg.sigmaWad = t.sigmaWad;
        leg.strikeWad = t.strikeWad;
        leg.liquidityWad = t.liquidityWad;
        leg.rateRisky = t.rateRisky;
        leg.rateStable = t.rateStable;
        leg.oneWayAfterExpiry = t.oneWayAfterExpiry;
        leg.assignmentPaysRisky = t.assignmentPaysRisky;
    }

    /// @notice Write a leg on a fresh pool, with the stable reserve the chain itself says is on the curve.
    /// @param xWad Risky reserve in WETH units (18 decimals); it picks the moneyness.
    /// @return key The pool the leg lives on.
    /// @return usdcReserve The stable reserve in USDC units.
    function writeLeg(
        uint24 nonce,
        RmmPricer.Terms memory t,
        StrikelineHook.Backing backing,
        uint256 xWad,
        address maker_
    )
        internal
        returns (PoolKey memory key, uint256 usdcReserve)
    {
        key = poolKeyFor(nonce);
        initPool(key);
        usdcReserve = hook.stableFor(t, xWad) / t.rateStable;
        vm.prank(maker_);
        hook.write(key, legFor(t, backing), xWad, usdcReserve);
    }

    // ------------------------------------------------------------------ the same leg, on Aqua

    /// @notice The Aqua program for the identical leg: `Coverage . RmmSwap . Salt`, or bare `RmmSwap`
    ///         when the comparison is meant to be curve against curve with no solvency guard.
    function aquaProgram(
        RmmPricer.Terms memory t,
        uint64 salt,
        bool withCoverage
    )
        internal
        view
        returns (bytes memory)
    {
        uint8 flags = (wethIsCurrency0 ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0);
        if (t.oneWayAfterExpiry) {
            flags |= RmmSwap.FLAG_POST_EXPIRY_ONE_WAY;
        }
        if (t.assignmentPaysRisky) {
            flags |= RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY;
        }
        bytes memory curve = RmmSwap.build(
            RmmSwap.Args({
                flags: flags,
                sigmaWad: t.sigmaWad,
                maturity: t.maturity,
                strikeWad: t.strikeWad,
                liquidityWad: t.liquidityWad,
                rateRisky: t.rateRisky,
                rateStable: t.rateStable
            })
        );
        return withCoverage
            ? bytes.concat(Coverage.build(0, 0), curve, Salt.build(salt))
            : bytes.concat(curve, Salt.build(salt));
    }

    /// @notice Ship the identical leg through the official Aqua registry.
    /// @dev `stableFor` is asked of the chain, not computed off-chain: one wei low and every quote
    ///      reverts for good, one wei high and the surplus goes to the first taker.
    function shipAquaLeg(
        RmmPricer.Terms memory t,
        uint256 xWad,
        uint64 salt,
        bool withCoverage,
        address maker_
    )
        internal
        returns (ISwapVM.Order memory order, uint256 usdcReserve)
    {
        order = buildAquaOrder(maker_, weth, address(usdc), aquaProgram(t, salt, withCoverage));
        usdcReserve = sl.stableFor(t.strikeWad, t.sigmaWad, t.maturity, t.liquidityWad, xWad) / t.rateStable;
        (address a,) = orderTokens(order);
        (uint256 amountA, uint256 amountB) = a == weth ? (xWad, usdcReserve) : (usdcReserve, xWad);
        shipOrder(maker_, order, amountA, amountB);
    }

    // ------------------------------------------------------------------ swapping

    /// @notice Swap through the official `PoolSwapTest` router, i.e. the same path any v4 integrator uses.
    /// @param amountSpecified Negative for exact input, positive for exact output.
    function swapV4(
        address who,
        PoolKey memory key,
        bool zeroForOne,
        int256 amountSpecified
    )
        internal
        returns (BalanceDelta delta)
    {
        vm.prank(who);
        delta = swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                // Unread: the hook cancels `amountSpecified`, and `Pool.swap` returns on a zero amount
                // before it ever checks the limit.
                sqrtPriceLimitX96: zeroForOne ? SQRT_PRICE_1_1 - 1 : SQRT_PRICE_1_1 + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
    }

    /// @dev External wrapper so `vm.expectRevert` placed immediately before behaves.
    function quoteV4(
        PoolKey memory key,
        bool zeroForOne,
        bool exactIn,
        uint256 amount
    )
        public
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        return hook.quoteSwap(key, zeroForOne, exactIn, amount);
    }
}
