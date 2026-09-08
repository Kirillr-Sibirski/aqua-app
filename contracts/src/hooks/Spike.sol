// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BaseHook } from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BeforeSwapDelta, toBeforeSwapDelta } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { CurrencySettler } from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

import { RmmSwap } from "../instructions/RmmSwap.sol";
import { Gaussian } from "../math/Gaussian.sol";
import { WadMath } from "../math/WadMath.sol";

/// @dev 30-minute spike: does our WAD fixed-point curve compile inside a v4 hook, unchanged?
contract Spike is BaseHook {
    using CurrencySettler for Currency;

    constructor(IPoolManager pm) BaseHook(pm) { }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.beforeSwapReturnDelta = true;
        p.beforeAddLiquidity = true;
    }

    function probe(uint256 x, uint256 K, uint256 s, uint256 L) external pure returns (uint256, uint256, int256) {
        return (RmmSwap.stableOf(x, K, s, L), RmmSwap.riskyOf(1e18, K, s, L), Gaussian.icdf(5e17));
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint256 amt = uint256(-params.amountSpecified);
        uint256 s = uint256(1e18) * WadMath.sqrt(1e17) / 1e18;
        uint256 out = RmmSwap.stableOf(amt, 3000e18, s, 10e18);
        (Currency cin, Currency cout) = params.zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        cin.take(poolManager, address(this), amt, true);
        cout.settle(poolManager, address(this), out, true);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(amt)), -int128(int256(out))), 0);
    }
}
