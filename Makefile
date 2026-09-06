# Aqua app — top-level developer targets (contracts / local Base fork / web)
#
#   make fork            start anvil forking Base @ pinned block (chain id 31337) — keep it running in its own terminal
#   make bootstrap       deploy our router against the OFFICIAL Aqua + fund demo wallets + write deployments manifests
#   make smoke           ship a strategy, quote + swap 0.1 WETH through our router (end-to-end check)
#   make oracle ARGS="eth 3100"     move Chainlink ETH/USD on the fork (btc|cbbtc|usdc|0x…; add --tx for an event)
#   make time ARGS="+3600"          warp the fork clock;  make snapshot ARGS="save|restore"
#   make test / make test-fork      Foundry unit tests / fork tests against the official Aqua on Ethereum
#   make web             next dev
#
# Variables can come from .env (see .env.example): ANVIL_FORK_URL, ANVIL_FORK_BLOCK, DEMO_ADDRESS, ROUTER_ARTIFACT, ...
SHELL := /bin/bash
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
-include $(ROOT).env
export

SCRIPTS := $(ROOT)scripts
TSX := $(SCRIPTS)/node_modules/.bin/tsx
ARGS ?=

.PHONY: help install fork fork-state build build-src bootstrap smoke oracle time snapshot test test-unit test-fork web typecheck

help:
	@sed -n '2,11p' $(ROOT)Makefile | sed 's/^# \{0,1\}//'

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

ROUTER_ARTIFACT ?= contracts/out/ProbeRouter.sol/ProbeRouter.json

build:
	cd $(ROOT)contracts && forge build

# compiles src/ + script/ only (no tests) — enough to produce the router artifact
build-src:
	cd $(ROOT)contracts && forge build --skip 'test/**'

bootstrap: $(TSX)
	@[ -f "$(ROUTER_ARTIFACT)" ] || [ -f "$(ROOT)$(ROUTER_ARTIFACT)" ] || $(MAKE) build-src
	cd $(ROOT) && $(TSX) scripts/fork/bootstrap.ts

smoke: $(TSX)
	cd $(ROOT) && $(TSX) scripts/fork/smoke.ts

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

# ---------------------------------------------------------------------------- web

web:
	cd $(ROOT)web && npm run dev
