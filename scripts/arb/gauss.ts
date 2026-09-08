/**
 * The standard normal CDF in double precision, and nothing else.
 *
 * WHERE THIS IS ALLOWED TO BE USED, AND WHERE IT IS NOT.
 *
 * An arbitrageur has to answer one question: at spot `S`, where on the curve should the reserves sit?
 * That is `X* = L*(1 - Phi(d1))`, and `d1` needs a normal CDF. But `X*` only *selects a point*; it is a
 * choice, like picking a limit price. Every value that has to agree with the chain to the wei --
 * `Y* = stableOf(X*)`, the band, the predicted `amountOut` -- is read back from the router's own views,
 * which evaluate the router's own approximated `Phi`. So a discrepancy here costs the bot a fraction of a
 * basis point of edge and can never make its prediction disagree with the fill.
 *
 * Algorithm: Hart's rational approximation as given by Graeme West, "Better Approximations to Cumulative
 * Normal Functions" (Wilmott, 2005). Double-precision accurate across the whole real line; `selfTest()`
 * checks it against published values and is run by `bot.ts --selftest`.
 */

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  const a = Math.abs(x);
  let upperTail: number;
  if (a > 37) {
    upperTail = 0;
  } else {
    const e = Math.exp((-a * a) / 2);
    if (a < 7.071067811865475) {
      let num = 3.52624965998911e-2 * a + 0.700383064443688;
      num = num * a + 6.37396220353165;
      num = num * a + 33.912866078383;
      num = num * a + 112.079291497871;
      num = num * a + 221.213596169931;
      num = num * a + 220.206867912376;
      let den = 8.83883476483184e-2 * a + 1.75566716318264;
      den = den * a + 16.064177579207;
      den = den * a + 86.7807322029461;
      den = den * a + 296.564248779674;
      den = den * a + 637.333633378831;
      den = den * a + 793.826512519948;
      den = den * a + 440.413735824752;
      upperTail = (e * num) / den;
    } else {
      // Continued fraction for the far tail, where the rational form loses relative accuracy.
      let b = a + 0.65;
      b = a + 4 / b;
      b = a + 3 / b;
      b = a + 2 / b;
      b = a + 1 / b;
      upperTail = e / (b * 2.506628274631);
    }
  }
  return x > 0 ? 1 - upperTail : upperTail;
}

/** Reference values (Wolfram/`scipy.stats.norm.cdf`, 17 significant digits) and the tolerance we hold to. */
const REFERENCE: Array<[x: number, phi: number]> = [
  [0, 0.5],
  [0.5, 0.6914624612740131],
  [1, 0.8413447460685429],
  [-1, 0.15865525393145707],
  [1.959963984540054, 0.975],
  [2, 0.9772498680518208],
  [-2, 0.022750131948179195],
  [-3, 0.0013498980316300933],
  [6, 0.9999999990134123],
  [-8, 6.220960574271786e-16],
];

export interface SelfTestResult {
  x: number;
  got: number;
  want: number;
  relativeError: number;
}

/** Every reference point, worst relative error first. */
export function selfTest(): SelfTestResult[] {
  return REFERENCE.map(([x, want]) => {
    const got = normalCdf(x);
    return { x, got, want, relativeError: Math.abs((got - want) / (want || 1)) };
  }).sort((a, b) => b.relativeError - a.relativeError);
}

/** Tightest tolerance the approximation holds at every reference point. */
export const SELF_TEST_TOLERANCE = 1e-8;
