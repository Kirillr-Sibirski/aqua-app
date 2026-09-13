# Strikeline — top-level developer targets (contracts / local Base fork / web)
#
#   make fork            start anvil forking Base @ pinned block (chain id 31337) — keep it running in its own terminal
#   make bootstrap       deploy our router against the OFFICIAL Aqua + fund demo wallets + write deployments manifests
#   make smoke           ship a strategy, quote + swap 0.1 WETH through our router (end-to-end check)
#   make oracle ARGS="eth 3100"     move Chainlink ETH/USD on the fork (btc|cbbtc|usdc|0x…; add --tx for an event)
#   make time ARGS="+3600"          warp the fork clock;  make snapshot ARGS="save|restore"
#   make test / make test-fork      Foundry unit tests / fork tests against the official Aqua on Ethereum
#   make markout         SIMULATION: replay the real Base price tape through the book vs holding vs a pool
#   make web             next dev
#   make web-dev-routes  next dev, with /dev and /dev/diag routed
#
#   THE READ LAYER (optional, not deployed — the app reads Aqua logs directly; subgraph/README.md)
#   make subgraph        graph codegen && graph build — the vol surface, indexed out of Aqua's Shipped bytes
#   make subgraph-local  point the manifest at the running fork's router first, then codegen + build
#   make subgraph-node   create + deploy to a graph-node on localhost (needs one running)
#   make test-surface    the subgraph mappings (node) and SurfaceLens (Foundry)
#
#   THE DEMO (scripts/story/README.md has the runbook and the timings)
#   make story-setup     deploy StrikelineRouter, seed the wallets, anchor the price tape, freeze the fork
#   make story-load      anvil_loadState back to that frozen state — a retake costs a second
#   make story-0 .. -6   one scene each;  make story-all runs 1-6 back to back
#   make story-status    where the demo currently is
#   make bot ARGS="..."  the arbitrage bot on its own
#   make tape            re-capture the real Base ETH/USD series (needs an archive Base RPC)
#
# Variables can come from .env (see .env.example): ANVIL_FORK_URL, ANVIL_FORK_BLOCK, DEMO_ADDRESS, ROUTER_ARTIFACT, ...
SHELL := /bin/bash
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
-include $(ROOT).env
export

SCRIPTS := $(ROOT)scripts
TSX := $(SCRIPTS)/node_modules/.bin/tsx
# Scripts that import the app's own encoders through the `@/` alias need the web tsconfig's paths.
TSX_ALIASED := $(TSX) --tsconfig $(SCRIPTS)/tsconfig.json
ARGS ?=

.PHONY: help install fork fork-state build build-src bootstrap smoke oracle time snapshot test test-unit test-fork test-surface web typecheck \
        subgraph subgraph-install subgraph-local subgraph-node \
        tape story-bootstrap story-setup story-load story-status story-all story-0 story-1 story-2 story-3 story-4 story-5 story-6 bot \
        markout

help:
	@sed -n '2,25p' $(ROOT)Makefile | sed 's/^# \{0,1\}//'

# ---------------------------------------------------------------------------- deps

install: $(TSX)
	cd $(ROOT)contracts && npm install --no-audit --no-fund
	cd $(ROOT)web && npm install --no-audit --no-fund

$(TSX):
	cd $(SCRIPTS) && npm install --no-audit --no-fund

# ---------------------------------------------------------------------------- local fork

fork:
	bash $(SCRIPTS)/fork/start.sh

# same, but persist/reload chain state in scripts/fork/.state (router address survives restarts)
fork-state:
	bash $(SCRIPTS)/fork/start.sh --state

# The app's router. ProbeRouter also deploys and also answers `AQUA()`, and lands at the SAME
# deterministic address, so pointing this at it produces a fork where nothing looks wrong and every
# Strikeline read reverts. `bootstrap.ts` now refuses to write a manifest for a router that cannot
# answer `tauNow`, but the default has to be right too.
ROUTER_ARTIFACT ?= contracts/out/StrikelineRouter.sol/StrikelineRouter.json

build:
	cd $(ROOT)contracts && forge build

# compiles src/ + script/ only (no tests) — enough to produce the router artifact
build-src:
	cd $(ROOT)contracts && forge build --skip 'test/**'

bootstrap: $(TSX)
	@[ -f "$(ROUTER_ARTIFACT)" ] || [ -f "$(ROOT)$(ROUTER_ARTIFACT)" ] || $(MAKE) build-src
	cd $(ROOT) && $(TSX) scripts/fork/bootstrap.ts

smoke: $(TSX)
	cd $(ROOT) && $(TSX_ALIASED) scripts/fork/smoke.ts

oracle: $(TSX)
	cd $(ROOT) && $(TSX) scripts/fork/oracle.ts $(ARGS)

time: $(TSX)
	cd $(ROOT) && $(TSX) scripts/fork/time.ts $(ARGS)

snapshot: $(TSX)
	cd $(ROOT) && $(TSX) scripts/fork/snapshot.ts $(ARGS)

typecheck: $(TSX)
	cd $(SCRIPTS) && node_modules/.bin/tsc --noEmit -p tsconfig.json

# ---------------------------------------------------------------------------- contracts

test:
	$(MAKE) -C $(ROOT)contracts test

# unit suite only; the fork directory is excluded from compilation as well (it is only needed for test-fork)
test-unit:
	cd $(ROOT)contracts && forge test --skip 'test/fork/**' -vv

