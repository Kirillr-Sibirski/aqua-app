// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

/// @notice TokenMock with configurable decimals (e.g. USDC = 6). Owner (deployer) can mint/burn.
contract TokenMockDecimals is TokenMock {
    uint8 private immutable _DECIMALS;

    constructor(string memory name, string memory symbol, uint8 decimals_) TokenMock(name, symbol) {
        _DECIMALS = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _DECIMALS;
    }
}
