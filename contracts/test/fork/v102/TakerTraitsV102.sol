// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title TakerTraitsV102
/// @notice Vendored, dependency-free re-implementation of `TakerTraitsLib.build` from swap-vm tag v1.0.2
///         (`scratchpad/refs/swap-vm-v1.0.2/src/libs/TakerTraits.sol`), i.e. the taker-side encoding the
///         DEPLOYED router 0x111111338c5091E8440b67B168bAe16a668AC0De parses.
/// @dev Layout of the packed bytes (parsed by `TakerTraitsLib.parse`: first 22 bytes are the traits):
///        [20 bytes slice-index table: 10 x uint16 little-slot (index_i << 16*i)]
///        [2 bytes flags]
///        threshold ‖ to ‖ deadline ‖ preIn/postIn/preOut/postOut hook data ‖ preIn/preOut callback data
///        ‖ instructionsArgs ‖ signature
///      Flags (v1.0.2 has 7; HEAD adds isAToB=0x80 and allowPartialFill=0x100 which do NOT exist here):
///        0x0001 isExactIn, 0x0002 shouldUnwrapWeth, 0x0004 hasPreTransferInCallback,
///        0x0008 hasPreTransferOutCallback, 0x0010 isStrictThresholdAmount,
///        0x0020 isFirstTransferFromTaker, 0x0040 useTransferFromAndAquaPush.
///      Golden vector: the 1inch swap-vm-sdk `TakerTraits.default().encode()` =
///        0x00000000000000000000000000000000000000000041 (exactIn + useTransferFromAndAquaPush, no data).
library TakerTraitsV102 {
    error TakerTraitsV102ThresholdLengthInvalid(uint256 length);
    error TakerTraitsV102SliceTooLarge(uint256 index);
    error TakerTraitsV102MissingHasPreTransferInFlag();
    error TakerTraitsV102MissingHasPreTransferOutFlag();

    uint16 internal constant IS_EXACT_IN_BIT_FLAG = 0x0001;
    uint16 internal constant SHOULD_UNWRAP_BIT_FLAG = 0x0002;
    uint16 internal constant HAS_PRE_TRANSFER_IN_CALLBACK_BIT_FLAG = 0x0004;
    uint16 internal constant HAS_PRE_TRANSFER_OUT_CALLBACK_BIT_FLAG = 0x0008;
    uint16 internal constant IS_STRICT_THRESHOLD_BIT_FLAG = 0x0010;
    uint16 internal constant IS_FIRST_TRANSFER_FROM_TAKER_BIT_FLAG = 0x0020;
    uint16 internal constant USE_TRANSFER_FROM_AND_AQUA_PUSH_FLAG = 0x0040;

    /// @dev Mirrors `TakerTraitsLib.Args` of the tag, field for field.
    struct Args {
        address taker;
        bool isExactIn;
        bool shouldUnwrapWeth;
        bool isStrictThresholdAmount;
        bool isFirstTransferFromTaker;
        bool useTransferFromAndAquaPush;
        bytes threshold; // 32 bytes or empty
        address to; // address(0) or == taker => omitted (tokens go to the taker)
        uint40 deadline; // 0 => omitted
        bool hasPreTransferInCallback;
        bool hasPreTransferOutCallback;
        bytes preTransferInHookData;
        bytes postTransferInHookData;
        bytes preTransferOutHookData;
        bytes postTransferOutHookData;
        bytes preTransferInCallbackData;
        bytes preTransferOutCallbackData;
        bytes instructionsArgs;
        bytes signature; // must be EMPTY for Aqua-mode orders
    }

    /// @notice EOA taker in Aqua mode: exactIn, router does transferFrom(taker) + Aqua.push, no threshold.
    function defaultArgs(address taker) internal pure returns (Args memory a) {
        a.taker = taker;
        a.isExactIn = true;
        a.useTransferFromAndAquaPush = true;
    }

    /// @notice Same as `defaultArgs` plus a min-amountOut (exactIn) / max-amountIn (exactOut) threshold.
    function withThreshold(Args memory a, uint256 threshold) internal pure returns (Args memory) {
        a.threshold = threshold == 0 ? bytes("") : abi.encodePacked(threshold);
        return a;
    }

    /// @notice Byte-for-byte port of `TakerTraitsLib.build` (v1.0.2).
    function build(Args memory args) internal pure returns (bytes memory packed) {
        require(
            args.threshold.length == 32 || args.threshold.length == 0,
            TakerTraitsV102ThresholdLengthInvalid(args.threshold.length)
        );
        if (args.preTransferInCallbackData.length > 0) {
            require(args.hasPreTransferInCallback, TakerTraitsV102MissingHasPreTransferInFlag());
        }
        if (args.preTransferOutCallbackData.length > 0) {
            require(args.hasPreTransferOutCallback, TakerTraitsV102MissingHasPreTransferOutFlag());
        }

        bool hasTo = args.to != address(0) && args.to != args.taker;

        uint256 index0 = args.threshold.length;
        uint256 index1 = index0 + (hasTo ? 20 : 0);
        uint256 index2 = index1 + (args.deadline != 0 ? 5 : 0);
        uint256 index3 = _u16(index2 + args.preTransferInHookData.length);
        uint256 index4 = _u16(index3 + args.postTransferInHookData.length);
        uint256 index5 = _u16(index4 + args.preTransferOutHookData.length);
        uint256 index6 = _u16(index5 + args.postTransferOutHookData.length);
        uint256 index7 = _u16(index6 + args.preTransferInCallbackData.length);
        uint256 index8 = _u16(index7 + args.preTransferOutCallbackData.length);
        uint256 index9 = _u16(index8 + args.instructionsArgs.length);

        uint160 slicesIndexes = uint160(
            (uint160(index0) << 0) | (uint160(index1) << 16) | (uint160(index2) << 32) | (uint160(index3) << 48)
                | (uint160(index4) << 64) | (uint160(index5) << 80) | (uint160(index6) << 96) | (uint160(index7) << 112)
                | (uint160(index8) << 128) | (uint160(index9) << 144)
        );

        uint16 flags = (args.isExactIn ? IS_EXACT_IN_BIT_FLAG : 0)
            | (args.shouldUnwrapWeth ? SHOULD_UNWRAP_BIT_FLAG : 0)
            | (args.isStrictThresholdAmount ? IS_STRICT_THRESHOLD_BIT_FLAG : 0)
            | (args.isFirstTransferFromTaker ? IS_FIRST_TRANSFER_FROM_TAKER_BIT_FLAG : 0)
            | (args.useTransferFromAndAquaPush ? USE_TRANSFER_FROM_AND_AQUA_PUSH_FLAG : 0)
            | (args.hasPreTransferInCallback ? HAS_PRE_TRANSFER_IN_CALLBACK_BIT_FLAG : 0)
            | (args.hasPreTransferOutCallback ? HAS_PRE_TRANSFER_OUT_CALLBACK_BIT_FLAG : 0);

        packed = abi.encodePacked(
            slicesIndexes,
            flags,
            args.threshold,
            hasTo ? abi.encodePacked(args.to) : bytes(""),
            args.deadline != 0 ? abi.encodePacked(args.deadline) : bytes(""),
            args.preTransferInHookData,
            args.postTransferInHookData,
            args.preTransferOutHookData,
            args.postTransferOutHookData
        );
        // second encodePacked to stay under the stack limit
        packed = abi.encodePacked(
            packed,
            args.preTransferInCallbackData,
            args.preTransferOutCallbackData,
            args.instructionsArgs,
            args.signature
        );
    }

    function _u16(uint256 v) private pure returns (uint256) {
        require(v <= type(uint16).max, TakerTraitsV102SliceTooLarge(v));
        return v;
    }
}
