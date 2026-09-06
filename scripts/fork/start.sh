#!/usr/bin/env bash
# Start a local anvil fork of Base mainnet (chain 8453) for the Aqua/SwapVM demo.
#
#   bash scripts/fork/start.sh            # foreground, automine, no state persistence
#   bash scripts/fork/start.sh --state    # persist/reload chain state in scripts/fork/.state (fixed router address across restarts)
#
# Environment overrides (all optional):
#   ANVIL_FORK_URL     upstream Base RPC (default: Tenderly public gateway, falls back to mainnet.base.org / base.drpc.org)
#   ANVIL_FORK_BLOCK   pinned fork block          (default: 50946000, see below)
#   ANVIL_CHAIN_ID     local chain id             (default: 31337 — keeps MetaMask nonces/permits separate from real Base)
#   ANVIL_PORT / ANVIL_HOST                        (default: 8545 / 127.0.0.1)
#   ANVIL_BLOCK_TIME   seconds per block; empty => automine one block per tx (best for demos)
#   ANVIL_HARDFORK     e.g. prague; empty => anvil default ("latest")
#   ANVIL_STATE_DIR    where --state persists      (default: scripts/fork/.state)
#   ANVIL_EXTRA_ARGS   appended verbatim
#
# PINNED FORK BLOCK: 50946000 (Base, 2026-09-05 ~20:35 UTC, timestamp 1788681347). Chosen ~1,000 blocks below the
# head observed on 2026-09-06 08:30 UTC (50947023). Whale balances verified at this block (see bootstrap.ts):
#   aBasWETH 0xD4a0…8bb7 = 10,194 WETH, Morpho 0xBBBB…FFCb = 219.2M USDC, aBascbBTC 0xBdb9…8EE6 = 2,626 cbBTC.
# Official Aqua 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a and router 0x111111338c5091e8440b67b168bae16a668ac0de
# have code at this block (they were deployed at 48839900 / 49151361).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FORK_BLOCK="${ANVIL_FORK_BLOCK:-50946000}"
CHAIN_ID="${ANVIL_CHAIN_ID:-31337}"
PORT="${ANVIL_PORT:-8545}"
HOST="${ANVIL_HOST:-127.0.0.1}"
BLOCK_TIME="${ANVIL_BLOCK_TIME:-}"
HARDFORK="${ANVIL_HARDFORK:-}"
STATE_DIR="${ANVIL_STATE_DIR:-$HERE/.state}"
USE_STATE=0

for arg in "$@"; do
  case "$arg" in
    --state) USE_STATE=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

command -v anvil >/dev/null || { echo "anvil not found — install foundry: https://getfoundry.sh" >&2; exit 1; }

# Pick the first upstream RPC that answers eth_chainId == 0x2105 (Base).
CANDIDATES=()
[ -n "${ANVIL_FORK_URL:-}" ] && CANDIDATES+=("$ANVIL_FORK_URL")
CANDIDATES+=(https://gateway.tenderly.co/public/base https://mainnet.base.org https://base.drpc.org)
FORK_URL=""
for url in "${CANDIDATES[@]}"; do
  id=$(curl -s -m 8 -X POST -H 'content-type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$url" 2>/dev/null \
        | sed -n 's/.*"result":"\(0x[0-9a-fA-F]*\)".*/\1/p') || true
  if [ "$id" = "0x2105" ]; then FORK_URL="$url"; break; fi
  echo "upstream $url unusable (chainId='${id:-none}'), trying next" >&2
done
[ -n "$FORK_URL" ] || { echo "no working Base RPC found (set ANVIL_FORK_URL)" >&2; exit 1; }

ARGS=(
  --fork-url "$FORK_URL"
  --fork-block-number "$FORK_BLOCK"
  --fork-chain-id 8453
  --chain-id "$CHAIN_ID"
  --auto-impersonate
  --no-rate-limit
  --host "$HOST"
  --port "$PORT"
  --retries 5
  --timeout 45000
  --accounts 10
  --balance 10000
)
[ -n "$BLOCK_TIME" ] && ARGS+=(--block-time "$BLOCK_TIME")
[ -n "$HARDFORK" ] && ARGS+=(--hardfork "$HARDFORK")
if [ "$USE_STATE" = 1 ]; then
  mkdir -p "$STATE_DIR"
  ARGS+=(--state "$STATE_DIR/anvil-state.json" --state-interval 15)
fi
# shellcheck disable=SC2206
[ -n "${ANVIL_EXTRA_ARGS:-}" ] && ARGS+=($ANVIL_EXTRA_ARGS)

RPC_URL="http://$HOST:$PORT"
cat >&2 <<EOF
anvil: Base fork @ block $FORK_BLOCK from $FORK_URL
       chain id $CHAIN_ID, ${BLOCK_TIME:+block time ${BLOCK_TIME}s}${BLOCK_TIME:-automine}, auto-impersonate on$( [ "$USE_STATE" = 1 ] && echo ", state: $STATE_DIR/anvil-state.json" )
RPC_URL=$RPC_URL
EOF
echo "$RPC_URL"

exec anvil "${ARGS[@]}"
