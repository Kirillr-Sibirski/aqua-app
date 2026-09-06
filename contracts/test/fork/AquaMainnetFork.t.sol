// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { Salt } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { AquaSwapVMTestBase } from "../base/AquaSwapVMTestBase.sol";

/// @title AquaMainnetForkTest
/// @notice Proves ProbeRouter works against the OFFICIAL Aqua deployment with real WETH/USDC on an Ethereum
///         mainnet fork. Skipped unless FORK_RPC_URL is set, e.g.:
///         FORK_RPC_URL=https://ethereum-rpc.publicnode.com forge test --match-path 'test/fork/*' -vv
contract AquaMainnetForkTest is AquaSwapVMTestBase {
    address constant AQUA_MAINNET = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant WETH_MAINNET = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC_MAINNET = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant DAI_MAINNET = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    uint256 constant WETH_LIQ = 10e18;
    uint256 constant USDC_LIQ = 20_000e6;

    bool internal forkEnabled;
    ISwapVM.Order internal order;
    bytes32 internal orderHash;
    bool internal wethIsA;

    modifier onlyFork() {
        vm.skip(!forkEnabled);
        _;
    }

    function setUp() public override {
        string memory url = vm.envOr("FORK_RPC_URL", string(""));
        forkEnabled = bytes(url).length > 0;
        if (!forkEnabled) return; // every test is skipped via `onlyFork`

        vm.createSelectFork(url);
        super.setUp();

        fund(weth, maker, WETH_LIQ);
        fund(address(usdc), maker, USDC_LIQ);

        // Salt with the chain id + block so re-runs on a new block never collide with an already shipped hash.
        order = buildAquaOrder(
            maker, weth, address(usdc), bytes.concat(XYCSwap.build(), Salt.build(abi.encodePacked(block.number)))
        );
        wethIsA = isAToB(order, weth);
        orderHash = wethIsA ? shipOrder(maker, order, WETH_LIQ, USDC_LIQ) : shipOrder(maker, order, USDC_LIQ, WETH_LIQ);

        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);
    }

    // Official deployments instead of fresh mocks.
    function _resolveAqua() internal override returns (IAqua) {
        require(AQUA_MAINNET.code.length > 0, "official Aqua has no code on this fork");
        aquaIsExternal = true;
        return IAqua(AQUA_MAINNET);
    }

    function _resolveWeth() internal pure override returns (address) {
        return WETH_MAINNET;
    }

    function _deployTokens() internal override {
        usdc = IERC20(USDC_MAINNET);
        dai = IERC20(DAI_MAINNET);
    }

    // ------------------------------------------------------------------ tests

    function test_Fork_UsesOfficialAqua() public onlyFork {
        assertEq(address(aqua), AQUA_MAINNET);
        assertGt(AQUA_MAINNET.code.length, 0, "official Aqua bytecode present");
        assertEq(address(router.AQUA()), AQUA_MAINNET, "router wired to official Aqua");
        assertEq(address(router.WETH()), WETH_MAINNET, "router wired to real WETH");
        assertEq(orderHash, router.hash(order));
        (uint256 wethBal, uint256 usdcBal) = aquaSafe(maker, orderHash, weth, address(usdc));
        assertEq(wethBal, WETH_LIQ);
        assertEq(usdcBal, USDC_LIQ);
    }

    function test_Fork_ExactIn_WETHtoUSDC() public onlyFork {
        uint256 amountIn = 1e18;
        fund(weth, taker, amountIn);
        bytes memory td = takerDataFor(order, weth, true);

        (uint256 qIn, uint256 qOut, bytes32 qHash) = quote(order, amountIn, td);
        assertEq(qHash, orderHash);
        assertEq(qIn, amountIn);
        assertEq(qOut, xycOut(WETH_LIQ, USDC_LIQ, amountIn));

        Snapshot memory before = snapshot(order, taker);
        expectSwapped(orderHash, maker, taker, weth, address(usdc), qIn, qOut);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, order, amountIn, td);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(order, taker), wethIsA, sIn, sOut);
    }

    function test_Fork_ExactOut_USDCtoWETH() public onlyFork {
        uint256 amountOut = 0.5e18; // want exactly 0.5 WETH, pay USDC
        bytes memory td = takerDataFor(order, address(usdc), false);
        uint256 expectedIn = xycIn(USDC_LIQ, WETH_LIQ, amountOut);

        (uint256 qIn, uint256 qOut,) = quote(order, amountOut, td);
        assertEq(qOut, amountOut);
        assertEq(qIn, expectedIn);

        fund(address(usdc), taker, qIn);
        Snapshot memory before = snapshot(order, taker);
        expectSwapped(orderHash, maker, taker, address(usdc), weth, qIn, qOut);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, order, amountOut, td);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(order, taker), !wethIsA, sIn, sOut);
        assertEq(IERC20(weth).balanceOf(taker), amountOut);
    }

    function test_Fork_ProbeScale_CustomOpcode() public onlyFork {
        ISwapVM.Order memory scaled = buildAquaOrder(
            maker,
            weth,
            address(usdc),
            bytes.concat(buildProbeScale(2e9), XYCSwap.build(), Salt.build(abi.encodePacked(block.number, uint8(1))))
        );
        bytes32 scaledHash =
            wethIsA ? shipOrder(maker, scaled, WETH_LIQ, USDC_LIQ) : shipOrder(maker, scaled, USDC_LIQ, WETH_LIQ);

        uint256 amountIn = 1e18;
        fund(weth, taker, amountIn);
        bytes memory td = takerDataFor(scaled, weth, true);
        (uint256 qIn, uint256 qOut,) = quote(scaled, amountIn, td);
        assertEq(qOut, xycOut(WETH_LIQ, 2 * USDC_LIQ, amountIn), "custom opcode dispatched on fork");

        Snapshot memory before = snapshot(scaled, taker);
        expectSwapped(scaledHash, maker, taker, weth, address(usdc), qIn, qOut);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, scaled, amountIn, td);
        assertSwapDelta(before, snapshot(scaled, taker), wethIsA, sIn, sOut);
    }

    function test_Fork_Dock_ThenSwapReverts() public onlyFork {
        Snapshot memory before = snapshot(order, taker);
        dockOrder(maker, order);

        (uint248 bal, uint8 count) = aquaRaw(maker, orderHash, weth);
        assertEq(bal, 0);
        assertEq(count, 0xff);

        // Router calls safeBalances(tokenIn, tokenOut): the revert names tokenIn (WETH), regardless of sort order.
        fund(weth, taker, 1e18);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAqua.SafeBalancesForTokenNotInActiveStrategy.selector, maker, address(router), orderHash, weth
            )
        );
        swapAs(taker, order, 1e18, takerDataFor(order, weth, true));

        // Docking is pure accounting on the official Aqua: maker wallet untouched.
        Snapshot memory afterS = snapshot(order, taker);
        assertEq(afterS.makerA, before.makerA);
        assertEq(afterS.makerB, before.makerB);
    }
}
