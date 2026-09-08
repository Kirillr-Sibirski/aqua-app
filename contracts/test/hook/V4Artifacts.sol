// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";

/// @dev v4-core pins `PoolManager.sol` to `pragma solidity 0.8.26;` exactly, so no file on our own
///      `0.8.30` pin can import it. This shim is the only file in the repo compiled at 0.8.26; its
///      single job is to make forge emit the `PoolManager` artifact, which the tests then reach by
///      name through `deployCode` instead of by import.
contract V4Artifacts {
    function deployPoolManager(address owner) external returns (address) {
        return address(new PoolManager(owner));
    }
}
