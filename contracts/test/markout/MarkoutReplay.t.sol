// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { AquaSwapVMTestBase } from "../base/AquaSwapVMTestBase.sol";
import { ProbeRouter } from "../../src/spikes/ProbeRouter.sol";
import { StrikelineRouter } from "../../src/StrikelineRouter.sol";
import { RmmSwap } from "../../src/instructions/RmmSwap.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";
import { Gaussian } from "../../src/math/Gaussian.sol";
import { WadMath } from "../../src/math/WadMath.sol";

import { ConstantProduct } from "./ConstantProduct.sol";
import { Fmt } from "./Fmt.sol";

/// @title MarkoutReplayTest
/// @notice THIS IS A SIMULATION. It is a model of one book run over one replayed price series. It is not
///         a track record, it is not a backtest of a deployed product, and no capital was ever at risk in
///         producing any number it prints.
///
/// @dev Two readers of this project asked for the same artifact in almost the same words. An options
///      trader: "if they can show realised theta over a few hundred fills versus a straight hold, I'd
///      look again." A liquidity provider: "the thing I actually need is the comparison, and it is
///      absent." This is that comparison, and it is built so that it can lose.
///
///      WHAT IS REAL HERE.
///      The price path is real: `contracts/test/markout/tape.json` is 169 hourly samples of the Chainlink
///      ETH/USD rounds actually published on Base, captured at a pinned block by `scripts/arb/capture.ts`
///      and resampled by `scripts/markout/tape.ts`. `setUp` re-reads the source file and asserts its
///      `keccak256` before a single price is used. The curve is real: every quote and every fill in this
///      test goes through `StrikelineRouter` and the Aqua registry, priced by the deployed `RmmSwap`
///      bytecode with its own approximated `Phi` and its own guard band, and settled by `Coverage`
///      against the maker's actual wallet balance.
///
///      WHAT IS A MODEL.
///      The order flow. There is exactly one taker, an arbitrageur who at every hourly step moves each
///      leg to the reserve the current spot implies, and takes nothing else. Real books also see
///      uninformed flow, which pays the maker more; real arbitrageurs compete, fail, and pay priority
///      fees, which pays the maker less. Neither is modelled. The constant-product control is Uniswap
///      v2's arithmetic rather than a deployed pool (see `ConstantProduct.sol`).
///
///      HOW THE RESULT IS DECOMPOSED, EXACTLY.
///      The maker's mark is `V = W*S + U` for wallet balances `W` (ETH) and `U` (USD). Between two steps
///      that is identically
///
///          V_i - V_{i-1}  =  W_{i-1}*(S_i - S_{i-1})   +   (dW_i*S_i + dU_i)
///                            ^ price effect on inventory   ^ markout of the fills that happened
///
///      and holding is `H_i - H_{i-1} = W_0*(S_i - S_{i-1})`. So
///
///          Strikeline - hold  =  (fill markout)  +  sum (W_{i-1} - W_0) * (S_i - S_{i-1})
///
///      The first term is what the takers paid the maker. The second is the upside the maker gave up by
///      selling ETH into the rise, which is what writing a call is. `test_Markout_DecompositionIsExact`
///      asserts the identity to the wei rather than asserting it in a comment.
contract MarkoutReplayTest is AquaSwapVMTestBase {
    using ConstantProduct for ConstantProduct.Pool;
    using Fmt for int256;
    using Fmt for string;

    // ------------------------------------------------------------------ the book

    /// @dev The published demo book, unchanged: three covered calls above spot and one cash-secured put
    ///      below it, all backed by one wallet. Not chosen for this study.
    uint256 internal constant WALLET_WETH = 10.4e18;
    uint256 internal constant WALLET_USDC = 24_850e6;
    uint64 internal constant SIGMA = 0.6e18; // 60% annualised, the demo book's own number
    uint256 internal constant EXPIRY_DAYS = 7;

    uint64 internal constant RATE_RISKY = 1; // WETH, 18 decimals
    uint64 internal constant RATE_STABLE = 1e12; // USDC, 6 decimals
    uint256 internal constant WAD = 1e18;

    /// @dev The measured cost of one fill: `docs/OPCODES.md`'s 211,317 gas at Base's 0.005 gwei. It is
    ///      about a quarter of a cent and gates nothing, but both venues are charged it, so neither is
    ///      quietly handed free arbitrage flow the other has to pay for.
    uint256 internal constant GAS_PER_FILL = 211_317;
    uint256 internal constant GAS_PRICE_WEI = 5e6;

    /// @dev Fee tiers for the control. 5 bps is Base's deepest ETH/USDC v3 tier, 30 bps a classic v2 pool.
    ///      Both are published, because picking the flattering one is the thing this study exists to avoid.
    uint256 internal constant CP_FEE_LOW_BPS = 5;
    uint256 internal constant CP_FEE_HIGH_BPS = 30;

    struct LegSpec {
        bool isCall;
        uint128 strikeWad;
        uint128 liquidityWad;
        string label;
    }

    struct Leg {
        LegSpec spec;
        bytes32 hash;
        ISwapVM.Order order;
    }

    StrikelineRouter internal sl;
    Leg[] internal legs;
    uint40 internal maturity;

    // ------------------------------------------------------------------ the tape

    uint256[] internal tapeT;
    uint256[] internal tapePriceWad;
    string internal tapeFeed;
    string internal tapeFeedDescription;
    uint256 internal tapeChainId;
    uint256 internal tapeReadAtBlock;
    uint256 internal tapeSourceRounds;

    // ------------------------------------------------------------------ results

    struct Series {
        uint256[] t;
        uint256[] spot6;
        int256[] strikeline6;
        int256[] hodl6;
        int256[] cpLow6;
        int256[] cpHigh6;
        int256[] markout6;
        int256[] upside6;
        uint256[] weth6;
        uint256[] fills;
    }

    struct Run {
        uint64 sigmaWad;
        uint256 attempts;
        uint256 fills;
        int256 markoutWad;
        int256 upsideGivenUpWad;
        uint256 startWad;
        uint256 endWad;
        uint256 hodlEndWad;
        uint256 cpLowEndWad;
        uint256 cpHighEndWad;
        uint256 advertisedRiskyWad;
        uint256 advertisedStableWad;
        uint256 realisedVolWad;
        uint256 takerProfitWad;
        uint256 endWethWad;
        uint256 endUsdcWad;
        uint256[] legFills;
        int256[] legMarkoutWad;
        Series series;
    }

    // ------------------------------------------------------------------ setup

    function setUp() public override {
        super.setUp();
        sl = new StrikelineRouter(address(aqua), weth, address(this), "Strikeline", "1");
        vm.label(address(sl), "StrikelineRouter");
        router = ProbeRouter(payable(address(sl)));

        _loadTape();

        fund(weth, taker, 10_000e18);
        fund(address(usdc), taker, 50_000_000e6);
        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);
    }

    /// @dev The tape, and the proof that it is the tape it claims to be.
    function _loadTape() private {
        string memory json = vm.readFile("test/markout/tape.json");

        bytes32 claimed = vm.parseJsonBytes32(json, "$.sourceKeccak256");
        bytes32 actual = keccak256(bytes(vm.readFile("../scripts/arb/series/base-ethusd.json")));
        assertEq(actual, claimed, "tape.json was not generated from the committed price series");

        uint256 decimals = vm.parseJsonUint(json, "$.decimals");
        uint256 scale = 10 ** (18 - decimals);
        tapeT = vm.parseJsonUintArray(json, "$.t");
        uint256[] memory answers = vm.parseJsonUintArray(json, "$.answer");
        assertEq(answers.length, tapeT.length, "tape arrays disagree");
        assertGt(tapeT.length, 100, "tape is too short to be a replay");
        for (uint256 i = 0; i < answers.length; i++) {
            tapePriceWad.push(answers[i] * scale);
        }

        tapeFeed = vm.parseJsonString(json, "$.feed");
        tapeFeedDescription = vm.parseJsonString(json, "$.feedDescription");
        tapeChainId = vm.parseJsonUint(json, "$.chainId");
        tapeReadAtBlock = vm.parseJsonUint(json, "$.readAtBlock");
        tapeSourceRounds = vm.parseJsonUint(json, "$.sourceRounds");
    }

    // ------------------------------------------------------------------ tests

    /// @notice The headline: the book, a straight hold, and a constant-product position, on identical
    ///         capital over an identical real price path. Prints the table and writes the screen's data.
    function test_Markout_ReplayAgainstHoldAndPool() public {
        Run memory r = _replay(SIGMA);
        _printHeader();
        _printRun(r);
        _printPath(r);
        _writeJson(r);
    }

    /// @notice The decomposition is an identity, not a narrative. Assert it to the wei.
    function test_Markout_DecompositionIsExact() public {
        Run memory r = _replay(SIGMA);
        int256 versusHold = int256(r.endWad) - int256(r.hodlEndWad);
        int256 rebuilt = r.markoutWad + r.upsideGivenUpWad;
        // One wei per step of integer division in `W*S` is the whole tolerance.
        assertApproxEqAbs(rebuilt, versusHold, tapeT.length, "markout + upside != Strikeline - hold");
    }

    /// @notice The number the maker chose is the one variable that decides whether selling vol pays, so
    ///         the whole sweep is published rather than the cell that flatters the book.
    function test_Markout_SigmaSweep() public {
        uint64[5] memory sigmas = [uint64(0.3e18), 0.45e18, 0.6e18, 0.75e18, 0.9e18];

        console2.log("");
        console2.log("SIMULATION -- implied vol sweep, same tape, same strikes, same capital");
        console2.log("  sigma    fills     theta collected   vs hold      vs 5bp pool   vs 30bp pool");
        console2.log("  -------  -------   ---------------   ----------   -----------   ------------");

        for (uint256 i = 0; i < sigmas.length; i++) {
            uint256 snap = vm.snapshotState();
            Run memory r = _replay(sigmas[i]);
            console2.log(
                string.concat(
                    "  ",
                    Fmt.padRight(string.concat(Fmt.fixedPoint(int256(uint256(sigmas[i])) * 100, 18, 0), "%"), 9),
                    Fmt.cell(int256(r.fills), 0, 0, 7),
                    "   ",
                    Fmt.cell(r.markoutWad, 18, 2, 15),
                    "   ",
                    Fmt.cell(int256(r.endWad) - int256(r.hodlEndWad), 18, 2, 10),
                    "   ",
                    Fmt.cell(int256(r.endWad) - int256(r.cpLowEndWad), 18, 2, 11),
                    "   ",
                    Fmt.cell(int256(r.endWad) - int256(r.cpHighEndWad), 18, 2, 12)
                )
            );
            vm.revertToState(snap);
        }
        console2.log("  Realised vol on this tape was printed above; a cell wins when it is above that.");
    }

    // ------------------------------------------------------------------ the replay

    function _replay(uint64 sigmaWad) internal returns (Run memory r) {
        uint256 n = tapeT.length;
        r.sigmaWad = sigmaWad;
        r.series = _emptySeries(n);
        r.legFills = new uint256[](4);
        r.legMarkoutWad = new int256[](4);

        vm.warp(tapeT[0]);
        _shipBook(sigmaWad, tapePriceWad[0]);
        for (uint256 k = 0; k < legs.length; k++) {
            (uint256 xRaw,) = aqua.rawBalances(maker, address(router), legs[k].hash, weth);
            (uint256 uRaw,) = aqua.rawBalances(maker, address(router), legs[k].hash, address(usdc));
            r.advertisedRiskyWad += xRaw * RATE_RISKY;
            r.advertisedStableWad += uRaw * RATE_STABLE;
        }

        r.startWad = _makerValueWad(tapePriceWad[0]);
        ConstantProduct.Pool memory cpLow = ConstantProduct.open(r.startWad, tapePriceWad[0], CP_FEE_LOW_BPS);
        ConstantProduct.Pool memory cpHigh = ConstantProduct.open(r.startWad, tapePriceWad[0], CP_FEE_HIGH_BPS);

        uint256 prevWeth = IERC20(weth).balanceOf(maker);
        for (uint256 i = 0; i < n; i++) {
            uint256 spot = tapePriceWad[i];
            if (i > 0) {
                vm.warp(tapeT[i]);
                int256 dS = int256(spot) - int256(tapePriceWad[i - 1]);
                r.upsideGivenUpWad += (int256(prevWeth) - int256(WALLET_WETH)) * dS / int256(WAD);
            }

            uint256 gasFloor = GAS_PER_FILL * GAS_PRICE_WEI * spot / WAD;

            for (uint256 k = 0; k < legs.length; k++) {
                (bool filled, int256 markout, uint256 takerProfit) = _arbLeg(k, sigmaWad, spot, gasFloor);
                r.attempts++;
                if (filled) {
                    r.fills++;
                    r.legFills[k]++;
                    r.legMarkoutWad[k] += markout;
                    r.markoutWad += markout;
                    r.takerProfitWad += takerProfit;
                }
            }

            cpLow.arb(spot, gasFloor);
            cpHigh.arb(spot, gasFloor);

            prevWeth = IERC20(weth).balanceOf(maker);
            _record(r, i, spot, cpLow, cpHigh);
        }

        uint256 last = tapePriceWad[n - 1];
        r.endWad = _makerValueWad(last);
        r.hodlEndWad = _hodlValueWad(last);
        r.cpLowEndWad = cpLow.value(last);
        r.cpHighEndWad = cpHigh.value(last);
        r.endWethWad = IERC20(weth).balanceOf(maker);
        r.endUsdcWad = usdc.balanceOf(maker) * RATE_STABLE;
        r.realisedVolWad = _realisedVolWad();
    }

    /// @dev One arbitrage attempt against one leg, sized in closed form and clamped to what `Coverage`
    ///      will actually deliver. Nothing here searches: the target reserve is `L*(1 - Phi(d1))`, and the
    ///      input that reaches it is read back off the router's own views, so the sizing agrees with the
    ///      chain's approximated `Phi` rather than with a float model of it.
    function _arbLeg(uint256 k, uint64 sigmaWad, uint256 spotWad, uint256 gasFloorWad)
        internal
        returns (bool filled, int256 markoutWad, uint256 takerProfitWad)
    {
        Leg storage leg = legs[k];
        uint128 strikeWad = leg.spec.strikeWad;
        uint128 liquidityWad = leg.spec.liquidityWad;

        (uint256 xRaw,) = aqua.rawBalances(maker, address(router), leg.hash, weth);
        (uint256 uRaw,) = aqua.rawBalances(maker, address(router), leg.hash, address(usdc));
        uint256 xWad = xRaw * RATE_RISKY;
        uint256 yWad = uRaw * RATE_STABLE;

        uint256 targetWad = _targetRiskyWad(spotWad, strikeWad, liquidityWad, sigmaWad);
        bool matured = RmmSwap.tauOf(maturity, block.timestamp) == 0;

        address tokenIn;
        uint256 amountIn;
        if (targetWad < xWad) {
            // Spot is above what the leg's reserves imply: the taker buys ETH, the maker sells.
            if (matured && !leg.spec.isCall) return (false, 0, 0);
            tokenIn = address(usdc);
            amountIn = _sizeStableIn(sigmaWad, strikeWad, liquidityWad, xWad, yWad, targetWad);
        } else if (targetWad > xWad) {
            // Spot is below it: the taker sells ETH, the maker buys.
            if (matured && leg.spec.isCall) return (false, 0, 0);
            tokenIn = weth;
            amountIn = _sizeRiskyIn(sigmaWad, strikeWad, liquidityWad, xWad, yWad, targetWad);
        }
        if (amountIn == 0) return (false, 0, 0);

        bytes memory td = takerDataFor(leg.order, tokenIn, true);
        uint256 amountOut;
        try this.quote(leg.order, amountIn, td) returns (uint256, uint256 out, bytes32) {
            amountOut = out;
        } catch {
            // Inside the spread, or beyond what the wallet can deliver. A real arbitrageur reads the
            // same refusal and moves on; it is not an error.
            return (false, 0, 0);
        }
        if (amountOut == 0) return (false, 0, 0);

        // Would a rational taker actually do this trade at the reference price?
        uint256 proceedsWad = tokenIn == weth ? amountOut * RATE_STABLE : amountOut * spotWad / WAD;
        uint256 costWad = tokenIn == weth ? amountIn * spotWad / WAD : amountIn * RATE_STABLE;
        if (proceedsWad <= costWad || proceedsWad - costWad <= gasFloorWad) return (false, 0, 0);
        takerProfitWad = proceedsWad - costWad;

        uint256 wethBefore = IERC20(weth).balanceOf(maker);
        uint256 usdcBefore = usdc.balanceOf(maker);
        swapAs(taker, leg.order, amountIn, td);

        markoutWad = (int256(usdc.balanceOf(maker)) - int256(usdcBefore)) * int256(uint256(RATE_STABLE))
            + (int256(IERC20(weth).balanceOf(maker)) - int256(wethBefore)) * int256(spotWad) / int256(WAD);
        filled = true;
    }

    /// @dev USDC in, WETH out: how much stable it takes to walk the reserve down to the target, capped at
    ///      the point where `Coverage` would refuse.
    function _sizeStableIn(
        uint64 sigmaWad,
        uint128 strikeWad,
        uint128 liquidityWad,
        uint256 xWad,
        uint256 yWad,
        uint256 targetWad
    )
        private
        view
        returns (uint256)
    {
        uint256 yTarget = sl.stableFor(strikeWad, sigmaWad, maturity, liquidityWad, targetWad);
        if (yTarget <= yWad) return 0;
        uint256 wantWad = yTarget - yWad;

        uint256 deliverable = sl.coverage(maker, weth) * RATE_RISKY;
        if (deliverable == 0) return 0;
        uint256 guard = RmmSwap.epsOut(strikeWad, liquidityWad, false);
        uint256 floorWad = xWad > deliverable + guard ? xWad - deliverable - guard : 0;
        if (floorWad > targetWad) {
            uint256 yCap = sl.stableFor(strikeWad, sigmaWad, maturity, liquidityWad, floorWad);
            if (yCap <= yWad) return 0;
            if (yCap - yWad < wantWad) wantWad = yCap - yWad;
        }
        // Round the raw amount down: overshooting the cap is what `Coverage` reverts on.
        return wantWad / RATE_STABLE;
    }

    /// @dev WETH in, USDC out. The target reserve IS the input here, since `rateRisky` is one.
    function _sizeRiskyIn(
        uint64 sigmaWad,
        uint128 strikeWad,
        uint128 liquidityWad,
        uint256 xWad,
        uint256 yWad,
        uint256 targetWad
    )
        private
        view
        returns (uint256)
    {
        uint256 deliverable = sl.coverage(maker, address(usdc)) * RATE_STABLE;
        if (deliverable == 0) return 0;
        uint256 guard = RmmSwap.epsOut(strikeWad, liquidityWad, true);
        uint256 floorWad = yWad > deliverable + guard ? yWad - deliverable - guard : 0;
        uint256 xCap = sl.riskyFor(strikeWad, sigmaWad, maturity, liquidityWad, floorWad);

        uint256 reach = targetWad;
        if (xCap < reach) reach = xCap;
        if (reach <= xWad) return 0;
        return (reach - xWad) / RATE_RISKY;
    }

    /// @dev `X* = L * (1 - Phi(d1))`, the reserve at which the curve's marginal price is `spot`. After
    ///      maturity the curve is constant-sum at `K`, so the no-arbitrage point is a corner.
    function _targetRiskyWad(uint256 spotWad, uint128 strikeWad, uint128 liquidityWad, uint64 sigmaWad)
        private
        view
        returns (uint256)
    {
        uint256 tau = RmmSwap.tauOf(maturity, block.timestamp);
        if (tau == 0) return spotWad >= strikeWad ? 0 : liquidityWad;

        uint256 s = uint256(sigmaWad) * WadMath.sqrt(tau) / WAD;
        int256 lnRatio = WadMath.ln(spotWad * WAD / strikeWad);
        int256 d1 = (lnRatio + int256(s * s / (2 * WAD))) * int256(WAD) / int256(s);
        return uint256(liquidityWad) * (WAD - Gaussian.cdf(d1)) / WAD;
    }

    // ------------------------------------------------------------------ the book

    function _shipBook(uint64 sigmaWad, uint256 spotWad) private {
        delete legs;
        maturity = uint40(block.timestamp + EXPIRY_DAYS * 1 days);

        fund(weth, maker, WALLET_WETH - IERC20(weth).balanceOf(maker));
        fund(address(usdc), maker, WALLET_USDC - usdc.balanceOf(maker));

        _ship(LegSpec(true, 2600e18, 12e18, "call K=2,600 L=12"), sigmaWad, spotWad, 1);
        _ship(LegSpec(true, 2800e18, 10e18, "call K=2,800 L=10"), sigmaWad, spotWad, 2);
        _ship(LegSpec(true, 3000e18, 10e18, "call K=3,000 L=10"), sigmaWad, spotWad, 3);
        _ship(LegSpec(false, 2300e18, 10e18, "put  K=2,300 L=10"), sigmaWad, spotWad, 4);
    }

    function _ship(LegSpec memory spec, uint64 sigmaWad, uint256 spotWad, uint64 salt) private {
        uint256 xWad = _targetRiskyWad(spotWad, spec.strikeWad, spec.liquidityWad, sigmaWad);
        uint256 yWad = sl.stableFor(spec.strikeWad, sigmaWad, maturity, spec.liquidityWad, xWad);

        ISwapVM.Order memory order = buildAquaOrder(maker, weth, address(usdc), _program(spec, sigmaWad, salt));
        // USDC only represents a normalised reserve to the nearest 1e12; rounding down leaves the point a
        // hair inside the curve, which favours the maker, and is what the app itself ships.
        uint256 usdcAmount = yWad / RATE_STABLE;
        (address a,) = orderTokens(order);
        (uint256 amountA, uint256 amountB) = a == weth ? (xWad, usdcAmount) : (usdcAmount, xWad);

        Leg storage leg = legs.push();
        leg.spec = spec;
        leg.order = order;
        leg.hash = shipOrder(maker, order, amountA, amountB);
    }

    function _program(LegSpec memory spec, uint64 sigmaWad, uint64 salt) private view returns (bytes memory) {
        uint8 flags = (weth < address(usdc) ? RmmSwap.FLAG_RISKY_IS_TOKEN_A : 0) | RmmSwap.FLAG_POST_EXPIRY_ONE_WAY;
        if (spec.isCall) flags |= RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY;

        return bytes.concat(
            Deadline.build(uint40(maturity + 30 minutes)),
            Coverage.build(0, 0),
            RmmSwap.build(
                RmmSwap.Args({
                    flags: flags,
                    sigmaWad: sigmaWad,
                    maturity: maturity,
                    strikeWad: spec.strikeWad,
                    liquidityWad: spec.liquidityWad,
                    rateRisky: RATE_RISKY,
                    rateStable: RATE_STABLE
                })
            ),
            Salt.build(salt)
        );
    }

    // ------------------------------------------------------------------ marks

    function _makerValueWad(uint256 spotWad) private view returns (uint256) {
        return IERC20(weth).balanceOf(maker) * spotWad / WAD + usdc.balanceOf(maker) * RATE_STABLE;
    }

    function _hodlValueWad(uint256 spotWad) private pure returns (uint256) {
        return WALLET_WETH * spotWad / WAD + WALLET_USDC * RATE_STABLE;
    }

    /// @dev Annualised standard deviation of the hourly log returns the tape actually printed.
    function _realisedVolWad() private view returns (uint256) {
        uint256 n = tapePriceWad.length;
        int256 sumSq;
        for (uint256 i = 1; i < n; i++) {
            int256 r = WadMath.ln(tapePriceWad[i] * WAD / tapePriceWad[i - 1]);
            sumSq += r * r / int256(WAD);
        }
        uint256 variance = uint256(sumSq) / (n - 1);
        return WadMath.sqrt(variance * 365 * 24);
    }

    // ------------------------------------------------------------------ recording

    function _emptySeries(uint256 n) private pure returns (Series memory s) {
        s.t = new uint256[](n);
        s.spot6 = new uint256[](n);
        s.strikeline6 = new int256[](n);
        s.hodl6 = new int256[](n);
        s.cpLow6 = new int256[](n);
        s.cpHigh6 = new int256[](n);
        s.markout6 = new int256[](n);
        s.upside6 = new int256[](n);
        s.weth6 = new uint256[](n);
        s.fills = new uint256[](n);
    }

    /// @dev Everything the screen plots, in USD micro-units and micro-ETH, so no figure needs more than
    ///      53 bits and JSON carries it without loss.
    function _record(
        Run memory r,
        uint256 i,
        uint256 spotWad,
        ConstantProduct.Pool memory cpLow,
        ConstantProduct.Pool memory cpHigh
    )
        private
        view
    {
        r.series.t[i] = tapeT[i];
        r.series.spot6[i] = spotWad / 1e12;
        r.series.strikeline6[i] = int256(_makerValueWad(spotWad) / 1e12);
        r.series.hodl6[i] = int256(_hodlValueWad(spotWad) / 1e12);
        r.series.cpLow6[i] = int256(cpLow.value(spotWad) / 1e12);
        r.series.cpHigh6[i] = int256(cpHigh.value(spotWad) / 1e12);
        r.series.markout6[i] = r.markoutWad / 1e12;
        r.series.upside6[i] = r.upsideGivenUpWad / 1e12;
        r.series.weth6[i] = IERC20(weth).balanceOf(maker) / 1e12;
        r.series.fills[i] = r.fills;
    }

    // ------------------------------------------------------------------ output

    function _printHeader() private view {
        console2.log("");
        console2.log("================================================================================");
        console2.log("  SIMULATION -- NOT A TRACK RECORD. A model of one book over one replayed tape.");
        console2.log("================================================================================");
        console2.log(
            string.concat(
                "  Tape: ",
                vm.toString(tapeT.length),
                " hourly samples of real Chainlink ",
                tapeFeedDescription,
                " rounds on chain ",
                vm.toString(tapeChainId)
            )
        );
        console2.log(
            string.concat(
                "        feed ", tapeFeed, ", ", vm.toString(tapeSourceRounds), " rounds read at block ",
                vm.toString(tapeReadAtBlock)
            )
        );
        console2.log(
            string.concat(
                "        spot ",
                Fmt.fixedPoint(int256(tapePriceWad[0]), 18, 2),
                " -> ",
                Fmt.fixedPoint(int256(tapePriceWad[tapePriceWad.length - 1]), 18, 2),
                " USD over ",
                vm.toString(EXPIRY_DAYS),
                " days"
            )
        );
        console2.log("  Flow: one arbitrageur, hourly, taking only what the curve makes available.");
        console2.log("        No uninformed flow is modelled, which is the conservative assumption.");
    }

    function _printRun(Run memory r) private view {
        console2.log("");
        console2.log(
            string.concat(
                "  Book: ",
                Fmt.fixedPoint(int256(WALLET_WETH), 18, 2),
                " WETH + ",
                Fmt.fixedPoint(int256(WALLET_USDC), 6, 2),
                " USDC, 4 legs, ",
                Fmt.fixedPoint(int256(uint256(r.sigmaWad)) * 100, 18, 0),
                "% implied, ",
                vm.toString(EXPIRY_DAYS),
                "-day expiry"
            )
        );
        console2.log(
            string.concat(
                "        advertising ",
                Fmt.fixedPoint(int256(r.advertisedRiskyWad), 18, 2),
                " WETH of depth against a ",
                Fmt.fixedPoint(int256(WALLET_WETH), 18, 2),
                " WETH wallet"
            )
        );
        console2.log(
            string.concat(
                "  Vol:  implied ",
                Fmt.fixedPoint(int256(uint256(r.sigmaWad)) * 100, 18, 2),
                "%   realised on this tape ",
                Fmt.fixedPoint(int256(r.realisedVolWad) * 100, 18, 2),
                "%"
            )
        );
        console2.log(
            string.concat(
                "  Flow: ",
                vm.toString(r.fills),
                " fills from ",
                vm.toString(r.attempts),
                " hourly attempts; the arbitrageur cleared ",
                Fmt.fixedPoint(int256(r.takerProfitWad), 18, 2),
                " USD"
            )
        );

        console2.log("");
        console2.log("  Per leg                fills     theta collected (USD)");
        console2.log("  --------------------   -------   ---------------------");
        for (uint256 k = 0; k < r.legFills.length; k++) {
            console2.log(
                string.concat(
                    "  ",
                    Fmt.padRight(legs[k].spec.label, 21),
                    Fmt.cell(int256(r.legFills[k]), 0, 0, 7),
                    "   ",
                    Fmt.cell(r.legMarkoutWad[k], 18, 2, 21)
                )
            );
        }

        console2.log("");
        console2.log("  Where the money came from (USD, marked at the tape)");
        console2.log("  ---------------------------------------------------");
        _row("theta collected from fills", r.markoutWad);
        _row("upside given up by selling ETH", r.upsideGivenUpWad);
        _row("= Strikeline minus hold", r.markoutWad + r.upsideGivenUpWad);

        console2.log("");
        console2.log("  Terminal, on identical capital over the identical path (USD)");
        console2.log("  ------------------------------------------------------------");
        _row("start value, all four strategies", int256(r.startWad));
        _row("Strikeline book", int256(r.endWad));
        _row("hold 10.4 WETH + 24,850 USDC", int256(r.hodlEndWad));
        _row("constant product, 5 bp fee", int256(r.cpLowEndWad));
        _row("constant product, 30 bp fee", int256(r.cpHighEndWad));
        console2.log("  ------------------------------------------------------------");
        _row("Strikeline vs hold", int256(r.endWad) - int256(r.hodlEndWad));
        _row("Strikeline vs 5 bp pool", int256(r.endWad) - int256(r.cpLowEndWad));
        _row("Strikeline vs 30 bp pool", int256(r.endWad) - int256(r.cpHighEndWad));
        console2.log("");
        console2.log(
            string.concat(
                "  Ends holding ",
                Fmt.fixedPoint(int256(r.endWethWad), 18, 4),
                " WETH + ",
                Fmt.fixedPoint(int256(r.endUsdcWad), 18, 2),
                " USDC (started 10.4 / 24,850)"
            )
        );
    }

    function _row(string memory label, int256 valueWad) private pure {
        console2.log(string.concat("  ", Fmt.padRight(label, 36), Fmt.cell(valueWad, 18, 2, 16)));
    }

    /// @dev A daily thinning of the path, so the terminal output shows the shape without 169 rows.
    function _printPath(Run memory r) private view {
        console2.log("");
        console2.log("  Path, one row per day (USD)");
        console2.log("  day    spot        Strikeline    hold          5bp pool      fills");
        console2.log("  -----  ----------  ------------  ------------  ------------  -----");
        for (uint256 i = 0; i < r.series.t.length; i += 24) {
            console2.log(
                string.concat(
                    "  ",
                    Fmt.padRight(vm.toString(i / 24), 7),
                    Fmt.cell(int256(r.series.spot6[i]), 6, 2, 10),
                    "  ",
                    Fmt.cell(r.series.strikeline6[i], 6, 2, 12),
                    "  ",
                    Fmt.cell(r.series.hodl6[i], 6, 2, 12),
                    "  ",
                    Fmt.cell(r.series.cpLow6[i], 6, 2, 12),
                    "  ",
                    Fmt.cell(int256(r.series.fills[i]), 0, 0, 5)
                )
            );
        }
    }

    /// @dev The screen at `/receipt` plots exactly these arrays. It renders nothing it did not get here.
    function _writeJson(Run memory r) private {
        string memory tape = "markout.tape";
        vm.serializeString(tape, "feed", tapeFeed);
        vm.serializeString(tape, "feedDescription", tapeFeedDescription);
        vm.serializeUint(tape, "chainId", tapeChainId);
        vm.serializeUint(tape, "readAtBlock", tapeReadAtBlock);
        vm.serializeUint(tape, "sourceRounds", tapeSourceRounds);
        vm.serializeUint(tape, "samples", tapeT.length);
        vm.serializeUint(tape, "stepSeconds", uint256(3600));
        string memory tapeJson = vm.serializeString(tape, "source", "scripts/arb/series/base-ethusd.json");

        string memory series = "markout.series";
        vm.serializeUint(series, "t", r.series.t);
        vm.serializeUint(series, "spot6", r.series.spot6);
        vm.serializeInt(series, "strikeline6", r.series.strikeline6);
        vm.serializeInt(series, "hodl6", r.series.hodl6);
        vm.serializeInt(series, "cpLow6", r.series.cpLow6);
        vm.serializeInt(series, "cpHigh6", r.series.cpHigh6);
        vm.serializeInt(series, "markout6", r.series.markout6);
        vm.serializeInt(series, "upside6", r.series.upside6);
        vm.serializeUint(series, "weth6", r.series.weth6);
        string memory seriesJson = vm.serializeUint(series, "fills", r.series.fills);

        string memory totals = "markout.totals";
        vm.serializeUint(totals, "attempts", r.attempts);
        vm.serializeUint(totals, "fills", r.fills);
        vm.serializeInt(totals, "markout6", r.markoutWad / 1e12);
        vm.serializeInt(totals, "upside6", r.upsideGivenUpWad / 1e12);
        vm.serializeUint(totals, "start6", r.startWad / 1e12);
        vm.serializeUint(totals, "strikeline6", r.endWad / 1e12);
        vm.serializeUint(totals, "hodl6", r.hodlEndWad / 1e12);
        vm.serializeUint(totals, "cpLow6", r.cpLowEndWad / 1e12);
        vm.serializeUint(totals, "cpHigh6", r.cpHighEndWad / 1e12);
        vm.serializeUint(totals, "takerProfit6", r.takerProfitWad / 1e12);
        vm.serializeUint(totals, "endWeth6", r.endWethWad / 1e12);
        vm.serializeUint(totals, "endUsdc6", r.endUsdcWad / 1e12);
        vm.serializeUint(totals, "advertisedRisky6", r.advertisedRiskyWad / 1e12);
        vm.serializeUint(totals, "impliedVolBps", uint256(r.sigmaWad) / 1e14);
        string memory totalsJson = vm.serializeUint(totals, "realisedVolBps", r.realisedVolWad / 1e14);

        string memory legsJson = _legsJson(r);

        string memory root = "markout";
        vm.serializeBool(root, "simulation", true);
        vm.serializeString(root, "kind", "strikeline-markout-replay");
        vm.serializeString(
            root,
            "disclaimer",
            "Simulation. A model of one option book replayed over a real Base ETH/USD price series, "
            "against a straight hold and a constant-product position on identical capital. Not a track "
            "record: no capital was at risk and only arbitrage flow is modelled."
        );
        vm.serializeString(root, "generatedBy", "contracts/test/markout/MarkoutReplay.t.sol");
        vm.serializeUint(root, "walletWeth6", WALLET_WETH / 1e12);
        vm.serializeUint(root, "walletUsdc6", WALLET_USDC);
        vm.serializeUint(root, "expiryDays", EXPIRY_DAYS);
        vm.serializeUint(root, "cpFeeLowBps", CP_FEE_LOW_BPS);
        vm.serializeUint(root, "cpFeeHighBps", CP_FEE_HIGH_BPS);
        vm.serializeString(root, "tape", tapeJson);
        vm.serializeString(root, "legs", legsJson);
        vm.serializeString(root, "totals", totalsJson);
        string memory out = vm.serializeString(root, "series", seriesJson);

        vm.writeJson(out, "test/markout/replay.json");
        console2.log("");
        console2.log("  wrote contracts/test/markout/replay.json");
    }

    function _legsJson(Run memory r) private returns (string memory) {
        string[] memory labels = new string[](legs.length);
        uint256[] memory strikes = new uint256[](legs.length);
        uint256[] memory liquidity = new uint256[](legs.length);
        uint256[] memory fills = new uint256[](legs.length);
        int256[] memory markout = new int256[](legs.length);
        for (uint256 k = 0; k < legs.length; k++) {
            labels[k] = legs[k].spec.label;
            strikes[k] = uint256(legs[k].spec.strikeWad) / 1e12;
            liquidity[k] = uint256(legs[k].spec.liquidityWad) / 1e12;
            fills[k] = r.legFills[k];
            markout[k] = r.legMarkoutWad[k] / 1e12;
        }
        string memory obj = "markout.legs";
        vm.serializeString(obj, "label", labels);
        vm.serializeUint(obj, "strike6", strikes);
        vm.serializeUint(obj, "liquidity6", liquidity);
        vm.serializeUint(obj, "fills", fills);
        return vm.serializeInt(obj, "markout6", markout);
    }
}
