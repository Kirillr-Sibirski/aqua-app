import { useCallback, useState } from 'react';
import type { Hex, TransactionReceipt } from 'viem';
import { useConfig } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { explainError, type ErrorArgFormatter } from '@/lib/ui';

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

/**
 * One line for a viem or wallet error, with the decoded custom error preferred over viem's own
 * summary of it.
 *
 * `err.shortMessage` is what this used to return, and for a reverted call viem sets it to the
 * generic *The contract function "swap" reverted.* — which names neither the guard that refused nor
 * the numbers it refused with. `NotCovered(needed, free)` and `RmmInsideSpread(shortfall)` carry
 * both, and carrying both is the entire reason the errors ABI is attached to these calls, so a
 * publish, a take, a roll or a withdrawal that refuses now says which guard refused it and at what
 * size. `explainError` walks the `cause` chain to find that decode and falls back to the short
 * message when there is none.
 */
export function errorMessage(e: unknown, formatArg?: ErrorArgFormatter): string {
  return explainError(e, formatArg);
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

  /**
   * `formatArg` is how a caller denominates the numbers a refusal carries. Only the screen that
   * built the plan knows which token `NotCovered(needed, free)` is counting, so it passes a
   * formatter rather than this hook guessing at decimals; without one the exact integers are
   * printed, which is still the guard's own measurement.
   */
  const run = useCallback(
    async (plan: TxPlanStep[], formatArg?: ErrorArgFormatter): Promise<TxStep[]> => {
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
            const msg = errorMessage(e, formatArg);
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
        setError(errorMessage(e, formatArg));
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

/**
 * "0 tokens will move."
 *
 * `ship` and `dock` write storage and emit events; neither performs a transfer or a balance check.
 * That is the claim this whole product rests on, and after the transactions land it is checked
 * rather than repeated: every receipt's logs are scanned for the ERC-20 `Transfer` topic and the
 * count is shown. A publish or a roll that moved tokens would say so.
 */
export const ERC20_TRANSFER_TOPIC: Hex =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export function countTransferLogs(steps: readonly TxStep[]): number | undefined {
  const mined = steps.filter((s) => s.receipt);
  if (mined.length === 0) return undefined;
  return mined.reduce(
    (sum, step) =>
      sum + (step.receipt?.logs.filter((log) => log.topics[0] === ERC20_TRANSFER_TOPIC).length ?? 0),
    0,
  );
}
