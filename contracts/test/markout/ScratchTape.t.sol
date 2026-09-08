// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, console2 } from "forge-std/Test.sol";

contract ScratchTapeTest is Test {
    function test_A() public view {
        string memory json = vm.readFile("../scripts/arb/series/base-ethusd.json");
        bytes memory raw = vm.parseJson(json, "$.ticks");
        // words 0..2 then the first element body at offset 32 + 55808
        for (uint256 i = 0; i < 4; i++) {
            console2.logBytes32(_word(raw, i));
        }
        console2.log("--- body ---");
        uint256 base = 32 + 55_808; // array data start + element offset
        for (uint256 i = 0; i < 8; i++) {
            console2.logBytes32(_word(raw, (base / 32) + i));
        }
    }

    function _word(bytes memory b, uint256 i) internal pure returns (bytes32 w) {
        assembly {
            w := mload(add(add(b, 32), mul(i, 32)))
        }
    }
}
