// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Cross-check harness: builds instructions, programs, orders and taker traits with the
///   upstream Solidity libraries and dumps them to `test/encoding/vectors.json`. The TypeScript
///   encoder in `web/src/lib/swapvm` is asserted byte-for-byte against this file by
///   `web/src/lib/swapvm/__tests__/encoding.test.ts`. Inputs are mirrored verbatim in that test.
///
///   Regenerate: `forge test --match-path test/encoding/EncodingVectors.t.sol`

import { Test } from "forge-std/Test.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits, MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { SwapRegisters } from "@1inch/swap-vm/src/libs/VM.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";

import { Stop, Revert, Salt, Deadline } from "@1inch/swap-vm/src/instructions/Controls.sol";
import { Jump, JumpIfDirection, JumpIfTokenIn, JumpIfTokenOut } from "@1inch/swap-vm/src/instructions/Jumps.sol";
import {
    OnlyTakerTokenBalanceNonZero,
    OnlyTakerTokenBalanceGte,
    OnlyTakerTokenSupplyShareGte,
    OnlyTxOriginTokenBalanceNonZero
} from "@1inch/swap-vm/src/instructions/TokenValidators.sol";
import { PrivateOrder, WhitelistCoequal, WhitelistSequential } from "@1inch/swap-vm/src/instructions/Whitelist.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { XYCConcentrateSwap } from "@1inch/swap-vm/src/instructions/XYCConcentrate.sol";
import { Decay } from "@1inch/swap-vm/src/instructions/Decay.sol";
import { FeeFlatIn, FeeFlatOut } from "@1inch/swap-vm/src/instructions/FeeFlat.sol";
import { FeeProtocol } from "@1inch/swap-vm/src/instructions/FeeProtocol.sol";
import { PeggedSwap } from "@1inch/swap-vm/src/instructions/PeggedSwap.sol";
import { Extruction } from "@1inch/swap-vm/src/instructions/Extruction.sol";
import { StaticBalances, DynamicBalances } from "@1inch/swap-vm/src/instructions/Balances.sol";
import { LimitSwap, LimitSwapFullAmount } from "@1inch/swap-vm/src/instructions/LimitSwap.sol";
import { InvalidateBit, InvalidateTokenIn, InvalidateTokenOut } from "@1inch/swap-vm/src/instructions/Invalidators.sol";
import { DutchAuctionBalanceIn, DutchAuctionBalanceOut } from "@1inch/swap-vm/src/instructions/DutchAuction.sol";
import { TWAPSwap } from "@1inch/swap-vm/src/instructions/TWAPSwap.sol";
import { RequireMinRate, AdjustMinRate } from "@1inch/swap-vm/src/instructions/MinRate.sol";
import { OraclePriceAdjuster } from "@1inch/swap-vm/src/instructions/OraclePriceAdjuster.sol";
import { BaseFeeAdjuster } from "@1inch/swap-vm/src/instructions/BaseFeeAdjuster.sol";
import {
    PiecewiseLinearScaleBalanceIn,
    PiecewiseLinearScaleBalanceOut
} from "@1inch/swap-vm/src/instructions/PiecewiseLinearScale.sol";
import { ValidateSeriesEpoch } from "@1inch/swap-vm/src/instructions/SeriesEpochManager.sol";
import {
    PrintSwapRegisters,
    PrintSwapQuery,
    PrintVM,
    PrintFreeMemoryPointer,
    PrintGasLeft,
    PrintFee,
    PatchSwapRegisters
} from "@1inch/swap-vm/src/instructions/Debug.sol";

import { ProbeRouter } from "../../src/spikes/ProbeRouter.sol";
import { ProbeScale } from "../../src/spikes/ProbeScale.sol";

