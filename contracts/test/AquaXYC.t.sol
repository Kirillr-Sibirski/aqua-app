// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { FeeFlatIn } from "@1inch/swap-vm/src/instructions/FeeFlat.sol";
import { Salt } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { ProbeScale } from "../src/instructions/ProbeScale.sol";
import { MockCallbackTaker } from "../src/mocks/MockCallbackTaker.sol";
import { AquaSwapVMTestBase } from "./base/AquaSwapVMTestBase.sol";

/// @title AquaXYCTest
/// @notice End-to-end: ship an XYC (constant-product) WETH/USDC strategy into Aqua under ProbeRouter and trade it.
contract AquaXYCTest is AquaSwapVMTestBase {
    using OpcodeOps for Opcode;

    uint256 constant WETH_LIQ = 10e18;
    uint256 constant USDC_LIQ = 20_000e6;
    uint24 constant FEE_BPS = 30_000; // 0.3% (FeeFlatIn.BPS == 1e7)

    ISwapVM.Order internal order;
    bytes32 internal orderHash;
    bool internal wethIsA;

    function setUp() public virtual override {
        super.setUp();

        // Aqua.ship never moves tokens: the maker's WALLET must hold the liquidity and approve Aqua.
        fund(weth, maker, WETH_LIQ);
        fund(address(usdc), maker, USDC_LIQ);

        order = buildAquaOrder(maker, weth, address(usdc), bytes.concat(XYCSwap.build(), Salt.build(uint64(1))));
        wethIsA = isAToB(order, weth);
        orderHash = _shipWethUsdc(order);

        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _shipWethUsdc(ISwapVM.Order memory o) internal returns (bytes32) {
        return wethIsA ? shipOrder(maker, o, WETH_LIQ, USDC_LIQ) : shipOrder(maker, o, USDC_LIQ, WETH_LIQ);
    }

    function _liquidity(bytes32 h, address tokenIn, address tokenOut) internal view returns (uint256, uint256) {
        return aquaSafe(maker, h, tokenIn, tokenOut);
    }

    // ------------------------------------------------------------------ shipping

    function test_ShipMatchesRouterHash() public view {
        assertEq(orderHash, router.hash(order));
        assertEq(orderHash, keccak256(abi.encode(order)));

        (uint256 wethBal, uint256 usdcBal) = _liquidity(orderHash, weth, address(usdc));
        assertEq(wethBal, WETH_LIQ, "aqua WETH virtual balance");
        assertEq(usdcBal, USDC_LIQ, "aqua USDC virtual balance");

        (, uint8 count) = aquaRaw(maker, orderHash, weth);
        assertEq(count, 2, "tokensCount");

        // Virtual balances are allowances: nothing left the maker wallet and Aqua holds nothing.
        assertEq(IERC20(weth).balanceOf(maker), WETH_LIQ);
        assertEq(usdc.balanceOf(maker), USDC_LIQ);
        assertEq(IERC20(weth).balanceOf(address(aqua)), 0);
        assertEq(usdc.balanceOf(address(aqua)), 0);
    }

    function test_ShipSameStrategyTwice_Reverts() public {
        address[] memory tokens = new address[](1);
        tokens[0] = weth;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1;
        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(IAqua.StrategiesMustBeImmutable.selector, address(router), orderHash));
        aqua.ship(address(router), abi.encode(order), tokens, amounts);
    }

    // ------------------------------------------------------------------ swaps

    function test_ExactIn_WETHtoUSDC() public {
        uint256 amountIn = 1e18;
        fund(weth, taker, amountIn);
        bytes memory td = takerDataFor(order, weth, true);

        (uint256 qIn, uint256 qOut, bytes32 qHash) = quote(order, amountIn, td);
        assertEq(qHash, orderHash);
        assertEq(qIn, amountIn);
        assertEq(qOut, xycOut(WETH_LIQ, USDC_LIQ, amountIn), "quote amountOut");
        assertEq(qOut, 1_818_181_818, "1 WETH -> 1818.181818 USDC");

        Snapshot memory before = snapshot(order, taker);
        expectSwapped(orderHash, maker, taker, weth, address(usdc), qIn, qOut);
        (uint256 sIn, uint256 sOut, bytes32 sHash) = swapAs(taker, order, amountIn, td);

        assertEq(sHash, orderHash);
        assertEq(sIn, qIn, "swap amountIn == quote");
        assertEq(sOut, qOut, "swap amountOut == quote");
        assertSwapDelta(before, snapshot(order, taker), wethIsA, sIn, sOut);
    }

    function test_ExactOut_WETHtoUSDC() public {
        uint256 amountOut = 1_000e6;
        uint256 expectedIn = xycIn(WETH_LIQ, USDC_LIQ, amountOut);
        fund(weth, taker, expectedIn);
        bytes memory td = takerDataFor(order, weth, false);

        (uint256 qIn, uint256 qOut,) = quote(order, amountOut, td);
        assertEq(qOut, amountOut);
        assertEq(qIn, expectedIn, "quote amountIn");

        Snapshot memory before = snapshot(order, taker);
        expectSwapped(orderHash, maker, taker, weth, address(usdc), qIn, qOut);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, order, amountOut, td);

        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(order, taker), wethIsA, sIn, sOut);
        assertEq(IERC20(weth).balanceOf(taker), 0, "taker spent exactly the quoted WETH");
    }

    function test_ExactIn_USDCtoWETH() public {
        uint256 amountIn = 2_000e6;
        fund(address(usdc), taker, amountIn);
        bytes memory td = takerDataFor(order, address(usdc), true);

        (uint256 qIn, uint256 qOut,) = quote(order, amountIn, td);
        assertEq(qIn, amountIn);
        assertEq(qOut, xycOut(USDC_LIQ, WETH_LIQ, amountIn), "quote amountOut");

        Snapshot memory before = snapshot(order, taker);
        expectSwapped(orderHash, maker, taker, address(usdc), weth, qIn, qOut);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, order, amountIn, td);

        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(order, taker), !wethIsA, sIn, sOut);
    }

    function test_SecondSwapPricesOffUpdatedVirtualBalances() public {
        uint256 amountIn = 1e18;
        fund(weth, taker, 2 * amountIn);
        bytes memory td = takerDataFor(order, weth, true);

        (, uint256 out1,) = swapAs(taker, order, amountIn, td);
        (uint256 wethBal, uint256 usdcBal) = _liquidity(orderHash, weth, address(usdc));
        assertEq(wethBal, WETH_LIQ + amountIn);
        assertEq(usdcBal, USDC_LIQ - out1);

        (, uint256 q2,) = quote(order, amountIn, td);
        assertEq(q2, xycOut(wethBal, usdcBal, amountIn), "second quote uses post-swap Aqua balances");
        assertLt(q2, out1, "price moved against the taker");

        (, uint256 out2,) = swapAs(taker, order, amountIn, td);
        assertEq(out2, q2);
    }

    function testFuzz_QuoteEqualsSwap(uint256 amountIn) public {
        amountIn = bound(amountIn, 1e12, 5e18);
        fund(weth, taker, amountIn);
        bytes memory td = takerDataFor(order, weth, true);

        (uint256 qIn, uint256 qOut,) = quote(order, amountIn, td);
        Snapshot memory before = snapshot(order, taker);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, order, amountIn, td);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(order, taker), wethIsA, sIn, sOut);
    }

    // ------------------------------------------------------------------ taker traits

    function test_Threshold_MinOut() public {
        uint256 amountIn = 1e18;
        fund(weth, taker, amountIn);
        (, uint256 qOut,) = quote(order, amountIn, takerDataFor(order, weth, true));

        bytes memory tooStrict = takerData(true, wethIsA, qOut + 1, address(0), true);
        vm.expectRevert(
            abi.encodeWithSelector(TakerTraitsLib.TakerTraitsInsufficientMinOutputAmount.selector, qOut, qOut + 1)
        );
        swapAs(taker, order, amountIn, tooStrict);

        bytes memory exact = takerData(true, wethIsA, qOut, address(0), true);
        (, uint256 sOut,) = swapAs(taker, order, amountIn, exact);
        assertEq(sOut, qOut);
    }

    function test_Threshold_MaxIn_ExactOut() public {
        uint256 amountOut = 500e6;
        (uint256 qIn,,) = quote(order, amountOut, takerDataFor(order, weth, false));
        fund(weth, taker, qIn);

        bytes memory tooStrict = takerData(false, wethIsA, qIn - 1, address(0), true);
        vm.expectRevert(
            abi.encodeWithSelector(TakerTraitsLib.TakerTraitsExceedingMaxInputAmount.selector, qIn, qIn - 1)
        );
        swapAs(taker, order, amountOut, tooStrict);

        (uint256 sIn,,) = swapAs(taker, order, amountOut, takerData(false, wethIsA, qIn, address(0), true));
        assertEq(sIn, qIn);
    }

    function test_ToRecipient() public {
        address recipient = makeAddr("recipient");
        uint256 amountIn = 1e18;
        fund(weth, taker, amountIn);

        (, uint256 sOut,) = swapAs(taker, order, amountIn, takerData(true, wethIsA, 0, recipient, true));
        assertEq(usdc.balanceOf(recipient), sOut, "tokenOut delivered to `to`");
        assertEq(usdc.balanceOf(taker), 0);
    }

    function test_TakerWithoutRouterApproval_Reverts() public {
        address stranger = makeAddr("stranger");
        fund(weth, stranger, 1e18);
        vm.expectRevert();
        swapAs(stranger, order, 1e18, takerDataFor(order, weth, true));
    }

    function test_CallbackTakerMode() public {
        MockCallbackTaker cb = new MockCallbackTaker(aqua, address(router));
        uint256 amountIn = 1e18;
        fund(weth, address(cb), amountIn); // no router approval needed: taker pushes into Aqua itself
        bytes memory td = takerDataWithCallback(address(cb), true, wethIsA);

        (, uint256 qOut,) = quote(order, amountIn, td);
        Snapshot memory before = snapshot(order, address(cb));
        (uint256 sIn, uint256 sOut,) = cb.swap(order, amountIn, td);
        assertEq(sIn, amountIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(order, address(cb)), wethIsA, sIn, sOut);
    }

    // ------------------------------------------------------------------ FeeFlatIn + XYC

    function test_FeeFlatIn_XYC() public {
        ISwapVM.Order memory feeOrder = buildAquaOrder(
            maker, weth, address(usdc), bytes.concat(FeeFlatIn.build(FEE_BPS), XYCSwap.build(), Salt.build(uint64(2)))
        );
        bytes32 feeHash = _shipWethUsdc(feeOrder);
        assertTrue(feeHash != orderHash, "distinct strategy");

        uint256 amountIn = 1e18;
        fund(weth, taker, amountIn);
        bytes memory td = takerDataFor(feeOrder, weth, true);

        uint256 fee = (amountIn * FEE_BPS + FeeFlatIn.BPS - 1) / FeeFlatIn.BPS;
        uint256 expectedOut = xycOut(WETH_LIQ, USDC_LIQ, amountIn - fee);

        (uint256 qIn, uint256 qOut,) = quote(feeOrder, amountIn, td);
        assertEq(qIn, amountIn, "taker still pays the full amountIn (fee stays with the maker)");
        assertEq(qOut, expectedOut, "amountOut computed on amountIn net of 0.3% fee");
        assertLt(qOut, xycOut(WETH_LIQ, USDC_LIQ, amountIn), "less than the fee-less curve");

        Snapshot memory before = snapshot(feeOrder, taker);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, feeOrder, amountIn, td);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(feeOrder, taker), wethIsA, sIn, sOut);
    }

    // ------------------------------------------------------------------ custom opcode (ProbeScale @ 0xd0)

    function test_ProbeScale_OpcodeIsD0() public pure {
        assertEq(ProbeScale.opcode.asU8(), 0xd0);
        // encoding: [opcode][argsLen][uint32 factor big-endian]
        bytes memory ins = buildProbeScale(2e9);
        assertEq(ins.length, InstructionBuilder.sizeOf() + 4);
        assertEq(ins, hex"d0_04_77359400", "0xd0, len=4, 2e9");
    }

    function test_ProbeScale_CustomOpcode_ExactIn() public {
        // ProbeScale(2e9) doubles balanceOut before XYCSwap runs => quotes as if the pool held 40,000 USDC.
        ISwapVM.Order memory scaled = buildAquaOrder(
            maker, weth, address(usdc), bytes.concat(buildProbeScale(2e9), XYCSwap.build(), Salt.build(uint64(3)))
        );
        bytes32 scaledHash = _shipWethUsdc(scaled);

        uint256 amountIn = 1e18;
        fund(weth, taker, amountIn);
        bytes memory td = takerDataFor(scaled, weth, true);

        uint256 expectedOut = xycOut(WETH_LIQ, 2 * USDC_LIQ, amountIn);
        (uint256 qIn, uint256 qOut,) = quote(scaled, amountIn, td);
        assertEq(qIn, amountIn);
        assertEq(qOut, expectedOut, "custom opcode scaled balanceOut x2");
        assertEq(qOut, 3_636_363_636);

        Snapshot memory before = snapshot(scaled, taker);
        expectSwapped(scaledHash, maker, taker, weth, address(usdc), qIn, qOut);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, scaled, amountIn, td);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        // Real settlement still happens against the true Aqua balances / maker wallet.
        assertSwapDelta(before, snapshot(scaled, taker), wethIsA, sIn, sOut);
    }

    function test_ProbeScale_CustomOpcode_ExactOut() public {
        // ProbeScale(5e8) halves balanceOut => exactOut costs more than on the plain curve.
        ISwapVM.Order memory scaled = buildAquaOrder(
            maker, weth, address(usdc), bytes.concat(buildProbeScale(5e8), XYCSwap.build(), Salt.build(uint64(4)))
        );
        _shipWethUsdc(scaled);

        uint256 amountOut = 1_000e6;
        bytes memory td = takerDataFor(scaled, weth, false);
        uint256 expectedIn = xycIn(WETH_LIQ, USDC_LIQ / 2, amountOut);

        (uint256 qIn, uint256 qOut,) = quote(scaled, amountOut, td);
        assertEq(qOut, amountOut);
        assertEq(qIn, expectedIn, "custom opcode scaled balanceOut x0.5");
        assertGt(qIn, xycIn(WETH_LIQ, USDC_LIQ, amountOut));

        fund(weth, taker, qIn);
        Snapshot memory before = snapshot(scaled, taker);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, scaled, amountOut, td);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(scaled, taker), wethIsA, sIn, sOut);
    }

    function test_UnknownOpcode_FallsThroughToAquaOpcodes() public {
        // 0xd1 is not ProbeScale and not in AquaOpcodes => ProbeRouter._runOpcode -> super._runOpcode -> UnknownOpcode
        ISwapVM.Order memory bad = buildAquaOrder(
            maker, weth, address(usdc), bytes.concat(rawInstruction(Opcode._d1), XYCSwap.build())
        );
        _shipWethUsdc(bad);

        bytes memory td = takerDataFor(bad, weth, true);
        vm.expectRevert(abi.encodeWithSelector(AquaOpcodes.UnknownOpcode.selector, uint256(0xd1)));
        quote(bad, 1e18, td);

        fund(weth, taker, 1e18);
        vm.expectRevert(abi.encodeWithSelector(AquaOpcodes.UnknownOpcode.selector, uint256(0xd1)));
        swapAs(taker, bad, 1e18, td);
    }

    // ------------------------------------------------------------------ dock

    function test_Dock_PartialTokenList_Reverts() public {
        address[] memory onlyWeth = new address[](1);
        onlyWeth[0] = weth;
        vm.prank(maker);
        vm.expectRevert(
            abi.encodeWithSelector(IAqua.DockingShouldCloseAllTokens.selector, address(router), orderHash)
        );
        aqua.dock(address(router), orderHash, onlyWeth);
    }

    function test_Dock_ZeroesVirtualBalancesAndBlocksSwaps() public {
        // Trade once so the strategy has non-initial balances, then dock.
        uint256 amountIn = 1e18;
        fund(weth, taker, 2 * amountIn);
        bytes memory td = takerDataFor(order, weth, true);
        swapAs(taker, order, amountIn, td);

        Snapshot memory before = snapshot(order, taker);
        assertGt(before.aquaA, 0);
        assertGt(before.aquaB, 0);
        assertEq(before.tokensCountA, 2);

        (address tokenA, address tokenB) = orderTokens(order);
        vm.expectEmit(address(aqua));
        emit IAqua.Docked(maker, address(router), orderHash);
        dockOrder(maker, order);

        Snapshot memory afterS = snapshot(order, taker);
        // rawBalances: virtual balances zeroed, tokensCount set to the DOCKED marker (0xff).
        assertEq(afterS.aquaA, 0, "docked tokenA virtual balance");
        assertEq(afterS.aquaB, 0, "docked tokenB virtual balance");
        assertEq(afterS.tokensCountA, 0xff, "DOCKED marker A");
        assertEq(afterS.tokensCountB, 0xff, "DOCKED marker B");
        // Docking is pure accounting: the maker wallet did not move.
        assertEq(afterS.makerA, before.makerA);
        assertEq(afterS.makerB, before.makerB);

        // safeBalances (used by the router) reverts for a docked strategy; it names the FIRST token it checks...
        vm.expectRevert(
            abi.encodeWithSelector(
                IAqua.SafeBalancesForTokenNotInActiveStrategy.selector, maker, address(router), orderHash, tokenA
            )
        );
        aqua.safeBalances(maker, address(router), orderHash, tokenA, tokenB);

        // ...and the router calls safeBalances(tokenIn, tokenOut), so quote and swap revert naming tokenIn (WETH).
        bytes memory errTokenIn = abi.encodeWithSelector(
            IAqua.SafeBalancesForTokenNotInActiveStrategy.selector, maker, address(router), orderHash, weth
        );
        vm.expectRevert(errTokenIn);
        quote(order, amountIn, td);
        vm.expectRevert(errTokenIn);
        swapAs(taker, order, amountIn, td);

        // A docked strategy can never be re-shipped (tokensCount != 0).
        address[] memory tokens = new address[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;
        uint256[] memory amounts = new uint256[](2);
        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(IAqua.StrategiesMustBeImmutable.selector, address(router), orderHash));
        aqua.ship(address(router), abi.encode(order), tokens, amounts);

        // The maker can ship a NEW strategy (different salt => different hash) and trading resumes.
        ISwapVM.Order memory fresh =
            buildAquaOrder(maker, weth, address(usdc), bytes.concat(XYCSwap.build(), Salt.build(uint64(99))));
        _shipWethUsdc(fresh);
        (, uint256 out2,) = swapAs(taker, fresh, amountIn, takerDataFor(fresh, weth, true));
        assertGt(out2, 0);
    }
}
