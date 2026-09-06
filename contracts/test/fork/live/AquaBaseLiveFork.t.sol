// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console2 } from "forge-std/console2.sol";
import { stdError } from "forge-std/StdError.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { Salt } from "@1inch/swap-vm/src/instructions/Controls.sol";

import { AquaSwapVMTestBase } from "../../base/AquaSwapVMTestBase.sol";
import { ISwapVMV102 } from "../v102/ISwapVMV102.sol";
import { TakerTraitsV102 } from "../v102/TakerTraitsV102.sol";
import { LiveBaseStrategies } from "./LiveBaseStrategies.sol";

/// @title AquaBaseLiveForkTest
/// @notice Qualification proof on a Base mainnet fork, pinned at `PINNED_BLOCK`:
///         (A) a taker fills REAL, LIVE maker liquidity through the OFFICIAL, UNMODIFIED v1.0.2 SwapVM router
///             0x111111338c... against the OFFICIAL Aqua registry 0x1111113CCf... — ungated EOA maker, ungated
///             contract maker with hooks, and a KycNFT-gated 1inch-dApp maker (tx.origin = a real RES holder);
///         (B) OUR ProbeRouter (HEAD SwapVM + AquaOpcodes + custom opcode) is deployed against the SAME registry,
///             a strategy is shipped to it, filled, and the registry's per-app scoping is proven both ways;
///         (C) ONE live maker wallet backs strategies under TWO apps (official router + ours) in ONE registry.
/// @dev Run:  FORK_RPC_URL=https://gateway.tenderly.co/public/base forge test --match-path 'test/fork/live/*' -vv
///      (or BASE_FORK_RPC_URL=...; BASE_FORK_BLOCK=0 to fork the head instead of the pinned block).
///      Skips cleanly when no RPC is set or when the RPC is not Base (chain id 8453), so an Ethereum FORK_RPC_URL
///      used by test/fork/AquaMainnetFork.t.sol does not make these fail.
contract AquaBaseLiveForkTest is AquaSwapVMTestBase, LiveBaseStrategies {
    ISwapVMV102 internal constant OFFICIAL = ISwapVMV102(OFFICIAL_ROUTER);

    bool internal forkEnabled;
    bool internal atPinnedBlock;

    struct Bal {
        uint256 takerW;
        uint256 takerU;
        uint256 makerW;
        uint256 makerU;
        uint256 feeToW;
        uint256 ledgerW; // Aqua rawBalances(maker, app, hash, WETH)
        uint256 ledgerU;
        uint256 appW; // ERC20 balance held by the app (router) itself — must never change
        uint256 appU;
    }

    modifier onlyFork() {
        vm.skip(!forkEnabled);
        _;
    }

    // ------------------------------------------------------------------ setup

    function setUp() public override {
        string memory url = vm.envOr("BASE_FORK_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            url = vm.envOr("FORK_RPC_URL", string(""));
        }
        if (bytes(url).length == 0) {
            return;
        } // no RPC -> every test skips via `onlyFork`

        vm.createSelectFork(url);
        if (block.chainid != BASE_CHAIN_ID) {
            console2.log("AquaBaseLiveForkTest: RPC is chain %s, not Base (8453) -> skipping", block.chainid);
            return;
        }
        uint256 blk = vm.envOr("BASE_FORK_BLOCK", PINNED_BLOCK);
        if (blk != 0) {
            vm.createSelectFork(url, blk);
        }
        atPinnedBlock = block.number == PINNED_BLOCK;
        forkEnabled = true;

        super.setUp(); // official Aqua + real WETH/USDC + a fresh ProbeRouter (OUR app) — see overrides below

        vm.label(OFFICIAL_ROUTER, "OfficialRouter_v1.0.2");
        vm.label(KYC_NFT, "KycNFT_RES");
        vm.label(RES_HOLDER, "RES_holder");
        vm.label(LIVE1_MAKER, "live1_maker_EOA");
        vm.label(LIVE2_MAKER, "live2_maker_contract");
        vm.label(LIVE3_MAKER, "live3_maker_dApp");

        // Takers: `taker` (from the base) is a fresh EOA that holds NO RES; the RES holder is impersonated for gated fills.
        fund(weth, taker, 1e18);
        fund(weth, RES_HOLDER, 1e18);
        vm.prank(taker);
        IERC20(weth).approve(OFFICIAL_ROUTER, type(uint256).max);
        vm.prank(RES_HOLDER);
        IERC20(weth).approve(OFFICIAL_ROUTER, type(uint256).max);
        approveRouter(taker, weth, type(uint256).max); // our router (test B/C)
    }

    function _resolveAqua() internal override returns (IAqua) {
        require(AQUA_BASE.code.length > 0, "official Aqua has no code on this fork");
        aquaIsExternal = true;
        return IAqua(AQUA_BASE);
    }

    function _resolveWeth() internal pure override returns (address) {
        return WETH_BASE;
    }

    function _deployTokens() internal override {
        usdc = IERC20(USDC_BASE);
        dai = IERC20(DAI_BASE);
    }

    // ------------------------------------------------------------------ 0. the deployed router really is v1.0.2 and the strategies are live

    function test_Live_0_OfficialRouterIsV102_AndPinnedStrategiesAreActive() public onlyFork {
        assertGt(OFFICIAL_ROUTER.code.length, 0, "official router has code");
        assertEq(OFFICIAL.AQUA(), AQUA_BASE, "official router wired to official Aqua");
        assertEq(address(router.AQUA()), AQUA_BASE, "OUR router wired to the SAME official Aqua");
        (, string memory name, string memory version,,,,) = OFFICIAL.eip712Domain();
        assertEq(name, "1inch SwapVM v1.0");
        assertEq(version, "1.0.2");
        console2.log("official router EIP-712 domain: %s / %s  (block %s)", name, version, block.number);

        // Vendored v1.0.2 taker-traits encoder reproduces the SDK golden vector TakerTraits.default().encode().
        assertEq(
            TakerTraitsV102.build(TakerTraitsV102.defaultArgs(taker)),
            hex"00000000000000000000000000000000000000000041",
            "TakerTraitsV102 golden vector"
        );

        _checkLive(
            "live1 (ungated, EOA maker)",
            LIVE1_MAKER,
            LIVE1_HASH,
            LIVE1_STRATEGY,
            false,
            LIVE1_LEDGER_WETH,
            LIVE1_LEDGER_USDC
        );
        _checkLive(
            "live2 (ungated, contract maker + hooks)",
            LIVE2_MAKER,
            LIVE2_HASH,
            LIVE2_STRATEGY,
            false,
            LIVE2_LEDGER_WETH,
            LIVE2_LEDGER_USDC
        );
        _checkLive(
            "live3 (KycNFT-gated dApp maker)",
            LIVE3_MAKER,
            LIVE3_HASH,
            LIVE3_STRATEGY,
            true,
            LIVE3_LEDGER_WETH,
            LIVE3_LEDGER_USDC
        );

        assertEq(IERC20(KYC_NFT).balanceOf(RES_HOLDER), 1, "RES holder holds the gate NFT");
        assertEq(IERC20(KYC_NFT).balanceOf(taker), 0, "our taker holds no RES");
    }

    function _checkLive(
        string memory label,
        address maker_,
        bytes32 h,
        bytes memory strategy,
        bool gated,
        uint256 expW,
        uint256 expU
    )
        internal
        view
    {
        ISwapVMV102.Order memory o = abi.decode(strategy, (ISwapVMV102.Order));
        assertEq(o.maker, maker_, "order.maker");
        assertEq(keccak256(strategy), h, "keccak256(Shipped.strategy) == strategyHash");
        assertEq(OFFICIAL.hash(o), h, "officialRouter.hash(order) == strategyHash");
        assertEq(o.traits >> 254 & 1, 1, "useAquaInsteadOfSignature");
        assertEq(_contains(o.data, abi.encodePacked(KYC_NFT)), gated, "KycNFT gate presence");
        (uint256 bw, uint256 bu) = aqua.safeBalances(maker_, OFFICIAL_ROUTER, h, weth, address(usdc));
        assertGt(bw + bu, 0, "strategy active on the official router");
        if (atPinnedBlock) {
            assertEq(bw, expW, "ledger WETH @pinned block");
            assertEq(bu, expU, "ledger USDC @pinned block");
        }
        console2.log("%s: ledger WETH %s / USDC %s", label, bw, bu);
    }

    // ------------------------------------------------------------------ A1. ungated, EOA maker, permissionless taker, official router

    function test_Live_A1_Ungated_EOAMaker_FillViaOfficialRouter() public onlyFork {
        // Largest amount the maker can actually pay: min(Aqua ledger, wallet, allowance) of USDC.
        uint256 cap = _min3(
            _ledger(LIVE1_MAKER, OFFICIAL_ROUTER, LIVE1_HASH, address(usdc)),
            usdc.balanceOf(LIVE1_MAKER),
            usdc.allowance(LIVE1_MAKER, AQUA_BASE)
        );
        (uint256 amountIn, uint256 qOut) = _largestFillable(LIVE1_STRATEGY, taker, false, cap);
        console2.log("live1 fill: amountIn %s wei WETH -> quoted %s USDC-units (cap %s)", amountIn, qOut, cap);

        _fillOfficialAndAssert("live1", LIVE1_MAKER, LIVE1_HASH, LIVE1_STRATEGY, taker, false, amountIn, true);
    }

    // ------------------------------------------------------------------ A2. ungated, CONTRACT maker with maker hooks, 0.05 WETH

    function test_Live_A2_Ungated_ContractMakerWithHooks_0p05WETH_ViaOfficialRouter() public onlyFork {
        uint256 amountIn = 0.05e18;
        assertGt(LIVE2_MAKER.code.length, 0, "maker is a contract");
        assertEq(usdc.balanceOf(LIVE2_MAKER), 0, "maker wallet holds no USDC: hooks source it just-in-time");

        // Expected output from the decoded program: flatFee 0.3 % (ceil) on amountIn, then plain XYC on the live ledger.
        uint256 lw = _ledger(LIVE2_MAKER, OFFICIAL_ROUTER, LIVE2_HASH, weth);
        uint256 lu = _ledger(LIVE2_MAKER, OFFICIAL_ROUTER, LIVE2_HASH, address(usdc));
        uint256 net = amountIn - _ceilDiv(amountIn * LIVE2_FLAT_FEE_BPS, 1e9);
        uint256 expectedOut = net * lu / (lw + net);

        (, uint256 qOut,) = _quoteOfficial(LIVE2_STRATEGY, taker, false, amountIn, 0);
        assertEq(qOut, expectedOut, "quote == flatFee(0.3%) + xyc on the live ledger");
        console2.log("live2 fill: 0.05 WETH -> %s USDC-units (expected from decoded program: %s)", qOut, expectedOut);

        _fillOfficialAndAssert("live2", LIVE2_MAKER, LIVE2_HASH, LIVE2_STRATEGY, taker, false, amountIn, false);
    }

    // ------------------------------------------------------------------ A3. KycNFT-gated dApp maker, RES holder as tx.origin, 0.05 WETH

    function test_Live_A3_Gated_RESHolder_0p05WETH_ViaOfficialRouter() public onlyFork {
        uint256 amountIn = 0.05e18;
        bytes memory td = TakerTraitsV102.build(TakerTraitsV102.defaultArgs(taker));
        ISwapVMV102.Order memory o = abi.decode(LIVE3_STRATEGY, (ISwapVMV102.Order));

        // A wallet without the RES NFT is rejected by the program's first instruction — on quote AND on swap.
        bytes memory gateRevert =
            abi.encodeWithSelector(ISwapVMV102.TxOriginTokenBalanceIsZero.selector, taker, KYC_NFT);
        vm.prank(taker, taker);
        vm.expectRevert(gateRevert);
        OFFICIAL.quote(o, weth, address(usdc), amountIn, td);
        vm.prank(taker, taker);
        vm.expectRevert(gateRevert);
        OFFICIAL.swap(o, weth, address(usdc), amountIn, td);

        // Sanity on the concentrated range (1875..2091 USDC/ETH) before filling as the RES holder.
        (, uint256 qOut,) = _quoteOfficial(LIVE3_STRATEGY, RES_HOLDER, true, amountIn, 0);
        assertGt(qOut, 50e6, "0.05 ETH should be worth > 50 USDC");
        assertLt(qOut, 150e6, "0.05 ETH should be worth < 150 USDC");
        console2.log("live3 fill: 0.05 WETH -> %s USDC-units as RES holder", qOut);

        _fillOfficialAndAssert("live3", LIVE3_MAKER, LIVE3_HASH, LIVE3_STRATEGY, RES_HOLDER, true, amountIn, true);
    }

    // ------------------------------------------------------------------ B. OUR router, same registry: ship, fill, and prove per-app scoping

    function test_Live_B_OurRouter_ShipAndFill_SameRegistry_AppIsolation() public onlyFork {
        uint256 wethLiq = 1e18;
        uint256 usdcLiq = 2480e6;
        fund(weth, maker, wethLiq);
        fund(address(usdc), maker, usdcLiq);

        ISwapVM.Order memory order = buildAquaOrder(
            maker, weth, address(usdc), bytes.concat(XYCSwap.build(), Salt.build(abi.encodePacked(block.number)))
        );
        bool wethIsA = isAToB(order, weth);
        bytes32 ourHash =
            wethIsA ? shipOrder(maker, order, wethLiq, usdcLiq) : shipOrder(maker, order, usdcLiq, wethLiq);
        console2.log("shipped to OUR router %s hash:", address(router));
        console2.logBytes32(ourHash);

        // Fill 0.05 WETH -> USDC through OUR router (HEAD 3-arg ABI, HEAD taker traits).
        uint256 amountIn = 0.05e18;
        bytes memory td = takerDataFor(order, weth, true);
        (uint256 qIn, uint256 qOut, bytes32 qHash) = quote(order, amountIn, td);
        assertEq(qHash, ourHash);
        assertEq(qOut, xycOut(wethLiq, usdcLiq, amountIn), "plain XYC quote");

        Snapshot memory before = snapshot(order, taker);
        vm.expectEmit(address(aqua));
        emit IAqua.Pulled(maker, address(router), ourHash, address(usdc), qOut);
        vm.expectEmit(address(aqua));
        emit IAqua.Pushed(maker, address(router), ourHash, weth, qIn);
        expectSwapped(ourHash, maker, taker, weth, address(usdc), qIn, qOut);
        uint256 g0 = gasleft();
        (uint256 sIn, uint256 sOut,) = swapAs(taker, order, amountIn, td);
        console2.log("OUR router swap gas: %s; 0.05 WETH -> %s USDC-units", g0 - gasleft(), sOut);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
        assertSwapDelta(before, snapshot(order, taker), wethIsA, sIn, sOut);

        // ---- registry scoping, direction 1: the OFFICIAL router cannot see or pull OUR strategy.
        // Same Order ABI shape => the official router computes the very same Aqua-mode hash ...
        ISwapVMV102.Order memory v102 =
            ISwapVMV102.Order({ maker: order.maker, traits: MakerTraits.unwrap(order.traits), data: order.data });
        assertEq(OFFICIAL.hash(v102), ourHash, "both routers hash the order identically");
        // ... but Aqua scopes balances by (maker, app, hash): nothing exists under the official app.
        (uint248 b, uint8 c) = aqua.rawBalances(maker, OFFICIAL_ROUTER, ourHash, weth);
        assertEq(b, 0);
        assertEq(c, 0);
        (b, c) = aqua.rawBalances(maker, address(router), ourHash, weth);
        assertEq(b, wethLiq + sIn, "our ledger WETH grew by amountIn");
        assertEq(c, 2);
        bytes memory notActiveOfficial = abi.encodeWithSelector(
            IAqua.SafeBalancesForTokenNotInActiveStrategy.selector, maker, OFFICIAL_ROUTER, ourHash, weth
        );
        vm.expectRevert(notActiveOfficial);
        aqua.safeBalances(maker, OFFICIAL_ROUTER, ourHash, weth, address(usdc));
        bytes memory tdV102 = TakerTraitsV102.build(TakerTraitsV102.defaultArgs(taker));
        vm.expectRevert(notActiveOfficial);
        OFFICIAL.quote(v102, weth, address(usdc), 1e16, tdV102);
        vm.prank(taker);
        vm.expectRevert(notActiveOfficial);
        OFFICIAL.swap(v102, weth, address(usdc), 1e16, tdV102);
        // Even a direct pull by the official router's address underflows the (zero) ledger under its app.
        vm.prank(OFFICIAL_ROUTER);
        vm.expectRevert(stdError.arithmeticError);
        aqua.pull(maker, ourHash, address(usdc), 1, taker);

        // ---- direction 2: OUR router cannot see or pull the LIVE strategies shipped to the official router.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAqua.SafeBalancesForTokenNotInActiveStrategy.selector, LIVE3_MAKER, address(router), LIVE3_HASH, weth
            )
        );
        aqua.safeBalances(LIVE3_MAKER, address(router), LIVE3_HASH, weth, address(usdc));
        vm.prank(address(router));
        vm.expectRevert(stdError.arithmeticError);
        aqua.pull(LIVE3_MAKER, LIVE3_HASH, address(usdc), 1, taker);
        (b, c) = aqua.rawBalances(LIVE3_MAKER, OFFICIAL_ROUTER, LIVE3_HASH, address(usdc));
        assertGt(b, 0, "live strategy untouched under the official app");
        assertEq(c, 2);
    }

    // ------------------------------------------------------------------ C. one wallet, two apps, one registry

    function test_Live_C_OneWallet_TwoApps_OneRegistry() public onlyFork {
        // The live dApp maker already has an ACTIVE strategy on the official router and a max USDC allowance to Aqua.
        uint256 walletUsdc0 = usdc.balanceOf(LIVE3_MAKER);
        assertGt(walletUsdc0, 100e6, "live maker wallet holds real USDC");
        assertGt(usdc.allowance(LIVE3_MAKER, AQUA_BASE), walletUsdc0, "maker already approved Aqua on mainnet");
        (uint248 offU0, uint8 offC) = aqua.rawBalances(LIVE3_MAKER, OFFICIAL_ROUTER, LIVE3_HASH, address(usdc));
        assertEq(offC, 2);

        // The SAME wallet ships a second strategy to OUR router in the SAME registry. Ship moves no tokens; the
        // amounts are the curve's virtual reserves (~2,480 USDC/ETH) and the wallet's USDC backs WETH->USDC fills.
        ISwapVM.Order memory o = buildAquaOrder(
            LIVE3_MAKER,
            weth,
            address(usdc),
            bytes.concat(XYCSwap.build(), Salt.build(abi.encodePacked(block.number, uint8(0xC))))
        );
        (address tA, address tB) = orderTokens(o);
        address[] memory tokens = new address[](2);
        tokens[0] = tA;
        tokens[1] = tB;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = tA == weth ? 0.1e18 : 248e6;
        amounts[1] = tB == weth ? 0.1e18 : 248e6;
        vm.prank(LIVE3_MAKER); // no approve() needed: the on-chain allowance to Aqua is already max
        bytes32 h2 = aqua.ship(address(router), abi.encode(o), tokens, amounts);
        assertEq(h2, router.hash(o));

        // One maker, two apps, both active in the official registry.
        (uint248 ourU0, uint8 ourC) = aqua.rawBalances(LIVE3_MAKER, address(router), h2, address(usdc));
        assertEq(ourU0, 248e6);
        assertEq(ourC, 2);
        console2.log(
            "maker %s: official-app USDC ledger %s | our-app USDC ledger %s",
            LIVE3_MAKER,
            uint256(offU0),
            uint256(ourU0)
        );

        // Fill 1: our app. 0.01 WETH -> USDC paid from the maker's real wallet.
        bytes memory td = takerDataFor(o, weth, true);
        (, uint256 out1,) = quote(o, 0.01e18, td);
        vm.expectEmit(address(aqua));
        emit IAqua.Pulled(LIVE3_MAKER, address(router), h2, address(usdc), out1);
        expectSwapped(h2, LIVE3_MAKER, taker, weth, address(usdc), 0.01e18, out1);
        swapAs(taker, o, 0.01e18, td);
        assertEq(usdc.balanceOf(LIVE3_MAKER), walletUsdc0 - out1, "wallet paid our app's fill");
        (uint248 offU1,) = aqua.rawBalances(LIVE3_MAKER, OFFICIAL_ROUTER, LIVE3_HASH, address(usdc));
        assertEq(offU1, offU0, "official-app ledger untouched by our app's fill");

        // Fill 2: official app, same wallet, gated strategy, RES holder as tx.origin. 0.01 WETH -> USDC.
        (, uint256 out2,) = _quoteOfficial(LIVE3_STRATEGY, RES_HOLDER, true, 0.01e18, 0);
        vm.expectEmit(address(aqua));
        emit IAqua.Pulled(LIVE3_MAKER, OFFICIAL_ROUTER, LIVE3_HASH, address(usdc), out2);
        _swapOfficial(LIVE3_STRATEGY, RES_HOLDER, true, 0.01e18, out2);
        assertEq(usdc.balanceOf(LIVE3_MAKER), walletUsdc0 - out1 - out2, "same wallet paid the official app's fill");
        (uint248 offU2,) = aqua.rawBalances(LIVE3_MAKER, OFFICIAL_ROUTER, LIVE3_HASH, address(usdc));
        assertEq(offU2, offU0 - out2, "official-app ledger moved only by its own fill");
        (uint248 ourU2,) = aqua.rawBalances(LIVE3_MAKER, address(router), h2, address(usdc));
        assertEq(ourU2, ourU0 - out1, "our-app ledger moved only by its own fill");
        console2.log("one wallet served two apps: our app paid %s, official app paid %s USDC-units", out1, out2);
    }

    // ------------------------------------------------------------------ helpers: official (v1.0.2) router

    function _quoteOfficial(
        bytes memory strategy,
        address taker_,
        bool asOrigin,
        uint256 amountIn,
        uint256 minOut
    )
        internal
        returns (uint256 qIn, uint256 qOut, bytes32 h)
    {
        ISwapVMV102.Order memory o = abi.decode(strategy, (ISwapVMV102.Order));
        bytes memory td =
            TakerTraitsV102.build(TakerTraitsV102.withThreshold(TakerTraitsV102.defaultArgs(taker_), minOut));
        if (asOrigin) {
            vm.prank(taker_, taker_);
        } else {
            vm.prank(taker_);
        }
        return OFFICIAL.quote(o, weth, address(usdc), amountIn, td);
    }

    function _swapOfficial(
        bytes memory strategy,
        address taker_,
        bool asOrigin,
        uint256 amountIn,
        uint256 minOut
    )
        internal
        returns (uint256 sIn, uint256 sOut, bytes32 h, uint256 gasUsed)
    {
        ISwapVMV102.Order memory o = abi.decode(strategy, (ISwapVMV102.Order));
        bytes memory td =
            TakerTraitsV102.build(TakerTraitsV102.withThreshold(TakerTraitsV102.defaultArgs(taker_), minOut));
        if (asOrigin) {
            vm.prank(taker_, taker_);
        } else {
            vm.prank(taker_);
        }
        uint256 g0 = gasleft();
        (sIn, sOut, h) = OFFICIAL.swap(o, weth, address(usdc), amountIn, td);
        gasUsed = g0 - gasleft();
    }

    /// @dev quote -> expect Pulled/Pushed/Swapped -> swap(threshold = quote) -> assert every balance delta.
    ///      `eoaMaker` = maker wallet holds the inventory itself (assert wallet deltas); false for hook-driven makers.
    function _fillOfficialAndAssert(
        string memory label,
        address maker_,
        bytes32 h,
        bytes memory strategy,
        address taker_,
        bool asOrigin,
        uint256 amountIn,
        bool eoaMaker
    )
        internal
    {
        (uint256 qIn, uint256 qOut, bytes32 qHash) = _quoteOfficial(strategy, taker_, asOrigin, amountIn, 0);
        assertEq(qHash, h, "quote returns the live strategy hash");
        assertEq(qIn, amountIn);
        assertGt(qOut, 0);

        Bal memory b0 = _bal(maker_, OFFICIAL_ROUTER, h, taker_);

        vm.expectEmit(address(aqua));
        emit IAqua.Pulled(maker_, OFFICIAL_ROUTER, h, address(usdc), qOut);
        vm.expectEmit(address(aqua));
        emit IAqua.Pushed(maker_, OFFICIAL_ROUTER, h, weth, qIn);
        vm.expectEmit(OFFICIAL_ROUTER);
        emit ISwapVMV102.Swapped(h, maker_, taker_, weth, address(usdc), qIn, qOut);

        // threshold = the quote: the fill must deliver at least what was quoted (it delivers exactly that).
        (uint256 sIn, uint256 sOut, bytes32 sHash, uint256 gasUsed) =
            _swapOfficial(strategy, taker_, asOrigin, amountIn, qOut);
        assertEq(sHash, h);
        assertEq(sIn, qIn, "swap amountIn == quote");
        assertEq(sOut, qOut, "swap amountOut == quote");

        Bal memory b1 = _bal(maker_, OFFICIAL_ROUTER, h, taker_);
        assertEq(b1.takerW, b0.takerW - sIn, "taker paid amountIn WETH");
        assertEq(b1.takerU, b0.takerU + sOut, "taker received amountOut USDC");
        assertEq(b1.ledgerU, b0.ledgerU - sOut, "Aqua ledger USDC -= amountOut");
        assertEq(b1.appW, b0.appW, "official router retains no WETH");
        assertEq(b1.appU, b0.appU, "official router retains no USDC");
        uint256 feePaid = b1.feeToW - b0.feeToW; // aquaProtocolFeeAmountInXD pulls from the ledger (or is skipped)
        if (eoaMaker) {
            assertEq(b1.makerU, b0.makerU - sOut, "maker wallet USDC -= amountOut");
            assertEq(b1.makerW + feePaid, b0.makerW + sIn, "maker wallet WETH += amountIn - protocol fee");
            assertEq(b1.ledgerW + feePaid, b0.ledgerW + sIn, "Aqua ledger WETH += amountIn - protocol fee");
        } else {
            assertEq(b1.ledgerW, b0.ledgerW + sIn, "Aqua ledger WETH += amountIn");
        }

        console2.log("%s: swap gas %s | amountIn %s wei WETH", label, gasUsed, sIn);
        console2.log("%s: amountOut %s USDC-units | protocol fee paid %s wei WETH", label, sOut, feePaid);
        console2.log("%s: maker wallet dWETH %s dUSDC(-) %s", label, b1.makerW - b0.makerW, b0.makerU - b1.makerU);
    }

    /// @dev Walks a ladder of amounts (largest first) and returns the first one whose quoted amountOut the maker can pay.
    function _largestFillable(
        bytes memory strategy,
        address taker_,
        bool asOrigin,
        uint256 cap
    )
        internal
        returns (uint256 amountIn, uint256 qOut)
    {
        uint256[6] memory ladder = [uint256(1e15), 5e14, 2e14, 1e14, 5e13, 1e13];
        for (uint256 i = 0; i < ladder.length; i++) {
            (, uint256 out,) = _quoteOfficial(strategy, taker_, asOrigin, ladder[i], 0);
            if (out > 0 && out <= cap) {
                return (ladder[i], out);
            }
        }
        revert("no amount in the ladder is fillable");
    }

    // ------------------------------------------------------------------ helpers: balances / bytes / math

    function _bal(address maker_, address app, bytes32 h, address taker_) internal view returns (Bal memory b) {
        b.takerW = IERC20(weth).balanceOf(taker_);
        b.takerU = usdc.balanceOf(taker_);
        b.makerW = IERC20(weth).balanceOf(maker_);
        b.makerU = usdc.balanceOf(maker_);
        b.feeToW = IERC20(weth).balanceOf(PROTOCOL_FEE_TO);
        b.ledgerW = _ledger(maker_, app, h, weth);
        b.ledgerU = _ledger(maker_, app, h, address(usdc));
        b.appW = IERC20(weth).balanceOf(app);
        b.appU = usdc.balanceOf(app);
    }

    function _ledger(address maker_, address app, bytes32 h, address token) internal view returns (uint256) {
        (uint248 bal,) = aqua.rawBalances(maker_, app, h, token);
        return bal;
    }

    function _contains(bytes memory hay, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || hay.length < needle.length) {
            return false;
        }
        for (uint256 i = 0; i + needle.length <= hay.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                return true;
            }
        }
        return false;
    }

    function _min3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        uint256 m = a < b ? a : b;
        return m < c ? m : c;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a + b - 1) / b;
    }
}
