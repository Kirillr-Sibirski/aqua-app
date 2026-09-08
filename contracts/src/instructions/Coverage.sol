// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";
import { FeeMetaLib } from "@1inch/swap-vm/src/libs/ProtocolFee.sol";

/// @title Coverage
/// @notice Portfolio margin for a book of Aqua strategies, enforced inside the call that prices the trade.
///
/// @dev Aqua deliberately lets a maker over-allocate: `ship()` checks no balance and moves no tokens, and
///      `safeBalances()` returns the virtual number with no clamp to the wallet. That is what lets one
///      wallet back several strategies at full size, and it is also why a book can quote depth it cannot
///      deliver. The only real check today happens inside `Aqua.pull`'s `transferFrom`, which is after the
///      quote: an aggregator sees the depth, routes to it, and the fill reverts.
///
///      This instruction closes that gap. It reads the maker's actual `balanceOf` and their remaining
///      `allowance` to the Aqua registry, and requires the priced output to be deliverable from the
///      smaller of the two. The consequence is the useful part: because every leg of the book reads the
///      same wallet, a fill on one leg immediately shrinks what its siblings can deliver, in the same
///      block, with no keeper, no shared storage and no message passing between strategies.
///      Over-allocation stops being phantom depth and becomes a margined book.
///
///      IT RUNS THE CURVE FIRST. `ctx.runLoop()` executes the rest of the program so pricing happens on
///      the true shipped reserves, and only the resulting `amountOut` is checked. Clamping `balanceOut`
///      before the curve would move the reserve point, and therefore change the PRICE rather than just the
///      size, which is a subtle way to quote a different option than the one the maker wrote.
///
///      IT REVERTS RATHER THAN CLAMPING. Returning a smaller fill would need a second `runLoop` in
///      exact-out mode, roughly doubling the gas of an already transcendental curve. Instead the quote is
///      a hard solvency bound and the error carries both numbers, so a caller can size correctly on the
///      next attempt (`StrikelineViews.coverage()` publishes the same figure for UIs and solvers).
///
///      Wrapper instruction, `view`, no storage: `quote() == swap()` holds because both paths run the
///      whole program before any transfer or hook, so the balance read is identical in each.
///
/// @dev Encoding: [uint8 flags][uint16 haircutBps]  (3 arg bytes, 5 with the header)
library Coverage {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;
    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;
    using ContextLib for Context;

    /// @notice The priced output exceeds what the maker's wallet can actually deliver right now.
    error NotCovered(uint256 needed, uint256 free);
    /// @notice `haircutBps` must be a fraction of 100%.
    error CoverageHaircutTooLarge(uint256 haircutBps);

    Opcode internal constant opcode = Opcode._93;

    uint256 internal constant BPS = 1e4;

    /// @dev Also require the input leg to be receivable, for tokens that can block transfers in.
    uint8 internal constant FLAG_CHECK_TOKEN_IN = 1 << 0;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 3;
    }

    function build(uint8 flags, uint16 haircutBps) internal pure returns (bytes memory) {
        require(haircutBps < BPS, CoverageHaircutTooLarge(haircutBps));
        MemoryPtr start = MemoryPtrLib.alloc(sizeOf());
        MemoryPtr ptr = start.pushHeader(opcode).push(flags).push(uint256(haircutBps), 2);
        start.patchLength(ptr);
        return ptr.resolve();
    }

    /// @dev The bound is re-checked here, not only in `build`. `build` guards the encoder; `parse` guards the
    ///      WIRE, and the wire is what a strategy hash commits to. A program assembled by hand, by a different
    ///      SDK, or by an encoder bug can carry any two bytes here, and Aqua ships it without reading it. The
    ///      two out-of-range cases are both silent and both wrong:
    ///
    ///        haircutBps == 10000   `free` evaluates to 0 and every quote reverts `NotCovered(needed, 0)` —
    ///                              a full wallet reported as an empty one.
    ///        haircutBps >  10000   `f - f*haircutBps/BPS` underflows and every quote reverts `Panic(0x11)` —
    ///                              a maker parameter reported as a contract bug.
    ///
    ///      Neither names the byte that is wrong. Re-checking here costs 45 bytes of router runtime code
    ///      and makes both cases say which argument is bad,
    ///      before any curve evaluation is paid for. `test/invariants/CoverageHaircut.t.sol` pins all three
    ///      rows, including the legal 9,999 that must still refuse on SIZE rather than on encoding.
    function parse(bytes calldata args) internal pure returns (uint8 flags, uint16 haircutBps) {
        flags = args.at(0).asU8();
        haircutBps = args.at(1).asU16();
        require(haircutBps < BPS, CoverageHaircutTooLarge(haircutBps));
    }

    /// @notice What `maker` can actually deliver of `token` through Aqua right now.
    /// @dev The wallet balance and the registry allowance are both live and both binding; either one
    ///      falling (a transfer elsewhere, a revoked approval, another app filling first) tightens every
    ///      strategy backed by this wallet at once.
    function free(address aqua, address maker, address token, uint256 haircutBps) internal view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(maker);
        uint256 allowed = IERC20(token).allowance(maker, aqua);
        uint256 f = balance < allowed ? balance : allowed;
        return f - f * haircutBps / BPS;
    }

    function exec(Context memory ctx, bytes calldata args, address aqua) internal {
        (uint8 flags, uint16 haircutBps) = parse(args);

        // Price on the true shipped reserves, unmodified.
        ctx.runLoop();

        // A tokenOut protocol fee is pulled from the maker on top of `amountOut`, so it is part of the
        // obligation. A tokenIn fee is taken from the taker's side and is not.
        uint256 needed = ctx.swap.amountOut;
        if (FeeMetaLib.decodeIsTokenOut(ctx.fee.meta)) {
            needed += ctx.fee.feeTotal;
        }
        uint256 available = free(aqua, ctx.query.maker, ctx.query.tokenOut, haircutBps);
        if (needed > available) {
            revert NotCovered(needed, available);
        }

        if (flags & FLAG_CHECK_TOKEN_IN != 0) {
            uint256 inFree = free(aqua, ctx.query.maker, ctx.query.tokenIn, 0);
            if (inFree == 0 && ctx.swap.amountIn > 0) {
                revert NotCovered(ctx.swap.amountIn, 0);
            }
        }
    }
}
