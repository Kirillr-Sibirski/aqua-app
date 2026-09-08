/**
 * Aqua handlers: ship, dock, and the two balance events that walk a leg's reserves forward.
 *
 * Aqua's events carry no indexed parameters, so the app filter happens here. `context.router` in
 * `subgraph.yaml` holds the Strikeline router; leave it at the zero address to index every
 * Strikeline leg on any app, which is what a public surface across the whole registry would want.
 */
import { Address, BigInt, Bytes, DataSourceContext, dataSource, log } from "@graphprotocol/graph-ts";
import { Docked, Pulled, Pushed, Shipped } from "../generated/Aqua/Aqua";
import { Leg, Maker, SurfacePoint } from "../generated/schema";
import { decodeProgram, decodeStrategy } from "./decode";

const ZERO = BigInt.zero();

/**
 * The app whose strategies we index, from the data source context. Zero means "every app".
 * Configured in `subgraph.yaml`, or by `npm run configure` from the deployment manifest.
 */
function configuredRouter(): Address {
  let context: DataSourceContext = dataSource.context();
  let value = context.get("router");
  if (value == null) return Address.zero();
  let raw = value.toString();
  if (raw.length != 42) return Address.zero();
  return Address.fromString(raw);
}

function isOurApp(app: Address): boolean {
  let router = configuredRouter();
  return router.equals(Address.zero()) || app.equals(router);
}

function loadMaker(address: Address, timestamp: BigInt): Maker {
  let id = address.toHexString();
  let maker = Maker.load(id);
  if (maker == null) {
    maker = new Maker(id);
    maker.legsShipped = 0;
    maker.legsLive = 0;
    maker.fillCount = 0;
    maker.firstSeenAt = timestamp;
  }
  maker.lastSeenAt = timestamp;
  return maker as Maker;
}

/**
 * The identity of one cell of the surface.
 *
 * The pair is part of it. A strike is normalised stable per risky, so a cbBTC call struck at 2,800
 * USDC and a WETH call struck at 2,800 USDC carry the same `strikeWad`; keying on (strike, expiry)
 * alone would merge them into one "best bid" between two options a taker cannot choose between.
 * Same key as `pointKey` in web/src/components/surface/decode.ts, so the two read paths group alike.
 */
function pointId(tokenRisky: Bytes, tokenStable: Bytes, strikeWad: BigInt, maturity: BigInt): string {
  return (
    tokenRisky.toHexString() +
    "-" +
    tokenStable.toHexString() +
    "-" +
    strikeWad.toString() +
    "-" +
    maturity.toString()
  );
}

// -------------------------------------------------------------------------------------------- ship

export function handleShipped(event: Shipped): void {
  if (!isOurApp(event.params.app)) return;

  let order = decodeStrategy(event.params.strategy);
  if (order == null) return;

  let terms = decodeProgram(order.program);
  if (terms == null) {
    // A perfectly good Aqua strategy that simply is not an option. Nothing to put on the surface.
    return;
  }

  let id = event.params.strategyHash.toHexString();
  if (Leg.load(id) != null) {
    // Aqua marks a docked strategy hash dead forever, so a hash cannot be shipped twice. If one
    // ever is, the first record is the truthful one.
    log.warning("Shipped seen twice for strategy {}", [id]);
    return;
  }

  let maker = loadMaker(order.maker, event.block.timestamp);

  let riskyIsTokenA = terms.riskyIsTokenA;
  let tokenRisky = riskyIsTokenA ? order.tokenA : order.tokenB;
  let tokenStable = riskyIsTokenA ? order.tokenB : order.tokenA;

  let point = loadPoint(terms.strikeWad, terms.maturity, tokenRisky, tokenStable, event.block.timestamp);

  let leg = new Leg(id);
  leg.maker = maker.id;
  leg.app = event.params.app;
  leg.tokenA = order.tokenA;
  leg.tokenB = order.tokenB;
  leg.tokenRisky = tokenRisky;
  leg.tokenStable = tokenStable;
  leg.riskyIsTokenA = riskyIsTokenA;
  leg.strikeWad = terms.strikeWad;
  leg.sigmaWad = terms.sigmaWad;
  leg.maturity = terms.maturity;
  leg.liquidityWad = terms.liquidityWad;
  leg.rateRisky = terms.rateRisky;
  leg.rateStable = terms.rateStable;
  leg.flags = terms.flags;
  leg.guarded = terms.guarded;
  leg.strategy = event.params.strategy;
  leg.program = order.program;
  leg.reserveRisky = ZERO;
  leg.reserveStable = ZERO;
  leg.docked = false;
  leg.shippedAt = event.block.timestamp;
  leg.shippedAtBlock = event.block.number;
  leg.shippedTx = event.transaction.hash;
  leg.fillCount = 0;
  leg.volumeIn = ZERO;
  leg.volumeOut = ZERO;
  leg.point = point.id;
  leg.save();

  maker.legsShipped = maker.legsShipped + 1;
  maker.legsLive = maker.legsLive + 1;
  maker.save();

  let members = point.legIds;
  members.push(id);
  point.legIds = members;
  point.legCount = point.legCount + 1;
  point.save();
  refreshPoint(point.id, event.block.timestamp);
}

