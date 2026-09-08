// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";

import { RmmSwap } from "./instructions/RmmSwap.sol";
import { Coverage } from "./instructions/Coverage.sol";
import { Gaussian } from "./math/Gaussian.sol";
import { WadMath } from "./math/WadMath.sol";

/// @title SurfaceLens
/// @notice Prices a whole book of Strikeline legs in one call, from nothing but the bytes Aqua already
///         published.
///
/// @dev Aqua takes the strategy "fully instead of being pre-hashed, for data availability", and the
///      `Shipped` event carries those bytes verbatim. A Strikeline leg encodes its strike, its implied
///      vol, its maturity and its liquidity **in the clear** inside them. So every option any maker has
///      ever written on this router is publicly decodable, and this contract is the decoder: hand it the
///      raw `Shipped` payloads and it returns, per leg, the terms, the live Aqua reserves, the curve's
///      own no-arbitrage mark, the delta, the option premium and the accrued theta band.
///
///      Three properties make that possible without an oracle and without a model:
///
///      1. **The mark is the curve.** Reserves sit exactly on the curve (fixed `L`, zero invariant
///         offset), so `X = L*(1 - Phi(d1))` inverts to `d1 = Phi^-1(1 - X/L)` and the marginal price is
///         `S = K*exp(s*d1 - s^2/2)`. No price feed is consulted anywhere in this file.
///      2. **The delta is the reserve.** `dV/dS = L*(1 - Phi(d1)) = X`, so a leg's delta in risky units
///         is literally its risky reserve. It is read, not computed.
///      3. **The premium is measured.** `V = S*X + Y = L*(S - C_BS)` gives `C_BS = S - V/L` from the
///         reserves that are actually there, not from a Black-Scholes evaluation of assumed inputs. It
///         is returned signed: an approximated `Phi` can put a deep-in-the-money leg a few wei below
///         intrinsic, and a lens that clamps that to zero is hiding its own error bar.
///
///      SEPARATE CONTRACT ON PURPOSE. `StrikelineRouter` has 943 B of EIP-170 headroom; none of it is
///      spent here. The lens holds no funds, has no owner and cannot be called by the VM.
///
///      EVERY BATCH ENTRY IS FAULT-ISOLATED. The input is a public event log, so anyone can ship bytes
///      that are not a Strikeline leg, or a leg whose parameters send the Gaussian out of domain. Each
///      leg is priced through an external self-call inside `try/catch`, so one bad strategy degrades to
///      `isLeg == false` instead of reverting the whole book.
contract SurfaceLens {
    using OpcodeOps for Opcode;

    /// @notice The program contains no `RmmSwap` instruction: it is on this router, but it is not a leg.
    error NotAStrikelineLeg();
    /// @notice The instruction stream does not decode as `[opcode][argsLength][args]`.
    error ProgramMalformed(uint256 pc);
    /// @notice `rateRisky` or `rateStable` is zero, so the leg cannot be normalised.
    error ZeroRate();

    uint256 private constant WAD = 1e18;
    uint256 private constant DOCKED = 0xff;

    /// @notice One decoded, priced leg.
    /// @dev Amounts named `Wad` are in the curve's normalised 18-decimal space (what `strikeWad` is
    ///      quoted in); everything else is in raw token units, ready to display against `decimals()`.
    struct Leg {
        // ---- identity
        /// @dev `keccak256(strategy)`, which is both the Aqua strategy hash and `SwapVM.hash(order)`.
        bytes32 orderHash;
        address maker;
        /// @dev Echoed so a multicall result is self-describing.
        address app;
        address tokenRisky;
        address tokenStable;
        // ---- terms, decoded from the shipped bytes
        /// @dev False when the program has no `RmmSwap`; every field below it is then zero.
        bool isLeg;
        /// @dev True when the program also carries the `Coverage` wrapper, i.e. the depth is margined.
        bool guarded;
        bool riskyIsTokenA;
        uint128 strikeWad;
        uint64 sigmaWad;
        uint40 maturity;
        uint128 liquidityWad;
        uint64 rateRisky;
        uint64 rateStable;
        // ---- live state, read from Aqua at this block
        /// @dev Aqua's marker: 0 never shipped, 1..254 active, 255 docked.
        uint8 tokensCount;
        bool live;
        bool docked;
        bool matured;
        uint256 reserveRisky;
        uint256 reserveStable;
        /// @dev What the maker's wallet can actually deliver right now: `min(balanceOf, allowance)`.
        ///      Shared with every other leg this maker has shipped, which is the whole point of the book.
        uint256 freeRisky;
        uint256 freeStable;
        /// @dev `min(reserve, free)`: the largest fill this leg can honour, the number `Coverage` binds.
        uint256 deliverableRisky;
        uint256 deliverableStable;
        // ---- priced by the curve itself, with no oracle
        bool priced;
        uint256 tauWad;
        /// @dev Marginal price in stable per risky, normalised WAD. Equals `K` exactly once matured.
        uint256 markWad;
        /// @dev `X/L`: the leg's delta, in risky per unit of liquidity.
        uint256 deltaWad;
        /// @dev `C_BS(S, K, sigma, tau)` per unit of liquidity, measured as `S - V/L`.
        int256 premiumWad;
        /// @dev `V = S*X + Y`, the leg's mark-to-market in normalised stable units.
        uint256 valueWad;
        /// @dev The accrued decay band: the smallest trade that clears in each direction, raw units,
        ///      rounded up. Zero on both sides means the curve has not moved since the reserves landed.
        uint256 minRiskyIn;
        uint256 minStableIn;
    }

    /// @notice The Aqua registry the book settles through.
    IAqua public immutable AQUA;
    /// @notice The app (our router) whose strategies this lens prices.
    address public immutable APP;

    constructor(address aqua, address app) {
        AQUA = IAqua(aqua);
        APP = app;
    }

    // ------------------------------------------------------------------ batch entry points

    /// @notice Price a book from the raw `Shipped` payloads, exactly as the event carried them.
    /// @dev This is the primary entry point: `keccak256(strategy)` is the Aqua strategy hash by
    ///      definition, so nothing about the identity of a leg is taken on trust from the caller.
    ///      A strategy that fails to decode or to price comes back with `isLeg == false` rather than
    ///      taking the batch down with it.
    function book(bytes[] calldata strategies) external view returns (Leg[] memory legs) {
        legs = new Leg[](strategies.length);
        for (uint256 i = 0; i < strategies.length; i++) {
            try this.legOfStrategy(strategies[i]) returns (Leg memory leg) {
                legs[i] = leg;
            } catch {
                legs[i].app = APP;
                legs[i].orderHash = keccak256(strategies[i]);
            }
        }
    }

    /// @notice Same, for callers that already hold decoded orders.
    /// @dev The order is re-encoded with `abi.encode`, which is what the maker shipped, so the hash
    ///      matches. A maker who shipped a non-canonical encoding would hash differently, and
    ///      `book()` on the raw bytes is the entry point that survives that.
    function bookOfOrders(ISwapVM.Order[] calldata orders) external view returns (Leg[] memory legs) {
        legs = new Leg[](orders.length);
        for (uint256 i = 0; i < orders.length; i++) {
            try this.legOfOrder(orders[i]) returns (Leg memory leg) {
                legs[i] = leg;
            } catch {
                legs[i].app = APP;
                legs[i].orderHash = keccak256(abi.encode(orders[i]));
            }
        }
    }

    // ------------------------------------------------------------------ single leg

    /// @notice One leg from its shipped bytes. External so the batch can wrap it in `try/catch`; it
    ///         reverts on anything it cannot decode or price.
    function legOfStrategy(bytes calldata strategy) external view returns (Leg memory) {
        return _price(strategy);
    }

    /// @notice One leg from a decoded order.
    function legOfOrder(ISwapVM.Order calldata order) external view returns (Leg memory) {
        return _price(abi.encode(order));
    }

    // ------------------------------------------------------------------ decoding

    /// @notice The `RmmSwap` arguments a program carries, and whether it is wrapped in `Coverage`.
    /// @dev Pure byte work: this is the part that makes every option on the router publicly readable.
    ///      A SwapVM program is `[opcode][argsLength][args]` repeated, so the scan is exact rather than
    ///      a pattern match.
    function decodeProgram(bytes memory program)
        public
        pure
        returns (RmmSwap.Args memory args, bool found, bool guarded)
    {
        uint256 pc = 0;
        uint256 length = program.length;
        uint8 rmm = RmmSwap.opcode.asU8();
        uint8 cov = Coverage.opcode.asU8();

        while (pc < length) {
            if (pc + 2 > length) {
                revert ProgramMalformed(pc);
            }
            uint8 opcode = uint8(program[pc]);
            uint256 argsLength = uint8(program[pc + 1]);
            uint256 argsAt = pc + 2;
            if (argsAt + argsLength > length) {
                revert ProgramMalformed(pc);
            }

            if (opcode == cov) {
                guarded = true;
            } else if (opcode == rmm && !found) {
                if (argsLength != 62) {
                    revert ProgramMalformed(pc);
                }
                args.flags = uint8(_word(program, argsAt, 1));
                args.sigmaWad = uint64(_word(program, argsAt + 1, 8));
                args.maturity = uint40(_word(program, argsAt + 9, 5));
                args.strikeWad = uint128(_word(program, argsAt + 14, 16));
                args.liquidityWad = uint128(_word(program, argsAt + 30, 16));
                args.rateRisky = uint64(_word(program, argsAt + 46, 8));
                args.rateStable = uint64(_word(program, argsAt + 54, 8));
                found = true;
            }

            pc = argsAt + argsLength;
        }
    }

    // ------------------------------------------------------------------ internals

    function _price(bytes memory strategy) private view returns (Leg memory leg) {
        leg.orderHash = keccak256(strategy);
        leg.app = APP;

        ISwapVM.Order memory order = abi.decode(strategy, (ISwapVM.Order));
        leg.maker = order.maker;

        bytes memory data = order.data;
        require(data.length >= 40, ProgramMalformed(0));
        address tokenA = address(uint160(_word(data, 0, 20)));
        address tokenB = address(uint160(_word(data, 20, 20)));

        // Where the program starts, mirroring `MakerTraitsLib._getOffset(traits, 3)`: the fourth slice
        // index is the end of the last hook slice, so a leg with hooks decodes the same as one without.
        uint256 programStart = (MakerTraits.unwrap(order.traits) >> 160 >> 48) & 0xffff;
        require(programStart >= 40 && programStart <= data.length, ProgramMalformed(programStart));

        (RmmSwap.Args memory args, bool found, bool guarded) = decodeProgram(_tail(data, programStart));
        if (!found) {
            revert NotAStrikelineLeg();
        }
        require(args.rateRisky > 0 && args.rateStable > 0, ZeroRate());

        leg.isLeg = true;
        leg.guarded = guarded;
        leg.riskyIsTokenA = args.flags & RmmSwap.FLAG_RISKY_IS_TOKEN_A != 0;
        leg.tokenRisky = leg.riskyIsTokenA ? tokenA : tokenB;
        leg.tokenStable = leg.riskyIsTokenA ? tokenB : tokenA;
        leg.strikeWad = args.strikeWad;
        leg.sigmaWad = args.sigmaWad;
        leg.maturity = args.maturity;
        leg.liquidityWad = args.liquidityWad;
        leg.rateRisky = args.rateRisky;
        leg.rateStable = args.rateStable;

        _readAqua(leg);
        _quote(leg);
    }

    /// @dev Live reserves and the wallet behind them. `rawBalances` never reverts, so a docked or
    ///      never-shipped strategy reports its state instead of failing.
    function _readAqua(Leg memory leg) private view {
        (uint248 risky, uint8 countRisky) = AQUA.rawBalances(leg.maker, APP, leg.orderHash, leg.tokenRisky);
        (uint248 stable, uint8 countStable) = AQUA.rawBalances(leg.maker, APP, leg.orderHash, leg.tokenStable);

        leg.reserveRisky = risky;
        leg.reserveStable = stable;
        leg.tokensCount = countRisky;
        leg.docked = countRisky == DOCKED || countStable == DOCKED;
        leg.live = !leg.docked && countRisky > 0 && countStable > 0;

        leg.freeRisky = Coverage.free(address(AQUA), leg.maker, leg.tokenRisky, 0);
        leg.freeStable = Coverage.free(address(AQUA), leg.maker, leg.tokenStable, 0);
        leg.deliverableRisky = Math.min(leg.reserveRisky, leg.freeRisky);
        leg.deliverableStable = Math.min(leg.reserveStable, leg.freeStable);
    }

    /// @dev The curve prices itself. `s = sigma*sqrt(tau)` is the only shape parameter, and the reserve
    ///      point is where it is read from.
    function _quote(Leg memory leg) private view {
        uint256 tau = RmmSwap.tauOf(leg.maturity, block.timestamp);
        leg.tauWad = tau;
        leg.matured = tau == 0;

        uint256 x = leg.reserveRisky * leg.rateRisky;
        uint256 y = leg.reserveStable * leg.rateStable;
        uint256 L = leg.liquidityWad;
        uint256 K = leg.strikeWad;
        if (L == 0 || x > L) {
            return; // Outside the curve's domain: report the reserves, price nothing.
        }

        uint256 s = tau == 0 ? 0 : uint256(leg.sigmaWad) * WadMath.sqrt(tau) / WAD;

        // Marginal price. `X = L*(1 - Phi(d1))` inverts exactly, and `d1` fixes `S` with no price feed:
        //     d1 = Phi^-1(1 - X/L),  S = K*exp(s*d1 - s^2/2)
        // At `s == 0` the curve is constant-sum and the price is the strike, in closed form.
        if (s == 0) {
            leg.markWad = K;
        } else {
            int256 d1 = Gaussian.icdf(WAD - x * WAD / L);
            int256 e = (int256(s) * d1) / int256(WAD) - int256(s * s / (2 * WAD));
            leg.markWad = e >= 0 ? K * WadMath.exp(uint256(e)) / WAD : K * WadMath.expNeg(uint256(-e)) / WAD;
        }

        // Delta is the reserve: `dV/dS = L*(1 - Phi(d1)) = X`, per unit of liquidity.
        leg.deltaWad = x * WAD / L;

        // Value and premium, from the reserves that are actually there.
        leg.valueWad = leg.markWad * x / WAD + y;
        leg.premiumWad = int256(leg.markWad) - int256(leg.valueWad * WAD / L);

        // The theta band: how far the curve has walked away from the stale reserve point since the last
        // fill, in each direction. This is the premium a taker pays to re-open the curve.
        uint256 yOnCurve = RmmSwap.stableOf(x, K, s, L);
        uint256 xOnCurve = RmmSwap.riskyOf(y, K, s, L);
        leg.minStableIn = yOnCurve > y ? Math.ceilDiv(yOnCurve - y, leg.rateStable) : 0;
        leg.minRiskyIn = xOnCurve > x ? Math.ceilDiv(xOnCurve - x, leg.rateRisky) : 0;

        leg.priced = true;
    }

    // ------------------------------------------------------------------ memory byte helpers

    /// @dev `length` big-endian bytes of `b` at `offset`, as a uint. Bounds are checked by the caller;
    ///      the trailing bytes of the loaded word are shifted away, so a read at the end of the array
    ///      cannot leak adjacent memory into the result.
    function _word(bytes memory b, uint256 offset, uint256 length) private pure returns (uint256 v) {
        assembly ("memory-safe") {
            v := shr(sub(256, mul(8, length)), mload(add(add(b, 32), offset)))
        }
    }

    /// @dev `b[start:]` for memory bytes, which Solidity only gives us on calldata.
    function _tail(bytes memory b, uint256 start) private pure returns (bytes memory out) {
        uint256 n = b.length - start;
        out = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = b[start + i];
        }
    }
}
