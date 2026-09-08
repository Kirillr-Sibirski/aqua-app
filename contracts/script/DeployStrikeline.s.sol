// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, VmSafe, console } from "forge-std/Script.sol";

import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";

import { StrikelineRouter } from "../src/StrikelineRouter.sol";
import { RmmSwap } from "../src/instructions/RmmSwap.sol";
import { Coverage } from "../src/instructions/Coverage.sol";

/// @notice Addresses that are the same on every chain Strikeline targets, and the ones that are not.
library Canonical {
    /// @notice The official Aqua registry. Strikeline settles against this and never redeploys it.
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    /// @notice The official, unmodified AquaSwapVMRouter v1.0.2, recorded for provenance only.
    address internal constant OFFICIAL_ROUTER = 0x111111338c5091E8440b67B168bAe16a668AC0De;

    address internal constant WETH_ETHEREUM = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant WETH_BASE = 0x4200000000000000000000000000000000000006;

    function wethFor(uint256 chainId) internal pure returns (address) {
        if (chainId == 1) {
            return WETH_ETHEREUM;
        }
        // Base (8453) and every anvil fork of it (31337) share the OP-stack predeploy.
        return WETH_BASE;
    }
}

/// @title DeployStrikeline
/// @notice Deploys `StrikelineRouter` against the OFFICIAL Aqua registry.
///
/// @dev Two entrypoints, because a script cannot know its own transaction hash: foundry writes the broadcast
///      receipt only after the script returns. So:
///
///        forge script script/DeployStrikeline.s.sol:DeployStrikeline --rpc-url $RPC --broadcast --private-key $PK
///        forge script script/DeployStrikeline.s.sol:RecordDeployment --rpc-url $RPC
///
///      or `make deploy RPC=... PK=...`, which runs both and passes `SOURCE_COMMIT` from git.
///
///      The second pass reads the receipt back with `vm.getBroadcast` and writes `deployments/<chainid>.json`.
///      Recording the hash from the receipt rather than from the script's own guess is the point: the manifest
///      states what actually landed on chain, and it can be verified against an explorer without trusting us.
contract DeployStrikeline is Script {
    function run() external returns (StrikelineRouter router) {
        address aqua = vm.envOr("AQUA", Canonical.AQUA);
        address weth = vm.envOr("WETH", Canonical.wethFor(block.chainid));
        address owner = vm.envOr("OWNER", msg.sender);
        string memory name = vm.envOr("ROUTER_NAME", string("Strikeline"));
        string memory version = vm.envOr("ROUTER_VERSION", string("1"));

        require(aqua.code.length > 0, "AQUA has no code on this chain");
        require(weth.code.length > 0, "WETH has no code on this chain");

        vm.startBroadcast();
        router = new StrikelineRouter(aqua, weth, owner, name, version);
        vm.stopBroadcast();

        uint256 size = address(router).code.length;
        require(size > 0, "router deployed with no code");
        require(size <= 24_576, "router exceeds EIP-170");

        console.log("StrikelineRouter", address(router));
        console.log("  aqua          ", aqua);
        console.log("  aqua canonical", aqua == Canonical.AQUA);
        console.log("  weth          ", weth);
        console.log("  owner         ", owner);
        console.log("  runtime bytes ", size);
        console.log("  EIP-170 margin", 24_576 - size);
        console.log("");
        console.log("Now run RecordDeployment on the same RPC to write deployments/%s.json", block.chainid);
    }
}

