# Strikeline Surface — the subgraph

**A price list for a market that publishes none.** Every offer here is a small program its maker put
on chain. The program states in the clear what it sells, at what price and until when. Nothing
aggregates those programs — so this indexes the chain's own log, decodes each one as it arrives, and
turns them into something you can ask a question of.

The question is *"who is offering the best terms on a 7-day 2,800 call, across every maker"*, and it
has no answer anywhere else. Not off-chain, because there is no order book. Not on-chain, because
[1inch Aqua](https://github.com/1inch/aqua) keys a strategy by the hash of its own bytes and relates
nothing to anything: two makers who wrote the same option are two unrelated storage slots. Decoding
the log is what makes the comparison exist, and **The Graph** is where it lives.

## Why an event log can carry a market

`Aqua.ship` takes the strategy *"fully instead of being pre-hashed, for data availability"*, and the
`Shipped` event carries those bytes verbatim. A Strikeline offer's program encodes its strike, its
implied vol, its maturity and its liquidity **in the clear**:

```
Deadline(T+30m) · Coverage(flags, haircut) · RmmSwap(flags, σ, T, K, L, rates) · Salt(n)
                                              └── 62 argument bytes, all of them public
```

So every option any maker has ever written on this router is decodable by anyone holding the log —
no cooperation from the maker, no off-chain order book, no price feed. `src/decode.ts` is that
decoder. It is the same algorithm as `contracts/src/SurfaceLens.sol`, transcribed to AssemblyScript
with the same byte offsets, and it is tested against the same bytes (below).

That is the whole trick, and it is the reason an implied-volatility surface can be reconstructed
from state that nobody published for that purpose.

## The schema

Four entities. `schema.graphql` is the authority; this is what each one is *for*.

| Entity | Key | What it is |
|---|---|---|
| `Leg` | Aqua strategy hash | One offer: the pair, K, σ, maturity, L, the decimal rates, the flags, whether `Coverage` margins it, the raw bytes, Aqua's live reserves and whether it has been withdrawn. |
| `Maker` | address | A wallet that has written options here: offers ever made, offers still live, fills taken. |
| `Fill` | `txHash-logIndex` | One swap against an offer, from the router's own `Swapped`. |
| `SurfacePoint` | `risky-stable-strike-maturity` | **One cell of the surface**: every maker's offer at that price and date, the widest live vol (the best bid), which offer is quoting it, and the size written across all of them. |

`SurfacePoint` is the entity that does not exist on chain in any form. The registry has no notion of
"the same option written twice", so this aggregation is created in the mapping, on every ship and
every dock, and stored. A query does not recompute it.

The pair is part of the cell's key on purpose: a strike is normalised stable-per-risky, so a cbBTC
call struck at 2,800 USDC and a WETH call struck at 2,800 USDC carry the same `strikeWad`. Keying on
(strike, expiry) alone would rank one against the other as a "best bid" between two options a taker
cannot choose between.

## The decode

`src/decode.ts`, in two steps, neither of which calls a contract.

1. **`decodeStrategy`** — `abi.decode(strategy, (Order))` by hand. The program's start offset is read
   out of `traits` bits 208..223 (`MakerTraitsLib._getOffset(traits, 3)`) rather than assumed to be
   40, which is what makes an order carrying maker hooks decode correctly. Every length word is
   bounds-checked before it is narrowed to an index: a log is public input, a length can be
   `2^256 - 1`, and `BigInt.toI32()` traps — a trap in a mapping kills the whole subgraph rather than
   one entry.
2. **`decodeProgram`** — walks `[opcode][argsLength][args]` to the end of the stream. It is an exact
   decode, not a pattern match: either the scan lands on every instruction boundary or the program is
   declined. `0x55` with 62 argument bytes is the curve; `0x93` anywhere in the stream means the
   quote is margined against the maker's real wallet.

A strategy that is not a Strikeline offer — an ordinary `XYCSwap` pool shipped to the same router, or
bytes that do not decode — is skipped, not guessed at. **The decoder declines rather than inventing a
strike.**

Handlers:

| Source | Event | Handler |
|---|---|---|
| Aqua (official, `0x1111113CCf…`) | `Shipped` | decode; create `Maker`, `Leg`, `SurfacePoint`; recompute the cell |
| | `Docked` | mark withdrawn, zero the reserves, recompute the cell |
| | `Pushed` / `Pulled` | reserve arithmetic |
| StrikelineRouter | `Swapped` | create `Fill`, join it to its offer by `orderHash` |

Reserves are walked by Aqua's own `Pushed`/`Pulled`, so they track registry storage exactly and a
fill is never counted twice. `Docked` zeroes them, because Aqua does.

Aqua's events carry **no indexed parameters**, so the app filter cannot live in the manifest and
happens in the mapping instead. It reads `context.router` from `subgraph.yaml`; the zero address
means "index every Strikeline offer on any app", which is what a registry-wide surface wants.

## Proof: the mapping is run, not asserted

The AssemblyScript is compiled with **exactly** the argument list `graph build` passes to `asc`
(`--explicitStart --exportRuntime --runtime stub`, graph-ts as the global — see
`@graphprotocol/graph-cli/dist/compiler/asc.js`), and `tests/wasm.mjs` then plays the host graph-node
plays: an in-memory store, the data source context that carries the app filter, the logger, the type
conversions, and `bigInt.plus`/`minus` computed and handed back as signed little-endian bytes. **The
WebAssembly under test is the code that ships in `build/Aqua/Aqua.wasm`** — no mock decoder, no
transpiled-to-TypeScript copy.

```
$ npm test
ok 1 - decodes a real Shipped payload into the option its maker wrote
ok 2 - recovers the identity and the pair from the ABI envelope
ok 3 - reads the flags the surface renders: which side is risky, and whether Coverage margins it
ok 4 - an option written without the Coverage wrapper decodes, and says its depth is unmargined
ok 5 - declines rather than guessing, on every program that is not a leg
ok 6 - declines a payload that is not an abi.encode(Order) at all
ok 7 - the browser decoder is pinned to this same file, not to a copy of it
ok 8 - a Shipped event becomes an option, with the terms the maker wrote in it
ok 9 - reserves are walked by Aqua's own Pushed and Pulled, never by the fill
ok 10 - the fill joins its leg by orderHash, and is counted once
ok 11 - two makers who wrote the same option land in one cell of the surface
ok 12 - the cell knows the best bid, which is the widest live vol at that strike and expiry
ok 13 - a dock takes the quote off the book without moving a token
ok 14 - a different strike is a different cell, not a competing quote
ok 15 - the app filter keeps another app's strategies out, since Aqua indexes no parameters
ok 16 - a strategy that is not an option is skipped, not guessed at
ok 17 - a maker's counters are the ones a portfolio view would read
ok 18 - the best-bid query has an answer, and it is the one the README prints
# tests 18
# pass 18
# fail 0
```

**The fixture is a real leg.** `tests/golden.json` holds one `abi.encode(ISwapVM.Order)` captured
from `contracts/test/surface/SurfaceLens.t.sol::test_Decode_RecoversTheTermsFromTheShippedBytes`,
which shipped it to a live Aqua, plus the terms it must decode to:

| | Decoded from the bytes |
|---|---|
| Strike `K` | 2,600 × 10¹⁸ |
| Implied vol `σ` | 0.6 × 10¹⁸ (60%) |
| Maturity | 604801 (the fork's own clock; 7 days) |
| Liquidity `L` | 12 × 10¹⁸ |
| Rates | 1 and 10¹² (an 18/6-decimal pair priced in one space) |
| Margined | `true` — the program carries `Coverage` |

Three decoders read **that one file**: Solidity (Foundry), AssemblyScript (here) and TypeScript
(`web/src/components/surface/__tests__/decode.test.ts`, which reads `tests/golden.json` rather than a
transcription of it, and checks that `keccak256` of those bytes is the id this test ships them
under). A one-byte disagreement between them would put a wrong price on a screen with no error
anywhere, which is why the vector is one file and not three copies.

What the harness does **not** model, stated so nobody reads more into it: graph-node's `store.set`
copies an entity into Postgres, while the test store keeps the pointer, so a handler that mutated an
entity without saving it would be seen here and dropped there. Every handler in `src/` saves what it
mutates, and the assertions run after the whole event sequence — the state a query returns either
way. Block boundaries, reorgs and reverts are graph-node's business and are not modelled.

## The query the whole thing exists for

Best bid for one option, across every maker on the registry:

```graphql
{
  surfacePoints(where: { liveLegCount_gt: 0 }, orderBy: strikeWad) {
    strikeWad
    maturity
    liveLegCount        # how many makers are quoting this option
    maxSigmaWad         # the widest live vol: the best bid
    liveLiquidityWad    # size written here across all makers
    bestLeg {
      id
      maker { id }
      sigmaWad
      liquidityWad
      reserveRisky
      guarded           # is that size actually backed by the wallet?
    }
  }
}
```

And its response. This is **not an illustration**: it is written out by the last test above
(`tests/build/surface.query.json`) from the entities the mappings produced while indexing a sequence
of six `Shipped`, six `Pushed`, one `Pulled`, two `Swapped` and one `Docked` — four of those offers
ours, one shipped to a different app on the same registry, one not an option at all. Three makers,
one of whom withdrew.

```json
{
  "data": {
    "surfacePoints": [
      {
        "strikeWad": "2600000000000000000000",
        "maturity": "604801",
        "liveLegCount": 1,
        "maxSigmaWad": "600000000000000000",
        "liveLiquidityWad": "12000000000000000000",
        "bestLeg": {
          "id": "0x6e530ea84ba204e2e19d08a472eafd1d9cf0b4ee382a56676c87975c53e96f6e",
          "maker": {
            "id": "0xe05fcc23807536bee418f142d19fa0d21bb0cff7"
          },
          "sigmaWad": "600000000000000000",
          "liquidityWad": "12000000000000000000",
          "reserveRisky": "5710000000000000000",
          "guarded": true
        }
      },
      {
        "strikeWad": "2800000000000000000000",
        "maturity": "604801",
        "liveLegCount": 2,
        "maxSigmaWad": "680000000000000000",
        "liveLiquidityWad": "24000000000000000000",
        "bestLeg": {
          "id": "0xd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1",
          "maker": {
            "id": "0x2d4f7b1c9e0a8d3f6b5c4e2a1908f7e6d5c4b3a2"
          },
          "sigmaWad": "680000000000000000",
          "liquidityWad": "12000000000000000000",
          "reserveRisky": "7040000000000000000",
          "guarded": true
        }
      }
    ]
  }
}
```

Read it back in plain words. Three makers wrote the 2,800 call; one of them withdrew. Two are still
offering, the best of them is paying 68% implied vol, together they are offering 24 WETH of it, and
the best one's size is margined against its wallet rather than merely advertised. The maker who
withdrew is gone from every live figure while its `Leg` stays on the record. The 2,600 cell has one
maker on it, which is what a strike with no competition looks like; the response says so rather than
implying a choice.

The GraphQL server shapes this response. Every number in it was computed by the mapping.

One offer, with the bytes it was decoded from — the query the offer page runs:

```graphql
{
  leg(id: "0x6e530ea84ba204e2e19d08a472eafd1d9cf0b4ee382a56676c87975c53e96f6e") {
    maker { id }
    strikeWad
    sigmaWad
    maturity
    liquidityWad
    guarded
    reserveRisky
    reserveStable
    docked
    strategy          # the shipped bytes, verbatim: nothing above has to be taken on trust
    fills(orderBy: timestamp, orderDirection: desc) { taker amountIn amountOut timestamp }
  }
}
```

## Build

```bash
cd subgraph
npm install
npm run codegen        # graph codegen
npm run build          # graph build   -> build/subgraph.yaml
npm test               # 18 tests, the mappings run in WebAssembly
```

Real output of the two graph commands:

```
$ npm run codegen
✔ Apply migrations
✔ Load subgraph from subgraph.yaml
✔ Load contract ABIs
✔ Generate types for contract ABIs
✔ Generate types for data source templates
✔ Load data source template ABIs
✔ Generate types for data source template ABIs
✔ Load GraphQL schema from schema.graphql
✔ Generate types for GraphQL schema
Types generated successfully

$ npm run build
✔ Apply migrations
✔ Load subgraph from subgraph.yaml
✔ Compile subgraph
✔ Write compiled subgraph to build/
Build completed: build/subgraph.yaml
```

`build/Aqua/Aqua.wasm` comes out at 48,352 B and `build/StrikelineRouter/StrikelineRouter.wasm` at
37,709 B. The committed manifest targets **Base** with the official Aqua registry; `startBlock` is the
block our fork is pinned at (50946000). On a real deployment set it to the block the router was
deployed in — there is nothing to index before it.

## Point it at the local fork

```bash
make fork && make bootstrap          # from the repo root: anvil + deploy + manifest
cd subgraph
npm run configure                    # reads ../web/public/deployments/local.json
npm run codegen && npm run build
```

`configure` writes the router address into **both** places that must agree — the `StrikelineRouter`
data source address and the `Aqua` data source's `context.router` — plus the start block and
`networks.json`. `graph build --network <name>` substitutes only the former, which is why the script
exists.

## Deploy

Against a local graph-node (docker-compose from
[`graphprotocol/graph-node`](https://github.com/graphprotocol/graph-node/tree/master/docker), with
`ethereum: 'localhost:http://host.docker.internal:8545'` so it can see the anvil fork):

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

Then point the app at it and it prefers the index over the log:

```bash
# web/.env.local
NEXT_PUBLIC_SUBGRAPH_URL=http://127.0.0.1:8000/subgraphs/name/strikeline/surface
```

## The app prefers this, and does not depend on it

`web/src/app/(app)/surface` runs the query above when the subgraph is reachable and falls back to
reading the same `Shipped` logs directly through viem, decoding them with the same offsets in
TypeScript. The **Where these numbers come from** panel on that screen says which path answered, how
far behind the index is, and prints the query with the strike and expiry currently on screen
substituted in.

Two reasons that fallback exists. A demo should never wait on external infrastructure — and the two
paths are a cross-check on each other: if the subgraph and the direct read disagreed about a strike,
one of the two decoders would be wrong. The fallback is also honestly worse, and the panel says so:
Aqua's events carry no indexed parameters, so a direct read pulls every log since deployment on
every page load and filters in the browser. That is fine for a demo book and not fine for a market.
