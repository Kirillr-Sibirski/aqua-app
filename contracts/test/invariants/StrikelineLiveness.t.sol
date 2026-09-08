// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import { StrikelineLeg } from "./StrikelineLeg.sol";
import { Coverage } from "../../src/instructions/Coverage.sol";

/// @title StrikelineLivenessTest
/// @notice The one invariant the packaged `CoreInvariants` suite does not carry: STRATEGY LIVENESS.
///
/// @dev `CoreInvariants` only exercises the success path of a live strategy. It never asks whether the set of
///      states in which a leg quotes is the same set in which it fills, which is the property an aggregator
///      actually depends on: a router that quotes a leg it cannot fill routes flow into a revert, and a router
///      that refuses to quote a leg it could fill silently drops the maker's depth.
///
///      The invariant asserted here is exact, not approximate:
///
///        for every (leg, amount, direction), `quote` and `swap` either both succeed with identical numbers,
///        or both revert with byte-identical return data.
///
///      It is asserted across every liveness edge a Strikeline leg has: shipped, docked, past `Deadline`, past
///      maturity in each direction, and inside the `Coverage` bound. Byte-identical return data is what makes
///      it useful - `NotCovered(needed, free)` carrying the same two numbers from a static call and from a
///      real fill is what lets a solver resize instead of retrying blind.
///
///      LIVENESS IS PER STRATEGY, DELIVERABILITY IS PER WALLET. That separation is the whole point of the book:
///      docking one leg must not touch its siblings, while filling one leg must shrink every sibling's
///      deliverable size in the same block without any of them becoming dead.
contract StrikelineLivenessTest is StrikelineLeg {
    /// @dev A size well clear of the band in both directions, so nothing here is testing the spread by accident.
    uint256 internal constant PROBE_USDC = 1_940e6;

    // ------------------------------------------------------------------ the core liveness invariant

    /// @notice Quote and swap agree on liveness, size and error bytes, at every edge a leg has.
    function test_Liveness_QuoteAndSwapAgreeAtEveryEdge() public {
        (ISwapVM.Order memory leg,,) = shipDemoLeg(201);
        bytes memory buy = takerDataFor(leg, address(usdc), true);
        bytes memory sell = takerDataFor(leg, weth, true);

        // 1. Live, both directions.
        _assertAgree(leg, PROBE_USDC, buy, "live: buy");
        _assertAgree(leg, 0.31e18, sell, "live: sell");

        // 2. Inside the band: both must refuse, with the same shortfall.
        vm.warp(block.timestamp + 2 days);
        _assertAgree(leg, 9e6, buy, "decayed: dust buy");
        _assertAgree(leg, PROBE_USDC, buy, "decayed: buy clears");

        // 3. Beyond what the wallet can deliver: both must refuse, with the same NotCovered pair.
        vm.prank(maker);
        IERC20(weth).transfer(address(0xdead), WALLET_WETH - 0.37e18);
        _assertAgree(leg, 12_400e6, buy, "uncovered: buy");
        _assertAgree(leg, 240e6, buy, "covered: small buy");
    }

    /// @notice Past `Deadline` the leg is dead in every direction and at every size, and quote and swap say so
    ///         identically.
    function test_Liveness_DeadlineClosesTheLegForBothSides() public {
        (ISwapVM.Order memory leg,,) = shipDemoLeg(202);
        bytes memory buy = takerDataFor(leg, address(usdc), true);
        bytes memory sell = takerDataFor(leg, weth, true);

        vm.warp(uint256(maturity) + 30 minutes + 1);
        _assertAgree(leg, PROBE_USDC, buy, "past deadline: buy");
        _assertAgree(leg, 0.31e18, sell, "past deadline: sell");

        (bool ok,) = _quoteRaw(leg, PROBE_USDC, buy);
        assertFalse(ok, "a leg past its Deadline must not quote");
    }

    /// @notice Between maturity and the `Deadline` grace window the leg is live in exactly one direction:
    ///         assignment. Both sides agree on which.
    function test_Liveness_AfterMaturityOnlyTheAssignmentDirectionIsLive() public {
        (ISwapVM.Order memory leg,,) = shipDemoLeg(203);
        bytes memory buy = takerDataFor(leg, address(usdc), true);
        bytes memory sell = takerDataFor(leg, weth, true);

        vm.warp(uint256(maturity) + 1);
        assertEq(sl.tauNow(maturity), 0, "tau must be zero after maturity");

        (bool buyOk,) = _quoteRaw(leg, 2_600e6, buy);
        (bool sellOk,) = _quoteRaw(leg, 0.31e18, sell);
        assertTrue(buyOk, "assignment direction must stay live after maturity");
        assertFalse(sellOk, "the other direction must be closed after maturity");

        _assertAgree(leg, 2_600e6, buy, "settled: assignment");
        _assertAgree(leg, 0.31e18, sell, "settled: wrong way");
    }

    // ------------------------------------------------------------------ dock is terminal, and it is local

    /// @notice Docking kills the strategy for good: it stops quoting, stops filling, and its hash can never be
    ///         re-shipped. That is why a roll needs `Salt`.
    function test_Liveness_DockIsTerminalAndTheHashIsBurned() public {
        (ISwapVM.Order memory leg, bytes32 hash_,) = shipDemoLeg(204);
        bytes memory buy = takerDataFor(leg, address(usdc), true);

        (bool liveOk,) = _quoteRaw(leg, PROBE_USDC, buy);
        assertTrue(liveOk, "leg must quote before it is docked");

        dockOrder(maker, leg);

        _assertAgree(leg, PROBE_USDC, buy, "docked");
        (bool deadOk,) = _quoteRaw(leg, PROBE_USDC, buy);
        assertFalse(deadOk, "a docked leg must not quote");

        // Aqua marks the slot 0xff, not 0: the hash is burned, not freed.
        (, uint8 tokensCount) = aquaRaw(maker, hash_, weth);
        assertEq(tokensCount, 0xff, "docked strategy must be marked terminal");

        // Re-shipping the identical order is refused, which is the failure mode `Salt` exists to avoid.
        (address a, address b) = orderTokens(leg);
        address[] memory tokens = new address[](2);
        tokens[0] = a;
        tokens[1] = b;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;
        vm.prank(maker);
        vm.expectRevert();
        aqua.ship(address(sl), abi.encode(leg), tokens, amounts);
    }

    /// @notice Docking one leg leaves every sibling live, and a `Salt`-bumped replacement of the docked leg is a
    ///         fresh, live strategy against the same wallet.
    function test_Liveness_DockIsLocalToOneStrategy() public {
        (ISwapVM.Order memory leg1,,) = shipDemoLeg(211);
        (ISwapVM.Order memory leg2,,) = shipLeg(legProgram(2800e18, 10e18, 212), 2800e18, 10e18, 9.22e18);

        bytes memory buy1 = takerDataFor(leg1, address(usdc), true);
        bytes memory buy2 = takerDataFor(leg2, address(usdc), true);

        dockOrder(maker, leg1);

        (bool ok1,) = _quoteRaw(leg1, PROBE_USDC, buy1);
        (bool ok2,) = _quoteRaw(leg2, PROBE_USDC, buy2);
        assertFalse(ok1, "docked leg must be dead");
        assertTrue(ok2, "a sibling must be untouched by the dock");

        // The roll: same economics, new salt, live again.
        (ISwapVM.Order memory rolled,,) = shipDemoLeg(213);
        (bool ok3,) = _quoteRaw(rolled, PROBE_USDC, takerDataFor(rolled, address(usdc), true));
        assertTrue(ok3, "a salt-bumped roll of a docked leg must be live");
    }

    // ------------------------------------------------------------------ coverage shrinks size, not liveness

    /// @notice A fill on one leg shrinks what its siblings can deliver without making any of them dead. Both are
    ///         asserted, because "refuses 6 WETH" and "is dead" look identical to a caller that only tries once.
    function test_Liveness_CoverageShrinksSizeWithoutKillingSiblings() public {
        (ISwapVM.Order memory leg1,,) = shipDemoLeg(221);
        (ISwapVM.Order memory leg2,,) = shipLeg(legProgram(2800e18, 10e18, 222), 2800e18, 10e18, 9.22e18);
        (ISwapVM.Order memory leg3,,) = shipLeg(legProgram(3000e18, 10e18, 223), 3000e18, 10e18, 9.88e18);

        bytes memory out2 = takerDataFor(leg2, address(usdc), false);
        bytes memory out3 = takerDataFor(leg3, address(usdc), false);

        uint256 before = sl.coverage(maker, weth);
        assertEq(before, WALLET_WETH, "coverage starts at the whole wallet");

        (bool big2Before,) = _quoteRaw(leg2, 6e18, out2);
        assertTrue(big2Before, "sibling must be able to deliver 6 WETH before the fill");

        // Fill leg 1 for 5 WETH out of the shared wallet.
        swapAs(taker, leg1, 5e18, takerDataFor(leg1, address(usdc), false));

        uint256 remaining = sl.coverage(maker, weth);
        assertEq(remaining, before - 5e18, "the fill must shrink the shared wallet");

        // Siblings refuse the old size...
        (bool big2,) = _quoteRaw(leg2, 6e18, out2);
        (bool big3,) = _quoteRaw(leg3, 6e18, out3);
        assertFalse(big2, "sibling must refuse a size the wallet can no longer deliver");
        assertFalse(big3, "sibling must refuse a size the wallet can no longer deliver");

        // ...and are still LIVE at a size inside the remaining wallet. This is the distinction that matters.
        uint256 smaller = remaining / 2;
        (bool small2,) = _quoteRaw(leg2, smaller, out2);
        (bool small3,) = _quoteRaw(leg3, smaller, out3);
        assertTrue(small2, "sibling must still be live inside the remaining wallet");
        assertTrue(small3, "sibling must still be live inside the remaining wallet");

        _assertAgree(leg2, 6e18, out2, "sibling refused size");
        _assertAgree(leg2, smaller, out2, "sibling live size");

        console2.log("shared WETH", before, "->", remaining);
        console2.log("refused", uint256(6e18), "still fills", smaller);
    }

    /// @notice `Coverage` tracks the allowance as well as the balance: revoking the Aqua approval takes the
    ///         whole book's deliverable size to zero without docking anything.
    function test_Liveness_RevokingTheAquaAllowanceZeroesDeliverableSize() public {
        (ISwapVM.Order memory leg,,) = shipDemoLeg(231);
        bytes memory buy = takerDataFor(leg, address(usdc), true);

        (bool ok,) = _quoteRaw(leg, PROBE_USDC, buy);
        assertTrue(ok, "leg must be live to begin with");

        vm.prank(maker);
        IERC20(weth).approve(address(aqua), 0);
        assertEq(sl.coverage(maker, weth), 0, "revoking the allowance must zero coverage");

        _assertAgree(leg, PROBE_USDC, buy, "allowance revoked");
        (bool ok2,) = _quoteRaw(leg, PROBE_USDC, buy);
        assertFalse(ok2, "a leg with no allowance must not quote");

        // And it comes back with no re-ship: liveness followed the wallet, not the strategy.
        vm.prank(maker);
        IERC20(weth).approve(address(aqua), type(uint256).max);
        (bool ok3,) = _quoteRaw(leg, PROBE_USDC, buy);
        assertTrue(ok3, "restoring the allowance must restore the quote");
    }

    /// @notice The number `StrikelineViews.coverage` publishes is the number `Coverage` enforces, at the edge.
    ///         A UI or solver that sizes to it must not be off by one.
    function test_Liveness_PublishedCoverageIsTheEnforcedBound() public {
        (ISwapVM.Order memory leg,,) = shipDemoLeg(241);
        bytes memory out = takerDataFor(leg, address(usdc), false);

        vm.prank(maker);
        IERC20(weth).transfer(address(0xdead), WALLET_WETH - 1.93e18);

        uint256 free = sl.coverage(maker, weth);
        assertEq(free, 1.93e18, "coverage must equal the real wallet");
        assertEq(free, Coverage.free(address(aqua), maker, weth, 0), "view and library must agree");

        (bool atBound,) = _quoteRaw(leg, free, out);
        (bool overBound,) = _quoteRaw(leg, free + 1, out);
        assertTrue(atBound, "exactly the published coverage must be fillable");
        assertFalse(overBound, "one wei past the published coverage must revert");
    }

    // ------------------------------------------------------------------ raw call helpers

    /// @dev Quote and swap must be indistinguishable: same success bit, same return bytes. On success that is
    ///      `quote() == swap()`; on failure it is the decoded custom error and its arguments.
    function _assertAgree(
        ISwapVM.Order memory order,
        uint256 amount,
        bytes memory takerTraitsAndData,
        string memory label
    )
        internal
    {
        (bool qOk, bytes memory qRet) = _quoteRaw(order, amount, takerTraitsAndData);

        uint256 snap = vm.snapshotState();
        (bool sOk, bytes memory sRet) = _swapRaw(order, amount, takerTraitsAndData);
        vm.revertToState(snap);

        assertEq(qOk, sOk, string.concat(label, ": quote and swap disagree on liveness"));
        assertEq(qRet, sRet, string.concat(label, ": quote and swap disagree on the returned bytes"));
    }

    function _quoteRaw(
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

    function _swapRaw(
        ISwapVM.Order memory order,
        uint256 amount,
        bytes memory takerTraitsAndData
    )
        internal
        returns (bool ok, bytes memory ret)
    {
        vm.prank(taker);
        (ok, ret) = address(sl).call(abi.encodeCall(ISwapVM.swap, (order, amount, takerTraitsAndData)));
    }
}
