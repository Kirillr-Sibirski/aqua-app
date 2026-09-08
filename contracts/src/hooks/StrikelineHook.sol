// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BaseHook } from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { SafeCast } from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BeforeSwapDelta, toBeforeSwapDelta } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { CurrencySettler } from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

import { Coverage } from "../instructions/Coverage.sol";
import { RmmPricer } from "./RmmPricer.sol";

/// @title StrikelineHook
/// @notice The Strikeline covered call, ported from a 1inch SwapVM instruction to a Uniswap v4 hook, so
///         the two venues can be compared on the same curve rather than on rhetoric.
///
/// @dev The pricing is not re-derived here. `RmmPricer` calls `RmmSwap.stableOf/riskyOf/tauOf` and
///      reverts with `RmmSwap`'s own errors, so a fill through this hook and a fill through the Aqua leg
///      differ by zero wei on identical terms and reserves (`test/hook/CurveParity.t.sol` asserts that,
///      including under fuzz). Everything that follows is plumbing, and the plumbing is the finding.
///
///      WHY A CUSTOM CURVE AND NOT A FEE HOOK. RMM-01 is a trading function, not a spread on top of
///      `x*y=k`. So this hook takes the whole swap: `beforeSwapReturnDelta` returns a delta that cancels
///      `amountSpecified` exactly, `Pool.swap` then short-circuits on a zero amount, and concentrated
///      liquidity never runs. `beforeAddLiquidity` reverts for the same reason - a v3-shaped position in
///      this pool would be liquidity the curve does not know about and cannot price.
///
///      TWO BACKING MODES, because the interesting comparison is against v4's best case, not its worst.
///
///      * `Backing.Pooled` is idiomatic v4. The maker settles the leg's reserves into `PoolManager` and
///        the hook holds them as ERC-6909 claims. Custody moves. Every leg needs its own pool and its own
///        pre-funded reserves, so a four-leg ladder needs four times the capital.
///
///      * `Backing.Wallet` is the steelman: the leg's tokens stay in the maker's wallet, the hook holds
///        an allowance, and `beforeSwap` pays the taker with `transferFrom(maker)`. One balance can then
///        back several strikes, and the coverage check (`Coverage.free`, imported verbatim from the Aqua
///        instruction) makes a fill on one leg shrink its siblings' deliverable depth in the same block.
///        This mode ties with Aqua on capital and on cross-leg margin. It loses on two things it cannot
///        fix, and both are structural:
///
///          1. The maker's proceeds arrive as ERC-6909 claims inside `PoolManager`, not as tokens. The
///             hook cannot `take` ERC-20 to the maker inside `beforeSwap`, because the taker has not
///             settled yet and doing so would spend another pool's reserves for the rest of the call.
///             Getting paid in spendable tokens costs a second transaction (`sweep`).
///          2. The allowance is held by this contract - bespoke, unaudited hook code with the maker's
///             whole balance in reach. The Aqua leg approves the canonical registry instead, and the
///             strategy is *data* interpreted by an audited VM.
///
///      WHAT NEITHER MODE CAN FIX: `PoolKey` is `(currency0, currency1, fee, tickSpacing, hooks)`. There
///      is nowhere in it to put a strike, a vol or an expiry, so a ladder of four legs on WETH/USDC must
///      burn the `fee` and `tickSpacing` fields as a nonce to get four distinct pool ids, and the terms
///      live in this contract's storage where no router can see them. An Aqua strategy hash *is* the
///      terms: `ship()` takes the program in full, for data availability, and emits it.
contract StrikelineHook is BaseHook, IUnlockCallback {
    using CurrencySettler for Currency;
    using PoolIdLibrary for PoolKey;
    using SafeCast for uint256;
    using SafeCast for int256;

    /// @notice Where the leg's tokens live between fills.
    enum Backing {
        /// @dev Settled into `PoolManager`, held by this hook as ERC-6909 claims.
        Pooled,
        /// @dev Left in the maker's wallet, reachable through an allowance to this hook.
        Wallet
    }

    struct Leg {
        address maker;
        Backing backing;
        bool riskyIsCurrency0;
        uint40 maturity;
        uint64 sigmaWad;
        uint128 strikeWad;
        uint128 liquidityWad;
        uint64 rateRisky;
        uint64 rateStable;
        bool oneWayAfterExpiry;
        bool assignmentPaysRisky;
        /// @dev The reserve point, in token units, walked on every fill. v4 has no per-strategy ledger,
        ///      so the hook keeps one.
        uint128 reserveRisky;
        uint128 reserveStable;
    }

    /// @notice No leg has been written for this pool, so there is nothing to price against.
    error NoLegForPool(PoolId id);
    /// @notice A leg is already written for this pool; retire it before writing another.
    error LegAlreadyWritten(PoolId id);
    /// @notice Only the maker who wrote the leg may change or retire it.
    error NotTheMaker(address maker);
    /// @notice Concentrated liquidity would be reserves the curve cannot price.
    error LiquidityMustGoThroughTheLeg();
    /// @notice The hook priced a trade larger than the leg's own reserves.
    error ReserveUnderflow(uint256 requested, uint256 available);

    event LegWritten(PoolId indexed id, address indexed maker, Backing backing, uint128 strikeWad, uint40 maturity);
    event LegRetired(PoolId indexed id, address indexed maker);
    event LegFilled(PoolId indexed id, bool riskyIn, uint256 amountIn, uint256 amountOut);

    uint8 private constant ACTION_FUND = 0;
    uint8 private constant ACTION_DEFUND = 1;
    uint8 private constant ACTION_SWEEP = 2;

    mapping(PoolId => Leg) private _legs;

    constructor(IPoolManager pm) BaseHook(pm) { }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.beforeSwapReturnDelta = true;
        p.beforeAddLiquidity = true;
    }

    /// @notice The 14 low address bits this hook must be mined to.
    function requiredFlags() external pure returns (uint160) {
        return uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);
    }

    // ------------------------------------------------------------------ writing a leg

    /// @notice Write an option leg onto an initialised pool. The v4 analogue of Aqua's `ship`.
    /// @param reserveRisky Risky reserve in token units. Picks the moneyness.
    /// @param reserveStable Stable reserve in token units. MUST come from `stableFor` on this chain.
    /// @dev In `Backing.Pooled` this also moves both reserves into `PoolManager`, which is the whole
    ///      capital difference: `ship` transfers nothing and checks no balance.
    function write(PoolKey calldata key, Leg memory leg, uint256 reserveRisky, uint256 reserveStable) external {
        PoolId id = key.toId();
        if (_legs[id].maker != address(0)) {
            revert LegAlreadyWritten(id);
        }

        leg.maker = msg.sender;
        leg.reserveRisky = reserveRisky.toUint128();
        leg.reserveStable = reserveStable.toUint128();
        _legs[id] = leg;

        if (leg.backing == Backing.Pooled) {
            (Currency risky, Currency stable) =
                leg.riskyIsCurrency0 ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
            poolManager.unlock(abi.encode(ACTION_FUND, risky, stable, reserveRisky, reserveStable, msg.sender));
        }

        emit LegWritten(id, msg.sender, leg.backing, leg.strikeWad, leg.maturity);
    }

    /// @notice Retire a leg. The v4 analogue of `dock`.
    /// @dev In `Backing.Pooled` the reserves come back out of `PoolManager` as ERC-20, which is what makes
    ///      rolling a ladder expensive: dock-and-ship on Aqua emits no `Transfer` at all.
    function retire(PoolKey calldata key) external {
        PoolId id = key.toId();
        Leg memory leg = _legs[id];
        if (leg.maker == address(0)) {
            revert NoLegForPool(id);
        }
        if (leg.maker != msg.sender) {
            revert NotTheMaker(leg.maker);
        }
        delete _legs[id];

        if (leg.backing == Backing.Pooled) {
            (Currency risky, Currency stable) =
                leg.riskyIsCurrency0 ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
            poolManager.unlock(
                abi.encode(
                    ACTION_DEFUND, risky, stable, uint256(leg.reserveRisky), uint256(leg.reserveStable), leg.maker
                )
            );
        }

        emit LegRetired(id, msg.sender);
    }

    /// @notice Redeem the ERC-6909 claims a `Backing.Wallet` fill paid `msg.sender` back into ERC-20.
    /// @dev The second transaction a wallet-backed maker needs in order to spend what a fill paid them,
    ///      and it costs a second approval too: `PoolManager.setOperator(hook, true)`, because the claims
    ///      belong to the maker and only their owner or operator may burn them. Neither cost is avoidable
    ///      from inside `beforeSwap` - see the note on the class docblock.
    function sweep(Currency currency, uint256 amount) external {
        poolManager.unlock(abi.encode(ACTION_SWEEP, currency, currency, amount, uint256(0), msg.sender));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) {
            revert NotPoolManager();
        }
        (uint8 action, Currency risky, Currency stable, uint256 riskyAmount, uint256 stableAmount, address who) =
            abi.decode(data, (uint8, Currency, Currency, uint256, uint256, address));

        if (action == ACTION_FUND) {
            _fundOne(risky, who, riskyAmount);
            _fundOne(stable, who, stableAmount);
        } else if (action == ACTION_DEFUND) {
            _defundOne(risky, address(this), who, riskyAmount);
            _defundOne(stable, address(this), who, stableAmount);
        } else {
            _defundOne(risky, who, who, riskyAmount);
        }
        return "";
    }

    function _fundOne(Currency currency, address payer, uint256 amount) private {
        if (amount == 0) {
            return;
        }
        // ERC-20 out of the maker's wallet into PoolManager, then held here as claims.
        currency.settle(poolManager, payer, amount, false);
        currency.take(poolManager, address(this), amount, true);
    }

    function _defundOne(Currency currency, address from, address to, uint256 amount) private {
        if (amount == 0) {
            return;
        }
        poolManager.burn(from, currency.toId(), amount);
        currency.take(poolManager, to, amount, false);
    }

    // ------------------------------------------------------------------ pricing

    /// @notice Price a trade without executing it, exactly as `beforeSwap` would.
    /// @dev Pure read: the reserve walk happens only in `beforeSwap`, so this is the hook's `quote()` and
    ///      it agrees with the fill by construction, the same way the Aqua leg's does.
    function quoteSwap(
        PoolKey calldata key,
        bool zeroForOne,
        bool exactIn,
        uint256 amount
    )
        external
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        PoolId id = key.toId();
        Leg memory leg = _legs[id];
        if (leg.maker == address(0)) {
            revert NoLegForPool(id);
        }
        bool riskyIn = zeroForOne == leg.riskyIsCurrency0;
        (uint256 reserveIn, uint256 reserveOut) = riskyIn
            ? (uint256(leg.reserveRisky), uint256(leg.reserveStable))
            : (uint256(leg.reserveStable), uint256(leg.reserveRisky));

        (amountIn, amountOut) = RmmPricer.price(_termsOf(leg), riskyIn, exactIn, amount, reserveIn, reserveOut);

        if (leg.backing == Backing.Wallet) {
            Currency out = zeroForOne ? key.currency1 : key.currency0;
            uint256 free = Coverage.free(address(this), leg.maker, Currency.unwrap(out), 0);
            if (amountOut > free) {
                revert Coverage.NotCovered(amountOut, free);
            }
        }
    }

    /// @notice What the maker can actually deliver of `token` through this hook right now.
    /// @dev `Coverage.free` is the Aqua instruction's own function, called with this hook as the spender
    ///      instead of the registry. Shared across every `Backing.Wallet` leg the maker has written.
    function deliverable(address maker, address token) external view returns (uint256) {
        return Coverage.free(address(this), maker, token, 0);
    }

    function legOf(PoolKey calldata key) external view returns (Leg memory) {
        return _legs[key.toId()];
    }

    /// @notice The stable reserve the curve requires at risky reserve `xWad`, in normalised WAD units.
    function stableFor(RmmPricer.Terms calldata terms, uint256 xWad) external view returns (uint256) {
        return RmmPricer.stableFor(terms, xWad);
    }

    // ------------------------------------------------------------------ hooks

    function _beforeAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    )
        internal
        pure
        override
        returns (bytes4)
    {
        revert LiquidityMustGoThroughTheLeg();
    }

    function _beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    )
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        Leg memory leg = _legs[id];
        address maker = leg.maker;
        if (maker == address(0)) {
            revert NoLegForPool(id);
        }

        bool riskyIn = params.zeroForOne == leg.riskyIsCurrency0;
        bool exactIn = params.amountSpecified < 0;
        uint256 amount = exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);

        uint256 reserveRisky = leg.reserveRisky;
        uint256 reserveStable = leg.reserveStable;
        (uint256 reserveIn, uint256 reserveOut) =
            riskyIn ? (reserveRisky, reserveStable) : (reserveStable, reserveRisky);

        (uint256 amountIn, uint256 amountOut) =
            RmmPricer.price(_termsOf(leg), riskyIn, exactIn, amount, reserveIn, reserveOut);
        if (amountOut > reserveOut) {
            revert ReserveUnderflow(amountOut, reserveOut);
        }

        // The reserve point walks. In Aqua this is `pull`/`push` on the registry's own ledger; here it is
        // a storage write the hook has to do itself, because `PoolManager` has no such ledger to walk.
        if (riskyIn) {
            _legs[id].reserveRisky = (reserveRisky + amountIn).toUint128();
            _legs[id].reserveStable = (reserveStable - amountOut).toUint128();
        } else {
            _legs[id].reserveStable = (reserveStable + amountIn).toUint128();
            _legs[id].reserveRisky = (reserveRisky - amountOut).toUint128();
        }

        (Currency cIn, Currency cOut) =
            params.zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);

        if (leg.backing == Backing.Pooled) {
            cIn.take(poolManager, address(this), amountIn, true);
            cOut.settle(poolManager, address(this), amountOut, true);
        } else {
            // Solvency is checked against the real wallet, in the same call that prices the trade, so a
            // fill on one leg shrinks what every sibling leg backed by this wallet can deliver.
            uint256 free = Coverage.free(address(this), maker, Currency.unwrap(cOut), 0);
            if (amountOut > free) {
                revert Coverage.NotCovered(amountOut, free);
            }
            // Proceeds land as claims: `take(..., false)` here would spend PoolManager's ERC-20 before
            // the taker has settled, i.e. another pool's reserves. `sweep` converts them afterwards.
            cIn.take(poolManager, maker, amountIn, true);
            cOut.settle(poolManager, maker, amountOut, false);
        }

        emit LegFilled(id, riskyIn, amountIn, amountOut);

        int128 deltaSpecified = (-params.amountSpecified).toInt128();
        int128 deltaUnspecified = exactIn ? -amountOut.toInt128() : amountIn.toInt128();
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(deltaSpecified, deltaUnspecified), 0);
    }

    function _termsOf(Leg memory leg) private pure returns (RmmPricer.Terms memory) {
        return RmmPricer.Terms({
            maturity: leg.maturity,
            sigmaWad: leg.sigmaWad,
            strikeWad: leg.strikeWad,
            liquidityWad: leg.liquidityWad,
            rateRisky: leg.rateRisky,
            rateStable: leg.rateStable,
            oneWayAfterExpiry: leg.oneWayAfterExpiry,
            assignmentPaysRisky: leg.assignmentPaysRisky
        });
    }
}
