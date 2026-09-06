// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title LiveBaseStrategies
/// @notice Hard-coded, on-chain-verified LIVE Aqua strategies on Base (chain id 8453) that were shipped by real
///         makers to the OFFICIAL v1.0.2 router. Foundry cannot query logs, so the `Shipped` payloads were
///         extracted offline (`eth_getLogs` on Aqua, topic0 = Shipped, 436 events over blocks 48839900-50926400,
///         stored in scratchpad/work/base_full3.raw.shipped.json) and are pinned here together with the block
///         at which their Aqua ledger balances were re-verified with `cast call --block`.
/// @dev    Strategy bytes are EXACTLY the `Shipped.strategy` payload = abi.encode(ISwapVMV102.Order);
///         keccak256(bytes) == strategyHash == router.hash(order) (asserted in the tests).
///         KycNFT gate = opcode 0x21 (`onlyTxOriginTokenBalanceNonZero`) with token 0x26FFc7D3...a468 ("RES").
abstract contract LiveBaseStrategies {
    // ------------------------------------------------------------------ fork pin

    uint256 internal constant BASE_CHAIN_ID = 8453;
    /// @dev Base block at which every constant below was verified (2026-09-06, ~1,000 blocks below head).
    uint256 internal constant PINNED_BLOCK = 50_946_000;

    // ------------------------------------------------------------------ official deployments (Base)

    address internal constant AQUA_BASE = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant OFFICIAL_ROUTER = 0x111111338c5091E8440b67B168bAe16a668AC0De; // AquaSwapVMRouter v1.0.2
    address internal constant WETH_BASE = 0x4200000000000000000000000000000000000006;
    address internal constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant DAI_BASE = 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb;
    /// @dev "Access Token for SwapVM v3.1.2" / symbol RES — the per-strategy KYC gate used by the 1inch dApp.
    address internal constant KYC_NFT = 0x26FFc7D378E8e49Be2c483295A3e3E511F96a468;
    /// @dev An EOA holding 1 RES at PINNED_BLOCK (found via KycNFT Transfer logs; scratchpad/work/kyc_holders_base.json).
    address internal constant RES_HOLDER = 0x3E4798B0e268bB73c04e29afe0bc7FdCF37B67c1;
    /// @dev Recipient of `aquaProtocolFeeAmountInXD` in every gated dApp strategy on Base (107/107 decoded).
    address internal constant PROTOCOL_FEE_TO = 0x8063D4FAF54BF8c898dC6ddC689C76aB12b4614a;

    // ------------------------------------------------------------------ live strategy #1: UNGATED, EOA maker

    // Shipped block 49514250, tx 0x49db1603f92337bd279ea7787dc16c69f0266486fc2c29bb52856d99e0dfcae0.
    // Program (World-A index opcodes): 12 40 <sqrtPriceMin><sqrtPriceMax> = concentrateGrowLiquidity2D (2000..2100 USDC/ETH)
    //                                   15 04 05f5e100 = flatFeeAmountInXD(1e8 / 1e9 = 10 %)
    //                                   11 00          = xycSwapXD
    // Maker traits 0x40.. = useAquaInsteadOfSignature only. No KycNFT gate, no hooks.
    // Ledger at PINNED_BLOCK: WETH 224075990008781 (0.000224), USDC 1461965 (1.46). Maker wallet: 3.9e12 WETH, 1.045981 USDC,
    // allowance to Aqua: max for both. Fills are wallet-limited (see the ladder in the test).
    address internal constant LIVE1_MAKER = 0xFD40Ce008f1459D797530a55Bb07da4a4954aD18;
    bytes32 internal constant LIVE1_HASH = 0xb5a7193e990bafa45847a153fcd252b84688808f52721d472dff567bb32c29fb;
    uint256 internal constant LIVE1_LEDGER_WETH = 224_075_990_008_781;
    uint256 internal constant LIVE1_LEDGER_USDC = 1_461_965;
    bytes internal constant LIVE1_STRATEGY = hex"0000000000000000000000000000000000000000000000000000000000000020"
        hex"000000000000000000000000fd40ce008f1459d797530a55bb07da4a4954ad18"
        hex"4000000000000000000000000000000000000000000000000000000000000000"
        hex"0000000000000000000000000000000000000000000000000000000000000060"
        hex"000000000000000000000000000000000000000000000000000000000000004a"
        hex"1240000000000000000000000000000000000000000000000000000028ac80bf"
        hex"f62b000000000000000000000000000000000000000000000000000029ada3f6"
        hex"ec36150405f5e100110000000000000000000000000000000000000000000000";

    // ------------------------------------------------------------------ live strategy #2: UNGATED, CONTRACT maker with hooks

    // Shipped block 50754929, tx 0x55b364da101560bae205ce27451b07a78c02701e9e1a98b2afcb714f8ceac47f.
    // Program: 15 04 002dc6c0 = flatFeeAmountInXD(3e6 / 1e9 = 0.3 %) | 11 00 = xycSwapXD | 14 08 <salt>.
    // Maker traits 0x4c.. = useAqua | hasPostTransferInHook | hasPreTransferOutHook (targets = maker itself,
    // a ~18 KB contract that sources USDC just-in-time from 0xb367a4306087d3981b38c032464cd7e3a7a03a4e in the
    // pre-transfer-out hook and approves Aqua for exactly amountOut). Wallet holds 0 WETH / 0 USDC.
    // Ledger at PINNED_BLOCK: WETH 17577848751888246 (0.01758), USDC 37320137 (37.32).
    address internal constant LIVE2_MAKER = 0x1a09f7d9B921C93F8fCD4bF04fe448982a3388Ec;
    bytes32 internal constant LIVE2_HASH = 0x99f8041e4238844bc25e24479b04f4e7da729d5bd6a65b01a1f3c9b5e74f3838;
    uint256 internal constant LIVE2_LEDGER_WETH = 17_577_848_751_888_246;
    uint256 internal constant LIVE2_LEDGER_USDC = 37_320_137;
    uint256 internal constant LIVE2_FLAT_FEE_BPS = 3_000_000; // of 1e9
    bytes internal constant LIVE2_STRATEGY = hex"0000000000000000000000000000000000000000000000000000000000000020"
        hex"0000000000000000000000001a09f7d9b921c93f8fcd4bf04fe448982a3388ec"
        hex"4c00000000000000000000000000000000000000000000000000000000000000"
        hex"0000000000000000000000000000000000000000000000000000000000000060"
        hex"0000000000000000000000000000000000000000000000000000000000000012"
        hex"1504002dc6c011001408ffea53d50193f62b0000000000000000000000000000";

    // ------------------------------------------------------------------ live strategy #3: KYC-GATED, EOA maker (1inch dApp)

    // Shipped block 49496295, tx 0x0de92e9ec87a1d9ca3824792945c30b6f153397491813e34219e714f06dc1a9c.
    // Program: 21 14 26ffc7..a468 = onlyTxOriginTokenBalanceNonZero(KycNFT)
    //          1c 18 0001e848 8063d4..614a = aquaProtocolFeeAmountInXD(125000 / 1e9 = 0.0125 %, to PROTOCOL_FEE_TO)
    //          12 40 <sqrtPriceMin><sqrtPriceMax> = concentrateGrowLiquidity2D (1875..2091 USDC/ETH)
    //          15 04 0007a120 = flatFeeAmountInXD(500000 / 1e9 = 0.05 %) | 11 00 = xycSwapXD | 14 08 <salt>
    // Ledger at PINNED_BLOCK: WETH 680657569152 (0.00000068), USDC 1983510251 (1,983.51). Maker wallet: 6.6e13 WETH,
    // 894.863426 USDC, allowance to Aqua: max for both -> the largest genuinely fillable WETH->USDC book on Base.
    address internal constant LIVE3_MAKER = 0x2467eBaF6860532384639836cA40706Cd8F2Cd17;
    bytes32 internal constant LIVE3_HASH = 0xb7c200701c31b095cc0833f881d52bedc44cfd838447fbc2f2d8e70f79b2c5c3;
    uint256 internal constant LIVE3_LEDGER_WETH = 680_657_569_152;
    uint256 internal constant LIVE3_LEDGER_USDC = 1_983_510_251;
    uint256 internal constant LIVE3_PROTOCOL_FEE_BPS = 125_000; // of 1e9
    bytes internal constant LIVE3_STRATEGY = hex"0000000000000000000000000000000000000000000000000000000000000020"
        hex"0000000000000000000000002467ebaf6860532384639836ca40706cd8f2cd17"
        hex"4000000000000000000000000000000000000000000000000000000000000000"
        hex"0000000000000000000000000000000000000000000000000000000000000060"
        hex"0000000000000000000000000000000000000000000000000000000000000084"
        hex"211426ffc7d378e8e49be2c483295a3e3e511f96a4681c180001e8488063d4fa"
        hex"f54bf8c898dc6ddc689c76ab12b4614a12400000000000000000000000000000"
        hex"0000000000000000000000002761dcd3f4a50000000000000000000000000000"
        hex"0000000000000000000000002995f6b637ee15040007a12011001408e11ab89b"
        hex"d79c38db00000000000000000000000000000000000000000000000000000000";
}
