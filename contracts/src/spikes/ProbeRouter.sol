// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { ProbeScale } from "./ProbeScale.sol";

/// @notice The control router: stock SwapVM + the full official `AquaOpcodes` set, plus one trivial custom
///         opcode (`ProbeScale`, 0xd0) that exists only to prove custom dispatch works and falls through.
/// @dev    Carries NEITHER `RmmSwap` (0x55) NOR `Coverage` (0x93). Nothing ships this: `make bootstrap`,
///         `make smoke`, `make story-setup` and `make deploy` all build StrikelineRouter. It is the
///         baseline the Strikeline measurements are taken against, and the declared type of
///         `AquaSwapVMTestBase.router`. See src/spikes/README.md §3.
///
///         It deploys to the SAME deterministic address as StrikelineRouter from a fresh account and
///         answers `AQUA()` with the official registry, so a fork built on it looks healthy until every
///         `tauNow`/`coverage`/`bandFor` read reverts. `scripts/fork/bootstrap.ts` refuses to write a
///         manifest for a router that cannot answer `tauNow(uint40)` for exactly that reason.
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
