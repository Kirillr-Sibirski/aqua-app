.PHONY: build test test-unit test-fork test-gas test-invariants deploy clean

# Public mainnet RPCs verified working on 2026-09-05: publicnode, drpc. (eth.llamarpc.com returned HTTP 521.)
FORK_RPC_URL ?= https://ethereum-rpc.publicnode.com

build:
	forge build

# Unit tests (fresh Aqua + mocks). Fork tests auto-skip because FORK_RPC_URL is not exported here.
test:
	forge test -vv

test-unit:
	forge test --no-match-path 'test/fork/*' -vv

# Fork tests against the OFFICIAL Aqua (0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a) + real WETH/USDC.
test-fork:
	FORK_RPC_URL=$(FORK_RPC_URL) forge test --match-path 'test/fork/*' -vv

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
