// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { CurveProbeSolady } from "./CurveProbeSolady.sol";

/// @notice Size/gas probe: official SwapVM + AquaOpcodes + opcode 0xd1 = CurveProbeSolady (solady 0.1.26 FixedPointMathLib).
contract CurveProbeRouterSolady is Simulator, SwapVM, AquaOpcodes {
    using OpcodeOps for Opcode;

    constructor(address aqua, address weth, address owner)
        SwapVM(aqua, weth, owner, "CurveProbeRouterSolady", "1")
    { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == CurveProbeSolady.opcode.asU8()) CurveProbeSolady.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}
