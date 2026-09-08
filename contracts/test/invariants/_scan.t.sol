// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/Test.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { StrikelineLeg } from "./StrikelineLeg.sol";

contract ScanTest is StrikelineLeg {
    ISwapVM.Order internal leg;

    function setUp() public override {
        super.setUp();
        (leg,,) = shipDemoLeg(9);
    }

    function test_Scan() public {
        uint256 y = sl.stableFor(K, SIGMA, maturity, L, X0);
        console2.log("y0 wad", y, "usdc", y / RATE_STABLE);
        vm.warp(block.timestamp + 2 days);
        (uint256 mr, uint256 ms) = sl.bandFor(K, SIGMA, maturity, L, X0, y);
        console2.log("band risky wei", mr);
        console2.log("band stable usdc", ms / RATE_STABLE);

        bytes memory td = takerDataFor(leg, address(usdc), true);
        uint256 prev;
        for (uint256 i = 1; i <= 40; ++i) {
            uint256 amt = i * 200e6;
            (bool ok, bytes memory ret) =
                address(sl).staticcall(abi.encodeCall(ISwapVM.quote, (leg, amt, td)));
            if (!ok) {
                console2.log("amt", amt / 1e6, "REVERT");
                ret;
                continue;
            }
            (, uint256 out,) = abi.decode(ret, (uint256, uint256, bytes32));
            uint256 price = out * 1e18 / amt;
            console2.log("amt(usdc)", amt / 1e6, "price", price);
            if (prev != 0 && price > prev) {
                console2.log("   still rising at", amt / 1e6);
            }
            prev = price;
        }
    }
}
