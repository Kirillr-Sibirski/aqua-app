'use client';

/**
 * The transaction plan, and what actually happened to it.
 *
 * `useTxFlow` runs a sequence and records per-step state: signing, pending, mined, reverted, or
 * skipped. Skipped is not a failure and is the common case here — the approve step reads the
 * allowance first and does nothing when it is already sufficient, so a maker shipping a second book
 * sees "already approved" rather than a redundant signature request.
 *
 * Hashes are shown as soon as they exist rather than after the receipt, because the ten seconds
 * between the two are exactly when someone wants to look the transaction up. On the fork there is
 * nowhere to look it up — the state exists on no upstream explorer — so the hash comes with a copy
 * button instead of a dead link.
 */
import { Check, CircleDashed, Minus, OctagonAlert } from 'lucide-react';
import type { Hex } from 'viem';
import { CopyButton, ExplorerLink, ICON_SIZE, ICON_STROKE, Pill, Spinner } from '@/components/ui';
import { explorerFor, isForkOfBase, txUrl } from '@/components/shell';
import { cn, truncateHash } from '@/lib/ui';
import type { TxStep, TxStepStatus } from '@/hooks';

export interface TxStepperProps {
  steps: readonly TxStep[];
  chainId?: number;
  /** Shown above the list while nothing has been attempted yet. */
  plan?: readonly string[];
  className?: string;
}

const LABEL: Record<TxStepStatus, string> = {
  idle: 'Queued',
  signing: 'Waiting for signature',
  pending: 'In the mempool',
  success: 'Mined',
  reverted: 'Reverted',
  error: 'Failed',
  skipped: 'Not needed',
};

const TONE: Record<TxStepStatus, 'neutral' | 'accent' | 'positive' | 'negative'> = {
  idle: 'neutral',
  signing: 'accent',
  pending: 'accent',
  success: 'positive',
  reverted: 'negative',
  error: 'negative',
  skipped: 'neutral',
};

export function TxStepper({ steps, chainId, plan, className }: TxStepperProps) {
  const explorer = explorerFor(chainId);
  const linkable = explorer && !isForkOfBase(chainId);

  if (steps.length === 0) {
    if (!plan || plan.length === 0) return null;
    return (
      <ol className={cn('flex flex-col', className)}>
        {plan.map((label, i) => (
          <li
            key={`${label}-${i}`}
            className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
          >
            <StatusGlyph status="idle" />
            <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{label}</span>
            <Pill tone="neutral" size="sm">
              Queued
            </Pill>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step) => (
        <li key={step.id} className="border-b border-line py-2.5 last:border-b-0">
          <div className="flex items-center gap-3">
            <StatusGlyph status={step.status} />
            <span className="min-w-0 flex-1 truncate text-meta text-ink">{step.label}</span>
            <Pill tone={TONE[step.status]} size="sm">
              {LABEL[step.status]}
            </Pill>
          </div>

          {step.hash ? (
            <div className="mt-1.5 flex items-center gap-2 pl-8">
              {linkable ? (
                <ExplorerLink href={txUrl(explorer, step.hash)} mono>
                  {truncateHash(step.hash)} on {explorer.name}
                </ExplorerLink>
              ) : (
                <span className="font-mono text-mini tnum text-ink-2" title={step.hash}>
                  {truncateHash(step.hash)}
                </span>
              )}
              <CopyButton value={step.hash} what="transaction hash" compact />
              {step.receipt ? (
                <span className="font-mono text-mini tnum text-ink-3">
                  block {step.receipt.blockNumber.toString()} · {step.receipt.gasUsed.toString()} gas
                </span>
              ) : null}
            </div>
          ) : null}

          {step.error ? (
            <p role="alert" className="mt-1.5 pl-8 text-mini leading-prose text-neg">
              {step.error}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Shape as well as colour, so the status of a step survives a monochrome screenshot. */
function StatusGlyph({ status }: { status: TxStepStatus }) {
  if (status === 'signing' || status === 'pending') {
    return (
      <span className="grid size-5 shrink-0 place-items-center text-accent">
        <Spinner size={ICON_SIZE.sm} />
      </span>
    );
  }
  const Icon =
    status === 'success' ? Check : status === 'skipped' ? Minus : status === 'idle' ? CircleDashed : OctagonAlert;
  const tone =
    status === 'success'
      ? 'text-pos'
      : status === 'reverted' || status === 'error'
        ? 'text-neg'
        : 'text-ink-3';
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center', tone)}>
      <Icon size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
    </span>
  );
}

/**
 * "0 tokens will move."
 *
 * `ship` and `dock` write storage and emit events; neither performs a transfer or a balance check.
 * That is the claim, and after the transactions land it is checked rather than repeated: every
 * receipt's logs are scanned for the ERC-20 `Transfer` topic and the count is shown. A roll that
 * moved tokens would say so here.
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
