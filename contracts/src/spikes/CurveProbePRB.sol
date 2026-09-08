// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";

import { WadMathPRB as M } from "./WadMathPRB.sol";
import { GaussianPRB as G } from "./GaussianPRB.sol";

/// @notice THROWAWAY probe opcode 0xd1 (PRBMath UD60x18 backend): fixed-point curves that need pow/exp/ln/sqrt/Phi.
/// @dev Encoding: [uint8 fn][uint256 a][uint256 b][uint256 c]  (97 arg bytes; header makes 99 program bytes)
///   fn 0 WEIGHTED  a = wA (1e18), b = wB (1e18), c unused. Balancer weighted-product curve, both directions.
///                  Direction is derived from `ctx.query.tokenIn < ctx.query.tokenOut` (MakerTraits enforces tokenA < tokenB).
///   fn 1 RMM_A     RMM-01 covered call, risky asset = tokenA. a = K (1e18 stable per risky), b = s = sigma*sqrt(tau) (1e18),
///                  c = L (liquidity, in risky-token wei). Trading function y = L*K*Phi(Phi^-1(1 - x/L) - s). All 4 cases.
///   fn 2 RMM_B     Same, risky asset = tokenB.
///   fn 3 PRIMS     balanceOut *= sqrt(exp(ln(pow(a, b)))) / 1e18  (== sqrt(a^b)); exercises pow, ln, exp, sqrt in one opcode.
library CurveProbePRB {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;
    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    error CurveProbeUnknownFn(uint8 fn);
    error CurveProbeInsufficientLiquidity();

    Opcode internal constant opcode = Opcode._d1;
    uint256 internal constant WAD = 1e18;

    uint8 internal constant FN_WEIGHTED = 0;
    uint8 internal constant FN_RMM_A = 1;
    uint8 internal constant FN_RMM_B = 2;
    uint8 internal constant FN_PRIMS = 3;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 1 + 96;
    }

    function build(uint8 fn, uint256 a, uint256 b, uint256 c) internal pure returns (bytes memory) {
        MemoryPtr start = MemoryPtrLib.alloc(sizeOf());
        MemoryPtr ptr = start.pushHeader(opcode).push(fn).push(a, 32).push(b, 32).push(c, 32);
        start.patchLength(ptr);
        return ptr.resolve();
    }

    function parse(bytes calldata args) internal pure returns (uint8 fn, uint256 a, uint256 b, uint256 c) {
        fn = args.at(0).asU8();
        a = args.at(1).asU256();
        b = args.at(33).asU256();
        c = args.at(65).asU256();
    }

    function exec(Context memory ctx, bytes calldata args) internal pure {
        (uint8 fn, uint256 a, uint256 b, uint256 c) = parse(args);
        if (fn == FN_WEIGHTED) _weighted(ctx, a, b);
        else if (fn == FN_RMM_A) _rmm(ctx, true, a, b, c);
        else if (fn == FN_RMM_B) _rmm(ctx, false, a, b, c);
        else if (fn == FN_PRIMS) ctx.swap.balanceOut = ctx.swap.balanceOut * _prims(a, b) / WAD;
        else revert CurveProbeUnknownFn(fn);
    }

    // ------------------------------------------------------------------ fn 3: primitives

    /// @dev sqrt(exp(ln(a^b))) == sqrt(a^b); uses every primitive once.
    function _prims(uint256 a, uint256 b) private pure returns (uint256) {
        int256 l = M.ln(M.pow(a, b));
        uint256 e = l >= 0 ? M.exp(uint256(l)) : M.expNeg(uint256(-l));
        return M.sqrt(e);
    }

    // ------------------------------------------------------------------ fn 0: weighted product

    function _weighted(Context memory ctx, uint256 wA, uint256 wB) private pure {
        bool aToB = ctx.query.tokenIn < ctx.query.tokenOut;
        (uint256 wIn, uint256 wOut) = aToB ? (wA, wB) : (wB, wA);
        if (ctx.query.isExactIn) {
            ctx.swap.amountOut = weightedOut(ctx.swap.balanceIn, ctx.swap.balanceOut, ctx.swap.amountIn, wIn, wOut);
        } else {
            ctx.swap.amountIn = weightedIn(ctx.swap.balanceIn, ctx.swap.balanceOut, ctx.swap.amountOut, wIn, wOut);
        }
    }

    /// @dev amountOut = bOut * (1 - (bIn / (bIn + amountIn)) ^ (wIn / wOut)), floored.
    function weightedOut(uint256 bIn, uint256 bOut, uint256 amountIn, uint256 wIn, uint256 wOut)
        internal
        pure
        returns (uint256)
    {
        uint256 p = M.pow(bIn * WAD / (bIn + amountIn), wIn * WAD / wOut);
        return p >= WAD ? 0 : bOut * (WAD - p) / WAD;
    }

    /// @dev amountIn = bIn * ((bOut / (bOut - amountOut)) ^ (wOut / wIn) - 1), ceiled.
    function weightedIn(uint256 bIn, uint256 bOut, uint256 amountOut, uint256 wIn, uint256 wOut)
        internal
        pure
        returns (uint256)
    {
        if (amountOut >= bOut) revert CurveProbeInsufficientLiquidity();
        uint256 p = M.pow(Math.ceilDiv(bOut * WAD, bOut - amountOut), wOut * WAD / wIn);
        return p <= WAD ? 0 : Math.ceilDiv(bIn * (p - WAD), WAD);
    }

    // ------------------------------------------------------------------ fn 1/2: RMM-01

    function _rmm(Context memory ctx, bool riskyIsA, uint256 K, uint256 s, uint256 L) private pure {
        bool riskyIn = (ctx.query.tokenIn < ctx.query.tokenOut) == riskyIsA;
        if (ctx.query.isExactIn) {
            uint256 newIn = ctx.swap.balanceIn + ctx.swap.amountIn;
            uint256 newOut = riskyIn ? stableOf(newIn, K, s, L) : riskyOf(newIn, K, s, L);
            if (newOut > ctx.swap.balanceOut) revert CurveProbeInsufficientLiquidity();
            ctx.swap.amountOut = ctx.swap.balanceOut - newOut;
        } else {
            if (ctx.swap.amountOut > ctx.swap.balanceOut) revert CurveProbeInsufficientLiquidity();
            uint256 newOut = ctx.swap.balanceOut - ctx.swap.amountOut;
            uint256 newIn = riskyIn ? riskyOf(newOut, K, s, L) : stableOf(newOut, K, s, L);
            if (newIn < ctx.swap.balanceIn) revert CurveProbeInsufficientLiquidity();
            ctx.swap.amountIn = newIn - ctx.swap.balanceIn;
        }
    }

    /// @dev y(x) = L*K*Phi(Phi^-1(1 - x/L) - s), rounded up (favors the maker whether y is a new tokenOut or tokenIn reserve).
    function stableOf(uint256 x, uint256 K, uint256 s, uint256 L) internal pure returns (uint256) {
        uint256 r1 = Math.ceilDiv(x * WAD, L);
        if (r1 > WAD) revert CurveProbeInsufficientLiquidity();
        int256 z = G.icdf(WAD - r1) - int256(s);
        return Math.ceilDiv(L * K / WAD * G.cdf(z), WAD);
    }

    /// @dev x(y) = L*(1 - Phi(Phi^-1(y/(L*K)) + s)), rounded up.
    function riskyOf(uint256 y, uint256 K, uint256 s, uint256 L) internal pure returns (uint256) {
        uint256 lk = L * K / WAD;
        if (y > lk) revert CurveProbeInsufficientLiquidity();
        int256 z = G.icdf(y * WAD / lk) + int256(s);
        return Math.ceilDiv(L * (WAD - G.cdf(z)), WAD);
    }
}
