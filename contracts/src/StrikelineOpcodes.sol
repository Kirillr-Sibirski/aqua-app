// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";

import { Stop, Revert, Deadline, Salt } from "@1inch/swap-vm/src/instructions/Controls.sol";
import { Jump, JumpIfTokenIn, JumpIfTokenOut } from "@1inch/swap-vm/src/instructions/Jumps.sol";
import {
    OnlyTakerTokenBalanceNonZero,
    OnlyTakerTokenBalanceGte,
    OnlyTakerTokenSupplyShareGte,
    OnlyTxOriginTokenBalanceNonZero
} from "@1inch/swap-vm/src/instructions/TokenValidators.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { XYCConcentrateSwap } from "@1inch/swap-vm/src/instructions/XYCConcentrate.sol";
import { Decay } from "@1inch/swap-vm/src/instructions/Decay.sol";
import { FeeFlatIn } from "@1inch/swap-vm/src/instructions/FeeFlat.sol";
import { FeeProtocol } from "@1inch/swap-vm/src/instructions/FeeProtocol.sol";
import { Extruction } from "@1inch/swap-vm/src/instructions/Extruction.sol";

/// @notice The standard Aqua instruction set, minus `PeggedSwap`.
///
/// @dev Identical to `@1inch/swap-vm/src/opcodes/AquaOpcodes.sol` except that the `PeggedSwap` branch is
///      not wired. Strikeline's own two instructions plus the on-chain views push the router 364 bytes
///      past EIP-170 with the full set, and `PeggedSwap` is the one entry this product never composes:
///      a stableswap curve has nothing to do with writing options on a volatile pair. Every other
///      official instruction stays, `FeeProtocol` included, so programs written for the official router
///      keep working here.
///
///      Costs 1,394 bytes when present, measured with `forge build --sizes`.
abstract contract StrikelineOpcodes {
    using OpcodeOps for Opcode;

    error UnknownOpcode(uint256 opcode);

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual {
        if (opcode == Jump.opcode.asU8()) {
            Jump.exec(ctx, args);
        } else if (opcode == JumpIfTokenIn.opcode.asU8()) {
            JumpIfTokenIn.exec(ctx, args);
        } else if (opcode == JumpIfTokenOut.opcode.asU8()) {
            JumpIfTokenOut.exec(ctx, args);
        } else if (opcode == Deadline.opcode.asU8()) {
            Deadline.exec(ctx, args);
        } else if (opcode == OnlyTakerTokenBalanceNonZero.opcode.asU8()) {
            OnlyTakerTokenBalanceNonZero.exec(ctx, args);
        } else if (opcode == OnlyTakerTokenBalanceGte.opcode.asU8()) {
            OnlyTakerTokenBalanceGte.exec(ctx, args);
        } else if (opcode == OnlyTakerTokenSupplyShareGte.opcode.asU8()) {
            OnlyTakerTokenSupplyShareGte.exec(ctx, args);
        } else if (opcode == XYCSwap.opcode.asU8()) {
            XYCSwap.exec(ctx, args);
        } else if (opcode == XYCConcentrateSwap.opcode.asU8()) {
            XYCConcentrateSwap.exec(ctx, args);
        } else if (opcode == Decay.opcode.asU8()) {
            Decay.exec(ctx, args);
        } else if (opcode == Salt.opcode.asU8()) {
            Salt.exec(ctx, args);
        } else if (opcode == FeeFlatIn.opcode.asU8()) {
            FeeFlatIn.exec(ctx, args);
        } else if (opcode == FeeProtocol.opcode.asU8()) {
            FeeProtocol.exec(ctx, args);
        } else if (opcode == Extruction.opcode.asU8()) {
            Extruction.exec(ctx, args);
        } else if (opcode == OnlyTxOriginTokenBalanceNonZero.opcode.asU8()) {
            OnlyTxOriginTokenBalanceNonZero.exec(ctx, args);
        } else if (opcode == Stop.opcode.asU8()) {
            Stop.exec(ctx, args);
        } else if (opcode == Revert.opcode.asU8()) {
            Revert.exec(ctx, args);
        } else {
            revert UnknownOpcode(opcode);
        }
    }
}
