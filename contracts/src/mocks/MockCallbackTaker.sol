// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { ITakerCallbacks } from "@1inch/swap-vm/src/interfaces/ITakerCallbacks.sol";

/// @notice Contract taker for the "callback" transfer mode (useTransferFromAndAquaPush = false):
///         SwapVM calls preTransferInCallback and the taker pushes tokenIn into the maker's Aqua balance itself.
contract MockCallbackTaker is ITakerCallbacks {
    IAqua public immutable AQUA;
    address public immutable ROUTER;

    error NotRouter();

    constructor(IAqua aqua, address router) {
        AQUA = aqua;
        ROUTER = router;
    }

    function swap(ISwapVM.Order calldata order, uint256 amount, bytes calldata takerTraitsAndData)
        external
        returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)
    {
        return ISwapVM(ROUTER).swap(order, amount, takerTraitsAndData);
    }

    function preTransferInCallback(
        address maker,
        address, /* taker */
        address tokenIn,
        address, /* tokenOut */
        uint256 amountIn,
        uint256, /* amountOut */
        bytes32 orderHash,
        bytes calldata /* takerData */
    ) external override {
        require(msg.sender == ROUTER, NotRouter());
        IERC20(tokenIn).approve(address(AQUA), amountIn);
        AQUA.push(maker, ROUTER, orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(
        address, address, address, address, uint256, uint256, bytes32, bytes calldata
    ) external view override {
        require(msg.sender == ROUTER, NotRouter());
    }
}