/// @title RecordDeployment
/// @notice Writes `deployments/<chainid>.json` from the broadcast receipt of the deploy above.
///
/// @dev Everything in the manifest is read back from the chain or from the receipt. Nothing is asserted by the
///      script about what it believes it deployed:
///
///        - `transactionHash` and `blockNumber` come from `vm.getBroadcast`, i.e. from the receipt foundry got
///          back from the node.
///        - `runtimeCodeHash` is `address(...).codehash`, read from the deployed account. It is what makes the
///          manifest verifiable: anyone can `eth_getCode` the address and keccak it.
///        - The Aqua entry carries its own `runtimeCodeHash` too, so the manifest records not just that we
///          pointed at the canonical address but that the bytecode there was the expected one.
///        - `sourceCommit` and `sourceDirty` come from the environment, supplied by `make deploy` from git. A
///          dirty tree is recorded rather than refused, because refusing would only encourage a throwaway commit.
///        - `fork` is present only when `FORK_CHAIN_ID` / `FORK_BLOCK` are set, which is how the local Base fork
///          at block 50946000 identifies itself. On a real chain the field is absent.
contract RecordDeployment is Script {
    using OpcodeOps for Opcode;

    function run() external {
        uint64 chainId = uint64(block.chainid);

        VmSafe.BroadcastTxSummary memory tx_ =
            vm.getBroadcast("StrikelineRouter", chainId, VmSafe.BroadcastTxType.Create);
        require(tx_.contractAddress != address(0), "no StrikelineRouter CREATE broadcast found for this chain");
        require(tx_.success, "the recorded StrikelineRouter deployment did not succeed");

        address router = tx_.contractAddress;
        require(router.code.length > 0, "the recorded address has no code on this RPC");

        // The address must be a STRIKELINE router, not merely a contract. `tauNow` is one of the four views
        // only this router carries, so a manifest can never end up pointing at a stock SwapVM deployment or at
        // a stale address that something else has since occupied.
        require(
            StrikelineRouter(payable(router)).tauNow(uint40(block.timestamp + 365 days)) > 0,
            "the recorded address does not answer StrikelineViews.tauNow"
        );

        address aqua = vm.envOr("AQUA", Canonical.AQUA);
        address weth = vm.envOr("WETH", Canonical.wethFor(block.chainid));

        // --- external references ------------------------------------------------------------------------
        //
        // Each carries its own `runtimeCodeHash` so the manifest records not just which address we pointed at
        // but which bytecode was there when we did. `codehash` is 0 for an account with no code at all, and
        // `keccak256("")` for one that exists but is not a contract; neither is silently hidden.
        string memory aquaKey = "aqua";
        vm.serializeAddress(aquaKey, "address", aqua);
        vm.serializeBool(aquaKey, "canonical", aqua == Canonical.AQUA);
        string memory aquaJson = vm.serializeBytes32(aquaKey, "runtimeCodeHash", aqua.codehash);

        string memory wethKey = "weth";
        vm.serializeAddress(wethKey, "address", weth);
        string memory wethJson = vm.serializeBytes32(wethKey, "runtimeCodeHash", weth.codehash);

        // Recorded for provenance only: Strikeline never calls it. Its presence is what lets a reader check
        // that we ran beside the official router rather than in place of it.
        string memory officialKey = "officialRouter";
        vm.serializeAddress(officialKey, "address", Canonical.OFFICIAL_ROUTER);
        string memory officialJson =
            vm.serializeBytes32(officialKey, "runtimeCodeHash", Canonical.OFFICIAL_ROUTER.codehash);

        // --- what this router adds to the standard set --------------------------------------------------
        //
        // The two opcode slots are the whole contribution, and they are what a caller's encoder has to agree
        // with. Recording them beside the address means a manifest is enough to check that a program built
        // off-chain will dispatch here. `docs/OPCODES.md` carries the argument layout behind each slot.
        string memory ixKey = "instructions";
        vm.serializeUint(ixKey, "RmmSwap", RmmSwap.opcode.asU8());
        string memory ixJson = vm.serializeUint(ixKey, "Coverage", Coverage.opcode.asU8());

        // --- the deployed contract ----------------------------------------------------------------------
        //
        // TWO HASHES, because they answer different questions.
        //
        //   runtimeCodeHash  keccak256 of the code actually at `address`. Anyone can reproduce it with one
        //                    `eth_getCode` and a keccak, which is what makes the manifest checkable. It is
        //                    NOT a build fingerprint: SwapVM caches its EIP-712 domain separator as an
        //                    immutable, and that separator contains `address(this)`, so two deployments of
        //                    the same bytes at different addresses have different runtime code hashes.
        //
        //   buildCodeHash    keccak256 of the compiled artifact's deployed bytecode, with immutables still
        //                    unset. This one IS the build fingerprint: identical across deployments, and it
        //                    changes the moment the compiler input does.
        bytes memory artifact = vm.getDeployedCode("StrikelineRouter.sol:StrikelineRouter");
        require(artifact.length == router.code.length, "deployed size does not match the current artifact");

        string memory routerKey = "StrikelineRouter";
        vm.serializeAddress(routerKey, "address", router);
        // The OWNER, read back off the deployed contract, not the deployer. The broadcast receipt carries no
        // sender field, so a "deployer" here could only be this script's default sender — a guess. The owner
        // is the address that actually holds privilege, and it is on chain, so it is the one worth recording.
        vm.serializeAddress(routerKey, "owner", StrikelineRouter(payable(router)).owner());
        vm.serializeBytes32(routerKey, "transactionHash", tx_.txHash);
        vm.serializeUint(routerKey, "blockNumber", tx_.blockNumber);
        vm.serializeBytes32(routerKey, "runtimeCodeHash", router.codehash);
        vm.serializeBytes32(routerKey, "buildCodeHash", keccak256(artifact));
        vm.serializeUint(routerKey, "runtimeCodeSize", router.code.length);
        string memory routerJson = vm.serializeUint(routerKey, "eip170Margin", 24_576 - router.code.length);

        string memory contractsKey = "contracts";
        string memory contractsJson = vm.serializeString(contractsKey, "StrikelineRouter", routerJson);

        // --- provenance ---------------------------------------------------------------------------------
        string memory root = "root";
        vm.serializeString(root, "schema", "strikeline/deployments@1");
        vm.serializeUint(root, "chainId", chainId);
        vm.serializeString(root, "sourceCommit", vm.envOr("SOURCE_COMMIT", string("unknown")));
        vm.serializeBool(root, "sourceDirty", vm.envOr("SOURCE_DIRTY", false));
        vm.serializeUint(root, "recordedAtBlock", block.number);
        vm.serializeUint(root, "recordedAtTimestamp", block.timestamp);
        vm.serializeString(root, "officialRouter", officialJson);
        vm.serializeString(root, "instructions", ixJson);

        uint256 forkChainId = vm.envOr("FORK_CHAIN_ID", uint256(0));
        if (forkChainId != 0) {
            string memory forkKey = "fork";
            vm.serializeUint(forkKey, "chainId", forkChainId);
            string memory forkJson = vm.serializeUint(forkKey, "block", vm.envOr("FORK_BLOCK", uint256(0)));
            vm.serializeString(root, "fork", forkJson);
        }

        vm.serializeString(root, "aqua", aquaJson);
        vm.serializeString(root, "weth", wethJson);
        string memory out = vm.serializeString(root, "contracts", contractsJson);

        string memory path = string.concat("deployments/", vm.toString(uint256(chainId)), ".json");
        vm.writeJson(out, path);

        console.log("wrote %s", path);
        console.log("  StrikelineRouter  ", router);
        console.log("  transactionHash   ", vm.toString(tx_.txHash));
        console.log("  runtimeCodeHash   ", vm.toString(router.codehash));
        console.log("  buildCodeHash     ", vm.toString(keccak256(artifact)));
        console.log("  aqua              ", aqua);
        console.log("  aqua codehash     ", vm.toString(aqua.codehash));
        console.log("  opcodes           ", RmmSwap.opcode.asU8(), Coverage.opcode.asU8());
        console.log("");
        console.log("Verify with nothing but an RPC (note the substitution: cast keccak takes an argument,");
        console.log("not stdin, and piping it feeds the trailing newline into the hash):");
        console.log('  cast keccak "$(cast code %s --rpc-url $RPC)"', vm.toString(router));
    }
}
