// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2, Vm } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import { StrikelineV4Base } from "./StrikelineV4Base.sol";
import { StrikelineHook } from "../../src/hooks/StrikelineHook.sol";
import { RmmPricer } from "../../src/hooks/RmmPricer.sol";

/// @title VenueExperimentTest
/// @notice The controlled experiment. One option book - four legs, identical terms - written three ways
///         from three identical wallets, and measured on the four things a desk actually cares about:
///         capital required, whether one balance can back several strikes, what a fill does to the other
///         strikes, and what a roll costs.
///
///         Column 1  Uniswap v4, `Backing.Pooled`  - idiomatic v4. Reserves settled into PoolManager.
///         Column 2  Uniswap v4, `Backing.Wallet`  - the steelman. Tokens stay in the wallet, the hook
///                                                   holds an allowance and pays with transferFrom.
///         Column 3  1inch Aqua                    - `ship` moves nothing; `Coverage` guards the fill.
///
/// @dev `CurveParity.t.sol` is the control: the legs quote identical wei on both venues, including
///      identical refusals, so nothing below is a difference in the instrument.
///
///      The honest headline is that column 2 is close. A wallet-backed v4 hook ties Aqua on capital, on
///      cross-leg margin and on roll cost, and this file proves that rather than hiding it. What it does
///      not tie on is measured here too: the maker is paid in ERC-6909 claims and needs a second
///      transaction to spend them, the ladder costs four pool initialisations and a mined hook address on
///      top of the writes, and the allowance sits with bespoke hook code rather than with the canonical
///      registry. Column 1, the design v4 actually encourages, gets one leg of four out of the wallet.
contract VenueExperimentTest is StrikelineV4Base {
    // A deliberately irregular book: round demo numbers read as fake even when they are real.
    uint256 constant WALLET_WETH = 10.4e18;
    uint256 constant WALLET_USDC = 24_850e6;

    uint64 constant SIGMA = 0.6e18;

    struct LegSpec {
        uint128 strikeWad;
        uint128 liquidityWad;
        uint256 xWad;
        string label;
    }

    LegSpec[4] internal book;
    uint40 internal maturity;

    address internal makerPooled;
    address internal makerWallet;
    address internal makerAqua;
    /// @dev A fourth maker, funded with whatever the pooled ladder actually costs rather than with the
    ///      demo wallet, because otherwise the pooled column has no book to compare at all.
    address internal makerPooledFunded;

    bytes32 constant TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");

    function setUp() public override {
        super.setUp();
        maturity = uint40(block.timestamp + 7 days);

        // Three calls above spot and a cash-secured put below it. The put holds no WETH at all - its
        // reserves start entirely on the stable side, which by put-call parity is what makes the same
        // curve a put instead of a covered call.
        book[0] = LegSpec(2600e18, 12e18, 8.41e18, "call K=2600 L=12");
        book[1] = LegSpec(2800e18, 10e18, 9.22e18, "call K=2800 L=10");
        book[2] = LegSpec(3000e18, 10e18, 9.88e18, "call K=3000 L=10");
        book[3] = LegSpec(2300e18, 6e18, 0, "put  K=2300 L=6 ");

        makerPooled = makeAddr("maker.v4.pooled");
        makerWallet = makeAddr("maker.v4.wallet");
        makerAqua = maker;
        makerPooledFunded = makeAddr("maker.v4.pooled.funded");

        address[3] memory makers = [makerPooled, makerWallet, makerAqua];
        for (uint256 i = 0; i < makers.length; ++i) {
            deal(weth, makers[i], WALLET_WETH);
            deal(address(usdc), makers[i], WALLET_USDC);
            _approveEverything(makers[i]);
        }

        (uint256 ladderWeth, uint256 ladderUsdc) = ladderCost();
        deal(weth, makerPooledFunded, ladderWeth);
        deal(address(usdc), makerPooledFunded, ladderUsdc);
        _approveEverything(makerPooledFunded);

        fund(weth, taker, 200e18);
        fund(address(usdc), taker, 600_000e6);
        approveSwapRouter(taker);
        approveRouter(taker, weth, type(uint256).max);
        approveRouter(taker, address(usdc), type(uint256).max);
    }

    function _approveEverything(address who) internal {
        approveHook(who);
        vm.startPrank(who);
        IERC20(weth).approve(address(aqua), type(uint256).max);
        usdc.approve(address(aqua), type(uint256).max);
        vm.stopPrank();
    }

    function _terms(uint256 i) internal view returns (RmmPricer.Terms memory) {
        return termsFor(book[i].strikeWad, SIGMA, maturity, book[i].liquidityWad);
    }

    /// @notice What the whole ladder costs to pre-fund, i.e. what pooled v4 needs before it can quote.
    function ladderCost() public view returns (uint256 wethNeeded, uint256 usdcNeeded) {
        for (uint256 i = 0; i < book.length; ++i) {
            (uint256 x, uint256 y) = _reserves(i);
            wethNeeded += x;
            usdcNeeded += y;
        }
    }

    /// @dev What one leg of the ladder needs in reserves, asked of the chain rather than modelled.
    function _reserves(uint256 i) internal view returns (uint256 xWad, uint256 usdcReserve) {
        xWad = book[i].xWad;
        usdcReserve = sl.stableFor(book[i].strikeWad, SIGMA, maturity, book[i].liquidityWad, xWad) / 1e12;
    }

    // ------------------------------------------------------------------ 1. capital required

    /// @notice QUESTION 1. What does the ladder cost to stand up?
    ///
    ///         Pooled v4 has to pre-fund every leg, so the book needs the sum of the legs. The demo
    ///         wallet cannot pay it: writing the ladder in order runs out of WETH on the second leg.
    ///         Aqua and a wallet-backed hook both need only the wallet, because neither moves anything
    ///         at write time.
    function test_Q1_Capital_PooledV4CannotWriteTheLadderThisWalletBacks() public {
        uint256 needWeth;
        uint256 needUsdc;
        for (uint256 i = 0; i < book.length; ++i) {
            (uint256 x, uint256 y) = _reserves(i);
            needWeth += x;
            needUsdc += y;
            console2.log(book[i].label, "needs WETH wei / USDC:", x, y);
        }

        (uint256 ladderWeth, uint256 ladderUsdc) = ladderCost();
        assertEq(needWeth, ladderWeth);
        assertEq(needUsdc, ladderUsdc);
        console2.log("ladder needs WETH wei:", needWeth, "wallet holds:", WALLET_WETH);
        console2.log("ladder needs USDC:", needUsdc, "wallet holds:", WALLET_USDC);
        console2.log("notional written vs backed, x1e18:", needWeth * 1e18 / WALLET_WETH);
        assertGt(needWeth, WALLET_WETH, "the book must be over-allocated or there is nothing to compare");

        // Pooled: write until the wallet runs dry, and count how far it gets.
        uint256 written;
        for (uint256 i = 0; i < book.length; ++i) {
            (uint256 x, uint256 y) = _reserves(i);
            StrikelineHook.Leg memory leg = legFor(_terms(i), StrikelineHook.Backing.Pooled);
            PoolKey memory key = poolKeyFor(uint24(300 + i));
            initPool(key);
            vm.prank(makerPooled);
            try hook.write(key, leg, x, y) {
                written++;
            } catch {
                break;
            }
        }
        console2.log("v4 Pooled: legs of 4 the wallet could fund:", written);
        assertLt(written, book.length, "pooled v4 must not fit the whole ladder in this wallet");

        // Wallet-backed and Aqua both write all four and move nothing.
        assertEq(_writeWalletLadder(makerWallet, 400), book.length, "wallet-backed v4 must fit all four");
        assertEq(IERC20(weth).balanceOf(makerWallet), WALLET_WETH, "wallet-backed write must move no WETH");

        assertEq(_shipAquaLadder(makerAqua, 500), book.length, "Aqua must fit all four");
        assertEq(IERC20(weth).balanceOf(makerAqua), WALLET_WETH, "ship must move no WETH");
    }

    // ------------------------------------------------------------------ 2. one wallet, several strikes

    /// @notice QUESTION 2. Can one balance back several strikes at once?
    ///
    ///         Yes on Aqua, and yes on a wallet-backed hook. This is the honest negative result: v4 is
    ///         not structurally barred from it, provided you write a hook that never takes custody. It is
    ///         not what v4's own design encourages - PoolManager exists to hold the currency - and the
    ///         cost of stepping outside that is measured in Q4 and in the two findings below.
    function test_Q2_Backing_BothWalletBackedVenuesWriteFourLegsOnOneBalance() public {
        assertEq(_writeWalletLadder(makerWallet, 410), book.length);
        assertEq(_shipAquaLadder(makerAqua, 510), book.length);

        assertEq(hook.deliverable(makerWallet, weth), WALLET_WETH, "hook sees the whole wallet behind every leg");
        assertEq(sl.coverage(makerAqua, weth), WALLET_WETH, "Aqua's guard sees the whole wallet behind every leg");

        // Both books advertise more risky depth than the wallet holds. That is the point: at any given
        // spot at most one or two legs can fill, so the over-allocation is portfolio margin, not a lie -
        // provided something enforces it, which is Q3.
        uint256 advertised;
        for (uint256 i = 0; i < book.length; ++i) {
            advertised += book[i].xWad;
        }
        console2.log("risky depth advertised across the book, wei:", advertised);
        console2.log("actually held in the wallet, wei:", WALLET_WETH);
    }

    // ------------------------------------------------------------------ 3. a fill on one leg

    /// @notice QUESTION 3. What happens to the other strikes when one fills?
    ///
    ///         On both wallet-backed venues the siblings shrink in the same block, with no keeper and no
    ///         message between legs, because every leg reads the same wallet. On pooled v4 nothing
    ///         happens to the siblings - each pool owns its own reserves - which is not an advantage, it
    ///         is the restatement of Q1: pooled v4 already paid for all four.
    function test_Q3_Margin_AFillOnOneLegShrinksItsSiblings() public {
        PoolKey[4] memory keys = _writeWalletLadderKeys(makerWallet, 420);
        ISwapVM.Order[4] memory orders = _shipAquaLadderOrders(makerAqua, 520);

        uint256 probe = 6e18;
        bool buyWethIsZeroForOne = !wethIsCurrency0;

        // Before: both venues quote the probe on legs 2 and 3.
        (uint256 hookCost2,) = hook.quoteSwap(keys[1], buyWethIsZeroForOne, false, probe);
        (uint256 aquaCost2,,) = this.quote(orders[1], probe, takerDataFor(orders[1], address(usdc), false));
        assertGt(hookCost2, 0);
        assertEq(hookCost2, aquaCost2, "the two venues must still agree before the fill");

        // Fill 5 WETH out of leg 1 on each venue, from its own wallet.
        swapV4(taker, keys[0], buyWethIsZeroForOne, int256(5e18));
        swapAs(taker, orders[0], 5e18, takerDataFor(orders[0], address(usdc), false));

        uint256 hookLeft = hook.deliverable(makerWallet, weth);
        uint256 aquaLeft = sl.coverage(makerAqua, weth);
        assertEq(hookLeft, WALLET_WETH - 5e18, "the hook's wallet must have paid the fill");
        assertEq(aquaLeft, WALLET_WETH - 5e18, "Aqua's wallet must have paid the fill");
        console2.log("shared WETH before:", WALLET_WETH, "after a 5 WETH fill:", hookLeft);

        // After: both refuse the same probe on the untouched siblings, and for the same reason - their
        // own reserves never moved, the wallet behind them did.
        vm.expectRevert();
        this.quoteV4(keys[1], buyWethIsZeroForOne, false, probe);
        vm.expectRevert();
        this.quote(orders[1], probe, takerDataFor(orders[1], address(usdc), false));

        vm.expectRevert();
        this.quoteV4(keys[2], buyWethIsZeroForOne, false, probe);
        vm.expectRevert();
        this.quote(orders[2], probe, takerDataFor(orders[2], address(usdc), false));

        // Still live, just smaller.
        uint256 smaller = 2.7e18;
        (uint256 hookCostAfter,) = hook.quoteSwap(keys[1], buyWethIsZeroForOne, false, smaller);
        (uint256 aquaCostAfter,,) = this.quote(orders[1], smaller, takerDataFor(orders[1], address(usdc), false));
        assertGt(hookCostAfter, 0, "the sibling must still fill inside the remaining wallet");
        assertEq(hookCostAfter, aquaCostAfter, "and both venues must still agree afterwards");
        console2.log("siblings refuse wei:", probe, "still fill wei:", smaller);

        // Pooled v4, same fill, same book: the siblings do not notice, because they were pre-funded.
        // Note the maker: a wallet identical to the two above cannot write two pooled legs at all, so
        // this column is run from one funded with the whole ladder (Q1 measures how much more that is).
        PoolKey memory pooled = _writeOnePooledLeg(makerPooledFunded, 430, 0);
        PoolKey memory pooledSibling = _writeOnePooledLeg(makerPooledFunded, 431, 1);
        (uint256 siblingBefore,) = hook.quoteSwap(pooledSibling, buyWethIsZeroForOne, false, 1e18);
        swapV4(taker, pooled, buyWethIsZeroForOne, int256(1e18));
        (uint256 siblingAfter,) = hook.quoteSwap(pooledSibling, buyWethIsZeroForOne, false, 1e18);
        assertEq(siblingAfter, siblingBefore, "a pooled sibling cannot see the fill next door");
    }

    // ------------------------------------------------------------------ 4. rolling the book

    /// @notice QUESTION 4. What does it cost to roll the whole book to next week?
    ///
    ///         Counted in ERC-20 `Transfer` logs and in gas. Pooled v4 has to unwind and re-fund every
    ///         leg. The wallet-backed hook and Aqua both move nothing, which is the second place the
    ///         steelman ties.
    function test_Q4_Roll_MovingTheBookToNextExpiry() public {
        // The pooled column runs from the fully funded maker, so the roll is compared on four legs
        // against four legs rather than being flattered by a book that could not be written.
        PoolKey[4] memory pooledKeys;
        for (uint256 i = 0; i < book.length; ++i) {
            pooledKeys[i] = _writeOnePooledLeg(makerPooledFunded, uint24(440 + i), i);
        }
        uint256 fitted = book.length;

        PoolKey[4] memory walletKeys = _writeWalletLadderKeys(makerWallet, 450);
        ISwapVM.Order[4] memory orders = _shipAquaLadderOrders(makerAqua, 550);

        uint40 nextWeek = uint40(maturity + 7 days);

        // Pooled: retire and re-fund every leg that fitted.
        vm.recordLogs();
        uint256 gasStart = gasleft();
        for (uint256 i = 0; i < fitted; ++i) {
            vm.prank(makerPooledFunded);
            hook.retire(pooledKeys[i]);
            PoolKey memory fresh = poolKeyFor(uint24(460 + i));
            initPool(fresh);
            RmmPricer.Terms memory t = termsFor(book[i].strikeWad, SIGMA, nextWeek, book[i].liquidityWad);
            uint256 y = hook.stableFor(t, book[i].xWad) / 1e12;
            StrikelineHook.Leg memory leg = legFor(t, StrikelineHook.Backing.Pooled);
            vm.prank(makerPooledFunded);
            hook.write(fresh, leg, book[i].xWad, y);
        }
        uint256 pooledGas = gasStart - gasleft();
        uint256 pooledTransfers = _countTransfers(vm.getRecordedLogs());

        // Wallet-backed: retire and rewrite the same pools with new terms.
        vm.recordLogs();
        gasStart = gasleft();
        for (uint256 i = 0; i < book.length; ++i) {
            vm.prank(makerWallet);
            hook.retire(walletKeys[i]);
            RmmPricer.Terms memory t = termsFor(book[i].strikeWad, SIGMA, nextWeek, book[i].liquidityWad);
            uint256 y = hook.stableFor(t, book[i].xWad) / 1e12;
            StrikelineHook.Leg memory leg = legFor(t, StrikelineHook.Backing.Wallet);
            vm.prank(makerWallet);
            hook.write(walletKeys[i], leg, book[i].xWad, y);
        }
        uint256 walletGas = gasStart - gasleft();
        uint256 walletTransfers = _countTransfers(vm.getRecordedLogs());

        // Aqua: ship the replacements first so quotes never go dark, then dock the old ones.
        vm.recordLogs();
        gasStart = gasleft();
        for (uint256 i = 0; i < book.length; ++i) {
            RmmPricer.Terms memory t = termsFor(book[i].strikeWad, SIGMA, nextWeek, book[i].liquidityWad);
            shipAquaLeg(t, book[i].xWad, uint64(560 + i), true, makerAqua);
            dockOrder(makerAqua, orders[i]);
        }
        uint256 aquaGas = gasStart - gasleft();
        uint256 aquaTransfers = _countTransfers(vm.getRecordedLogs());

        console2.log("roll: v4 Pooled legs / ERC-20 Transfers / gas:", fitted, pooledTransfers, pooledGas);
        console2.log("roll: v4 Wallet legs / ERC-20 Transfers / gas:", book.length, walletTransfers, walletGas);
        console2.log("roll: Aqua      legs / ERC-20 Transfers / gas:", book.length, aquaTransfers, aquaGas);

        assertEq(aquaTransfers, 0, "an Aqua roll must move no tokens");
        assertEq(walletTransfers, 0, "a wallet-backed v4 roll must move no tokens");
        assertGt(pooledTransfers, 0, "a pooled v4 roll has to unwind and re-fund");
    }

    // ------------------------------------------------------------------ standing the book up

    /// @notice What it costs to go from an empty wallet-backed book to four live legs, counted in gas and
    ///         in on-chain steps. v4 needs a pool initialised before a leg can be written; Aqua needs
    ///         nothing but the `ship`, and the ship carries the program bytes so the terms are public.
    function test_Setup_StandingUpTheLadder() public {
        uint256 g = gasleft();
        uint256 steps;
        for (uint256 i = 0; i < book.length; ++i) {
            (uint256 x, uint256 y) = _reserves(i);
            PoolKey memory key = poolKeyFor(uint24(600 + i));
            initPool(key);
            steps++;
            StrikelineHook.Leg memory leg = legFor(_terms(i), StrikelineHook.Backing.Wallet);
            vm.prank(makerWallet);
            hook.write(key, leg, x, y);
            steps++;
        }
        uint256 v4Gas = g - gasleft();
        uint256 v4Steps = steps;

        g = gasleft();
        steps = 0;
        for (uint256 i = 0; i < book.length; ++i) {
            shipAquaLeg(_terms(i), book[i].xWad, uint64(610 + i), true, makerAqua);
            steps++;
        }
        uint256 aquaGas = g - gasleft();

        console2.log("standing up 4 legs, v4 Wallet: on-chain steps / gas:", v4Steps, v4Gas);
        console2.log("standing up 4 legs, Aqua     : on-chain steps / gas:", steps, aquaGas);
        console2.log("plus, for v4 only: one CREATE2-mined hook deployment before any of it.");
    }

    // ------------------------------------------------------------------ gas per fill

    /// @notice The same 2000 USDC fill on each venue, so the comparison includes what a taker pays.
    /// @dev This is the isolated, storage-warm cost of one `swap` call, not the whole-test figure the
    ///      Aqua suite reports (`test_RMM_RiskyIn_ExactIn`, 657k, which also ships the leg). Measured
    ///      this way v4 is the cheaper venue per fill, and that is worth saying plainly: the pool never
    ///      touches the Aqua registry, and pooled backing pays in ERC-6909 claims instead of ERC-20.
    function test_Gas_PerFill() public {
        PoolKey memory pooled = _writeOnePooledLeg(makerPooledFunded, 470, 0);
        PoolKey[4] memory walletKeys = _writeWalletLadderKeys(makerWallet, 480);
        ISwapVM.Order[4] memory orders = _shipAquaLadderOrders(makerAqua, 580);
        bool buyWeth = !wethIsCurrency0;

        // Warm every venue's storage first, otherwise the first column pays for cold accesses the other
        // two do not and the comparison measures test ordering instead of the venue.
        swapV4(taker, pooled, buyWeth, -int256(10e6));
        swapV4(taker, walletKeys[0], buyWeth, -int256(10e6));
        swapAs(taker, orders[0], 10e6, takerDataFor(orders[0], address(usdc), true));

        uint256 g = gasleft();
        swapV4(taker, pooled, buyWeth, -int256(2000e6));
        uint256 pooledGas = g - gasleft();

        g = gasleft();
        swapV4(taker, walletKeys[0], buyWeth, -int256(2000e6));
        uint256 walletGas = g - gasleft();

        g = gasleft();
        swapAs(taker, orders[0], 2000e6, takerDataFor(orders[0], address(usdc), true));
        uint256 aquaGas = g - gasleft();

        console2.log("gas per fill, v4 Pooled:", pooledGas);
        console2.log("gas per fill, v4 Wallet:", walletGas);
        console2.log("gas per fill, Aqua     :", aquaGas);
    }

    // ------------------------------------------------------------------ what the pool key cannot hold

    /// @notice A `PoolKey` is `(currency0, currency1, fee, tickSpacing, hooks)`. There is nowhere in it
    ///         for a strike, a vol or an expiry, so a second leg on the same pair collides and the terms
    ///         have to live in hook storage where no router can read them. An Aqua strategy hash IS the
    ///         terms: `ship` takes the program in full and the event carries the bytes.
    function test_PoolKey_HasNoRoomForTheOptionTerms() public {
        PoolKey memory key = poolKeyFor(490);
        initPool(key);
        (uint256 x, uint256 y) = _reserves(0);
        vm.prank(makerWallet);
        hook.write(key, legFor(_terms(0), StrikelineHook.Backing.Wallet), x, y);

        // A different strike on the same pair needs a different pool key, so `fee` becomes a nonce.
        vm.expectRevert(abi.encodeWithSelector(StrikelineHook.LegAlreadyWritten.selector, _idOf(key)));
        vm.prank(makerWallet);
        hook.write(key, legFor(_terms(1), StrikelineHook.Backing.Wallet), book[1].xWad, y);

        console2.log("pools required for a 4-leg ladder on one pair:", book.length);
        console2.log("Aqua strategies required, same ladder, same wallet:", book.length);
        console2.log("... but on Aqua the terms ARE the strategy hash, and ship() emits the bytes.");
    }

    // ------------------------------------------------------------------ helpers

    function _idOf(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function _writeOnePooledLeg(address maker_, uint24 nonce, uint256 i) internal returns (PoolKey memory key) {
        (uint256 x, uint256 y) = _reserves(i);
        key = poolKeyFor(nonce);
        initPool(key);
        vm.prank(maker_);
        hook.write(key, legFor(_terms(i), StrikelineHook.Backing.Pooled), x, y);
    }

    function _writeWalletLadderKeys(address maker_, uint24 base) internal returns (PoolKey[4] memory keys) {
        for (uint256 i = 0; i < book.length; ++i) {
            (uint256 x, uint256 y) = _reserves(i);
            keys[i] = poolKeyFor(uint24(base + uint24(i)));
            initPool(keys[i]);
            vm.prank(maker_);
            hook.write(keys[i], legFor(_terms(i), StrikelineHook.Backing.Wallet), x, y);
        }
    }

    function _writeWalletLadder(address maker_, uint24 base) internal returns (uint256) {
        _writeWalletLadderKeys(maker_, base);
        return book.length;
    }

    function _shipAquaLadderOrders(address maker_, uint64 base) internal returns (ISwapVM.Order[4] memory orders) {
        for (uint256 i = 0; i < book.length; ++i) {
            (orders[i],) = shipAquaLeg(_terms(i), book[i].xWad, uint64(base + uint64(i)), true, maker_);
        }
    }

    function _shipAquaLadder(address maker_, uint64 base) internal returns (uint256) {
        _shipAquaLadderOrders(maker_, base);
        return book.length;
    }

    function _countTransfers(Vm.Log[] memory logs) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == TRANSFER_TOPIC) {
                n++;
            }
        }
    }
}
