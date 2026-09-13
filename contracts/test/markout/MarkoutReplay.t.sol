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
/// @notice THIS IS A SIMULATION. It is a model of one option book replayed over one real price series. It
///         is not a track record and it is not a backtest of anything that has traded: no capital was ever
///         at risk in producing any number this file prints.
///
/// @dev Two readers asked for the same artifact in almost the same words. An options trader: "if they can
///      show realised theta over a few hundred fills versus a straight hold, I'd look again." A liquidity
///      provider: "the thing I actually need is the comparison, and it is absent." This is that
///      comparison, and it is built so that it can lose. It runs at five implied vols and over eight start
///      dates, and every cell is printed, including the ones where the book is beaten.
///
///      WHAT IS REAL HERE. The price path: `tape.json` is every Chainlink ETH/USD round published on Base
///      in a 10.7-day window, captured at a pinned block by `scripts/arb/capture.ts`, and the replay steps
///      on the seconds the feed actually printed rather than on a grid of our choosing. `setUp` re-reads
///      the source series and asserts its `keccak256` before a single price is used. The curve: every
///      quote and every fill goes through `StrikelineRouter` and the Aqua registry, priced by the real
///      `RmmSwap` bytecode with its own approximated `Phi` and its own guard band, and gated by `Coverage`
///      against the maker's actual wallet balance, which shrinks as the book fills.
///
///      WHAT IS A MODEL. The order flow, and it is the conservative end of it. There is exactly one taker:
///      an arbitrageur who at every published round moves each leg to the reserve the new spot implies,
///      and who declines whenever that trade would not pay for itself at that spot. No uninformed flow is
///      modelled, and uninformed flow is what pays a market maker. Nor is taker competition, latency, or a
///      failed transaction. The constant-product control is x·y = k arithmetic rather than a deployed
///      pool (`ConstantProduct.sol`).
///
///      HOW THE RESULT IS DECOMPOSED, EXACTLY. The maker's mark is `V = W*S + U` for wallet balances `W`
///      (ETH) and `U` (USD). Between two steps that is identically
///
///          V_i - V_{i-1}  =  W_{i-1}*(S_i - S_{i-1})   +   (dW_i*S_i + dU_i)
///                            ^ price effect on inventory   ^ markout of the fills that happened
///
///      and holding is `H_i - H_{i-1} = W_0*(S_i - S_{i-1})`, so
///
///          Strikeline - hold  =  (fill markout)  +  sum (W_{i-1} - W_0) * (S_i - S_{i-1}).
///
///      `test_Markout_ReplayAgainstHoldAndPool` asserts that identity rather than asserting it in a
///      comment. Its tolerance is one wei per step, which is the integer division in `W*S` and nothing
///      else: on the demo window that is 1,185 wei against a two hundred dollar result.
///
///      ONE THING THE NUMBERS SAY THAT A PITCH WOULD NOT. Against an arbitrage-only taker the fill markout
///      is negative by construction -- it is exactly minus what the arbitrageur made, because a rational
///      arbitrageur only crosses when crossing pays them. A maker's premium in this design is not a cash
///      credit on the fills; it is the ETH the book did not sell into a rise and the ETH it bought back
///      into a fall. So the honest measure of the premium is the whole difference from holding and nothing
///      smaller, and the run prints how much of the ladder's own time value that difference captured.
contract MarkoutReplayTest is AquaSwapVMTestBase {
    using ConstantProduct for ConstantProduct.Pool;

    // ------------------------------------------------------------------ the book

    /// @dev The published demo book, unchanged: three covered calls above spot and one cash-secured put
    ///      below it, all backed by one wallet. It was not chosen for this study.
    uint256 internal constant WALLET_WETH = 10.4e18;
    uint256 internal constant WALLET_USDC = 24_850e6;
    uint64 internal constant SIGMA = 0.6e18; // 60% annualised, the demo book's own number
    uint256 internal constant EXPIRY_DAYS = 7;

    uint64 internal constant RATE_RISKY = 1; // WETH, 18 decimals
    uint64 internal constant RATE_STABLE = 1e12; // USDC, 6 decimals
    uint256 internal constant WAD = 1e18;

    /// @dev What one fill costs the taker: the measured 211,317 gas from `docs/OPCODES.md` at Base's
    ///      0.005 gwei. About a quarter of a cent, so it gates almost nothing -- but both venues are
    ///      charged it, so neither is quietly handed free arbitrage flow the other has to pay for.
    uint256 internal constant GAS_PER_FILL = 211_317;
    uint256 internal constant GAS_PRICE_WEI = 5e6;

    /// @dev Fee tiers for the control. 5 bp is Base's deepest ETH/USDC concentrated tier, 30 bp a classic
    ///      constant-product pool. Both are published, because picking the flattering one is the thing
    ///      this study exists to avoid.
    uint256 internal constant CP_FEE_LOW_BPS = 5;
    uint256 internal constant CP_FEE_HIGH_BPS = 30;

    /// @dev One point an hour is recorded for the chart. The replay itself steps on every round.
    uint256 internal constant RECORD_SECONDS = 3600;

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
    uint256 internal tapeWindows;
    uint256 internal tapeWindowOffset;

    // ------------------------------------------------------------------ results

    /// @dev Why an attempt did not become a fill. `Unprofitable` is the interesting one: the curve was
    ///      willing and the arbitrageur was not.
    enum Outcome {
        Filled,
        NoRoom,
        Refused,
        Unprofitable
    }

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
        uint256 startIndex;
        uint256 steps;
        uint256 attempts;
        uint256 fills;
        uint256 declinedByTaker;
        uint256 refusedByCurve;
        uint256 cpLowFills;
        uint256 cpHighFills;
        int256 markoutWad;
        int256 upsideGivenUpWad;
        uint256 startWad;
        uint256 endWad;
        uint256 hodlEndWad;
        uint256 cpLowEndWad;
        uint256 cpHighEndWad;
        uint256 advertisedRiskyWad;
        uint256 timeValueAtStartWad;
        uint256 realisedVolWad;
        uint256 takerProfitWad;
        uint256 startSpotWad;
        uint256 endSpotWad;
        uint256 peakSpotWad;
        uint256 troughSpotWad;
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

        uint256 scale = 10 ** (18 - vm.parseJsonUint(json, "$.decimals"));
        tapeT = vm.parseJsonUintArray(json, "$.t");
        uint256[] memory answers = vm.parseJsonUintArray(json, "$.answer");
        assertEq(answers.length, tapeT.length, "tape arrays disagree");
        assertGt(tapeT.length, 500, "tape is too short to be a replay");
        for (uint256 i = 0; i < answers.length; i++) {
            tapePriceWad.push(answers[i] * scale);
        }

        tapeFeed = vm.parseJsonString(json, "$.feed");
        tapeFeedDescription = vm.parseJsonString(json, "$.feedDescription");
        tapeChainId = vm.parseJsonUint(json, "$.chainId");
        tapeReadAtBlock = vm.parseJsonUint(json, "$.readAtBlock");
        tapeWindows = vm.parseJsonUint(json, "$.windows");
        tapeWindowOffset = vm.parseJsonUint(json, "$.windowOffsetSeconds");
    }

    // ------------------------------------------------------------------ tests

    /// @notice The headline: the book, a straight hold, and a constant-product position, on identical
    ///         capital over the identical real price path. Prints the table and writes the screen's data.
    function test_Markout_ReplayAgainstHoldAndPool() public {
        Run memory r = _replay(SIGMA, 0);

        // The decomposition is an identity, not a narrative. One wei of integer division per step is the
        // whole tolerance it is allowed: 1,185 wei of a WAD against a result of order 1e20.
        int256 versusHold = int256(r.endWad) - int256(r.hodlEndWad);
        assertApproxEqAbs(
            r.markoutWad + r.upsideGivenUpWad, versusHold, r.steps, "markout + upside != Strikeline - hold"
        );

        _printHeader();
        _printRun(r);
        _printPath(r);
        _writeJson(r);
    }

    /// @notice The maker picks the implied vol, and that one number decides whether writing the book pays.
    ///         So the whole sweep is printed, not the cell that flatters it. Nothing else changes: same
    ///         tape, same strikes, same capital, same taker.
    function test_Markout_SigmaSweep() public {
        // The range brackets the tape's own realised vol on both sides on purpose. The bottom cell is
        // the mechanism run below what the market actually did, which is where theory says a vol seller
        // has to give the arbitrageur more than it collects.
        uint64[6] memory sigmas = [uint64(0.15e18), 0.3e18, 0.45e18, 0.6e18, 0.75e18, 0.9e18];

        console2.log("");
        console2.log("  SIMULATION -- implied vol sweep, one window, every cell printed");
        console2.log("  implied   fills   net ETH   time value   vs hold     vs 5bp     vs 30bp    captured");
        console2.log("  -------   -----   -------   ----------   ---------   --------   --------   --------");

        uint256 realisedVol;
        uint256[] memory impliedBps = new uint256[](sigmas.length);
        uint256[] memory fills = new uint256[](sigmas.length);
        int256[] memory netEth6 = new int256[](sigmas.length);
        uint256[] memory timeValue6 = new uint256[](sigmas.length);
        int256[] memory vsHold6 = new int256[](sigmas.length);
        int256[] memory vsLow6 = new int256[](sigmas.length);
        int256[] memory vsHigh6 = new int256[](sigmas.length);

        for (uint256 i = 0; i < sigmas.length; i++) {
            uint256 snap = vm.snapshotState();
            Run memory r = _replay(sigmas[i], 0);
            realisedVol = r.realisedVolWad;
            int256 versusHold = int256(r.endWad) - int256(r.hodlEndWad);
            impliedBps[i] = _bps(uint256(sigmas[i]));
            fills[i] = r.fills;
            netEth6[i] = (int256(r.endWethWad) - int256(WALLET_WETH)) / 1e12;
            timeValue6[i] = r.timeValueAtStartWad / 1e12;
            vsHold6[i] = versusHold / 1e12;
            vsLow6[i] = (int256(r.endWad) - int256(r.cpLowEndWad)) / 1e12;
            vsHigh6[i] = (int256(r.endWad) - int256(r.cpHighEndWad)) / 1e12;
            console2.log(
                string.concat(
                    "  ",
                    Fmt.padRight(string.concat(Fmt.fixedPoint(int256(uint256(sigmas[i])) * 100, 18, 0), "%"), 10),
                    Fmt.cell(int256(r.fills), 0, 0, 5),
                    "   ",
                    Fmt.cell(int256(r.endWethWad) - int256(WALLET_WETH), 18, 3, 7),
                    "   ",
                    Fmt.cell(int256(r.timeValueAtStartWad), 18, 2, 10),
                    "   ",
                    Fmt.cell(versusHold, 18, 2, 9),
                    "   ",
                    Fmt.cell(int256(r.endWad) - int256(r.cpLowEndWad), 18, 2, 8),
                    "   ",
                    Fmt.cell(int256(r.endWad) - int256(r.cpHighEndWad), 18, 2, 8),
                    "   ",
                    Fmt.padLeft(_percentOf(versusHold, r.timeValueAtStartWad), 8)
                )
            );
            vm.revertToState(snap);
        }
        console2.log(
            string.concat(
                "  This window realised ",
                Fmt.fixedPoint(int256(realisedVol) * 100, 18, 2),
                "% annualised, so every cell above it is writing vol above what the market did."
            )
        );
        console2.log("  Two effects run in opposite directions across the sweep and both are visible: a");
        console2.log("  higher implied vol puts more time value on offer but a wider spread in front of");
        console2.log("  it, so the arbitrageur crosses less often and less of that value is captured.");

        string memory obj = "markout.sigmaSweep";
        vm.serializeUint(obj, "realisedVolBps", _bps(realisedVol));
        vm.serializeUint(obj, "impliedVolBps", impliedBps);
        vm.serializeUint(obj, "fills", fills);
        vm.serializeInt(obj, "netEth6", netEth6);
        vm.serializeUint(obj, "timeValue6", timeValue6);
        vm.serializeInt(obj, "vsHold6", vsHold6);
        vm.serializeInt(obj, "vsCpLow6", vsLow6);
        string memory out = vm.serializeInt(obj, "vsCpHigh6", vsHigh6);
        vm.writeJson(out, "test/markout/sweep-sigma.json");
        console2.log("  wrote contracts/test/markout/sweep-sigma.json");
    }

    /// @notice One seven-day path is an anecdote. The same book is written on eight different days of the
    ///         same tape and every window is printed, losses included.
    function test_Markout_WindowSweep() public {
        console2.log("");
        console2.log("  SIMULATION -- same book, eight start dates on the same tape, every window printed");
        console2.log("  start    spot move         fills   realised vol   vs hold      vs 5bp pool");
        console2.log("  ------   ---------------   -----   ------------   ----------   -----------");

        uint256 wins;
        uint256[] memory offsetHours = new uint256[](tapeWindows);
        uint256[] memory startSpot6 = new uint256[](tapeWindows);
        uint256[] memory endSpot6 = new uint256[](tapeWindows);
        uint256[] memory fills = new uint256[](tapeWindows);
        uint256[] memory realisedBps = new uint256[](tapeWindows);
        int256[] memory vsHold6 = new int256[](tapeWindows);
        int256[] memory vsLow6 = new int256[](tapeWindows);
        int256[] memory vsHigh6 = new int256[](tapeWindows);

        for (uint256 w = 0; w < tapeWindows; w++) {
            uint256 snap = vm.snapshotState();
            Run memory r = _replay(SIGMA, _windowStart(w));
            int256 versusHold = int256(r.endWad) - int256(r.hodlEndWad);
            if (versusHold > 0) wins++;
            offsetHours[w] = w * tapeWindowOffset / 1 hours;
            startSpot6[w] = r.startSpotWad / 1e12;
            endSpot6[w] = r.endSpotWad / 1e12;
            fills[w] = r.fills;
            realisedBps[w] = _bps(r.realisedVolWad);
            vsHold6[w] = versusHold / 1e12;
            vsLow6[w] = (int256(r.endWad) - int256(r.cpLowEndWad)) / 1e12;
            vsHigh6[w] = (int256(r.endWad) - int256(r.cpHighEndWad)) / 1e12;
            console2.log(
                string.concat(
                    "  ",
                    Fmt.padRight(string.concat("+", vm.toString(w * 12), "h"), 9),
                    Fmt.padRight(
                        string.concat(
                            Fmt.fixedPoint(int256(r.startSpotWad), 18, 0),
                            " -> ",
                            Fmt.fixedPoint(int256(r.endSpotWad), 18, 0)
                        ),
                        18
                    ),
                    Fmt.cell(int256(r.fills), 0, 0, 5),
                    "   ",
                    Fmt.padLeft(string.concat(Fmt.fixedPoint(int256(r.realisedVolWad) * 100, 18, 2), "%"), 12),
                    "   ",
                    Fmt.cell(versusHold, 18, 2, 10),
                    "   ",
                    Fmt.cell(int256(r.endWad) - int256(r.cpLowEndWad), 18, 2, 11)
                )
            );
            vm.revertToState(snap);
        }
        console2.log(
            string.concat(
                "  Beat holding in ",
                vm.toString(wins),
                " of ",
                vm.toString(tapeWindows),
                " windows. They overlap, so they are not eight independent samples."
            )
        );

        string memory obj = "markout.windowSweep";
        vm.serializeUint(obj, "impliedVolBps", _bps(uint256(SIGMA)));
        vm.serializeUint(obj, "wins", wins);
        vm.serializeUint(obj, "offsetHours", offsetHours);
        vm.serializeUint(obj, "startSpot6", startSpot6);
        vm.serializeUint(obj, "endSpot6", endSpot6);
        vm.serializeUint(obj, "fills", fills);
        vm.serializeUint(obj, "realisedVolBps", realisedBps);
        vm.serializeInt(obj, "vsHold6", vsHold6);
        vm.serializeInt(obj, "vsCpLow6", vsLow6);
        string memory out = vm.serializeInt(obj, "vsCpHigh6", vsHigh6);
        vm.writeJson(out, "test/markout/sweep-window.json");
        console2.log("  wrote contracts/test/markout/sweep-window.json");
    }

    // ------------------------------------------------------------------ the replay

    /// @dev Index of the first round at or after the start of window `w`.
    function _windowStart(uint256 w) private view returns (uint256) {
        uint256 target = tapeT[0] + w * tapeWindowOffset;
        for (uint256 i = 0; i < tapeT.length; i++) {
            if (tapeT[i] >= target) return i;
        }
        revert("window start beyond the tape");
    }

    function _replay(uint64 sigmaWad, uint256 startIndex) internal returns (Run memory r) {
        uint256 endTs = tapeT[startIndex] + EXPIRY_DAYS * 1 days;
        uint256 lastIndex = startIndex;
        while (lastIndex + 1 < tapeT.length && tapeT[lastIndex + 1] <= endTs) {
            lastIndex++;
        }

        r.sigmaWad = sigmaWad;
        r.startIndex = startIndex;
        r.steps = lastIndex - startIndex + 1;
        r.legFills = new uint256[](4);
        r.legMarkoutWad = new int256[](4);
        r.startSpotWad = tapePriceWad[startIndex];
        r.endSpotWad = tapePriceWad[lastIndex];
        // Over every round in the window, not over the hourly record: the screen says "it peaked at",
        // and a peak measured on a thinned series is a different and smaller claim.
        r.peakSpotWad = tapePriceWad[startIndex];
        r.troughSpotWad = tapePriceWad[startIndex];
        for (uint256 i = startIndex; i <= lastIndex; i++) {
            if (tapePriceWad[i] > r.peakSpotWad) r.peakSpotWad = tapePriceWad[i];
            if (tapePriceWad[i] < r.troughSpotWad) r.troughSpotWad = tapePriceWad[i];
        }

        vm.warp(tapeT[startIndex]);
        _shipBook(sigmaWad, r.startSpotWad);
        for (uint256 k = 0; k < legs.length; k++) {
            (uint256 xRaw,) = aqua.rawBalances(maker, address(router), legs[k].hash, weth);
            r.advertisedRiskyWad += xRaw * RATE_RISKY;
        }
        r.timeValueAtStartWad = _timeValueWad(r.startSpotWad, sigmaWad);
        r.startWad = _makerValueWad(r.startSpotWad);

        ConstantProduct.Pool memory cpLow = ConstantProduct.open(r.startWad, r.startSpotWad, CP_FEE_LOW_BPS);
        ConstantProduct.Pool memory cpHigh = ConstantProduct.open(r.startWad, r.startSpotWad, CP_FEE_HIGH_BPS);

        Series memory buffer = _emptySeries(r.steps);
        uint256 recorded;
        uint256 nextRecordTs = tapeT[startIndex];
        uint256 prevWeth = IERC20(weth).balanceOf(maker);

        for (uint256 i = startIndex; i <= lastIndex; i++) {
            uint256 spot = tapePriceWad[i];
            if (i > startIndex) {
                vm.warp(tapeT[i]);
                int256 dS = int256(spot) - int256(tapePriceWad[i - 1]);
                r.upsideGivenUpWad += (int256(prevWeth) - int256(WALLET_WETH)) * dS / int256(WAD);
            }

            uint256 gasFloor = GAS_PER_FILL * GAS_PRICE_WEI * spot / WAD;
            for (uint256 k = 0; k < legs.length; k++) {
                _attempt(r, k, sigmaWad, spot, gasFloor);
            }
            if (cpLow.arb(spot, gasFloor).happened) r.cpLowFills++;
            if (cpHigh.arb(spot, gasFloor).happened) r.cpHighFills++;

            prevWeth = IERC20(weth).balanceOf(maker);
            if (tapeT[i] >= nextRecordTs || i == lastIndex) {
                _record(r, buffer, recorded++, tapeT[i], spot, cpLow, cpHigh);
                nextRecordTs = tapeT[i] + RECORD_SECONDS;
            }
        }

        r.series = _trim(buffer, recorded);
        r.endWad = _makerValueWad(r.endSpotWad);
        r.hodlEndWad = _hodlValueWad(r.endSpotWad);
        r.cpLowEndWad = cpLow.value(r.endSpotWad);
        r.cpHighEndWad = cpHigh.value(r.endSpotWad);
        r.endWethWad = IERC20(weth).balanceOf(maker);
        r.endUsdcWad = usdc.balanceOf(maker) * RATE_STABLE;
        r.realisedVolWad = _realisedVolWad(startIndex, lastIndex);
    }

    /// @dev Every attempt is made through an external self-call. That is not ceremony: Solidity never frees
    ///      memory, and one replay makes several thousand attempts, each of which encodes taker traits and
    ///      decodes a quote. Kept inline, the frame's memory expansion alone exhausts the EVM memory limit
    ///      about two thirds of the way through a window. A call frame per attempt gives the allocations
    ///      back, and costs one `CALL` that no user ever pays for.
    function _attempt(Run memory r, uint256 k, uint64 sigmaWad, uint256 spotWad, uint256 gasFloorWad) private {
        (Outcome outcome, int256 markoutWad, uint256 takerProfitWad) =
            this.arbLeg(k, sigmaWad, spotWad, gasFloorWad);
        r.attempts++;
        if (outcome == Outcome.Filled) {
            r.fills++;
            r.legFills[k]++;
            r.legMarkoutWad[k] += markoutWad;
            r.markoutWad += markoutWad;
            r.takerProfitWad += takerProfitWad;
        } else if (outcome == Outcome.Unprofitable) {
            r.declinedByTaker++;
        } else if (outcome == Outcome.Refused) {
            r.refusedByCurve++;
        }
    }

    /// @dev One arbitrage attempt against one leg, sized in closed form and clamped to what `Coverage`
    ///      will actually deliver. Nothing here searches: the target reserve is `L*(1 - Phi(d1))`, and the
    ///      input that reaches it is read back off the router's own views, so the sizing agrees with the
    ///      chain's approximated `Phi` rather than with a float model of it.
    function arbLeg(uint256 k, uint64 sigmaWad, uint256 spotWad, uint256 gasFloorWad)
        external
        returns (Outcome outcome, int256 markoutWad, uint256 takerProfitWad)
    {
        require(msg.sender == address(this), "arbLeg is the replay's own frame");
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
            if (matured && !leg.spec.isCall) return (Outcome.NoRoom, 0, 0);
            tokenIn = address(usdc);
            amountIn = _sizeStableIn(sigmaWad, strikeWad, liquidityWad, xWad, yWad, targetWad);
        } else if (targetWad > xWad) {
            // Spot is below it: the taker sells ETH, the maker buys.
            if (matured && leg.spec.isCall) return (Outcome.NoRoom, 0, 0);
            tokenIn = weth;
            amountIn = _sizeRiskyIn(sigmaWad, strikeWad, liquidityWad, xWad, yWad, targetWad);
        }
        if (amountIn == 0) return (Outcome.NoRoom, 0, 0);

        bytes memory td = takerDataFor(leg.order, tokenIn, true);
        uint256 amountOut;
        try this.quote(leg.order, amountIn, td) returns (uint256, uint256 out, bytes32) {
            amountOut = out;
        } catch {
            // Inside the spread, or past what the wallet can deliver. A real arbitrageur reads the same
            // refusal and moves on; it is not an error.
            return (Outcome.Refused, 0, 0);
        }
        if (amountOut == 0) return (Outcome.Refused, 0, 0);

        // Would a rational taker actually do this trade at the reference price? If not it does not happen,
        // and the premium the maker is holding stays unrealised. That is the mechanism's largest disclosed
        // risk, and this line is where the simulation refuses to paper over it.
        uint256 proceedsWad = tokenIn == weth ? amountOut * RATE_STABLE : amountOut * spotWad / WAD;
        uint256 costWad = tokenIn == weth ? amountIn * spotWad / WAD : amountIn * RATE_STABLE;
        if (proceedsWad <= costWad || proceedsWad - costWad <= gasFloorWad) return (Outcome.Unprofitable, 0, 0);
        takerProfitWad = proceedsWad - costWad;

        uint256 wethBefore = IERC20(weth).balanceOf(maker);
        uint256 usdcBefore = usdc.balanceOf(maker);
        swapAs(taker, leg.order, amountIn, td);

        markoutWad = (int256(usdc.balanceOf(maker)) - int256(usdcBefore)) * int256(uint256(RATE_STABLE))
            + (int256(IERC20(weth).balanceOf(maker)) - int256(wethBefore)) * int256(spotWad) / int256(WAD);
        outcome = Outcome.Filled;
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

        uint256 reach = targetWad < xCap ? targetWad : xCap;
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

    /// @dev The time value the whole ladder is short right now, in USD.
    ///
    ///      No Black-Scholes pricer is needed for this, because the curve is one. RMM-01's replication
    ///      claim is that at the no-arbitrage reserve point the position is worth `L*(S - C_BS)`, so `L*S`
    ///      minus that point's value IS `L*C_BS`, evaluated by the same approximated `Phi` the instruction
    ///      itself uses. Subtracting intrinsic leaves the decaying part: the most the book could earn from
    ///      theta over the leg's life if it were hedged continuously and perfectly.
    function _timeValueWad(uint256 spotWad, uint64 sigmaWad) private view returns (uint256 total) {
        for (uint256 k = 0; k < legs.length; k++) {
            LegSpec memory spec = legs[k].spec;
            uint256 x = _targetRiskyWad(spotWad, spec.strikeWad, spec.liquidityWad, sigmaWad);
            uint256 y = sl.stableFor(spec.strikeWad, sigmaWad, maturity, spec.liquidityWad, x);
            uint256 notional = uint256(spec.liquidityWad) * spotWad / WAD;
            uint256 point = x * spotWad / WAD + y;
            if (point >= notional) continue;
            uint256 optionValue = notional - point;
            uint256 intrinsic =
                spotWad > spec.strikeWad ? uint256(spec.liquidityWad) * (spotWad - spec.strikeWad) / WAD : 0;
            if (optionValue > intrinsic) total += optionValue - intrinsic;
        }
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

    /// @dev Annualised standard deviation of the log returns the tape actually printed over this window.
    ///      The rounds are unevenly spaced, so the variance is divided by elapsed time rather than by a
    ///      count of samples.
    function _realisedVolWad(uint256 from, uint256 to) private view returns (uint256) {
        int256 sumSq;
        for (uint256 i = from + 1; i <= to; i++) {
            int256 r = WadMath.ln(tapePriceWad[i] * WAD / tapePriceWad[i - 1]);
            sumSq += r * r / int256(WAD);
        }
        uint256 elapsed = tapeT[to] - tapeT[from];
        return WadMath.sqrt(uint256(sumSq) * 365 days / elapsed);
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

    /// @dev Everything the screen plots, in USD micro-units and micro-ETH, so no figure needs more than 53
    ///      bits and JSON carries it without loss.
    function _record(
        Run memory r,
        Series memory s,
        uint256 i,
        uint256 t,
        uint256 spotWad,
        ConstantProduct.Pool memory cpLow,
        ConstantProduct.Pool memory cpHigh
    )
        private
        view
    {
        s.t[i] = t;
        s.spot6[i] = spotWad / 1e12;
        s.strikeline6[i] = int256(_makerValueWad(spotWad) / 1e12);
        s.hodl6[i] = int256(_hodlValueWad(spotWad) / 1e12);
        s.cpLow6[i] = int256(cpLow.value(spotWad) / 1e12);
        s.cpHigh6[i] = int256(cpHigh.value(spotWad) / 1e12);
        s.markout6[i] = r.markoutWad / 1e12;
        s.upside6[i] = r.upsideGivenUpWad / 1e12;
        s.weth6[i] = IERC20(weth).balanceOf(maker) / 1e12;
        s.fills[i] = r.fills;
    }

    function _trim(Series memory s, uint256 n) private pure returns (Series memory out) {
        out = _emptySeries(n);
        for (uint256 i = 0; i < n; i++) {
            out.t[i] = s.t[i];
            out.spot6[i] = s.spot6[i];
            out.strikeline6[i] = s.strikeline6[i];
            out.hodl6[i] = s.hodl6[i];
            out.cpLow6[i] = s.cpLow6[i];
            out.cpHigh6[i] = s.cpHigh6[i];
            out.markout6[i] = s.markout6[i];
            out.upside6[i] = s.upside6[i];
            out.weth6[i] = s.weth6[i];
            out.fills[i] = s.fills[i];
        }
    }

    // ------------------------------------------------------------------ output

    function _printHeader() private view {
        console2.log("");
        console2.log("================================================================================");
        console2.log("  SIMULATION -- NOT A TRACK RECORD. A model of one book over one replayed tape.");
        console2.log("================================================================================");
        console2.log(
            string.concat(
                "  Tape: every real Chainlink ",
                tapeFeedDescription,
                " round published on chain ",
                vm.toString(tapeChainId),
                ", feed ",
                tapeFeed
            )
        );
        console2.log(
            string.concat(
                "        ",
                vm.toString(tapeT.length),
                " rounds read at block ",
                vm.toString(tapeReadAtBlock),
                "; nothing is resampled and no price is invented"
            )
        );
        console2.log("  Flow: one arbitrageur, at every published round, taking only what pays them.");
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
                "  Path: ",
                Fmt.fixedPoint(int256(r.startSpotWad), 18, 2),
                " -> ",
                Fmt.fixedPoint(int256(r.endSpotWad), 18, 2),
                " USD over ",
                vm.toString(EXPIRY_DAYS),
                " days, ",
                vm.toString(r.steps),
                " rounds"
            )
        );
        console2.log(
            string.concat(
                "  Vol:  implied ",
                Fmt.fixedPoint(int256(uint256(r.sigmaWad)) * 100, 18, 2),
                "%   realised on this window ",
                Fmt.fixedPoint(int256(r.realisedVolWad) * 100, 18, 2),
                "%"
            )
        );

        console2.log("");
        console2.log("  Who traded, and who did not");
        console2.log("  ---------------------------");
        _count("fills on the book", r.fills);
        _count("quotes the taker declined to take", r.declinedByTaker);
        _count("quotes the curve refused", r.refusedByCurve);
        _count("attempts (4 legs x every round)", r.attempts);
        _count("arbitrage trades, 5 bp pool", r.cpLowFills);
        _count("arbitrage trades, 30 bp pool", r.cpHighFills);
        console2.log("  A declined quote is the disclosed risk made visible: the premium sits inside the");
        console2.log("  spread, and it is only realised when somebody chooses to cross it.");

        console2.log("");
        console2.log("  Per leg                fills   markout to the maker (USD)");
        console2.log("  --------------------   -----   --------------------------");
        for (uint256 k = 0; k < r.legFills.length; k++) {
            console2.log(
                string.concat(
                    "  ",
                    Fmt.padRight(legs[k].spec.label, 21),
                    Fmt.cell(int256(r.legFills[k]), 0, 0, 5),
                    "   ",
                    Fmt.cell(r.legMarkoutWad[k], 18, 2, 26)
                )
            );
        }

        console2.log("");
        console2.log("  Where the difference from holding came from (USD)");
        console2.log("  ------------------------------------------------");
        _row("markout on the fills", r.markoutWad);
        _row("price moves on the inventory it traded", r.upsideGivenUpWad);
        _row("= Strikeline minus holding", r.markoutWad + r.upsideGivenUpWad);
        console2.log("  Against an arbitrage-only taker the first line is negative by construction: it is");
        console2.log("  exactly minus what the arbitrageur made. The premium arrives as the second line.");

        console2.log("");
        console2.log("  Terminal, on identical capital over the identical path (USD)");
        console2.log("  ------------------------------------------------------------");
        _row("start value, every strategy", int256(r.startWad));
        _row("Strikeline book", int256(r.endWad));
        _row("hold 10.4 WETH + 24,850 USDC", int256(r.hodlEndWad));
        _row("constant product, 5 bp fee", int256(r.cpLowEndWad));
        _row("constant product, 30 bp fee", int256(r.cpHighEndWad));
        console2.log("  ------------------------------------------------------------");
        _row("Strikeline vs hold", int256(r.endWad) - int256(r.hodlEndWad));
        _row("Strikeline vs 5 bp pool", int256(r.endWad) - int256(r.cpLowEndWad));
        _row("Strikeline vs 30 bp pool", int256(r.endWad) - int256(r.cpHighEndWad));

        console2.log("");
        console2.log("  How much of the premium was captured");
        console2.log("  ------------------------------------");
        _row("time value the ladder was short at t0", int256(r.timeValueAtStartWad));
        _row("captured versus holding", int256(r.endWad) - int256(r.hodlEndWad));
        console2.log(
            string.concat(
                "  ",
                Fmt.padRight("that is", 36),
                Fmt.padLeft(_percentOf(int256(r.endWad) - int256(r.hodlEndWad), r.timeValueAtStartWad), 16),
                " of the theta on offer"
            )
        );
        console2.log("  The rest stayed unhedged, because the arbitrageur declined to cross the spread.");
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
        console2.log(string.concat("  ", Fmt.padRight(label, 38), Fmt.cell(valueWad, 18, 2, 16)));
    }

    function _count(string memory label, uint256 value) private pure {
        console2.log(string.concat("  ", Fmt.padRight(label, 38), Fmt.cell(int256(value), 0, 0, 16)));
    }

    function _percentOf(int256 part, uint256 whole) private pure returns (string memory) {
        if (whole == 0) return "n/a";
        return string.concat(Fmt.fixedPoint(part * int256(WAD) / int256(whole) * 100, 18, 1), "%");
    }

    /// @dev A ratio in basis points, rounded rather than truncated, so 46.565% publishes as 46.57% on
    ///      the screen and in the terminal instead of disagreeing with itself in the last digit.
    function _bps(uint256 ratioWad) private pure returns (uint256) {
        return (ratioWad + 0.5e14) / 1e14;
    }

    /// @dev A daily thinning of the path, so the terminal shows the shape without hundreds of rows.
    ///      Rows are chosen by elapsed time, not by an index stride: the feed publishes unevenly, so
    ///      every 24th recorded point drifts off the day boundary and skips one.
    function _printPath(Run memory r) private pure {
        console2.log("");
        console2.log("  Path, one row per day (USD)");
        console2.log("  day    spot        Strikeline    hold          5bp pool      fills");
        console2.log("  -----  ----------  ------------  ------------  ------------  -----");
        uint256 n = r.series.t.length;
        uint256 t0 = r.series.t[0];
        uint256 lastDay = (r.series.t[n - 1] - t0) / 1 days;
        uint256 cursor;
        for (uint256 d = 0; d < lastDay; d++) {
            uint256 want = t0 + d * 1 days;
            while (cursor + 1 < n && r.series.t[cursor] < want) {
                cursor++;
            }
            _pathRow(r, cursor, false);
        }
        _pathRow(r, n - 1, true);
    }

    function _pathRow(Run memory r, uint256 i, bool last) private pure {
        console2.log(
            string.concat(
                "  ",
                Fmt.padRight(last ? "end" : vm.toString((r.series.t[i] - r.series.t[0]) / 1 days), 7),
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

    /// @dev Writes the replay series to test/markout/replay.json, the numbers the README reports.
    function _writeJson(Run memory r) private {
        string memory tape = "markout.tape";
        vm.serializeString(tape, "feed", tapeFeed);
        vm.serializeString(tape, "feedDescription", tapeFeedDescription);
        vm.serializeUint(tape, "chainId", tapeChainId);
        vm.serializeUint(tape, "readAtBlock", tapeReadAtBlock);
        vm.serializeUint(tape, "rounds", r.steps);
        vm.serializeUint(tape, "firstTimestamp", r.series.t[0]);
        vm.serializeUint(tape, "lastTimestamp", r.series.t[r.series.t.length - 1]);
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
        vm.serializeUint(totals, "declinedByTaker", r.declinedByTaker);
        vm.serializeUint(totals, "refusedByCurve", r.refusedByCurve);
        vm.serializeInt(totals, "markout6", r.markoutWad / 1e12);
        vm.serializeInt(totals, "upside6", r.upsideGivenUpWad / 1e12);
        vm.serializeUint(totals, "start6", r.startWad / 1e12);
        vm.serializeUint(totals, "strikeline6", r.endWad / 1e12);
        vm.serializeUint(totals, "hodl6", r.hodlEndWad / 1e12);
        vm.serializeUint(totals, "cpLow6", r.cpLowEndWad / 1e12);
        vm.serializeUint(totals, "cpHigh6", r.cpHighEndWad / 1e12);
        vm.serializeUint(totals, "takerProfit6", r.takerProfitWad / 1e12);
        vm.serializeUint(totals, "timeValueAtStart6", r.timeValueAtStartWad / 1e12);
        vm.serializeUint(totals, "endWeth6", r.endWethWad / 1e12);
        vm.serializeUint(totals, "endUsdc6", r.endUsdcWad / 1e12);
        vm.serializeUint(totals, "advertisedRisky6", r.advertisedRiskyWad / 1e12);
        vm.serializeUint(totals, "peakSpot6", r.peakSpotWad / 1e12);
        vm.serializeUint(totals, "troughSpot6", r.troughSpotWad / 1e12);
        vm.serializeUint(totals, "impliedVolBps", _bps(uint256(r.sigmaWad)));
        string memory totalsJson = vm.serializeUint(totals, "realisedVolBps", _bps(r.realisedVolWad));

        string memory legsJson = _legsJson(r);

        string memory root = "markout";
        vm.serializeBool(root, "simulation", true);
        vm.serializeString(root, "kind", "strikeline-markout-replay");
        vm.serializeString(
            root,
            "disclaimer",
            "Simulation. A model of one option book replayed over a real Base ETH/USD price series, against "
            "a straight hold and a constant-product position on identical capital. Not a track record: no "
            "capital was at risk, and only arbitrage flow is modelled."
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
        string[] memory kinds = new string[](legs.length);
        uint256[] memory strikes = new uint256[](legs.length);
        uint256[] memory liquidity = new uint256[](legs.length);
        uint256[] memory fills = new uint256[](legs.length);
        int256[] memory markout = new int256[](legs.length);
        for (uint256 k = 0; k < legs.length; k++) {
            labels[k] = legs[k].spec.label;
            kinds[k] = legs[k].spec.isCall ? "call" : "put";
            strikes[k] = uint256(legs[k].spec.strikeWad) / 1e12;
            liquidity[k] = uint256(legs[k].spec.liquidityWad) / 1e12;
            fills[k] = r.legFills[k];
            markout[k] = r.legMarkoutWad[k] / 1e12;
        }
        string memory obj = "markout.legs";
        vm.serializeString(obj, "label", labels);
        vm.serializeString(obj, "kind", kinds);
        vm.serializeUint(obj, "strike6", strikes);
        vm.serializeUint(obj, "liquidity6", liquidity);
        vm.serializeUint(obj, "fills", fills);
        return vm.serializeInt(obj, "markout6", markout);
    }
}
