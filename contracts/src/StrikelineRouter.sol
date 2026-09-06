// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { StrikelineOpcodes } from "./StrikelineOpcodes.sol";

import { RmmSwap } from "./instructions/RmmSwap.sol";
import { Coverage } from "./instructions/Coverage.sol";
import { StrikelineViews } from "./StrikelineViews.sol";

/// @title StrikelineRouter
/// @notice 1inch SwapVM with two added instructions, settling against the official Aqua registry.
///
/// @dev The prize permits redeploying a modified SwapVM; the registry is never redeployed. Makers
///      `ship()` to `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` with `app` set to this router, and the
///      whole standard Aqua opcode set stays available, so a program written for the official router
///      still runs here.
///
///      A Strikeline leg is four instructions:
///
///          Deadline(maturity + grace) . Coverage(flags, haircut) . RmmSwap(K, sigma, T, L, rates) . Salt(n)
///
///      `Coverage` precedes the curve because it wraps it: it runs the rest of the program via a nested
///      `runLoop`, then checks that the priced output is actually deliverable from the maker's wallet.
///      `Salt` is a maker-owned monotonic nonce, because Aqua marks a docked strategy hash dead forever
///      and a rolled leg would otherwise collide with the one it replaces.
contract StrikelineRouter is Simulator, SwapVM, StrikelineOpcodes, StrikelineViews {
    using OpcodeOps for Opcode;

    constructor(
        address aqua,
        address weth,
        address owner,
        string memory name,
        string memory version
    )
        SwapVM(aqua, weth, owner, name, version)
    { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == RmmSwap.opcode.asU8()) {
            RmmSwap.exec(ctx, args);
        } else if (opcode == Coverage.opcode.asU8()) {
            Coverage.exec(ctx, args, address(AQUA));
        } else {
            super._runOpcode(ctx, opcode, args);
        }
    }

    function _aqua() internal view override returns (address) {
        return address(AQUA);
    }
}
