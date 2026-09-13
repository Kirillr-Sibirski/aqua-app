// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";

import { AquaSwapVMTestBase } from "../base/AquaSwapVMTestBase.sol";
import { StrikelineRouter } from "../../src/StrikelineRouter.sol";
import { ProbeRouter } from "../../src/spikes/ProbeRouter.sol";
import { SurfaceLens } from "../../src/SurfaceLens.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";
import { Gaussian } from "../../src/math/Gaussian.sol";
import { WadMath } from "../../src/math/WadMath.sol";

/// @title SurfaceLensTest
/// @notice The read layer, proven: a leg that exists only as bytes in an Aqua event comes back as a
///         priced option — strike, implied vol, expiry, mark, delta, premium and theta band — with no
///         oracle, no indexer and no cooperation from the maker who wrote it.
contract SurfaceLensTest is AquaSwapVMTestBase {
    StrikelineRouter internal sl;
    SurfaceLens internal lens;

    uint256 constant WALLET_WETH = 10.4e18;
    uint256 constant WALLET_USDC = 24_850e6;

    uint64 constant SIGMA = 0.6e18; // 60% annualised
    uint40 internal maturity;

    uint64 constant RATE_RISKY = 1;
    uint64 constant RATE_STABLE = 1e12;

    uint256 constant WAD = 1e18;

    function setUp() public override {
        super.setUp();
        sl = new StrikelineRouter(address(aqua), weth, address(this), "Strikeline", "1");
        vm.label(address(sl), "StrikelineRouter");
        router = ProbeRouter(payable(address(sl)));

        lens = new SurfaceLens(address(aqua), address(sl));
        vm.label(address(lens), "SurfaceLens");

        maturity = uint40(block.timestamp + 7 days);

        fund(weth, maker, WALLET_WETH);
        fund(address(usdc), maker, WALLET_USDC);
        fund(weth, taker, 50e18);
        fund(address(usdc), taker, 200_000e6);
        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    struct LegSpec {
        address maker;
        uint128 strikeWad;
        uint128 liquidityWad;
        uint64 sigmaWad;
        uint40 maturity;
        /// @dev Risky reserve to ship at; picks the moneyness. The stable side comes from `stableFor`.
        uint256 xWad;
        uint64 salt;
        bool guarded;
    }

    function _spec(uint128 strikeWad, uint128 liquidityWad, uint256 xWad, uint64 salt)
        internal
        view
        returns (LegSpec memory)
    {
        return LegSpec({
            maker: maker,
            strikeWad: strikeWad,
            liquidityWad: liquidityWad,
            sigmaWad: SIGMA,
            maturity: maturity,
            xWad: xWad,
            salt: salt,
            guarded: true
        });
    }

    /// @dev `Deadline . Coverage . RmmSwap . Salt`, or the bare curve when unguarded.
    function _program(LegSpec memory spec) internal view returns (bytes memory) {
        uint8 flags = (weth < address(usdc) ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0)
            | RmmSwap.FLAG_POST_EXPIRY_ONE_WAY | RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY;

        bytes memory curve = RmmSwap.build(
            RmmSwap.Args({
                flags: flags,
                sigmaWad: spec.sigmaWad,
                maturity: spec.maturity,
                strikeWad: spec.strikeWad,
                liquidityWad: spec.liquidityWad,
                rateRisky: RATE_RISKY,
                rateStable: RATE_STABLE
            })
        );

        if (!spec.guarded) {
            return bytes.concat(curve, Salt.build(spec.salt));
        }
        return bytes.concat(
            Deadline.build(uint40(spec.maturity + 30 minutes)), Coverage.build(0, 0), curve, Salt.build(spec.salt)
        );
    }

    /// @dev Ship a leg at reserves the chain itself says are on the curve, and return the exact bytes
    ///      Aqua's `Shipped` event carried, which is what the lens consumes.
    function _ship(LegSpec memory spec)
        internal
        returns (ISwapVM.Order memory order, bytes memory strategy, uint256 yWad)
    {
        order = buildAquaOrder(spec.maker, weth, address(usdc), _program(spec));
        yWad = sl.stableFor(spec.strikeWad, spec.sigmaWad, spec.maturity, spec.liquidityWad, spec.xWad);

        uint256 usdcAmount = yWad / RATE_STABLE;
        (address a,) = orderTokens(order);
        (uint256 amountA, uint256 amountB) = a == weth ? (spec.xWad, usdcAmount) : (usdcAmount, spec.xWad);
        shipOrder(spec.maker, order, amountA, amountB);
        strategy = abi.encode(order);
    }

    function _shipLeg(uint128 strikeWad, uint128 liquidityWad, uint256 xWad, uint64 salt)
        internal
        returns (ISwapVM.Order memory order, bytes memory strategy, uint256 yWad)
    {
        return _ship(_spec(strikeWad, liquidityWad, xWad, salt));
    }

    // ------------------------------------------------------------------ decoding

    /// @notice The terms of the option are recoverable from the shipped bytes alone. Nobody has to
    ///         publish them, and the maker cannot misreport them: the hash of the bytes is the
    ///         strategy's identity in Aqua.
    function test_Decode_RecoversTheTermsFromTheShippedBytes() public {
        (ISwapVM.Order memory order, bytes memory strategy,) = _shipLeg(2600e18, 12e18, 8.41e18, 1);

        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);

        assertTrue(leg.isLeg, "the program carries an RmmSwap instruction");
        assertTrue(leg.guarded, "and a Coverage wrapper");
        assertEq(leg.orderHash, sl.hash(order), "orderHash == Aqua strategyHash == router.hash(order)");
        assertEq(leg.orderHash, keccak256(strategy), "orderHash == keccak256(the shipped bytes)");
        assertEq(leg.maker, maker, "maker");
        assertEq(leg.app, address(sl), "app");

        assertEq(leg.strikeWad, 2600e18, "K");
        assertEq(leg.sigmaWad, SIGMA, "sigma");
        assertEq(leg.maturity, maturity, "maturity");
        assertEq(leg.liquidityWad, 12e18, "L");
        assertEq(leg.rateRisky, RATE_RISKY, "rateRisky");
        assertEq(leg.rateStable, RATE_STABLE, "rateStable");
        assertEq(leg.tokenRisky, weth, "risky token");
        assertEq(leg.tokenStable, address(usdc), "stable token");
        assertEq(leg.riskyIsTokenA, weth < address(usdc), "riskyIsTokenA");

        assertTrue(leg.live, "shipped and active");
        assertFalse(leg.docked, "not docked");
        assertEq(leg.reserveRisky, 8.41e18, "risky reserve");
        console2.log("decoded K / sigma / L:", leg.strikeWad, leg.sigmaWad, leg.liquidityWad);

        // The golden vector the TypeScript decoder in `web/src/hooks/strikeline.ts` is pinned to.
        // Two implementations read these bytes — Solidity and TypeScript — and a one-byte
        // disagreement between them would show a wrong strike on screen with no error.
        console2.log("golden strategy bytes:");
        console2.logBytes(strategy);
    }

    /// @notice The same leg, addressed as a decoded order instead of as raw bytes.
    function test_Decode_OrderAndStrategyAgree() public {
        (ISwapVM.Order memory order, bytes memory strategy,) = _shipLeg(2800e18, 10e18, 9.22e18, 2);

        SurfaceLens.Leg memory fromBytes = lens.legOfStrategy(strategy);
        SurfaceLens.Leg memory fromOrder = lens.legOfOrder(order);

        assertEq(fromOrder.orderHash, fromBytes.orderHash, "same identity");
        assertEq(fromOrder.strikeWad, fromBytes.strikeWad, "same strike");
        assertEq(fromOrder.markWad, fromBytes.markWad, "same mark");
    }

    /// @notice A leg shipped without the `Coverage` wrapper is decodable and priced, and says so. The
    ///         surface can therefore show which quotes on the book are actually margined.
    function test_Decode_FlagsAnUnguardedLeg() public {
        LegSpec memory spec = _spec(2800e18, 10e18, 9.22e18, 3);
        spec.guarded = false;
        (, bytes memory strategy,) = _ship(spec);

        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);
        assertTrue(leg.isLeg, "still a leg");
        assertFalse(leg.guarded, "but nothing margins it");
        assertTrue(leg.priced, "and it still prices");
    }

    // ------------------------------------------------------------------ pricing

    /// @notice The mark is the curve's own marginal price: buying costs more than it, selling receives
    ///         less than it. No oracle is consulted anywhere in the lens.
    function test_Mark_BracketsTheExecutedPrice() public {
        (ISwapVM.Order memory order, bytes memory strategy,) = _shipLeg(2600e18, 12e18, 8.41e18, 11);
        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);
        assertTrue(leg.priced, "priced");

        // Buy WETH with 2,000 USDC: the price paid must be at or above the marginal price.
        bytes memory buy = takerDataFor(order, address(usdc), true);
        (, uint256 wethOut,) = quote(order, 2000e6, buy);
        uint256 pricePaid = (2000e6 * uint256(RATE_STABLE)) * WAD / wethOut;

        // Sell 0.8 WETH for USDC: the price received must be at or below it.
        bytes memory sell = takerDataFor(order, weth, true);
        (, uint256 usdcOut,) = quote(order, 0.8e18, sell);
        uint256 priceGot = (usdcOut * uint256(RATE_STABLE)) * WAD / 0.8e18;

        assertGt(pricePaid, leg.markWad, "a buy must clear above the mark");
        assertLt(priceGot, leg.markWad, "a sell must clear below the mark");
        console2.log("sell / mark / buy:", priceGot, leg.markWad, pricePaid);
    }

    /// @notice The replication identity, checked against Black-Scholes by an algebraically different
    ///         route: the lens computes `C = S - V/L` from the reserves that are actually in Aqua, and
    ///         the test computes `C = S*Phi(d1) - K*Phi(d2)` from the terms. They are the same number,
    ///         which is what "the position IS a covered call" means.
    /// @dev The 1e-8 tolerance is the granularity of the shipped stable reserve, not a fudge: `y` is
    ///      rounded down to whole USDC at ship time, and the lens prices what is actually there.
    function test_Premium_EqualsBlackScholesOnTheSameReserves() public {
        uint128 K = 2600e18;
        uint128 L = 12e18;
        uint256 x = 8.41e18;
        (, bytes memory strategy,) = _shipLeg(K, L, x, 12);

        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);
        assertTrue(leg.priced, "priced");
        assertGt(leg.premiumWad, 0, "a live covered call is worth something");

        uint256 s = uint256(SIGMA) * WadMath.sqrt(leg.tauWad) / WAD;
        int256 d1 = Gaussian.icdf(WAD - x * WAD / L);
        int256 d2 = d1 - int256(s);
        uint256 bs = leg.markWad * Gaussian.cdf(d1) / WAD - uint256(K) * Gaussian.cdf(d2) / WAD;

        assertApproxEqRel(uint256(leg.premiumWad), bs, 1e10, "measured premium == Black-Scholes call");
        console2.log("premium (USDC per WETH), lens vs Black-Scholes:", uint256(leg.premiumWad), bs);
        console2.log("total premium written by the leg (USDC):", uint256(leg.premiumWad) * L / WAD / WAD);
    }

    /// @notice A hard external reference. At the shipped reserve point the curve implies a spot of
    ///         2,480.0709577678 USDC, and a 7-day 2,600 call at 60% vol on that spot is worth
    ///         37.4392634702 USDC by a double-precision Black-Scholes evaluated off-chain. The chain
    ///         returns 37.4393586155.
    /// @dev The 1e-5 tolerance is the honest error bar of the approximated `Phi`: the measured
    ///      disagreement is 2.5e-6 relative, which is 0.0001 USDC on a 37.44 USDC premium, and sits
    ///      right on the documented composite `Phi^-1 -> Phi` round-trip error of 1.18e-6.
    function test_Premium_MatchesAnOffChainReference() public {
        (, bytes memory strategy,) = _shipLeg(2600e18, 12e18, 8.41e18, 13);
        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);

        assertApproxEqRel(leg.markWad, 2480.0709577678304556e18, 1e10, "mark at the shipped reserve point");
        assertApproxEqRel(uint256(leg.premiumWad), 37.43926347015827e18, 1e13, "premium against an off-chain BS");
    }

    /// @notice Delta is not modelled, it is read: `dV/dS = L*(1 - Phi(d1)) = X`, so a leg's delta in
    ///         risky units is its risky reserve, and per unit of liquidity it is `X/L`.
    function test_Delta_IsTheRiskyReserve() public {
        uint128 L = 12e18;
        uint256 x = 8.41e18;
        (, bytes memory strategy,) = _shipLeg(2600e18, L, x, 14);
        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);

        assertEq(leg.deltaWad, x * WAD / L, "delta == X/L");
        assertApproxEqAbs(leg.deltaWad * L / WAD, x, 8, "delta * L == the risky reserve, to the wei");
        assertLt(leg.deltaWad, WAD, "a covered call is less than 100 delta");
        console2.log("delta (risky per unit L):", leg.deltaWad);
    }

    /// @notice The theta band the lens publishes is the same number the router's own view publishes,
    ///         converted to the raw units a caller would actually send.
    function test_Band_AgreesWithTheRouterView() public {
        uint128 K = 2600e18;
        uint128 L = 12e18;
        uint256 x = 8.41e18;
        (, bytes memory strategy,) = _shipLeg(K, L, x, 15);

        vm.warp(block.timestamp + 2 days);

        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);
        // `bandFor` takes the reserves as arguments; the lens reads them from Aqua. Feed it the same
        // numbers the lens found, which is the shipped stable side after its round-down to whole USDC.
        (uint256 minRiskyIn, uint256 minStableIn) =
            sl.bandFor(K, SIGMA, maturity, L, leg.reserveRisky * RATE_RISKY, leg.reserveStable * RATE_STABLE);

        assertGt(leg.minStableIn, 0, "two days of decay opens a band");
        assertEq(leg.minStableIn, (minStableIn + RATE_STABLE - 1) / RATE_STABLE, "stable side, raw units");
        assertEq(leg.minRiskyIn, (minRiskyIn + RATE_RISKY - 1) / RATE_RISKY, "risky side, raw units");
        console2.log("band after 2 days (USDC):", leg.minStableIn);
    }

    /// @notice After maturity the curve is constant-sum at the strike, so the mark is the strike
    ///         exactly, and what is left of the premium is precisely the theta the leg accrued and
    ///         nobody has collected yet: `premium * L == the stable-side band`, plus the one thing the
    ///         band must carry that the premium does not — `RmmSwap`'s own guard band, which `exec`
    ///         requires on top of the curve before it will clear anything.
    function test_Matured_MarkCollapsesToTheStrikeAndThePremiumIsTheUncollectedTheta() public {
        uint128 K = 2600e18;
        uint128 L = 12e18;
        (, bytes memory strategy,) = _shipLeg(K, L, 8.41e18, 16);

        vm.warp(uint256(maturity) + 1);
        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);

        assertTrue(leg.matured, "matured");
        assertEq(leg.tauWad, 0, "tau == 0");
        assertEq(leg.markWad, K, "the mark is the strike, exactly");

        uint256 accrued = uint256(leg.premiumWad) * L / WAD; // normalised stable
        uint256 guard = uint256(L) * K / WAD * RmmSwap.EPS / WAD; // `exec`'s epsOut, stable side
        // Exact to under one raw USDC wei: the only slack is the two ceil roundings between them.
        assertApproxEqAbs(
            leg.minStableIn * RATE_STABLE,
            accrued + guard,
            RATE_STABLE,
            "band == uncollected theta + the exec guard band"
        );
        console2.log("theta waiting for the first assignment (USDC):", leg.minStableIn);
    }

    /// @notice Time alone, with no transaction and no fill, moves the curve away from the reserves.
    ///         The band that opens is the toll the next arbitrageur pays, and the lens publishes it.
    function test_Theta_TheBandOpensWithNoTransaction() public {
        (, bytes memory strategy,) = _shipLeg(2600e18, 12e18, 8.41e18, 17);

        SurfaceLens.Leg memory before = lens.legOfStrategy(strategy);
        vm.warp(block.timestamp + 2 days);
        SurfaceLens.Leg memory afterWarp = lens.legOfStrategy(strategy);

        assertEq(afterWarp.reserveRisky, before.reserveRisky, "nothing traded");
        assertEq(afterWarp.reserveStable, before.reserveStable, "nothing traded");
        assertLt(afterWarp.tauWad, before.tauWad, "time passed");
        assertGt(afterWarp.minStableIn, before.minStableIn, "and the band has opened on the stable side");
        assertGt(afterWarp.minRiskyIn, before.minRiskyIn, "and on the risky side");
        // Delta is a function of the reserves alone, so a leg nobody traded has not re-hedged itself.
        assertEq(afterWarp.deltaWad, before.deltaWad, "delta is the reserve, and the reserve did not move");
        console2.log("band, t0 vs +2 days (USDC):", before.minStableIn, afterWarp.minStableIn);
    }

    // ------------------------------------------------------------------ the book

    /// @notice The whole book in one call: four legs, four strikes, one wallet. This is the shape a UI
    ///         or a solver consumes, and it costs one `eth_call`.
    function test_Book_PricesTheWholeLadderInOneCall() public {
        bytes[] memory strategies = new bytes[](4);
        (, strategies[0],) = _shipLeg(2600e18, 12e18, 8.41e18, 21);
        (, strategies[1],) = _shipLeg(2800e18, 10e18, 9.22e18, 22);
        (, strategies[2],) = _shipLeg(3000e18, 10e18, 9.88e18, 23);
        (, strategies[3],) = _shipLeg(2300e18, 6e18, 1.03e18, 24);

        uint256 gasBefore = gasleft();
        SurfaceLens.Leg[] memory legs = lens.book(strategies);
        uint256 used = gasBefore - gasleft();

        assertEq(legs.length, 4, "four legs");
        uint128[4] memory strikes = [uint128(2600e18), 2800e18, 3000e18, 2300e18];
        for (uint256 i = 0; i < 4; i++) {
            assertTrue(legs[i].isLeg, "decoded");
            assertTrue(legs[i].priced, "priced");
            assertTrue(legs[i].live, "live");
            assertEq(legs[i].strikeWad, strikes[i], "strike");
            // One wallet backs all four, so every leg reports the same free balance.
            assertEq(legs[i].freeRisky, WALLET_WETH, "shared WETH");
        }

        // The ladder is over-allocated on purpose: 28.54 WETH of virtual reserve on 10.4 real.
        uint256 virtualRisky;
        for (uint256 i = 0; i < 4; i++) {
            virtualRisky += legs[i].reserveRisky;
        }
        assertGt(virtualRisky, WALLET_WETH, "notional exceeds the wallet, which is the point");
        console2.log("virtual WETH across the book:", virtualRisky, "real:", WALLET_WETH);
        console2.log("gas to price 4 legs in one call:", used);
    }

    /// @notice A fill on one leg shrinks what every sibling can deliver, in the same block, and the read
    ///         layer shows it without asking any of them. Before the fill each sibling's own reserve is
    ///         the binding constraint; after it, the shared wallet is.
    function test_Book_OneFillShrinksEverySiblingsDepth() public {
        bytes[] memory strategies = new bytes[](3);
        ISwapVM.Order memory leg1;
        (leg1, strategies[0],) = _shipLeg(2600e18, 12e18, 8.41e18, 31);
        (, strategies[1],) = _shipLeg(2800e18, 10e18, 9.22e18, 32);
        (, strategies[2],) = _shipLeg(3000e18, 10e18, 9.88e18, 33);

        SurfaceLens.Leg[] memory before = lens.book(strategies);
        assertEq(before[1].deliverableRisky, 9.22e18, "sibling 2 is capped by its own reserve");
        assertEq(before[2].deliverableRisky, 9.88e18, "sibling 3 is capped by its own reserve");

        // Take 5 WETH out of the shared wallet through leg 1.
        swapAs(taker, leg1, 5e18, takerDataFor(leg1, address(usdc), false));

        SurfaceLens.Leg[] memory afterFill = lens.book(strategies);
        assertEq(afterFill[1].freeRisky, WALLET_WETH - 5e18, "the wallet behind all three shrank");
        assertEq(afterFill[1].deliverableRisky, WALLET_WETH - 5e18, "sibling 2 is now capped by the wallet");
        assertEq(afterFill[2].deliverableRisky, WALLET_WETH - 5e18, "sibling 3 is now capped by the wallet");
        assertEq(afterFill[1].reserveRisky, before[1].reserveRisky, "sibling 2's own reserve never moved");
        assertEq(afterFill[2].reserveRisky, before[2].reserveRisky, "sibling 3's own reserve never moved");
        console2.log("sibling depth before / after:", before[1].deliverableRisky, afterFill[1].deliverableRisky);
    }

    /// @notice A docked leg reports itself docked, with nothing left to deliver — and, crucially,
    ///         nothing priced. Aqua zeroes the reserves on dock, and `d1 = Phi^-1(1 - 0/L)` is the
    ///         `icdf` clamp at +8, not a price: pricing it anyway printed a 5,036 USDC mark on a
    ///         2,600 call, equal to its own premium, on a strategy that can never be filled again.
    function test_Book_ReportsADockedLeg() public {
        (ISwapVM.Order memory order, bytes memory strategy,) = _shipLeg(2600e18, 12e18, 8.41e18, 34);
        dockOrder(maker, order);

        SurfaceLens.Leg memory leg = lens.legOfStrategy(strategy);
        assertTrue(leg.isLeg, "the bytes still decode");
        assertTrue(leg.docked, "docked");
        assertFalse(leg.live, "not live");
        assertEq(leg.reserveRisky, 0, "no reserve");
        assertEq(leg.deliverableRisky, 0, "and nothing deliverable");

        assertFalse(leg.priced, "and nothing priced");
        assertEq(leg.markWad, 0, "no mark");
        assertEq(leg.deltaWad, 0, "no delta");
        assertEq(leg.premiumWad, 0, "no premium");
        assertEq(leg.minStableIn, 0, "and no band, because no fill can ever pay it");
    }

    // ------------------------------------------------------------------ hostile input

    /// @notice The input is a public event log, so it contains strategies that are not Strikeline legs
    ///         and bytes that are not strategies at all. One bad entry must not take the book down.
    function test_Book_IsolatesEntriesItCannotDecode() public {
        bytes[] memory strategies = new bytes[](4);
        (, strategies[0],) = _shipLeg(2600e18, 12e18, 8.41e18, 41);

        // A perfectly valid Aqua strategy on the same router that is simply not an option.
        ISwapVM.Order memory xyc =
            buildAquaOrder(maker, weth, address(usdc), bytes.concat(XYCSwap.build(), Salt.build(42)));
        shipOrder(maker, xyc, 1e18, 2500e6);
        strategies[1] = abi.encode(xyc);

        strategies[2] = hex"deadbeef"; // not an ABI-encoded order at all
        (, strategies[3],) = _shipLeg(2800e18, 10e18, 9.22e18, 43);

        SurfaceLens.Leg[] memory legs = lens.book(strategies);

        assertTrue(legs[0].isLeg && legs[0].priced, "leg 0 survives");
        assertFalse(legs[1].isLeg, "an XYC strategy is not a leg");
        assertEq(legs[1].orderHash, keccak256(strategies[1]), "but it is still identified");
        assertFalse(legs[2].isLeg, "garbage is not a leg");
        assertEq(legs[2].orderHash, keccak256(strategies[2]), "and is still identified");
        assertTrue(legs[3].isLeg && legs[3].priced, "leg 3 survives");
    }

    /// @notice Addressed one at a time, the same inputs revert with a named reason rather than
    ///         returning a zeroed struct that a caller might read as real.
    function test_Single_RevertsOnAStrategyThatIsNotALeg() public {
        ISwapVM.Order memory xyc =
            buildAquaOrder(maker, weth, address(usdc), bytes.concat(XYCSwap.build(), Salt.build(44)));
        vm.expectRevert(SurfaceLens.NotAStrikelineLeg.selector);
        lens.legOfStrategy(abi.encode(xyc));
    }

    /// @notice A leg that was never shipped decodes and reports zero depth: the terms are public the
    ///         moment the bytes exist, and the reserves say whether anyone stands behind them.
    function test_Single_DecodesAnUnshippedLeg() public view {
        ISwapVM.Order memory order =
            buildAquaOrder(maker, weth, address(usdc), _program(_spec(2600e18, 12e18, 8.41e18, 45)));

        SurfaceLens.Leg memory leg = lens.legOfOrder(order);
        assertTrue(leg.isLeg, "decoded from bytes that were never shipped");
        assertEq(leg.strikeWad, 2600e18, "terms are readable regardless");
        assertEq(leg.tokensCount, 0, "never shipped");
        assertFalse(leg.live, "not live");
        assertEq(leg.reserveRisky, 0, "no reserve");
    }

    /// @notice The program scanner walks `[opcode][argsLength][args]` exactly, so it finds the curve
    ///         wherever in the program it sits and reports the wrapper independently.
    function test_DecodeProgram_FindsTheCurveAnywhereInTheProgram() public view {
        bytes memory withPrefix = bytes.concat(
            Deadline.build(uint40(maturity + 30 minutes)),
            Salt.build(99),
            Coverage.build(0, 0),
            RmmSwap.build(
                RmmSwap.Args({
                    flags: RmmSwap.FLAG_RISKY_IS_TOKEN_A,
                    sigmaWad: 0.42e18,
                    maturity: 1_800_000_000,
                    strikeWad: 4321e18,
                    liquidityWad: 7e18,
                    rateRisky: 1,
                    rateStable: 1e12
                })
            )
        );

        (RmmSwap.Args memory args, bool found, bool guarded) = lens.decodeProgram(withPrefix);
        assertTrue(found, "found the curve after three other instructions");
        assertTrue(guarded, "and the wrapper");
        assertEq(args.sigmaWad, 0.42e18, "sigma");
        assertEq(args.maturity, 1_800_000_000, "maturity");
        assertEq(args.strikeWad, 4321e18, "strike");
        assertEq(args.liquidityWad, 7e18, "liquidity");
    }

    /// @notice A truncated instruction stream is rejected, not silently half-read.
    function test_DecodeProgram_RejectsATruncatedStream() public {
        vm.expectRevert(abi.encodeWithSelector(SurfaceLens.ProgramMalformed.selector, 0));
        lens.decodeProgram(hex"5540"); // opcode 0x55, argsLength 0x40, no args
    }

    // ------------------------------------------------------------------ the surface

    /// @notice What the surface screen is: every live leg on the router, decoded into a
    ///         (strike, expiry, implied vol) point with a maker attached and a depth behind it.
    ///         Aqua has no order book, so this is the only place that quote exists.
    function test_Surface_RanksMakersAtOneStrikeAndExpiry() public {
        address maker2 = makeAddr("maker2");
        fund(weth, maker2, 4.2e18);
        fund(address(usdc), maker2, 9000e6);

        bytes[] memory strategies = new bytes[](3);
        (, strategies[0],) = _shipLeg(2800e18, 10e18, 9.22e18, 51); // our maker, 60% vol

        // A second maker writes the same strike and expiry at a wider vol, so they pay more theta.
        LegSpec memory wider = _spec(2800e18, 4e18, 3.4e18, 52);
        wider.maker = maker2;
        wider.sigmaWad = 0.8e18;
        (, strategies[1],) = _ship(wider);

        // A third leg at a different strike: it must not be mistaken for a quote on this one.
        (, strategies[2],) = _shipLeg(3000e18, 10e18, 9.88e18, 53);

        SurfaceLens.Leg[] memory legs = lens.book(strategies);

        assertEq(legs[0].maker, maker, "leg 0 maker");
        assertEq(legs[1].maker, maker2, "leg 1 is a different maker on the same strike");
        assertEq(legs[0].strikeWad, legs[1].strikeWad, "same strike");
        assertEq(legs[0].maturity, legs[1].maturity, "same expiry");
        assertGt(legs[1].sigmaWad, legs[0].sigmaWad, "maker 2 quotes the wider vol");
        assertGt(legs[1].premiumWad, legs[0].premiumWad, "and therefore the richer premium");
        assertEq(legs[1].freeRisky, 4.2e18, "each maker's depth is their own wallet");
        assertNotEq(legs[2].strikeWad, legs[0].strikeWad, "the 3000 leg is a different point");

        console2.log(
            "2800 / 7d premium, maker 1 vs maker 2:", uint256(legs[0].premiumWad), uint256(legs[1].premiumWad)
        );
    }

    /// @notice The other axis of the surface means something too: at the same strike and the same
    ///         moneyness, a longer-dated leg carries the richer premium. That is a term structure,
    ///         read out of an event log.
    function test_Surface_TermStructureIsRicherAtTheLongerExpiry() public {
        uint128 K = 2800e18;
        uint128 L = 10e18;
        uint256 x = 9.22e18; // same X/L, so both legs sit at the same point on their own curve

        (, bytes memory near,) = _shipLeg(K, L, x, 61);

        LegSpec memory far = _spec(K, L, x, 62);
        far.maturity = uint40(block.timestamp + 21 days);
        (, bytes memory farStrategy,) = _ship(far);

        SurfaceLens.Leg memory a = lens.legOfStrategy(near);
        SurfaceLens.Leg memory b = lens.legOfStrategy(farStrategy);

        assertEq(a.strikeWad, b.strikeWad, "same strike");
        assertEq(a.sigmaWad, b.sigmaWad, "same vol");
        assertEq(a.deltaWad, b.deltaWad, "same delta, by construction");
        assertGt(b.tauWad, a.tauWad, "one is three weeks out, the other one");
        assertGt(b.premiumWad, a.premiumWad, "and time is what an option is made of");
        console2.log("7d vs 21d premium (USDC per WETH):", uint256(a.premiumWad), uint256(b.premiumWad));
    }
}
