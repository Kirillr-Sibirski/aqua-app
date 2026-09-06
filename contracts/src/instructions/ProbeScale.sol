// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";
import { Calldata } from "@1inch/solidity-utils/contracts/libraries/Calldata.sol";

/// @notice Compile-probe custom opcode: scales balanceOut by a factor (1e9 = 1x)
library ProbeScale {
    using Calldata for bytes;
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;
    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    Opcode constant opcode = Opcode._d0;

    function build(uint32 factor) internal pure returns (bytes memory) {
        MemoryPtr start = MemoryPtrLib.alloc(InstructionBuilder.sizeOf() + 4);
        MemoryPtr ptr = start.pushHeader(opcode).push(uint256(factor), 4);
        start.patchLength(ptr);
        return ptr.resolve();
    }

    function exec(Context memory ctx, bytes calldata args) internal pure {
        uint256 factor = args.at(0).asU32();
        ctx.swap.balanceOut = ctx.swap.balanceOut * factor / 1e9;
    }
}
