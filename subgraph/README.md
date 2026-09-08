# Strikeline Surface — subgraph

An implied-volatility surface, reconstructed from 1inch Aqua's own event log.

## Why this can exist

`Aqua.ship` takes the strategy **"fully instead of being pre-hashed, for data availability"**, and
the `Shipped` event carries those bytes verbatim. A Strikeline leg's program encodes its strike, its
implied vol, its maturity and its liquidity **in the clear**:

```
Deadline(T+30m) · Coverage(flags, haircut) · RmmSwap(flags, sigma, T, K, L, rates) · Salt(n)
                                              └── 62 argument bytes, all of them public
```

So every option any maker has ever written on the router is decodable by anyone holding the log —
no cooperation from the maker, no off-chain order book, no price feed. `src/decode.ts` is that
decoder, and it is the same algorithm as `contracts/src/SurfaceLens.sol`, transcribed to
AssemblyScript with the same byte offsets.

Aqua has no order book: a strategy is opaque bytes keyed by its own hash, and nothing in the
registry relates two makers who happen to have written the same option. `SurfacePoint` is that
relation — the aggregation that turns a pile of strategies into a quote.

## Entities

| Entity | Key | What it is |
|---|---|---|
| `Maker` | address | A wallet that has written options here. Legs shipped, legs live, fills. |
| `Leg` | Aqua strategy hash | One option: pair, K, sigma, maturity, L, rates, flags, whether it is `Coverage`-margined, the raw bytes, live reserves, docked state. |
| `Fill` | `txHash-logIndex` | One swap against a leg, from the router's `Swapped`. |
| `SurfacePoint` | `strikeWad-maturity` | One cell of the surface: every maker's leg at that strike and expiry, the widest live vol (the best bid), and the notional written across all of them. |

Reserves are walked forward by Aqua's own `Pushed` / `Pulled`, so they track registry storage
exactly and a fill is never counted twice. `Docked` zeroes them, because Aqua does.

## Handlers

| Source | Event | Handler |
|---|---|---|
| Aqua (official, `0x1111113CCf…`) | `Shipped` | decode the strategy; create `Maker`, `Leg`, `SurfacePoint` |
| | `Docked` | mark dead, zero the reserves, recompute the cell |
| | `Pushed` / `Pulled` | reserve arithmetic |
| StrikelineRouter | `Swapped` | create `Fill`, join it to the leg by `orderHash` |

Aqua's events carry **no indexed parameters**, so the app filter happens in the mapping. It reads
`context.router` from `subgraph.yaml`; the zero address means "index every Strikeline leg on any
app", which is what a registry-wide surface wants.

A strategy that is not a Strikeline leg — an ordinary `XYCSwap` pool shipped to the same router, or
bytes that do not decode at all — is skipped, not guessed at. The decoder declines rather than
inventing a strike.

## Build

```bash
cd subgraph
npm install
npm run codegen        # graph codegen
npm run build          # graph build   -> build/subgraph.yaml
```

The committed manifest targets **Base** with the official Aqua registry. `startBlock` is the block
our fork is pinned at (50946000); on a real deployment set it to the block the router was deployed
in.

## Point it at the local fork

```bash
make fork && make bootstrap          # from the repo root: anvil + deploy + manifest
cd subgraph
npm run configure                    # reads ../web/public/deployments/local.json
npm run codegen && npm run build
```

`configure` writes the router address into **both** places that must agree — the
`StrikelineRouter` data source address and the `Aqua` data source's `context.router` — plus the
start block and `networks.json`. `graph build --network <name>` only substitutes the former, which
is why the script exists.

## Deploy

Against a local graph-node (docker-compose from `graphprotocol/graph-node`, with
`ethereum: 'localhost:http://host.docker.internal:8545'`):

```bash
npm run create-local
npm run deploy-local
# GraphQL at http://127.0.0.1:8000/subgraphs/name/strikeline/surface
```

Against Subgraph Studio:

```bash
graph auth <deploy key>
graph deploy strikeline-surface
```

## The query the whole thing exists for

Best bid for a 7-day 2,800 call, across every maker on the registry:

```graphql
{
  surfacePoints(
    where: { strikeWad: "2800000000000000000000", maturity: "1789000000", liveLegCount_gt: 0 }
  ) {
    strikeWad
    maturity
    liveLegCount
    maxSigmaWad          # the widest live vol: the maker paying the most theta
    liveLiquidityWad     # notional written at this point across all makers
    bestLeg {
      id
      maker { id }
      sigmaWad
      liquidityWad
      reserveRisky
      guarded            # is that depth actually margined?
    }
  }
}
```

And the whole surface, one row per cell:

```graphql
{
  surfacePoints(where: { liveLegCount_gt: 0 }, orderBy: strikeWad) {
    strikeWad
    maturity
    maxSigmaWad
    minSigmaWad
    liveLegCount
    legs { id maker { id } sigmaWad liquidityWad reserveRisky docked }
  }
}
```

## The app does not depend on this

`web/src/app/(app)/surface` prefers the subgraph and falls back to reading the same `Shipped` logs
directly through viem, decoding them with the same offsets in TypeScript. The demo therefore never
waits on external infrastructure, and the two paths are a cross-check on each other: if the subgraph
and the direct read disagree about a strike, one of the two decoders is wrong.

## Testing

The decoder's byte offsets are pinned by `contracts/test/surface/SurfaceLens.t.sol` (Solidity) and
by `web/src/components/surface/__tests__/decode.test.ts` (TypeScript), which asserts against a real
`abi.encode(order)` blob captured from that Foundry suite. AssemblyScript unit tests would need
`matchstick`, whose binary is a platform-specific install; the three implementations share the same
constants and the same golden vector instead.
