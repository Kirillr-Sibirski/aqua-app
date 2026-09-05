// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { ProbeScale } from "./instructions/ProbeScale.sol";

/// @notice Compile probe: official SwapVM + AquaOpcodes + one custom opcode
contract ProbeRouter is Simulator, SwapVM, AquaOpcodes {
    using OpcodeOps for Opcode;

    constructor(address aqua, address weth, address owner)
        SwapVM(aqua, weth, owner, "ProbeRouter", "1")
    { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == ProbeScale.opcode.asU8()) ProbeScale.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}
