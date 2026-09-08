// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import { StrikelineLeg } from "./StrikelineLeg.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title CoverageHaircutTest
/// @notice `Coverage`'s second argument, defended on the wire rather than in the builder.
///
/// @dev `Coverage.build` has always rejected `haircutBps >= 10000`. That guards the ENCODER. The wire is what
///      the strategy hash commits to, and Aqua ships program bytes without ever reading them, so a leg
///      assembled by hand, by a different SDK, or by an encoder that got its endianness wrong can carry any
///      two bytes in that slot and `ship()` will still succeed.
///
///      Measured on this router with the bound in `build` only, quoting 1,940 USDC against the demo leg:
///
///        haircutBps  9_999   0x09d16e81 …0ac621d00ffd3e44 …0003b1dfde910000   NotCovered(needed, free)
///        haircutBps 10_000   0x09d16e81 …0ac621d00ffd3e44 …0000000000000000   NotCovered(needed, 0)
///        haircutBps 10_001   0x4e487b71 …0000000000000011                     Panic(0x11)
///
///      The middle row is the dangerous one. `free = f - f*haircutBps/1e4` is exactly zero at 100%, so a
///      wallet holding 10.4 WETH reports as an empty wallet, permanently, on a strategy whose hash can never
///      be re-shipped once docked. The bottom row underflows and reads as a bug in the contract rather than
///      as a bad maker parameter. Neither names the byte that is wrong.
///
///      Moving the bound into `Coverage.parse` costs 45 bytes of router runtime (23,619 -> 23,664, EIP-170
///      margin 957 -> 912) and turns both rows into `CoverageHaircutTooLarge(uint256)` carrying the offending
///      value, at quote time, before any curve evaluation is paid for.
contract CoverageHaircutTest is StrikelineLeg {
    uint256 internal constant BUY = 1_940e6;

    /// @notice A haircut byte `build` would have refused is refused on the wire too, by name, carrying the
    ///         value — instead of bricking the leg with `NotCovered(x, 0)` or `Panic(0x11)`.
    function test_Haircut_OutOfRangeOnTheWireIsANamedError() public {
        (ISwapVM.Order memory dead,,) = shipLeg(_handEncoded(10_000, 606), K, L, X0);
        (ISwapVM.Order memory worse,,) = shipLeg(_handEncoded(10_001, 607), K, L, X0);
        (ISwapVM.Order memory legal,,) = shipLeg(_handEncoded(9_999, 608), K, L, X0);

        (bool okDead, bytes memory retDead) = quoteRaw(dead, BUY, takerDataFor(dead, address(usdc), true));
        assertFalse(okDead, "a 100% haircut must not quote");
        assertEq(
            retDead,
            abi.encodeWithSelector(Coverage.CoverageHaircutTooLarge.selector, uint256(10_000)),
            "100% must name the bad argument, not report an empty wallet"
        );

        (bool okWorse, bytes memory retWorse) = quoteRaw(worse, BUY, takerDataFor(worse, address(usdc), true));
        assertFalse(okWorse, "a >100% haircut must not quote");
        assertEq(
            retWorse,
            abi.encodeWithSelector(Coverage.CoverageHaircutTooLarge.selector, uint256(10_001)),
            "over 100% must name the bad argument, not panic"
        );

        // The bound is exclusive, so one below it is a legal leg that simply reserves almost everything: it
        // still refuses this fill, but on SIZE, which is a different error and a recoverable one.
        (bool okLegal, bytes memory retLegal) = quoteRaw(legal, BUY, takerDataFor(legal, address(usdc), true));
        assertFalse(okLegal, "99.99% of a 10.4 WETH wallet cannot cover this fill");
        assertEq(bytes4(retLegal), Coverage.NotCovered.selector, "9,999 is a legal haircut: it refuses on size");
    }

    /// @notice The haircut reserves the fraction it names, and `coverage()` publishes the wallet BEFORE any
    ///         per-leg haircut, so a UI that shows both numbers is showing two different things on purpose.
    function test_Haircut_ReservesTheFractionItNames() public {
        (ISwapVM.Order memory leg,,) = shipLeg(_handEncoded(2_500, 609), K, L, X0);
        deal(weth, maker, 4e18);

        assertEq(sl.coverage(maker, weth), 4e18, "coverage() publishes the wallet, before any per-leg haircut");
        assertEq(Coverage.free(address(aqua), maker, weth, 2_500), 3e18, "25% of 4 WETH is held back");

        bytes memory out = takerDataFor(leg, address(usdc), false);
        (bool atBound,) = quoteRaw(leg, 3e18, out);
        (bool overBound, bytes memory ret) = quoteRaw(leg, 3e18 + 1, out);

        assertTrue(atBound, "exactly the haircut bound must fill");
        assertFalse(overBound, "one wei past it must not");
        assertEq(
            ret,
            abi.encodeWithSelector(Coverage.NotCovered.selector, 3e18 + 1, 3e18),
            "the error reports the haircut bound, not the raw wallet"
        );
    }

    /// @dev The shipped leg with `Coverage`'s three argument bytes written by hand, so the haircut can carry
    ///      a value `Coverage.build` would have refused to encode.
    function _handEncoded(uint16 haircutBps, uint64 salt) internal view returns (bytes memory) {
        bytes memory guard = bytes.concat(bytes1(0x93), bytes1(0x03), bytes1(0x00), bytes2(haircutBps));
        return legProgramAround(guard, "", K, L, salt);
    }
}
