import { useCallback, useState } from 'react';
import type { Hex, TransactionReceipt } from 'viem';
import { useConfig } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { aquaFork, type SupportedChainId } from '@/lib/chain';

export type TxStepStatus = 'idle' | 'signing' | 'pending' | 'success' | 'reverted' | 'error' | 'skipped';

export interface TxStep {
  id: string;
  label: string;
  status: TxStepStatus;
  hash?: Hex;
  receipt?: TransactionReceipt;
  error?: string;
}

export interface TxPlanStep {
  label: string;
  /** Send the transaction and return its hash; return `undefined` to skip the step (e.g. allowance already sufficient). */
  send: () => Promise<Hex | undefined>;
}

/** Best-effort short message for viem / wallet errors. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { shortMessage?: string; message?: string };
    if (err.shortMessage) return err.shortMessage;
    if (err.message) return err.message.split('\n')[0];
  }
  return String(e);
}

/**
 * Runs a sequence of transactions (approve → ship, approve → swap, ...) and tracks per-step state:
 * hash once sent, receipt status once mined. Stops at the first revert/error.
 */
export function useTxFlow(chainId: SupportedChainId = aquaFork.id) {
  const config = useConfig();
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const reset = useCallback(() => {
    setSteps([]);
    setError(undefined);
  }, []);

  const run = useCallback(
    async (plan: TxPlanStep[]): Promise<TxStep[]> => {
      setIsRunning(true);
      setError(undefined);
      const runId = Date.now();
      let current: TxStep[] = plan.map((p, i) => ({ id: `${runId}-${i}`, label: p.label, status: 'idle' }));
      setSteps(current);
      const update = (i: number, patch: Partial<TxStep>) => {
        current = current.map((s, j) => (j === i ? { ...s, ...patch } : s));
        setSteps(current);
      };
      try {
        for (let i = 0; i < plan.length; i++) {
          update(i, { status: 'signing' });
          let hash: Hex | undefined;
          try {
            hash = await plan[i].send();
          } catch (e) {
            const msg = errorMessage(e);
            update(i, { status: 'error', error: msg });
            throw new Error(`${plan[i].label}: ${msg}`);
          }
          if (!hash) {
            update(i, { status: 'skipped' });
            continue;
          }
          update(i, { status: 'pending', hash });
          const receipt = await waitForTransactionReceipt(config, { hash, chainId });
          const ok = receipt.status === 'success';
          update(i, { status: ok ? 'success' : 'reverted', receipt });
          if (!ok) throw new Error(`${plan[i].label}: transaction reverted (${hash})`);
        }
        return current;
      } catch (e) {
        setError(errorMessage(e));
        throw e;
      } finally {
        setIsRunning(false);
      }
    },
    [config, chainId],
  );

  return { steps, isRunning, error, run, reset };
}

export type UseTxFlowReturn = ReturnType<typeof useTxFlow>;
