/**
 * JSON-RPC relay for the hosted demo.
 *
 * The live site is served over HTTPS and the demo chain is a plain-HTTP anvil on a VM, which a
 * browser refuses to call from an HTTPS page. This forwards POSTed JSON-RPC to `RPC_UPSTREAM` and
 * refuses the `anvil_*` / `evm_*` / `hardhat_*` cheatcodes, so a visitor can read and transact but
 * cannot rewrite the chain. Unset `RPC_UPSTREAM` and the route answers 404; local dev never uses it.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BLOCKED = /^(anvil_|evm_|hardhat_|debug_|tenderly_)/;

type RpcCall = { method?: unknown; id?: unknown };

function refused(call: RpcCall) {
  return { jsonrpc: '2.0', id: call.id ?? null, error: { code: -32601, message: 'method not allowed on the public demo' } };
}

export async function POST(request: Request) {
  const upstream = process.env.RPC_UPSTREAM;
  if (!upstream) return NextResponse.json({ error: 'not configured' }, { status: 404 });

  let body: RpcCall | RpcCall[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, { status: 400 });
  }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.some((c) => typeof c.method !== 'string' || BLOCKED.test(c.method))) {
    return NextResponse.json(Array.isArray(body) ? calls.map(refused) : refused(body));
  }

  const res = await fetch(upstream, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
