// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { FeeProtocol } from "@1inch/swap-vm/src/instructions/FeeProtocol.sol";

import { StrikelineLeg } from "./StrikelineLeg.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title CoverageObligationTest
/// @notice Exactly what `Coverage` counts as the maker's obligation when a protocol fee is in the program.
///
/// @dev THE CLAIM. With `FeeProtocol` in `tokenOut` mode the maker pays twice out of the same wallet, and the
///      two payments are made by two different pieces of SwapVM:
///
///        `_transferOut`               -> `amountOut` to the taker
///        `resolveOutAquaPullMaker`    -> `Aqua.pull(maker, hash, tokenOut, fee, receiver)` for the fee
///
///      Neither is a `try`. So the maker's real obligation is `amountOut + feeTotal`, which is the GROSS
///      output of the curve, while `quote` returns the NET the taker receives. A solvency guard that checked
///      `amountOut` alone would wave through a wallet holding exactly the net, and the fill would then revert
///      inside the fee pull with a ledger panic or `SafeTransferFromFailed` — the exact failure the guard
///      exists to prevent, one instruction later and with a far worse error.
///
///      `Coverage.exec` therefore adds `ctx.fee.feeTotal` when `FeeMetaLib.decodeIsTokenOut(ctx.fee.meta)`,
///      and deliberately does not when the fee is in `tokenIn`, because that side is paid by the taker.
///      That is the line separating this instruction from a naive `balanceOf` check, and until this file
///      existed it was the one branch in `Coverage.exec` that no test executed.
///
///      THE CONTROL. Every fee figure below is observed, not computed from the instruction under test: the
///      same leg is shipped a second time with no `FeeProtocol` at all, and since the curve, the reserves and
///      `amountIn` are identical, that leg's `amountOut` IS the gross the fee leg computes before deducting.
contract CoverageObligationTest is StrikelineLeg {
    /// @dev `FeeReceiverLib.BPS` is 1e7, NOT the 1e4 the field name suggests and NOT `FeeFlatIn`'s scale
    ///      either; the surplus share needs the resolution. `100_000 / 1e7 = 1%`.
    uint256 internal constant FEE_DENOM = 1e7;
    uint24 internal constant FEE_BPS = 100_000;
    address internal constant FEE_RECEIVER = address(0xFEE0);

    /// @dev A size well clear of the decay band in both directions.
    uint256 internal constant BUY = 1940e6;

    function setUp() public override {
        super.setUp();
        // Several legs are shipped here against one wallet; fund past the demo book so that nothing in this
        // file is accidentally testing portfolio margin instead of the obligation.
        fund(weth, maker, 88.6e18);
        fund(address(usdc), maker, 173_400e6);
    }

    /// @notice The maker owes the GROSS output when the protocol fee is taken in `tokenOut`, and `Coverage`
    ///         refuses a wallet holding only the net — at quote time, by name, with both numbers.
    function test_Obligation_TokenOutFeeIsPartOfWhatTheMakerMustDeliver() public {
        (ISwapVM.Order memory plain,,) = shipLeg(legProgramAround(_guard(), "", K, L, 601), K, L, X0);
        (ISwapVM.Order memory feeLeg,,) = shipLeg(legProgramAround(_guard(), _feeOut(), K, L, 602), K, L, X0);

        bytes memory buyPlain = takerDataFor(plain, address(usdc), true);
        bytes memory buyFee = takerDataFor(feeLeg, address(usdc), true);

        (, uint256 gross,) = quote(plain, BUY, buyPlain);
        (, uint256 net,) = quote(feeLeg, BUY, buyFee);

        uint256 fee = gross - net;
        assertEq(fee, gross * FEE_BPS / FEE_DENOM, "the fee is a floor-division of the gross output");
        assertGt(fee, 0, "pick a size where the fee is observable");

        console2.log("gross output the curve priced (wei WETH)", gross);
        console2.log("net the taker receives                  ", net);
        console2.log("fee pulled from the maker separately    ", fee);

        // Leave the maker holding EXACTLY the net. A guard that only looked at `amountOut` would wave this
        // through, and the fill would then revert inside the fee's `Aqua.pull`.
        _setMakerWeth(net);

        (bool ok, bytes memory ret) = quoteRaw(feeLeg, BUY, buyFee);
        assertFalse(ok, "a wallet holding only the net must not quote");
        assertEq(
            ret,
            abi.encodeWithSelector(Coverage.NotCovered.selector, net + fee, net),
            "the refusal must name the gross obligation and the real wallet"
        );

        // One wei under the gross is still short.
        _setMakerWeth(net + fee - 1);
        (ok, ret) = quoteRaw(feeLeg, BUY, buyFee);
        assertFalse(ok, "one wei under the gross must still refuse");
        assertEq(ret, abi.encodeWithSelector(Coverage.NotCovered.selector, net + fee, net + fee - 1), "off by one");

        // Exactly the gross clears, and the fee really does leave the wallet on top of the fill.
        _setMakerWeth(net + fee);
        uint256 receiverBefore = IERC20(weth).balanceOf(FEE_RECEIVER);
        (, uint256 filled,) = swapAs(taker, feeLeg, BUY, buyFee);

        assertEq(filled, net, "the fill must match the quote");
        assertEq(IERC20(weth).balanceOf(FEE_RECEIVER) - receiverBefore, fee, "the receiver was paid the fee");
        assertEq(IERC20(weth).balanceOf(maker), 0, "the wallet delivered exactly the gross, to the wei");
    }

    /// @notice A `tokenIn` fee is paid by the taker and is NOT part of the maker's obligation. The wallet that
    ///         was refused above is sufficient here, which is what makes the distinction load-bearing rather
    ///         than decorative.
    function test_Obligation_TokenInFeeIsNotTheMakersProblem() public {
        (ISwapVM.Order memory feeInLeg,,) = shipLeg(legProgramAround(_guard(), _feeIn(), K, L, 603), K, L, X0);
        bytes memory buy = takerDataFor(feeInLeg, address(usdc), true);

        (uint256 amountIn, uint256 amountOut,) = quote(feeInLeg, BUY, buy);
        assertEq(amountIn, BUY, "exact-in must still consume exactly what was offered");

        _setMakerWeth(amountOut);

        uint256 receiverBefore = IERC20(usdc).balanceOf(FEE_RECEIVER);
        (, uint256 filled,) = swapAs(taker, feeInLeg, BUY, buy);

        assertEq(filled, amountOut, "a wallet holding exactly amountOut is enough when the fee is in tokenIn");
        assertEq(IERC20(weth).balanceOf(maker), 0, "the maker delivered amountOut and nothing more");
        assertEq(
            IERC20(usdc).balanceOf(FEE_RECEIVER) - receiverBefore,
            BUY * FEE_BPS / FEE_DENOM,
            "the tokenIn fee came out of the taker's side"
        );
    }

    /// @notice `Coverage` reaches the same obligation whichever way the two wrappers nest, so a maker cannot
    ///         weaken their own solvency check by reordering two instructions.
    ///
    /// @dev Outside-in (`Coverage . FeeProtocol . Rmm`) it reads `amountOut` already net and adds `feeTotal`.
    ///      Inside-out (`FeeProtocol . Coverage . Rmm`) it runs before the deduction, so it reads the gross
    ///      directly while `feeTotal` is still zero — and `decodeIsTokenOut` is already true, because
    ///      `FeeProtocol` writes `ctx.fee.meta` BEFORE its own `runLoop`. Two routes, one number.
    function test_Obligation_BothNestingOrdersEnforceTheSameBound() public {
        (ISwapVM.Order memory outsideIn,,) = shipLeg(legProgramAround(_guard(), _feeOut(), K, L, 604), K, L, X0);
        (ISwapVM.Order memory insideOut,,) = shipLeg(legProgramAround(_feeOut(), _guard(), K, L, 605), K, L, X0);

        bytes memory buyA = takerDataFor(outsideIn, address(usdc), true);
        bytes memory buyB = takerDataFor(insideOut, address(usdc), true);

        (, uint256 netA,) = quote(outsideIn, BUY, buyA);
        (, uint256 netB,) = quote(insideOut, BUY, buyB);
        assertEq(netA, netB, "the two orderings must price identically");

        _setMakerWeth(netA);

        (bool okA, bytes memory retA) = quoteRaw(outsideIn, BUY, buyA);
        (bool okB, bytes memory retB) = quoteRaw(insideOut, BUY, buyB);

        assertFalse(okA, "outside-in must refuse a net-only wallet");
        assertFalse(okB, "inside-out must refuse a net-only wallet");
        assertEq(retA, retB, "both orderings must refuse with byte-identical NotCovered arguments");
    }

    // ------------------------------------------------------------------ programs

    function _guard() internal pure returns (bytes memory) {
        return Coverage.build(0, 0);
    }

    function _feeOut() internal pure returns (bytes memory) {
        return _fee(false);
    }

    function _feeIn() internal pure returns (bytes memory) {
        return _fee(true);
    }

    function _fee(bool isTokenIn) internal pure returns (bytes memory) {
        FeeProtocol.ReceiverConfig[] memory receivers = new FeeProtocol.ReceiverConfig[](1);
        receivers[0] = FeeProtocol.ReceiverConfig({ receiver: FEE_RECEIVER, feeBps: FEE_BPS, surplusBps: 0 });
        return FeeProtocol.build(isTokenIn, receivers, new FeeProtocol.ProviderConfig[](0), 0);
    }

    /// @dev Set the maker's WETH wallet to exactly `amount`, leaving the Aqua allowance untouched so the
    ///      wallet is the binding side of `min(balanceOf, allowance)`.
    function _setMakerWeth(uint256 amount) internal {
        deal(weth, maker, amount);
    }
}
