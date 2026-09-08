// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

contract SpikeT is Test {
    function test_DeployVendoredPoolManager() public {
        address pm =
            deployCode("node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json", abi.encode(address(this)));
        assertGt(pm.code.length, 0);
        emit log_named_uint("PoolManager runtime bytes", pm.code.length);
        assertTrue(address(new PoolSwapTest(IPoolManager(pm))) != address(0));
        assertTrue(address(new PoolModifyLiquidityTest(IPoolManager(pm))) != address(0));
    }
}
