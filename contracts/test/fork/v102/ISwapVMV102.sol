// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ISwapVMV102
/// @notice Minimal ABI of the DEPLOYED, UNMODIFIED 1inch `AquaSwapVMRouter` (swap-vm tag v1.0.2, "World A")
///         at 0x111111338c5091E8440b67B168bAe16a668AC0De (same address on Ethereum and Base).
/// @dev    Differences vs the HEAD `ISwapVM` our ProbeRouter is built on (see kb/swapvm-core.md §14):
///         - `quote`/`swap` are 5-arg: (order, tokenIn, tokenOut, amount, takerTraitsAndData)
///           selectors 0x44aa5f14 / 0xf4d2d412 (HEAD: 3-arg 0xb7ebf0c5 / 0xa69f95bd, payable).
///         - `order.data` = hooks ‖ program (HEAD prepends tokenA ‖ tokenB).
///         - Taker traits: 20-byte slice index table + 2-byte flags (7 flags; HEAD has 9).
///         - `Order` ABI shape is identical (address, uint256, bytes) so the Aqua-mode hash
///           keccak256(abi.encode(order)) is computed the same way by both routers.
///         Source: scratchpad/refs/swap-vm-v1.0.2/src/interfaces/ISwapVM.sol + SwapVM.sol + instructions/*.sol.
interface ISwapVMV102 {
    struct Order {
        address maker;
        uint256 traits; // MakerTraits (user-defined value type over uint256 in the tag)
        bytes data;
    }

    /// @dev SwapVM.sol:52 (v1.0.2) — identical signature to HEAD's `SwapVM.Swapped`.
    event Swapped(
        bytes32 orderHash,
        address maker,
        address taker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    /// @dev instructions/Fee.sol:72 (v1.0.2) — emitted when `aquaProtocolFeeAmountInXD` cannot pull the fee.
    event ProtocolFeeSkipped(bytes32 orderHash, address token, address to, uint256 amount);

    /// @dev instructions/Controls.sol:65 (v1.0.2) — the KycNFT gate (`onlyTxOriginTokenBalanceNonZero`, opcode 0x21).
    error TxOriginTokenBalanceIsZero(address txOrigin, address token);

    function AQUA() external view returns (address);

    function hash(Order calldata order) external view returns (bytes32);

    function quote(
        Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    )
        external
        view
        returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);

    function swap(
        Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    )
        external
        returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);

    /// @dev OpenZeppelin EIP712 (ERC-5267); deployed router reports ("1inch SwapVM v1.0", "1.0.2").
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}