function loadPoint(
  strikeWad: BigInt,
  maturity: BigInt,
  tokenRisky: Bytes,
  tokenStable: Bytes,
  timestamp: BigInt
): SurfacePoint {
  let id = pointId(tokenRisky, tokenStable, strikeWad, maturity);
  let point = SurfacePoint.load(id);
  if (point == null) {
    point = new SurfacePoint(id);
    point.strikeWad = strikeWad;
    point.maturity = maturity;
    point.tokenRisky = tokenRisky;
    point.tokenStable = tokenStable;
    point.legIds = [];
    point.legCount = 0;
    point.liveLegCount = 0;
    point.maxSigmaWad = ZERO;
    point.minSigmaWad = ZERO;
    point.liveLiquidityWad = ZERO;
    point.updatedAt = timestamp;
  }
  return point as SurfacePoint;
}

/**
 * Recompute a cell of the surface from its members.
 *
 * This is the aggregation Aqua structurally lacks: the registry keys a strategy by its own hash and
 * knows nothing about two makers having written the same option, so the widest live vol at a
 * (strike, expiry) — the best bid — exists nowhere until the log is decoded.
 */
function refreshPoint(id: string, timestamp: BigInt): void {
  let point = SurfacePoint.load(id);
  if (point == null) return;

  let live = 0;
  let maxSigma = ZERO;
  let minSigma = ZERO;
  let liquidity = ZERO;
  let best: string | null = null;

  let members = point.legIds;
  for (let i = 0; i < members.length; i++) {
    let leg = Leg.load(members[i]);
    if (leg == null || leg.docked) continue;
    live += 1;
    liquidity = liquidity.plus(leg.liquidityWad);
    if (best == null || leg.sigmaWad.gt(maxSigma)) {
      maxSigma = leg.sigmaWad;
      best = leg.id;
    }
    if (minSigma.equals(ZERO) || leg.sigmaWad.lt(minSigma)) {
      minSigma = leg.sigmaWad;
    }
  }

  point.liveLegCount = live;
  point.maxSigmaWad = maxSigma;
  point.minSigmaWad = minSigma;
  point.liveLiquidityWad = liquidity;
  point.bestLeg = best;
  point.updatedAt = timestamp;
  point.save();
}

// -------------------------------------------------------------------------------------------- dock

export function handleDocked(event: Docked): void {
  if (!isOurApp(event.params.app)) return;

  let leg = Leg.load(event.params.strategyHash.toHexString());
  if (leg == null) return;
  if (leg.docked) return;

  // Aqua zeroes every balance and writes the docked marker; the quote goes dark in the same block.
  leg.docked = true;
  leg.dockedAt = event.block.timestamp;
  leg.dockedTx = event.transaction.hash;
  leg.reserveRisky = ZERO;
  leg.reserveStable = ZERO;
  leg.save();

  let maker = Maker.load(leg.maker);
  if (maker != null) {
    maker.legsLive = maker.legsLive - 1;
    maker.lastSeenAt = event.block.timestamp;
    maker.save();
  }

  refreshPoint(leg.point, event.block.timestamp);
}

// ---------------------------------------------------------------------------------------- balances

/**
 * `Pushed` fires once per token inside `ship` with the opening reserves, and again whenever a taker
 * pays into the strategy. Either way it is the same arithmetic, so the reserve here walks forward
 * exactly as Aqua's own storage does.
 */
export function handlePushed(event: Pushed): void {
  if (!isOurApp(event.params.app)) return;
  let leg = Leg.load(event.params.strategyHash.toHexString());
  if (leg == null) return;

  if (event.params.token.equals(leg.tokenRisky)) {
    leg.reserveRisky = leg.reserveRisky.plus(event.params.amount);
  } else if (event.params.token.equals(leg.tokenStable)) {
    leg.reserveStable = leg.reserveStable.plus(event.params.amount);
  } else {
    return;
  }
  leg.save();
}

export function handlePulled(event: Pulled): void {
  if (!isOurApp(event.params.app)) return;
  let leg = Leg.load(event.params.strategyHash.toHexString());
  if (leg == null) return;

  if (event.params.token.equals(leg.tokenRisky)) {
    leg.reserveRisky = leg.reserveRisky.minus(event.params.amount);
  } else if (event.params.token.equals(leg.tokenStable)) {
    leg.reserveStable = leg.reserveStable.minus(event.params.amount);
  } else {
    return;
  }
  leg.save();
}