# FORK_RPC_URL defaults to Ethereum publicnode inside contracts/Makefile (the fork suite uses mainnet addresses)
test-fork:
	$(MAKE) -C $(ROOT)contracts test-fork

# ---------------------------------------------------------------------------- the markout study
# A SIMULATION, labelled as one everywhere it appears. Replays every Chainlink ETH/USD round the feed
# published on Base over a 10.7-day capture through the demo book, on the real router and the real Aqua
# registry, against holding the same coins and against a constant-product position on identical capital.
# Prints the table, the volatility sweep and the eight-window sweep, then publishes the numbers the
# README reports. Needs no fork and no RPC.

markout: $(TSX)
	cd $(ROOT) && $(TSX) scripts/markout/tape.ts --check
	cd $(ROOT)contracts && forge test --match-path 'test/markout/*' -vv
	cd $(ROOT) && $(TSX) scripts/markout/publish.ts

# ---------------------------------------------------------------------------- web

web:
	cd $(ROOT)web && npm run dev

# The one product screen plus /dev, /dev/theme and /dev/diag. Those three are debugging surfaces:
# their files are named page.dev.tsx / route.dev.ts and next.config.ts only counts those extensions
# as routes when DEV_ROUTES=1, so a production build cannot ship them.
web-dev-routes:
	cd $(ROOT)web && DEV_ROUTES=1 npm run dev

# ---------------------------------------------------------------------------- the read layer
# subgraph/ indexes the OFFICIAL Aqua's Shipped/Docked/Pushed/Pulled plus our router's Swapped, and
# decodes the strategy bytes in the mapping to recover (maker, pair, K, sigma, maturity, L). The
# committed manifest targets Base; `subgraph-local` repoints it at whatever bootstrap just deployed.

SUBGRAPH := $(ROOT)subgraph
GRAPH := $(SUBGRAPH)/node_modules/.bin/graph

$(GRAPH):
	cd $(SUBGRAPH) && npm install --no-audit --no-fund

subgraph-install: $(GRAPH)

subgraph: $(GRAPH)
	cd $(SUBGRAPH) && $(GRAPH) codegen && $(GRAPH) build

# Reads web/public/deployments/local.json and writes the router address into BOTH places that must
# agree — the StrikelineRouter data source and the Aqua source's context.router — plus networks.json.
subgraph-local: $(GRAPH)
	cd $(SUBGRAPH) && node scripts/configure.mjs && $(GRAPH) codegen && $(GRAPH) build

# Needs a graph-node + IPFS on localhost (docker compose in subgraph/README.md).
subgraph-node: $(GRAPH)
	cd $(SUBGRAPH) && npm run create-local && npm run deploy-local

# The read layer's own tests: the mappings run in WebAssembly and the lens in Foundry. Neither needs a fork.
test-surface: $(GRAPH)
	cd $(SUBGRAPH) && npm test
	cd $(ROOT)contracts && forge test --match-path 'test/surface/*' -vv

# ---------------------------------------------------------------------------- the scripted demo
# scripts/story drives the scenes; scripts/arb is the arbitrage bot and the replayed Base price tape.
# Both import the app's own SwapVM/RmmSwap encoders through the `@/` alias, hence --tsconfig.

STORY := $(TSX_ALIASED)
STRIKELINE_ARTIFACT ?= contracts/out/StrikelineRouter.sol/StrikelineRouter.json

# Re-capture the real Chainlink ETH/USD rounds from Base. Committed, so this is rarely needed.
tape: $(TSX)
	cd $(ROOT) && $(STORY) scripts/arb/capture.ts $(ARGS)

# Same artifact as `make bootstrap` (StrikelineRouter is the default for both). What this target adds is
# FORCE_REDEPLOY: the demo has to open on a router deployed at a known nonce, so it never reuses whatever
# an earlier bootstrap left in the manifest.
story-bootstrap: $(TSX)
	@[ -f "$(ROOT)$(STRIKELINE_ARTIFACT)" ] || $(MAKE) build-src
	cd $(ROOT) && ROUTER_ARTIFACT=$(STRIKELINE_ARTIFACT) ROUTER_NAME=Strikeline ROUTER_VERSION=1 FORCE_REDEPLOY=1 $(TSX) scripts/fork/bootstrap.ts

story-setup: story-bootstrap
	cd $(ROOT) && $(STORY) scripts/story/setup.ts

story-load: $(TSX)
	cd $(ROOT) && $(STORY) scripts/story/load.ts $(ARGS)

story-status: $(TSX)
	cd $(ROOT) && $(STORY) scripts/story/run.ts status

story-0: ; cd $(ROOT) && $(STORY) scripts/story/run.ts 0 $(ARGS)
story-1: ; cd $(ROOT) && $(STORY) scripts/story/run.ts 1 $(ARGS)
story-2: ; cd $(ROOT) && $(STORY) scripts/story/run.ts 2 $(ARGS)
story-3: ; cd $(ROOT) && $(STORY) scripts/story/run.ts 3 $(ARGS)
story-4: ; cd $(ROOT) && $(STORY) scripts/story/run.ts 4 $(ARGS)
story-5: ; cd $(ROOT) && $(STORY) scripts/story/run.ts 5 $(ARGS)
story-6: ; cd $(ROOT) && $(STORY) scripts/story/run.ts 6 $(ARGS)

story-all: $(TSX)
	cd $(ROOT) && $(STORY) scripts/story/run.ts all $(ARGS)

bot: $(TSX)
	cd $(ROOT) && $(STORY) scripts/arb/bot.ts $(ARGS)
