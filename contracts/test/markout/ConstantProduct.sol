// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WadMath } from "../../src/math/WadMath.sol";

/// @title ConstantProduct
/// @notice The control the DeFi reader asked to be measured against: an ordinary `x * y = k` position
///         with a fee, holding the same capital over the same price path.
///
/// @dev This is constant-product (x·y = k) arithmetic, evaluated here rather than through a deployed pool. Nothing about
///      the numbers depends on that choice: `getAmountOut` with a fee taken from the input is the whole of
///      a v2 pool's pricing, and the reserves are updated exactly as `swap()` updates them (the fee stays
///      in the pool, so `k` grows). This file answers what the same capital would have been worth
///      in a constant-product pool.
///
///      The arbitrageur is the closed-form optimal one, not a search. For a taker paying `dy` of stable
///      with fee `g = 1 - feeBps/1e4`:
///
///          dx = x * dy * g / (y + dy * g)                    (v2 getAmountOut)
///          profit(dy) = S * dx - dy
///          dprofit/ddy = 0   =>   (y + dy*g)^2 = S * x * y * g
///          =>   dy = (sqrt(S * x * y * g) - y) / g,   positive iff  S > y / (x * g)
///
///      and symmetrically in the other direction. So the pool is left at the point where its post-fee
///      marginal price equals the reference spot, which is the standard no-arbitrage assumption and the
///      most generous one available to the control: it books every basis point of arbitrage flow the
///      fee tier can attract, with no latency, no gas competition and no failed transactions.
library ConstantProduct {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 1e4;

    /// @notice Reserves of one position, both normalised to WAD. `stable` is USD, `risky` is ETH.
    struct Pool {
        uint256 risky;
        uint256 stable;
        /// @dev Fee taken from the input, in basis points. 5 = a v3 0.05% tier, 30 = a v2 pool.
        uint256 feeBps;
    }

    /// @notice What one arbitrage round trip against `spotWad` moves, if any.
    struct Trade {
        bool happened;
        /// @dev True when the taker bought risky from the pool (spot above the pool's ask).
        bool boughtRisky;
        uint256 amountInWad;
        uint256 amountOutWad;
        /// @dev The taker's profit at `spotWad`, WAD USD. Zero-cost arbitrage is never simulated: this is
        ///      compared against the same gas floor the Strikeline arbitrageur pays.
        uint256 takerProfitUsdWad;
    }

    /// @notice Open a position with `usdWad` of capital at `spotWad`, split the way a pool requires.
    /// @dev A constant-product position quotes `stable / risky` as its price, so the only way to open at
    ///      the market is to hold half the value in each. That is not a thumb on the scale for either
    ///      side: it starts every strategy in this study at the identical mark.
    ///      The remainder of both integer divisions goes to the stable side rather than being dropped, so
    ///      `value(open(v, s), s) == v` exactly. Dropped, it started the control one micro-dollar behind
    ///      every other strategy in the study, which is nothing in dollars and a handicap in principle.
    function open(uint256 usdWad, uint256 spotWad, uint256 feeBps) internal pure returns (Pool memory) {
        uint256 risky = (usdWad / 2) * WAD / spotWad;
        return Pool({ risky: risky, stable: usdWad - risky * spotWad / WAD, feeBps: feeBps });
    }

    /// @notice Mark the position at `spotWad`, in WAD USD.
    function value(Pool memory p, uint256 spotWad) internal pure returns (uint256) {
        return p.risky * spotWad / WAD + p.stable;
    }

    /// @notice Let the arbitrageur take the pool to `spotWad`, if the round trip clears `minProfitUsdWad`.
    /// @dev The floor is the same gas cost the Strikeline arbitrageur is charged in the same step, so
    ///      neither venue is quietly given free flow the other has to pay for.
    function arb(Pool memory p, uint256 spotWad, uint256 minProfitUsdWad) internal pure returns (Trade memory t) {
        uint256 g = WAD - p.feeBps * WAD / BPS; // 1 - fee, WAD

        // Spot above the pool's ask: the taker pays stable and takes risky out.
        if (spotWad * p.risky / WAD * g / WAD > p.stable) {
            uint256 root = WadMath.sqrt(spotWad * p.risky / WAD * p.stable / WAD * g / WAD);
            if (root <= p.stable) return t;
            uint256 dy = (root - p.stable) * WAD / g;
            uint256 dyEff = dy * g / WAD;
            uint256 dx = p.risky * dyEff / (p.stable + dyEff);
            if (dx == 0 || dx >= p.risky) return t;

            uint256 proceeds = dx * spotWad / WAD;
            if (proceeds <= dy || proceeds - dy <= minProfitUsdWad) return t;

            t.happened = true;
            t.boughtRisky = true;
            t.amountInWad = dy;
            t.amountOutWad = dx;
            t.takerProfitUsdWad = proceeds - dy;
            p.risky -= dx;
            p.stable += dy;
            return t;
        }

        // Spot below the pool's bid: the taker pays risky and takes stable out.
        if (p.stable * g / WAD > spotWad * p.risky / WAD) {
            uint256 root = WadMath.sqrt(p.risky * p.stable / WAD * g / WAD * WAD / spotWad);
            if (root <= p.risky) return t;
            uint256 dx = (root - p.risky) * WAD / g;
            uint256 dxEff = dx * g / WAD;
            uint256 dy = p.stable * dxEff / (p.risky + dxEff);
            if (dy == 0 || dy >= p.stable) return t;

            uint256 cost = dx * spotWad / WAD;
            if (dy <= cost || dy - cost <= minProfitUsdWad) return t;

            t.happened = true;
            t.amountInWad = dx;
            t.amountOutWad = dy;
            t.takerProfitUsdWad = dy - cost;
            p.risky += dx;
            p.stable -= dy;
        }
    }
}
