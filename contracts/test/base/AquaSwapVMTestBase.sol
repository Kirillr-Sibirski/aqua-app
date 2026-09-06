// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";

import { ProbeRouter } from "../../src/ProbeRouter.sol";
import { ProbeScale } from "../../src/instructions/ProbeScale.sol";
import { WETHMock } from "../../src/mocks/WETHMock.sol";
import { TokenMockDecimals } from "../../src/mocks/TokenMockDecimals.sol";

/// @title AquaSwapVMTestBase
/// @notice Reusable Foundry harness for Aqua-backed SwapVM strategies executed through ProbeRouter.
/// @dev Environment overrides (all optional):
///      - AQUA  : address of an already-deployed Aqua (e.g. on a fork). Default: deploy a fresh Aqua.
///      - WETH  : address of an already-deployed WETH.          Default: deploy WETHMock.
///      Fork tests override `_resolveAqua`, `_resolveWeth`, `_deployTokens` instead of using env vars.
abstract contract AquaSwapVMTestBase is Test {
    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    // ------------------------------------------------------------------ actors & contracts

    IAqua public aqua;
    ProbeRouter public router;

    /// @dev WETH used by the router (WETHMock locally, real WETH on a fork).
    address public weth;
    /// @dev 6-decimals stable (TokenMockDecimals locally, real USDC on a fork).
    IERC20 public usdc;
    /// @dev 18-decimals token (TokenMockDecimals locally, real DAI on a fork).
    IERC20 public dai;

    address public maker;
    uint256 public makerPk;
    address public taker;

    /// @dev True when Aqua came from the AQUA env var (or a fork override) instead of a fresh deploy.
    bool public aquaIsExternal;

    // ------------------------------------------------------------------ snapshot

    /// @notice Wallet + Aqua virtual balances for a (maker, taker, order) triple.
    struct Snapshot {
        uint256 makerA;
        uint256 makerB;
        uint256 takerA;
        uint256 takerB;
        uint256 routerA;
        uint256 routerB;
        uint256 aquaA; // Aqua virtual balance of tokenA (rawBalances, never reverts)
        uint256 aquaB;
        uint8 tokensCountA; // Aqua tokensCount marker: 0 = never shipped, 0xff = docked
        uint8 tokensCountB;
    }

    // ------------------------------------------------------------------ setup

    function setUp() public virtual {
        makerPk = 0xA11CE;
        maker = vm.addr(makerPk);
        taker = makeAddr("taker");
        vm.label(maker, "maker");
        vm.label(taker, "taker");

        aqua = _resolveAqua();
        weth = _resolveWeth();
        _deployTokens();

        router = new ProbeRouter(address(aqua), weth, address(this));

        vm.label(address(aqua), "Aqua");
        vm.label(address(router), "ProbeRouter");
        vm.label(weth, "WETH");
        vm.label(address(usdc), "USDC");
        vm.label(address(dai), "DAI");
    }

    function _resolveAqua() internal virtual returns (IAqua) {
        address fromEnv = vm.envOr("AQUA", address(0));
        if (fromEnv != address(0)) {
            require(fromEnv.code.length > 0, "AQUA env var points to an address without code");
            aquaIsExternal = true;
            return IAqua(fromEnv);
        }
        return IAqua(address(new Aqua()));
    }

    function _resolveWeth() internal virtual returns (address) {
        address fromEnv = vm.envOr("WETH", address(0));
        if (fromEnv != address(0)) {
            require(fromEnv.code.length > 0, "WETH env var points to an address without code");
            return fromEnv;
        }
        return address(new WETHMock());
    }

    function _deployTokens() internal virtual {
        usdc = IERC20(address(new TokenMockDecimals("USD Coin", "USDC", 6)));
        dai = IERC20(address(new TokenMockDecimals("Dai Stablecoin", "DAI", 18)));
    }

    // ------------------------------------------------------------------ order building

    /// @notice Build an Aqua-mode order (useAquaInsteadOfSignature = true, no hooks).
    /// @dev Tokens are sorted automatically because MakerTraitsLib.build requires tokenA < tokenB.
    ///      Use `orderTokens` / `isAToB` to learn which side ended up as tokenA.
    function buildAquaOrder(address maker_, address tokenA_, address tokenB_, bytes memory program)
        public
        pure
        returns (ISwapVM.Order memory)
    {
        if (tokenA_ > tokenB_) (tokenA_, tokenB_) = (tokenB_, tokenA_);
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: maker_,
                receiver: address(0), // must be address(0) (== maker) in Aqua mode
                tokenA: tokenA_,
                tokenB: tokenB_,
                shouldUnwrapWeth: false, // must be false in Aqua mode
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: program
            })
        );
    }

    /// @notice Read tokenA / tokenB back out of order.data (first 40 bytes).
    function orderTokens(ISwapVM.Order memory order) public pure returns (address tokenA_, address tokenB_) {
        bytes memory data = order.data;
        require(data.length >= 40, "order.data too short");
        assembly ("memory-safe") {
            tokenA_ := shr(96, mload(add(data, 32)))
            tokenB_ := shr(96, mload(add(data, 52)))
        }
    }

    /// @notice True when `tokenIn` is the order's tokenA (so the taker direction flag must be isAToB = true).
    function isAToB(ISwapVM.Order memory order, address tokenIn) public pure returns (bool) {
        (address a, address b) = orderTokens(order);
        require(tokenIn == a || tokenIn == b, "tokenIn not in order");
        return tokenIn == a;
    }

    // ------------------------------------------------------------------ shipping

    /// @notice Approve Aqua for every token and ship `abi.encode(order)` as the strategy under our router.
    /// @return strategyHash keccak256(abi.encode(order)); asserted to equal router.hash(order).
    function shipOrder(address maker_, ISwapVM.Order memory order, address[] memory tokens, uint256[] memory amounts)
        public
        returns (bytes32 strategyHash)
    {
        require(tokens.length == amounts.length, "tokens/amounts length mismatch");
        bytes32 orderHash = router.hash(order);

        vm.startPrank(maker_);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(address(aqua), type(uint256).max);
        }
        strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        vm.stopPrank();

        assertEq(strategyHash, orderHash, "aqua strategyHash != router.hash(order)");
        assertEq(strategyHash, keccak256(abi.encode(order)), "aqua strategyHash != keccak256(abi.encode(order))");
    }

    /// @notice Two-token convenience overload: amounts are given in (tokenA, tokenB) order of the order itself.
    function shipOrder(address maker_, ISwapVM.Order memory order, uint256 amountA, uint256 amountB)
        public
        returns (bytes32)
    {
        (address a, address b) = orderTokens(order);
        address[] memory tokens = new address[](2);
        tokens[0] = a;
        tokens[1] = b;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amountA;
        amounts[1] = amountB;
        return shipOrder(maker_, order, tokens, amounts);
    }

    /// @notice Maker docks (deactivates) the strategy for all of its tokens.
    function dockOrder(address maker_, bytes32 strategyHash, address[] memory tokens) public {
        vm.prank(maker_);
        aqua.dock(address(router), strategyHash, tokens);
    }

    function dockOrder(address maker_, ISwapVM.Order memory order) public {
        (address a, address b) = orderTokens(order);
        address[] memory tokens = new address[](2);
        tokens[0] = a;
        tokens[1] = b;
        dockOrder(maker_, router.hash(order), tokens);
    }

    // ------------------------------------------------------------------ taker data

    /// @notice Default taker args for an EOA taker in Aqua mode.
    function defaultTakerArgs(address taker_) public pure returns (TakerTraitsLib.Args memory) {
        return TakerTraitsLib.Args({
            taker: taker_,
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: true, // router does transferFrom(taker) + Aqua.push; no taker callback needed
            isAToB: true,
            allowPartialFill: false,
            threshold: "",
            to: address(0), // address(0) => tokens go to taker
            deadline: 0,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: "" // empty in Aqua mode
        });
    }

    /// @notice Build packed taker traits + data.
    /// @param threshold 0 = no threshold; otherwise min amountOut (exactIn) or max amountIn (exactOut).
    /// @param to address(0) = deliver tokenOut to the taker.
    /// @param useTransferFromAndAquaPush true for EOA takers (router pulls tokenIn via transferFrom and pushes into Aqua);
    ///        false requires the taker to be a contract implementing ITakerCallbacks.preTransferInCallback
    ///        (and the hasPreTransferInCallback flag; see `takerDataWithCallback`).
    function takerData(bool isExactIn, bool isAToB_, uint256 threshold, address to, bool useTransferFromAndAquaPush)
        public
        pure
        returns (bytes memory)
    {
        TakerTraitsLib.Args memory args = defaultTakerArgs(address(0));
        args.isExactIn = isExactIn;
        args.isAToB = isAToB_;
        args.threshold = threshold == 0 ? bytes("") : abi.encodePacked(threshold);
        args.to = to;
        args.useTransferFromAndAquaPush = useTransferFromAndAquaPush;
        return TakerTraitsLib.build(args);
    }

    /// @notice Shortest form: EOA taker, no threshold, tokens to taker.
    function takerData(bool isExactIn, bool isAToB_) public pure returns (bytes memory) {
        return takerData(isExactIn, isAToB_, 0, address(0), true);
    }

    /// @notice Taker data for a contract taker that pushes tokenIn into Aqua itself from preTransferInCallback.
    function takerDataWithCallback(address takerContract, bool isExactIn, bool isAToB_)
        public
        pure
        returns (bytes memory)
    {
        TakerTraitsLib.Args memory args = defaultTakerArgs(takerContract);
        args.isExactIn = isExactIn;
        args.isAToB = isAToB_;
        args.useTransferFromAndAquaPush = false;
        args.hasPreTransferInCallback = true;
        return TakerTraitsLib.build(args);
    }

    /// @notice Direction-aware convenience: picks isAToB from the order and tokenIn.
    function takerDataFor(ISwapVM.Order memory order, address tokenIn, bool isExactIn)
        public
        pure
        returns (bytes memory)
    {
        return takerData(isExactIn, isAToB(order, tokenIn));
    }

    // ------------------------------------------------------------------ quote / swap

    /// @dev Single external call so that `vm.expectRevert` placed right before works as expected.
    function quote(ISwapVM.Order memory order, uint256 amount, bytes memory takerTraitsAndData)
        public
        view
        returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)
    {
        return ISwapVM(address(router)).quote(order, amount, takerTraitsAndData);
    }

    /// @dev Single external call (after the prank) so that `vm.expectRevert` placed right before works.
    function swapAs(address who, ISwapVM.Order memory order, uint256 amount, bytes memory takerTraitsAndData)
        public
        returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)
    {
        vm.prank(who);
        return router.swap(order, amount, takerTraitsAndData);
    }

    // ------------------------------------------------------------------ funding / approvals

    /// @notice Add `amount` of `token` to `to` (works for mocks and for real mainnet tokens on a fork).
    function fund(address token, address to, uint256 amount) public {
        deal(token, to, IERC20(token).balanceOf(to) + amount);
    }

    function approveRouter(address who, address token, uint256 amount) public {
        vm.prank(who);
        IERC20(token).approve(address(router), amount);
    }

    function approveAqua(address who, address token, uint256 amount) public {
        vm.prank(who);
        IERC20(token).approve(address(aqua), amount);
    }

    // ------------------------------------------------------------------ balances

    function aquaRaw(address maker_, bytes32 strategyHash, address token)
        public
        view
        returns (uint248 balance, uint8 tokensCount)
    {
        return aqua.rawBalances(maker_, address(router), strategyHash, token);
    }

    function aquaSafe(address maker_, bytes32 strategyHash, address token0, address token1)
        public
        view
        returns (uint256, uint256)
    {
        return aqua.safeBalances(maker_, address(router), strategyHash, token0, token1);
    }

    /// @notice Snapshot wallet + Aqua balances for the order's tokenA/tokenB.
    function snapshot(ISwapVM.Order memory order, address taker_) public view returns (Snapshot memory s) {
        (address a, address b) = orderTokens(order);
        bytes32 h = router.hash(order);
        s.makerA = IERC20(a).balanceOf(order.maker);
        s.makerB = IERC20(b).balanceOf(order.maker);
        s.takerA = IERC20(a).balanceOf(taker_);
        s.takerB = IERC20(b).balanceOf(taker_);
        s.routerA = IERC20(a).balanceOf(address(router));
        s.routerB = IERC20(b).balanceOf(address(router));
        (s.aquaA, s.tokensCountA) = aqua.rawBalances(order.maker, address(router), h, a);
        (s.aquaB, s.tokensCountB) = aqua.rawBalances(order.maker, address(router), h, b);
    }

    /// @notice Assert the full accounting delta of one swap: maker wallet, taker wallet, Aqua virtual balances,
    ///         and that the router never retains tokens.
    function assertSwapDelta(
        Snapshot memory before,
        Snapshot memory afterS,
        bool aToB,
        uint256 amountIn,
        uint256 amountOut
    ) public pure {
        if (aToB) {
            assertEq(afterS.makerA, before.makerA + amountIn, "maker tokenA wallet += amountIn");
            assertEq(afterS.makerB, before.makerB - amountOut, "maker tokenB wallet -= amountOut");
            assertEq(afterS.takerA, before.takerA - amountIn, "taker tokenA wallet -= amountIn");
            assertEq(afterS.takerB, before.takerB + amountOut, "taker tokenB wallet += amountOut");
            assertEq(afterS.aquaA, before.aquaA + amountIn, "aqua tokenA += amountIn");
            assertEq(afterS.aquaB, before.aquaB - amountOut, "aqua tokenB -= amountOut");
        } else {
            assertEq(afterS.makerB, before.makerB + amountIn, "maker tokenB wallet += amountIn");
            assertEq(afterS.makerA, before.makerA - amountOut, "maker tokenA wallet -= amountOut");
            assertEq(afterS.takerB, before.takerB - amountIn, "taker tokenB wallet -= amountIn");
            assertEq(afterS.takerA, before.takerA + amountOut, "taker tokenA wallet += amountOut");
            assertEq(afterS.aquaB, before.aquaB + amountIn, "aqua tokenB += amountIn");
            assertEq(afterS.aquaA, before.aquaA - amountOut, "aqua tokenA -= amountOut");
        }
        assertEq(afterS.routerA, before.routerA, "router tokenA balance unchanged");
        assertEq(afterS.routerB, before.routerB, "router tokenB balance unchanged");
        assertEq(afterS.tokensCountA, before.tokensCountA, "tokensCount A unchanged");
        assertEq(afterS.tokensCountB, before.tokensCountB, "tokensCount B unchanged");
    }

    // ------------------------------------------------------------------ events

    /// @notice Arm `vm.expectEmit` for the router's Swapped event.
    function expectSwapped(
        bytes32 orderHash,
        address maker_,
        address taker_,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    ) public {
        vm.expectEmit(address(router));
        emit SwapVM.Swapped(orderHash, maker_, taker_, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ------------------------------------------------------------------ instruction builders

    /// @notice Encode the custom ProbeScale instruction: [opcode 0xd0][argsLen 4][uint32 factor], 1e9 == 1x.
    /// @dev KNOWN ISSUE: `ProbeScale.build()` in src/instructions/ProbeScale.sol resolves the *start* pointer
    ///      (`start.resolve()`) and always reverts with MemoryPtrStrictResolveFailed; the library requires
    ///      resolving the *end* pointer (`ptr.resolve()`, as XYCSwap/FeeFlatIn do). This helper is the correct
    ///      encoding and is byte-for-byte what the fixed `ProbeScale.build` would return.
    function buildProbeScale(uint32 factor) public pure returns (bytes memory) {
        MemoryPtr start = MemoryPtrLib.alloc(InstructionBuilder.sizeOf() + 4);
        MemoryPtr ptr = start.pushHeader(ProbeScale.opcode).push(uint256(factor), 4);
        start.patchLength(ptr);
        return ptr.resolve();
    }

    /// @notice Encode an argument-less instruction for an arbitrary opcode (e.g. to hit the unknown-opcode path).
    function rawInstruction(Opcode op) public pure returns (bytes memory) {
        MemoryPtr start = MemoryPtrLib.alloc(InstructionBuilder.sizeOf());
        MemoryPtr ptr = start.pushHeader(op);
        start.patchLength(ptr);
        return ptr.resolve();
    }

    // ------------------------------------------------------------------ math helpers (XYC reference)

    /// @dev Mirrors XYCSwap.exec for exactIn: floor(amountIn * balanceOut / (balanceIn + amountIn)).
    function xycOut(uint256 balanceIn, uint256 balanceOut, uint256 amountIn) public pure returns (uint256) {
        return amountIn * balanceOut / (balanceIn + amountIn);
    }

    /// @dev Mirrors XYCSwap.exec for exactOut: ceil(amountOut * balanceIn / (balanceOut - amountOut)).
    function xycIn(uint256 balanceIn, uint256 balanceOut, uint256 amountOut) public pure returns (uint256) {
        uint256 num = amountOut * balanceIn;
        uint256 den = balanceOut - amountOut;
        return (num + den - 1) / den;
    }
}
