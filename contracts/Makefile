.PHONY: build sizes test test-unit test-fork test-gas test-invariants deploy clean

# Public mainnet RPCs verified working on 2026-09-05: publicnode, drpc. (eth.llamarpc.com returned HTTP 521.)
FORK_RPC_URL ?= https://ethereum-rpc.publicnode.com
# The fork suite spans two chains. test/fork/AquaMainnetFork.t.sol needs Ethereum; test/fork/live/
# AquaBaseLiveFork.t.sol needs Base (8453) and skips itself on anything else, which is how a bare
# `make test-fork` used to run 5 of 11 and report the other 6 as silent skips.
BASE_FORK_RPC_URL ?= https://base-rpc.publicnode.com

build:
	forge build

# The EIP-170 gate on everything that could be deployed, so a red build means something that SHIPS
# grew too big. Bare `forge build --sizes` cannot be that gate: CurveProbeRouterPRB is 1,374 B over
# the limit on purpose -- that overflow is the measurement that chose solady over PRBMath -- so the
# unfiltered command exits non-zero by design. Run it by hand to reproduce the comparison table in
# src/spikes/README.md §1; run this to find out whether the router still fits. Skipping the probe
# router means also skipping the one test file that imports it; `make test` compiles and runs both.
sizes:
	forge build --sizes --skip CurveProbeRouterPRB --skip CurveProbeAqua

# Unit tests (fresh Aqua + mocks). Fork tests auto-skip because FORK_RPC_URL is not exported here.
test:
	forge test -vv

test-unit:
	forge test --no-match-path 'test/fork/*' -vv

# Fork tests against the OFFICIAL Aqua (0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a) + real WETH/USDC.
test-fork:
	FORK_RPC_URL=$(FORK_RPC_URL) BASE_FORK_RPC_URL=$(BASE_FORK_RPC_URL) forge test --match-path 'test/fork/*' -vv

test-gas:
	forge test --no-match-path 'test/fork/*' --gas-report

# Invariants, golden decimal vectors, the gas table and the frozen opcode layout, with their console output.
test-invariants:
	forge test --match-path 'test/invariants/*' -vv

# ---------------------------------------------------------------------------- deploy
#
#   make deploy RPC=http://127.0.0.1:8545 PK=0xac09...ff80
#
# Two passes on purpose: foundry writes the broadcast receipt only after a script returns, so the
# transaction hash cannot be known inside the deploying script. The second pass reads that receipt back
# and writes deployments/<chainid>.json with the hash, the runtime code hash of every address involved,
# the canonical Aqua and the source commit. Override AQUA / WETH / OWNER / FORK_CHAIN_ID / FORK_BLOCK
# through the environment.
DEPLOY_SCRIPT := script/DeployStrikeline.s.sol
RPC ?= http://127.0.0.1:8545

deploy:
	@[ -n "$(PK)" ] || (echo "set PK=<deployer private key>"; exit 1)
	forge script $(DEPLOY_SCRIPT):DeployStrikeline --rpc-url $(RPC) --broadcast --private-key $(PK)
	SOURCE_COMMIT=$$(git rev-parse HEAD) \
	SOURCE_DIRTY=$$(git diff --quiet HEAD -- . && echo false || echo true) \
	forge script $(DEPLOY_SCRIPT):RecordDeployment --rpc-url $(RPC)

clean:
	forge clean
