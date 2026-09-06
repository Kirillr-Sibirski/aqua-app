/**
 * bigint ports of the on-chain math the frontend needs to preview quotes and size positions.
 * Rounding mirrors OpenZeppelin `Math` (floor `mulDiv`, `ceilDiv`, floor `sqrt`) and the
 * SwapVM instruction implementations (`XYCSwap.exec`, `XYCConcentrateSwap.*`).
 */
import { SwapVMEncodingError } from './bytes';

export const ONE = BigInt(10) ** BigInt(18);
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

function checkUint256(v: bigint, name: string): bigint {
  if (v < BigInt(0) || v > MAX_UINT256) throw new SwapVMEncodingError(`${name} overflows uint256`);
  return v;
}

/** `Math.mulDiv(x, y, d)` (floor) or with `Rounding.Ceil`. */
export function mulDiv(x: bigint, y: bigint, denominator: bigint, ceil = false): bigint {
  if (denominator === BigInt(0)) throw new SwapVMEncodingError('mulDiv: division by zero');
  const p = x * y;
  let r = p / denominator;
  if (ceil && p % denominator !== BigInt(0)) r += BigInt(1);
  return checkUint256(r, 'mulDiv result');
}

/** `Math.ceilDiv(a, b)` */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === BigInt(0)) throw new SwapVMEncodingError('ceilDiv: division by zero');
  return a === BigInt(0) ? BigInt(0) : (a - BigInt(1)) / b + BigInt(1);
}

/** `Math.sqrt(a)` — floor square root. */
export function sqrt(a: bigint): bigint {
  if (a < BigInt(0)) throw new SwapVMEncodingError('sqrt of negative');
  if (a < BigInt(2)) return a;
  let x0 = a;
  let x1 = (a >> BigInt(1)) + BigInt(1);
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + a / x1) >> BigInt(1);
  }
  return x0;
}

// ---------------------------------------------------------------------------
// XYCSwap (constant product)
// ---------------------------------------------------------------------------

/** `XYCSwap.exec` exact-in: floor division favors the maker. */
export function xycAmountOut(amountIn: bigint, balanceIn: bigint, balanceOut: bigint): bigint {
  return (amountIn * balanceOut) / (balanceIn + amountIn);
}

/** `XYCSwap.exec` exact-out: ceil division favors the maker. */
export function xycAmountIn(amountOut: bigint, balanceIn: bigint, balanceOut: bigint): bigint {
  if (amountOut >= balanceOut) throw new SwapVMEncodingError('xycAmountIn: amountOut exceeds balanceOut');
  return ceilDiv(amountOut * balanceIn, balanceOut - amountOut);
}

// ---------------------------------------------------------------------------
// XYCConcentrateSwap
// ---------------------------------------------------------------------------

/** `XYCConcentrateSwap.computeLiquidity(balanceA, balanceB, sqrtPriceMin, sqrtPriceMax)` */
export function concentrateComputeLiquidity(balanceA: bigint, balanceB: bigint, sqrtPriceMin: bigint, sqrtPriceMax: bigint): bigint {
  const priceDelta = sqrtPriceMax - sqrtPriceMin;
  const beta = mulDiv(balanceA, sqrtPriceMin, ONE) + mulDiv(balanceB, ONE, sqrtPriceMax);
  const fourAC = mulDiv(BigInt(4) * priceDelta, balanceA * balanceB, sqrtPriceMax);
  const disc = beta * beta + fourAC;
  return mulDiv(beta + sqrt(disc), sqrtPriceMax, BigInt(2) * priceDelta);
}

/** `XYCConcentrateSwap.computeLiquidityAndPrice(...)` -> { liquidity, sqrtPriceSpot } */
export function concentrateComputeLiquidityAndPrice(
  balanceA: bigint,
  balanceB: bigint,
  sqrtPriceMin: bigint,
  sqrtPriceMax: bigint,
): { liquidity: bigint; sqrtPriceSpot: bigint } {
  const liquidity = concentrateComputeLiquidity(balanceA, balanceB, sqrtPriceMin, sqrtPriceMax);
  const virtualA = balanceA + mulDiv(liquidity, ONE, sqrtPriceMax);
  const virtualB = balanceB + mulDiv(liquidity, sqrtPriceMin, ONE);
  const sqrtPriceSpot = sqrt(mulDiv(virtualB, ONE * ONE, virtualA));
  return { liquidity, sqrtPriceSpot };
}

function assertBounds(sqrtPriceSpot: bigint, sqrtPriceMin: bigint, sqrtPriceMax: bigint): void {
  if (!(sqrtPriceMin < sqrtPriceMax)) throw new SwapVMEncodingError(`ConcentrateInvalidPriceBounds(${sqrtPriceMin}, ${sqrtPriceMax})`);
  if (!(sqrtPriceMin <= sqrtPriceSpot && sqrtPriceSpot <= sqrtPriceMax)) {
    throw new SwapVMEncodingError(`ConcentrateSpotOutOfRange(${sqrtPriceMin}, ${sqrtPriceSpot}, ${sqrtPriceMax})`);
  }
}

