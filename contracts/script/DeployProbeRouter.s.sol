// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";

import { ProbeRouter } from "../src/ProbeRouter.sol";

/// @notice Deploys ProbeRouter pointing at an Aqua deployment.
/// @dev Defaults target Ethereum mainnet (official Aqua + WETH). Override with env vars:
///      AQUA=<addr> WETH=<addr> OWNER=<addr> forge script script/DeployProbeRouter.s.sol --rpc-url ... --broadcast
contract DeployProbeRouter is Script {
    address constant AQUA_MAINNET = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant WETH_MAINNET = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    function run() external returns (ProbeRouter router) {
        address aqua = vm.envOr("AQUA", AQUA_MAINNET);
        address weth = vm.envOr("WETH", WETH_MAINNET);
        address owner = vm.envOr("OWNER", msg.sender);

        require(aqua.code.length > 0, "AQUA has no code on this chain");
        require(weth.code.length > 0, "WETH has no code on this chain");

        vm.startBroadcast();
        router = new ProbeRouter(aqua, weth, owner);
        vm.stopBroadcast();

        console.log("ProbeRouter deployed:", address(router));
        console.log("  AQUA :", aqua);
        console.log("  WETH :", weth);
        console.log("  OWNER:", owner);
    }
}
