// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

interface IV4Artifacts {
    function deployPoolManager(address owner) external returns (address);
}

contract SpikeT is Test {
    function test_DeployByArtifactName() public {
        address pm = deployCode("PoolManager.sol:PoolManager", abi.encode(address(this)));
        assertTrue(pm.code.length > 0, "artifact-name path");
        assertTrue(address(new PoolSwapTest(IPoolManager(pm))) != address(0));
    }

    function test_DeployViaShim() public {
        IV4Artifacts shim = IV4Artifacts(deployCode("V4Artifacts.sol:V4Artifacts"));
        address pm = shim.deployPoolManager(address(this));
        assertTrue(pm.code.length > 0, "shim path");
    }
}
