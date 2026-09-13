// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";
import { FeeProtocol } from "@1inch/swap-vm/src/instructions/FeeProtocol.sol";

import { AquaSwapVMTestBase } from "../base/AquaSwapVMTestBase.sol";
import { StrikelineRouter } from "../../src/StrikelineRouter.sol";
import { ProbeRouter } from "../../src/spikes/ProbeRouter.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title StrikelineProtocolFeeTest
/// @notice A protocol fee on every fill, using 1inch SwapVM's own `FeeProtocol` instruction.
///
///         Program: Deadline . FeeProtocol(tokenIn, 10 bps -> treasury) . Coverage . RmmSwap . Salt
///
///         The fee is charged in the token the taker pays and sent straight to the treasury. The maker's
///         Aqua balance only ever receives the net input, which is exactly the amount the curve priced, so
///         the reserves stay on the curve and the covered-call replication is untouched.
contract StrikelineProtocolFeeTest is AquaSwapVMTestBase {
    StrikelineRouter internal sl;

    uint256 constant WALLET_WETH = 10.4e18;
    uint256 constant WALLET_USDC = 24_850e6;

    uint64 constant SIGMA = 0.6e18;
    uint64 constant RATE_RISKY = 1;
    uint64 constant RATE_STABLE = 1e12;

    uint24 constant FEE_BPS = 10_000; // 0.10% of the taker's input (SwapVM fee units: 1e7 = 100%)
    uint256 constant FEE_SCALE = 1e7;
    address constant TREASURY = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    uint40 internal maturity;

    function setUp() public override {
        super.setUp();
        sl = new StrikelineRouter(address(aqua), weth, address(this), "Strikeline", "1");
        router = ProbeRouter(payable(address(sl)));
        maturity = uint40(block.timestamp + 7 days);

        fund(weth, maker, WALLET_WETH);
        fund(address(usdc), maker, WALLET_USDC);
        fund(weth, taker, 50e18);
        fund(address(usdc), taker, 200_000e6);
        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);
    }

    function _flags() internal view returns (uint8 flags) {
        bool riskyIsA = weth < address(usdc);
        flags = (riskyIsA ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0) | RmmSwap.FLAG_POST_EXPIRY_ONE_WAY
            | RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY;
    }

    function _rmm(uint128 strikeWad, uint128 liquidityWad) internal view returns (bytes memory) {
        return RmmSwap.build(
            RmmSwap.Args({
                flags: _flags(),
                sigmaWad: SIGMA,
                maturity: maturity,
                strikeWad: strikeWad,
                liquidityWad: liquidityWad,
                rateRisky: RATE_RISKY,
                rateStable: RATE_STABLE
            })
        );
    }

    function _fee() internal pure returns (bytes memory) {
        FeeProtocol.ReceiverConfig[] memory receivers = new FeeProtocol.ReceiverConfig[](1);
        receivers[0] = FeeProtocol.ReceiverConfig({ receiver: TREASURY, feeBps: FEE_BPS, surplusBps: 0 });
        return FeeProtocol.build(true, receivers, new FeeProtocol.ProviderConfig[](0), 0);
    }

    function _program(bool withFee, uint128 strikeWad, uint128 liquidityWad, uint64 salt)
        internal
        view
        returns (bytes memory)
    {
        return bytes.concat(
            Deadline.build(uint40(maturity + 30 minutes)),
            withFee ? _fee() : bytes(""),
            Coverage.build(0, 0),
            _rmm(strikeWad, liquidityWad),
            Salt.build(salt)
        );
    }

    function _ship(bool withFee, uint128 strikeWad, uint128 liquidityWad, uint256 xWad, uint64 salt)
        internal
        returns (ISwapVM.Order memory order)
    {
        order = buildAquaOrder(maker, weth, address(usdc), _program(withFee, strikeWad, liquidityWad, salt));
        uint256 yWad = sl.stableFor(strikeWad, SIGMA, maturity, liquidityWad, xWad);
        (address a,) = orderTokens(order);
        (uint256 amountA, uint256 amountB) = a == weth ? (xWad, yWad / RATE_STABLE) : (yWad / RATE_STABLE, xWad);
        shipOrder(maker, order, amountA, amountB);
    }

    /// @notice The fee goes to the treasury, the maker gets the rest, and quote() == swap().
    function test_Fee_GoesToTreasury_QuoteEqualsSwap() public {
        ISwapVM.Order memory order = _ship(true, 2600e18, 12e18, 8.41e18, 1);
        bytes memory td = takerDataFor(order, address(usdc), true);

        uint256 treasuryBefore = usdc.balanceOf(TREASURY);
        uint256 makerBefore = usdc.balanceOf(maker);

        (uint256 qIn, uint256 qOut,) = quote(order, 2000e6, td);
        (uint256 sIn, uint256 sOut,) = swapAs(taker, order, 2000e6, td);

        assertEq(sIn, qIn, "quote amountIn != swap amountIn");
        assertEq(sOut, qOut, "quote amountOut != swap amountOut");

        uint256 fee = uint256(2000e6) * FEE_BPS / FEE_SCALE;
        assertEq(usdc.balanceOf(TREASURY), treasuryBefore + fee, "treasury did not receive 0.10%");
        assertEq(usdc.balanceOf(maker), makerBefore + 2000e6 - fee, "maker must receive the input net of the fee");
        console2.log("fee to treasury (USDC 6dp):", fee);
    }

    /// @notice Apart from the fee, the maker is paid exactly what a fee-less leg would pay for the net input:
    ///         same output, same reserves afterwards, so the curve and its premium are unchanged.
    function test_Fee_LeavesTheCurveAndPremiumUnchanged() public {
        ISwapVM.Order memory withFee = _ship(true, 2600e18, 12e18, 8.41e18, 2);
        ISwapVM.Order memory noFee = _ship(false, 2600e18, 12e18, 8.41e18, 3);

        uint256 gross = 3000e6;
        uint256 net = gross - gross * FEE_BPS / FEE_SCALE;

        (, uint256 outWithFee,) = swapAs(taker, withFee, gross, takerDataFor(withFee, address(usdc), true));
        (, uint256 outNoFee,) = swapAs(taker, noFee, net, takerDataFor(noFee, address(usdc), true));
        assertEq(outWithFee, outNoFee, "fee leg must price the net input exactly like a fee-less leg");

        (uint256 feeRisky, uint256 feeStable) = _reserves(withFee);
        (uint256 plainRisky, uint256 plainStable) = _reserves(noFee);
        assertEq(feeRisky, plainRisky, "risky reserve drifted");
        assertEq(feeStable, plainStable, "stable reserve drifted: the fee leaked into the curve");

        // Settlement at expiry is the same constant-sum order on both legs.
        vm.warp(maturity + 1);
        bytes memory outRisky = takerDataFor(noFee, address(usdc), false);
        (uint256 inNoFee,,) = quote(noFee, 0.5e18, outRisky);
        (uint256 inWithFee,,) = quote(withFee, 0.5e18, takerDataFor(withFee, address(usdc), false));
        assertApproxEqAbs(inWithFee, inNoFee + inNoFee * FEE_BPS / (FEE_SCALE - FEE_BPS), 1, "expiry settlement differs beyond the fee");
    }

    /// @notice Coverage still refuses a fill the wallet cannot deliver, with the fee in the program.
    function test_Fee_CoverageStillRefusesUndeliverableSize() public {
        // Over-allocate: two legs of ~9 WETH each against a 10.4 WETH wallet, then drain it with one fill.
        ISwapVM.Order memory leg1 = _ship(true, 2600e18, 12e18, 8.41e18, 4);
        ISwapVM.Order memory leg2 = _ship(true, 2800e18, 10e18, 9.22e18, 5);

        swapAs(taker, leg1, 5e18, takerDataFor(leg1, address(usdc), false));
        uint256 free = sl.coverage(maker, weth);
        assertLt(free, 6e18, "wallet should now be below the probe");

        vm.expectRevert(abi.encodeWithSelector(Coverage.NotCovered.selector, 6e18, free));
        this.quote(leg2, 6e18, takerDataFor(leg2, address(usdc), false));
    }

    function _reserves(ISwapVM.Order memory order) internal view returns (uint256 risky, uint256 stable) {
        bytes32 h = router.hash(order);
        (risky,) = aqua.rawBalances(maker, address(router), h, weth);
        (stable,) = aqua.rawBalances(maker, address(router), h, address(usdc));
    }
}
