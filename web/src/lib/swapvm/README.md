# `@/lib/swapvm` — 1inch SwapVM encoder (viem only)

Builds SwapVM programs, Orders, strategy hashes and taker traits **byte-for-byte identical** to the Solidity libraries in
`@1inch/swap-vm` (`InstructionBuilder`, `MakerTraitsLib`, `TakerTraitsLib`, `SwapVM.hash`). Verified end-to-end by
`contracts/test/encoding/EncodingVectors.t.sol` -> `vectors.json` -> `__tests__/encoding.test.ts` (`npm test`).

```ts
import { ix, program, buildOrder, orderHashAqua, encodeStrategyForShip, buildTakerTraits, swapVmAbi, aquaAbi, math } from '@/lib/swapvm';

// 1. Program = concatenated instructions ([opcode][len][args]). An XYC pool for illustration; a Strikeline leg is built by buildLegProgram.
const prog = program(ix.feeFlatIn(30_000), ix.xycSwap(), ix.stop()); // 0.3% fee (1e7 = 100%), constant product
// 2. Aqua-mode order (tokenA < tokenB numerically; hooks/receiver optional, see BuildOrderArgs).
const order = buildOrder({ maker, tokenA, tokenB, program: prog, useAquaInsteadOfSignature: true });
const strategyHash = orderHashAqua(order); // == keccak256(abi.encode(order)) == router.hash(order)
// 3. Ship liquidity: approve Aqua for both tokens, then Aqua.ship(app = router, strategy, tokens, amounts).
await walletClient.writeContract({ address: AQUA, abi: aquaAbi, functionName: 'ship',
  args: [ROUTER, encodeStrategyForShip(order), [tokenA, tokenB], [amountA, amountB]] });
// 4. Quote / swap: taker approves tokenIn to the router and sets useTransferFromAndAquaPush.
const takerData = buildTakerTraits({ taker, isExactIn: true, isAToB: true, threshold: minOut,
  deadline: Math.floor(Date.now() / 1000) + 600, useTransferFromAndAquaPush: true });
const [amountIn, amountOut] = await publicClient.readContract({ address: ROUTER, abi: swapVmAbi,
  functionName: 'quote', args: [order, amount, takerData], account: taker });
await walletClient.writeContract({ address: ROUTER, abi: swapVmAbi, functionName: 'swap', args: [order, amount, takerData] });
// Balances: readContract({ abi: aquaAbi, functionName: 'safeBalances', args: [maker, ROUTER, strategyHash, tokenA, tokenB] })
// Signature mode: orderHashEip712(order, { name: 'Strikeline', version: '1', chainId, verifyingContract: ROUTER })  (the golden vectors use 'ProbeRouter')
// Custom opcodes: ix.probeScale(factor) / customInstruction(opcode, argsHex). Decoders: decodeOrder, decodeTakerTraits.
// Off-chain math (XYC + concentrated-liquidity sizing/quotes): math.xycAmountOut, math.concentrateQuote, ...
```

Numbers are `bigint | number`; every Solidity `require` in the builders is mirrored and throws `SwapVMEncodingError`.
Re-verify after upgrading `@1inch/swap-vm`: `cd contracts && forge test --match-path test/encoding/EncodingVectors.t.sol && cd ../web && npm test`.
