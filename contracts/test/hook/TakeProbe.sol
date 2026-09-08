// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice Evidence for one claim in FEEDBACK.md §6: `PoolManager.take` with `claims: false` moves real
///         ERC-20 out of the manager's own balance, so a hook that pays a wallet from inside `beforeSwap`
///         is spending tokens the taker has not settled yet.
/// @dev Nothing in the contract is Strikeline-specific. It unlocks and takes, which is the smallest
///      program that shows what `take` actually reaches for.
contract TakeProbe is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager pm) {
        poolManager = pm;
    }

    function takeFrom(Currency currency, address to, uint256 amount) external {
        poolManager.unlock(abi.encode(currency, to, amount));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not the manager");
        (Currency currency, address to, uint256 amount) = abi.decode(data, (Currency, address, uint256));
        poolManager.take(currency, to, amount);
        return "";
    }
}
