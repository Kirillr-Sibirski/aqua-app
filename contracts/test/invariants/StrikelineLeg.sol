// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { AquaSwapVMTestBase } from "../base/AquaSwapVMTestBase.sol";
import { StrikelineRouter } from "../../src/StrikelineRouter.sol";
import { ProbeRouter } from "../../src/spikes/ProbeRouter.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title StrikelineLeg
/// @notice Shared fixture for `test/invariants/`: one shipped Strikeline leg on the official Aqua flow, plus the
///         numerical error budget every tolerance in this directory is derived from.
///
/// @dev The budget is stated once, here, and every tolerance downstream is an arithmetic consequence of it.
///      Nothing in this directory carries a hand-tuned epsilon.
///
///      MEASURED PRIMITIVES (`test/probe/MathPrimitives.t.sol`, references from 50-digit mpmath):
///
///        EPS_PHI     = 6.95e-8   absolute error of `Gaussian.cdf`, in probability units, over [-8, 8]
///        EPS_PHI_INV = 1.18e-6   absolute error of the `Gaussian.icdf` round trip, in z units
///
///      ONE CURVE EVALUATION. `stableOf` is `L*K*Phi(Phi^-1(1 - X/L) - s)`: the argument error `EPS_PHI_INV`
///      enters through the outer `Phi`, so it is multiplied by that function's density, and the outer `Phi`
///      then adds its own `EPS_PHI`:
///
///        EPS_EVAL = EPS_PHI + sup(phi) * EPS_PHI_INV
///                 = 6.95e-8 + 0.39894 * 1.18e-6
///                 = 5.40251890873e-7          (normalised; multiply by L for risky units, by L*K for stable)
///
///      A ROUND TRIP (`riskyOf(stableOf(x))`, which is exactly what exact-in followed by exact-out performs) is
///      two evaluations, so `EPS_ROUNDTRIP = 2 * EPS_EVAL = 1.080503781746e-6`.
///
///      THAT IS WHY `RmmSwap.EPS` IS 2e-6. The guard band the instruction charges is 1.85x the round-trip error
///      bound, so numerical error can never eat into the maker's side of a fill: a quote is wrong in the maker's
///      favour or not at all. `test_Eps_DominatesTheRoundTripErrorBound` asserts that ratio, so shrinking `EPS`
///      below the error budget fails the suite instead of silently making dust fills lossy for the maker.
abstract contract StrikelineLeg is AquaSwapVMTestBase {
    // ------------------------------------------------------------------ error budget

    /// @dev 6.95e-8 in WAD: measured |Phi~ - Phi| on [-8, 8].
    uint256 internal constant EPS_PHI = 69_500_000_000;
    /// @dev 1.18e-6 in WAD: measured Phi^-1 round-trip error, in z units.
    uint256 internal constant EPS_PHI_INV = 1_180_000_000_000;
    /// @dev sup phi(z) = 1/sqrt(2*pi), WAD.
    uint256 internal constant PHI_PEAK = 398_942_280_401_432_677;
    /// @dev One curve evaluation, normalised (5.40251890873e-7 WAD).
    uint256 internal constant EPS_EVAL = EPS_PHI + PHI_PEAK * EPS_PHI_INV / 1e18;
    /// @dev Exact-in then exact-out is two evaluations (1.080503781746e-6 WAD).
    uint256 internal constant EPS_ROUNDTRIP = 2 * EPS_EVAL;

    // ------------------------------------------------------------------ the leg

    StrikelineRouter internal sl;

    /// @dev The demo book's first leg, and the demo wallet behind it. Irregular on purpose.
    uint256 internal constant WALLET_WETH = 10.4e18;
    uint256 internal constant WALLET_USDC = 24_850e6;

    uint128 internal constant K = 2600e18;
    uint128 internal constant L = 12e18;
    uint256 internal constant X0 = 8.41e18;
    uint64 internal constant SIGMA = 0.6e18;

    /// @dev USDC is 6 decimals, WETH is 18; the curve works in normalised WAD space.
    uint64 internal constant RATE_RISKY = 1;
    uint64 internal constant RATE_STABLE = 1e12;

    uint40 internal maturity;

    function setUp() public virtual override {
        super.setUp();
        sl = new StrikelineRouter(address(aqua), weth, address(this), "Strikeline", "1");
        vm.label(address(sl), "StrikelineRouter");
        // The base helpers drive `router`; point them at the Strikeline router.
        router = ProbeRouter(payable(address(sl)));

        maturity = uint40(block.timestamp + 7 days);

        fund(weth, maker, WALLET_WETH);
        fund(address(usdc), maker, WALLET_USDC);
        // The taker is not the subject of any invariant here, so it is funded past every path the suite walks.
        fund(weth, taker, 137.6e18);
        fund(address(usdc), taker, 412_300e6);
        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);
    }

    // ------------------------------------------------------------------ programs

    /// @dev One leg: `Deadline . Coverage . RmmSwap . Salt`, the exact shape `StrikelineRouter` documents.
    function legProgram(uint128 strikeWad, uint128 liquidityWad, uint64 salt) internal view returns (bytes memory) {
        return legProgramAround(Coverage.build(0, 0), "", strikeWad, liquidityWad, salt);
    }

    /// @dev The same leg with the guard supplied VERBATIM and an optional wrapper spliced between it and the
    ///      curve: `Deadline . <guard> . <middle> . RmmSwap . Salt`.
    ///
    ///      Passing the guard as bytes rather than as arguments is what lets a test encode a `Coverage`
    ///      argument that `Coverage.build` refuses to produce. That is not a hypothetical: Aqua ships program
    ///      bytes without reading them, so the wire can carry values the encoder would never emit, and the
    ///      instruction has to defend the wire rather than the builder.
    function legProgramAround(
        bytes memory guard,
        bytes memory middle,
        uint128 strikeWad,
        uint128 liquidityWad,
        uint64 salt
    )
        internal
        view
        returns (bytes memory)
    {
        bytes memory head = bytes.concat(Deadline.build(uint40(maturity + 30 minutes)), guard, middle);
        return bytes.concat(head, curveOf(strikeWad, liquidityWad), Salt.build(salt));
    }

    /// @dev The `RmmSwap` instruction of a covered-call leg, on its own.
    function curveOf(uint128 strikeWad, uint128 liquidityWad) internal view returns (bytes memory) {
        return RmmSwap.build(
            RmmSwap.Args({
                flags: legFlags(),
                sigmaWad: SIGMA,
                maturity: maturity,
                strikeWad: strikeWad,
                liquidityWad: liquidityWad,
                rateRisky: RATE_RISKY,
                rateStable: RATE_STABLE
            })
        );
    }

    /// @dev A covered call: the curve runs risky-side-first if WETH sorted low, and past maturity the leg only
    ///      delivers the risky token, which is assignment rather than a free at-the-money straddle.
    function legFlags() internal view returns (uint8) {
        return (weth < address(usdc) ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0) | RmmSwap.FLAG_POST_EXPIRY_ONE_WAY
            | RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY;
    }

    /// @dev The bare curve with no `Coverage` wrapper, used to price what each instruction costs on its own.
    function bareProgram(uint128 strikeWad, uint128 liquidityWad, uint64 salt) internal view returns (bytes memory) {
        uint8 flags = weth < address(usdc) ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0;
        return bytes.concat(
            RmmSwap.build(
                RmmSwap.Args({
                    flags: flags,
                    sigmaWad: SIGMA,
                    maturity: maturity,
                    strikeWad: strikeWad,
                    liquidityWad: liquidityWad,
                    rateRisky: RATE_RISKY,
                    rateStable: RATE_STABLE
                })
            ),
            Salt.build(salt)
        );
    }

    // ------------------------------------------------------------------ shipping

    /// @notice Ship a leg with the reserves THIS CHAIN says are on the curve.
    /// @dev `xWad` picks the moneyness; `y` must come from `stableFor` or the strategy is bricked for good.
    function shipLeg(
        bytes memory program,
        uint128 strikeWad,
        uint128 liquidityWad,
        uint256 xWad
    )
        internal
        returns (ISwapVM.Order memory order, bytes32 hash_, uint256 yWad)
    {
        order = buildAquaOrder(maker, weth, address(usdc), program);
        yWad = sl.stableFor(strikeWad, SIGMA, maturity, liquidityWad, xWad);

        uint256 usdcAmount = yWad / RATE_STABLE;
        (address a,) = orderTokens(order);
        (uint256 amountA, uint256 amountB) = a == weth ? (xWad, usdcAmount) : (usdcAmount, xWad);
        hash_ = shipOrder(maker, order, amountA, amountB);
    }

    /// @notice The demo leg: `Deadline . Coverage . RmmSwap . Salt`, K = 2600, L = 12, x = 8.41 WETH.
    function shipDemoLeg(uint64 salt) internal returns (ISwapVM.Order memory order, bytes32 hash_, uint256 yWad) {
        return shipLeg(legProgram(K, L, salt), K, L, X0);
    }

    // ------------------------------------------------------------------ raw calls

    /// @notice A `quote` that returns the revert bytes instead of bubbling them.
    /// @dev Needed wherever the assertion is about the DECODED ERROR AND ITS ARGUMENTS rather than about the
    ///      selector alone. `vm.expectRevert` compares, it does not hand the bytes back, so it cannot express
    ///      "these two programs must refuse with byte-identical arguments".
    function quoteRaw(
        ISwapVM.Order memory order,
        uint256 amount,
        bytes memory takerTraitsAndData
    )
        internal
        view
        returns (bool ok, bytes memory ret)
    {
        (ok, ret) = address(sl).staticcall(abi.encodeCall(ISwapVM.quote, (order, amount, takerTraitsAndData)));
    }

    // ------------------------------------------------------------------ derived tolerances

    /// @notice The exact-in -> exact-out round-trip tolerance for `tokenIn`, in `tokenIn`'s own units.
    ///
    /// @dev `EPS_ROUNDTRIP` is normalised, so it scales with the reserve the input lands in: `L` on the risky
    ///      side, `L*K` on the stable side. Dividing by the leg's `rate` converts normalised WAD into token
    ///      units. The `+ 2` covers the two quantisations the VM performs once each: the exact-in `amountOut`
    ///      is floored to whole `tokenOut` units, and the exact-out `amountIn` is ceiled to whole `tokenIn`
    ///      units. Nothing else is added.
    function symmetryToleranceFor(
        address tokenIn,
        uint128 strikeWad,
        uint128 liquidityWad
    )
        internal
        view
        returns (uint256)
    {
        bool riskyIn = tokenIn == weth;
        uint256 scaleIn = riskyIn ? uint256(liquidityWad) : uint256(liquidityWad) * strikeWad / 1e18;
        uint256 rateIn = riskyIn ? RATE_RISKY : RATE_STABLE;
        return Math.ceilDiv(scaleIn * EPS_ROUNDTRIP / 1e18, rateIn) + 2;
    }
}