/** `XYCConcentrateSwap.computeBalances(liquidity, sqrtPriceSpot, sqrtPriceMin, sqrtPriceMax)` -> { balanceA, balanceB } */
export function concentrateComputeBalances(
  liquidity: bigint,
  sqrtPriceSpot: bigint,
  sqrtPriceMin: bigint,
  sqrtPriceMax: bigint,
): { balanceA: bigint; balanceB: bigint } {
  assertBounds(sqrtPriceSpot, sqrtPriceMin, sqrtPriceMax);
  const balanceA = mulDiv(liquidity, (sqrtPriceMax - sqrtPriceSpot) * ONE, sqrtPriceSpot * sqrtPriceMax);
  const balanceB = mulDiv(liquidity, sqrtPriceSpot - sqrtPriceMin, ONE);
  return { balanceA, balanceB };
}

/** `XYCConcentrateSwap.computeLiquidityFromAmounts(availableA, availableB, sqrtPriceSpot, sqrtPriceMin, sqrtPriceMax)` */
export function concentrateComputeLiquidityFromAmounts(
  availableA: bigint,
  availableB: bigint,
  sqrtPriceSpot: bigint,
  sqrtPriceMin: bigint,
  sqrtPriceMax: bigint,
): { liquidity: bigint; actualA: bigint; actualB: bigint } {
  assertBounds(sqrtPriceSpot, sqrtPriceMin, sqrtPriceMax);
  let liquidity: bigint;
  if (sqrtPriceSpot <= sqrtPriceMin) {
    liquidity = mulDiv(availableA, sqrtPriceSpot * sqrtPriceMax, (sqrtPriceMax - sqrtPriceSpot) * ONE);
  } else if (sqrtPriceSpot < sqrtPriceMax) {
    const liquidityFromA = mulDiv(availableA, sqrtPriceSpot * sqrtPriceMax, (sqrtPriceMax - sqrtPriceSpot) * ONE);
    const liquidityFromB = mulDiv(availableB, ONE, sqrtPriceSpot - sqrtPriceMin);
    liquidity = liquidityFromA < liquidityFromB ? liquidityFromA : liquidityFromB;
  } else {
    liquidity = mulDiv(availableB, ONE, sqrtPriceSpot - sqrtPriceMin);
  }
  const { balanceA: actualA, balanceB: actualB } = concentrateComputeBalances(liquidity, sqrtPriceSpot, sqrtPriceMin, sqrtPriceMax);
  liquidity = concentrateComputeLiquidity(actualA, actualB, sqrtPriceMin, sqrtPriceMax);
  return { liquidity, actualA, actualB };
}

export interface ConcentrateQuoteArgs {
  /** Aqua balance of tokenIn / tokenOut for this strategy. */
  balanceIn: bigint;
  balanceOut: bigint;
  /** `tokenIn < tokenOut` (A -> B). */
  isAToB: boolean;
  isExactIn: boolean;
  amount: bigint;
  sqrtPriceMin: bigint;
  sqrtPriceMax: bigint;
}

/** `XYCConcentrateSwap.exec` — off-chain preview (including partial-fill clamping to balanceOut). */
export function concentrateQuote(args: ConcentrateQuoteArgs): { amountIn: bigint; amountOut: bigint } {
  const { balanceIn, balanceOut, isAToB, sqrtPriceMin, sqrtPriceMax } = args;
  const liquidity = concentrateComputeLiquidity(
    isAToB ? balanceIn : balanceOut,
    isAToB ? balanceOut : balanceIn,
    sqrtPriceMin,
    sqrtPriceMax,
  );
  let virtualIn = balanceIn;
  let virtualOut = balanceOut;
  if (isAToB) {
    virtualIn += mulDiv(liquidity, ONE, sqrtPriceMax, true);
    virtualOut += mulDiv(liquidity, sqrtPriceMin, ONE);
  } else {
    virtualIn += mulDiv(liquidity, sqrtPriceMin, ONE, true);
    virtualOut += mulDiv(liquidity, ONE, sqrtPriceMax);
  }
  let amountIn: bigint;
  let amountOut: bigint;
  if (args.isExactIn) {
    amountIn = args.amount;
    amountOut = (amountIn * virtualOut) / (virtualIn + amountIn);
    if (amountOut > balanceOut) {
      amountOut = balanceOut;
      amountIn = ceilDiv(amountOut * virtualIn, virtualOut - amountOut);
    }
  } else {
    amountOut = args.amount > balanceOut ? balanceOut : args.amount;
    amountIn = ceilDiv(amountOut * virtualIn, virtualOut - amountOut);
  }
  return { amountIn, amountOut };
}
