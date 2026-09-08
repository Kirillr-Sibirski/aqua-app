# Oracle mocking on the fork — moving Chainlink ETH/USD from scripts / UI (verified 2026-09-06)

Fills the gap left by `fork-stack.md §9` ("UNCERTAIN which storage slot") and `position-catalog.md §5.1` (`vm.mockCall` only exists inside forge tests). Everything below was executed on anvil forks of Base (block 50926000, Tenderly gateway) and Ethereum (block 25914163) with `anvil 1.1.0-nightly (a63dbe2, 2025-04-30)`, `cast/forge 1.0.0-dev (7461390)`, Node v22.22.0. Scripts and outputs are in `work/oracle/` (`base_exp.sh`, `base_exp2.sh`, `eth_exp.sh`, `verify_slots.sh`, `ts/oracle-mock.mts`, `ts/chainlink-storage.mts`, `probe_proj/`). Anything not measured is marked UNCERTAIN.

## 0. TL;DR / decisions

- **Both approaches work from plain JSON-RPC (cast, TS, or the browser) — no forge cheatcodes needed.** An oracle-anchored position (catalog #1, (e), (g), (i)) is fully demoable from a script or the UI.
- **Recommended: Method B — install `MockAggregatorV3` at the feed's *proxy* address with `anvil_setCode`, drive it with `anvil_setStorageAt` (or a `setAnswer()` tx).** With `updatedAt = 0` the mock reports `block.timestamp`, so `OraclePriceAdjuster`'s `maxStaleness` check **never** reverts, even after `evm_increaseTime(864000)` (+10 days, measured). Nothing else in the position (strategy bytes, router, SDK) changes — it still reads `0x71041ddd…bb70`.
- **Method A (patch the real aggregator's `s_transmissions` slot) also works and is now fully specified** (slots found with `forge inspect` and verified on-chain): Base `DualAggregator 0x05c84a58…` → `s_hotVars` slot 13, `s_transmissions` slot 17; Ethereum `AccessControlledOCR2Aggregator 0x7d4E7420…` → `s_hotVars` slot 11, `s_transmissions` slot 12. Its drawback: `updatedAt` is a fixed number, so after any time warp beyond `maxStaleness` the real `OraclePriceAdjuster.exec` reverts with `OraclePriceAdjusterOraclePriceStale` (measured) unless you re-patch.
- `OraclePriceAdjuster.sol:79` staleness = `block.timestamp <= updatedAt + maxStaleness`; `maxStaleness = 0` disables it. Verified against the *real* library code via a probe contract on both forks.
- Two gotchas that will bite a script: (1) on anvil `eth_call` runs with `block.timestamp` of the **latest mined block** (fork block ts until you mine — 1.9 h behind wall clock in our fork), and (2) `anvil_setStorageAt` values must be **exactly 32 bytes** (`0x0` → "odd number of digits", `0x00` → "invalid string length").
- Always point strategies at the **proxy** address. On Ethereum the aggregator's reads are access-controlled (`checkAccess`) and a contract reading it directly reverts `No access` (measured); `cast call --from <router>` does *not* show this because `tx.origin == from` in `eth_call`.

## 1. Feed anatomy and verified storage layouts

### 1.1 Proxy → aggregator (both `EACAggregatorProxy`, solc 0.6.6, optimizer 1,000,000, istanbul)

| | Base ETH/USD | Ethereum ETH/USD |
|---|---|---|
| Proxy | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` |
| `aggregator()` (sel `0x245a7bfc`) | `0x05c84a58FE042275b37db038bAAcD15F410c7bB0` | `0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5` |
| `phaseId()` | 7 | 3 |
| `typeAndVersion()` of aggregator | `"DualAggregator 1.0.0"` (solc 0.8.24, runs 1,000,000, cancun; Blockscout "verified", not "fully verified") | `"AccessControlledOCR2Aggregator 1.0.0"` (solc 0.8.19, runs 10,000, paris; fully verified) |
| `decimals()` / `description()` / `version()` | 8 / `"ETH / USD"` / 6 | 8 / `"ETH / USD"` / 6 |
| proxy `owner()` | `0xf0Db7318A51a21C413CaDd4AbDC1E8a500fE5B1b` | `0x21f73D42Eb58Ba49dDB685dc29D3bF5c0f0373CA` |
| proxy `accessController()` | `0x0` (no access control on the proxy) | `0x0` |
| aggregator `minAnswer()/maxAnswer()` | 1 / 95780971304118053647396689196894323976171195136475135 (int192 max) | same |
| Verified source pulled from | `https://base.blockscout.com/api/v2/smart-contracts/<addr>` | `https://eth.blockscout.com/api/v2/smart-contracts/<addr>` |

Proxy `roundId = phaseId << 64 | aggregatorRoundId` (`AggregatorProxy.addPhase`, `PHASE_OFFSET = 64`): Base `55340232221128656536 = 3<<64 | 1688`; Ethereum `129127208515966894655 = 7<<64 | 33343`.

**Proxy storage** (`Owned` → `AggregatorProxy` → `EACAggregatorProxy`, read with `cast storage <proxy> <slot>`):

| slot | field | Base value at probe |
|---|---|---|
| 0 | `address payable owner` | `0x…f0db7318a51a21c413cadd4abdc1e8a500fe5b1b` |
| 1 | `address pendingOwner` | 0 |
| 2 | `Phase currentPhase {uint16 id; address aggregator}` packed: low 2 bytes = phaseId, next 20 bytes = aggregator | `0x…7d4e742018fb52e48b08be73d041c18b21de6fb5 0007` on Ethereum, `0x…05c84a58fe042275b37db038baacd15f410c7bb0 0003` on Base |
| 3 | `proposedAggregator` | 0 |
| 4 | `mapping(uint16 => aggregator) phaseAggregators` base | 0 |
| 5 | `accessController` | 0 |

Slot 0 and 2 are non-zero → **they must be overwritten after `anvil_setCode` (Method B)**, otherwise the mock reads the owner address as the price (measured: `1.375e48`).

### 1.2 Aggregator storage (from `forge inspect <C> storage-layout` on the verified source, then confirmed with `cast storage`)

**Base `DualAggregator`** (`src/DualAggregator.sol`, `contract DualAggregator is OCR2Abstract, AggregatorV2V3Interface, SimpleReadAccessController`):

| slot | field |
|---|---|
| 0 | `s_owner` |
| 1 | `s_pendingOwner` (20 B) + `checkEnabled` (offset 20) |
| 2 | `s_accessList` mapping |
| 3–6 | `s_transmitters`, `s_signers`, `s_signersList`, `s_transmittersList` |
| 7–10 | `uint32[31] s_rewardFromAggregatorRoundId` |
| 11 | `s_latestConfigDigest` |
| 12 | `uint24 s_accountingGas` |
| **13** | **`HotVars s_hotVars`** |
| 14 | `s_configCount` (4 B) + `s_latestConfigBlockNumber` (offset 4) |
| 15 | `s_validatorConfig` |
| 16 | `s_requesterAccessController` |
| **17** | **`mapping(uint32 => Transmission) s_transmissions`** |
| 18 | `uint32 s_cutoffTime` = **10** (seconds; constructor arg `cutoffTime_ = 10`, `maxSyncIterations_ = 20`, `secondaryProxy_ = 0x71041ddd…bb70` — the proxy itself) |
| 19 | `string s_description` (`"ETH / USD"`, short-string encoding) |
| 20–23 | `s_linkToken`, `s_billingAccessController`, `s_payees`, `s_proposedPayees` |

**Ethereum `AccessControlledOCR2Aggregator`** (`src/AccessControlledOCR2Aggregator.sol` → `OCR2Aggregator.sol`):

| slot | field |
|---|---|
| 0 / 1 | `s_owner` / `s_pendingOwner` |
| 2–5 | `s_transmitters`, `s_signers`, `s_signersList`, `s_transmittersList` |
| 6–9 | `uint32[31] s_rewardFromAggregatorRoundId` |
| 10 | `s_latestConfigDigest` |
| **11** | **`HotVars s_hotVars`** |
| **12** | **`mapping(uint32 => Transmission) s_transmissions`** |
| 13 | `s_configCount` + `s_latestConfigBlockNumber` |
| 14–20 | `s_validatorConfig`, `s_requesterAccessController`, `s_description`, `s_linkToken`, `s_billingAccessController`, `s_payees`, `s_proposedPayees` |
| 21 / 22 | `checkEnabled` (= true) / `accessList` |

**Structs (both contracts, identical prefix):**
```solidity
struct HotVars {            // one slot, packed from the LOW byte upward
  uint8  f;                       // byte 0
  uint40 latestEpochAndRound;     // bytes 1..5  (epoch << 8 | round)
  uint32 latestAggregatorRoundId; // bytes 6..9  <-- the round latestRoundData() reads
  // Base DualAggregator continues: uint32 latestSecondaryRoundId (bytes 10..13), 4×uint32 gas/payment fields, bool isLatestSecondary (byte 30)
  // ETH OCR2Aggregator continues:  4×uint32 gas/payment fields, uint24 accountingGas
}
struct Transmission {       // one slot: [recordedTs uint32 | observationsTs uint32 | answer int192]  (answer = low 24 bytes)
  int192 answer;
  uint32 observationsTimestamp;                   // returned as startedAt
  uint32 recordedTimestamp; /* ETH: transmissionTimestamp */  // returned as updatedAt
}
```
Slot of round `r`: `keccak256(abi.encode(uint32(r), uint256(<mappingSlot>)))` = `cast index uint32 <r> <17|12>`.

Verified decode (live RPC, `verify_slots.sh`): Base `hotVars = 0x…069d0000069e0000020d0203` → `f=3`, `latestAggregatorRoundId=0x069e=1694`, `latestSecondaryRoundId=0x069d=1693`; `s_transmissions[1692]` at `0x3bd1ab41…9e12` = `0x6a9c91b5 6a9c91a7 …0039f88a4e48` → `recordedTs=1788645813`, `obsTs=1788645799`, `answer=248982949448` — matches `latestRoundData()` for that round exactly. Ethereum `hotVars = 0x…823f00005d65030a` → `f=10`, `round=0x823f=33343`; `s_transmissions[33342]` = `0x6a9c8d2b 6a9c8cd9 …003a07d7c310` → `1788644651 / 1788644569 / 249239683856` ✓.

### 1.3 How reads reach storage (matters for Method A)

- Ethereum `OCR2Aggregator.latestRoundData()` (`OCR2Aggregator.sol:962`): `s_transmissions[s_hotVars.latestAggregatorRoundId]` → straightforward.
- Base `DualAggregator.latestRoundData()` (`DualAggregator.sol:1072`) goes through `_getLatestRound()`: **if `msg.sender == i_secondaryProxy` (= the ETH/USD proxy!)** it returns `latestSecondaryRoundId` unless that round is older than `s_cutoffTime` (10 s), in which case `_getSyncPrimaryRound()` walks down from `latestAggregatorRoundId` and returns the first round with `recordedTimestamp + 10 < block.timestamp`. Consequence: **a patched transmission whose `recordedTimestamp` is within 10 s of (or later than) `block.timestamp` is invisible through the proxy** (measured: proxy returned the previous round 1687 until a block was mined past `T+10`). Use `T = latestBlockTs - 60`.
- Access: Ethereum's aggregator has `checkAccess()` on `latestRoundData/latestAnswer/latestTimestamp/latestRound/getAnswer/getTimestamp/getRoundData/description…` (`AccessControlledOCR2Aggregator.sol:56-143`); `hasAccess = accessList[user] || !checkEnabled || user == tx.origin` (`SimpleReadAccessController`). The **Base `DualAggregator` never applies `checkAccess`** (grep: 0 hits) — a contract can read it directly. Do not rely on that; point at the proxy.

## 2. Method A — patch the real aggregator with `anvil_setStorageAt`

Exact, measured recipe (Base; swap the three constants for Ethereum):
```bash
export ETH_RPC_URL=http://127.0.0.1:8545
PROXY=0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70
AGG=0x05c84a58FE042275b37db038bAAcD15F410c7bB0; HOT=13; TRS=17        # Ethereum: AGG=0x7d4E742018fb52E48b08BE73d041C18B21de6Fb5 HOT=11 TRS=12
HV=$(cast storage $AGG $HOT)
R=$(python3 -c "print((int('$HV',16)>>48)&0xffffffff)")               # HotVars.latestAggregatorRoundId (bytes 6..9)
SLOT=$(cast index uint32 $R $TRS)                                     # keccak256(pad32(R) ++ pad32(TRS))
T=$(( $(cast block latest -f timestamp) - 60 ))                       # must satisfy T+10 < block.timestamp on Base (cutoffTime)
PRICE=300000000000                                                    # $3,000.00 (8 dec)
VAL=$(python3 -c "print(hex(($T<<224)|($T<<192)|$PRICE))")            # [recordedTs][obsTs][answer int192]; negative answers need 2's complement in 192 bits
cast rpc anvil_setStorageAt $AGG $SLOT $VAL
cast call $PROXY 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'   # -> 55340232221128656536 300000000000 T T 55340232221128656536  (immediately, no mine)
```
Measured results: Base (`base_exp2.sh §B`) `300000000000 1788641287 1788641287` visible through the proxy at once; Ethereum (`eth_exp.sh §1`, `T = latest-1`) likewise; `latestAnswer()` follows. Round id is unchanged (we edit the latest round in place; bumping `latestAggregatorRoundId` in `s_hotVars` bytes 6..9 plus writing a new slot also works but is not needed — UNCERTAIN, not measured).

Limits: `updatedAt` is frozen at `T`. After `evm_increaseTime(7200); anvil_mine` the real `OraclePriceAdjuster.exec` with `maxStaleness=3600` reverted with
`0x92ae244d 0…6a9c9cdf 0…6a9c8082 0…0e10` = `OraclePriceAdjusterOraclePriceStale(currentTime=1788648671, updatedAt=1788641410, maxStaleness=3600)` (measured, `base_exp.sh §4`). So with Method A every time warp must be followed by a re-patch with a fresh `T`. Chainlink's real updater cannot run on the fork, so nothing else will refresh it. Prefer Method B for the demo.

## 3. Method B (recommended) — `MockAggregatorV3` at the proxy address

### 3.1 Contract
Source: `work/oracle/probe_proj/src/MockAggregatorV3.sol` (copy it into the project). Build settings used: solc 0.8.30, `via_ir = true`, `optimizer_runs = 700`, `evm_version = cancun` (same profile as the router); runtime **1,562 bytes**, no constructor, no immutables (required for `anvil_setCode`). Runtime hex: `…/work/oracle/MockAggregatorV3.runtime.hex`; regenerate with `forge build && jq -r .deployedBytecode.object out/MockAggregatorV3.sol/MockAggregatorV3.json`.

```solidity
contract MockAggregatorV3 {                 // fixed layout, one full slot per field, nothing packs
    int256  internal s_answer;      // slot 0  price (8 dec for */USD)
    uint256 internal s_updatedAt;   // slot 1  0 => latestRoundData returns block.timestamp  (never stale)
    uint256 internal s_startedAt;   // slot 2  0 => = updatedAt
    uint256 internal s_roundId;     // slot 3  0 => 1
    uint256 internal s_decimals;    // slot 4  0 => 8
    uint256 internal s_version;     // slot 5  0 => 6
    bytes32 internal s_description; // slot 6  0 => "MOCK / USD" (short string, left-aligned)
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt); // same topic as Chainlink: 0x0559884f…fc5f
    function setAnswer(int256 answer, uint256 updatedAt) external;   // sel 0x860f1383, permissionless, roundId++, emits AnswerUpdated
    function setDecimals(uint8) external; function setDescription(bytes32) external;
    // AggregatorV3: decimals() version() description() latestRoundData() getRoundData(uint80)
    // AggregatorV2: latestAnswer() latestTimestamp() latestRound() getAnswer(uint256) getTimestamp(uint256)
    // EACAggregatorProxy extras: aggregator() (=this) phaseId() (=1) proposedAggregator() accessController() typeAndVersion()
}
```
`latestRoundData()` returns `(roundId, s_answer, startedAt, updatedAt, roundId)` with `updatedAt = s_updatedAt == 0 ? block.timestamp : s_updatedAt`.

### 3.2 Exact commands (measured, `base_exp.sh §5-8`, `eth_exp.sh §3`)
```bash
export ETH_RPC_URL=http://127.0.0.1:8545; PROXY=0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70
cast rpc anvil_setCode $PROXY $(cat MockAggregatorV3.runtime.hex)          # code only; proxy storage slots 0..5 persist!
cast rpc anvil_setStorageAt $PROXY 0x0 $(cast --to-uint256 250000000000)     # answer  $2,500.00
cast rpc anvil_setStorageAt $PROXY 0x1 $(cast --to-uint256 0)               # updatedAt 0 => block.timestamp
cast rpc anvil_setStorageAt $PROXY 0x2 $(cast --to-uint256 0)               # startedAt (was the packed Phase — MUST be cleared)
cast rpc anvil_setStorageAt $PROXY 0x3 $(cast --to-uint256 1)               # roundId
cast rpc anvil_setStorageAt $PROXY 0x4 $(cast --to-uint256 8)               # decimals
cast rpc anvil_setStorageAt $PROXY 0x5 $(cast --to-uint256 6)               # version
cast rpc anvil_setStorageAt $PROXY 0x6 $(cast --format-bytes32-string "ETH / USD")
cast call $PROXY 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'   # 1 250000000000 <blockTs> <blockTs> 1
# later price moves: either
cast rpc anvil_setStorageAt $PROXY 0x0 $(cast --to-uint256 310000000000)     # instant, no tx
# or a real tx (any EOA; 38,015 gas; emits AnswerUpdated) — nice for the UI's event feed:
cast send $PROXY 'setAnswer(int256,uint256)' 260000000000 0 --private-key $PK
```
Measured after install: `decimals=8 description="ETH / USD" version=6 aggregator()=<proxy> phaseId=1 latestAnswer=310000000000`; after `evm_increaseTime 86400; anvil_mine` → `updatedAt = 1788735072 = new block ts`; after +864000 s still fresh. Negative/zero answers: `int256` two's complement via `cast --to-uint256` won't do negatives — use `hex32()` from the TS helper; `OraclePriceAdjuster` reverts on negative anyway (`SafeCast.toUint256`).

Persistence / reset semantics (measured): `anvil_dumpState` **includes** the overridden code (3,126 hex chars) and slots 0-6 → `anvil --load-state` restores the mock (32,676-byte dump on a fresh fork). `evm_snapshot`/`evm_revert` **undoes `anvil_setCode`** (proxy code back to 19,145 hex chars). `anvil_reset` re-forks and drops it (standard).

`anvil_setStorageAt` argument rules (measured): slot may be short (`0x0`) or 32-byte; **value must be exactly 32 bytes** (`0x0` → `-32602 odd number of digits`, `0x00` → `-32602 invalid string length`). `anvil_setCode` takes the runtime hex with `0x`. Both take effect for the next `eth_call` immediately (no `anvil_mine`).

### 3.3 TS helper (20 lines, zero deps, runs in Node 22 *and* the browser against `http://127.0.0.1:8545`)
File: `…/work/oracle/ts/oracle-mock.mts` (verified: `node oracle-mock.mts 250000000000` → round 1; `260000000000` → round 2; `270000000000 1788641000` → explicit `updatedAt`). Anvil's default CORS `--allow-origin` is `*` (UNCERTAIN: not re-checked on this build), so a Next.js page can call it directly.
```ts
export const MOCK_RUNTIME = '0x6080…'   // paste MockAggregatorV3.runtime.hex (1,562 bytes)
const hex32 = (n: bigint) => '0x' + (n & ((1n << 256n) - 1n)).toString(16).padStart(64, '0') // exactly 32 bytes, 2's complement
export async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`); return j.result
}
/** price8dec e.g. 2500_00000000n; updatedAt 0n = "always block.timestamp" (never stale). Returns new roundId. */
export async function setOraclePrice(price8dec: bigint, updatedAt = 0n, feed = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', url = 'http://127.0.0.1:8545') {
  if ((await rpc(url, 'eth_getCode', [feed, 'latest'])) !== MOCK_RUNTIME) {          // first call: swap code, wipe old proxy slots
    await rpc(url, 'anvil_setCode', [feed, MOCK_RUNTIME])
    const desc = '0x' + [...new TextEncoder().encode('ETH / USD')].map(b => b.toString(16).padStart(2, '0')).join('').padEnd(64, '0')
    for (const [s, v] of [[2n, hex32(0n)], [3n, hex32(0n)], [4n, hex32(8n)], [5n, hex32(6n)], [6n, desc]] as const) await rpc(url, 'anvil_setStorageAt', [feed, hex32(s), v])
  }
  const round = BigInt(await rpc(url, 'eth_getStorageAt', [feed, hex32(3n), 'latest'])) + 1n
  await rpc(url, 'anvil_setStorageAt', [feed, hex32(0n), hex32(price8dec)])
  await rpc(url, 'anvil_setStorageAt', [feed, hex32(1n), hex32(updatedAt)])
  await rpc(url, 'anvil_setStorageAt', [feed, hex32(3n), hex32(round)])
  return round
}
```
viem equivalent: `const tc = createTestClient({ mode: 'anvil', chain: anvil, transport: http() }); await tc.setCode({ address: feed, bytecode: MOCK_RUNTIME }); await tc.setStorageAt({ address: feed, index: 0, value: hex32(price) })` (not executed here — UNCERTAIN only in that sense; the underlying RPC calls are the same).

Method A in TS (`…/ts/chainlink-storage.mts`, verified with ethers v5.8.0 from `refs/swap-vm/node_modules`; viem: `keccak256(encodeAbiParameters([{type:'uint32'},{type:'uint256'}],[round, slot]))`):
```ts
const hot = BigInt(await rpc(url, 'eth_getStorageAt', [aggregator, hex32(hotVarsSlot), 'latest']))
const round = Number((hot >> 48n) & 0xffffffffn)
const slot = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['uint32', 'uint256'], [round, transmissionsSlot]))
const t = BigInt((await rpc(url, 'eth_getBlockByNumber', ['latest', false])).timestamp) - 60n
await rpc(url, 'anvil_setStorageAt', [aggregator, slot, hex32((t << 224n) | (t << 192n) | (price8dec & ((1n << 192n) - 1n)))])
```
(`node chainlink-storage.mts 0x05c84a58… 13 17 305000000000` → proxy returned `305000000000`, measured.)

## 4. `OraclePriceAdjuster` staleness — verified against the real library

Probe: `…/work/oracle/probe_proj/src/OraclePriceAdjusterProbe.sol` calls the unmodified `swap-vm/src/instructions/OraclePriceAdjuster.sol` `exec` (`internal view`, lines 70-117) with a synthetic `Context` and returns `(amountIn, amountOut, block.timestamp)`. Installed on the forks via `anvil_setCode` at `0x1000000000000000000000000000000000000001` (no tx, no block). Instruction bytes it builds for `(maxPriceDecay=0.9e18, maxStaleness=3600, decimals=8, proxy)`: `0xb2 1f 0c7d713b49da0000 0e10 08 71041dddad3595f9ced3dccfbe3d1f4b0a16bb70` (opcode `0xb2`, 31 arg bytes).

| Scenario (Base fork) | `maxStaleness` | Result |
|---|---|---|
| real feed code, Method A-patched to $3,000 (`T = latestTs-60`), fresh fork (`block.timestamp` = fork ts 1788641347) | 3600 | OK, `amountIn 1e18, amountOut 2.9e21 → 2.999e21` (ratio 3000/2900 = 1.0345 < the 1.1 cap; `base_exp2.sh §B`) |
| unpatched real feed on the fresh fork (answer 2480.53, `updatedAt` 1788641221, 126 s before fork ts) | 3600 | OK; would start reverting once `block.timestamp > 1788641221 + 3600`, i.e. after the first block mined ≥ 1 h of (fork-relative) time — anvil's pending ts already runs at fork ts + elapsed |
| real feed after `evm_increaseTime 7200; anvil_mine` | 3600 | **revert** `OraclePriceAdjusterOraclePriceStale(1788648671, 1788641410, 3600)` sel `0x92ae244d` |
| same | 0 | OK (check skipped, `OraclePriceAdjuster.sol:79`) |
| mock (`updatedAt=0`) right after install | 3600 | OK, `2.9e21 → 3.0999e21` at $3,100 |
| mock after +86,400 s and again after +864,000 s | 3600 / 60 | OK (`updatedAt == block.timestamp`) |
| mock, `amountIn=1e18, amountOut=2400e6` (WETH→USDC raw units) | 3600 | `2400e6 → 2640e6` — hits the `2e18 - maxPriceDecay = 1.1e18` cap because `currentPrice = 2.4e9` (raw units) ≪ `oraclePrice = 3.1e21`; see `swapvm-instructions.md §3.12` — the feed must be "tokenOut per tokenIn in raw units", a USD feed is not that |
| Ethereum fork, mock, after +100,000 s | 3600 | OK |
| Ethereum fork, probe → **aggregator** `0x7d4E…` directly | 3600 | **revert `No access`** (`Error(string)`, `0x08c379a0…`) |
| Ethereum fork, probe → **proxy** | 3600 | OK |
| `cast call 0x7d4E… latestRoundData --from 0x111111338c…` (router as `from`) | – | passes — `eth_call` sets `tx.origin = from`, so this test is meaningless; only a nested call shows the revert |

Timing semantics measured on anvil (fork mode): right after start, `latest` block ts = fork block ts (1788641347, 1.9 h old), `pending` ts = fork ts + seconds since anvil started (+1 s at start, +123 s two minutes later); **`eth_call`/`cast call` execute with `block.timestamp` of the latest mined block**, so `evm_increaseTime` needs `anvil_mine` (or any tx) before quotes see the new time. With Method B this never matters for staleness because both sides of the comparison are the same `block.timestamp`.

## 5. Demo recipe (script or UI)

1. Start the fork per `fork-stack.md §4` (Base, `--chain-id 31337`). Deploy your router, ship the oracle-anchored strategy pointing at `0x71041ddd…bb70` (the proxy), e.g. `OraclePriceAdjuster.build(0.9e18, 3600, 8, 0x71041ddd…)` or the custom `XYCConcentrateOracle` opcode from `position-catalog.md`.
2. `setOraclePrice(2480_00000000n)` once — this installs the mock at the proxy address; the strategy's quote is unchanged (same price as the real feed). Optionally take `evm_snapshot` **after** this step (`evm_revert` would otherwise remove the mock) and `anvil_dumpState` for `--load-state` reproducibility.
3. Move the price from the UI slider / script: `setOraclePrice(2600_00000000n)` (instant) or `setAnswer(2600e8, 0)` tx (shows an `AnswerUpdated` log, 38k gas). Re-quote via `SwapVM.quote` → the curve follows; run the taker `swap()` → ERC-20 `Transfer` logs prove on-chain execution (judging requirement 2).
4. Time-based demos (`Decay`, TWAP, staleness itself): `evm_increaseTime N; anvil_mine` — the mock stays fresh; to *show* the staleness guard, call `setOraclePrice(p, BigInt(latestTs) - 4000n)` (explicit old `updatedAt`) and watch the quote revert with `0x92ae244d`, then `setOraclePrice(p, 0n)` to recover.
5. Reset: `evm_revert` to the snapshot from step 2, or `anvil_reset` + rerun steps 1-2 (`--load-state` is faster).

Pitfalls: (a) never call `evm_revert` to a snapshot taken before the `setCode` unless you re-install; (b) `anvil_setStorageAt` values must be 66-char hex; (c) after `anvil_setCode` the proxy's old slot 0 (owner) and slot 2 (phase) are garbage for the mock — the helper clears 2-6 and writes 0/1/3 every call; (d) if a judge asks "is this the real feed?" — the *address* is real and untouched in every ABI/SDK path, only the fork's code at that address is swapped; say so; (e) Method A on Base needs `T ≤ latestBlockTs − 11` (cutoffTime 10 s); (f) Chainlink's `AnswerUpdated` topic is identical for the mock, so an event-driven UI works with both real and mocked feeds.

## 6. Files

- Experiments and raw outputs: `…/scratchpad/work/oracle/{base_exp.sh,base_exp2.sh,eth_exp.sh,verify_slots.sh,probe_feeds.sh,probe_aggr2.sh,fetch_src.sh}`; verified sources `src_base_aggr.sol` (DualAggregator), `src_eth_aggr__src__OCR2Aggregator.sol`, `src_base_proxy*.sol` (EACAggregatorProxy); `inspect_base.out`, `inspect_eth.out` (`forge inspect` layouts, compiled with the verified settings in `inspect_proj/`, `inspect_eth/`).
- Deliverables: `probe_proj/src/MockAggregatorV3.sol`, `probe_proj/src/OraclePriceAdjusterProbe.sol`, `probe_proj/foundry.toml` (remaps `swap-vm/` and `@openzeppelin/` to the local clone), `MockAggregatorV3.runtime.hex`, `OraclePriceAdjusterProbe.runtime.hex`, `ts/oracle-mock.mts`, `ts/chainlink-storage.mts`.

## 7. UNCERTAIN / not measured

- Bumping `latestAggregatorRoundId` in `s_hotVars` (Method A with a new round) — layout known, not executed.
- viem `createTestClient` wrappers — same RPC methods, not executed here.
- Anvil CORS default (`--allow-origin *`) for direct browser calls — from anvil docs, not re-tested on this build.
- Other feeds (BTC/USD `0x64c9…848F`, cbBTC/USD `0x07DA…f9D`, USDC/USD `0x7e86…bc6B`) are also `EACAggregatorProxy`s (same 8-dec ABI per `fork-stack.md §9`) so Method B applies unchanged; their aggregators' layouts (Method A) were not inspected — DualAggregator vs OCR2 differs per feed.
