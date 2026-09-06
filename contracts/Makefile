.PHONY: build test test-unit test-fork test-gas clean

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

clean:
	forge clean
