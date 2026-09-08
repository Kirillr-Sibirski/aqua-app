// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { StrikelineLeg } from "./StrikelineLeg.sol";
import { StrikelineOpcodes } from "../../src/StrikelineOpcodes.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title OpcodeLayoutTest
/// @notice The frozen wire format of both custom instructions, asserted byte by byte.
///
/// @dev This file exists because of one failure mode. An Aqua strategy is identified by
///      `keccak256(abi.encode(order))`, and `order.data` contains the program bytes. Move a single byte and the
///      hash changes, so `ship()` still succeeds - Aqua does not read the program - while every subsequent
///      `quote` reverts in `Aqua.safeBalances` with `SafeBalancesForTokenNotInActiveStrategy`, which a caller
///      reads as "this market has no liquidity". The maker sees a shipped strategy and a dead book, with no
///      error pointing at the encoder. `test_Layout_OneByteDriftBricksTheStrategy` reproduces exactly that.
///
///      So the layouts below are frozen here in hex, and `docs/OPCODES.md` documents the same bytes. A change to
///      either instruction's encoding must break this file first.
///
///      The cross-language check lives elsewhere: `test/encoding/EncodingVectors.t.sol` and
///      `web/src/lib/swapvm` pin the TypeScript encoder against these same Solidity builders.
contract OpcodeLayoutTest is StrikelineLeg {
    using OpcodeOps for Opcode;

    /// @dev Canonical argument values used by every vector in this file.
    uint8 internal constant V_FLAGS = 0x07;
    uint64 internal constant V_SIGMA = 0.6e18;
    uint40 internal constant V_MATURITY = 1_800_000_000;
    uint128 internal constant V_STRIKE = 2600e18;
    uint128 internal constant V_LIQUIDITY = 12e18;
    uint64 internal constant V_RATE_RISKY = 1;
    uint64 internal constant V_RATE_STABLE = 1e12;
    uint40 internal constant V_DEADLINE = 1_800_001_800;
    uint64 internal constant V_SALT = 101;

    /// @dev `[55][3e][flags][sigma:8][maturity:5][strike:16][liquidity:16][rateRisky:8][rateStable:8]`
    bytes internal constant RMM_BYTES =
        hex"553e070853a0d2313c0000006b49d200000000000000008cf23f909c0fa000000000000000000000a688906bd8b000000000000000000001000000e8d4a51000";
    /// @dev `[93][03][flags][haircutBps:2]`
    bytes internal constant COVERAGE_BYTES = hex"9303000000";
    bytes internal constant COVERAGE_BYTES_HAIRCUT = hex"93030100fa";
    /// @dev `Deadline . Coverage . RmmSwap . Salt`, 86 bytes.
    bytes internal constant LEG_BYTES =
        hex"2005006b49d9089303000000553e070853a0d2313c0000006b49d200000000000000008cf23f909c0fa000000000000000000000a688906bd8b000000000000000000001000000e8d4a5100002080000000000000065";

    // ------------------------------------------------------------------ opcode slots

    /// @notice Both opcodes sit in free slots of the official enum, in the family they belong to.
    /// @dev `0x50-0x58` is the swap-curve family (`XYCSwap` 0x50, `XYCConcentrateSwap` 0x51, `LimitSwap` 0x53,
    ///      `PeggedSwap` 0x58) and `0x55` is unassigned there. `0x90-0x9d` is the reserve-modifier family
    ///      (`StaticBalances` 0x90, `DynamicBalances` 0x91, `DutchAuction*` 0x94/0x95, `Decay` 0x9c) and `0x93`
    ///      is unassigned there. Neither collides with anything the official router dispatches.
    function test_Layout_OpcodeSlots() public pure {
        assertEq(RmmSwap.opcode.asU8(), 0x55, "RmmSwap opcode moved");
        assertEq(Coverage.opcode.asU8(), 0x93, "Coverage opcode moved");
    }

    /// @notice An opcode we do not implement still falls through to the standard set and reverts by name, so a
    ///         mistyped opcode is never silently a no-op.
    function test_Layout_UnknownOpcodeFallsThroughByName() public {
        bytes memory program = bytes.concat(rawInstruction(Opcode._56), Salt.build(uint64(999)));
        ISwapVM.Order memory order = buildAquaOrder(maker, weth, address(usdc), program);
        shipOrder(maker, order, 1e18, 1_000e6);

        vm.expectRevert(abi.encodeWithSelector(StrikelineOpcodes.UnknownOpcode.selector, 0x56));
        this.quote(order, 100e6, takerDataFor(order, address(usdc), true));
    }

    // ------------------------------------------------------------------ RmmSwap, 0x55

    /// @notice `RmmSwap` is 64 bytes: a 2-byte header and 62 argument bytes, in this exact order.
    function test_Layout_RmmSwap() public pure {
        bytes memory built = RmmSwap.build(
            RmmSwap.Args({
                flags: V_FLAGS,
                sigmaWad: V_SIGMA,
                maturity: V_MATURITY,
                strikeWad: V_STRIKE,
                liquidityWad: V_LIQUIDITY,
                rateRisky: V_RATE_RISKY,
                rateStable: V_RATE_STABLE
            })
        );

        assertEq(built, RMM_BYTES, "RmmSwap wire format changed");
        assertEq(built.length, RmmSwap.sizeOf(), "sizeOf disagrees with build");
        assertEq(built.length, 64, "RmmSwap must be 64 bytes");

        // Header.
        assertEq(_u(built, 0, 1), 0x55, "byte 0: opcode");
        assertEq(_u(built, 1, 1), 62, "byte 1: args length");

        // Arguments, at the offsets `RmmSwap.parse` reads them from.
        assertEq(_u(built, 2, 1), V_FLAGS, "arg 0 (1B): flags");
        assertEq(_u(built, 3, 8), V_SIGMA, "arg 1 (8B): sigmaWad");
        assertEq(_u(built, 11, 5), V_MATURITY, "arg 9 (5B): maturity");
        assertEq(_u(built, 16, 16), V_STRIKE, "arg 14 (16B): strikeWad");
        assertEq(_u(built, 32, 16), V_LIQUIDITY, "arg 30 (16B): liquidityWad");
        assertEq(_u(built, 48, 8), V_RATE_RISKY, "arg 46 (8B): rateRisky");
        assertEq(_u(built, 56, 8), V_RATE_STABLE, "arg 54 (8B): rateStable");
    }

    /// @notice `parse` reads back exactly what `build` wrote. The two are separate code paths and the offsets
    ///         are literals in both.
    function test_Layout_RmmSwapParseRoundTrips() public view {
        RmmSwap.Args memory a = RmmSwap.Args({
            flags: V_FLAGS,
            sigmaWad: V_SIGMA,
            maturity: V_MATURITY,
            strikeWad: V_STRIKE,
            liquidityWad: V_LIQUIDITY,
            rateRisky: V_RATE_RISKY,
            rateStable: V_RATE_STABLE
        });
        bytes memory built = RmmSwap.build(a);
        // Strip the 2-byte header: `parse` receives the args slice, as the VM hands it over.
        RmmSwap.Args memory back = this.parseRmm(_slice(built, 2, 62));

        assertEq(back.flags, a.flags, "flags");
        assertEq(back.sigmaWad, a.sigmaWad, "sigmaWad");
        assertEq(back.maturity, a.maturity, "maturity");
        assertEq(back.strikeWad, a.strikeWad, "strikeWad");
        assertEq(back.liquidityWad, a.liquidityWad, "liquidityWad");
        assertEq(back.rateRisky, a.rateRisky, "rateRisky");
        assertEq(back.rateStable, a.rateStable, "rateStable");
    }

    /// @notice The three flag bits, by value, and what each one gates.
    function test_Layout_RmmSwapFlagBits() public pure {
        assertEq(RmmSwap.FLAG_RISKY_IS_TOKEN_A, 0x01, "bit 0: the risky leg is the order's tokenA");
        assertEq(RmmSwap.FLAG_POST_EXPIRY_ONE_WAY, 0x02, "bit 1: after maturity, trade one way only");
        assertEq(RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY, 0x04, "bit 2: that way delivers the risky token");
    }

    // ------------------------------------------------------------------ Coverage, 0x93

    /// @notice `Coverage` is 5 bytes: a 2-byte header and 3 argument bytes.
    function test_Layout_Coverage() public pure {
        bytes memory built = Coverage.build(0, 0);
        assertEq(built, COVERAGE_BYTES, "Coverage wire format changed");
        assertEq(built.length, Coverage.sizeOf(), "sizeOf disagrees with build");
        assertEq(built.length, 5, "Coverage must be 5 bytes");

        assertEq(_u(built, 0, 1), 0x93, "byte 0: opcode");
        assertEq(_u(built, 1, 1), 3, "byte 1: args length");

        bytes memory withHaircut = Coverage.build(1, 250);
        assertEq(withHaircut, COVERAGE_BYTES_HAIRCUT, "Coverage haircut encoding changed");
        assertEq(_u(withHaircut, 2, 1), 1, "arg 0 (1B): flags");
        assertEq(_u(withHaircut, 3, 2), 250, "arg 1 (2B): haircutBps");

        assertEq(Coverage.FLAG_CHECK_TOKEN_IN, 0x01, "bit 0: also require tokenIn to be receivable");
    }

    /// @notice A haircut of 100% or more is rejected at build time, not silently clamped at run time.
    function test_Layout_CoverageRejectsAnImpossibleHaircut() public {
        vm.expectRevert(abi.encodeWithSelector(Coverage.CoverageHaircutTooLarge.selector, uint256(10_000)));
        this.buildCoverage(0, 10_000);
    }

    /// @notice The error selectors `docs/OPCODES.md` publishes, asserted against the compiled contracts so the
    ///         table in the docs can never drift from the ABI a caller decodes against.
    function test_Layout_ErrorSelectors() public pure {
        assertEq(RmmSwap.RmmInsideSpread.selector, bytes4(0xe2047c83), "RmmInsideSpread(uint256)");
        assertEq(RmmSwap.RmmExceedsReserve.selector, bytes4(0xcb39c036), "RmmExceedsReserve(uint256,uint256)");
        assertEq(RmmSwap.RmmSettlementOneWay.selector, bytes4(0x40f74638), "RmmSettlementOneWay()");
        assertEq(RmmSwap.RmmOutOfDomain.selector, bytes4(0x18c40ced), "RmmOutOfDomain()");
        assertEq(Coverage.NotCovered.selector, bytes4(0x09d16e81), "NotCovered(uint256,uint256)");
        assertEq(Coverage.CoverageHaircutTooLarge.selector, bytes4(0xb1f0d0c9), "CoverageHaircutTooLarge(uint256)");
        assertEq(StrikelineOpcodes.UnknownOpcode.selector, bytes4(0x446d79e8), "UnknownOpcode(uint256)");
        assertEq(
            IAqua.SafeBalancesForTokenNotInActiveStrategy.selector,
            bytes4(0xb63386a6),
            "SafeBalancesForTokenNotInActiveStrategy(address,address,bytes32,address)"
        );
    }

    // ------------------------------------------------------------------ the whole leg

    /// @notice The shipped program is `Deadline . Coverage . RmmSwap . Salt`, 86 bytes, in this order.
    /// @dev The order is load-bearing. `Coverage` must precede the curve because it WRAPS it: it runs the rest
    ///      of the program through a nested `runLoop` and only then checks the priced output. `Deadline` must
    ///      precede `Coverage`, or an expired leg still pays for a full curve evaluation before being refused.
    ///      `Salt` is last and is a pure no-op at run time; it only exists to move the strategy hash.
    function test_Layout_TheLegProgram() public pure {
        bytes memory program = bytes.concat(
            Deadline.build(V_DEADLINE),
            Coverage.build(0, 0),
            RmmSwap.build(
                RmmSwap.Args({
                    flags: V_FLAGS,
                    sigmaWad: V_SIGMA,
                    maturity: V_MATURITY,
                    strikeWad: V_STRIKE,
                    liquidityWad: V_LIQUIDITY,
                    rateRisky: V_RATE_RISKY,
                    rateStable: V_RATE_STABLE
                })
            ),
            Salt.build(V_SALT)
        );

        assertEq(program, LEG_BYTES, "the leg program's wire format changed");
        assertEq(program.length, 86, "leg program must be 86 bytes");
        assertEq(_u(program, 0, 1), 0x20, "Deadline first");
        assertEq(_u(program, 7, 1), 0x93, "Coverage second");
        assertEq(_u(program, 12, 1), 0x55, "RmmSwap third");
        assertEq(_u(program, 76, 1), 0x02, "Salt last");
    }

    /// @notice THE FAILURE MODE. One byte of drift in the program does not fail loudly: `ship` still succeeds,
    ///         because Aqua never reads the program. Every quote against the drifted bytes then reverts inside
    ///         `Aqua.safeBalances`, which reads like an empty market rather than like an encoder bug.
    function test_Layout_OneByteDriftBricksTheStrategy() public {
        (ISwapVM.Order memory good,,) = shipDemoLeg(501);
        bytes memory buy = takerDataFor(good, address(usdc), true);

        (, uint256 out,) = quote(good, 1_940e6, buy);
        assertGt(out, 0, "the correctly encoded leg must quote");

        // Flip the lowest byte of `rateStable`: 1e12 becomes 1e12 + 1. Economically meaningless, and it changes
        // the strategy hash.
        bytes memory drifted = bytes.concat(good.data); // a real copy: `= good.data` would alias it
        uint256 tail = drifted.length;
        drifted[tail - 11] = bytes1(uint8(drifted[tail - 11]) ^ 0x01);

        ISwapVM.Order memory bad = ISwapVM.Order({ maker: good.maker, traits: good.traits, data: drifted });
        assertTrue(sl.hash(bad) != sl.hash(good), "one byte of drift must move the strategy hash");

        // Aqua accepted the good strategy under the good hash; the drifted order resolves to a hash Aqua has
        // never seen, so it has no reserves and quoting reverts.
        (bool ok, bytes memory ret) = address(sl).staticcall(abi.encodeCall(ISwapVM.quote, (bad, 1_940e6, buy)));
        assertFalse(ok, "a drifted program must not quote");
        // The error is Aqua's, not ours, and it names a token rather than the encoding. To a caller this is
        // indistinguishable from an empty market, which is exactly why the layout is frozen in this file.
        assertEq(
            bytes4(ret),
            IAqua.SafeBalancesForTokenNotInActiveStrategy.selector,
            "drift must surface as Aqua's not-in-active-strategy, i.e. as 'no liquidity'"
        );
        console2.log("good hash");
        console2.logBytes32(sl.hash(good));
        console2.log("drifted hash");
        console2.logBytes32(sl.hash(bad));
        console2.log("revert data from the drifted quote");
        console2.logBytes(ret);

        // And it is silent in the other direction: shipping the drifted bytes succeeds, so a maker who encodes
        // wrongly gets a live-looking strategy that no taker can ever fill against their intended hash.
        (address ta, address tb) = orderTokens(bad);
        address[] memory tokens = new address[](2);
        tokens[0] = ta;
        tokens[1] = tb;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;
        vm.prank(maker);
        bytes32 shipped = aqua.ship(address(sl), abi.encode(bad), tokens, amounts);
        assertEq(shipped, sl.hash(bad), "Aqua ships whatever bytes it is given");
    }

    // ------------------------------------------------------------------ helpers

    /// @dev External wrappers so the calldata-slice signatures the VM uses can be exercised directly.
    function parseRmm(bytes calldata args) external pure returns (RmmSwap.Args memory) {
        return RmmSwap.parse(args);
    }

    function buildCoverage(uint8 flags, uint16 haircutBps) external pure returns (bytes memory) {
        return Coverage.build(flags, haircutBps);
    }

    function _u(bytes memory b, uint256 offset, uint256 len) private pure returns (uint256 v) {
        for (uint256 i; i < len; ++i) {
            v = (v << 8) | uint8(b[offset + i]);
        }
    }

    function _slice(bytes memory b, uint256 offset, uint256 len) private pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = b[offset + i];
        }
    }
}
