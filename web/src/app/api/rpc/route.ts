/**
 * JSON-RPC relay for the hosted demo.
 *
 * The live site is served over HTTPS and the demo chain is a plain-HTTP anvil on a VM, which a
 * browser refuses to call from an HTTPS page. This forwards POSTed JSON-RPC to `RPC_UPSTREAM`, but
 * only the read methods and `eth_sendRawTransaction` (see `lib/rpc/relay.ts`), so a visitor can read
 * and broadcast their own signed transactions but cannot sign as anyone else or rewrite the chain.
 * Unset `RPC_UPSTREAM` and the route answers 404; local dev never uses it.
 */
import { NextResponse } from 'next/server';
import { MAX_BODY_BYTES, plan, rpcError } from '@/lib/rpc/relay';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const upstream = process.env.RPC_UPSTREAM;
  if (!upstream) return NextResponse.json({ error: 'not configured' }, { status: 404 });

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json(rpcError(null, -32600, 'request too large'), { status: 413 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json(rpcError(null, -32600, 'request too large'), { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'parse error'), { status: 400 });
  }

  const decision = plan(body);
  if (decision.kind === 'reject') return NextResponse.json(decision.body, { status: decision.status });

  if (decision.forward.length === 0) return NextResponse.json(decision.refused);

  const res = await fetch(upstream, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(decision.batch ? decision.forward : decision.forward[0]),
    cache: 'no-store',
  });
  const text = await res.text();

  if (!decision.batch || decision.refused.length === 0) {
    return new NextResponse(text, { status: res.status, headers: { 'content-type': 'application/json' } });
  }

  let answered: unknown;
  try {
    answered = JSON.parse(text);
  } catch {
    return new NextResponse(text, { status: res.status, headers: { 'content-type': 'application/json' } });
  }
  const merged = Array.isArray(answered) ? [...answered, ...decision.refused] : [answered, ...decision.refused];
  return NextResponse.json(merged, { status: res.status });
}
