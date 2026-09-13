/**
 * The public demo relay's policy, kept pure so it can be tested without a network.
 *
 * The hosted anvil runs with `--auto-impersonate`, so any method that lets the node sign on
 * someone's behalf (`eth_sendTransaction`) or rewrite state (`anvil_*`, `evm_*`) would let a visitor
 * move anyone's tokens. An allowlist is the only safe shape: reads, and broadcasting a transaction
 * the visitor already signed.
 */

export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getLogs',
  'eth_sendRawTransaction',
  'eth_syncing',
  'net_version',
  'web3_clientVersion',
]);

export const MAX_BATCH = 100;
export const MAX_BODY_BYTES = 1_000_000;

export type RpcCall = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
export type RpcError = { jsonrpc: '2.0'; id: unknown; error: { code: number; message: string } };

export function rpcError(id: unknown, code: number, message: string): RpcError {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export function isAllowed(call: unknown): call is RpcCall & { method: string } {
  return (
    typeof call === 'object' &&
    call !== null &&
    !Array.isArray(call) &&
    typeof (call as RpcCall).method === 'string' &&
    ALLOWED_METHODS.has((call as RpcCall).method as string)
  );
}

export type Plan =
  | { kind: 'reject'; status: number; body: RpcError }
  | { kind: 'forward'; batch: boolean; forward: RpcCall[]; refused: RpcError[] };

/**
 * Decide what to do with a parsed request body. A batch forwards only its allowed calls and answers
 * the rest locally, so one refused method never takes a page's other reads down with it.
 */
export function plan(body: unknown): Plan {
  if (Array.isArray(body)) {
    if (body.length === 0) return { kind: 'reject', status: 400, body: rpcError(null, -32600, 'empty batch') };
    if (body.length > MAX_BATCH) return { kind: 'reject', status: 400, body: rpcError(null, -32600, 'batch too large') };
    const forward: RpcCall[] = [];
    const refused: RpcError[] = [];
    for (const call of body) {
      if (isAllowed(call)) forward.push(call);
      else refused.push(refusal(call));
    }
    return { kind: 'forward', batch: true, forward, refused };
  }
  if (typeof body !== 'object' || body === null) {
    return { kind: 'reject', status: 400, body: rpcError(null, -32600, 'invalid request') };
  }
  if (!isAllowed(body)) return { kind: 'reject', status: 200, body: refusal(body) };
  return { kind: 'forward', batch: false, forward: [body], refused: [] };
}

function refusal(call: unknown): RpcError {
  const id = typeof call === 'object' && call !== null ? (call as RpcCall).id : null;
  return rpcError(id, -32601, 'method not allowed on the public demo');
}
