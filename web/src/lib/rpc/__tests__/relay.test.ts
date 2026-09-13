import { describe, expect, it } from 'vitest';
import { MAX_BATCH, isAllowed, plan } from '../relay';

describe('public demo relay policy', () => {
  it('allows reads and raw broadcasts', () => {
    for (const method of ['eth_call', 'eth_getLogs', 'eth_blockNumber', 'eth_sendRawTransaction']) {
      expect(isAllowed({ jsonrpc: '2.0', id: 1, method })).toBe(true);
    }
  });

  it('refuses anything that signs for someone else or rewrites state', () => {
    for (const method of [
      'eth_sendTransaction',
      'eth_sign',
      'eth_accounts',
      'anvil_setBalance',
      'ANVIL_setBalance',
      'evm_snapshot',
      'hardhat_impersonateAccount',
      'wallet_switchEthereumChain',
    ]) {
      expect(isAllowed({ id: 1, method })).toBe(false);
    }
  });

  it('rejects null, primitives and empty or oversized batches without throwing', () => {
    expect(plan(null)).toMatchObject({ kind: 'reject', status: 400 });
    expect(plan(42)).toMatchObject({ kind: 'reject', status: 400 });
    expect(plan([])).toMatchObject({ kind: 'reject', status: 400 });
    const big = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ id: i, method: 'eth_chainId' }));
    expect(plan(big)).toMatchObject({ kind: 'reject', status: 400 });
  });

  it('answers a refused single call locally', () => {
    const p = plan({ id: 7, method: 'eth_sendTransaction' });
    expect(p).toMatchObject({ kind: 'reject', status: 200, body: { id: 7, error: { code: -32601 } } });
  });

  it('splits a mixed batch: forwards the allowed calls, refuses the rest by id', () => {
    const p = plan([
      { id: 1, method: 'eth_call' },
      { id: 2, method: 'eth_sendTransaction' },
      { id: 3, method: 'eth_getLogs' },
      null,
    ]);
    expect(p.kind).toBe('forward');
    if (p.kind !== 'forward') return;
    expect(p.forward.map((c) => c.id)).toEqual([1, 3]);
    expect(p.refused.map((r) => r.id)).toEqual([2, null]);
  });
});