contract EncodingVectorsTest is Test {
    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    string constant OUT_PATH = "./test/encoding/vectors.json";

    // Fixed addresses (mirrored in the TS test). Cast from uint literals to avoid checksum requirements.
    address constant TOKEN_A = address(uint160(0x001111111111111111111111111111111111111111));
    address constant TOKEN_B = address(uint160(0x002222222222222222222222222222222222222222));
    address constant FEE_RECEIVER_1 = address(uint160(0x003333333333333333333333333333333333333333));
    address constant FEE_RECEIVER_2 = address(uint160(0x004444444444444444444444444444444444444444));
    address constant FEE_PROVIDER = address(uint160(0x005555555555555555555555555555555555555555));
    address constant WL1 = address(uint160(0x006666666666666666666666666666666666666666));
    address constant WL2 = address(uint160(0x007777777777777777777777777777777777777777));
    address constant WL3 = address(uint160(0x008888888888888888888888888888888888888888));
    address constant MAKER = address(uint160(0x00feedfacefeedfacefeedfacefeedfacefeedface));
    address constant TAKER = address(uint160(0x00deadbeefdeadbeefdeadbeefdeadbeefdeadbeef));
    address constant RECIPIENT = address(uint160(0x00cafebabecafebabecafebabecafebabecafebabe));
    address constant HOOK_TARGET = address(uint160(0x001234567890123456789012345678901234567890));
    address constant ORACLE = address(uint160(0x000123456789abcdef0123456789abcdef01234567));
    address constant EXTRUCTION_TARGET = address(uint160(0x00abcdefabcdefabcdefabcdefabcdefabcdefabcd));

    ProbeRouter router;

    function setUp() public {
        router = new ProbeRouter(address(0xA9), address(0), address(this));
    }

    function test_WriteEncodingVectors() public {
        string memory root = "root";
        vm.serializeString(root, "meta", _meta());
        vm.serializeString(root, "instructions", _instructions());
        vm.serializeString(root, "programs", _programs());
        vm.serializeString(root, "orders", _orders());
        vm.serializeString(root, "taker", _takers());
        string memory json = vm.serializeString(root, "math", _math());
        vm.writeJson(json, OUT_PATH);
    }

    /// @dev The bytes `ProbeScale.build` intends: [_d0][0x04][uint32 factor], as parsed by `ProbeScale.exec`
    ///   (`args.at(0).asU32()`). Built here with the upstream MemoryPtr pattern because `ProbeScale.build`
    ///   resolves the allocation pointer (`start.resolve()`) instead of the write pointer (`ptr.resolve()`),
    ///   which reverts with MemoryPtrStrictResolveFailed.
    function _probeScale(uint32 factor) internal pure returns (bytes memory) {
        MemoryPtr start = MemoryPtrLib.alloc(InstructionBuilder.sizeOf() + 4);
        MemoryPtr ptr = start.pushHeader(ProbeScale.opcode).push(uint256(factor), 4);
        start.patchLength(ptr);
        return ptr.resolve();
    }

    // ------------------------------------------------------------------ meta

    function _meta() internal returns (string memory) {
        string memory k = "meta";
        vm.serializeAddress(k, "router", address(router));
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeString(k, "name", "ProbeRouter");
        return vm.serializeString(k, "version", "1");
    }

    // ---------------------------------------------------------- instructions

    string internal ixJson;

    function _ix(string memory key, bytes memory value) internal {
        ixJson = vm.serializeBytes("instructions", key, value);
    }

    function _instructions() internal returns (string memory) {
        _instructionsControls();
        _instructionsGuards();
        _instructionsCurves();
        _instructionsFees();
        _instructionsBalances();
        _instructionsMisc();
        return ixJson;
    }

    function _instructionsControls() internal {
        _ix("stop", Stop.build());
        _ix("revertBytes4", Revert.build(bytes4(0xdeadbeef)));
        bytes memory revertData = hex"0102030405";
        _ix("revertBytes", Revert.build(revertData));
        _ix("saltU64", Salt.build(uint64(0x0123456789abcdef)));
        bytes memory saltData = hex"00112233445566778899";
        _ix("saltBytes", Salt.build(saltData));
        _ix("deadline", Deadline.build(uint40(1_800_000_000)));
        _ix("jump", Jump.build(0x1234));
        _ix("jumpIfDirectionTrue", JumpIfDirection.build(true, 0x0042));
        _ix("jumpIfDirectionFalse", JumpIfDirection.build(false, 0x0042));
        _ix("jumpIfDirectionTokens", JumpIfDirection.build(TOKEN_B, TOKEN_A, 7));
        _ix("jumpIfTokenIn", JumpIfTokenIn.build(TOKEN_A, 0x00ff));
        _ix("jumpIfTokenOut", JumpIfTokenOut.build(TOKEN_B, 0xffff));
    }

    function _instructionsGuards() internal {
        _ix("onlyTakerTokenBalanceNonZero", OnlyTakerTokenBalanceNonZero.build(TOKEN_A));
        _ix("onlyTakerTokenBalanceGte", OnlyTakerTokenBalanceGte.build(TOKEN_B, 12345678901234567890123456789));
        _ix("onlyTakerTokenSupplyShareGte", OnlyTakerTokenSupplyShareGte.build(TOKEN_A, uint64(0.5e18)));
        _ix("onlyTxOriginTokenBalanceNonZero", OnlyTxOriginTokenBalanceNonZero.build(TOKEN_B));
        _ix("privateOrder", PrivateOrder.build(TAKER));

        address[] memory coequal = new address[](3);
        coequal[0] = WL1;
        coequal[1] = WL2;
        coequal[2] = TAKER;
        _ix("whitelistCoequal", WhitelistCoequal.build(0x0010, coequal));

        address[] memory sequential = new address[](3);
        sequential[0] = WL1;
        sequential[1] = WL2;
        sequential[2] = WL3;
        uint16[] memory durations = new uint16[](3);
        durations[0] = 100;
        durations[1] = 200;
        durations[2] = 300;
        _ix("whitelistSequential", WhitelistSequential.build(uint40(1_700_000_000), 0x0020, sequential, durations));
    }

    function _instructionsCurves() internal {
        _ix("xycSwap", XYCSwap.build());
        _ix("xycConcentrateSwap", XYCConcentrateSwap.build(0.5e18, 2e18));
        _ix("limitSwapTrue", LimitSwap.build(true));
        _ix("limitSwapFalse", LimitSwap.build(false));
        _ix("limitSwapTokens", LimitSwap.build(TOKEN_A, TOKEN_B));
        _ix("limitSwapFullAmountTrue", LimitSwapFullAmount.build(true));
        _ix("limitSwapFullAmountFalse", LimitSwapFullAmount.build(false));
        _ix("peggedSwap", PeggedSwap.build(1000e18, 1000e18, 100e27, 1, 1e12));
        _ix("twapSwap", TWAPSwap.build(1000e18, 2000e18, 1_700_000_000, 86400, 1.1e18, 1e18));
    }

    function _instructionsFees() internal {
        _ix("feeFlatIn", FeeFlatIn.build(30_000));
        _ix("feeFlatOut", FeeFlatOut.build(12_345));

        FeeProtocol.ReceiverConfig[] memory r1 = new FeeProtocol.ReceiverConfig[](1);
        r1[0] = FeeProtocol.ReceiverConfig({ receiver: FEE_RECEIVER_1, feeBps: 1000, surplusBps: 0 });
        FeeProtocol.ProviderConfig[] memory p0 = new FeeProtocol.ProviderConfig[](0);
        _ix("feeProtocolSimple", FeeProtocol.build(true, r1, p0, 0));

        FeeProtocol.ReceiverConfig[] memory r2 = new FeeProtocol.ReceiverConfig[](2);
        r2[0] = FeeProtocol.ReceiverConfig({ receiver: FEE_RECEIVER_1, feeBps: 1000, surplusBps: 0 });
        r2[1] = FeeProtocol.ReceiverConfig({ receiver: FEE_RECEIVER_2, feeBps: 0, surplusBps: 500_000 });
        FeeProtocol.ProviderConfig[] memory p1 = new FeeProtocol.ProviderConfig[](1);
        p1[0] = FeeProtocol.ProviderConfig({ provider: FEE_PROVIDER, takeFlatFee: true, takeSurplusFee: true });
        _ix("feeProtocolFull", FeeProtocol.build(false, r2, p1, uint216(987654321e9)));

        FeeProtocol.ReceiverConfig[] memory r3 = new FeeProtocol.ReceiverConfig[](1);
        r3[0] = FeeProtocol.ReceiverConfig({ receiver: FEE_RECEIVER_2, feeBps: 2500, surplusBps: 100_000 });
        _ix("feeProtocolBoth", FeeProtocol.build(true, r3, p0, uint216(42)));
    }

    function _instructionsBalances() internal {
        _ix("staticBalances", StaticBalances.build(100e18, 200e18));
        _ix("dynamicBalances", DynamicBalances.build(300e18, 400e18));
        _ix("decay", Decay.build(3600));
        _ix("dutchAuctionBalanceIn", DutchAuctionBalanceIn.build(uint40(1_700_000_000), 3600, uint64(0.99e18)));
        _ix("dutchAuctionBalanceOut", DutchAuctionBalanceOut.build(uint40(1_700_000_001), 7200, uint64(0.5e18)));

        uint16[] memory d2 = new uint16[](2);
        d2[0] = 600;
        d2[1] = 1200;
        uint24[] memory s3 = new uint24[](3);
        s3[0] = 1_000_000;
        s3[1] = 900_000;
        s3[2] = 800_000;
        _ix("piecewiseLinearScaleBalanceIn", PiecewiseLinearScaleBalanceIn.build(uint40(1_700_000_000), d2, s3));

        uint16[] memory d1 = new uint16[](1);
        d1[0] = 600;
        uint24[] memory s2 = new uint24[](2);
        s2[0] = 1_000_000;
        s2[1] = 1_100_000;
        _ix("piecewiseLinearScaleBalanceOut", PiecewiseLinearScaleBalanceOut.build(uint40(1_700_000_000), d1, s2));
    }

    function _instructionsMisc() internal {
        _ix("invalidateBit", InvalidateBit.build(0xdeadbeef));
        _ix("invalidateTokenIn", InvalidateTokenIn.build());
        _ix("invalidateTokenOut", InvalidateTokenOut.build());
        _ix("validateSeriesEpoch", ValidateSeriesEpoch.build(42, 7));
        _ix("requireMinRate", RequireMinRate.build(uint64(1e18), uint64(2e18)));
        _ix("adjustMinRate", AdjustMinRate.build(uint64(3e18), uint64(4e18)));
        _ix("oraclePriceAdjuster", OraclePriceAdjuster.build(uint64(0.05e18), 3600, 8, ORACLE));
        _ix("baseFeeAdjuster", BaseFeeAdjuster.build(uint64(30 gwei), uint96(3000e6), 150_000, uint64(0.1e18)));
        bytes memory extructionArgs = hex"aabbccdd";
        _ix("extruction", Extruction.build(EXTRUCTION_TARGET, extructionArgs));
        _ix("patchSwapRegisters", PatchSwapRegisters.build(SwapRegisters({ balanceIn: 1, balanceOut: 2, amountIn: 3, amountOut: 4 })));
        _ix("printSwapRegisters", PrintSwapRegisters.build());
        _ix("printSwapQuery", PrintSwapQuery.build());
        _ix("printVM", PrintVM.build());
        _ix("printFreeMemoryPointer", PrintFreeMemoryPointer.build());
        _ix("printGasLeft", PrintGasLeft.build());
        _ix("printFee", PrintFee.build());
        _ix("probeScale", _probeScale(1_500_000_000));
    }

    // -------------------------------------------------------------- programs

    function _programXycFee() internal pure returns (bytes memory) {
        return bytes.concat(FeeFlatIn.build(30_000), XYCSwap.build(), Stop.build());
    }

    function _programConcentrated() internal pure returns (bytes memory) {
        return bytes.concat(Salt.build(uint64(1)), XYCConcentrateSwap.build(0.5e18, 2e18), Stop.build());
    }

    /// @dev pc: 0 JumpIfDirection(5) | 5 FeeFlatIn(5) | 10 XYCSwap(2) | 12 Stop(2) | 14 FeeFlatIn(5) | 19 XYCSwap | 21 Stop
    function _programJumps() internal pure returns (bytes memory) {
        return bytes.concat(
            JumpIfDirection.build(true, 14),
            FeeFlatIn.build(1000),
            XYCSwap.build(),
            Stop.build(),
            FeeFlatIn.build(2000),
            XYCSwap.build(),
            Stop.build()
        );
    }

    function _programProbe() internal pure returns (bytes memory) {
        return bytes.concat(_probeScale(1_500_000_000), XYCSwap.build());
    }

    function _programs() internal returns (string memory) {
        string memory k = "programs";
        vm.serializeBytes(k, "xycFee", _programXycFee());
        vm.serializeBytes(k, "concentrated", _programConcentrated());
        vm.serializeBytes(k, "jumps", _programJumps());
        return vm.serializeBytes(k, "probe", _programProbe());
    }

    // ---------------------------------------------------------------- orders

    function _emptyArgs() internal pure returns (MakerTraitsLib.Args memory a) {
        a.maker = MAKER;
        a.tokenA = TOKEN_A;
        a.tokenB = TOKEN_B;
    }

    function _orderAquaNoHooks() internal pure returns (ISwapVM.Order memory) {
        MakerTraitsLib.Args memory a = _emptyArgs();
        a.useAquaInsteadOfSignature = true;
        a.program = _programXycFee();
        return MakerTraitsLib.build(a);
    }

    function _orderAquaHooks() internal pure returns (ISwapVM.Order memory) {
        MakerTraitsLib.Args memory a = _emptyArgs();
        a.useAquaInsteadOfSignature = true;
        a.allowZeroAmountIn = true;
        a.hasPreTransferInHook = true;
        a.preTransferInTarget = HOOK_TARGET; // explicit target -> 20 bytes encoded
        a.preTransferInData = hex"01";
        a.hasPostTransferInHook = true;
        a.postTransferInTarget = MAKER; // == maker -> no target encoded
        a.postTransferInData = hex"0203";
        a.hasPreTransferOutHook = true; // flag set, no target, no data -> empty slice
        a.hasPostTransferOutHook = true;
        a.postTransferOutTarget = HOOK_TARGET;
        a.postTransferOutData = hex"04050607";
        a.program = _programConcentrated();
        return MakerTraitsLib.build(a);
    }

    function _orderSignature() internal pure returns (ISwapVM.Order memory) {
        MakerTraitsLib.Args memory a = _emptyArgs();
        a.receiver = RECIPIENT;
        a.shouldUnwrapWeth = true;
        a.program = _programJumps();
        return MakerTraitsLib.build(a);
    }

    function _orderProbe() internal pure returns (ISwapVM.Order memory) {
        MakerTraitsLib.Args memory a = _emptyArgs();
        a.useAquaInsteadOfSignature = true;
        a.program = _programProbe();
        return MakerTraitsLib.build(a);
    }

    function _serializeOrder(string memory key, ISwapVM.Order memory order) internal returns (string memory) {
        bytes32 h = router.hash(order);
        if (MakerTraitsLib.useAquaInsteadOfSignature(order.traits)) {
            assertEq(h, keccak256(abi.encode(order)), "aqua hash mismatch");
        }
        vm.serializeAddress(key, "maker", order.maker);
        vm.serializeBytes32(key, "traits", bytes32(MakerTraits.unwrap(order.traits)));
        vm.serializeBytes(key, "data", order.data);
        vm.serializeBytes32(key, "hash", h);
        return vm.serializeBytes(key, "encoded", abi.encode(order));
    }

    function _orders() internal returns (string memory) {
        string memory k = "orders";
        vm.serializeString(k, "aquaNoHooks", _serializeOrder("orderAquaNoHooks", _orderAquaNoHooks()));
        vm.serializeString(k, "aquaHooks", _serializeOrder("orderAquaHooks", _orderAquaHooks()));
        vm.serializeString(k, "signature", _serializeOrder("orderSignature", _orderSignature()));
        return vm.serializeString(k, "probe", _serializeOrder("orderProbe", _orderProbe()));
    }

    // ----------------------------------------------------------------- taker

    function _takerArgs(bool isExactIn, bool isAToB) internal pure returns (TakerTraitsLib.Args memory a) {
        a.taker = TAKER;
        a.isExactIn = isExactIn;
        a.isAToB = isAToB;
        a.useTransferFromAndAquaPush = true;
        a.threshold = abi.encode(uint256(123456789e9));
        a.to = RECIPIENT;
        a.deadline = uint40(1_800_000_000);
        a.instructionsArgs = hex"aabbcc";
    }

    function _takers() internal returns (string memory) {
        string memory k = "taker";
        vm.serializeBytes(k, "exactInAToB", TakerTraitsLib.build(_takerArgs(true, true)));
        vm.serializeBytes(k, "exactInBToA", TakerTraitsLib.build(_takerArgs(true, false)));
        vm.serializeBytes(k, "exactOutAToB", TakerTraitsLib.build(_takerArgs(false, true)));
        vm.serializeBytes(k, "exactOutBToA", TakerTraitsLib.build(_takerArgs(false, false)));

        TakerTraitsLib.Args memory minimal;
        minimal.taker = TAKER;
        minimal.isExactIn = true;
        minimal.isAToB = true;
        vm.serializeBytes(k, "minimal", TakerTraitsLib.build(minimal));

        TakerTraitsLib.Args memory toIsTaker = _takerArgs(true, true);
        toIsTaker.to = TAKER;
        vm.serializeBytes(k, "toIsTaker", TakerTraitsLib.build(toIsTaker));

        TakerTraitsLib.Args memory full = _takerArgs(false, false);
        full.shouldUnwrapWeth = true;
        full.isStrictThresholdAmount = true;
        full.isFirstTransferFromTaker = true;
        full.allowPartialFill = true;
        full.hasPreTransferInCallback = true;
        full.hasPreTransferOutCallback = true;
        full.threshold = abi.encode(uint256(1e18));
        full.preTransferInHookData = hex"11";
        full.postTransferInHookData = hex"2222";
        full.preTransferOutHookData = hex"333333";
        full.postTransferOutHookData = hex"44444444";
        full.preTransferInCallbackData = hex"5555555555";
        full.preTransferOutCallbackData = hex"666666666666";
        full.instructionsArgs = hex"77777777777777";
        full.signature = bytes.concat(bytes32(uint256(0x1111)), bytes32(uint256(0x2222)), bytes1(0x1b));
        return vm.serializeBytes(k, "full", TakerTraitsLib.build(full));
    }

    // ------------------------------------------------------------------ math

    function _math() internal returns (string memory) {
        string memory k = "math";
        uint256 liquidity = XYCConcentrateSwap.computeLiquidity(100e18, 200e18, 0.5e18, 2e18);
        (uint256 liquidity2, uint256 spot) = XYCConcentrateSwap.computeLiquidityAndPrice(100e18, 200e18, 0.5e18, 2e18);
        assertEq(liquidity, liquidity2);
        (uint256 balanceA, uint256 balanceB) = XYCConcentrateSwap.computeBalances(liquidity, spot, 0.5e18, 2e18);
        (uint256 liquidity3, uint256 actualA, uint256 actualB) =
            XYCConcentrateSwap.computeLiquidityFromAmounts(100e18, 200e18, 1e18, 0.5e18, 2e18);

        vm.serializeBytes32(k, "liquidity", bytes32(liquidity));
        vm.serializeBytes32(k, "sqrtPriceSpot", bytes32(spot));
        vm.serializeBytes32(k, "balanceA", bytes32(balanceA));
        vm.serializeBytes32(k, "balanceB", bytes32(balanceB));
        vm.serializeBytes32(k, "liquidityFromAmounts", bytes32(liquidity3));
        vm.serializeBytes32(k, "actualA", bytes32(actualA));
        return vm.serializeBytes32(k, "actualB", bytes32(actualB));
    }
}
