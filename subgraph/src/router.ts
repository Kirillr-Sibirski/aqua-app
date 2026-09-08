/**
 * Router handler: one `Swapped` per fill.
 *
 * `orderHash` is the Aqua strategy hash, so a fill joins straight onto the leg it hit with no
 * lookup table. Reserves are not touched here: Aqua's own `Pulled` and `Pushed` fire in the same
 * transaction and are the authority on them, so counting the fill twice is impossible.
 *
 * A `Swapped` whose orderHash has no `Leg` is a fill against some other strategy shipped to the same
 * router — an ordinary XYC pool, say. It is ignored rather than invented.
 */
import { Swapped } from "../generated/StrikelineRouter/StrikelineRouter";
import { Fill, Leg, Maker } from "../generated/schema";

export function handleSwapped(event: Swapped): void {
  let leg = Leg.load(event.params.orderHash.toHexString());
  if (leg == null) return;

  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let fill = new Fill(id);
  fill.leg = leg.id;
  fill.maker = leg.maker;
  fill.taker = event.params.taker;
  fill.tokenIn = event.params.tokenIn;
  fill.tokenOut = event.params.tokenOut;
  fill.amountIn = event.params.amountIn;
  fill.amountOut = event.params.amountOut;
  fill.timestamp = event.block.timestamp;
  fill.blockNumber = event.block.number;
  fill.transactionHash = event.transaction.hash;
  fill.logIndex = event.logIndex;
  fill.save();

  leg.fillCount = leg.fillCount + 1;
  leg.volumeIn = leg.volumeIn.plus(event.params.amountIn);
  leg.volumeOut = leg.volumeOut.plus(event.params.amountOut);
  leg.save();

  let maker = Maker.load(leg.maker);
  if (maker != null) {
    maker.fillCount = maker.fillCount + 1;
    maker.lastSeenAt = event.block.timestamp;
    maker.save();
  }
}
